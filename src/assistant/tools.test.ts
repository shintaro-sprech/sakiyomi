import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import type { PlanState } from '../engine/plan'
import { createSampleSettings } from '../engine/settings'
import { TOOL_NAMES } from './toolSchemas'
import { changesToApply, describeSituation, executeTool } from './tools'

const today = '2026-11-03'
const state: PlanState = { data: createSampleData(today), settings: createSampleSettings(), adopted: [], today }

describe('executeTool', () => {
  it('tells Claude the open deals with their chances, apart from the plan and from the forecast', () => {
    const situation = describeSituation(state)
    const { deals, demandForecast } = situation

    expect(deals.chanceAvailable).toBe(true)
    expect(deals.open.length).toBe(14)
    expect(deals.open.every((deal) => deal.chance !== null && deal.chance > 0 && deal.chance < 1)).toBe(true)
    expect(deals.open.find((deal) => deal.partNumber === null)?.problems).toEqual(['型番が入っていません'])
    // Every month laid out comes from a deal counted at the threshold.
    const countedParts = new Set(deals.open.filter((deal) => deal.counted).map((deal) => deal.partNumber))
    expect(deals.byMonth.every((entry) => countedParts.has(entry.partNumber))).toBe(true)
    expect(demandForecast.lastMonth).toBe('2026-10')
    expect(demandForecast.series.map((entry) => entry.forecast.length)).toEqual([3, 3, 3, 3])
    // The deals are not among the plan's orders.
    expect(situation.orders.length).toBe(state.data.orders.length)
  })

  it('describes the current plan for Claude', () => {
    const situation = describeSituation(state)

    expect(situation.today).toBe(today)
    expect(situation.weekday).toBe('火')
    expect(situation.workdays).toBe('月火水木金')
    expect(situation.shifts).toBe('3交代（00:00・08:00・16:00に交代）')
    expect(situation.workHours).toBe('00:00-24:00')
    // Material for 104 of the 164 is not on hand; ordered today (7 days) it lands after the start.
    expect(situation.thisMonth.replenishments).toEqual([
      {
        partNumber: 'B-200',
        quantity: 164,
        needBy: '2026-11-25',
        startAt: '2026-11-09T00:00',
        materialOrderBy: '2026-11-02',
        materialLate: true,
        materialArrives: '2026-11-10',
      },
    ])
    expect(situation.orders.find((order) => order.id === '1045')?.deliveries[0]).toMatchObject({ answered: '2026-11-10', daysLate: 2 })
    expect(situation.orders.find((order) => order.id === '1045')).toMatchObject({
      unstarted: 90,
      forecastFinish: '2026-11-12T09:10',
      lateDays: 0,
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
      before: '2026-11-12T09:10',
      after: '2026-11-15T15:00',
    })
    expect(state.adopted).toEqual([])
  })

  it('shows the plan of one order with changes applied', () => {
    const delay = { kind: 'materialDelay', orderId: '1045', days: 2 }
    const current = JSON.parse(executeTool(TOOL_NAMES.getOrderPlan, { orderId: '1045' }, state).content)
    const delayed = JSON.parse(executeTool(TOOL_NAMES.getOrderPlan, { orderId: '1045', changes: [delay] }, state).content)

    expect(current.forecastFinish).toBe('2026-11-12T09:10')
    expect(delayed.changes).toEqual(['注番1045の材料が2日遅れる'])
    expect(delayed.forecastFinish).toBe('2026-11-15T15:00')
    expect(delayed.operations[0]).toMatchObject({ lot: 'L1045-1', planned: true, start: '2026-11-06T00:00' })
    expect(state.adopted).toEqual([])
  })

  it('computes the effect of each option itself', () => {
    const outcome = executeTool(
      TOOL_NAMES.presentOptions,
      {
        event: [{ kind: 'materialDelay', orderId: '1045', days: 2 }],
        options: [
          {
            title: 'マシニング1を土曜に動かす',
            changes: [{ kind: 'holidayWork', equipmentId: 'MC-1', date: '2026-11-07' }],
            reason: 'マシニング1が詰まっている',
            tradeoff: '休日出勤が増える',
          },
        ],
      },
      state,
    )

    expect(outcome.isError).toBe(false)
    expect(outcome.event?.labels).toEqual(['注番1045の材料が2日遅れる'])
    expect(outcome.event?.effect.comparison.newlyLate).toEqual(['1045'])
    expect(outcome.options?.[0].labels[0]).toBe('マシニング1を11/7に休日出勤で動かす')
    expect(outcome.options?.[0].effect.holidayHoursDelta).toBe(24)
    expect(outcome.options?.[0].effect.grossProfitDelta).toBeLessThan(0)
  })

  it('refuses overtime on a day the three shifts already fill', () => {
    const outcome = executeTool(
      TOOL_NAMES.presentOptions,
      {
        event: [],
        options: [
          {
            title: '残業する',
            changes: [{ kind: 'overtime', equipmentId: 'MC-1', from: '2026-11-04', to: '2026-11-04', minutesPerDay: 120 }],
            reason: 'r',
            tradeoff: 't',
          },
        ],
      },
      state,
    )

    expect(outcome.isError).toBe(true)
    expect(outcome.options).toBeUndefined()
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
      { kind: 'holidayWork', equipmentId: 'DRL-1', date: '2026-11-08' },
    ]
    const simulated = JSON.parse(executeTool(TOOL_NAMES.simulateChanges, { changes: [...lend, ...weekend] }, state).content)
    const presented = executeTool(
      TOOL_NAMES.presentOptions,
      { event: lend, options: [{ title: '週末に取り戻す', changes: weekend, reason: 'r', tradeoff: 't' }] },
      state,
    )

    expect(simulated.unusedChanges).toEqual(['ボール盤1を11/8に休日出勤で動かす'])
    expect(presented.isError).toBe(true)
    expect(presented.content).toContain('案「週末に取り戻す」の「ボール盤1を11/8に休日出勤で動かす」')
    expect(presented.options).toBeUndefined()
  })

  it('tells Claude how many people each crew has', () => {
    const crew = describeSituation(state).crews.find((item) => item.name === '機械班')

    expect(crew?.equipment).toEqual(['MC-1', 'HT-1', 'GRD-1', 'DRL-1'])
    expect(describeSituation(state).equipment.find((item) => item.id === 'MC-1')?.lastPart).toBe('B-200')
    expect(crew?.days.find((day) => day.date === '2026-11-05')?.people).toBe(1)
    // One of them can set the machines up, on days off too.
    expect(crew?.usualSetupPeople).toBe(1)
    expect(crew?.days.filter((day) => day.setupPeople !== 1)).toEqual([])
  })

  it('tells Claude how the order is sold and what the distributors hold', () => {
    const situation = describeSituation(state)
    const distributor = (customer: string, partNumber: string) =>
      situation.distributorStock.find((entry) => entry.customer === customer && entry.partNumber === partNumber)

    expect(situation.orders.find((order) => order.id === '1022')?.deliveries[0]).toMatchObject({ customer: '取引先D', channel: 'distributor' })
    expect(situation.orders.find((order) => order.id === '1030')?.deliveries[0]).toMatchObject({ channel: 'direct' })
    // Reported on 10/31: 18 left selling 60 a month is 12 on 11/3, six days of sales, so an order is due now.
    expect(distributor('取引先E', 'B-200')).toMatchObject({ stockNow: 12, daysLeft: 6, orderOn: today, orderQuantity: 60 })
    // 150 selling 90 a month is 141 on 11/3; with 135 ordered and not shipped, 92 days, at 30 days on 1/4.
    expect(distributor('取引先D', 'A-100')).toMatchObject({ stockNow: 141, onOrder: 135, daysLeft: 92, orderOn: '2027-01-04' })
  })

  it('tells Claude which processes each machine takes and how fast it runs', () => {
    const equipment = describeSituation(state).equipment
    const machine = (id: string) => equipment.find((item) => item.id === id)

    expect(machine('MC-1')).toMatchObject({ processes: ['切削', 'タップ'], speed: 1 })
    expect(machine('BND-1')).toMatchObject({ processes: ['曲げ'], speed: 1.2 })
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
