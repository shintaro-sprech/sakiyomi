import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { createDefaultSettings } from '../engine/settings'
import type { Settings } from '../engine/types'
import { withSampleAdditions, withShiftSettings, type SavedState } from './store'

const today = '2026-11-04'

// What a browser kept before shifts: a day shift, no night premium, a third of the quantities.
function savedBeforeShifts(dataSource: SavedState['dataSource']): SavedState {
  const { shifts: _shifts, nightPremium: _night, ...settings } = createDefaultSettings()
  const data = createSampleData(today)
  return {
    version: 3,
    data: { ...data, orders: data.orders.map((order) => ({ ...order, quantity: order.quantity / 3 })) },
    settings: { ...settings, laborRate: 2800 } as Settings,
    decisions: [
      { id: 'd1', at: '2026-11-03T09:00:00Z', title: '1022を30個に', changes: [], labels: [], reason: '', tradeoff: '', note: '' },
    ],
    dataSource,
  }
}

describe('withSampleAdditions', () => {
  it('gives the crews of a sample saved before the holiday people the sample\'s, and keeps them once set', () => {
    const fresh = createSampleData(today)
    const saved = { ...savedBeforeShifts('sample'), data: { ...fresh, crews: fresh.crews.map(({ holidayPeople: _holiday, ...crew }) => crew) } }
    const upgraded = withSampleAdditions(saved)

    expect(upgraded.data.crews.map((crew) => crew.holidayPeople)).toEqual([1, 1, 1])
    const changed = { ...saved, data: { ...fresh, crews: fresh.crews.map((crew) => ({ ...crew, holidayPeople: 0 })) } }
    expect(withSampleAdditions(changed).data.crews.map((crew) => crew.holidayPeople)).toEqual([0, 0, 0])
  })
})

describe('withShiftSettings', () => {
  it('makes a sample saved before shifts afresh and keeps the other settings', () => {
    const upgraded = withShiftSettings(savedBeforeShifts('sample'), today)

    expect(upgraded.data.orders).toEqual(createSampleData(today).orders)
    expect(upgraded.decisions).toEqual([])
    expect(upgraded.settings).toMatchObject({ shifts: 3, workStart: '08:00', workEnd: '17:00', nightPremium: 0.25, laborRate: 2800 })
  })

  it('keeps data read from Excel and its day shift', () => {
    const saved = savedBeforeShifts('excel')
    const upgraded = withShiftSettings(saved, today)

    expect(upgraded.data).toBe(saved.data)
    expect(upgraded.decisions).toBe(saved.decisions)
    expect(upgraded.settings).toMatchObject({ shifts: 1, workStart: '08:00', workEnd: '17:00', nightPremium: 0.25 })
  })

  it('leaves settings that already have shifts as they are', () => {
    const saved = { ...savedBeforeShifts('sample'), settings: { ...createDefaultSettings(), shifts: 1 as const } }

    expect(withShiftSettings(saved, today)).toBe(saved)
  })
})
