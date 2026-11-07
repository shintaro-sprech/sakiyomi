import { Html, OrthographicCamera, useCursor, useGLTF } from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import {
  createContext,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

import type { FloorLot, FloorMachine, MachineState } from '../engine/floor'
import type { Part } from '../engine/types'
import {
  CARD_REACH,
  cardPlace,
  cartonsOf,
  forkliftAt,
  LOT_SCALE,
  namePlaces,
  overlaps,
  pileSpots,
  RUNNING_SPOT,
  stockKey,
  type FactoryLayout,
  type LoadSpot,
  type MachineModel,
  type NameSpot,
  type PlacedMachine,
  type Rect,
  type StoreKind,
} from './factoryLayout'
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
  // A machine's id, or a store's pallet as stockKey gives it.
  selected: string | null
  onSelect: (key: string | null) => void
  // What the chosen machine's card says, put beside the machine; none while the card is shown
  // under the floor instead, on a narrow screen.
  card: ReactNode
  reducedMotion: boolean
  // Whether the floor is on screen; off screen nothing is redrawn.
  visible: boolean
  // Called with a function that zooms the floor round the middle of the view.
  onZoomReady: (zoomBy: (factor: number) => void) => void
  // Called with a function that slides a zoomed-in view toward a point of the floor.
  onLookReady: (lookAt: (x: number, z: number) => void) => void
  // Told whether the floor is zoomed all the way out or in, as it changes.
  onZoomLimit: (limit: ZoomLimit) => void
}

export type ZoomLimit = 'out' | 'in' | null

type Model = MachineModel | 'pallet' | 'material_rack' | 'rack_stock' | 'carton_stock' | 'forklift'

// The building, painted as the models are (scripts/models/build_models.py).
const HALL = {
  wall: '#E2DED4',
  steel: '#ADABA3',
  window: '#AEBFCA',
  slab: '#CBC7BD',
  tube: '#FFE6BF',
  tubeOff: '#9C988E',
  cabinet: '#B9B5AA',
  drawer: '#8E8B82',
  sign: '#FFFFFF',
  ink: '#3D3D3A',
  // A worker: dark work clothes and a white cap, so a person reads at a glance on the pale floor.
  clothes: '#46505A',
  skin: '#E2C4A6',
  cap: '#F7F6F2',
}
const WALL_HEIGHT = 4.2
const SLAB = 0.35
// An arrow painted on the aisle: how far it runs along the aisle and how far across.
const ARROW = { length: 0.6, reach: 1.1 }
const ARROW_STROKE = Math.hypot(ARROW.length, ARROW.reach / 2)
const ARROW_TURN = Math.atan2(ARROW.reach / 2, ARROW.length)

// The camera looks from the front-left and above. On a wide canvas it stands nearly in front, so
// the floor, longer along the flow than deep, fills the width; on a squarer one it turns further
// round, and the floor runs from corner to corner and fills the height as well.
const ELEVATION = 0.74
function viewFor(aspect: number) {
  const turn = THREE.MathUtils.clamp((2.3 - aspect) / (2.3 - 1.0), 0, 1)
  const azimuth = THREE.MathUtils.lerp(0.28, 0.8, turn)
  return new THREE.Vector3(-Math.sin(azimuth) * Math.cos(ELEVATION), Math.sin(ELEVATION), Math.cos(azimuth) * Math.cos(ELEVATION))
}
const CAMERA_DISTANCE = 80
// How much of the floor's names are shown, by how many pixels a meter of floor takes: every
// machine's name; only those of machines with a lot on them, with the lot; or only the chosen
// machine's, so names never pile up. Zooming in shows more.
type Detail = 'all' | 'lots' | 'chosen'
const detailAt = (zoom: number): Detail => (zoom >= 26 ? 'all' : zoom >= 17 ? 'lots' : 'chosen')
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
  card,
  reducedMotion,
  visible,
  onZoomReady,
  onLookReady,
  onZoomLimit,
}: Props) {
  const offset = -layout.width / 2
  const [detail, setDetail] = useState<Detail>('all')
  // What the machines and the crews' signs tell the layout of the names over the floor.
  const [board] = useState<NameBoard>(() => ({ machines: new Map(), signs: new Set() }))
  // The canvas draws only when something changes, or while machines run on screen; the
  // forklift runs then too.
  const pulse = visible && !reducedMotion && [...floor.values()].some((machine) => machine.state === 'running')
  return (
    <Canvas flat shadows="percentage" frameloop="demand" dpr={[1, 2]} onPointerMissed={() => onSelect(null)}>
      <hemisphereLight args={['#ffffff', '#b8b4a8', 1.9]} />
      <directionalLight
        castShadow
        position={[-18, 30, 22]}
        intensity={1.6}
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-layout.width / 2 - 6}
        shadow-camera-right={layout.width / 2 + 6}
        shadow-camera-top={layout.depth + 4}
        shadow-camera-bottom={-layout.depth - 4}
        shadow-bias={-0.0005}
      />
      <View
        layout={layout}
        reducedMotion={reducedMotion}
        onZoomReady={onZoomReady}
        onLookReady={onLookReady}
        onZoomLimit={onZoomLimit}
        onDetail={setDetail}
      />
      {pulse && <Pulse />}
      {/* Everything appears at once when the models have loaded, labels included. */}
      <Suspense fallback={null}>
        <LabelLayer.Provider value={labels}>
          <NameBoardContext.Provider value={board}>
            <group position={[offset, 0, 0]}>
              <Hall layout={layout} floor={floor} colors={colors} />
              {layout.machines.map((placed) => (
                <Machine
                  key={placed.equipment.id}
                  placed={placed}
                  state={floor.get(placed.equipment.id)}
                  colors={colors}
                  selected={selected === placed.equipment.id}
                  onSelect={onSelect}
                  card={selected === placed.equipment.id ? card : null}
                  breathing={pulse}
                  detail={detail}
                />
              ))}
              <Store kind="material" layout={layout} parts={parts} colors={colors} selected={selected} onSelect={onSelect} />
              <Store kind="finished" layout={layout} parts={parts} colors={colors} selected={selected} onSelect={onSelect} />
              <Forklift layout={layout} moving={pulse} />
            </group>
            {/* After the names and tags, so each frame it sees them where they now stand; the
                chosen machine's card, opened later, sees the names where this puts them. */}
            <NameLayout layout={layout} board={board} />
          </NameBoardContext.Provider>
        </LabelLayer.Provider>
      </Suspense>
    </Canvas>
  )
}

// Asks for a frame now and then while machines run.
function Pulse() {
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    const timer = window.setInterval(() => invalidate(), PULSE_MS)
    return () => window.clearInterval(timer)
  }, [invalidate])
  return null
}

// The camera's direction for the canvas, and the zoom at which the whole floor fits it: the
// slab's corners, a box 3 m high over the floor for the machines and their names, and the tops
// of the walls at the back and the right.
function useFraming(layout: FactoryLayout) {
  const size = useThree((state) => state.size)
  return useMemo(() => {
    const view = viewFor(size.width / Math.max(1, size.height))
    const forward = view.clone().negate()
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
    const up = new THREE.Vector3().crossVectors(right, forward)
    const half = layout.width / 2
    const points: THREE.Vector3[] = []
    for (const x of [-half - 0.3, half + 0.3])
      for (const z of [layout.back - 0.3, layout.front]) for (const y of [-SLAB, 3]) points.push(new THREE.Vector3(x, y, z))
    for (const [x, z] of [
      [-half, layout.back],
      [half, layout.back],
      [half, layout.front],
    ])
      points.push(new THREE.Vector3(x, WALL_HEIGHT, z))
    const across = points.map((point) => point.dot(right))
    const down = points.map((point) => point.dot(up))
    const width = Math.max(...across) - Math.min(...across)
    const height = Math.max(...down) - Math.min(...down)
    // The middle of what is seen goes to the middle of the canvas; the camera looks at the point
    // of the floor behind it, so the controls turn the view round a point on the floor.
    const middle = right
      .clone()
      .multiplyScalar((Math.max(...across) + Math.min(...across)) / 2)
      .addScaledVector(up, (Math.max(...down) + Math.min(...down)) / 2)
    const center = middle.addScaledVector(forward, -middle.y / forward.y)
    return { view, center, zoom: Math.min(size.width / (width * 1.04), size.height / (height * 1.06)) }
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
// further from the middle of the floor it may go, and at the whole floor it is where the
// framing puts it. The camera moves with it, so the view only slides.
function keepOnFloor(controls: OrbitControls, fit: number, home: THREE.Vector3, layout: FactoryLayout) {
  const camera = controls.object as THREE.OrthographicCamera
  const reach = Math.max(0, 1 - fit / camera.zoom)
  const { target } = controls
  const goal = new THREE.Vector3(
    THREE.MathUtils.clamp(target.x, THREE.MathUtils.lerp(home.x, -layout.width / 2, reach), THREE.MathUtils.lerp(home.x, layout.width / 2, reach)),
    0,
    THREE.MathUtils.clamp(target.z, THREE.MathUtils.lerp(home.z, layout.back, reach), THREE.MathUtils.lerp(home.z, layout.front, reach)),
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
  onLookReady,
  onZoomLimit,
  onDetail,
}: {
  layout: FactoryLayout
  reducedMotion: boolean
  onZoomReady: (zoomBy: (factor: number) => void) => void
  onLookReady: (lookAt: (x: number, z: number) => void) => void
  onZoomLimit: (limit: ZoomLimit) => void
  onDetail: (detail: Detail) => void
}) {
  const framing = useFraming(layout)
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

  // Limits follow the canvas's size; a new size starts from the whole floor.
  useEffect(() => {
    const made = controls.current
    if (!made) return
    const { view: direction, center, zoom: fit } = framing
    made.enableDamping = !reducedMotion
    made.minZoom = fit
    made.maxZoom = fit * 4
    const view = made.object as THREE.OrthographicCamera
    view.zoom = fit
    view.updateProjectionMatrix()
    made.target.copy(center)
    view.position.copy(center).addScaledVector(direction, CAMERA_DISTANCE)
    made.update()
    const onChange = () => {
      keepOnFloor(made, fit, center, layout)
      const zoom = (made.object as THREE.OrthographicCamera).zoom
      onZoomLimit(zoom <= made.minZoom * 1.001 ? 'out' : zoom >= made.maxZoom * 0.999 ? 'in' : null)
      onDetail(detailAt(zoom))
      invalidate()
    }
    made.addEventListener('change', onChange)
    onZoomReady((factor) => {
      view.zoom = THREE.MathUtils.clamp(view.zoom * factor, made.minZoom, made.maxZoom)
      view.updateProjectionMatrix()
      onChange()
      made.update()
    })
    // As far toward the point as the zoom lets the view go; at the whole floor it stays put.
    onLookReady((x, z) => {
      const shift = new THREE.Vector3(x - made.target.x, 0, z - made.target.z)
      made.target.add(shift)
      view.position.add(shift)
      onChange()
      made.update()
    })
    onZoomLimit('out')
    onDetail(detailAt(fit))
    invalidate()
    return () => made.removeEventListener('change', onChange)
  }, [framing, layout, reducedMotion, invalidate, camera, element, onZoomReady, onLookReady, onZoomLimit, onDetail])

  // Damping eases a turn out over a few frames, each asked for by the change it makes.
  useFrame(() => {
    controls.current?.update()
  })

  return (
    <OrthographicCamera
      makeDefault
      position={framing.view.clone().multiplyScalar(CAMERA_DISTANCE).toArray()}
      zoom={framing.zoom}
      near={1}
      far={400}
    />
  )
}

const LabelLayer = createContext<RefObject<HTMLElement | null> | null>(null)

// A name or a lot over the floor, kept in the canvas's box, so each label has its place in the
// page from the start.
function Label(props: ComponentProps<typeof Html>) {
  const layer = useContext(LabelLayer)
  // The layer is mounted before the canvas draws anything, so its element is there.
  return <Html {...props} portal={(layer ?? undefined) as RefObject<HTMLElement> | undefined} />
}

// What a machine tells the layout of the names over the floor: its place on the floor, the box
// round it and its moving parts, how high the point just over it is (where drei puts its name's
// corner), its lots' loads, its name on the page while it shows one, and whether it is chosen and
// whether a lot runs on it.
type NameEntry = {
  machine: THREE.Object3D
  body: THREE.Box3
  top: number
  loads: THREE.Box3[]
  name: RefObject<HTMLElement | null>
  chosen: boolean
  lot: boolean
}

// The machines by their ids, and the crews' signs on the back wall, which names keep off too.
type NameBoard = { machines: Map<string, NameEntry>; signs: Set<THREE.Object3D> }

const NameBoardContext = createContext<NameBoard | null>(null)

const IDENTITY = new THREE.Matrix4()

type StageSize = { width: number; height: number }
const onStagePoint = new THREE.Vector3()
// Where a point of the floor, placed by a matrix, shows on the stage, in pixels from its top left.
function stagePoint(place: THREE.Matrix4, x: number, y: number, z: number, camera: THREE.Camera, size: StageSize): [number, number] {
  onStagePoint.set(x, y, z).applyMatrix4(place).project(camera)
  return [((onStagePoint.x + 1) / 2) * size.width, ((1 - onStagePoint.y) / 2) * size.height]
}
// The corners of a box of the floor, placed by a matrix, on the stage.
function stageCorners({ min, max }: THREE.Box3, place: THREE.Matrix4, camera: THREE.Camera, size: StageSize): [number, number][] {
  return [min.x, max.x].flatMap((x) => [min.y, max.y].flatMap((y) => [min.z, max.z].map((z) => stagePoint(place, x, y, z, camera, size))))
}

// Lays the machines' names out in each frame drawn (see namePlaces): each stands on the point just
// over its machine, beside that point or under the machine's front, clear of every load, tag,
// crew's sign and other name, or gives way; the chosen machine's name always shows, clear of its
// machine where it can, and the tags under it give way. A name's place is a shift by the
// translate property, which leaves drei its transform.
function NameLayout({ layout, board }: { layout: FactoryLayout; board: NameBoard }) {
  const layer = useContext(LabelLayer)
  // The shift last given to each name, so a frame that moves nothing writes nothing to the page.
  const [shifts] = useState(() => new WeakMap<HTMLElement, string>())
  useFrame(({ camera, size }) => {
    const frame = layer?.current
    if (!frame) return
    // Everything is read from the page before anything is written to it, so it is laid out once.
    const origin = frame.getBoundingClientRect()
    const local = (item: Element): Rect => {
      const box = item.getBoundingClientRect()
      return { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }
    }
    const tagElements = [...frame.querySelectorAll<HTMLElement>('.factory-tag')]
    const tags = tagElements.map(local)
    // The clock and the zoom buttons.
    const over = [...(frame.parentElement?.querySelectorAll('[data-over-floor]') ?? [])].map(local)
    const machines = layout.machines.flatMap((placed) => {
      const entry = board.machines.get(placed.equipment.id)
      return entry ? [{ id: placed.equipment.id, entry }] : []
    })
    const named = machines.flatMap(({ id, entry }) => {
      const element = entry.name.current
      return element?.isConnected ? [{ id, entry, element, width: element.offsetWidth, height: element.offsetHeight }] : []
    })
    camera.updateMatrixWorld()
    const onStage = (place: THREE.Matrix4, x: number, y: number, z: number) => stagePoint(place, x, y, z, camera, size)
    const cornersOf = (box: THREE.Box3, place: THREE.Matrix4) => stageCorners(box, place, camera, size)
    const loads: LoadSpot[] = machines.flatMap(({ id, entry }) => {
      entry.machine.updateWorldMatrix(true, false)
      return entry.loads.map((box) => ({ machine: id, corners: cornersOf(box, entry.machine.matrixWorld) }))
    })
    const signs = [...board.signs].map((sign) => {
      sign.updateWorldMatrix(true, false)
      return cornersOf(new THREE.Box3().setFromObject(sign), IDENTITY)
    })
    const names: NameSpot[] = named.map(({ id, entry, width, height }) => ({
      machine: id,
      top: onStage(entry.machine.matrixWorld, 0, entry.top, 0),
      foot: onStage(entry.machine.matrixWorld, 0, 0, entry.body.max.z),
      body: cornersOf(entry.body, entry.machine.matrixWorld),
      width,
      height,
      chosen: entry.chosen,
      lot: entry.lot,
    }))
    const { places, hiddenTags } = namePlaces({ names, loads, tags, signs, avoid: over, stage: { width: size.width, height: size.height } })
    // drei puts each name's corner on the point just over its machine; the shift takes it from there.
    named.forEach(({ element }, index) => {
      const place = places[index]
      if (place !== null) {
        const [x, y] = names[index].top
        const translate = `${(place.x - x).toFixed(1)}px ${(place.y - y).toFixed(1)}px`
        if (shifts.get(element) !== translate) {
          element.style.translate = translate
          shifts.set(element, translate)
        }
      }
      element.toggleAttribute('data-crowded', place === null)
    })
    tagElements.forEach((tag, index) => tag.toggleAttribute('data-crowded', hiddenTags.includes(index)))
  })
  return null
}

// A box by its size and the middle of its bottom face, and a strip of paint on the floor by its
// middle, its length and width, and how far it turns from running along x.
type Box = { size: [number, number, number]; at: [number, number, number] }
type Strip = { x: number; z: number; length: number; width: number; turn?: number }

// Many boxes or strips of one color are drawn as one mesh, so the floor costs few draws a frame.
function useMerged<T>(items: T[], shape: (item: T) => THREE.BufferGeometry) {
  const key = JSON.stringify(items)
  const geometry = useMemo(() => {
    const parts = (JSON.parse(key) as T[]).map(shape)
    const merged = parts.length > 0 ? mergeGeometries(parts) : null
    parts.forEach((part) => part.dispose())
    return merged
  }, [key, shape])
  useEffect(() => () => geometry?.dispose(), [geometry])
  return geometry
}

const boxShape = ({ size, at }: Box) => new THREE.BoxGeometry(...size).translate(at[0], at[1] + size[1] / 2, at[2])
const stripShape = ({ x, z, length, width, turn = 0 }: Strip) =>
  new THREE.PlaneGeometry(length, width)
    .rotateX(-Math.PI / 2)
    .rotateY(turn)
    .translate(x, 0, z)
const strip = (x0: number, x1: number, z0: number, z1: number): Strip => ({ x: (x0 + x1) / 2, z: (z0 + z1) / 2, length: x1 - x0, width: z1 - z0 })

function Boxes({ boxes, color, shadow = true, glow = false }: { boxes: Box[]; color: string; shadow?: boolean; glow?: boolean }) {
  const geometry = useMerged(boxes, boxShape)
  if (!geometry) return null
  return (
    <mesh geometry={geometry} castShadow={shadow} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.85} emissive={glow ? color : '#000000'} emissiveIntensity={glow ? 0.9 : 0} />
    </mesh>
  )
}

function Paint({ strips, color, y = 0.008 }: { strips: Strip[]; color: string; y?: number }) {
  const geometry = useMerged(strips, stripShape)
  if (!geometry) return null
  return (
    <mesh geometry={geometry} position-y={y}>
      <meshBasicMaterial color={color} />
    </mesh>
  )
}

// The building round the floor: the slab, the crews' areas and the main aisle painted on it, the
// wall at the back with its columns, windows and lights, and the wall at the right with the
// door the goods leave by. The lights over a crew's area are on while anyone in it is at work.
function Hall({ layout, floor, colors }: { layout: FactoryLayout; floor: Map<string, FloorMachine>; colors: FactoryColors }) {
  const { width, back, front, aisle } = layout
  const aisleBack = aisle.z - aisle.width / 2
  const aisleFront = aisle.z + aisle.width / 2
  const door = aisleBack - 0.4
  const lit = (ids: string[]) => ids.some((id) => (floor.get(id)?.state ?? 'off') !== 'off')
  const anyLit = lit([...floor.keys()])
  // Columns stand at the ends and where one area meets the next.
  const columns = [...new Set([0, ...layout.zones.map((zone) => zone.x0), layout.zones.at(-1)?.x1 ?? width, width])]
  // A light over each machine's place, and one over each store.
  const lights = [
    ...layout.zones.flatMap((zone) => {
      const count = Math.round((zone.x1 - zone.x0) / 4)
      return Array.from({ length: count }, (_, index) => ({ x: zone.x0 + ((index + 0.5) * (zone.x1 - zone.x0)) / count, on: lit(zone.equipmentIds) }))
    }),
    ...[layout.material, layout.finished].map((store) => ({ x: (store.x0 + store.x1) / 2, on: anyLit })),
  ]
  const fixture = (x: number): Box => ({ size: [1.7, 0.12, 0.26], at: [x, 3.68, back + 1.15] })
  // Tool cabinets against the back wall, between the machines of an area.
  const cabinets = layout.zones.flatMap((zone) => {
    const count = Math.round((zone.x1 - zone.x0) / 4)
    return Array.from({ length: count + 1 }, (_, index) => zone.x0 + (index * (zone.x1 - zone.x0)) / count + (index === 0 ? 0.75 : index === count ? -0.75 : 0))
  })
  // Arrows down the aisle, from material toward finished goods: two strokes meeting at the tip.
  const arrows = Array.from({ length: Math.max(0, Math.floor((width - 6) / 5)) }, (_, index) => 3.5 + index * 5 + ((width - 7) % 5) / 2)
  const paint: Strip[] = [
    ...[aisleBack, aisleFront].map((z) => strip(0.3, width - 0.3, z - 0.04, z + 0.04)),
    ...arrows.flatMap((x) =>
      [-1, 1].map((side) => ({ x, z: aisle.z + (side * ARROW.reach) / 4, length: ARROW_STROKE, width: 0.14, turn: side * ARROW_TURN })),
    ),
  ]
  const windows: Box[] = [
    ...columns.slice(0, -1).flatMap((x0, index): Box[] => {
      const x1 = columns[index + 1]
      return x1 - x0 < 1.2 ? [] : [{ size: [x1 - x0 - 0.9, 0.7, 0.02], at: [(x0 + x1) / 2, 2.95, back + 0.01] }]
    }),
    { size: [0.02, 0.7, door - back - 1.4], at: [width - 0.01, 2.95, (back + door) / 2] },
  ]
  return (
    <group>
      {/* The slab, its top the floor's color, its edges showing the cut. */}
      <mesh position={[width / 2, -SLAB / 2 - 0.002, (back - 0.3 + front) / 2]} receiveShadow>
        <boxGeometry args={[width + 0.6, SLAB, front - back + 0.3]} />
        <meshStandardMaterial color={HALL.slab} roughness={0.9} />
      </mesh>
      <Paint strips={[strip(-0.3, width + 0.3, back - 0.3, front)]} color={colors.floor} y={0} />
      <Paint strips={layout.zones.map((zone) => strip(zone.x0 + 0.12, zone.x1 - 0.12, back + 0.12, aisleBack - 0.12))} color={colors.zoneLine} y={0.004} />
      <Paint strips={layout.zones.map((zone) => strip(zone.x0 + 0.2, zone.x1 - 0.2, back + 0.2, aisleBack - 0.2))} color={colors.zone} y={0.006} />
      <Paint strips={paint} color={colors.zoneLine} />
      <mesh rotation-x={-Math.PI / 2} position={[width / 2, 0.02, (back + front) / 2]} receiveShadow>
        <planeGeometry args={[width + 0.6, front - back + 0.3]} />
        <shadowMaterial opacity={0.14} depthWrite={false} />
      </mesh>
      {/* The walls at the back and the right, the right one open where the aisle meets it: the
          door the goods leave by. */}
      <Boxes
        color={HALL.wall}
        boxes={[
          { size: [width + 0.6, WALL_HEIGHT, 0.25], at: [width / 2, 0, back - 0.125] },
          { size: [0.25, WALL_HEIGHT, door - back], at: [width + 0.125, 0, (back + door) / 2] },
          { size: [0.25, WALL_HEIGHT - 3.3, front - door], at: [width + 0.125, 3.3, (door + front) / 2] },
        ]}
      />
      <Boxes color={HALL.window} boxes={windows} shadow={false} />
      <Boxes
        color={HALL.steel}
        boxes={[
          ...columns.map((x): Box => ({ size: [0.34, WALL_HEIGHT, 0.34], at: [THREE.MathUtils.clamp(x, 0.17, width - 0.17), 0, back + 0.17] })),
          { size: [width + 0.6, 0.22, 0.3], at: [width / 2, WALL_HEIGHT - 0.22, back + 0.15] },
          ...lights.map(({ x }): Box => ({ size: [0.06, 0.06, 1.2], at: [x, 3.86, back + 0.6] })),
          { size: [0.3, 3.3, 0.3], at: [width + 0.1, 0, door + 0.15] },
          { size: [0.3, 3.3, 0.3], at: [width + 0.1, 0, front - 0.15] },
        ]}
      />
      <mesh position={[width + 0.02, 3.12, (door + front) / 2]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.18, 0.18, front - door - 0.3, 16]} />
        <meshStandardMaterial color={HALL.steel} roughness={0.6} />
      </mesh>
      <Boxes color={HALL.tube} glow boxes={lights.filter((light) => light.on).map(({ x }) => fixture(x))} shadow={false} />
      <Boxes color={HALL.tubeOff} boxes={lights.filter((light) => !light.on).map(({ x }) => fixture(x))} shadow={false} />
      <Boxes color={HALL.cabinet} boxes={cabinets.map((x): Box => ({ size: [0.9, 1.15, 0.5], at: [x, 0, back + 0.42] }))} />
      <Boxes
        color={HALL.drawer}
        shadow={false}
        boxes={cabinets.flatMap((x) => [0.3, 0.6, 0.9].map((y): Box => ({ size: [0.78, 0.03, 0.01], at: [x, y, back + 0.675] })))}
      />
      {layout.zones.map((zone) => zone.name && <Sign key={zone.name} text={zone.name} position={[zone.x0 + 0.45, 2.15, back + 0.01]} />)}
    </group>
  )
}

// A crew's sign on the back wall over its area, which the names over the floor keep off.
function Sign({ text, position }: { text: string; position: [number, number, number] }) {
  const board = useContext(NameBoardContext)
  const self = useRef<THREE.Mesh>(null)
  useLayoutEffect(() => {
    const sign = self.current
    if (!board || !sign) return
    board.signs.add(sign)
    return () => {
      board.signs.delete(sign)
    }
  }, [board])
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    const font = `600 88px ${getComputedStyle(document.body).getPropertyValue('--mantine-font-family-headings')}`
    context.font = font
    canvas.width = Math.ceil(context.measureText(text).width) + 72
    canvas.height = 136
    context.fillStyle = HALL.sign
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.lineWidth = 6
    context.strokeStyle = HALL.ink
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6)
    context.font = font
    context.fillStyle = HALL.ink
    context.textBaseline = 'middle'
    context.fillText(text, 36, 70)
    const made = new THREE.CanvasTexture(canvas)
    made.colorSpace = THREE.SRGBColorSpace
    made.anisotropy = 4
    return made
  }, [text])
  useEffect(() => () => texture.dispose(), [texture])
  const height = 0.8
  const width = (texture.image.width / texture.image.height) * height
  return (
    <mesh ref={self} position={[position[0] + width / 2, position[1], position[2]]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={texture} />
    </mesh>
  )
}

// A name painted on the floor, reading left to right from its left end.
function FloorText({ text, color, position, height }: { text: string; color: string; position: [number, number, number]; height: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')!
    const font = `600 96px ${getComputedStyle(document.body).getPropertyValue('--mantine-font-family-monospace')}`
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
  const width = (texture.image.width / texture.image.height) * height
  return (
    <mesh rotation-x={-Math.PI / 2} position={[position[0] + width / 2, position[1], position[2]]}>
      <planeGeometry args={[width, height]} />
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
function useModel(name: Model, lamp?: { color: string; lit: boolean }) {
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
// Someone stands at a machine that runs or is being set up.
const ATTENDED: MachineState[] = ['running', 'setup']

function Machine({
  placed,
  state,
  colors,
  selected,
  onSelect,
  card,
  breathing,
  detail,
}: {
  placed: PlacedMachine
  state: FloorMachine | undefined
  colors: FactoryColors
  selected: boolean
  onSelect: (key: string) => void
  card: ReactNode
  breathing: boolean
  detail: Detail
}) {
  const machineState = state?.state ?? 'idle'
  const { copy: model, moving, tip, heat } = useModel(placed.model, { color: colors.states[machineState], lit: LIT.includes(machineState) })
  const working = breathing && machineState === 'running'
  // Each machine keeps its own beat, so a row of the same machines does not move in step.
  const phase = useMemo(() => [...placed.equipment.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 7, [placed])
  // How high the machine stands, and the box round it with the parts that move, which stand
  // apart from the model until they are drawn.
  const height = useMemo(() => new THREE.Box3().setFromObject(model).max.y, [model])
  const bounds = useMemo(
    () => moving.reduce((box, { node }) => box.union(new THREE.Box3().setFromObject(node)), new THREE.Box3().setFromObject(model)),
    [model, moving],
  )
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
  // A chosen machine's card names it, standing beside it; with the card under the floor, the name
  // stays over the machine to show which one the card is about.
  const named = selected ? !card : detail === 'all' || (detail === 'lots' && Boolean(state?.current))
  // The point just over the machine, where its name stands.
  const top = height + 0.15

  // Round a running machine's lamp, a glow breathes.
  const glow = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    if (glow.current) glow.current.opacity = 0.18 + 0.17 * Math.sin(clock.getElapsedTime() * 2.4)
  })

  const current = state?.current ?? null
  const waiting = state?.waiting ?? EMPTY
  // The lot on the machine at its front right, the lots waiting for it in front of it.
  const lots = useMemo(
    () => [
      ...(current ? [{ lot: current, ...RUNNING_SPOT }] : []),
      ...pileSpots(waiting.length).map((spot, index) => ({ lot: waiting[index], ...spot })),
    ],
    [current, waiting],
  )
  // What the card keeps clear of: the machine with the person at its front, and its lots.
  const keep = useMemo(() => {
    const body = new THREE.Box3(new THREE.Vector3(-1.5, 0, -1.15), new THREE.Vector3(1.5, height, 1.45))
    if (lots.length === 0) return [body]
    const xs = lots.map((item) => item.x)
    const zs = lots.map((item) => item.z)
    const load = new THREE.Box3(
      new THREE.Vector3(Math.min(...xs) - LOT_HALF, 0, Math.min(...zs) - LOT_HALF),
      new THREE.Vector3(Math.max(...xs) + LOT_HALF, LOAD_HEIGHT, Math.max(...zs) + LOT_HALF),
    )
    return [body, load]
  }, [lots, height])

  // The machine, its lots' loads and its name, for the layout of the names (NameLayout). A
  // name's size is known once it is on the page and changes with what it says; each time, the
  // names are laid out again.
  const board = useContext(NameBoardContext)
  const invalidate = useThree((three) => three.invalidate)
  const self = useRef<THREE.Group>(null)
  const nameElement = useRef<HTMLDivElement | null>(null)
  const attachName = useCallback(
    (node: HTMLDivElement | null) => {
      nameElement.current = node
      if (!node) return
      const watch = new ResizeObserver(() => invalidate())
      watch.observe(node)
      return () => {
        watch.disconnect()
        nameElement.current = null
      }
    },
    [invalidate],
  )
  const loads = useMemo(
    () =>
      lots.map(({ lot, x, z }) => {
        const highest = lotCarton(cartonsOf(lot.quantity) - 1, x, z)
        return new THREE.Box3(new THREE.Vector3(x - LOT_HALF, 0, z - LOT_HALF), new THREE.Vector3(x + LOT_HALF, highest.at[1] + highest.size[1], z + LOT_HALF))
      }),
    [lots],
  )
  const id = placed.equipment.id
  const running = Boolean(current)
  useLayoutEffect(() => {
    if (!board || !self.current) return
    board.machines.set(id, { machine: self.current, body: bounds, top, loads, name: nameElement, chosen: selected, lot: running })
    invalidate()
    return () => {
      board.machines.delete(id)
      invalidate()
    }
  }, [board, id, bounds, top, loads, selected, running, invalidate])

  return (
    <group
      ref={self}
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
      {ATTENDED.includes(machineState) && <Worker position={[-1.15, 0, 1.25]} />}
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
          <ringGeometry args={[1.85, 2.0, 64]} />
          <meshBasicMaterial color={colors.selected} />
        </mesh>
      )}
      {/* Inside the crew's area, clear of the machine's guards in front and the person at it. */}
      <Load lots={lots} colors={colors} />
      {/* Its name stands on the point just over the machine, its lamp in sight below, or beside
          that point or under the machine where a load or a tag is in the way (NameLayout). */}
      {named && (
        <Label
          ref={attachName}
          position={[0, top, 0]}
          className={`factory-label${selected ? ' is-selected' : ''}`}
          // The chosen machine's name stands over every other name.
          zIndexRange={selected ? [60, 50] : [30, 0]}
        >
          <span className="factory-label-name">
            <span className={`factory-dot state-${machineState}`} />
            {placed.equipment.name}
          </span>
          {current && <span className={`factory-label-lot tone-${current.tone}`}>{current.lotId}</span>}
        </Label>
      )}
      {selected && card && (
        <Card id={id} keep={keep}>
          {card}
        </Card>
      )}
    </group>
  )
}

const EMPTY: FloorLot[] = []
const LOT_HALF = (1.1 * LOT_SCALE) / 2
// The top of the highest load of cartons.
const LOAD_HEIGHT = 0.95

// The chosen machine's card, beside the machine and its lots where it covers least of the rest of
// the floor (see cardPlace). It takes the pointer, so a press on it keeps the choice.
function Card({ id, keep, children }: { id: string; keep: THREE.Box3[]; children: ReactNode }) {
  const layer = useContext(LabelLayer)
  const board = useContext(NameBoardContext)
  const invalidate = useThree((state) => state.invalidate)
  const element = useRef<HTMLDivElement | null>(null)
  // The card's size is known only once its content is on the page, after it was first placed;
  // it is placed again whenever its size changes.
  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node
      if (!node) return
      const watch = new ResizeObserver(() => invalidate())
      watch.observe(node)
      return () => watch.disconnect()
    },
    [invalidate],
  )
  // While the card is open, the names and tags it would cut across give way as a whole, rather
  // than showing a piece from under it. This runs after the card has been placed in the frame,
  // and after the names have been (NameLayout).
  useFrame(() => {
    const own = element.current?.getBoundingClientRect()
    const frame = layer?.current
    if (!own || !frame) return
    const origin = frame.getBoundingClientRect()
    const card = {
      x: own.x - origin.x - CARD_REACH,
      y: own.y - origin.y - CARD_REACH,
      width: own.width + 2 * CARD_REACH,
      height: own.height + 2 * CARD_REACH,
    }
    for (const item of frame.querySelectorAll('.factory-label:not(.is-selected), .factory-tag:not(.is-selected)')) {
      const box = item.getBoundingClientRect()
      item.classList.toggle('is-covered', overlaps(card, { x: box.x - origin.x, y: box.y - origin.y, width: box.width, height: box.height }))
    }
  })
  useEffect(() => {
    const frame = layer?.current
    return () => frame?.querySelectorAll('.is-covered').forEach((item) => item.classList.remove('is-covered'))
  }, [layer])
  // Called each frame drawn, so the card follows the view as it turns or zooms.
  const place = (group: THREE.Object3D, camera: THREE.Camera, size: StageSize) => {
    // The machine and its lots on the screen, corner by corner, and the box round them.
    const corners = keep.flatMap((box) => stageCorners(box, group.matrixWorld, camera, size))
    const left = Math.min(...corners.map(([x]) => x))
    const right = Math.max(...corners.map(([x]) => x))
    const top = Math.min(...corners.map(([, y]) => y))
    const bottom = Math.max(...corners.map(([, y]) => y))
    // What the stage shows over the floor, the clock and the zoom buttons, in the same pixels.
    const frame = layer?.current
    const origin = frame?.getBoundingClientRect()
    const local = (item: Element): Rect => {
      const box = item.getBoundingClientRect()
      return { x: box.x - (origin?.x ?? 0), y: box.y - (origin?.y ?? 0), width: box.width, height: box.height }
    }
    const avoid = [...(frame?.parentElement?.querySelectorAll('[data-over-floor]') ?? [])].map(local)
    // The rest of the floor: the other machines and their lots, the crews' signs, and the names and
    // tags on show, those under the card included, since they come back once it moves off them.
    const others = [...(board?.machines ?? [])].flatMap(([key, entry]) => (key === id ? [] : [entry]))
    const shown = (selector: string) => [...(frame?.querySelectorAll(`${selector}:not([data-crowded])`) ?? [])].map(local)
    const cover = {
      lots: others.flatMap(({ machine, loads }) => loads.map((box) => stageCorners(box, machine.matrixWorld, camera, size))),
      tags: shown('.factory-tag'),
      solids: [
        ...others.map(({ machine, body }) => stageCorners(body, machine.matrixWorld, camera, size)),
        ...[...(board?.signs ?? [])].map((sign) => stageCorners(new THREE.Box3().setFromObject(sign), IDENTITY, camera, size)),
      ],
      names: shown('.factory-label:not(.is-selected)'),
    }
    const card = { width: element.current?.offsetWidth ?? 0, height: element.current?.offsetHeight ?? 0 }
    const { x, y } = cardPlace({ x: left, y: top, width: right - left, height: bottom - top }, card, size, avoid, cover)
    return [x, y]
  }
  return (
    <Label
      ref={attach}
      calculatePosition={place}
      className="factory-card"
      // Over every name and tag on the floor.
      zIndexRange={[80, 70]}
    >
      {children}
    </Label>
  )
}

// A person at a machine, turned toward it.
function Worker({ position }: { position: [number, number, number] }) {
  return (
    <group position={position} rotation-y={Math.PI * 0.8}>
      <Boxes
        color={HALL.clothes}
        boxes={[
          { size: [0.14, 0.84, 0.18], at: [-0.1, 0, 0] },
          { size: [0.14, 0.84, 0.18], at: [0.1, 0, 0] },
          { size: [0.44, 0.62, 0.26], at: [0, 0.82, 0] },
        ]}
      />
      <mesh position={[0, 1.58, 0]} castShadow>
        <sphereGeometry args={[0.14, 14, 10]} />
        <meshStandardMaterial color={HALL.skin} roughness={0.8} />
      </mesh>
      <mesh position={[0, 1.66, 0]} castShadow>
        <sphereGeometry args={[0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={HALL.cap} roughness={0.6} />
      </mesh>
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

// Lots on pallets, each with its cartons (see cartonsOf) in the color its order has on the Gantt
// chart. The pallets are drawn as one mesh and the cartons of a color as another, so a long
// queue costs no more draws than a short one.
function Load({ lots, colors }: { lots: { lot: FloorLot; x: number; z: number }[]; colors: FactoryColors }) {
  const { scene } = useGLTF(modelUrl('pallet'), false)
  // The pallet's one mesh and where it stands in its model, which scales its packed positions.
  const pallet = useMemo(() => {
    scene.updateMatrixWorld(true)
    let found: THREE.Mesh | null = null
    scene.traverse((object) => {
      if (!found && object instanceof THREE.Mesh) found = object
    })
    return found as THREE.Mesh | null
  }, [scene])
  const pallets = useRef<THREE.InstancedMesh>(null)
  const invalidate = useThree((state) => state.invalidate)
  const places = JSON.stringify(lots.map(({ x, z }) => [x, z]))
  useLayoutEffect(() => {
    const mesh = pallets.current
    if (!mesh || !pallet) return
    const matrix = new THREE.Matrix4()
    ;(JSON.parse(places) as [number, number][]).forEach(([x, z], index) => {
      mesh.setMatrixAt(index, matrix.makeScale(LOT_SCALE, LOT_SCALE, LOT_SCALE).setPosition(x, 0, z).multiply(pallet.matrixWorld))
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingBox()
    mesh.computeBoundingSphere()
    invalidate()
  }, [places, pallet, invalidate])
  const cartons = (tone: FloorLot['tone']) =>
    lots
      .filter(({ lot }) => lot.tone === tone)
      .flatMap(({ lot, x, z }) => Array.from({ length: cartonsOf(lot.quantity) }, (_, index) => lotCarton(index, x, z)))
  if (!pallet || lots.length === 0) return null
  return (
    <group>
      <instancedMesh ref={pallets} args={[pallet.geometry, pallet.material, lots.length]} castShadow receiveShadow />
      <Boxes color={colors.ok} boxes={cartons('ok')} />
      <Boxes color={colors.tight} boxes={cartons('tight')} />
      <Boxes color={colors.late} boxes={cartons('late')} />
    </group>
  )
}

// The index-th carton of a lot's pallet standing at x, z: two to a layer, each layer laid across
// the one under it, as cartons are stacked on a pallet.
function lotCarton(index: number, x: number, z: number): Box {
  const layer = Math.floor(index / 2)
  const side = ((index % 2) - 0.5) * 0.54
  const across = layer % 2 === 0
  const size: [number, number, number] = across ? [0.52, 0.2, 1.06] : [1.06, 0.2, 0.52]
  return {
    size: size.map((length) => length * LOT_SCALE) as [number, number, number],
    at: [x + (across ? side : 0) * LOT_SCALE, (0.145 + layer * 0.21) * LOT_SCALE, z + (across ? 0 : side) * LOT_SCALE],
  }
}

// Material at the left and finished goods at the right: a rack of stock against the back wall,
// a stack of empty pallets by the aisle, and each part's pallet on its own marked place with the
// part number painted beside it, the stack as high as the pieces on hand. A part with none has
// a red tag; the chosen pallet says how many.
function Store({
  kind,
  layout,
  parts,
  colors,
  selected,
  onSelect,
}: {
  kind: StoreKind
  layout: FactoryLayout
  parts: Part[]
  colors: FactoryColors
  selected: string | null
  onSelect: (key: string) => void
}) {
  const store = layout[kind]
  const rack = useModel('material_rack').copy
  const stock = useModel(kind === 'material' ? 'rack_stock' : 'carton_stock').copy
  const spare = useModel('pallet').copy
  const spares = useMemo(() => [spare, spare.clone(true), spare.clone(true)], [spare])
  const pieces = (part: Part) => (kind === 'material' ? (part.materialStock ?? 0) : part.stock)
  const most = Math.max(1, ...parts.map(pieces))
  const outward = kind === 'material' ? -1 : 1
  const inner = kind === 'material' ? store.x1 : store.x0
  return (
    <group>
      <group position={[(store.x0 + store.x1) / 2, 0, layout.back + 0.6]}>
        <primitive object={rack} />
        <primitive object={stock} />
      </group>
      <group position={[inner + outward * 1.3, 0, layout.aisle.z - layout.aisle.width / 2 - 0.75]}>
        {spares.map((copy, index) => (
          <primitive key={index} object={copy} position={[0, index * 0.145, 0]} />
        ))}
      </group>
      <Paint strips={store.spots.flatMap((spot) => placeMark(spot.x, spot.z))} color={colors.zoneLine} />
      {parts.map((part, index) => (
        <StorePlace
          key={part.partNumber}
          kind={kind}
          part={part}
          count={pieces(part)}
          most={most}
          spot={store.spots[index]}
          colors={colors}
          chosen={selected === stockKey(kind, part.partNumber)}
          onSelect={onSelect}
        />
      ))}
    </group>
  )
}

// One part's place in a store: its marked place, its number painted beside it, and its stack,
// which can be chosen to say how many pieces it holds.
function StorePlace({
  kind,
  part,
  count,
  most,
  spot,
  colors,
  chosen,
  onSelect,
}: {
  kind: StoreKind
  part: Part
  count: number
  most: number
  spot: { x: number; z: number }
  colors: FactoryColors
  chosen: boolean
  onSelect: (key: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  useCursor(hovered)
  const empty = count <= 0
  return (
    <group position={[spot.x, 0, spot.z]}>
      <FloorText text={part.partNumber} color={colors.zoneText} height={0.5} position={[-2.3, 0.012, 0]} />
      <group
        onClick={(event) => {
          event.stopPropagation()
          onSelect(stockKey(kind, part.partNumber))
        }}
        onPointerOver={(event) => {
          event.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <StoreStack kind={kind} share={count / most} colors={colors} />
        {/* The whole place takes the pointer, an empty pallet as much as a full one. */}
        <mesh position={[0, 0.6, 0]}>
          <boxGeometry args={[1.3, 1.2, 1.3]} />
          <meshBasicMaterial visible={false} />
        </mesh>
      </group>
      {chosen && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
          <ringGeometry args={[0.85, 0.95, 48]} />
          <meshBasicMaterial color={colors.selected} />
        </mesh>
      )}
      {(empty || chosen) && (
        <Label
          position={[0, 0.15, 0.85]}
          center
          className={`factory-tag${empty ? ' is-empty' : ''}${chosen ? ' is-selected' : ''}`}
          // An empty pallet's tag stands over the machines' names.
          zIndexRange={chosen ? [60, 50] : [40, 31]}
        >
          {part.partNumber} {count.toLocaleString('ja-JP')}個{kind === 'material' ? '分' : ''}
        </Label>
      )}
    </group>
  )
}

// The lines that mark a pallet's place on the floor, round its middle.
function placeMark(x: number, z: number): Strip[] {
  const half = 0.68
  return [-half, half].flatMap((at) => [strip(x - half - 0.03, x + half + 0.03, z + at - 0.03, z + at + 0.03), strip(x + at - 0.03, x + at + 0.03, z - half, z + half)])
}

// A part's stock on its pallet: plates of steel for material, cartons for finished goods, as
// high as its share of the fullest part's.
function StoreStack({ kind, share, colors }: { kind: StoreKind; share: number; colors: FactoryColors }) {
  const pallet = useModel('pallet').copy
  const count = share > 0 ? Math.max(1, Math.round(share * 16)) : 0
  if (kind === 'material') {
    const plate = (index: number): Box => ({ size: [1.02, 0.07, 1.02], at: [((index % 3) - 1) * 0.015, 0.145 + index * 0.075, ((index % 2) - 0.5) * 0.02] })
    const plates = Array.from({ length: count }, (_, index) => index)
    return (
      <group>
        <primitive object={pallet} />
        <Boxes color={HALL.steel} boxes={plates.filter((index) => index % 2 === 0).map(plate)} />
        <Boxes color={colors.material} boxes={plates.filter((index) => index % 2 === 1).map(plate)} />
      </group>
    )
  }
  return (
    <group>
      <primitive object={pallet} />
      <Boxes color={colors.carton} boxes={Array.from({ length: count }, (_, index) => carton(index, 0.5, 0.145))} />
    </group>
  )
}

// The index-th carton of a stack on a pallet, four to a layer.
function carton(index: number, size: number, base: number): Box {
  const layer = Math.floor(index / 4)
  const spot = index % 4
  return { size: [size, 0.4, size], at: [(spot % 2) * 0.52 - 0.26, base + layer * 0.42, Math.floor(spot / 2) * 0.52 - 0.26] }
}

// The forklift's tires, about this far from axle to floor.
const FORKLIFT_WHEEL = 0.3

// Sets the forks and their load at a height over where they rest, and turns wheels whose axles
// run across.
function rise(parts: [THREE.Object3D | null, number][], height: number) {
  for (const [part, rest] of parts) if (part) part.position.y = rest + height
}
function spin(wheels: THREE.Object3D[], angle: number) {
  for (const wheel of wheels) wheel.rotation.x = angle
}

// The forklift on the main aisle with a stack of empty pallets. It runs while machines run;
// otherwise it stands at the far end, by the door, clear of the stores' tags. Its round is read off the page's own clock, so it never jumps back when the drawing pauses.
function Forklift({ layout, moving }: { layout: FactoryLayout; moving: boolean }) {
  const { copy } = useModel('forklift')
  const pallet = useModel('pallet').copy
  const load = useMemo(() => [pallet, pallet.clone(true), pallet.clone(true)], [pallet])
  const lift = useMemo(() => copy.getObjectByName('lift') ?? null, [copy])
  const wheels = useMemo(
    () =>
      ['front_left', 'front_right', 'rear_left', 'rear_right']
        .map((side) => copy.getObjectByName(`wheel_${side}`))
        .filter((wheel): wheel is THREE.Object3D => Boolean(wheel)),
    [copy],
  )
  const liftRest = useMemo(() => lift?.position.y ?? 0, [lift])
  const body = useRef<THREE.Group>(null)
  const carried = useRef<THREE.Group>(null)
  // From the material store's edge to the finished goods', the body's back clear of each end.
  const start = layout.material.x1 - 1.2
  const run = layout.finished.x0 + 0.6 - start
  useFrame(() => {
    if (!body.current) return
    const { x, lift: raise } = moving ? forkliftAt(performance.now() / 1000, run) : { x: run, lift: 0 }
    body.current.position.x = start + x
    rise(
      [
        [lift, liftRest],
        [carried.current, 0],
      ],
      raise,
    )
    spin(wheels, (start + x) / FORKLIFT_WHEEL)
  })
  return (
    <group ref={body} position={[start + run, 0, layout.aisle.z]} rotation-y={Math.PI / 2}>
      <primitive object={copy} />
      <group ref={carried}>
        {load.map((item, index) => (
          <primitive key={index} object={item} position={[0, 0.06 + index * 0.145, 0.62]} />
        ))}
      </group>
    </group>
  )
}
