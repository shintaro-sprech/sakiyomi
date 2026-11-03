import { describe, expect, it } from 'vitest'

import { monthlyOutlook, unusedChanges } from './economics'
import { runPlan } from './plan'
import type { Change } from './scenario'
import { createDefaultSettings } from './settings'
import type { PlantData } from './types'

// One machine that costs 10 yen a minute, labor at 50 yen a minute.
function plant(quantity: number, stock = 100, monthlyUsage = 0): PlantData {
  return {
    parts: [{ partNumber: 'P', shape: '丸物', price: 10000, materialCost: 4000, stock, monthlyUsage }],
    routes: { P: [{ name: '加工', minutesPerPiece: 60 }] },
    equipment: [{ id: 'M1', name: 'M1', process: '加工', setupMinutes: 0, hourlyCost: 600 }],
    setupRules: [],
    crews: [],
    attendance: [],
    orders: [{ id: '1', partNumber: 'P', quantity, due: '2026-12-31' }],
    lots: [],
  }
}

function outlook(data: PlantData, today: string, changes: Change[] = []) {
  const settings = { ...createDefaultSettings(), transferMinutes: 0, laborRate: 3000 }
  return monthlyOutlook(runPlan({ data, settings, adopted: changes, today }), today)
}

describe('monthlyOutlook', () => {
  it('takes material, labor and machine cost from revenue', () => {
    const result = outlook(plant(1), '2026-11-03')

    expect(result).toMatchObject({
      month: '2026-11',
      completedPieces: 1,
      revenue: 10000,
      materialCost: 4000,
      laborCost: 3000,
      machineCost: 600,
      grossProfit: 2400,
      regularHours: 1,
    })
  })

  it('adds the overtime premium to time past the end of the day', () => {
    const result = outlook(plant(10), '2026-11-03', [
      { kind: 'overtime', equipmentId: 'M1', from: '2026-11-03', to: '2026-11-03', minutesPerDay: 60 },
    ])

    expect(result.regularHours).toBe(9)
    expect(result.overtimeHours).toBe(1)
    expect(result.laborCost).toBe(50 * (540 + 60 * 1.25))
  })

  it('adds the holiday premium to work on a day off', () => {
    // 2026-11-06 is a Friday.
    const result = outlook(plant(10), '2026-11-06', [{ kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-07' }])

    expect(result.holidayHours).toBe(1)
    expect(result.laborCost).toBe(50 * (540 + 60 * 1.35))
  })

  it('counts revenue only for what is finished this month, and costs only for work done this month', () => {
    // 2026-11-30 is a Monday; the order finishes on 12/1.
    const result = outlook(plant(10), '2026-11-30')

    expect(result.revenue).toBe(0)
    expect(result.regularHours).toBe(9)
  })

  it('projects when stock runs short and when finished lots refill it', () => {
    const result = outlook(plant(10, 0, 30), '2026-11-03')

    expect(result.shortages).toEqual([
      { partNumber: 'P', from: '2026-11-03', until: '2026-11-04', maxShortage: 1 },
      { partNumber: 'P', from: '2026-11-13', until: null, maxShortage: 49 },
    ])
  })
})

describe('unusedChanges', () => {
  const today = '2026-11-06'
  const settings = { ...createDefaultSettings(), transferMinutes: 0 }
  const unused = (quantity: number, changes: Change[]) =>
    unusedChanges(runPlan({ data: plant(quantity), settings, adopted: changes, today }), changes, today)

  it('finds holiday work on a day when nothing is left to run', () => {
    // 2026-11-06 is a Friday: one piece is done that day, so Saturday has nothing to run.
    const saturday: Change = { kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-07' }

    expect(unused(1, [saturday])).toEqual([saturday])
    expect(unused(10, [saturday])).toEqual([])
  })

  it('keeps overtime that work runs into', () => {
    const friday: Change = { kind: 'overtime', equipmentId: 'M1', from: '2026-11-06', to: '2026-11-06', minutesPerDay: 60 }

    expect(unused(10, [friday])).toEqual([])
    expect(unused(1, [friday])).toEqual([friday])
  })
})
