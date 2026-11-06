import { describe, expect, it } from 'vitest'

import { MINUTES_PER_DAY } from './dates'
import { runPlan } from './plan'
import { createDefaultSettings } from './settings'
import type { PlantData, Settings } from './types'
import { nextShiftStart } from './workingClock'

// 2026-11-06 is a Friday. Two machines on a day shift from 08:00 to 17:00, Monday to Friday.
const today = '2026-11-06'

function plant(): PlantData {
  return {
    parts: [{ partNumber: 'P', shape: '丸物', price: 0, materialCost: 0, stock: 0, monthlyUsage: 0 }],
    routes: { P: [{ name: '加工', minutesPerPiece: 60 }] },
    equipment: [
      { id: 'M1', name: 'M1', processes: ['加工'], setupMinutes: 0, hourlyCost: 0 },
      { id: 'M2', name: 'M2', processes: ['加工'], setupMinutes: 0, hourlyCost: 0 },
    ],
    setupRules: [],
    crews: [],
    attendance: [],
    orders: [],
    lots: [],
  }
}

function startAfter(day: number, clock: string, settings: Partial<Settings> = {}) {
  const [hours, minutes] = clock.split(':').map(Number)
  const plan = runPlan({ data: plant(), settings: { ...createDefaultSettings(), ...settings }, adopted: [], today })
  return nextShiftStart(plan, day * MINUTES_PER_DAY + hours * 60 + minutes)
}

describe('nextShiftStart', () => {
  it('is none while a machine is in its working hours', () => {
    expect(startAfter(0, '10:00')).toBeNull()
  })

  it('is the same morning before the shift starts', () => {
    expect(startAfter(0, '06:30')).toBe(8 * 60)
  })

  it('skips the weekend after the Friday shift ends', () => {
    // Friday 22:37 -> Monday 08:00, three days on.
    expect(startAfter(0, '22:37')).toBe(3 * MINUTES_PER_DAY + 8 * 60)
  })

  it('leaves out a stopped machine and is none when every machine is stopped', () => {
    expect(startAfter(0, '10:00', { stoppedEquipment: ['M1'] })).toBeNull()
    expect(startAfter(0, '10:00', { stoppedEquipment: ['M1', 'M2'] })).toBeNull()
  })
})
