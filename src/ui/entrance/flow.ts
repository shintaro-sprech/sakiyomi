// What the entrance shows at any moment, worked out from the time alone: deals drift in out of
// the haze, the likely ones drop into the months ahead, the plan board sends word down to the
// floor, lots go from the material rack through the machines to the dock, and a truck takes
// every four. Nothing keeps state, so a still picture is one moment, and as time only goes
// forward nothing on screen ever runs back. Lengths are in meters and times in seconds.

export type Tone = 'ok' | 'tight'
export type Point = { x: number; y: number; z: number }

// One row of the plan board and one machine on the floor, from the material rack to the dock.
// The names are the sample data's, so the board reads like the app's Gantt chart.
export const STEPS = [
  { name: '切断機1', process: '切断', model: 'cutter', x: -4.8 },
  { name: 'ベンダー1', process: '曲げ', model: 'press_brake', x: -1.0 },
  { name: '溶接ロボ1', process: '溶接', model: 'welding_robot', x: 2.8 },
  { name: 'マシニング1', process: '切削', model: 'machining_center', x: 6.6 },
  { name: '検査台1', process: '検査', model: 'inspection_table', x: 10.2 },
  { name: '梱包台1', process: '梱包', model: 'packing_table', x: 13.6 },
] as const

export const RACK_X = -8.8
// Lots run along this line in front of the machines.
export const LANE_Z = 2.0
// The truck's rear stands here, the dock's four places just before it.
export const PARK_X = 19.4
// Filled far side first, so a lot on its way to its place never crosses one already waiting.
const SPOTS: [number, number][] = [
  [17.7, 1.3],
  [17.7, 2.7],
  [16.3, 1.3],
  [16.3, 2.7],
]

// A lot leaves the rack every RELEASE seconds; the lots' looks repeat after CYCLE_LOTS of them.
export const RELEASE = 5
export const CYCLE_LOTS = 12
export const CYCLE = RELEASE * CYCLE_LOTS
const APPEAR = 0.8
const TRAVEL = 1.8
// How long a lot stays at each step. Shorter than RELEASE, so a machine is free before the next lot.
const DWELL = [3.6, 3.2, 4.0, 3.8, 3.0, 3.4]
const TO_DOCK = 2.2
const INTO_TRUCK = 1.0
const LOAD_GAP = 0.3
const BATCH = 4
// When lot 0 reaches each step: first from the rack, then one step after another.
export const ARRIVE = DWELL.reduce<number[]>((times, _, step) => {
  times.push(step === 0 ? APPEAR + 2.2 : times[step - 1] + DWELL[step - 1] + TRAVEL)
  return times
}, [])
const LAST = STEPS.length - 1
const AT_DOCK = ARRIVE[LAST] + DWELL[LAST] + TO_DOCK

// The scene starts this far in, with every stage already busy.
export const WARM = 3 * CYCLE

// A number from 0 to 1 that depends only on its arguments.
export function noise(a: number, b = 0): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35)
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))
// Starts and stops gently.
export const ease = (u: number) => {
  const v = clamp01(u)
  return v * v * (3 - 2 * v)
}
const lerp = (a: number, b: number, u: number) => a + (b - a) * u
const mod = (value: number, by: number) => ((value % by) + by) % by

export function lotLook(lot: number): { tone: Tone; cartons: number } {
  const index = mod(lot, CYCLE_LOTS)
  return {
    // Two of every twelve orders have little time to spare, as yellow bars do on the Gantt chart.
    tone: index === 3 || index === 9 ? 'tight' : 'ok',
    cartons: 2 + Math.floor(noise(index, 41) * 3),
  }
}

// How long the step works on the lot: a little different for each lot, always inside its stay.
export function processing(lot: number, step: number): number {
  return DWELL[step] * (0.7 + 0.24 * noise(mod(lot, CYCLE_LOTS), step + 1))
}

// When the step starts on the lot.
export const stepStart = (lot: number, step: number) => lot * RELEASE + ARRIVE[step]

export type LotPose = Point & {
  // 0 while it comes out of the rack or goes into the truck, 1 the rest of the time.
  scale: number
  // Whether the first step has finished with it, so it is no longer bare material.
  worked: boolean
}

const batchOf = (lot: number) => Math.floor(lot / BATCH)
// When the truck starts taking batch k on board: just after its last lot reaches the dock.
const loadStart = (batch: number) => (batch * BATCH + BATCH - 1) * RELEASE + AT_DOCK + 0.5
const loadedAt = (batch: number) => loadStart(batch) + (BATCH - 1) * LOAD_GAP + INTO_TRUCK

export function lotAt(lot: number, time: number): LotPose | null {
  const local = time - lot * RELEASE
  if (local < 0) return null
  const lane = (x: number) => ({ x, y: 0, z: LANE_Z })
  const pose = (at: Point, scale = 1): LotPose => ({ ...at, scale, worked: local >= ARRIVE[0] + processing(lot, 0) })
  if (local < APPEAR) {
    const u = ease(local / APPEAR)
    return pose({ x: RACK_X, y: 0, z: lerp(0.5, LANE_Z, u) }, u)
  }
  if (local < ARRIVE[0]) return pose(lane(lerp(RACK_X, STEPS[0].x, ease((local - APPEAR) / (ARRIVE[0] - APPEAR)))))
  for (let step = 0; step < STEPS.length; step++) {
    const leave = ARRIVE[step] + DWELL[step]
    if (local < leave) return pose(lane(STEPS[step].x))
    if (step < LAST && local < ARRIVE[step + 1]) {
      return pose(lane(lerp(STEPS[step].x, STEPS[step + 1].x, ease((local - leave) / TRAVEL))))
    }
  }
  const [spotX, spotZ] = SPOTS[mod(lot, BATCH)]
  const leaveLast = ARRIVE[LAST] + DWELL[LAST]
  if (local < AT_DOCK) {
    const u = ease((local - leaveLast) / TO_DOCK)
    return pose({ x: lerp(STEPS[LAST].x, spotX, u), y: 0, z: lerp(LANE_Z, spotZ, u) })
  }
  const board = loadStart(batchOf(lot)) + mod(lot, BATCH) * LOAD_GAP
  if (time < board) return pose({ x: spotX, y: 0, z: spotZ })
  const u = (time - board) / INTO_TRUCK
  if (u >= 1) return null
  // Up the ramp at the truck's rear and on into the box, where its walls hide it.
  const e = ease(u)
  return pose({ x: lerp(spotX, PARK_X + 1.6, e), y: 0.5 * Math.min(1, e * 2), z: lerp(spotZ, LANE_Z, e) }, u < 0.8 ? 1 : (1 - u) / 0.2)
}

// The lots that may be on the floor at this time.
export function lotsAround(time: number): number[] {
  const newest = Math.floor(time / RELEASE)
  const span = Math.ceil((AT_DOCK + BATCH * RELEASE + 4) / RELEASE)
  return Array.from({ length: span + 1 }, (_, index) => newest - index).filter((lot) => lot >= 0)
}

// How far the machine is through its work on a lot, or null while it waits.
export function working(step: number, time: number): number | null {
  const lot = Math.floor((time - ARRIVE[step]) / RELEASE)
  if (lot < 0) return null
  const into = time - stepStart(lot, step)
  const length = processing(lot, step)
  return into < length ? into / length : null
}

// The truck: how far right of its place it stands (0 when it is at the dock), or null while
// none is there. Each drives off to the right once its four lots are on board, and the next
// backs in from the right.
const DEPART = 4
const ARRIVAL = 3.6
const departAt = (batch: number) => loadedAt(batch) + 0.6
const arriveAt = (batch: number) => departAt(batch - 1) + DEPART + 0.2

export function truckAt(time: number): { offset: number; batch: number } | null {
  const first = Math.floor((time - AT_DOCK) / (BATCH * RELEASE)) - 1
  for (const batch of [first, first + 1, first + 2]) {
    const start = arriveAt(batch)
    const leave = departAt(batch)
    if (time < start || time >= leave + DEPART) continue
    if (time < start + ARRIVAL) return { offset: 24 * (1 - easeOut((time - start) / ARRIVAL)), batch }
    if (time < leave) return { offset: 0, batch }
    return { offset: 32 * easeIn((time - leave) / DEPART), batch }
  }
  return null
}
const easeOut = (u: number) => 1 - (1 - clamp01(u)) ** 2
const easeIn = (u: number) => clamp01(u) ** 2

// Word running along a line from the plan board: to the rack as a lot is called out, to a
// machine as it is about to start, to the dock as a truck is called; and into the board from
// the deals and the outlook. u goes from 0 where the word leaves to 1 where it arrives.
export type Line = 'deals' | 'outlook' | 'rack' | 'dock' | number
export const INBOUND: Line[] = ['deals', 'outlook']
export const PULSE = 1.1
const OUTLOOK_EVERY = 2.5
const DEALS_EVERY = 3.2
const INBOUND_PULSE = 1.6

export function pulsesAt(time: number): { line: Line; u: number }[] {
  const found: { line: Line; u: number }[] = []
  const add = (line: Line, arrive: number, length = PULSE) => {
    if (time >= arrive - length && time < arrive) found.push({ line, u: 1 - (arrive - time) / length })
  }
  const next = Math.ceil(time / RELEASE)
  add('rack', next * RELEASE)
  STEPS.forEach((_, step) => add(step, stepStart(Math.ceil((time - ARRIVE[step]) / RELEASE), step)))
  const batch = Math.floor((time - AT_DOCK) / (BATCH * RELEASE))
  for (const k of [batch, batch + 1, batch + 2]) add('dock', arriveAt(k))
  add('outlook', Math.ceil(time / OUTLOOK_EVERY) * OUTLOOK_EVERY, INBOUND_PULSE)
  add('deals', Math.ceil(time / DEALS_EVERY + 0.5) * DEALS_EVERY - DEALS_EVERY / 2, INBOUND_PULSE)
  return found
}

// The plan board: each lot's work at each step, over one cycle, in seconds from its start.
export function boardBars(): { step: number; start: number; length: number; tone: Tone }[] {
  const bars = []
  for (let lot = 0; lot < CYCLE_LOTS; lot++) {
    for (let step = 0; step < STEPS.length; step++) {
      bars.push({ step, start: mod(stepStart(lot, step), CYCLE), length: processing(lot, step), tone: lotLook(lot).tone })
    }
  }
  return bars
}

// Deals: a card every CARD_EVERY seconds drifts in out of the haze on the left, hangs there a
// while, and then either drops into the month it will be needed in or fades away.
export const CARD_EVERY = 1.6
const CARD_LOOKS = 24
const DRIFT = 5
const HOVER = 3
const RESOLVE = 1.6
export const CARD_LIFE = DRIFT + HOVER + RESOLVE

export type CardPose = Point & { opacity: number; scale: number; likely: boolean; fill: number; turn: number }

export function cardLook(card: number) {
  const look = mod(card, CARD_LOOKS)
  const likely = noise(look, 7) < 0.6
  return {
    likely,
    // How sure the deal is, as the bar on the card shows it.
    fill: likely ? 0.7 + 0.25 * noise(look, 8) : 0.15 + 0.3 * noise(look, 8),
    rest: { x: -24.5 + 3.5 * noise(look, 1), y: 1.5 + 2.4 * noise(look, 2), z: -1 + 3.5 * noise(look, 3) },
  }
}

const cardLands = (card: number) => card * CARD_EVERY + CARD_LIFE

export function cardAt(card: number, time: number): CardPose | null {
  const local = time - card * CARD_EVERY
  if (local < 0 || local >= CARD_LIFE) return null
  const { likely, fill, rest } = cardLook(card)
  const turn = 0.35 * (noise(mod(card, CARD_LOOKS), 4) - 0.5)
  // A slow rise and fall while it hangs, different for each card, that never jumps.
  const bob = 0.18 * Math.sin((time + card * 1.7) * 0.9)
  if (local < DRIFT) {
    const u = local / DRIFT
    const e = easeOut(u)
    return { x: lerp(rest.x - 9, rest.x, e), y: rest.y + bob, z: rest.z, opacity: clamp01(u * 2.5), scale: 1, likely, fill, turn }
  }
  if (local < DRIFT + HOVER) return { ...rest, y: rest.y + bob, opacity: 1, scale: 1, likely, fill, turn }
  const u = (local - DRIFT - HOVER) / RESOLVE
  if (!likely) return { ...rest, y: rest.y + bob - 0.6 * u, opacity: 1 - u, scale: 1, likely, fill, turn }
  // Down in an arc onto the top of the month it lands in, shrinking into it.
  const land = cardLands(card)
  const month = landsIn(card)
  const target = { x: columnX(month, land), y: columnHeight(month, land - 1e-6), z: CHART_Z }
  const e = ease(u)
  return {
    x: lerp(rest.x, target.x, e),
    y: lerp(rest.y + bob, target.y, e) + 1.2 * Math.sin(Math.PI * e),
    z: lerp(rest.z, target.z, e),
    opacity: 1,
    scale: 1 - 0.75 * e,
    likely,
    fill,
    turn: turn * (1 - e),
  }
}

export const cardsAround = (time: number) => {
  const newest = Math.floor(time / CARD_EVERY)
  return Array.from({ length: Math.ceil(CARD_LIFE / CARD_EVERY) + 1 }, (_, index) => newest - index).filter((card) => card >= 0)
}

// The outlook: a column for each month in a row, this month at the left and the months ahead
// to the right. Every MONTH seconds each column moves one place left: a new month rises at the
// right end, the deals land in the month after it, more of a month is firm orders (solid) and
// less only expected (pale) the nearer it comes, and once its month is past it sinks away.
export const MONTH = 20
export const MONTHS_SHOWN = 6
export const CHART_RIGHT = -10.9
export const CHART_Z = 0
export const COLUMN_GAP = 1.15
export const CHART_LEFT = CHART_RIGHT - MONTHS_SHOWN * COLUMN_GAP
const PER_DEAL = 0.3

export const monthOf = (time: number) => Math.floor(time / MONTH)
// How many places the column has moved since it rose.
const ageOf = (month: number, time: number) => time / MONTH - month
export const columnX = (month: number, time: number) => CHART_RIGHT - ageOf(month, time) * COLUMN_GAP
const landsIn = (card: number) => monthOf(cardLands(card)) - 1

export function columnHeight(month: number, time: number): number {
  const base = 0.7 + 1.3 * noise(mod(month, 30), 11)
  let deals = 0
  const first = Math.ceil(((month + 1) * MONTH - CARD_LIFE) / CARD_EVERY)
  for (let card = first; cardLands(card) < (month + 2) * MONTH; card++) {
    const land = cardLands(card)
    if (land > time || !cardLook(card).likely) continue
    deals += clamp01((time - land) / 0.4)
  }
  return base + deals * PER_DEAL
}

export function columnsAt(time: number) {
  const newest = monthOf(time)
  return Array.from({ length: MONTHS_SHOWN + 1 }, (_, index) => newest - index)
    .filter((month) => month >= 0)
    .map((month) => {
      const age = ageOf(month, time)
      const height = columnHeight(month, time)
      // Rises over its first half month and sinks over its last.
      const shown = Math.min(clamp01(age / 0.5), clamp01((MONTHS_SHOWN - age) / 0.5))
      const firm = 0.2 + 0.8 * clamp01((age - 1.5) / (MONTHS_SHOWN - 2.5))
      return { month, x: columnX(month, time), height: height * ease(shown), firm }
    })
}
