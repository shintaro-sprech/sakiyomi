import { crewOfEquipment } from '../engine/crews'
import type { Equipment, PlantData } from '../engine/types'

// The machine models in public/models, made by scripts/models/build.mjs.
export type MachineModel =
  | 'cutter'
  | 'press_brake'
  | 'welding_robot'
  | 'machining_center'
  | 'furnace'
  | 'grinder'
  | 'drill_press'
  | 'inspection_table'
  | 'packing_table'
  | 'generic_machine'

// A machine looks like what its first process does; a process with another name gets a plain machine.
const MODELS: [RegExp, MachineModel][] = [
  [/切断|シャー|レーザ/, 'cutter'],
  [/曲げ|ベンド/, 'press_brake'],
  [/溶接/, 'welding_robot'],
  [/切削|マシニング|旋盤|フライス|タップ/, 'machining_center'],
  [/熱処理|焼入|焼鈍|炉/, 'furnace'],
  [/研削|研磨/, 'grinder'],
  [/穴あけ|ドリル|ボール盤/, 'drill_press'],
  [/検査|測定/, 'inspection_table'],
  [/梱包|包装/, 'packing_table'],
]

export function modelOf(equipment: Equipment): MachineModel {
  const process = equipment.processes[0] ?? ''
  return MODELS.find(([pattern]) => pattern.test(process))?.[1] ?? 'generic_machine'
}

// Meters. x runs along the flow from material on the left to finished goods on the right,
// z toward the viewer, from the back wall to the front edge of the floor. Each machine faces
// the viewer with the lot it runs beside it and the lots waiting for it in front of it.
export const CELL = 4.0

// A lot stands on a pallet drawn at this share of a real one (1.1 m square), the same for every
// lot on the floor, so their heights compare from one machine to the next.
export const LOT_SCALE = 0.85
const LOT_PALLET = 1.1 * LOT_SCALE
// Relative to a machine's middle: the lot it runs stands at its front right, clear of the
// person at its front left.
export const RUNNING_SPOT = { x: 1.4, z: 1.52 }
// The lots waiting for a machine stand in front of it in rows across, the one it takes next
// nearest to it, each row centered on it: up to two rows of three. A machine with more waiting
// shows the rest on its card.
const PILE_COLUMNS = 3
const PILE_ROWS = 2
const PILE_PITCH = 1.05
const PILE_FIRST = 2.6
export const PILE_MAX = PILE_COLUMNS * PILE_ROWS
// From a machine's middle to the front edge of the lots waiting in front of it.
export const LOTS_REACH = PILE_FIRST + (PILE_ROWS - 1) * PILE_PITCH + LOT_PALLET / 2
// The deepest machine reaches this far behind its middle; the lots waiting in front of a machine
// of the back row keep clear of the machine in front of them by more than that.
const MACHINE_BACK = 1.15
const ROW_DEPTH = LOTS_REACH + MACHINE_BACK + 0.5
// From the back wall to the middle of the back row: room behind the machines for cabinets.
const BACK = 2.0
// The main aisle along the front, where the forklift runs from material to finished goods.
const AISLE_WIDTH = 2.6
const AISLE_GAP = 0.35
const FRONT_EDGE = 0.3
const STORE_WIDTH = 4.6
// Each part's pallet in a store, one behind another, clear of the rack at the back wall.
const STORE_PITCH = 1.7
const STORE_FIRST = 3.3
// A pallet's middle from the left of its file, after its painted part number, and the width of a file.
const STORE_TEXT = 2.4
const STORE_FILE = 2.6

export type StoreKind = 'material' | 'finished'
// How a pallet in a store is named when it is chosen on the floor, apart from the machines' ids.
export const stockKey = (kind: StoreKind, partNumber: string) => `${kind}/${partNumber}`

export type PlacedMachine = { equipment: Equipment; model: MachineModel; x: number; z: number }
export type Zone = { name: string; x0: number; x1: number; equipmentIds: string[] }
export type Store = { x0: number; x1: number; spots: { x: number; z: number }[] }

export type FactoryLayout = {
  zones: Zone[]
  machines: PlacedMachine[]
  // Where material and finished goods stand: one pallet a part, in the data's order of parts.
  material: Store
  finished: Store
  // The floor runs from x 0 to width and from z back (the back wall) to front.
  width: number
  depth: number
  back: number
  front: number
  // The middle of the main aisle along the front, and how wide it is.
  aisle: { z: number; width: number }
}

// Crews in their order in the data, each an area of machines in two rows, then machines in
// no crew. Material stands to the left of the first area, finished goods to the right of the last.
export function factoryLayout(data: PlantData): FactoryLayout {
  const crews = crewOfEquipment(data)
  const groups = [
    ...data.crews.map((crew) => ({ name: crew.name, equipment: data.equipment.filter((item) => crews.get(item.id) === crew) })),
    { name: '', equipment: data.equipment.filter((item) => !crews.has(item.id)) },
  ].filter((group) => group.equipment.length > 0)

  // Laid out from the back wall at 0, then centered on z = 0.
  const rows = [BACK, BACK + ROW_DEPTH]
  const aisleStart = rows[1] + LOTS_REACH + AISLE_GAP
  // A store's pallets go one behind another up to the aisle, then in a second file.
  const perFile = Math.max(1, Math.floor((aisleStart - 0.6 - STORE_FIRST) / STORE_PITCH) + 1)
  const parts = data.parts.length
  const files = Math.max(1, Math.ceil(parts / perFile))
  const storeWidth = Math.max(STORE_WIDTH, STORE_FILE * files + 2)
  const depth = aisleStart + AISLE_WIDTH + FRONT_EDGE
  const shift = -depth / 2

  const zones: Zone[] = []
  const machines: PlacedMachine[] = []
  let x = storeWidth
  for (const group of groups) {
    const columns = Math.ceil(group.equipment.length / 2)
    group.equipment.forEach((equipment, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      machines.push({ equipment, model: modelOf(equipment), x: x + (column + 0.5) * CELL, z: rows[row] + shift })
    })
    zones.push({ name: group.name, x0: x, x1: x + columns * CELL, equipmentIds: group.equipment.map((item) => item.id) })
    x += columns * CELL
  }
  // Files of pallets from left to right, each with room at its left for the part numbers painted
  // on the floor, on the side the camera looks from, where the stacks do not hide them.
  const spots = (x0: number) =>
    Array.from({ length: parts }, (_, index) => ({
      x: x0 + STORE_TEXT + Math.floor(index / perFile) * STORE_FILE,
      z: STORE_FIRST + (index % perFile) * STORE_PITCH + shift,
    }))
  return {
    zones,
    machines,
    material: { x0: 0, x1: storeWidth, spots: spots(0) },
    finished: { x0: x, x1: x + storeWidth, spots: spots(x) },
    width: x + storeWidth,
    depth,
    back: shift,
    front: depth + shift,
    aisle: { z: aisleStart + AISLE_WIDTH / 2 + shift, width: AISLE_WIDTH },
  }
}

// Where each of the lots waiting for a machine stands, relative to the machine's middle, in the
// order it takes them: as many as fit, which may be fewer than are waiting.
export function pileSpots(count: number): { x: number; z: number }[] {
  const shown = Math.max(0, Math.min(count, PILE_MAX))
  return Array.from({ length: shown }, (_, index) => {
    const row = Math.floor(index / PILE_COLUMNS)
    const inRow = Math.min(PILE_COLUMNS, shown - row * PILE_COLUMNS)
    return { x: ((index % PILE_COLUMNS) - (inRow - 1) / 2) * PILE_PITCH, z: PILE_FIRST + row * PILE_PITCH }
  })
}

// How many cartons a lot's pallet carries: one for every 15 pieces or part of them, up to eight,
// two to a layer, so the more pieces a lot has the higher it stands.
export function cartonsOf(quantity: number): number {
  return Math.min(8, Math.max(1, Math.ceil(quantity / 15)))
}

// A box on the screen, in pixels from the top left of the stage.
export type Rect = { x: number; y: number; width: number; height: number }
type Size = { width: number; height: number }

// From the stage's edges, and from the machine.
const CARD_MARGIN = 8
const CARD_GAP = 12
// How near the chosen machine's card a name or a tag gives way to it.
export const CARD_REACH = 4

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

export const overlaps = (a: Rect, b: Rect) => overlap(a, b) > 0

// Whether a box on the screen meets the shape a solid box of the floor takes there, given the
// solid's corners on the screen: it does unless a line keeps them apart, and such a line runs
// along the screen or along an edge of the shape, which joins two of the corners.
export function meetsHull(corners: [number, number][], rect: Rect): boolean {
  const square: [number, number][] = [
    [rect.x, rect.y],
    [rect.x + rect.width, rect.y],
    [rect.x, rect.y + rect.height],
    [rect.x + rect.width, rect.y + rect.height],
  ]
  const across: [number, number][] = [
    [1, 0],
    [0, 1],
    ...corners.flatMap(([x0, y0], index) => corners.slice(index + 1).map(([x1, y1]): [number, number] => [y0 - y1, x1 - x0])),
  ]
  return across
    .filter(([x, y]) => Math.hypot(x, y) > 1e-9)
    .every(([x, y]) => {
      const shape = corners.map(([px, py]) => px * x + py * y)
      const box = square.map(([px, py]) => px * x + py * y)
      return Math.max(...shape) > Math.min(...box) && Math.max(...box) > Math.min(...shape)
    })
}

// A place for a machine's name: the point it hangs from and the shift of its top left corner.
export type NamePlace = { from: 'top' | 'foot' | 'over' | 'right' | 'left' | 'under'; shift: readonly [number, number] }

// Where a machine's name may stand, in the order they are tried: the point it hangs from and the
// shift of its top left corner from that point, in shares of the name's width and height. Each
// keeps an edge on its point, so a name stays with its machine: on the point just over the machine
// (top), leaning right or left there, level with that point at its right or its left, and last
// under the middle of the machine's front at the floor (foot), for a low machine whose top the
// lots of the machine behind it stand round on the screen.
export const NAME_PLACES: readonly NamePlace[] = [
  { from: 'top', shift: [-0.5, -1] },
  { from: 'top', shift: [-0.15, -1] },
  { from: 'top', shift: [-0.85, -1] },
  { from: 'top', shift: [0.05, -0.5] },
  { from: 'top', shift: [-1.05, -0.5] },
  { from: 'foot', shift: [-0.5, 0] },
]

// The chosen machine's name, large beside a machine on a small floor, may also stand clear of the
// box the machine takes on the stage, tried before the others: over the box (over), at its right
// or its left by its top (right, left), or under it (under).
export const CHOSEN_PLACES: readonly NamePlace[] = [
  { from: 'over', shift: [-0.5, -1] },
  { from: 'right', shift: [0, 0] },
  { from: 'left', shift: [-1, 0] },
  { from: 'under', shift: [-0.5, 0] },
]

// A machine's name on the stage: its machine, the point just over the machine and the middle of
// its front at the floor, the corners of the box round the machine, the name's size, whether its
// machine is the chosen one, and whether a lot runs on it (its name then says which).
export type NameSpot = {
  machine: string
  top: [number, number]
  foot: [number, number]
  body: [number, number][]
  width: number
  height: number
  chosen: boolean
  lot: boolean
}
// A lot's load on the stage: the machine it stands at and the corners of its box.
export type LoadSpot = { machine: string; corners: [number, number][] }

// How far a name keeps from what it stays off.
const NAME_GAP = 2

const boxAround = (corners: [number, number][]): Rect => {
  const xs = corners.map(([x]) => x)
  const ys = corners.map(([, y]) => y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}

// Where each machine's name stands on the stage, as the top left corner of the name or null where
// it gives way, in the order the names come; and the tags that give way to the chosen machine's
// name. Names keep off the loads, the tags, the crews' signs on the back wall (each as its corners
// on the stage), what the stage shows over the floor (avoid: the clock, the zoom buttons) and one
// another. The chosen machine's name goes first and always shows: at the first place clear of all
// of them and of its own machine, else where it covers least: its own machine's loads count most,
// then another machine's loads and what lies over the floor, then its own machine, then a tag,
// which gives way under it, and least a sign. Then the names of machines with a lot on them, then
// the rest, each at the first place inside the stage clear of everything and of the names placed
// before it. A name with no such place gives way, so no name hides how much work waits at a
// machine.
export function namePlaces({
  names,
  loads,
  tags,
  signs,
  avoid,
  stage,
}: {
  names: NameSpot[]
  loads: LoadSpot[]
  tags: Rect[]
  signs: [number, number][][]
  avoid: Rect[]
  stage: Size
}): { places: ({ x: number; y: number } | null)[]; hiddenTags: number[] } {
  const bounds = loads.map(({ corners }) => boxAround(corners))
  const meets = (index: number, rect: Rect) => overlaps(bounds[index], rect) && meetsHull(loads[index].corners, rect)
  const signBounds = signs.map(boxAround)
  const onSign = (index: number, rect: Rect) => overlaps(signBounds[index], rect) && meetsHull(signs[index], rect)
  const inside = (rect: Rect) => rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= stage.width && rect.y + rect.height <= stage.height
  const rank = (name: NameSpot) => (name.chosen ? 0 : name.lot ? 1 : 2)
  const order = names.map((_, index) => index).sort((a, b) => rank(names[a]) - rank(names[b]))
  const places: ({ x: number; y: number } | null)[] = names.map(() => null)
  const taken: Rect[] = []
  const hiddenTags = new Set<number>()
  for (const index of order) {
    const name = names[index]
    const box = boxAround(name.body)
    // The places clear of the machine's box keep the gap from it too.
    const points = {
      top: name.top,
      foot: name.foot,
      over: [name.top[0], box.y - NAME_GAP],
      right: [box.x + box.width + NAME_GAP, box.y],
      left: [box.x - NAME_GAP, box.y],
      under: [name.top[0], box.y + box.height + NAME_GAP],
    }
    // Each place with the gap round it.
    const rects = (name.chosen ? [...CHOSEN_PLACES, ...NAME_PLACES] : NAME_PLACES).map(({ from, shift: [x, y] }) => ({
      x: points[from][0] + x * name.width - NAME_GAP,
      y: points[from][1] + y * name.height - NAME_GAP,
      width: name.width + 2 * NAME_GAP,
      height: name.height + 2 * NAME_GAP,
    }))
    const tagsUnder = (rect: Rect) => tags.flatMap((tag, at) => (!hiddenTags.has(at) && overlaps(tag, rect) ? [at] : []))
    let place: number
    if (name.chosen) {
      const cost = (rect: Rect) =>
        (inside(rect) ? 0 : 1e4) +
        loads.reduce((total, load, at) => total + (meets(at, rect) ? (load.machine === name.machine ? 1000 : 10) : 0), 0) +
        avoid.filter((area) => overlaps(area, rect)).length * 10 +
        (meetsHull(name.body, rect) ? 5 : 0) +
        tagsUnder(rect).length * 3 +
        signs.filter((_, at) => onSign(at, rect)).length
      const costs = rects.map(cost)
      place = costs.indexOf(Math.min(...costs))
      for (const at of tagsUnder(rects[place])) hiddenTags.add(at)
    } else {
      place = rects.findIndex(
        (rect) =>
          inside(rect) &&
          loads.every((_, at) => !meets(at, rect)) &&
          signs.every((_, at) => !onSign(at, rect)) &&
          tagsUnder(rect).length === 0 &&
          ![...avoid, ...taken].some((area) => overlaps(area, rect)),
      )
      if (place < 0) continue
    }
    places[index] = { x: rects[place].x + NAME_GAP, y: rects[place].y + NAME_GAP }
    taken.push(rects[place])
  }
  return { places, hiddenTags: [...hiddenTags] }
}

// The rest of the floor on the stage, which the chosen machine's card covers as little of as it
// can: the other machines' lots and the red tags, which show how much work waits and what has run
// out; then the other machines, the crews' signs and the other machines' names. Lots, machines and
// signs are solids of the floor, each given by its corners on the stage; a name or a tag gives way
// whole when the card comes near it.
export type CardCover = { lots: [number, number][][]; tags: Rect[]; solids: [number, number][][]; names: Rect[] }
// What covering a pixel of each costs a place, against the others.
const COVER_WEIGHT = { lots: 3, tags: 3, solids: 1, names: 1 }

// Where the chosen machine's card goes on the stage: beside the machine and its lots (keep). The
// places it tries, in order: at their right, then at their left, its top or its bottom level with
// theirs; over them, then under them, its middle over theirs; then at their right or left reaching
// half past their top or bottom, and over or under them from either end. Each is kept inside the
// stage. It takes the place that covers least: first of the machine and its lots, then of what the
// stage shows over the floor (avoid: the clock, the zoom buttons, which the card would cut off from
// the pointer), then of the rest of the floor (cover), and of places that cover alike the first.
export function cardPlace(keep: Rect, card: Size, stage: Size, avoid: Rect[], cover: Partial<CardCover> = {}): { x: number; y: number } {
  const across = (x: number) => Math.max(CARD_MARGIN, Math.min(x, stage.width - card.width - CARD_MARGIN))
  const down = (y: number) => Math.max(CARD_MARGIN, Math.min(y, stage.height - card.height - CARD_MARGIN))
  const sides = [keep.x + keep.width + CARD_GAP, keep.x - CARD_GAP - card.width]
  const ends = [keep.y - CARD_GAP - card.height, keep.y + keep.height + CARD_GAP]
  const levels = [keep.y, keep.y + keep.height - card.height, keep.y - card.height / 2, keep.y + keep.height - card.height / 2]
  const spans = [keep.x + keep.width / 2 - card.width / 2, keep.x, keep.x + keep.width - card.width, keep.x - card.width / 2, keep.x + keep.width - card.width / 2]
  const places = [
    ...sides.flatMap((x) => levels.slice(0, 2).map((y) => ({ x, y }))),
    ...ends.map((y) => ({ x: spans[0], y })),
    ...sides.flatMap((x) => levels.slice(2).map((y) => ({ x, y }))),
    ...ends.flatMap((y) => spans.slice(1).map((x) => ({ x, y }))),
  ].map(({ x, y }) => ({ x: across(x), y: down(y) }))
  const boxes = places.map((place) => ({ ...place, ...card }))
  // The places that cover least of the machine and its lots, and then of what lies over the floor.
  const firsts = boxes.map((box) => [overlap(box, keep), avoid.reduce((total, area) => total + overlap(box, area), 0)])
  const least = firsts.reduce((best, cost) => ((cost[0] - best[0] || cost[1] - best[1]) < 0 ? cost : best))
  const contenders = firsts.flatMap((cost, index) => (cost[0] === least[0] && cost[1] === least[1] ? [index] : []))
  if (contenders.length === 1) return places[contenders[0]]
  const shape = (corners: [number, number][]) => ({ corners, bounds: boxAround(corners) })
  const lots = (cover.lots ?? []).map(shape)
  const solids = (cover.solids ?? []).map(shape)
  // A solid counts by the part of the box round it under the card, where the card meets its shape;
  // a box round it wholly under the card is met without looking further.
  const within = (inner: Rect, outer: Rect) =>
    inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
  const onSolids = (list: typeof lots, box: Rect) =>
    list.reduce(
      (total, { corners, bounds }) => total + (overlaps(bounds, box) && (within(bounds, box) || meetsHull(corners, box)) ? overlap(bounds, box) : 0),
      0,
    )
  const onLabels = (list: Rect[], box: Rect) => {
    const near = { x: box.x - CARD_REACH, y: box.y - CARD_REACH, width: box.width + 2 * CARD_REACH, height: box.height + 2 * CARD_REACH }
    return list.reduce((total, label) => total + (overlaps(label, near) ? label.width * label.height : 0), 0)
  }
  const rest = (box: Rect) =>
    COVER_WEIGHT.lots * onSolids(lots, box) +
    COVER_WEIGHT.tags * onLabels(cover.tags ?? [], box) +
    COVER_WEIGHT.solids * onSolids(solids, box) +
    COVER_WEIGHT.names * onLabels(cover.names ?? [], box)
  const costs = contenders.map((index) => rest(boxes[index]))
  return places[contenders[costs.indexOf(Math.min(...costs))]]
}

// The forklift's pace along the main aisle, and how long it stops at each end, its forks rising
// and settling, before it moves on.
const FORKLIFT_SPEED = 1.8
const FORKLIFT_HOLD = 3.2

const smootherstep = (u: number) => u * u * u * (u * (u * 6 - 15) + 10)

// Where the forklift is t seconds into its round, as x along a run of the aisle from 0 to run, and
// how high its forks are. It drives forks first from one end to the other, stops, and backs out
// again, easing out of and into each stop, so it never jumps or starts over.
export function forkliftAt(t: number, run: number): { x: number; lift: number } {
  const travel = run / FORKLIFT_SPEED
  const period = 2 * (travel + FORKLIFT_HOLD)
  const time = ((t % period) + period) % period
  const forks = (held: number) => 0.32 * Math.sin((Math.PI * held) / FORKLIFT_HOLD)
  if (time < FORKLIFT_HOLD) return { x: 0, lift: forks(time) }
  if (time < FORKLIFT_HOLD + travel) return { x: run * smootherstep((time - FORKLIFT_HOLD) / travel), lift: 0 }
  if (time < 2 * FORKLIFT_HOLD + travel) return { x: run, lift: forks(time - FORKLIFT_HOLD - travel) }
  return { x: run * (1 - smootherstep((time - 2 * FORKLIFT_HOLD - travel) / travel)), lift: 0 }
}
