import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { runPlan } from './plan'
import { buildScenario, ChangeError, pinAddedOrders, sameChange, type Change } from './scenario'
import { createDefaultSettings } from './settings'

const today = '2026-11-03'
const data = createSampleData(today)
const settings = createDefaultSettings()

describe('added orders', () => {
  const addB: Change = { kind: 'addOrder', partNumber: 'B-200', quantity: 10, due: '2026-11-30' }
  const addC: Change = { kind: 'addOrder', partNumber: 'C-310', quantity: 20, due: '2026-12-10' }

  it('keep the number they were adopted with when an earlier decision is undone', () => {
    const first = pinAddedOrders(data, settings, [], [addB], today)
    const second = pinAddedOrders(data, settings, first, [addC, { kind: 'hold', orderId: '追加2', until: '2026-11-20' }], today)

    expect(first).toEqual([{ ...addB, orderId: '追加1' }])
    // With the first decision undone, the hold still finds C-310 under 追加2.
    const scenario = buildScenario(data, settings, second, today)
    expect(scenario.data.orders.find((order) => order.id === '追加2')?.partNumber).toBe('C-310')
    expect(scenario.holds).toEqual([{ orderId: '追加2', until: '2026-11-20' }])
  })

  it('match the same change before its number is pinned', () => {
    expect(sameChange(addB, { ...addB, orderId: '追加1' })).toBe(true)
    expect(sameChange(addB, addC)).toBe(false)
  })
})

describe('runPlan', () => {
  const lost: Change = { kind: 'hold', orderId: '追加9', until: '2026-11-20' }

  it('leaves out an adopted change that no longer applies, so the plan still shows', () => {
    const plan = runPlan({ data, settings, adopted: [lost], today })

    expect(plan.skipped).toEqual([lost])
    expect(plan.result.operations.length).toBeGreaterThan(0)
  })

  it('still refuses a what-if change that cannot apply', () => {
    expect(() => runPlan({ data, settings, adopted: [], today }, [lost])).toThrow(ChangeError)
  })
})
