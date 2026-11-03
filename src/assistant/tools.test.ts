import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import type { PlanState } from '../engine/plan'
import { createDefaultSettings } from '../engine/settings'
import { TOOL_NAMES } from './toolSchemas'
import { changesToApply, describeSituation, executeTool } from './tools'

const today = '2026-11-03'
const state: PlanState = { data: createSampleData(today), settings: createDefaultSettings(), adopted: [], today }

describe('executeTool', () => {
  it('describes the current plan for Claude', () => {
    const situation = describeSituation(state)

    expect(situation.today).toBe(today)
    expect(situation.workdays).toBe('月火水木金')
    expect(situation.orders.find((order) => order.id === '1045')).toMatchObject({
      unstarted: 30,
      forecastFinish: '2026-11-12T12:10',
      lateDays: -1,
    })
  })

  it('simulates a material delay without touching the plan', () => {
    const outcome = executeTool(
      TOOL_NAMES.simulateChanges,
      { changes: [{ kind: 'materialDelay', orderId: '1045', days: 2 }] },
      state,
    )
    const result = JSON.parse(outcome.content)

    expect(outcome.isError).toBe(false)
    expect(result.changes).toEqual(['注番1045の材料が2日遅れる'])
    expect(result.newlyLate).toEqual(['1045'])
    expect(state.adopted).toEqual([])
  })

  it('computes the effect of each option itself', () => {
    const outcome = executeTool(
      TOOL_NAMES.presentOptions,
      {
        event: [{ kind: 'materialDelay', orderId: '1045', days: 2 }],
        options: [
          {
            title: 'B-200の3工程で残業',
            changes: ['MC-1', 'HT-1', 'GRD-1'].map((equipmentId) => ({
              kind: 'overtime',
              equipmentId,
              from: '2026-11-03',
              to: '2026-11-13',
              minutesPerDay: 120,
            })),
            reason: 'マシニング1が詰まっている',
            tradeoff: '残業が増える',
          },
        ],
      },
      state,
    )

    expect(outcome.isError).toBe(false)
    expect(outcome.event?.labels).toEqual(['注番1045の材料が2日遅れる'])
    expect(outcome.event?.comparison.newlyLate).toEqual(['1045'])
    expect(outcome.options?.[0].labels[0]).toBe('マシニング1で11/3〜11/13に、1日120分残業する')
    expect(outcome.options?.[0].comparison.lateAfter).toBe(0)
  })

  it('adds the event only once across decisions', () => {
    const outcome = executeTool(
      TOOL_NAMES.presentOptions,
      {
        event: [{ kind: 'materialDelay', orderId: '1045', days: 2 }],
        options: [{ title: '優先する', changes: [{ kind: 'expedite', orderId: '1045' }], reason: 'r', tradeoff: 't' }],
      },
      state,
    )
    const option = outcome.options![0]

    expect(changesToApply(option, []).changes).toHaveLength(2)
    expect(changesToApply(option, [{ kind: 'materialDelay', orderId: '1045', days: 2 }]).changes).toEqual([
      { kind: 'expedite', orderId: '1045' },
    ])
  })

  it('returns problems as tool errors so Claude can correct itself', () => {
    const missing = executeTool(TOOL_NAMES.simulateChanges, { changes: [{ kind: 'expedite', orderId: '9999' }] }, state)
    const malformed = executeTool(TOOL_NAMES.simulateChanges, { changes: [{ kind: 'overtime', equipmentId: 'MC-1' }] }, state)
    const unknown = executeTool('delete_everything', {}, state)

    expect(missing).toEqual({ content: '注番9999は見つかりません', isError: true })
    expect(malformed.isError).toBe(true)
    expect(unknown.isError).toBe(true)
  })
})
