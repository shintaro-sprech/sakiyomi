import { describe, expect, it } from 'vitest'

import {
  ARRIVE,
  boardBars,
  cardAt,
  CARD_EVERY,
  CARD_LIFE,
  columnsAt,
  CYCLE,
  lotAt,
  lotsAround,
  PARK_X,
  processing,
  pulsesAt,
  RELEASE,
  stepStart,
  STEPS,
  truckAt,
  WARM,
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
