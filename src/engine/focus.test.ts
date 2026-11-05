import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { todayFocus } from './focus'
import { releaseTiming, runPlan, type PlanState } from './plan'
import type { Change } from './scenario'
import { createSampleSettings } from './settings'

const today = '2026-11-03'
const state: PlanState = { data: createSampleData(today), settings: createSampleSettings(), adopted: [], today }
const focus = (changes: Change[] = []) =>
  todayFocus(runPlan(state, changes), today, (item) => releaseTiming(state, item, changes))

describe('todayFocus', () => {
  it('puts material to order first, then a distributor, a promise the plan breaks and stock running out', () => {
    expect(focus()).toEqual([
      {
        kind: 'orderMaterial',
        partNumber: 'B-200',
        onHand: 60,
        toOrder: 104,
        startAt: '2026-11-09T00:00',
        orderBy: null,
        arrives: '2026-11-10',
        leadDays: 7,
      },
      { kind: 'distributorOrder', customer: '取引先E', partNumber: 'B-200', quantity: 60, on: today, stockNow: 12, daysLeft: 6 },
      { kind: 'promiseMissed', orderId: '1045', customer: '取引先B', answered: '2026-11-10', finishDate: '2026-11-12', daysLate: 2 },
      // Material ordered today comes on 11/10, too late for the shortage from 11/5, so both show.
      { kind: 'shortage', partNumber: 'B-200', from: '2026-11-05', maxShortage: 29 },
    ])
  })

  it('lists an order late for its due date once, not its promises as well', () => {
    const items = focus([{ kind: 'materialDelay', orderId: '1045', days: 5 }])

    expect(items.some((item) => item.kind === 'lateOrder' && item.orderId === '1045')).toBe(true)
    expect(items.some((item) => item.kind === 'promiseMissed' && item.orderId === '1045')).toBe(false)
  })

  it('keeps to the limit', () => {
    expect(todayFocus(runPlan(state), today, (item) => releaseTiming(state, item), 2)).toHaveLength(2)
  })
})
