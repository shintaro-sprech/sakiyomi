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
    expect(result.shifted.find((shift: { orderId: string }) => shift.orderId === '1045')).toMatchObject({
      before: '2026-11-12T12:10',
      after: '2026-11-16T13:45',
    })
    expect(state.adopted).toEqual([])
  })

  it('shows the plan of one order with changes applied', () => {
    const delay = { kind: 'materialDelay', orderId: '1045', days: 2 }
    const current = JSON.parse(executeTool(TOOL_NAMES.getOrderPlan, { orderId: '1045' }, state).content)
    const delayed = JSON.parse(executeTool(TOOL_NAMES.getOrderPlan, { orderId: '1045', changes: [delay] }, state).content)

    expect(current.forecastFinish).toBe('2026-11-12T12:10')
    expect(delayed.changes).toEqual(['注番1045の材料が2日遅れる'])
    expect(delayed.forecastFinish).toBe('2026-11-16T13:45')
    expect(delayed.operations[0].start).toBe('2026-11-06T08:00')
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
    expect(outcome.event?.effect.comparison.newlyLate).toEqual(['1045'])
    expect(outcome.options?.[0].labels[0]).toBe('マシニング1で11/3〜11/13に、1日120分残業する')
    expect(outcome.options?.[0].effect.comparison.lateAfter).toBe(0)
    expect(outcome.options?.[0].effect.overtimeHoursDelta).toBeGreaterThan(0)
    expect(outcome.options?.[0].effect.grossProfitDelta).toBeLessThan(0)
  })

  it('simulates someone of a crew being off', () => {
    const outcome = executeTool(
      TOOL_NAMES.simulateChanges,
      { changes: [{ kind: 'headcount', crew: '機械班', from: '2026-11-04', to: '2026-11-10', people: 1 }] },
      state,
    )
    const result = JSON.parse(outcome.content)

    expect(outcome.isError).toBe(false)
    expect(result.changes).toEqual(['機械班を11/4〜11/10は1人にする'])
    expect(result.shifted.length).toBeGreaterThan(0)
  })

  it("lets an option's headcount override the event's on the same days", () => {
    const outcome = executeTool(
      TOOL_NAMES.presentOptions,
      {
        event: [{ kind: 'headcount', crew: '機械班', from: '2026-11-04', to: '2026-11-06', people: 0 }],
        options: [
          {
            title: '応援を取りやめる',
            changes: [{ kind: 'headcount', crew: '機械班', from: '2026-11-04', to: '2026-11-06', people: 2 }],
            reason: 'r',
            tradeoff: 't',
          },
        ],
      },
      state,
    )
    const result = JSON.parse(outcome.content)

    expect(result.ifNothingIsDone.newlyLate).toEqual(['1045'])
    expect(result.options[0].newlyLate).toEqual([])
  })

  it('tells which overtime and holiday work nothing runs in', () => {
    const lend = [
      { kind: 'headcount', crew: '機械班', from: '2026-11-04', to: '2026-11-04', people: 1 },
      { kind: 'headcount', crew: '機械班', from: '2026-11-05', to: '2026-11-05', people: 0 },
      { kind: 'headcount', crew: '機械班', from: '2026-11-06', to: '2026-11-06', people: 1 },
      { kind: 'headcount', crew: '板金班', from: '2026-11-04', to: '2026-11-06', people: 4 },
    ]
    const weekend = [
      { kind: 'holidayWork', equipmentId: 'MC-1', date: '2026-11-07' },
      { kind: 'holidayWork', equipmentId: 'HT-1', date: '2026-11-08' },
    ]
    const simulated = JSON.parse(executeTool(TOOL_NAMES.simulateChanges, { changes: [...lend, ...weekend] }, state).content)
    const presented = executeTool(
      TOOL_NAMES.presentOptions,
      { event: lend, options: [{ title: '週末に取り戻す', changes: weekend, reason: 'r', tradeoff: 't' }] },
      state,
    )

    expect(simulated.unusedChanges).toEqual(['熱処理炉1を11/8に休日出勤で動かす'])
    expect(presented.isError).toBe(true)
    expect(presented.content).toContain('案「週末に取り戻す」の「熱処理炉1を11/8に休日出勤で動かす」')
    expect(presented.options).toBeUndefined()
  })

  it('tells Claude how many people each crew has', () => {
    const crew = describeSituation(state).crews.find((item) => item.name === '機械班')

    expect(crew?.equipment).toEqual(['MC-1', 'HT-1', 'GRD-1', 'DRL-1'])
    expect(crew?.days.find((day) => day.date === '2026-11-05')?.people).toBe(1)
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
