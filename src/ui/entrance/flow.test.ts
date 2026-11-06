import { describe, expect, it } from 'vitest'

import {
  ARRIVE,
  BED,
  boardBars,
  cardAt,
  CARD_EVERY,
  CARD_LIFE,
  columnsAt,
  CYCLE,
  FORK_AHEAD,
  FORK_Z,
  forkliftAt,
  LANE_Z,
  LOT_HEIGHT,
  lotAt,
  lotsAround,
  PARK_X,
  processing,
  pulsesAt,
  RELEASE,
  stepStart,
  STEPS,
  TRUCK_LOTS,
  truckAt,
  WARM,
  wingAt,
  working,
} from './flow'

const STEP = 1 / 60
// Two cycles from where the scene starts, one frame at a time.
const frames = Array.from({ length: Math.round((2 * CYCLE) / STEP) }, (_, index) => WARM + index * STEP)

describe('the entrance flow', () => {
  it('moves every lot a little from one frame to the next, never back', () => {
    for (const lot of lotsAround(WARM + CYCLE)) {
      let last = lotAt(lot, frames[0])
      for (const time of frames) {
        const now = lotAt(lot, time)
        if (last && now) {
          expect(Math.hypot(now.x - last.x, now.z - last.z)).toBeLessThan(0.15)
          // Along the line it only goes right, toward the dock.
          expect(now.x).toBeGreaterThanOrEqual(last.x - 1e-9)
        }
        // Once gone into the truck, it does not come back.
        if (last && !now) expect(lotAt(lot, time + 30)).toBeNull()
        last = now
      }
    }
  })

  it('lists every lot that is on the floor', () => {
    for (const time of frames.filter((_, index) => index % 30 === 0)) {
      const listed = new Set(lotsAround(time))
      for (let lot = 0; lot < time / RELEASE + 1; lot++) {
        if (lotAt(lot, time)) expect(listed.has(lot)).toBe(true)
      }
    }
  })

  it('works on one lot at a time at each step, and the bars on a row never overlap', () => {
    for (let step = 0; step < STEPS.length; step++) {
      for (let lot = 0; lot < 30; lot++) {
        expect(stepStart(lot, step) + processing(lot, step)).toBeLessThan(stepStart(lot + 1, step) - 0.5)
      }
    }
    const bars = boardBars()
    for (let step = 0; step < STEPS.length; step++) {
      const row = bars.filter((bar) => bar.step === step).sort((a, b) => a.start - b.start)
      row.forEach((bar, index) => {
        const next = row[(index + 1) % row.length]
        const gap = (next.start - bar.start - bar.length + CYCLE) % CYCLE
        expect(gap).toBeGreaterThan(0.5)
      })
    }
  })

  it('starts a machine when word from the plan reaches it', () => {
    for (let step = 0; step < STEPS.length; step++) {
      const start = stepStart(40, step)
      expect(working(step, start - 0.01)).toBeNull()
      expect(working(step, start + 0.01)).not.toBeNull()
      expect(pulsesAt(start - 0.02).find((pulse) => pulse.line === step)?.u).toBeGreaterThan(0.95)
      // The lot is in front of the machine while it works.
      expect(lotAt(40, start + 0.5)?.x).toBe(STEPS[step].x)
    }
    expect(ARRIVE).toHaveLength(STEPS.length)
  })

  it('loads lots only while a truck stands at the dock, and drives off out of sight', () => {
    for (const time of frames) {
      const truck = truckAt(time)
      for (const lot of lotsAround(time)) {
        const pose = lotAt(lot, time)
        if (pose && pose.x > PARK_X - 0.5) expect(truck?.offset).toBe(0)
      }
      const later = truckAt(time + STEP)
      if (truck && later && later.batch === truck.batch) expect(Math.abs(later.offset - truck.offset)).toBeLessThan(0.3)
    }
    // A truck stands at the dock most of the time.
    const parked = frames.filter((time) => truckAt(time)?.offset === 0).length
    expect(parked / frames.length).toBeGreaterThan(0.5)
  })

  it('packs each lot, stacks them two high and has the forklift carry each stack into the truck, clear of all else', () => {
    type Box = { x0: number; x1: number; z0: number; z1: number }
    const box = (x: number, z: number, half = 0.55): Box => ({ x0: x - half, x1: x + half, z0: z - half, z1: z + half })
    const meet = (a: Box, b: Box, give = 0.02) => a.x0 < b.x1 - give && b.x0 < a.x1 - give && a.z0 < b.z1 - give && b.z0 < a.z1 - give
    // The packing table as the entrance places it, the walls and the cut-down wall beside the
    // loading bay, and the forklift's outline from its fork heels: forks ahead, counterweight behind.
    const table = { x0: 12.43, x1: 14.77, z0: -0.95, z1: 1.14 }
    const walls = [
      { x0: 19.0, x1: 19.3, z0: -2.4, z1: 0.75 },
      { x0: 19.0, x1: 19.3, z0: 3.25, z1: 3.6 },
    ]
    const forklift = (x: number) => ({ x0: x - 2.055, x1: x + 1.106, z0: FORK_Z - 0.617, z1: FORK_Z + 0.617 })
    let last = forkliftAt(frames[0])
    for (const time of frames) {
      const forks = forkliftAt(time)
      expect(Math.abs(forks.x - last.x)).toBeLessThan(0.15)
      expect(Math.abs(forks.lift - last.lift)).toBeLessThan(0.05)
      last = forks
      const body = forklift(forks.x)
      expect(meet(body, table)).toBe(false)
      for (const wall of walls) expect(meet(body, wall)).toBe(false)
      const docked: { lot: number; y: number; at: Box }[] = []
      for (const lot of lotsAround(time)) {
        const pose = lotAt(lot, time)
        if (!pose || pose.x < STEPS[STEPS.length - 1].x + 0.6) continue
        // Packed by the time it leaves the packing table.
        expect(pose.packed).toBe(true)
        const at = box(pose.x, pose.z)
        for (const wall of walls) expect(meet(at, wall)).toBe(false)
        // Within the floor's front edge, and inside the truck's walls once in it.
        expect(at.z1).toBeLessThan(3.35)
        if (at.x1 > PARK_X) {
          expect(pose.y).toBeGreaterThanOrEqual(BED - 1e-9)
          expect(Math.abs(pose.z - LANE_Z)).toBeLessThanOrEqual(1.05 - 0.55 + 1e-9)
          expect(wingAt(time)).toBeGreaterThan(0)
        }
        if (forks.carrying.includes(lot)) {
          expect(pose.x).toBeCloseTo(forks.x + FORK_AHEAD, 6)
          expect(pose.z).toBeCloseTo(FORK_Z, 6)
          const below = Math.min(...forks.carrying.map((other) => lotAt(other, time)?.y ?? Infinity))
          expect([0, LOT_HEIGHT].some((rise) => Math.abs(pose.y - below - rise) < 1e-9)).toBe(true)
        } else if (pose.x < PARK_X && !forks.fetching.includes(lot)) {
          // The forklift only reaches under the stack it has come for.
          expect(meet(body, at)).toBe(false)
        }
        // Lots never meet but one resting a whole lot's height on another.
        for (const other of docked) {
          if (meet(other.at, at)) expect(Math.abs(other.y - pose.y)).toBeGreaterThanOrEqual(LOT_HEIGHT - 1e-9)
        }
        docked.push({ lot, y: pose.y, at })
      }
    }
  })

  it('raises the wing only while a truck stands at the dock, and sends each away full', () => {
    const period = TRUCK_LOTS * RELEASE
    const departures = frames.filter((time) => truckAt(time)?.offset === 0 && truckAt(time + STEP)?.offset !== 0)
    expect(departures).toHaveLength(Math.round((2 * CYCLE) / period))
    for (const time of frames) {
      const truck = truckAt(time)
      if (wingAt(time) > 0) expect(truck?.offset).toBe(0)
      // Into the truck only while its wing is up.
      const forks = forkliftAt(time)
      if (forks.carrying.length && forks.x > PARK_X - 1.2) expect(wingAt(time)).toBe(1)
    }
    // Each truck leaves with its lots on board and out of sight behind the wing.
    for (const time of departures) {
      const aboard = lotsAround(time).filter((lot) => (lotAt(lot, time - 2)?.x ?? 0) > PARK_X)
      expect(aboard.length).toBeGreaterThan(0)
      for (const lot of aboard) expect(lotAt(lot, time)).toBeNull()
    }
  })

  it('lets each deal drift in, then drop into a month or fade', () => {
    for (let card = 120; card < 140; card++) {
      const born = card * CARD_EVERY
      expect(cardAt(card, born - 0.01)).toBeNull()
      expect(cardAt(card, born + CARD_LIFE + 1e-6)).toBeNull()
      let last = cardAt(card, born)
      for (let time = born; time < born + CARD_LIFE; time += STEP) {
        const now = cardAt(card, time)!
        if (last) expect(Math.hypot(now.x - last.x, now.y - last.y, now.z - last.z)).toBeLessThan(0.2)
        last = now
      }
    }
  })

  it('moves the months left without a jump, rising at the right and sinking at the left', () => {
    let last = columnsAt(frames[0])
    for (const time of frames.slice(1)) {
      const now = columnsAt(time)
      for (const column of now) {
        const before = last.find((item) => item.month === column.month)
        if (!before) {
          expect(column.height).toBeLessThan(0.05)
          continue
        }
        expect(column.x).toBeLessThan(before.x)
        expect(Math.abs(column.height - before.height)).toBeLessThan(0.1)
      }
      last = now
    }
  })
})
