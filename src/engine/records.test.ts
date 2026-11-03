import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { addDays } from './dates'
import { runPlan } from './plan'
import { deliveriesOf, lotHistory, materialCover } from './records'
import { createDefaultSettings } from './settings'

const today = '2026-11-03'
const data = createSampleData(today)

describe('materialCover', () => {
  it('tells whether material on hand starts the pieces a part is short of', () => {
    expect(materialCover(data, 'A-100', 50)).toEqual({ kind: 'ready', pieces: 50 })
    expect(materialCover(data, 'B-200', 55)).toEqual({ kind: 'partly', pieces: 20, toOrder: 35 })
    expect(materialCover(data, 'D-410', 10)).toEqual({ kind: 'none', toOrder: 10 })
  })

  it('says nothing for a part whose material is not tracked', () => {
    const untracked = { ...data, parts: data.parts.map((part) => ({ ...part, materialStock: undefined })) }

    expect(materialCover(untracked, 'B-200', 55)).toBeNull()
  })
})

describe('lotHistory', () => {
  it('lists the steps a lot has been through, ending before it reached where it is', () => {
    const history = lotHistory(data, 'L1034-2')

    expect(history.map((actual) => [actual.stepIndex, actual.equipmentId, actual.good])).toEqual([
      [0, 'CUT-1', 12],
      [1, 'DRL-1', 12],
    ])
    expect(history.every((actual) => actual.end < `${data.lots.find((lot) => lot.id === 'L1034-2')!.arrivedOn}T00:00`)).toBe(true)
  })
})

describe('deliveriesOf', () => {
  it('compares each promised date with the forecast finish', () => {
    const plan = runPlan({ data, settings: createDefaultSettings(), adopted: [], today })
    const forecast = plan.result.orders.find((order) => order.orderId === '1045')
    const deliveries = deliveriesOf(data, '1045', forecast)

    // 1045 is forecast for 11/12: the first customer was promised 11/11, the second 11/13.
    expect(deliveries.map((entry) => [entry.customer, entry.quantity, entry.answered, entry.daysLate])).toEqual([
      ['取引先B', 15, '2026-11-11', 1],
      ['取引先C', 15, '2026-11-13', -1],
    ])
  })

  it('shows the sample missing one promise for 1045 whichever day it is opened', () => {
    for (let offset = 0; offset < 14; offset += 1) {
      const day = addDays('2026-11-02', offset)
      const sample = createSampleData(day)
      const plan = runPlan({ data: sample, settings: createDefaultSettings(), adopted: [], today: day })
      const [first] = deliveriesOf(sample, '1045', plan.result.orders.find((order) => order.orderId === '1045'))

      expect(first.daysLate, day).toBeGreaterThan(0)
    }
  })

  it('marks the promises of an order the plan cannot place', () => {
    const plan = runPlan({ data, settings: { ...createDefaultSettings(), stoppedEquipment: ['HT-1'] }, adopted: [], today })
    const deliveries = deliveriesOf(data, '1045', plan.result.orders.find((order) => order.orderId === '1045'))

    expect(deliveries.every((entry) => entry.unplanned && entry.daysLate === null)).toBe(true)
  })
})
