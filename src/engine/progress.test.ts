import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { stagnantDays, summarizeProgress } from './progress'

const today = '2026-11-03'
const data = createSampleData(today)

function summarizeOrder(id: string) {
  const order = data.orders.find((candidate) => candidate.id === id)!
  return summarizeProgress([order], data.lots, data.routes[order.partNumber])
}

describe('summarizeProgress', () => {
  it('counts done pieces and lots per step for one order', () => {
    const summary = summarizeOrder('1021')

    expect(summary.steps.map((step) => step.done)).toEqual([50, 30, 0, 0])
    expect(summary.steps.map((step) => step.wipQuantity)).toEqual([0, 20, 30, 0])
    expect(summary.wip).toBe(50)
    expect(summary.wipLots).toHaveLength(2)
    expect(summary.unstarted).toBe(0)
    expect(summary.ratio).toBeCloseTo(80 / 200)
  })

  it('treats quantity not yet released as a lot as unstarted', () => {
    const summary = summarizeOrder('1034')

    expect(summary.unstarted).toBe(12)
    expect(summary.wip).toBe(18)
    expect(summary.steps.map((step) => step.done)).toEqual([18, 12, 0])
  })

  it('counts lots past the last step as finished', () => {
    const summary = summarizeOrder('1030')

    expect(summary.finished).toBe(6)
    expect(summary.wip).toBe(4)
    expect(summary.wipLots.map((lot) => lot.id)).toEqual(['L1030-1'])
    expect(summary.ratio).toBeCloseTo(46 / 50)
  })

  it('adds up every order of a part number', () => {
    const orders = data.orders.filter((order) => order.partNumber === 'A-100')
    const summary = summarizeProgress(orders, data.lots, data.routes['A-100'])

    expect(summary.quantity).toBe(85)
    expect(summary.unstarted).toBe(15)
    expect(summary.wip).toBe(70)
    expect(summary.wipLots).toHaveLength(3)
    expect(summary.steps[1].wipQuantity).toBe(40)
    expect(summary.ratio).toBeCloseTo(100 / 340)
  })

  it('shows nothing started for an order with no lots', () => {
    const summary = summarizeOrder('1040')

    expect(summary.unstarted).toBe(15)
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
