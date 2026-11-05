import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { compareSchedules } from './compare'
import { buildScenario, ChangeError, type Change } from './scenario'
import { plannedLotId, schedule } from './scheduler'
import { createDefaultSettings } from './settings'
import type { Attendance, Crew, Equipment, Lot, Order, Part, PlantData, Routes, SetupRule, Settings } from './types'

// 2026-11-03 is a Tuesday and 2026-11-06 a Friday. Default hours are 08:00-17:00, Monday to Friday.
const TUESDAY = '2026-11-03'
const FRIDAY = '2026-11-06'

type PlanInput = {
  parts?: Part[]
  setupRules?: SetupRule[]
  crews?: Crew[]
  attendance?: Attendance[]
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
    parts: input.parts ?? [],
    setupRules: input.setupRules ?? [],
    crews: input.crews ?? [],
    attendance: input.attendance ?? [],
    routes: input.routes,
    equipment: input.equipment,
    orders: input.orders,
    lots: input.lots ?? [],
  }
  const settings = { ...createDefaultSettings(), transferMinutes: 0, ...input.settings }
  return schedule(buildScenario(data, settings, input.changes ?? [], start), start)
}

function machine(id: string, process: string | string[], setupMinutes = 0, speed?: number): Equipment {
  return { id, name: id, processes: [process].flat(), setupMinutes, hourlyCost: 0, ...(speed ? { speed } : {}) }
}

function part(partNumber: string, shape: string, stock = 1000, monthlyUsage = 0): Part {
  return { partNumber, shape, price: 0, materialCost: 0, stock, monthlyUsage }
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

  it('runs through the night with three shifts and stops for the weekend', () => {
    const result = plan({
      start: FRIDAY,
      settings: { shifts: 3 },
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      orders: [order('1', 'P', 30, '2026-11-20')],
    })

    // 30 hours from Friday 00:00: all of Friday, then Monday from 00:00 to 06:00.
    expect(result.operations[0].startAt).toBe('2026-11-06T00:00')
    expect(result.operations[0].endAt).toBe('2026-11-09T06:00')
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

  it('runs a multi-tasking machine on any of its processes, with no transfer between steps it takes in a row', () => {
    const result = plan({
      settings: { transferMinutes: 60 },
      routes: {
        P: [
          { name: '切削', minutesPerPiece: 60 },
          { name: '穴あけ', minutesPerPiece: 30 },
        ],
        Q: oneStep('穴あけ', 60),
      },
      equipment: [machine('MC', ['切削', '穴あけ']), machine('DR', '穴あけ')],
      orders: [order('1', 'P', 1, '2026-11-10'), order('2', 'Q', 1, '2026-11-10')],
    })

    const steps = (orderId: string) =>
      result.operations
        .filter((operation) => operation.orderId === orderId)
        .sort((a, b) => a.stepIndex - b.stepIndex)
        .map((operation) => [operation.equipmentId, operation.startAt, operation.endAt])
    // Q's drilling takes the drill; P's goes on right after its cutting on the same machine.
    expect(steps('2')).toEqual([['DR', '2026-11-03T08:00', '2026-11-03T09:00']])
    expect(steps('1')).toEqual([
      ['MC', '2026-11-03T08:00', '2026-11-03T09:00'],
      ['MC', '2026-11-03T09:00', '2026-11-03T09:30'],
    ])
  })

  it('waits the transfer time when the next step moves to another machine', () => {
    const result = plan({
      settings: { transferMinutes: 60 },
      routes: {
        P: [
          { name: '切削', minutesPerPiece: 60 },
          { name: '穴あけ', minutesPerPiece: 30 },
        ],
      },
      equipment: [machine('MC', '切削'), machine('DR', '穴あけ')],
      orders: [order('1', 'P', 1, '2026-11-10')],
    })

    const [, drilling] = result.operations.sort((a, b) => a.stepIndex - b.stepIndex)
    expect(drilling.startAt).toBe('2026-11-03T10:00')
  })

  it('takes setup on a multi-tasking machine from the rules of the process it runs', () => {
    const result = plan({
      parts: [part('R1', '丸物'), part('R2', '丸物')],
      setupRules: [
        { process: '切削', fromShape: '丸物', toShape: '丸物', minutes: 40 },
        { process: '穴あけ', fromShape: '丸物', toShape: '丸物', minutes: 10 },
      ],
      routes: { R1: oneStep('切削', 60), R2: oneStep('穴あけ', 60) },
      equipment: [{ ...machine('MC', ['切削', '穴あけ'], 50), lastPart: 'R1' }],
      orders: [order('1', 'R2', 1, '2026-11-10')],
    })

    expect(result.operations[0].setupMinutes).toBe(10)
  })

  it('lets a machine wait a little for more urgent work, but not most of a long job', () => {
    const onM = (firstMinutes: number) =>
      plan({
        routes: {
          L: oneStep('加工', 600),
          H: [
            { name: '前', minutesPerPiece: firstMinutes },
            { name: '加工', minutesPerPiece: 60 },
          ],
        },
        equipment: [machine('A', '前'), machine('M', '加工')],
        orders: [order('L', 'L', 1, '2026-11-30'), order('H', 'H', 1, '2026-11-30')],
        changes: [{ kind: 'expedite', orderId: 'H' }],
      })
        .operations.filter((operation) => operation.equipmentId === 'M')
        .map((operation) => operation.orderId)

    // H reaches M at 09:00, so M waits an hour for it.
    expect(onM(60)).toEqual(['H', 'L'])
    // H reaches M at 15:00, so M runs L from 08:00 rather than stand idle for seven hours.
    expect(onM(420)).toEqual(['L', 'H'])
  })

  it('measures that wait in working time, so a weekend in between does not shut urgent work out', () => {
    const onM = plan({
      start: FRIDAY,
      settings: { shifts: 3 },
      routes: {
        L: [
          { name: '前L', minutesPerPiece: 22 * 60 },
          { name: '加工', minutesPerPiece: 600 },
        ],
        H: [
          { name: '前H', minutesPerPiece: 24 * 60 },
          { name: '加工', minutesPerPiece: 60 },
        ],
      },
      equipment: [machine('A', '前H'), machine('B', '前L'), machine('M', '加工')],
      orders: [order('L', 'L', 1, '2026-11-30'), order('H', 'H', 1, '2026-11-30')],
      changes: [{ kind: 'expedite', orderId: 'H' }],
    })
      .operations.filter((operation) => operation.equipmentId === 'M')
      .map((operation) => [operation.orderId, operation.startAt])

    // L reaches M at 22:00 on Friday and H at 00:00 on Monday, two working hours later.
    expect(onM).toEqual([
      ['H', '2026-11-09T00:00'],
      ['L', '2026-11-09T01:00'],
    ])
  })

  it('runs a faster machine in less time than the route says', () => {
    const result = plan({
      routes: { P: oneStep('溶接', 30) },
      equipment: [machine('W1', '溶接', 0, 1.25)],
      orders: [order('1', 'P', 10, '2026-11-10')],
    })

    // 10 pieces of 30 minutes is 300 minutes at speed 1, and 240 at 1.25.
    expect(result.operations[0].workMinutes).toBe(240)
    expect(result.operations[0].endAt).toBe('2026-11-03T12:00')
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
      { lotId: 'L1-1', orderId: '1', planned: true, stepIndex: 1, stepName: '塗装', reason: '「塗装」を担当できる設備がありません' },
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

  it('takes setup time from the shape-to-shape rules', () => {
    const result = plan({
      settings: { dueWeight: 1 },
      parts: [part('R1', '丸物'), part('R2', '丸物'), part('S1', '角物')],
      setupRules: [{ process: '加工', fromShape: '丸物', toShape: '丸物', minutes: 15 }],
      routes: { R1: oneStep('加工', 60), R2: oneStep('加工', 60), S1: oneStep('加工', 60) },
      equipment: [machine('M1', '加工', 50)],
      orders: [
        order('1', 'R1', 1, '2026-11-10'),
        order('2', 'R1', 1, '2026-11-11'),
        order('3', 'R2', 1, '2026-11-12'),
        order('4', 'S1', 1, '2026-11-13'),
      ],
    })

    expect(result.operations.map((operation) => [operation.orderId, operation.setupMinutes])).toEqual([
      ['1', 0],
      ['2', 0],
      ['3', 15],
      ['4', 50],
    ])
  })

  it('sets up the first job from the part the machine ran last', () => {
    const input = {
      parts: [part('R1', '丸物'), part('S1', '角物')],
      setupRules: [{ process: '加工', fromShape: '角物', toShape: '丸物', minutes: 25 }],
      routes: { R1: oneStep('加工', 60), S1: oneStep('加工', 60) },
      orders: [order('1', 'R1', 1, '2026-11-10')],
    }
    const after = (lastPart?: string) =>
      plan({ ...input, equipment: [{ ...machine('M1', '加工', 50), lastPart }] }).operations[0].setupMinutes

    expect(after()).toBe(0)
    expect(after('R1')).toBe(0)
    expect(after('S1')).toBe(25)
  })

  it('makes what is needed this month before what is due earlier but needed later', () => {
    const result = plan({
      // X is out of stock, so it is needed now even though its due date is far away.
      parts: [part('X', '丸物', 0, 30), part('Y', '丸物', 1000, 30)],
      routes: { X: oneStep('加工', 60), Y: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      orders: [order('late-due', 'X', 1, '2027-01-31'), order('early-due', 'Y', 1, '2026-12-10')],
    })

    expect(result.operations.map((operation) => operation.orderId)).toEqual(['late-due', 'early-due'])
    expect(result.orders.find((forecast) => forecast.orderId === 'late-due')?.priorityClass).toBe('A')
    expect(result.orders.find((forecast) => forecast.orderId === 'early-due')?.priorityClass).toBe('B')
  })

  it('does not start a held order before its day', () => {
    const result = plan({
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      orders: [order('1', 'P', 1, '2026-11-20')],
      changes: [{ kind: 'hold', orderId: '1', until: '2026-11-05' }],
    })

    expect(result.operations[0].startAt).toBe('2026-11-05T08:00')
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

  it('runs no more machines of a crew on a day than its people', () => {
    const result = plan({
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工'), machine('M2', '加工')],
      crews: [{ name: '加工班', processes: ['加工'], people: 1 }],
      orders: [order('1', 'P', 9, '2026-11-20'), order('2', 'P', 9, '2026-11-20')],
    })

    expect(result.operations.map((operation) => [operation.orderId, operation.startAt])).toEqual([
      ['1', '2026-11-03T08:00'],
      ['2', '2026-11-04T08:00'],
    ])
    expect(result.crewDays[0]).toEqual({ crew: '加工班', date: TUESDAY, holiday: false, people: 1, peak: 1, machines: ['M1'] })
  })

  it('runs a crew of a three-shift plant on the day shift only on its days off, unless set otherwise', () => {
    const run = (holidayShifts: 1 | 3) =>
      plan({
        start: FRIDAY,
        settings: { shifts: 3, holidayShifts },
        routes: { P: oneStep('加工', 60) },
        equipment: [machine('M1', '加工')],
        crews: [{ name: '加工班', processes: ['加工'], people: 1, holidayPeople: 1 }],
        orders: [order('1', 'P', 30, '2026-11-20')],
      }).operations[0].endAt

    // 24 hours on Friday; the other 6 run on Saturday's day shift from 08:00.
    expect(run(1)).toBe('2026-11-07T14:00')
    // Round the clock on Saturday too.
    expect(run(3)).toBe('2026-11-07T06:00')
  })

  it('applies help from another crew on working days only', () => {
    const result = plan({
      start: FRIDAY,
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      crews: [{ name: '加工班', processes: ['加工'], people: 1 }],
      orders: [order('1', 'P', 12, '2026-11-20')],
      changes: [{ kind: 'headcount', crew: '加工班', from: '2026-11-06', to: '2026-11-09', people: 2 }],
    })

    // The crew does not come in at the weekend, help or not.
    expect(result.crewDays.filter((day) => day.holiday)).toEqual([])
    expect(result.operations[0].endAt).toBe('2026-11-09T11:00')
  })

  it('runs a crew on its days off with its holiday people', () => {
    const result = plan({
      start: FRIDAY,
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工'), machine('M2', '加工')],
      crews: [{ name: '加工班', processes: ['加工'], people: 2, holidayPeople: 1 }],
      orders: [order('1', 'P', 12, '2026-11-20'), order('2', 'P', 12, '2026-11-20')],
    })
    const saturday = result.crewDays.find((day) => day.date === '2026-11-07')

    // Order 1 runs on M1 into Saturday. Order 2 cannot start on M2 on Friday, as it would run
    // into Saturday too, when the one person is on M1; it follows on M1 into Sunday.
    expect(saturday).toMatchObject({ holiday: true, people: 1, peak: 1 })
    expect(result.operations.map((operation) => [operation.equipmentId, operation.endAt])).toEqual([
      ['M1', '2026-11-07T11:00'],
      ['M1', '2026-11-08T14:00'],
    ])
  })

  it('moves a person to the next machine of the crew when work there ends', () => {
    const result = plan({
      routes: { P: [{ name: '加工', minutesPerPiece: 240 }, { name: '仕上げ', minutesPerPiece: 240 }] },
      equipment: [machine('M1', '加工'), machine('M2', '仕上げ')],
      crews: [{ name: '班', processes: ['加工', '仕上げ'], people: 1 }],
      orders: [order('1', 'P', 1, '2026-11-20')],
    })

    expect(result.operations.map((operation) => [operation.startAt, operation.endAt])).toEqual([
      ['2026-11-03T08:00', '2026-11-03T12:00'],
      ['2026-11-03T12:00', '2026-11-03T16:00'],
    ])
  })

  it('runs nothing of a crew on a day no one of it is at work', () => {
    const result = plan({
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      crews: [{ name: '加工班', processes: ['加工'], people: 1 }],
      attendance: [{ crew: '加工班', date: TUESDAY, people: 0 }],
      orders: [order('1', 'P', 1, '2026-11-20')],
    })

    expect(result.operations[0].startAt).toBe('2026-11-04T08:00')
  })

  it('finishes sooner with help for the crew', () => {
    const input = {
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工'), machine('M2', '加工')],
      crews: [{ name: '加工班', processes: ['加工'], people: 1 }],
      orders: [order('1', 'P', 9, '2026-11-20'), order('2', 'P', 9, '2026-11-20')],
    }
    const before = plan(input)
    const after = plan({
      ...input,
      changes: [{ kind: 'headcount', crew: '加工班', from: TUESDAY, to: TUESDAY, people: 2 }],
    })

    expect(before.orders.map((forecast) => forecast.finishDate)).toEqual([TUESDAY, '2026-11-04'])
    expect(after.orders.map((forecast) => forecast.finishDate)).toEqual([TUESDAY, TUESDAY])
  })

  it('gives the last person of a crew to the work needed sooner', () => {
    const result = plan({
      // X is out of stock (class A); Y is not needed until long after next month (class C).
      parts: [part('X', '丸物', 0, 30), part('Y', '丸物')],
      routes: { X: oneStep('仕上げ', 60), Y: oneStep('加工', 60) },
      equipment: [machine('M1', '加工'), machine('M2', '仕上げ')],
      crews: [{ name: '班', processes: ['加工', '仕上げ'], people: 1 }],
      // The short C work would end first and take the only person without the crew-wide check.
      orders: [order('c', 'Y', 1, '2027-02-26'), order('a', 'X', 9, '2026-11-30')],
    })
    const startOf = (orderId: string) => result.operations.find((operation) => operation.orderId === orderId)?.startAt

    expect(startOf('a')).toBe('2026-11-03T08:00')
    expect(startOf('c')).toBe('2026-11-04T08:00')
    // M1 itself was free on Tuesday; only the person was not.
    expect(result.operations.find((operation) => operation.orderId === 'c')?.waitedForPeople).toBe(true)
  })

  it('lets holiday work run with its own person', () => {
    const result = plan({
      start: FRIDAY,
      routes: { P: oneStep('加工', 60) },
      equipment: [machine('M1', '加工')],
      crews: [{ name: '加工班', processes: ['加工'], people: 1 }],
      attendance: [{ crew: '加工班', date: FRIDAY, people: 0 }],
      orders: [order('1', 'P', 9, '2026-11-20')],
      changes: [{ kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-07' }],
    })

    expect(result.operations[0].startAt).toBe('2026-11-07T08:00')
    expect(result.operations[0].endAt).toBe('2026-11-07T17:00')
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
    expect(comparison.shifted[0]).toMatchObject({
      before: TUESDAY,
      after: '2026-11-04',
      beforeAt: before.orders[0].finishAt,
      afterAt: expect.stringMatching(/^2026-11-04T\d\d:\d\d$/),
      shiftDays: 1,
    })
    expect(comparison.lateAfter).toBe(1)
  })
})

describe('plannedLotId', () => {
  const lot = (id: string, orderId: string): Lot => ({ id, orderId, quantity: 1, stepIndex: 0, arrivedOn: TUESDAY })

  it("continues the order's own numbering", () => {
    expect(plannedLotId('1034', [lot('L1034-1', '1034'), lot('L1034-2', '1034')])).toBe('L1034-3')
    expect(plannedLotId('7', [lot('7-09', '7')])).toBe('7-10')
  })

  it('starts at 1 for an order with no lot and skips numbers already taken', () => {
    expect(plannedLotId('1045', [])).toBe('L1045-1')
    expect(plannedLotId('1045', [lot('L1045-1', '9999')])).toBe('L1045-2')
    expect(plannedLotId('1034', [lot('L1034', '1034')])).toBe('L1034-1')
  })

  it('gives each order its own number when lots are numbered across the plant', () => {
    const lots = [lot('LOT-101', '1001'), lot('LOT-102', '1002')]
    const taken = new Set(lots.map((item) => item.id))

    expect(plannedLotId('1001', lots, taken)).toBe('LOT-103')
    expect(plannedLotId('1002', lots, taken)).toBe('LOT-104')
  })
})
