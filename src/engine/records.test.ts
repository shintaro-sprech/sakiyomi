import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { addDays, weekday } from './dates'
import { releaseTiming, runPlan } from './plan'
import { channelOutlook, deliveriesOf, lotHistory, materialCover } from './records'
import { createSampleSettings } from './settings'

const today = '2026-11-03'
const data = createSampleData(today)

describe('materialCover', () => {
  it('tells whether material on hand starts the pieces a part is short of', () => {
    expect(materialCover(data, 'A-100', 150)).toEqual({ kind: 'ready', pieces: 150 })
    expect(materialCover(data, 'B-200', 164)).toEqual({ kind: 'partly', pieces: 60, toOrder: 104 })
    expect(materialCover(data, 'D-410', 30)).toEqual({ kind: 'none', toOrder: 30 })
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
      [0, 'CUT-1', 36],
      [1, 'DRL-1', 36],
    ])
    expect(history.every((actual) => actual.end < `${data.lots.find((lot) => lot.id === 'L1034-2')!.arrivedOn}T00:00`)).toBe(true)
  })
})

describe('deliveriesOf', () => {
  it('compares each promised date with the forecast finish', () => {
    const plan = runPlan({ data, settings: createSampleSettings(), adopted: [], today })
    const forecast = plan.result.orders.find((order) => order.orderId === '1045')
    const deliveries = deliveriesOf(data, '1045', forecast)

    // 1045 is forecast for 11/12: the first customer was promised 11/10, the second 11/12.
    expect(deliveries.map((entry) => [entry.customer, entry.quantity, entry.answered, entry.daysLate])).toEqual([
      ['取引先B', 45, '2026-11-10', 2],
      ['取引先C', 45, '2026-11-12', 0],
    ])
  })

  it('shows the sample missing one promise for 1045 whichever day it is opened', () => {
    for (let offset = 0; offset < 14; offset += 1) {
      const day = addDays('2026-11-02', offset)
      const sample = createSampleData(day)
      const plan = runPlan({ data: sample, settings: createSampleSettings(), adopted: [], today: day })
      const [first] = deliveriesOf(sample, '1045', plan.result.orders.find((order) => order.orderId === '1045'))

      expect(first.daysLate, day).toBeGreaterThan(0)
    }
  })

  it('marks the promises of an order the plan cannot place', () => {
    const plan = runPlan({ data, settings: { ...createSampleSettings(), stoppedEquipment: ['HT-1'] }, adopted: [], today })
    const deliveries = deliveriesOf(data, '1045', plan.result.orders.find((order) => order.orderId === '1045'))

    expect(deliveries.every((entry) => entry.unplanned && entry.daysLate === null)).toBe(true)
  })
})

describe('channelOutlook', () => {
  const report = { customer: '取引先X', partNumber: 'A-100', asOf: '2026-10-31', stock: 40, monthlySales: 30 }
  const outlook = (entry: typeof report & { reorderDays?: number }) =>
    channelOutlook({ ...data, channelStocks: [entry] }, today)[0]

  it('counts what the distributor has ordered and not received as its stock', () => {
    // 取引先D has ordered 75 (order 1021) and 60 (order 1022) of A-100, not shipped yet.
    const [ordered] = channelOutlook({ ...data, channelStocks: [{ ...report, customer: '取引先D' }] }, today)
    expect(ordered).toMatchObject({ stockNow: 37, onOrder: 135, daysLeft: 172, orderOn: '2027-03-25' })
  })

  it('takes what was sold since the report off the stock and finds when the distributor orders', () => {
    // 30 a month is one a day: 37 left on 11/3, at the 30-day level on 11/10.
    expect(outlook(report)).toMatchObject({ stockNow: 37, onOrder: 0, daysLeft: 37, orderOn: '2026-11-10', orderQuantity: 30 })
    expect(outlook({ ...report, reorderDays: 45 })).toMatchObject({ orderOn: today })
  })

  it('expects no order from a distributor that sells nothing', () => {
    expect(outlook({ ...report, monthlySales: 0 })).toMatchObject({ stockNow: 40, daysLeft: null, orderOn: null })
  })
})

describe('releaseTiming', () => {
  const state = { data, settings: createSampleSettings(), adopted: [], today }

  it('gives the start once added, and the working day to order material by', () => {
    // With the machining center down until 11/27, D-410 starts after the work queued for it.
    const down = { kind: 'equipmentDown' as const, equipmentId: 'MC-1', from: today, to: '2026-11-27' }
    const timing = releaseTiming(state, { partNumber: 'D-410', quantity: 10, needBy: '2026-12-20' }, [down])

    // D-410 has no material on hand and takes 10 days: from Tuesday 12/1 that is Saturday 11/21,
    // so Friday 11/20.
    expect(timing).toEqual({
      startAt: '2026-12-01T20:00',
      materialOrderBy: '2026-11-20',
      materialLate: false,
      materialArrives: null,
      materialLeadDays: 10,
    })
    expect(weekday(timing.materialOrderBy!)).toBe(5)
  })

  it('says when material ordered today arrives, once the day to order it by has passed', () => {
    // Started on 11/3 as the plan finds the machine free, ten days after an order today.
    expect(releaseTiming(state, { partNumber: 'D-410', quantity: 10, needBy: '2026-12-20' })).toMatchObject({
      materialLate: true,
      materialArrives: addDays(today, 10),
    })
  })

  it('names no order date when material on hand covers it or its lead time is unknown', () => {
    expect(releaseTiming(state, { partNumber: 'A-100', quantity: 50, needBy: '2026-11-30' }).materialOrderBy).toBeNull()
    const unknown = { ...state, data: { ...data, parts: data.parts.map(({ materialLeadDays: _lead, ...part }) => part) } }
    expect(releaseTiming(unknown, { partNumber: 'D-410', quantity: 10, needBy: '2026-12-20' }).materialOrderBy).toBeNull()
  })
})
