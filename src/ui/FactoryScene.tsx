import { Html, OrthographicCamera, useCursor, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import type { FloorLot, FloorMachine, MachineState } from '../engine/floor'
import type { Part } from '../engine/types'
import type { FactoryLayout, MachineModel, PlacedMachine } from './factoryLayout'
import { modelUrl } from './factoryModels'

// Colors from the page's tokens, so the floor follows light and dark like the rest of the app.
export type FactoryColors = {
  floor: string
  zone: string
  zoneLine: string
  zoneText: string
  ok: string
  tight: string
  late: string
  material: string
  carton: string
  selected: string
  // A furnace's window while it heats.
  heat: string
  states: Record<MachineState, string>
}

type Props = {
  // The element the names and lots over the floor are put in: the canvas's own box.
  labels: RefObject<HTMLElement | null>
  layout: FactoryLayout
  floor: Map<string, FloorMachine>
  parts: Part[]
  colors: FactoryColors
  selected: string | null
  onSelect: (equipmentId: string | null) => void
  reducedMotion: boolean
  // Whether the floor is on screen; off screen nothing is redrawn.
  visible: boolean
  // Called with a function that zooms the floor round the middle of the view.
  onZoomReady: (zoomBy: (factor: number) => void) => void
  // Told whether the floor is zoomed all the way out or in, as it changes.
  onZoomLimit: (limit: ZoomLimit) => void
}

export type ZoomLimit = 'out' | 'in' | null

// The camera looks from a little left of the front and above, so the floor, longer along the
// flow than deep, stays wide across the canvas.
const VIEW = new THREE.Vector3(-0.28, 0.95, 1).normalize()
const CAMERA_AT = VIEW.clone().multiplyScalar(80).toArray()
// Narrower than this, names stand over the chosen machine only, so they do not pile up.
const LABELS_FIT = 690
// How often the floor is redrawn while machines run: smooth enough for their motion, light enough
// to leave the rest of the page alone.
const PULSE_MS = 33
// A welding arc: blue-white, brighter than anything else on the floor.
const ARC = '#DCEBFF'

export default function FactoryScene({
  labels,
  layout,
  floor,
  parts,
  colors,
  selected,
  onSelect,
  reducedMotion,
  visible,
  onZoomReady,
  onZoomLimit,
}: Props) {
  const offset = -layout.width / 2
  // The canvas draws only when something changes, or while a running machine's lamp breathes on screen.
  const pulse = visible && !reducedMotion && [...floor.values()].some((machine) => machine.state === 'running')
  return (
    <Canvas flat shadows="percentage" frameloop="demand" dpr={[1, 2]} onPointerMissed={() => onSelect(null)}>
      <hemisphereLight args={['#ffffff', '#b8b4a8', 1.9]} />
      <directionalLight
        castShadow
        position={[-18, 30, 22]}
        intensity={1.6}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-layout.width / 2 - 4}
        shadow-camera-right={layout.width / 2 + 4}
        shadow-camera-top={layout.depth}
        shadow-camera-bottom={-layout.depth}
        shadow-bias={-0.0005}
      />
      <View layout={layout} reducedMotion={reducedMotion} onZoomReady={onZoomReady} onZoomLimit={onZoomLimit} />
      {pulse && <Pulse />}
      {/* Everything appears at once when the models have loaded, labels included. */}
      <Suspense fallback={null}>
        <LabelLayer.Provider value={labels}>
          <group position={[offset, 0, 0]}>
            <Ground layout={layout} colors={colors} />
            {layout.machines.map((placed) => (
              <Machine
                key={placed.equipment.id}
                placed={placed}
                state={floor.get(placed.equipment.id)}
                colors={colors}
                selected={selected === placed.equipment.id}
                onSelect={onSelect}
                breathing={pulse}
              />
            ))}
            <Store x={layout.material.x} zs={layout.material.zs} depth={layout.depth} parts={parts} kind="material" colors={colors} />
            <Store x={layout.finished.x} zs={layout.finished.zs} depth={layout.depth} parts={parts} kind="finished" colors={colors} />
          </group>
        </LabelLayer.Provider>
      </Suspense>
    </Canvas>
  )
}

// Asks for a frame now and then while a lamp breathes.
function Pulse() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    const timer = window.setInterval(() => invalidate(), PULSE_MS)
    return () => window.clearInterval(timer)
  }, [invalidate])
  return null
}

// The zoom at which the whole floor and the machines on it fit the canvas: the corners of the
// floor, and of a box 3 m high over it, seen from the camera.
function useFitZoom(layout: FactoryLayout) {
  const size = useThree((state) => state.size)
  return useMemo(() => {
    const forward = VIEW.clone().negate()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const up = new THREE.Vector3().crossVectors(right, forward)
    const across: number[] = []
    const down: number[] = []
    for (const x of [-layout.width / 2, layout.width / 2])
      for (const z of [-layout.depth / 2, layout.depth / 2])
        for (const y of [0, 3]) {
          const corner = new THREE.Vector3(x, y, z)
          across.push(corner.dot(right))
          down.push(corner.dot(up))
        }
    const width = Math.max(...across) - Math.min(...across)
    const height = Math.max(...down) - Math.min(...down)
    return Math.min(size.width / (width * 1.08), size.height / (height * 1.1))
  }, [layout, size])
}

type PinchInternals = {
  _handleTouchMoveDolly(event: PointerEvent): void
  _getSecondPointerPosition(event: PointerEvent): THREE.Vector2
  _updateZoomParameters(x: number, y: number): void
}
const orbitPinch = OrbitControls.prototype as unknown as PinchInternals

// three.js's controls aim a pinch at the fingers' midpoint in page coordinates but compare it with
// the canvas's place on the screen, so once the page has scrolled a pinch zoomed beside the
// fingers. These aim it at the midpoint on the screen.
class FloorControls extends OrbitControls {}
;(FloorControls.prototype as unknown as PinchInternals)._handleTouchMoveDolly = function (this: PinchInternals, event) {
  orbitPinch._handleTouchMoveDolly.call(this, event)
  const other = this._getSecondPointerPosition(event)
  this._updateZoomParameters((event.pageX + other.x) / 2 - window.scrollX, (event.pageY + other.y) / 2 - window.scrollY)
}

// Keeps the point the camera looks at where the floor fills the view: the further in, the
// further from the middle it may go, and at the whole floor it is the middle. The camera moves
// with it, so the view only slides.
function keepOnFloor(controls: OrbitControls, fit: number, layout: FactoryLayout) {
  const camera = controls.object as THREE.OrthographicCamera
  const reach = Math.max(0, 1 - fit / camera.zoom)
  const { target } = controls
  const goal = new THREE.Vector3(
    THREE.MathUtils.clamp(target.x, (-layout.width / 2) * reach, (layout.width / 2) * reach),
    0,
    THREE.MathUtils.clamp(target.z, (-layout.depth / 2) * reach, (layout.depth / 2) * reach),
  )
  const shift = goal.sub(target)
  if (shift.lengthSq() < 1e-8) return
  target.add(shift)
  camera.position.add(shift)
}

// The camera and how it moves: turned with a mouse drag, zoomed toward the pointer with the wheel
// (⌘ or Ctrl held, see FactoryView) or toward the fingers with a pinch, never out past the whole
// floor and never panned. One finger on a touch screen scrolls the page. three.js's own controls,
// which zoom a pinch toward the fingers.
function View({
  layout,
  reducedMotion,
  onZoomReady,
  onZoomLimit,
}: {
  layout: FactoryLayout
  reducedMotion: boolean
  onZoomReady: (zoomBy: (factor: number) => void) => void
  onZoomLimit: (limit: ZoomLimit) => void
}) {
  const fit = useFitZoom(layout)
  const camera = useThree((state) => state.camera)
  const element = useThree((state) => (state.events.connected ?? state.gl.domElement) as HTMLElement)
  const invalidate = useThree((state) => state.invalidate)
  const controls = useRef<OrbitControls | null>(null)

  useEffect(() => {
    const made = new FloorControls(camera, element)
    made.enablePan = false
    made.zoomToCursor = true
    made.screenSpacePanning = false
    made.rotateSpeed = 0.6
    made.minPolarAngle = 0.35
    made.maxPolarAngle = 1.25
    made.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_PAN }
    controls.current = made
    return () => {
      made.dispose()
      controls.current = null
    }
  }, [camera, element])

  // Limits follow the canvas's size; a new size starts from the whole floor in the middle.
  useEffect(() => {
    const made = controls.current
    if (!made) return
    made.enableDamping = !reducedMotion
    made.minZoom = fit
    made.maxZoom = fit * 4
    const view = made.object as THREE.OrthographicCamera
    view.zoom = fit
    view.updateProjectionMatrix()
    made.target.set(0, 0, 0)
    view.position.set(...CAMERA_AT)
    made.update()
    const onChange = () => {
      keepOnFloor(made, fit, layout)
      const zoom = (made.object as THREE.OrthographicCamera).zoom
      onZoomLimit(zoom <= made.minZoom * 1.001 ? 'out' : zoom >= made.maxZoom * 0.999 ? 'in' : null)
      invalidate()
    }
    made.addEventListener('change', onChange)
    onZoomReady((factor) => {
      view.zoom = THREE.MathUtils.clamp(view.zoom * factor, made.minZoom, made.maxZoom)
      view.updateProjectionMatrix()
      onChange()
      made.update()
    })
    onZoomLimit('out')
    invalidate()
    return () => made.removeEventListener('change', onChange)
  }, [fit, layout, reducedMotion, invalidate, camera, element, onZoomReady, onZoomLimit])

  // Damping eases a turn out over a few frames, each asked for by the change it makes.
  useFrame(() => {
    controls.current?.update()
  })

  return <OrthographicCamera makeDefault position={CAMERA_AT} zoom={fit} near={1} far={400} />
}

const LabelLayer = createContext<RefObject<HTMLElement | null> | null>(null)

// A name or a lot over the floor, kept in the canvas's box, so each label has its place in the
// page from the start.
function Label(props: ComponentProps<typeof Html>) {
  const layer = useContext(LabelLayer)
  // The layer is mounted before the canvas draws anything, so its element is there.
  return <Html {...props} portal={(layer ?? undefined) as RefObject<HTMLElement> | undefined} />
}

function Ground({ layout, colors }: { layout: FactoryLayout; colors: FactoryColors }) {
  return (
    <group>
      {/* The floor and the crews' areas in their own colors, with shadows laid over them. */}
      <mesh rotation-x={-Math.PI / 2} position={[layout.width / 2, 0, 0]}>
        <planeGeometry args={[layout.width + 2, layout.depth + 2]} />
        <meshBasicMaterial color={colors.floor} />
      </mesh>
      {layout.zones.map((zone) => (
        <group key={zone.name || 'none'}>
          <mesh rotation-x={-Math.PI / 2} position={[(zone.x0 + zone.x1) / 2, 0.004, 0]}>
            <planeGeometry args={[zone.x1 - zone.x0 - 0.4, layout.depth - 0.4]} />
            <meshBasicMaterial color={colors.zoneLine} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[(zone.x0 + zone.x1) / 2, 0.006, 0]}>
            <planeGeometry args={[zone.x1 - zone.x0 - 0.56, layout.depth - 0.56]} />
            <meshBasicMaterial color={colors.zone} />
          </mesh>
          {zone.name && <FloorText text={zone.name} color={colors.zoneText} position={[zone.x0 + 0.5, 0.03, layout.depth / 2 - 0.85]} />}
        </group>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[layout.width / 2, 0.02, 0]} receiveShadow>
        <planeGeometry args={[layout.width + 2, layout.depth + 2]} />
        <shadowMaterial opacity={0.14} depthWrite={false} />
      </mesh>
    </group>
  )
}

// A name painted on the floor, reading left to right from its left end, 0.9 m high.
function FloorText({ text, color, position }: { text: string; color: string; position: [number, number, number] }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    const font = `500 96px ${getComputedStyle(document.body).getPropertyValue('--mantine-font-family-headings')}`
    context.font = font
    canvas.width = Math.ceil(context.measureText(text).width) + 16
    canvas.height = 128
    context.font = font
    context.fillStyle = color
    context.textBaseline = 'middle'
    context.fillText(text, 8, 64)
    const made = new THREE.CanvasTexture(canvas)
    made.colorSpace = THREE.SRGBColorSpace
    made.anisotropy = 4
    return made
  }, [text, color])
  useEffect(() => () => texture.dispose(), [texture])
  const width = (texture.image.width / texture.image.height) * 0.9
  return (
    <mesh rotation-x={-Math.PI / 2} position={[position[0] + width / 2, position[1], position[2]]}>
      <planeGeometry args={[width, 0.9]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  )
}

// A part that moves while its machine runs: role is what the model names it, move_<role>.
type MovingPart = { role: string; node: THREE.Object3D }

// A copy of a model, casting shadows. A machine's lamp takes the color of its state, lit
// unless the machine is free or off; the copied lamp goes when the copy does. The parts that
// move while it runs are taken out of the copy, where they stood, to be moved each through
// its own element, with the tip of a welding torch and a furnace's window found by name.
function useModel(name: MachineModel | 'pallet' | 'material_rack', lamp?: { color: string; lit: boolean }) {
  const { scene } = useGLTF(modelUrl(name), false)
  const color = lamp?.color
  const lit = lamp?.lit ?? false
  const made = useMemo(() => {
    const copy = scene.clone(true)
    const lamps: THREE.Material[] = []
    copy.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return
      object.castShadow = true
      object.receiveShadow = true
      if (color && object.material.name === 'lamp') {
        const material = object.material.clone() as THREE.MeshStandardMaterial
        material.color.set(color)
        material.emissive.set(lit ? color : '#000000')
        material.emissiveIntensity = 0.9
        object.material = material
        lamps.push(material)
      }
    })
    copy.updateMatrixWorld(true)
    const tipNode = copy.getObjectByName('tip_torch')
    const tip = tipNode ? tipNode.position.clone() : null
    const glass = copy.getObjectByName('glow_window')
    const heat = glass ? new THREE.Box3().setFromObject(glass) : null
    // The outermost move_<role> of each part, with what hangs under it.
    const moving: MovingPart[] = []
    const collect = (object: THREE.Object3D) => {
      if (object.name.startsWith('move_')) moving.push({ role: object.name.slice('move_'.length), node: object })
      else object.children.forEach(collect)
    }
    collect(copy)
    for (const part of moving) {
      part.node.matrixWorld.decompose(part.node.position, part.node.quaternion, part.node.scale)
      part.node.removeFromParent()
    }
    return { copy, lamps, moving, tip, heat }
  }, [scene, color, lit])
  useEffect(() => () => made.lamps.forEach((material) => material.dispose()), [made])
  return made
}

const LIT: MachineState[] = ['running', 'setup', 'stopped']

function Machine({
  placed,
  state,
  colors,
  selected,
  onSelect,
  breathing,
}: {
  placed: PlacedMachine
  state: FloorMachine | undefined
  colors: FactoryColors
  selected: boolean
  onSelect: (equipmentId: string) => void
  breathing: boolean
}) {
  const machineState = state?.state ?? 'idle'
  const { copy: model, moving, tip, heat } = useModel(placed.model, { color: colors.states[machineState], lit: LIT.includes(machineState) })
  const working = breathing && machineState === 'running'
  // Each machine keeps its own beat, so a row of the same machines does not move in step.
  const phase = useMemo(() => [...placed.equipment.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7, [placed])
  const height = useMemo(() => new THREE.Box3().setFromObject(model).max.y, [model])
  const lampAt = useMemo(() => {
    let found: THREE.Vector3 | null = null
    model.traverse((object) => {
      if (object instanceof THREE.Mesh && object.material.name === 'lamp') {
        found = new THREE.Box3().setFromObject(object).getCenter(new THREE.Vector3())
      }
    })
    return found as THREE.Vector3 | null
  }, [model])
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const wide = useThree((three) => three.size.width) >= LABELS_FIT

  // Round a running machine's lamp, a glow breathes.
  const glow = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = 0.18 + 0.17 * Math.sin(clock.getElapsedTime() * 2.4)
  })

  const waiting = state?.waiting ?? []
  const shown = waiting.slice(0, 3)
  return (
    <group
      position={[placed.x, 0, placed.z]}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(placed.equipment.id)
      }}
      onPointerOver={(event) => {
        event.stopPropagation()
        setHovered(true)
      }}
      onPointerOut={() => setHovered(false)}
    >
      <primitive object={model} />
      {moving.map(({ role, node }) => (
        <MovingNode key={role} role={role} node={node} working={working} phase={phase}>
          {role === 'arm' && tip && working && <Arc position={tip} />}
        </MovingNode>
      ))}
      {heat && working && <Heat box={heat} color={colors.heat} />}
      {lampAt && machineState === 'running' && breathing && (
        <mesh position={lampAt}>
          <sphereGeometry args={[0.18, 16, 12]} />
          <meshBasicMaterial ref={glow} color={colors.states.running} transparent depthWrite={false} />
        </mesh>
      )}
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
          <ringGeometry args={[1.85, 2.0, 64]} />
          <meshBasicMaterial color={colors.selected} />
        </mesh>
      )}
      {/* Inside the crew's area, clear of the machine's guards in front and the lots waiting. */}
      {state?.current && <LotStack lot={state.current} position={[1.4, 0, 1.52]} scale={0.85} colors={colors} />}
      {shown.map((lot, index) => (
        <LotStack key={lot.lotId} lot={lot} position={[(index - (shown.length - 1) / 2) * 1.3, 0, 2.55]} colors={colors} />
      ))}
      {/* The chosen machine names the lots waiting for it, in the order it takes them. */}
      {selected && waiting.length > 0 && (
        <Label position={[0, 0.9, 3.0]} center className="factory-tag factory-queue" zIndexRange={[60, 50]}>
          {waiting.map((lot) => (
            <span key={lot.lotId} className={`tone-${lot.tone}`}>
              {lot.lotId}
            </span>
          ))}
        </Label>
      )}
      {(wide || selected) && (
        <Label
          position={[0, height + 0.5, 0]}
          center
          className={`factory-label${selected ? ' is-selected' : ''}`}
          // The chosen machine's name and lots stand over every other name.
          zIndexRange={selected ? [60, 50] : [30, 0]}
        >
          <span className="factory-label-name">
            <span className={`factory-dot state-${machineState}`} />
            {placed.equipment.name}
          </span>
          {state?.current && <span className={`factory-label-lot tone-${state.current.tone}`}>{state.current.lotId}</span>}
          {waiting.length > shown.length && <span className="factory-label-more">＋{waiting.length - shown.length}</span>}
        </Label>
      )}
    </group>
  )
}

// How each moving part goes while its machine runs, from where it was made; at t = 0 every part
// is back where it was made, as it is on a machine that does not run.
function move(role: string, part: THREE.Object3D, t: number) {
  const turn = (period: number) => (t / period) * Math.PI * 2
  // 0, then 1 halfway through the period, then 0 again.
  const stroke = (period: number) => (1 - Math.cos(turn(period))) / 2
  switch (role) {
    case 'ram':
      part.position.y -= 0.18 * stroke(2.4)
      break
    case 'arm':
      part.rotation.y += 0.2 * Math.sin(turn(3.2))
      break
    case 'magazine':
      part.rotation.x += turn(9)
      break
    case 'head':
      part.position.y -= 0.24 * stroke(4)
      break
    case 'table':
      part.position.x += 0.28 * Math.sin(turn(2.2))
      break
    case 'spindle':
      part.position.y -= 0.12 * stroke(1.6)
      break
    case 'bridge':
      part.position.z += 0.19 * Math.sin(turn(3))
      break
    case 'carton':
      part.position.x += ((t / 3) % 1) * 1.25
      break
  }
}

function MovingNode({
  role,
  node,
  working,
  phase,
  children,
}: {
  role: string
  node: THREE.Object3D
  working: boolean
  phase: number
  children?: ReactNode
}) {
  const part = useRef<THREE.Object3D>(null)
  const rest = useMemo(() => ({ position: node.position.clone(), rotation: node.rotation.clone() }), [node])
  useFrame(({ clock }) => {
    if (!part.current) return
    part.current.position.copy(rest.position)
    part.current.rotation.copy(rest.rotation)
    move(role, part.current, working ? clock.getElapsedTime() + phase : 0)
  })
  return (
    <primitive object={node} ref={part}>
      {children}
    </primitive>
  )
}

// The arc at a welding torch's tip, flickering.
function Arc({ position }: { position: THREE.Vector3 }) {
  const light = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    if (light.current) light.current.opacity = Math.sin(clock.getElapsedTime() * 31) > -0.2 ? 0.95 : 0.2
  })
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.07, 12, 8]} />
      <meshBasicMaterial ref={light} color={ARC} transparent depthWrite={false} />
    </mesh>
  )
}

// A furnace's window glowing as it heats.
function Heat({ box, color }: { box: THREE.Box3; color: string }) {
  const light = useRef<THREE.MeshBasicMaterial>(null)
  const center = useMemo(() => box.getCenter(new THREE.Vector3()), [box])
  const size = useMemo(() => box.getSize(new THREE.Vector3()).addScalar(0.06), [box])
  useFrame(({ clock }) => {
    if (light.current) light.current.opacity = 0.8 + 0.2 * Math.sin(clock.getElapsedTime() * 1.6)
  })
  return (
    <mesh position={center}>
      <boxGeometry args={[size.x, size.y, size.z]} />
      <meshBasicMaterial ref={light} color={color} transparent depthWrite={false} />
    </mesh>
  )
}

// A lot on a pallet: a carton for every 15 pieces or part of them, up to eight, in the color
// its order has on the Gantt chart.
function LotStack({
  lot,
  position,
  scale = 0.9,
  colors,
}: {
  lot: FloorLot
  position: [number, number, number]
  scale?: number
  colors: FactoryColors
}) {
  const pallet = useModel('pallet').copy
  const cartons = Math.min(8, Math.max(1, Math.ceil(lot.quantity / 15)))
  const color = lot.tone === 'late' ? colors.late : lot.tone === 'tight' ? colors.tight : colors.ok
  return (
    <group position={position} scale={scale}>
      <primitive object={pallet} />
      {Array.from({ length: cartons }, (_, index) => {
        const layer = Math.floor(index / 4)
        const spot = index % 4
        return (
          <mesh key={index} position={[(spot % 2) * 0.52 - 0.26, 0.37 + layer * 0.42, Math.floor(spot / 2) * 0.52 - 0.26]} castShadow receiveShadow>
            <boxGeometry args={[0.48, 0.4, 0.48]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
        )
      })}
    </group>
  )
}

// Material on the left and finished goods on the right: one pallet a part, the stack as high as
// the pieces on hand, with the part and how many where the canvas is wide enough.
function Store({
  x,
  zs,
  depth,
  parts,
  kind,
  colors,
}: {
  x: number
  zs: number[]
  depth: number
  parts: Part[]
  kind: 'material' | 'finished'
  colors: FactoryColors
}) {
  const rack = useModel('material_rack').copy
  const wide = useThree((three) => three.size.width) >= LABELS_FIT
  const most = Math.max(1, ...parts.map((part) => (kind === 'material' ? (part.materialStock ?? 0) : part.stock)))
  return (
    <group position={[x, 0, 0]}>
      <primitive object={rack} position={[0, 0, -depth / 2 + 0.7]} />
      {parts.map((part, index) => {
        const pieces = kind === 'material' ? (part.materialStock ?? 0) : part.stock
        const layers = pieces > 0 ? Math.max(1, Math.round((pieces / most) * 4)) : 0
        return (
          <group key={part.partNumber} position={[0, 0, zs[index]]}>
            <StorePallet layers={layers} color={kind === 'material' ? colors.material : colors.carton} />
            {wide && (
              <Label position={[0, 0.15, 0.85]} center className="factory-tag" zIndexRange={[20, 0]}>
                {part.partNumber} {pieces.toLocaleString('ja-JP')}個{kind === 'material' ? '分' : ''}
              </Label>
            )}
          </group>
        )
      })}
    </group>
  )
}

function StorePallet({ layers, color }: { layers: number; color: string }) {
  const pallet = useModel('pallet').copy
  return (
    <group>
      <primitive object={pallet} />
      {layers > 0 && (
        <mesh position={[0, 0.15 + layers * 0.21, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.0, layers * 0.42, 1.0]} />
          <meshStandardMaterial color={color} roughness={0.75} />
        </mesh>
      )}
    </group>
  )
}
