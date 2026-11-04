import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { orderDemands } from './demand'
import { monthReach, stagnantDays, summarizeProgress, summarizeWip, type WipColumn } from './progress'

const today = '2026-11-03'
const data = createSampleData(today)

function summarizeOrder(id: string) {
  const order = data.orders.find((candidate) => candidate.id === id)!
  return summarizeProgress([order], data.lots, data.routes[order.partNumber])
}

describe('summarizeProgress', () => {
  it('counts done pieces and lots per step for one order', () => {
    const summary = summarizeOrder('1021')

    expect(summary.steps.map((step) => step.done)).toEqual([150, 90, 0, 0])
    expect(summary.steps.map((step) => step.wipQuantity)).toEqual([0, 60, 90, 0])
    expect(summary.wip).toBe(150)
    expect(summary.wipLots).toHaveLength(2)
    expect(summary.unstarted).toBe(0)
    expect(summary.ratio).toBeCloseTo(80 / 200)
  })

  it('treats quantity not yet released as a lot as unstarted', () => {
    const summary = summarizeOrder('1034')

    expect(summary.unstarted).toBe(36)
    expect(summary.wip).toBe(54)
    expect(summary.steps.map((step) => step.done)).toEqual([54, 36, 0])
  })

  it('counts lots past the last step as finished', () => {
    const summary = summarizeOrder('1030')

    expect(summary.finished).toBe(18)
    expect(summary.wip).toBe(12)
    expect(summary.wipLots.map((lot) => lot.id)).toEqual(['L1030-1'])
    expect(summary.ratio).toBeCloseTo(46 / 50)
  })

  it('adds up every order of a part number', () => {
    const orders = data.orders.filter((order) => order.partNumber === 'A-100')
    const summary = summarizeProgress(orders, data.lots, data.routes['A-100'])

    expect(summary.quantity).toBe(255)
    expect(summary.unstarted).toBe(45)
    expect(summary.wip).toBe(210)
    expect(summary.wipLots).toHaveLength(3)
    expect(summary.steps[1].wipQuantity).toBe(120)
    expect(summary.ratio).toBeCloseTo(100 / 340)
  })

  it('shows nothing started for an order with no lots', () => {
    const summary = summarizeOrder('1040')

    expect(summary.unstarted).toBe(45)
    expect(summary.ratio).toBe(0)
    expect(summary.steps.every((step) => step.done === 0)).toBe(true)
  })
})

describe('stagnantDays', () => {
  it('counts calendar days since the lot arrived at its step', () => {
    const lot = data.lots.find((candidate) => candidate.id === 'L1022-1')!

    expect(stagnantDays(lot, today)).toBe(4)
  })
})

describe('summarizeWip', () => {
  const columns = summarizeWip(data, orderDemands(data, today))
  const at = (process: string) => columns.find((column) => column.process === process)!
  const brief = (column: WipColumn) =>
    Object.fromEntries(
      Object.entries(column.cells)
        .filter(([, cell]) => cell.quantity > 0)
        .map(([urgency, cell]) => [urgency, [cell.quantity, cell.lots.length]]),
    )

  it('lays out processes by crew between the unreleased and finished columns', () => {
    expect(columns.map((column) => column.process ?? column.kind)).toEqual([
      'unreleased',
      '切断',
      '曲げ',
      '溶接',
      '切削',
      'タップ',
      '熱処理',
      '研削',
      '穴あけ',
      '検査',
      '梱包',
      'finished',
    ])
    expect(at('研削').crew).toBe('機械班')
  })

  it('puts each lot where it sits, by why its order is needed', () => {
    expect(brief(at('曲げ'))).toEqual({ 'A-due': [120, 2] })
    expect(brief(at('梱包'))).toEqual({ 'A-stockout': [12, 1] })
    expect(brief(at('検査'))).toEqual({ B: [36, 1] })
    expect(brief(columns.at(-1)!)).toEqual({ 'A-stockout': [18, 1] })
  })

  it('counts pieces not yet released by order', () => {
    const unreleased = columns[0].cells

    expect(unreleased['A-stockout'].unreleased).toEqual([{ orderId: '1045', quantity: 90 }])
    expect(unreleased.B.quantity).toBe(81)
    expect(unreleased.C.quantity).toBe(120)
  })

  it("shows how far this month's pieces have got through each process", () => {
    expect(at('曲げ').thisMonth).toEqual({ quantity: 210, passed: 90, here: 120 })
    expect(at('梱包').thisMonth).toEqual({ quantity: 120, passed: 18, here: 12 })
    expect(at('穴あけ').thisMonth).toBeNull()
  })

  it('counts a lot as past a process only after its last visit', () => {
    const twice = { ...data, routes: { ...data.routes, 'A-100': [...data.routes['A-100']] } }
    twice.routes['A-100'].splice(3, 0, { ...twice.routes['A-100'][1] })
    const bending = summarizeWip(twice, orderDemands(twice, today)).find((column) => column.process === '曲げ')!

    expect(twice.routes['A-100'].map((step) => step.name)).toEqual(['切断', '曲げ', '溶接', '曲げ', '検査'])
    expect(bending.thisMonth).toEqual({ quantity: 210, passed: 0, here: 120 })
  })

  it('orders processes by how early they come in a route when there are no crews', () => {
    const noCrews = { ...data, crews: [] }
    const order = summarizeWip(noCrews, orderDemands(noCrews, today)).map((column) => column.process ?? column.kind)

    expect(order).toEqual([
      'unreleased',
      '切断',
      '切削',
      '曲げ',
      '熱処理',
      '穴あけ',
      'タップ',
      '溶接',
      '検査',
      '研削',
      '梱包',
      'finished',
    ])
  })
})

describe('monthReach', () => {
  it('counts what stock leaves for this month against the lots and the pieces not yet released', () => {
    // B-200 ships 4.5 a day: 28 days to 11/30 need 126. One lot of 12 is packing, 90 are not yet released.
    expect(monthReach(data, today)).toEqual([{ partNumber: 'B-200', need: 126, reach: { kind: 'short', pieces: 24 } }])
  })

  it('names the step whose lots, with those past it, first cover the month', () => {
    const busy = { ...data, parts: data.parts.map((part) => (part.partNumber === 'A-100' ? { ...part, stock: 90 } : part)) }
    const a100 = monthReach(busy, today).find((item) => item.partNumber === 'A-100')

    // 28 days of 9 a day is 252; stock 90 leaves 162. Welding holds 90 and bending 120.
    expect(a100).toEqual({ partNumber: 'A-100', need: 162, reach: { kind: 'lots', stepIndex: 1, stepName: '曲げ', pieces: 72 } })
  })

  it('reaches into the pieces not yet released once every lot is counted', () => {
    const busy = { ...data, parts: data.parts.map((part) => (part.partNumber === 'B-200' ? { ...part, monthlyUsage: 90 } : part)) }

    // 28 days of 3 a day is 84: the lot of 12 at packing, then 72 of the 90 not yet released.
    expect(monthReach(busy, today)).toEqual([{ partNumber: 'B-200', need: 84, reach: { kind: 'unreleased', pieces: 72 } }])
  })
})
