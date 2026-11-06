// What the entrance shows at any moment, worked out from the time alone: deals drift in out of
// the haze, the likely ones drop into the months ahead, the plan board sends word down to the
// floor, lots go from the material rack through the machines, are packed into cartons, wait
// at the dock two to a stack, and a forklift carries each stack into a wing truck, eight lots to
// a truck. Nothing keeps state, so a still picture is one moment, and as time only goes forward
// nothing on screen ever runs back. Lengths are in meters and times in seconds.

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
// The truck's rear stands here, its cargo floor this high above the hall's floor.
export const PARK_X = 19.4
export const BED = 0.5

// A lot leaves the rack every RELEASE seconds; the lots' looks repeat after CYCLE_LOTS of them.
export const RELEASE = 5
export const CYCLE_LOTS = 12
export const CYCLE = RELEASE * CYCLE_LOTS
const APPEAR = 0.8
const TRAVEL = 1.8
// How long a lot stays at each step. Shorter than RELEASE, so a machine is free before the next lot.
const DWELL = [3.6, 3.2, 4.0, 3.8, 3.0, 3.4]
// When lot 0 reaches each step: first from the rack, then one step after another.
export const ARRIVE = DWELL.reduce<number[]>((times, _, step) => {
  times.push(step === 0 ? APPEAR + 2.2 : times[step - 1] + DWELL[step - 1] + TRAVEL)
  return times
}, [])
const LAST = STEPS.length - 1
// When lot 0 leaves the packing table.
const PACKED = ARRIVE[LAST] + DWELL[LAST]

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
  // Whether the packing table has finished with it, so it is in shipping cartons, and how long
  // ago (less than 0 before).
  packed: boolean
  packing: number
}

// The dock. Packed lots wait in a row along the front edge, nearest the truck first, and every
// second one settles onto the one before it, two to a stack. A whole stack slides onto the place
// in front of the forklift, which drives straight to and fro on one line: forward under it, up to
// the height of the truck's cargo floor, a pause, on into the truck's rear, down, a pause, and
// back. The stack then slides on to its place in the box. A truck takes TRUCK_LOTS lots, four
// stacks in a row, with its near side raised as a wing while it is loaded; then it lowers the
// wing and drives off, and the next backs in. Two lots a trip leave the forklift time to pause.
export const TRUCK_LOTS = 8
const STACK = 2
const STACKS = TRUCK_LOTS / STACK
// A lot's top stands this high above its pallet's foot; the second lot of a stack rests there.
export const LOT_HEIGHT = 0.6
// The line the forklift runs on, clear of the waiting row and of the packing table, and where its
// fork heels stand at rest, under the stack and in the truck. A stack on the forks stands
// FORK_AHEAD in front of the heels.
export const FORK_Z = 1.53
export const FORK_HOME = 16.85
const FORK_PICK = 18.1
const FORK_LOAD = 19.45
export const FORK_AHEAD = 0.55
// How high the forks carry a stack into the truck, well over its floor so the setting down shows
// above the gate, and the height they back out at, below the pallet's deck and above the floor.
const CARRY = 0.85
const CLEAR = 0.46
// The waiting row's places and the forklift's place, marked on the floor.
const QUEUE_Z = 2.71
const QUEUE = [18.5, 17.05, 15.6]
const PLACE = { x: FORK_PICK + FORK_AHEAD, z: FORK_Z }
export const DOCK_PLACES = [...QUEUE.map((x) => ({ x, z: QUEUE_Z })), PLACE]
// Where a lot leaving the packing table turns along the row, and where a second lot stops short
// of the first before it rises onto it.
const QUEUE_IN = { x: 14.3, z: QUEUE_Z }
const SHORT = 1.25
// Where the stacks stand in the box, the far end first.
const IN_TRUCK = [PARK_X + 4.3, PARK_X + 3.15, PARK_X + 2.0, PARK_X + 0.85]
const TO_QUEUE_SPEED = 2.0
const ADVANCE = 0.8
const LAND = 1.0
const SLIDE = 0.7
const WAIT = 0.6
const APPROACH = 0.9
const LIFT = 0.7
const HOLD_UP = 0.8
const DRIVE = 0.8
const LOWER = 0.7
const HOLD_DOWN = 0.8
const BACK = 1.0
const SET_DOWN = APPROACH + LIFT + HOLD_UP + DRIVE + LOWER
const TRIP = SET_DOWN + HOLD_DOWN + BACK
const INSIDE = 1.2
// The wing: raised a moment after the truck stands, lowered once its last stack is in place.
const WING = 1.0
const DEPART = 4
const ARRIVAL = 3.6
// Which lots share a truck: chosen so the scene's first moments show one being loaded.
const TRUCK_PHASE = 1

type Stack = {
  // The row place its first lot comes to and when; when its second lot starts up onto it there;
  // when it moves up from each place to the next.
  slot: number
  reach: number
  land: number
  moves: number[]
  // When it starts sliding onto the forklift's place, and when the forklift starts toward it.
  slide: number
  pick: number
}

const stackOf = (lot: number) => Math.floor((lot + TRUCK_PHASE) / STACK)
const isUpper = (lot: number) => mod(lot + TRUCK_PHASE, STACK) === 1
const firstLot = (stack: number) => stack * STACK - TRUCK_PHASE
const truckOfStack = (stack: number) => Math.floor(stack / STACKS)
const toQueue = (x: number) => (Math.hypot(QUEUE_IN.x - STEPS[LAST].x, QUEUE_IN.z - LANE_Z) + x - QUEUE_IN.x) / TO_QUEUE_SPEED
const loadFrom = (parked: number) => parked + 0.3 + WING + 0.5
// Once the forks are out from under it, a stack slides on to its place in the box.
const FORKS_OUT = SET_DOWN + HOLD_DOWN + 0.5
const settledOf = (pick: number) => pick + FORKS_OUT + INSIDE
const closeOf = (lastPick: number) => settledOf(lastPick) + 0.6

// Works the dock through enough trucks to settle, one stack after another, and keeps the last
// whole truck's stacks and times as the pattern every truck repeats: any other stack is handled
// at the times of the pattern's stack in the same place, as many trucks on or back.
function settle() {
  const trucks = 8
  const count = trucks * STACKS
  const stacks: Stack[] = []
  const parked: number[] = [-Infinity]
  const closes: number[] = []
  let home = -Infinity
  for (let stack = 0; stack < count; stack++) {
    const leave = firstLot(stack) * RELEASE + PACKED
    // The stacks ahead still in the row when its first lot would get there.
    let slot = 0
    for (let tries = 0; tries < QUEUE.length; tries++) {
      const at = leave + toQueue(QUEUE[slot])
      let ahead = 0
      while (ahead < stack && stacks[stack - 1 - ahead].slide + SLIDE + 0.8 > at) ahead++
      if (ahead <= slot) break
      slot = Math.min(ahead, QUEUE.length - 1)
    }
    const reach = leave + toQueue(QUEUE[slot])
    const land = Math.max(leave + RELEASE + toQueue(QUEUE[slot] - SHORT), reach)
    const moves: number[] = []
    let ready = land + LAND
    for (let place = slot; place > 0; place--) {
      // Up one place once the stack ahead has left it.
      const ahead = stacks[stack - 1]
      const freed = place - 1 === 0 ? ahead.slide + SLIDE : ahead.moves[ahead.moves.length - (place - 1)]
      const start = Math.max(ready, (freed ?? -Infinity) + 0.2)
      moves.push(start)
      ready = start + ADVANCE
    }
    const slide = Math.max(ready, home)
    const truck = truckOfStack(stack)
    while (parked.length <= truck) {
      const last = parked.length - 1
      parked.push(closes[last] + WING + 0.6 + DEPART + 0.2 + ARRIVAL)
    }
    const pick = Math.max(slide + SLIDE + WAIT, loadFrom(parked[truck]))
    home = pick + TRIP
    stacks.push({ slot, reach, land, moves, slide, pick })
    if (truckOfStack(stack + 1) !== truck) closes[truck] = closeOf(pick)
  }
  const k = truckOfStack(count - 1) - 1
  const first = k * STACKS
  return { stacks: stacks.slice(first, first + STACKS), parked: parked[k], close: closes[k], first, truck: k }
}

const PATTERN = settle()
const PERIOD = TRUCK_LOTS * RELEASE
function handling(stack: number): Stack {
  const j = mod(stack - PATTERN.first, STACKS)
  const at = ((stack - PATTERN.first - j) / STACKS) * PERIOD
  const item = PATTERN.stacks[j]
  return { slot: item.slot, reach: item.reach + at, land: item.land + at, moves: item.moves.map((value) => value + at), slide: item.slide + at, pick: item.pick + at }
}
const parkedOf = (truck: number) => PATTERN.parked + (truck - PATTERN.truck) * PERIOD
const closeAt = (truck: number) => PATTERN.close + (truck - PATTERN.truck) * PERIOD
const departOf = (truck: number) => closeAt(truck) + WING + 0.6
const arriveOf = (truck: number) => parkedOf(truck) - ARRIVAL
// The lots of a truck are out of sight inside once its wing is down.
const goneAt = (lot: number) => closeAt(truckOfStack(stackOf(lot))) + WING

// Where the forklift's fork heels are along its line, how high its forks are, the lots of the
// stack it is fetching or has just set down, and the lots on its forks.
export type Forks = { x: number; lift: number; fetching: number[]; carrying: number[] }

export function forkliftAt(time: number): Forks {
  const newest = stackOf(Math.floor(time / RELEASE))
  for (let stack = newest; stack > newest - 3 * STACKS; stack--) {
    const into = time - handling(stack).pick
    if (into < 0 || into >= TRIP) continue
    return forksAt(into, stack)
  }
  return { x: FORK_HOME, lift: 0, fetching: [], carrying: [] }
}

function forksAt(into: number, stack: number): Forks {
  const lots = Array.from({ length: STACK }, (_, index) => firstLot(stack) + index)
  const on = (x: number, lift: number) => ({ x, lift, fetching: lots, carrying: lots })
  let t = into
  if (t < APPROACH) return { x: lerp(FORK_HOME, FORK_PICK, ease(t / APPROACH)), lift: 0, fetching: lots, carrying: [] }
  t -= APPROACH
  if (t < LIFT) return on(FORK_PICK, CARRY * ease(t / LIFT))
  t -= LIFT
  if (t < HOLD_UP) return on(FORK_PICK, CARRY)
  t -= HOLD_UP
  if (t < DRIVE) return on(lerp(FORK_PICK, FORK_LOAD, ease(t / DRIVE)), CARRY)
  t -= DRIVE
  if (t < LOWER) return on(FORK_LOAD, lerp(CARRY, CLEAR, ease(t / LOWER)))
  t -= LOWER
  if (t < HOLD_DOWN) return { x: FORK_LOAD, lift: CLEAR, fetching: lots, carrying: [] }
  t -= HOLD_DOWN
  // Back out at the clearing height until the forks are out of the truck, then down.
  const x = lerp(FORK_LOAD, FORK_HOME, ease(t / BACK))
  const out = PARK_X - 1.1
  return { x, lift: x > out ? CLEAR : CLEAR * clamp01((x - FORK_HOME) / (out - FORK_HOME)), fetching: lots, carrying: [] }
}

// How far the truck at the dock has its wing raised, from 0 (down) to 1.
export function wingAt(time: number): number {
  const truck = truckNear(time)
  // A lot is loaded a truck or two after the one its release time would suggest.
  for (const k of [truck - 2, truck - 1, truck, truck + 1]) {
    const open = parkedOf(k) + 0.3
    const close = closeAt(k)
    if (time >= open && time < close + WING) return time < open + WING ? ease((time - open) / WING) : time < close ? 1 : 1 - ease((time - close) / WING)
  }
  return 0
}

function dockAt(lot: number, time: number): Point {
  const stack = stackOf(lot)
  const h = handling(stack)
  const upper = isUpper(lot)
  const rise = upper ? LOT_HEIGHT : 0
  const leave = lot * RELEASE + PACKED
  // Along the lane a little, across to the row and along it, easing in and out.
  const travel = (to: number, arrive: number): Point => {
    const first = Math.hypot(QUEUE_IN.x - STEPS[LAST].x, QUEUE_IN.z - LANE_Z)
    const along = ease((time - leave) / (arrive - leave)) * (first + to - QUEUE_IN.x)
    if (along < first) {
      const u = along / first
      return { x: lerp(STEPS[LAST].x, QUEUE_IN.x, u), y: 0, z: lerp(LANE_Z, QUEUE_IN.z, u) }
    }
    return { x: QUEUE_IN.x + along - first, y: 0, z: QUEUE_Z }
  }
  if (!upper && time < h.reach) return travel(QUEUE[h.slot], h.reach)
  if (upper) {
    const short = QUEUE[h.slot] - SHORT
    const arrive = leave + toQueue(short)
    if (time < arrive) return travel(short, arrive)
    if (time < h.land) return { x: short, y: 0, z: QUEUE_Z }
    if (time < h.land + LAND) {
      // Up first, then over onto the lot below.
      const u = (time - h.land) / LAND
      return { x: lerp(short, QUEUE[h.slot], ease((u - 0.55) / 0.45)), y: LOT_HEIGHT * ease(u / 0.55), z: QUEUE_Z }
    }
  }
  let slot = h.slot
  for (const start of h.moves) {
    if (time < start) return { x: QUEUE[slot], y: rise, z: QUEUE_Z }
    if (time < start + ADVANCE) return { x: lerp(QUEUE[slot], QUEUE[slot - 1], ease((time - start) / ADVANCE)), y: rise, z: QUEUE_Z }
    slot--
  }
  if (time < h.slide) return { x: QUEUE[0], y: rise, z: QUEUE_Z }
  if (time < h.slide + SLIDE) {
    const u = ease((time - h.slide) / SLIDE)
    return { x: lerp(QUEUE[0], PLACE.x, u), y: rise, z: lerp(QUEUE_Z, PLACE.z, u) }
  }
  const into = time - h.pick
  if (into < SET_DOWN) {
    const forks = forksAt(Math.max(0, into), stack)
    if (!forks.carrying.length) return { x: PLACE.x, y: rise, z: PLACE.z }
    // On the forks; on the truck's floor once they are lowered under it.
    const floor = into > SET_DOWN - LOWER ? BED : 0
    return { x: forks.x + FORK_AHEAD, y: Math.max(floor, forks.lift) + rise, z: FORK_Z }
  }
  const u = ease((into - FORKS_OUT) / INSIDE)
  return { x: lerp(FORK_LOAD + FORK_AHEAD, IN_TRUCK[mod(stack - PATTERN.first, STACKS)], u), y: BED + rise, z: lerp(FORK_Z, LANE_Z, u) }
}

export function lotAt(lot: number, time: number): LotPose | null {
  const local = time - lot * RELEASE
  if (local < 0) return null
  const lane = (x: number) => ({ x, y: 0, z: LANE_Z })
  const pose = (at: Point, scale = 1): LotPose => ({
    ...at,
    scale,
    worked: local >= ARRIVE[0] + processing(lot, 0),
    packed: local >= ARRIVE[LAST] + processing(lot, LAST),
    packing: local - ARRIVE[LAST] - processing(lot, LAST),
  })
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
  if (time >= goneAt(lot)) return null
  return pose(dockAt(lot, time))
}

// The lots that may be on the floor at this time.
const LONGEST = Math.max(...Array.from({ length: TRUCK_LOTS }, (_, index) => goneAt(firstLot(PATTERN.first) + index) - (firstLot(PATTERN.first) + index) * RELEASE))
export function lotsAround(time: number): number[] {
  const newest = Math.floor(time / RELEASE)
  const span = Math.ceil(LONGEST / RELEASE) + 1
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
// none is there. Each drives off to the right once its lots are on board, and the next backs in
// from the right.
const truckNear = (time: number) => truckOfStack(stackOf(Math.floor(time / RELEASE)))

export function truckAt(time: number): { offset: number; batch: number } | null {
  const near = truckNear(time)
  for (const batch of [near - 2, near - 1, near, near + 1]) {
    const start = arriveOf(batch)
    const leave = departOf(batch)
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
  const near = truckNear(time)
  for (const k of [near - 1, near, near + 1, near + 2]) add('dock', arriveOf(k))
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
