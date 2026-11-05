import { Line, PerformanceMonitor, useCursor, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import * as THREE from 'three'

import { modelUrl } from '../factoryModels'
import { BOARD, COLORS, drawBoardFace, drawCard, drawGlow, drawShadow, drawTimeline, ROW, TRACK } from './drawings'
import {
  cardAt,
  cardLook,
  cardsAround,
  CHART_LEFT,
  CHART_RIGHT,
  CHART_Z,
  columnsAt,
  CYCLE,
  CYCLE_LOTS,
  INBOUND,
  LANE_Z,
  lotAt,
  lotLook,
  lotsAround,
  PARK_X,
  processing,
  PULSE,
  pulsesAt,
  RACK_X,
  RELEASE,
  stepStart,
  STEPS,
  truckAt,
  WARM,
  working,
  type Line as LineName,
} from './flow'

type Props = {
  // Pointer moves anywhere on the entrance, words and button included, turn the view.
  eventSource: RefObject<HTMLElement | null>
  // Called once the first full picture is on the canvas.
  onReady: () => void
  // Called if the browser takes the drawing context away; the still picture stands in.
  onLost: () => void
}

type Tier = 'full' | 'light'

// Every model the scene uses, loaded together once, as soon as this file is.
const MODELS = ['factory_hall', 'material_rack', 'rack_stock', 'carton_stock', 'pallet', 'truck', 'forklift', ...STEPS.map((step) => step.model)]
const MODEL_URLS = MODELS.map(modelUrl)
useGLTF.preload(MODEL_URLS, false)
type Models = Record<string, THREE.Group>

// The part of the hall's floor the outlook, the rack, the machines and the dock stand on, its
// top at y = 0; the camera frames it and the lane runs along it.
const BASE = { left: CHART_LEFT - 1.2, right: PARK_X - 0.2, back: -2.3, front: LANE_Z + 1.35, depth: 0.42, radius: 1.2 }
const GROUND = -BASE.depth
// The machines and the rack stand a size up from the floor tab's, so they read from afar.
const MACHINE_SCALE = 1.3
const RACK_SCALE = 1.2
// Where the plan board hangs: high over the middle of the line, larger than life; on a narrow
// screen a little smaller and further back to the right, clear of the outlook and the rack.
type Placement = { at: THREE.Vector3; scale: number; turn: number }
const BOARD_WIDE = { at: new THREE.Vector3(3.2, 9.4, -2.1), scale: 1.3 }
const BOARD_NARROW = { at: new THREE.Vector3(6.6, 8.6, -1.8), scale: 0.98 }
// The board turns this much of the way to the camera, so its far end stays clear of the roof.
const BOARD_TURN = 0.5
// The store's deck at the back of the building, and where its racks stand on it.
const DECK_Y = 4.8
const STORE_Z = -7.9
const NOW_X = TRACK.left + BOARD.now * TRACK.width
const rowY = (row: number) => TRACK.top - BOARD.header - (row + 0.5) * ROW
// The one point every line leaves from: where now meets the board's lower edge.
const HUB_Y = -BOARD.height / 2 - 0.1
const DOCK_AT = new THREE.Vector3(PARK_X - 0.2, 3.05, LANE_Z)
const OUTLOOK_AT = new THREE.Vector3(CHART_RIGHT - 1.75, 2.7, CHART_Z)
const DEALS_AT = new THREE.Vector3(-21.3, 2.7, 0.9)
const DEALS_SHIFT = 3
// The scene holds still while it fades in over the still picture, which shows this same first
// moment (entrance.css fades it in over 0.9 s), and then starts to move.
const HOLD = 0.9
const sceneTime = (clock: THREE.Clock) => WARM + Math.max(0, clock.elapsedTime - HOLD)

export default function EntranceScene({ eventSource, onReady, onLost }: Props) {
  // Starts at its best and steps down for good if the device cannot keep up.
  const [tier, setTier] = useState<Tier>('full')
  return (
    <Canvas
      flat
      dpr={tier === 'full' ? [1, 1.75] : 1}
      frameloop={tier === 'full' ? 'always' : 'demand'}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ fov: 34, near: 1, far: 320 }}
      eventSource={eventSource as RefObject<HTMLElement>}
      eventPrefix="client"
      onCreated={({ gl }) => gl.domElement.addEventListener('webglcontextlost', onLost, { once: true })}
    >
      <PerformanceMonitor onDecline={() => setTier('light')} />
      {tier === 'light' && <Ticker />}
      <color attach="background" args={[COLORS.page]} />
      <hemisphereLight args={['#ffffff', '#c9c5b8', 1.9]} />
      <directionalLight position={[-14, 26, 18]} intensity={1.4} />
      <Suspense fallback={null}>
        <World tier={tier} onReady={onReady} />
      </Suspense>
    </Canvas>
  )
}

// On a slow device the picture is drawn 30 times a second instead of at the screen's rate.
function Ticker() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    const timer = window.setInterval(() => invalidate(), 33)
    return () => window.clearInterval(timer)
  }, [invalidate])
  return null
}

type Framing = {
  position: THREE.Vector3
  target: THREE.Vector3
  right: THREE.Vector3
  up: THREE.Vector3
  azimuth: number
  distance: number
  board: Placement
  // How far right the deals hang: on a narrow screen they come in nearer, so all of them show.
  deals: number
}

const lerp = THREE.MathUtils.lerp
const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1)

// The board turns to face the camera, so it reads as a flat chart from any width.
const boardMatrix = (board: Placement) =>
  new THREE.Matrix4().compose(
    board.at,
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, board.turn, 0)),
    new THREE.Vector3(board.scale, board.scale, board.scale),
  )

// The camera looks from the front, a little from the right and above, so the deals far left
// come in out of the haze and the dock stands nearest. On a narrow screen it turns further
// round and looks further down, and the flow runs from the top down toward the words. It is set
// back until what matters fits the part of the screen above the words, or, on a screen too low
// for that, the part right of them.
function frameFor(aspect: number, fov: number, low: boolean): Framing {
  const narrow = clamp01((1.45 - aspect) / (1.45 - 0.5))
  const azimuth = lerp(0.5, 1.06, narrow)
  const elevation = lerp(0.5, 0.7, narrow)
  const back = new THREE.Vector3(Math.sin(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.cos(azimuth) * Math.cos(elevation))
  const board: Placement = {
    at: BOARD_WIDE.at.clone().lerp(BOARD_NARROW.at, narrow),
    scale: lerp(BOARD_WIDE.scale, BOARD_NARROW.scale, narrow),
    turn: azimuth * BOARD_TURN,
  }
  const boardAt = boardMatrix(board)
  const corners = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ].map(([x, y]) => new THREE.Vector3((x * BOARD.width) / 2, (y * BOARD.height) / 2, 0).applyMatrix4(boardAt))
  const points = [
    ...corners,
    new THREE.Vector3(RACK_X - 1.3, 0, BASE.back),
    new THREE.Vector3(BASE.right, 0, BASE.back),
    new THREE.Vector3(-6, GROUND, BASE.front),
    // On a wide screen the whole truck, the outlook and the deals; on a narrow one the truck's
    // cab may run off the right, so the rest stands larger.
    ...(narrow < 0.5
      ? [
          new THREE.Vector3(PARK_X + 6.8, 3.2, LANE_Z - 1.1),
          new THREE.Vector3(PARK_X + 6.8, GROUND, LANE_Z + 1.2),
          new THREE.Vector3(PARK_X + 6.8, 2.6, LANE_Z + 1.2),
          new THREE.Vector3(BASE.left, GROUND, BASE.front),
          new THREE.Vector3(-24.8, 4.2, 2.6),
          new THREE.Vector3(-24.8, 1.2, -1.2),
          // The building: the glass office and the office block at the left, the roof at the right.
          new THREE.Vector3(-28.5, 0, 3.6),
          new THREE.Vector3(-28.5, 5.1, 3.6),
          new THREE.Vector3(-28, 7.6, -2.4),
          new THREE.Vector3(-14.2, 13.9, -6.9),
          new THREE.Vector3(19.5, 13.9, -9.25),
        ]
      : [
          new THREE.Vector3(PARK_X + 2.6, GROUND, LANE_Z + 1.2),
          new THREE.Vector3(PARK_X + 2.6, 3.2, LANE_Z - 1.1),
          new THREE.Vector3(BASE.left + 2, 0, BASE.front),
          new THREE.Vector3(-25.2 + DEALS_SHIFT, 4.2, 2.6),
          new THREE.Vector3(-25.2 + DEALS_SHIFT, 1.2, -1.2),
        ]),
  ]
  // The part of the screen the picture should fill, in the camera's -1 to 1 across and up. On a
  // wide screen the flow runs down to the right, past the words at the lower left.
  const rect = low
    ? { left: -0.06, right: 0.97, bottom: -0.86, top: 0.88 }
    : narrow < 0.5
      ? { left: -0.92, right: 0.94, bottom: -0.74, top: 0.92 }
      : { left: -0.92, right: 0.92, bottom: -0.4, top: 0.95 }
  const camera = new THREE.PerspectiveCamera(fov, aspect, 1, 400)
  const target = points.reduce((sum, point) => sum.add(point), new THREE.Vector3()).divideScalar(points.length)
  let distance = 60
  const right = new THREE.Vector3()
  const up = new THREE.Vector3()
  for (let pass = 0; pass < 24; pass++) {
    camera.position.copy(target).addScaledVector(back, distance)
    camera.lookAt(target)
    camera.updateMatrixWorld()
    right.setFromMatrixColumn(camera.matrixWorld, 0)
    up.setFromMatrixColumn(camera.matrixWorld, 1)
    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    let maxY = -Infinity
    for (const point of points) {
      const seen = point.clone().project(camera)
      minX = Math.min(minX, seen.x)
      maxX = Math.max(maxX, seen.x)
      minY = Math.min(minY, seen.y)
      maxY = Math.max(maxY, seen.y)
    }
    const halfHeight = Math.tan(THREE.MathUtils.degToRad(fov / 2)) * distance
    target
      .addScaledVector(right, (((minX + maxX) / 2 - (rect.left + rect.right) / 2) * halfHeight * aspect) / 1)
      .addScaledVector(up, ((minY + maxY) / 2 - (rect.top + rect.bottom) / 2) * halfHeight)
    const spread = Math.max((maxX - minX) / (rect.right - rect.left), (maxY - minY) / (rect.top - rect.bottom))
    distance *= Math.pow(spread, 0.7)
  }
  camera.position.copy(target).addScaledVector(back, distance)
  return { position: camera.position.clone(), target, right, up, azimuth, distance, board, deals: narrow < 0.5 ? 0 : DEALS_SHIFT }
}

function World({ tier, onReady }: { tier: Tier; onReady: () => void }) {
  const size = useThree((state) => state.size)
  const fov = useThree((state) => (state.camera as THREE.PerspectiveCamera).fov)
  const aspect = size.width / Math.max(1, size.height)
  // As entrance.css puts the words at the left on a low, wide screen.
  const low = size.height <= 500 && aspect >= 1.2
  const framing = useMemo(() => frameFor(aspect, fov, low), [aspect, fov, low])
  const clock = useThree((state) => state.clock)
  const loaded = useGLTF(MODEL_URLS, false)
  const models = useMemo<Models>(() => Object.fromEntries(MODELS.map((name, index) => [name, loaded[index].scene])), [loaded])
  const [hovered, setHovered] = useState<LineName | null>(null)
  useCursor(hovered !== null)
  // When the planner last tapped the scene: word then runs down every line at once.
  const burst = useRef(-Infinity)
  const onBurst = (time: number) => {
    burst.current = time
  }
  useEffect(() => {
    let second = 0
    // The scene's time starts now, at the moment the still picture shows.
    clock.start()
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => onReady())
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [onReady, clock])
  return (
    <>
      <fog attach="fog" args={[COLORS.page, framing.distance * 0.9, framing.distance * 1.75]} />
      <Rig framing={framing} />
      <Floor board={framing.board} onBurst={onBurst} />
      <Hall scene={models.factory_hall} />
      <Store rack={models.material_rack} steel={models.rack_stock} cartons={models.carton_stock} forklift={models.forklift} pallet={models.pallet} />
      <Rack scene={models.material_rack} stock={models.rack_stock} hovered={hovered === 'rack'} onHover={setHovered} />
      {STEPS.map((step, index) => (
        <Machine key={step.name} scene={models[step.model]} step={index} hovered={hovered === index} onHover={setHovered} />
      ))}
      <Lots pallet={models.pallet} />
      <Truck scene={models.truck} />
      <Forklift scene={models.forklift} pallet={models.pallet} />
      <Chart />
      <Cards azimuth={framing.azimuth} shift={framing.deals} />
      <Board board={framing.board} hovered={hovered} onHover={setHovered} onBurst={onBurst} />
      <Lines models={models} board={framing.board} deals={framing.deals} hovered={hovered} burst={burst} tier={tier} />
    </>
  )
}

// The camera stands where the framing puts it and leans a little toward the pointer, easing
// after it, so the scene turns with the hand that moves over it.
function Rig({ framing }: { framing: Framing }) {
  const camera = useThree((state) => state.camera)
  const lean = useRef(new THREE.Vector2())
  useFrame((state, delta) => {
    const ease = 1 - Math.exp(-Math.min(delta, 0.1) * 2.4)
    lean.current.x += (state.pointer.x - lean.current.x) * ease
    lean.current.y += (state.pointer.y - lean.current.y) * ease
    const reach = framing.distance * 0.035
    camera.position
      .copy(framing.position)
      .addScaledVector(framing.right, lean.current.x * reach)
      .addScaledVector(framing.up, lean.current.y * reach * 0.5)
    camera.lookAt(framing.target)
  })
  return null
}

function useTexture(draw: () => HTMLCanvasElement, setup?: (texture: THREE.CanvasTexture) => void) {
  // Each drawing is fixed, so it is drawn once.
  const [texture] = useState(() => {
    const made = new THREE.CanvasTexture(draw())
    made.colorSpace = THREE.SRGBColorSpace
    made.anisotropy = 8
    setup?.(made)
    return made
  })
  useEffect(() => () => texture.dispose(), [texture])
  return texture
}

function Shadow({ position, size, opacity = 1 }: { position: [number, number, number]; size: [number, number]; opacity?: number }) {
  const texture = useTexture(drawShadow)
  return (
    <mesh rotation-x={-Math.PI / 2} position={position}>
      <planeGeometry args={size} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  )
}

// The ground the hall stands on, and on the hall's floor a pale aisle in front of the machines
// for the lots and the dock's gate; a tap anywhere on them sends word down every line.
function Floor({ board, onBurst }: { board: Placement; onBurst: (time: number) => void }) {
  const clock = useThree((state) => state.clock)
  const laneStart = RACK_X - 0.6
  const laneEnd = BASE.right - 0.1
  const burst = () => onBurst(sceneTime(clock))
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[0, GROUND - 0.08, 0]} onClick={burst}>
        <planeGeometry args={[240, 180]} />
        <meshBasicMaterial color={COLORS.floor} />
      </mesh>
      <Shadow position={[-4.4, GROUND - 0.07, -2.4]} size={[54, 18]} opacity={0.4} />
      <mesh rotation-x={-Math.PI / 2} position={[-4.4, 0.002, -2.8]} onClick={burst}>
        <planeGeometry args={[47, 12.5]} />
        <meshBasicMaterial visible={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[(laneStart + laneEnd) / 2, 0.006, LANE_Z]}>
        <planeGeometry args={[laneEnd - laneStart, 1.5]} />
        <meshBasicMaterial color={COLORS.zone} />
      </mesh>
      {[LANE_Z - 0.75, LANE_Z + 0.75].map((z) => (
        <mesh key={z} rotation-x={-Math.PI / 2} position={[(laneStart + laneEnd) / 2, 0.008, z]}>
          <planeGeometry args={[laneEnd - laneStart, 0.04]} />
          <meshBasicMaterial color={COLORS.zoneLine} />
        </mesh>
      ))}
      {/* The dock's gate in the hall's wall, where the truck's rear stops. */}
      {[LANE_Z - 1.25, LANE_Z + 1.25].map((z) => (
        <mesh key={z} position={[PARK_X - 0.35, 1.5, z]}>
          <boxGeometry args={[0.22, 3.0, 0.22]} />
          <meshStandardMaterial color={COLORS.clay} roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[PARK_X - 0.35, 3.0, LANE_Z]}>
        <boxGeometry args={[0.24, 0.24, 2.72]} />
        <meshStandardMaterial color={COLORS.clay} roughness={0.6} />
      </mesh>
      {/* The board hangs over the floor, and its shadow lies under it. */}
      <Shadow position={[board.at.x, 0.012, board.at.z + 1.6]} size={[BOARD.width * board.scale, 3.6]} opacity={0.22} />
    </group>
  )
}

// The building around the line and the yard outside it, as the model places them; its glass
// lets the office's deals and outlook show through.
function Hall({ scene }: { scene: THREE.Object3D }) {
  const copy = useMemo(() => {
    const made = scene.clone(true)
    made.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material.name === 'pane') {
        const pane = (object.material as THREE.MeshStandardMaterial).clone()
        pane.transparent = true
        pane.opacity = 0.22
        pane.depthWrite = false
        object.material = pane
      }
    })
    return made
  }, [scene])
  return <primitive object={copy} />
}

// Sets the forks and their load at a height, and turns wheels whose axles run across.
function rise(parts: (THREE.Object3D | null)[], height: number) {
  for (const part of parts) if (part) part.position.y = height
}
function spin(wheels: THREE.Object3D[], angle: number) {
  for (const wheel of wheels) wheel.rotation.x = angle
}

// The store on the deck at the back of the hall: racks of steel stock and of cartons, and a
// forklift going to and fro between them with a load.
const STORE_STEEL = [-11.0, -7.6]
const STORE_CARTONS = [9.6, 13.0, 16.4]
const STORE_RUN = { from: 14.4, to: 17.6, z: -5.2, period: 12 }

function Store({
  rack,
  steel,
  cartons,
  forklift,
  pallet,
}: {
  rack: THREE.Object3D
  steel: THREE.Object3D
  cartons: THREE.Object3D
  forklift: THREE.Object3D
  pallet: THREE.Object3D
}) {
  const racks = useMemo(
    () => [...STORE_STEEL.map((x) => ({ x, stock: steel })), ...STORE_CARTONS.map((x) => ({ x, stock: cartons }))].map(({ x, stock }) => ({ x, rack: rack.clone(true), stock: stock.clone(true) })),
    [rack, steel, cartons],
  )
  const truck = useMemo(() => forklift.clone(true), [forklift])
  const load = useMemo(() => pallet.clone(true), [pallet])
  const lift = useMemo(() => truck.getObjectByName('lift') ?? null, [truck])
  const wheels = useMemo(() => ['front_left', 'front_right', 'rear_left', 'rear_right'].map((side) => truck.getObjectByName(`wheel_${side}`)).filter((wheel): wheel is THREE.Object3D => Boolean(wheel)), [truck])
  const body = useRef<THREE.Group>(null)
  const carried = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!body.current) return
    // Out and back once a period, easing to a stop at each end, where the forks rise and settle.
    const phase = (sceneTime(clock) / STORE_RUN.period) % 1
    const leg = phase < 0.5 ? phase * 2 : 2 - phase * 2
    const u = THREE.MathUtils.smootherstep(THREE.MathUtils.clamp((leg - 0.12) / 0.76, 0, 1), 0, 1)
    const x = lerp(STORE_RUN.from, STORE_RUN.to, u)
    body.current.position.x = x
    const raise = 0.35 * Math.max(0, 1 - Math.abs(leg - (leg < 0.5 ? 0 : 1)) / 0.12)
    rise([lift, carried.current], raise)
    spin(wheels, x / 0.22)
  })
  return (
    <group>
      {racks.map(({ x, rack: copy, stock }) => (
        <group key={x} position={[x, DECK_Y, STORE_Z]} scale={RACK_SCALE}>
          <primitive object={copy} />
          <primitive object={stock} />
        </group>
      ))}
      <group ref={body} position={[STORE_RUN.from, DECK_Y, STORE_RUN.z]} rotation-y={Math.PI / 2}>
        <primitive object={truck} />
        <group ref={carried}>
          <primitive object={load} position={[0, 0.06, 0.55]} />
          <mesh position={[0, 0.41, 0.55]}>
            <boxGeometry args={[0.96, 0.6, 0.96]} />
            <meshStandardMaterial color={COLORS.carton} roughness={0.85} />
          </mesh>
        </group>
        <Shadow position={[0, 0.011, -0.5]} size={[1.9, 3.6]} opacity={0.5} />
      </group>
    </group>
  )
}

// A copy of a model whose lamp can change color, with the parts that move while it works
// taken out where they stood, each to be moved by its role (move_<role> in the model).
type MovingPart = { role: string; node: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Euler }

function useModel(scene: THREE.Object3D) {
  const made = useMemo(() => {
    const copy = scene.clone(true)
    let lamp: THREE.MeshStandardMaterial | null = null
    copy.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material.name === 'lamp') {
        lamp = (object.material as THREE.MeshStandardMaterial).clone()
        object.material = lamp
      }
    })
    copy.updateMatrixWorld(true)
    const tipNode = copy.getObjectByName('tip_torch')
    const tip = tipNode ? tipNode.position.clone() : null
    const moving: MovingPart[] = []
    const collect = (object: THREE.Object3D) => {
      if (object.name.startsWith('move_')) {
        moving.push({ role: object.name.slice('move_'.length), node: object, position: new THREE.Vector3(), rotation: new THREE.Euler() })
      } else object.children.forEach(collect)
    }
    collect(copy)
    for (const part of moving) {
      part.node.matrixWorld.decompose(part.node.position, part.node.quaternion, part.node.scale)
      part.node.removeFromParent()
      part.position.copy(part.node.position)
      part.rotation.copy(part.node.rotation)
    }
    return { copy, lamp: lamp as THREE.MeshStandardMaterial | null, moving, tip }
  }, [scene])
  useEffect(() => () => made.lamp?.dispose(), [made])
  return made
}

// Where a model's lamp is, for the line that brings it word.
function lampOf(scene: THREE.Object3D): THREE.Vector3 {
  let found: THREE.Vector3 | null = null
  scene.updateMatrixWorld(true)
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh && object.material.name === 'lamp') {
      found = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3())
    }
  })
  return found ?? new THREE.Box3().setFromObject(scene).getCenter(new THREE.Vector3()).setY(2)
}

// How long the step has worked in all, so a turning part keeps turning the same way from
// one lot to the next instead of winding back.
function workedSoFar(step: number, time: number): number {
  const lot = Math.max(0, Math.floor((time - stepStart(0, step)) / RELEASE))
  let total = 0
  const cycleTotal = Array.from({ length: CYCLE_LOTS }, (_, index) => processing(index, step)).reduce((sum, value) => sum + value, 0)
  total += Math.floor(lot / CYCLE_LOTS) * cycleTotal
  for (let index = lot - (lot % CYCLE_LOTS); index < lot; index++) total += processing(index, step)
  return total + Math.min(Math.max(0, time - stepStart(lot, step)), processing(lot, step))
}

// How each part moves while its machine works, from where it was made, and how much of that
// motion shows: none at the start and end of the work, so the part settles back without a jump.
function move(role: string, part: MovingPart, into: number, amount: number, worked: number) {
  const { node } = part
  node.position.copy(part.position)
  node.rotation.copy(part.rotation)
  const turn = (period: number) => (into / period) * Math.PI * 2
  const stroke = (period: number) => (1 - Math.cos(turn(period))) / 2
  switch (role) {
    case 'ram':
      node.position.y -= 0.18 * stroke(1.2) * amount
      break
    case 'arm':
      node.rotation.y += 0.22 * Math.sin(turn(1.6)) * amount
      break
    case 'magazine':
      node.rotation.x += (worked / 4) * Math.PI * 2
      break
    case 'head':
      node.position.y -= 0.24 * stroke(1.4) * amount
      break
    case 'bridge':
      node.position.z += 0.19 * Math.sin(turn(1.5)) * amount
      break
    case 'table':
      node.position.x += 0.26 * Math.sin(turn(1.8)) * amount
      break
    case 'spindle':
      node.position.y -= 0.12 * stroke(0.9) * amount
      break
  }
}

// A machine's lamp: lit in the running color while it works.
function light(lamp: THREE.MeshStandardMaterial, color: THREE.Color, glow: THREE.Color) {
  lamp.color.copy(color)
  lamp.emissive.copy(glow)
  lamp.emissiveIntensity = 1
}

function Machine({
  scene,
  step,
  hovered,
  onHover,
}: {
  scene: THREE.Object3D
  step: number
  hovered: boolean
  onHover: (line: LineName | null) => void
}) {
  const info = STEPS[step]
  const { copy, lamp, moving, tip } = useModel(scene)
  const arc = useRef<THREE.MeshBasicMaterial>(null)
  const running = useMemo(() => new THREE.Color(COLORS.running), [])
  const idle = useMemo(() => new THREE.Color(COLORS.idle), [])
  const dark = useMemo(() => new THREE.Color('#000000'), [])
  useFrame(({ clock }) => {
    const time = sceneTime(clock)
    const progress = working(step, time)
    const on = progress !== null
    if (lamp) light(lamp, on ? running : idle, on ? running : dark)
    const length = on ? processing(Math.floor((time - stepStart(0, step)) / RELEASE), step) : 1
    const into = on ? progress * length : 0
    const amount = on ? Math.min(1, into / 0.35, (length - into) / 0.35) : 0
    const worked = workedSoFar(step, time)
    for (const part of moving) move(part.role, part, into, amount, worked)
    // The arc glows while the robot welds, swelling and fading slowly instead of flickering.
    if (arc.current) arc.current.opacity = on ? amount * (0.7 + 0.25 * Math.sin(time * 3)) : 0
  })
  return (
    <group position={[info.x, 0, 0]} scale={MACHINE_SCALE}>
      <primitive object={copy} />
      {moving.map((part) => (
        <primitive key={part.role} object={part.node}>
          {part.role === 'arm' && tip && (
            <mesh position={tip}>
              <sphereGeometry args={[0.08, 12, 8]} />
              <meshBasicMaterial ref={arc} color="#DCEBFF" transparent opacity={0} depthWrite={false} />
            </mesh>
          )}
        </primitive>
      ))}
      <Shadow position={[0, 0.011, -0.1]} size={[3.4, 2.8]} opacity={0.55} />
      {hovered && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[1.75, 1.88, 64]} />
          <meshBasicMaterial color={COLORS.accent} />
        </mesh>
      )}
      <mesh position={[0, 1.2, 0]} onPointerOver={() => onHover(step)} onPointerOut={() => onHover(null)}>
        <boxGeometry args={[2.8, 2.6, 2.4]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  )
}

// The material rack at the start of the line, its shelves stocked with plate, round tube and
// square tube.
function Rack({
  scene,
  stock,
  hovered,
  onHover,
}: {
  scene: THREE.Object3D
  stock: THREE.Object3D
  hovered: boolean
  onHover: (line: LineName | null) => void
}) {
  const { copy } = useModel(scene)
  const { copy: material } = useModel(stock)
  return (
    <group position={[RACK_X, 0, 0]} scale={RACK_SCALE}>
      <primitive object={copy} />
      <primitive object={material} />
      <Shadow position={[0, 0.011, 0]} size={[3.4, 1.8]} opacity={0.5} />
      {hovered && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.02}>
          <ringGeometry args={[1.6, 1.72, 64]} />
          <meshBasicMaterial color={COLORS.accent} />
        </mesh>
      )}
      <mesh position={[0, 1.1, 0]} onPointerOver={() => onHover('rack')} onPointerOut={() => onHover(null)}>
        <boxGeometry args={[2.8, 2.4, 1.4]} />
        <meshBasicMaterial visible={false} />
      </mesh>
    </group>
  )
}

const POOL = 18
const matrix = new THREE.Matrix4()
const spot = new THREE.Vector3()
const turned = new THREE.Quaternion()
const sized = new THREE.Vector3()
// Lying flat on the floor.
const flat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0))

// Puts a pallet, a card or another piece where its pose says, or hides it when there is none.
function place(object: THREE.Object3D, at: { x: number; y: number; z: number } | null, scale: number) {
  object.visible = Boolean(at) && scale > 0.01
  if (!at) return
  object.position.set(at.x, at.y, at.z)
  object.scale.setScalar(Math.max(0.001, scale))
}

// The lots on pallets: plate from the rack until the first machine has worked on them, then
// cartons in the color their order has on the Gantt chart.
function Lots({ pallet }: { pallet: THREE.Object3D }) {
  const pallets = useMemo(() => Array.from({ length: POOL }, () => pallet.clone(true)), [pallet])
  const cartons = useRef<THREE.InstancedMesh>(null)
  const plates = useRef<THREE.InstancedMesh>(null)
  const shadows = useRef<THREE.InstancedMesh>(null)
  const shadow = useTexture(drawShadow)
  const tones = useMemo(() => ({ ok: new THREE.Color(COLORS.accent), tight: new THREE.Color(COLORS.tight) }), [])
  useFrame(({ clock }) => {
    if (!cartons.current || !plates.current || !shadows.current) return
    const time = sceneTime(clock)
    let used = 0
    let boxes = 0
    let sheets = 0
    for (const lot of lotsAround(time)) {
      const pose = lotAt(lot, time)
      if (!pose || used >= POOL) continue
      place(pallets[used], pose, pose.scale)
      shadows.current.setMatrixAt(used, matrix.compose(spot.set(pose.x, 0.013, pose.z), flat, sized.set(1.7 * pose.scale, 1.7 * pose.scale, 1)))
      used++
      const look = lotLook(lot)
      if (!pose.worked) {
        matrix.compose(spot.set(pose.x, pose.y + 0.27 * pose.scale, pose.z), turned.identity(), sized.setScalar(Math.max(0.001, pose.scale)))
        plates.current.setMatrixAt(sheets++, matrix)
        continue
      }
      for (let carton = 0; carton < look.cartons; carton++) {
        const x = ((carton % 2) * 0.52 - 0.26) * pose.scale
        const z = (Math.floor(carton / 2) * 0.52 - 0.26) * pose.scale
        matrix.compose(spot.set(pose.x + x, pose.y + 0.37 * pose.scale, pose.z + z), turned.identity(), sized.setScalar(Math.max(0.001, pose.scale)))
        cartons.current.setMatrixAt(boxes, matrix)
        cartons.current.setColorAt(boxes, tones[look.tone])
        boxes++
      }
    }
    for (let index = used; index < POOL; index++) place(pallets[index], null, 0)
    cartons.current.count = boxes
    plates.current.count = sheets
    shadows.current.count = used
    for (const mesh of [cartons.current, plates.current, shadows.current]) mesh.instanceMatrix.needsUpdate = true
    if (cartons.current.instanceColor) cartons.current.instanceColor.needsUpdate = true
  })
  return (
    <group>
      {pallets.map((pallet, index) => (
        <primitive key={index} object={pallet} />
      ))}
      <instancedMesh ref={cartons} args={[undefined, undefined, POOL * 4]} frustumCulled={false}>
        <boxGeometry args={[0.48, 0.42, 0.48]} />
        <meshStandardMaterial roughness={0.7} />
      </instancedMesh>
      <instancedMesh ref={plates} args={[undefined, undefined, POOL]} frustumCulled={false}>
        <boxGeometry args={[0.98, 0.26, 0.98]} />
        <meshStandardMaterial color={COLORS.material} roughness={0.4} metalness={0.35} />
      </instancedMesh>
      <instancedMesh ref={shadows} args={[undefined, undefined, POOL]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shadow} transparent opacity={0.6} depthWrite={false} />
      </instancedMesh>
    </group>
  )
}

// A box truck on the ground beside the base, its rear to the dock and open: it backs in from
// the right, takes four lots on board, and drives off to the right. The model's rear is at
// x = 0 and its front toward +x.
const WHEEL = 0.4

function Truck({ scene }: { scene: THREE.Object3D }) {
  const copy = useMemo(() => scene.clone(true), [scene])
  const wheels = useMemo(
    () => [0, 1, 2, 3].map((index) => copy.getObjectByName(`wheel_${index}`)).filter((wheel): wheel is THREE.Object3D => Boolean(wheel)),
    [copy],
  )
  const body = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!body.current) return
    const truck = truckAt(sceneTime(clock))
    body.current.visible = truck !== null
    if (!truck) return
    body.current.position.x = PARK_X + truck.offset
    roll(wheels, -truck.offset / WHEEL)
  })
  return (
    <group ref={body} position={[PARK_X, GROUND - 0.08, LANE_Z]}>
      <primitive object={copy} />
      <Shadow position={[3.4, 0.012, 0]} size={[8, 3.4]} opacity={0.6} />
    </group>
  )
}

function roll(wheels: THREE.Object3D[], angle: number) {
  for (const wheel of wheels) wheel.rotation.z = angle
}

// A forklift waiting behind the dock's places with an empty pallet, ready to load.
function Forklift({ scene, pallet }: { scene: THREE.Object3D; pallet: THREE.Object3D }) {
  const copy = useMemo(() => scene.clone(true), [scene])
  const load = useMemo(() => pallet.clone(true), [pallet])
  return (
    <group position={[17.2, 0, -0.75]} rotation-y={Math.PI / 2}>
      <primitive object={copy} />
      {/* The pallet stands on the forks, its middle 0.55 m ahead of where they meet the mast. */}
      <primitive object={load} position={[0, 0.06, 0.55]} />
      <Shadow position={[0, 0.011, -0.5]} size={[1.9, 3.6]} opacity={0.5} />
    </group>
  )
}

// The outlook: a column for each month in a row on the base, firm orders solid and the
// expected part pale above them.
function Chart() {
  const solids = useRef<(THREE.Mesh | null)[]>([])
  const pales = useRef<(THREE.Mesh | null)[]>([])
  useFrame(({ clock }) => {
    const columns = columnsAt(sceneTime(clock))
    for (let index = 0; index < 8; index++) {
      const solid = solids.current[index]
      const pale = pales.current[index]
      if (!solid || !pale) continue
      const column = columns[index]
      solid.visible = pale.visible = Boolean(column && column.height > 0.01)
      if (!column || !solid.visible) continue
      const firm = column.height * column.firm
      const rest = column.height - firm
      solid.position.set(column.x, firm / 2, CHART_Z)
      solid.scale.set(1, Math.max(0.001, firm), 1)
      pale.position.set(column.x, firm + rest / 2, CHART_Z)
      pale.scale.set(1, Math.max(0.001, rest), 1)
    }
  })
  // Lower than drawn, so the outlook stands inside the glass office.
  return (
    <group scale-y={0.5}>
      {Array.from({ length: 8 }, (_, index) => (
        <group key={index}>
          <mesh ref={(mesh) => void (solids.current[index] = mesh)}>
            <boxGeometry args={[0.8, 1, 0.8]} />
            <meshStandardMaterial color={COLORS.accent} roughness={0.55} />
          </mesh>
          <mesh ref={(mesh) => void (pales.current[index] = mesh)}>
            <boxGeometry args={[0.8, 1, 0.8]} />
            <meshStandardMaterial color={COLORS.accent} roughness={0.55} transparent opacity={0.28} depthWrite={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

function fade(materials: THREE.Material[], opacity: number) {
  for (const material of materials) material.opacity = opacity
}

// The deals: white cards in the air, each with a bar showing how sure it is.
function Cards({ azimuth, shift }: { azimuth: number; shift: number }) {
  const face = useTexture(drawCard)
  const groups = useRef<(THREE.Group | null)[]>([])
  // Each part writes its depth, so the bar in front of its card shows whichever is drawn first;
  // the card's clear corners write none.
  const faces = useMemo(() => Array.from({ length: 8 }, () => new THREE.MeshBasicMaterial({ map: face, transparent: true, alphaTest: 0.02, fog: false })), [face])
  const tracks = useMemo(() => Array.from({ length: 8 }, () => new THREE.MeshBasicMaterial({ color: COLORS.zone, transparent: true, fog: false })), [])
  const fills = useMemo(() => Array.from({ length: 8 }, () => new THREE.MeshBasicMaterial({ color: COLORS.accent, transparent: true, fog: false })), [])
  const fillMeshes = useRef<(THREE.Mesh | null)[]>([])
  useEffect(() => () => [...faces, ...tracks, ...fills].forEach((material) => material.dispose()), [faces, tracks, fills])
  useFrame(({ clock }) => {
    const time = sceneTime(clock)
    const shown = cardsAround(time)
      .map((card) => ({ card, pose: cardAt(card, time) }))
      .filter((item) => item.pose)
    for (let index = 0; index < 8; index++) {
      const group = groups.current[index]
      if (!group) continue
      const item = shown[index]
      group.visible = Boolean(item)
      if (!item?.pose) continue
      const { pose } = item
      // A card that has dropped into the outlook stays where it landed, wherever the others hang.
      group.position.set(pose.x + (pose.scale < 1 ? shift * (1 - (1 - pose.scale) / 0.75) : shift), pose.y, pose.z)
      group.rotation.set(0, azimuth + pose.turn, 0)
      group.scale.setScalar(Math.max(0.001, 1.6 * pose.scale))
      fade([faces[index], tracks[index], fills[index]], pose.opacity)
      fills[index].color.set(cardLook(item.card).likely ? COLORS.accent : COLORS.idle)
      const fill = fillMeshes.current[index]
      if (fill) {
        fill.scale.x = pose.fill
        fill.position.x = -0.55 + (1.1 * pose.fill) / 2
      }
    }
  })
  return (
    <group>
      {Array.from({ length: 8 }, (_, index) => (
        <group key={index} ref={(group) => void (groups.current[index] = group)}>
          <mesh material={faces[index]}>
            <planeGeometry args={[1.5, 1]} />
          </mesh>
          <mesh material={tracks[index]} position={[0, -0.28, 0.012]}>
            <planeGeometry args={[1.1, 0.1]} />
          </mesh>
          <mesh material={fills[index]} position={[0, -0.28, 0.024]} ref={(mesh) => void (fillMeshes.current[index] = mesh)}>
            <planeGeometry args={[1.1, 0.1]} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// Moves the board's track so now stands at its place across it; the track wraps round, so the
// plan only ever goes by to the left.
function scroll(strip: THREE.Texture, time: number) {
  strip.offset.x = ((((time - BOARD.now * BOARD.window) / CYCLE) % 1) + 1) % 1
}

// The point every line leaves from: a light at the foot of now, breathing slowly.
function Hub() {
  const glow = useTexture(drawGlow)
  const halo = useRef<THREE.Mesh>(null)
  const camera = useThree((state) => state.camera)
  useFrame(({ clock }) => {
    if (!halo.current) return
    halo.current.quaternion.copy(camera.quaternion)
    breathe(halo.current, 1.5 + 0.25 * Math.sin(sceneTime(clock) * 1.3))
  })
  return (
    <group position={[NOW_X, HUB_Y, 0.06]}>
      <mesh>
        <sphereGeometry args={[0.16, 18, 12]} />
        <meshBasicMaterial color={COLORS.accent} fog={false} />
      </mesh>
      <mesh ref={halo}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={glow} color={COLORS.accent} transparent opacity={0.55} depthWrite={false} fog={false} />
      </mesh>
    </group>
  )
}

function breathe(object: THREE.Object3D, size: number) {
  object.scale.setScalar(size)
}

// The plan board: the Gantt chart in the air, its bars going by to the left, now at a fixed
// place across it. It leans a little toward the pointer, and the row under the pointer, or of
// the machine under it, lights up.
function Board({
  board,
  hovered,
  onHover,
  onBurst,
}: {
  board: Placement
  hovered: LineName | null
  onHover: (line: LineName | null) => void
  onBurst: (time: number) => void
}) {
  const face = useTexture(drawBoardFace)
  const strip = useTexture(drawTimeline, (texture) => {
    texture.wrapS = THREE.RepeatWrapping
    texture.repeat.x = BOARD.window / CYCLE
  })
  const lean = useRef<THREE.Group>(null)
  const clock = useThree((state) => state.clock)
  useFrame((state, delta) => {
    const time = sceneTime(state.clock)
    scroll(strip, time)
    if (!lean.current) return
    const ease = 1 - Math.exp(-Math.min(delta, 0.1) * 3)
    lean.current.rotation.y += (state.pointer.x * 0.05 - lean.current.rotation.y) * ease
    lean.current.rotation.x += (-state.pointer.y * 0.035 - lean.current.rotation.x) * ease
  })
  const row = typeof hovered === 'number' ? hovered : null
  return (
    <group position={board.at} rotation-y={board.turn} scale={board.scale}>
      {/* It leans round the point the lines leave from, so they stay joined to it. */}
      <group ref={lean} position={[NOW_X, HUB_Y, 0]}>
        <group position={[-NOW_X, -HUB_Y, 0]}>
          <mesh position={[0, 0, -0.1]}>
            <boxGeometry args={[BOARD.width + 0.16, BOARD.height + 0.16, 0.16]} />
            <meshStandardMaterial color={COLORS.glassEdge} roughness={0.35} />
          </mesh>
          <mesh onClick={() => onBurst(sceneTime(clock))}>
            <planeGeometry args={[BOARD.width, BOARD.height]} />
            {/* Drawn with the solid things, its round corners cut out, so the track always lies on it. */}
            <meshBasicMaterial map={face} alphaTest={0.5} fog={false} />
          </mesh>
          {row !== null && (
            <mesh position={[0, rowY(row), 0.004]} renderOrder={1}>
              <planeGeometry args={[BOARD.width - 2 * BOARD.pad, ROW - 0.02]} />
              <meshBasicMaterial color={COLORS.accent} transparent opacity={0.16} depthWrite={false} fog={false} />
            </mesh>
          )}
          <mesh renderOrder={2} position={[TRACK.left + TRACK.width / 2, TRACK.top - TRACK.height / 2, 0.006]}>
            <planeGeometry args={[TRACK.width, TRACK.height]} />
            <meshBasicMaterial map={strip} transparent depthWrite={false} fog={false} />
          </mesh>
          {/* Now: a line in the text color from its tag in the head row down to the board's edge. */}
          <mesh position={[NOW_X, (TRACK.top - BOARD.header / 2 + HUB_Y) / 2, 0.012]}>
            <planeGeometry args={[0.05, TRACK.top - BOARD.header / 2 - HUB_Y]} />
            <meshBasicMaterial color={COLORS.ink} fog={false} />
          </mesh>
          <Hub />
          <mesh position={[NOW_X, TRACK.top - BOARD.header * 0.38, 0.014]}>
            <planeGeometry args={[0.62, 0.26]} />
            <meshBasicMaterial color={COLORS.ink} fog={false} />
          </mesh>
          {STEPS.map((step, index) => (
            <mesh
              key={step.name}
              position={[0, rowY(index), 0.02]}
              onPointerOver={() => onHover(index)}
              onPointerOut={() => onHover(null)}
            >
              <planeGeometry args={[BOARD.width, ROW]} />
              <meshBasicMaterial visible={false} />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  )
}

type Wire = { name: LineName; curve: THREE.CubicBezierCurve3 }

// The lines, all from the one point at the foot of now on the board: out to the deals and the
// outlook, whose word comes in along them, and down to the rack, each machine's lamp and the
// dock, where word goes out. Each leaves the point level and drops onto what it reaches.
function Lines({
  models,
  board,
  deals,
  hovered,
  burst,
  tier,
}: {
  models: Models
  board: Placement
  deals: number
  hovered: LineName | null
  burst: RefObject<number>
  tier: Tier
}) {
  const wires = useMemo<Wire[]>(() => {
    const hub = new THREE.Vector3(NOW_X, HUB_Y, 0.06).applyMatrix4(boardMatrix(board))
    // Out of the board toward the viewer and well down first, so no line runs behind it, even
    // where the board turns far round on a narrow screen.
    const out = new THREE.Vector3(Math.sin(board.turn), -1.6, Math.cos(board.turn)).multiplyScalar(3.4)
    const reach = (to: THREE.Vector3) => {
      const across = to.clone().sub(hub).setY(0)
      return new THREE.CubicBezierCurve3(
        hub.clone(),
        hub.clone().add(out).addScaledVector(across, 0.2),
        to.clone().add(new THREE.Vector3(0, Math.max(1.6, (hub.y - to.y) * 0.4), 0)),
        to,
      )
    }
    const made: Wire[] = [
      { name: 'deals', curve: reach(DEALS_AT.clone().add(new THREE.Vector3(deals, 0, 0))) },
      { name: 'outlook', curve: reach(OUTLOOK_AT.clone()) },
      { name: 'rack', curve: reach(new THREE.Vector3(RACK_X, 2.4 * RACK_SCALE, 0)) },
      ...STEPS.map((step, index) => ({
        name: index,
        curve: reach(lampOf(models[step.model]).multiplyScalar(MACHINE_SCALE).add(new THREE.Vector3(step.x, 0.15, 0))),
      })),
      { name: 'dock', curve: reach(DOCK_AT.clone()) },
    ]
    return made
  }, [board, models, deals])
  const points = useMemo(() => wires.map((wire) => wire.curve.getPoints(48)), [wires])
  const lights = useRef<THREE.InstancedMesh>(null)
  const glows = useRef<THREE.InstancedMesh>(null)
  const glow = useTexture(drawGlow)
  const camera = useThree((state) => state.camera)
  useFrame(({ clock }) => {
    if (!lights.current || !glows.current) return
    const time = sceneTime(clock)
    const running = pulsesAt(time)
    const since = time - (burst.current ?? -Infinity)
    if (since >= 0 && since < PULSE) for (const wire of wires) running.push({ line: wire.name, u: since / PULSE })
    let count = 0
    for (const pulse of running) {
      const wire = wires.find((item) => item.name === pulse.line)
      if (!wire || count >= 24) continue
      const u = Math.min(1, Math.max(0, pulse.u))
      // Word from the deals and the outlook comes in toward the point; the rest goes out from it.
      const at = wire.curve.getPointAt(INBOUND.includes(wire.name) ? 1 - u : u)
      // Grows in as it leaves and shrinks as it arrives.
      const size = Math.sin(Math.PI * u) ** 0.4
      lights.current.setMatrixAt(count, matrix.compose(at, turned.identity(), sized.setScalar(Math.max(0.001, size))))
      glows.current.setMatrixAt(count, matrix.compose(at, camera.quaternion, sized.setScalar(Math.max(0.001, size * 1.7))))
      count++
    }
    lights.current.count = count
    glows.current.count = tier === 'full' ? count : 0
    lights.current.instanceMatrix.needsUpdate = true
    glows.current.instanceMatrix.needsUpdate = true
  })
  return (
    <group>
      {wires.map((wire, index) => {
        const lit = hovered === wire.name
        return (
          <Line
            key={String(wire.name)}
            points={points[index]}
            color={lit ? COLORS.accent : COLORS.wire}
            lineWidth={lit ? 2.8 : 1.9}
          />
        )
      })}
      <instancedMesh ref={glows} args={[undefined, undefined, 24]} frustumCulled={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={glow} color={COLORS.accent} transparent opacity={0.45} depthWrite={false} />
      </instancedMesh>
      <instancedMesh ref={lights} args={[undefined, undefined, 24]} frustumCulled={false}>
        <sphereGeometry args={[0.17, 14, 10]} />
        <meshBasicMaterial color={COLORS.accent} />
      </instancedMesh>
    </group>
  )
}
