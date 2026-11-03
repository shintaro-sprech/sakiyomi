import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { compareSchedules } from './compare'
import { buildScenario, ChangeError, type Change } from './scenario'
import { schedule } from './scheduler'
import { createDefaultSettings } from './settings'
import type { Equipment, Lot, Order, PlantData, Routes, Settings } from './types'

// 2026-11-03 is a Tuesday and 2026-11-06 a Friday. Default hours are 08:00-17:00, Monday to Friday.
const TUESDAY = '2026-11-03'
const FRIDAY = '2026-11-06'

type PlanInput = {
  routes: Routes
  equipment: Equipment[]
  orders: Order[]
  lots?: Lot[]
  settings?: Partial<Settings>
  changes?: Change[]
  start?: string
}

function plan(input: PlanInput) {
  const start = input.start ?? TUESDAY
  const data: PlantData = {
    routes: input.routes,
    equipment: input.equipment,
    orders: input.orders,
    lots: input.lots ?? [],
  }
  const settings = { ...createDefaultSettings(), transferMinutes: 0, ...input.settings }
  return schedule(buildScenario(data, settings, input.changes ?? [], start), start)
}

function machine(id: string, process: string, setupMinutes = 0): Equipment {
  return { id, name: id, process, setupMinutes }
}

function order(id: string, partNumber: string, quantity: number, due: string, materialOn?: string): Order {
  return { id, partNumber, quantity, due, materialOn }
}

const oneStep = (name: string, minutesPerPiece: number) => [{ name, minutesPerPiece }]

describe('schedule', () => {
  it('pauses outside working hours and over the weekend', () => {
    const result = plan({
      start: FRIDAY,
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      orders: [order('1', 'P', 10, '2026-11-20')],
    })

    expect(result.operations).toHaveLength(1)
    expect(result.operations[0].startAt).toBe('2026-11-06T08:00')
    expect(result.operations[0].endAt).toBe('2026-11-09T09:00')
    expect(result.orders[0].finishDate).toBe('2026-11-09')
  })

  it('charges setup only when the part number changes, and weighs it against due dates', () => {
    const input = {
      routes: { P1: oneStep('加工', 60), P2: oneStep('加工', 60) },
      equipment: [machine('M1', '加工', 30)],
      orders: [order('A', 'P1', 1, '2026-11-10'), order('B', 'P2', 1, '2026-11-11'), order('C', 'P1', 1, '2026-11-12')],
    }

    const setupFirst = plan({ ...input, settings: { dueWeight: 0 } })
    expect(setupFirst.operations.map((operation) => [operation.orderId, operation.setupMinutes])).toEqual([
      ['A', 0],
      ['C', 0],
      ['B', 30],
    ])

    const dueFirst = plan({ ...input, settings: { dueWeight: 1 } })
    expect(dueFirst.operations.map((operation) => [operation.orderId, operation.setupMinutes])).toEqual([
      ['A', 0],
      ['B', 30],
      ['C', 30],
    ])
  })

  it('spreads work over equipment that runs the same step', () => {
    const result = plan({
      routes: { P: oneStep('溶接', 12) },
      equipment: [machine('W1', '溶接'), machine('W2', '溶接')],
      orders: [order('1', 'P', 10, '2026-11-10'), order('2', 'P', 10, '2026-11-10')],
    })

    expect(result.operations.map((operation) => operation.equipmentId).sort()).toEqual(['W1', 'W2'])
    expect(result.operations.every((operation) => operation.startAt === '2026-11-03T08:00')).toBe(true)
  })

  it('waits the transfer time between steps', () => {
    const result = plan({
      settings: { transferMinutes: 60 },
      routes: { P: [{ name: 'a', minutesPerPiece: 60 }, { name: 'b', minutesPerPiece: 60 }] },
      equipment: [machine('A', 'a'), machine('B', 'b')],
      orders: [order('1', 'P', 1, '2026-11-10')],
    })

    const [first, second] = result.operations.sort((x, y) => x.stepIndex - y.stepIndex)
    expect(first.endAt).toBe('2026-11-03T09:00')
    expect(second.startAt).toBe('2026-11-03T10:00')
  })

  it('holds unreleased quantity until its material arrives', () => {
    const result = plan({
      routes: { P: oneStep('加工', 10) },
      equipment: [machine('M1', '加工')],
      orders: [order('1', 'P', 6, '2026-11-20', '2026-11-05')],
    })

    expect(result.operations[0].planned).toBe(true)
    expect(result.operations[0].startAt).toBe('2026-11-05T08:00')
  })

  it('continues released lots from the step they are at', () => {
    const result = plan({
      routes: { P: [{ name: 'a', minutesPerPiece: 10 }, { name: 'b', minutesPerPiece: 10 }] },
      equipment: [machine('A', 'a'), machine('B', 'b')],
      orders: [order('1', 'P', 5, '2026-11-20')],
      lots: [{ id: 'L1', orderId: '1', quantity: 5, stepIndex: 1, arrivedOn: TUESDAY }],
    })

    expect(result.operations.map((operation) => [operation.lotId, operation.stepName])).toEqual([['L1', 'b']])
  })

  it('leaves stopped equipment out', () => {
    const result = plan({
      settings: { stoppedEquipment: ['W1'] },
      routes: { P: oneStep('溶接', 12) },
      equipment: [machine('W1', '溶接'), machine('W2', '溶接')],
      orders: [order('1', 'P', 10, '2026-11-10'), order('2', 'P', 10, '2026-11-10')],
    })

    expect(result.operations.map((operation) => operation.equipmentId)).toEqual(['W2', 'W2'])
  })

  it('reports steps no equipment can run instead of failing', () => {
    const result = plan({
      routes: { P: [{ name: '加工', minutesPerPiece: 10 }, { name: '塗装', minutesPerPiece: 10 }] },
      equipment: [machine('M1', '加工')],
      orders: [order('1', 'P', 3, '2026-11-20')],
    })

    expect(result.unscheduled).toEqual([
      { lotId: '1-未投入', orderId: '1', stepName: '塗装', reason: '「塗装」を担当できる設備がありません' },
    ])
    expect(result.orders[0]).toMatchObject({ status: 'unscheduled', late: true })
  })

  it('skips days the equipment is down', () => {
    const result = plan({
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      orders: [order('1', 'P', 1, '2026-11-20')],
      changes: [{ kind: 'equipmentDown', equipmentId: 'M1', from: TUESDAY, to: TUESDAY }],
    })

    expect(result.operations[0].startAt).toBe('2026-11-04T08:00')
  })

  it('works later on overtime days', () => {
    const result = plan({
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      orders: [order('1', 'P', 10, '2026-11-20')],
      changes: [{ kind: 'overtime', equipmentId: 'M1', from: TUESDAY, to: TUESDAY, minutesPerDay: 60 }],
    })

    expect(result.operations[0].endAt).toBe('2026-11-03T18:00')
  })

  it('works on a day off when holiday work is planned', () => {
    const result = plan({
      start: FRIDAY,
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      orders: [order('1', 'P', 10, '2026-11-20')],
      changes: [{ kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-07' }],
    })

    expect(result.operations[0].endAt).toBe('2026-11-07T09:00')
  })

  it('puts expedited orders first', () => {
    const result = plan({
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      orders: [order('A', 'P', 1, '2026-11-10'), order('B', 'P', 1, '2026-11-20')],
      changes: [{ kind: 'expedite', orderId: 'B' }],
    })

    expect(result.operations.map((operation) => operation.orderId)).toEqual(['B', 'A'])
  })

  it('gives the same plan for the same input', () => {
    const data = createSampleData(TUESDAY)
    const settings = createDefaultSettings()
    const first = schedule(buildScenario(data, settings, [], TUESDAY), TUESDAY)
    const second = schedule(buildScenario(data, settings, [], TUESDAY), TUESDAY)

    expect(second).toEqual(first)
  })

  it('plans every open order in the sample data', () => {
    const data = createSampleData(TUESDAY)
    const result = schedule(buildScenario(data, createDefaultSettings(), [], TUESDAY), TUESDAY)

    expect(result.unscheduled).toEqual([])
    expect(result.orders.every((forecast) => forecast.status !== 'unscheduled')).toBe(true)
  })
})

describe('buildScenario', () => {
  it('refuses a quantity below what is already released', () => {
    const data = createSampleData(TUESDAY)

    expect(() =>
      buildScenario(data, createDefaultSettings(), [{ kind: 'quantity', orderId: '1021', quantity: 40 }], TUESDAY),
    ).toThrow(ChangeError)
  })

  it('does not touch the data it was given', () => {
    const data = createSampleData(TUESDAY)
    const before = structuredClone(data)
    buildScenario(data, createDefaultSettings(), [{ kind: 'materialDelay', orderId: '1040', days: 3 }], TUESDAY)

    expect(data).toEqual(before)
  })
})

describe('compareSchedules', () => {
  it('finds orders that a material delay makes late', () => {
    const input = {
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      orders: [order('1', 'P', 8, TUESDAY)],
    }
    const before = plan(input)
    const after = plan({ ...input, changes: [{ kind: 'materialDelay', orderId: '1', days: 1 }] })
    const comparison = compareSchedules(before, after)

    expect(before.orders[0].late).toBe(false)
    expect(comparison.newlyLate).toEqual(['1'])
    expect(comparison.shifted[0]).toMatchObject({ before: TUESDAY, after: '2026-11-04', shiftDays: 1 })
    expect(comparison.lateAfter).toBe(1)
  })
})
