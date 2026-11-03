// Fictional sample data made for this project. Part numbers, shapes, steps,
// equipment, prices and quantities do not come from any real plant. Dates are
// relative to the day the app is opened, so the sample never goes stale.
// Near due dates count weekdays, so the plan looks the same on any day of the week;
// later ones are set on a working day in next month and the month after, so their demand
// class holds.
import { addDays, weekday } from '../src/engine/dates'
import { lastDayOfMonth } from '../src/engine/demand'
import { setupMinutes } from '../src/engine/setup'
import type { Actual, CustomerOrder, IsoDate, Order, PlantData } from '../src/engine/types'

export function createSampleData(today: IsoDate): PlantData {
  const day = (offset: number) => addDays(today, offset)
  const workday = (count: number) => {
    let date = today
    for (let added = 0; added < count; ) {
      date = addDays(date, 1)
      if (weekday(date) !== 0 && weekday(date) !== 6) added += 1
    }
    return date
  }
  const nextMonth = (dayOfMonth: number) => workdayOnOrBefore(addDays(lastDayOfMonth(today), dayOfMonth))
  const monthAfterNext = (dayOfMonth: number) =>
    workdayOnOrBefore(addDays(lastDayOfMonth(addDays(lastDayOfMonth(today), 1)), dayOfMonth))

  const data: PlantData = {
    parts: [
      { partNumber: 'A-100', shape: '板金', price: 6000, materialCost: 1200, stock: 120, monthlyUsage: 90, materialStock: 200 },
      { partNumber: 'B-200', shape: '丸物', price: 18000, materialCost: 3500, stock: 0, monthlyUsage: 45, materialStock: 20 },
      { partNumber: 'C-310', shape: '角物', price: 3500, materialCost: 700, stock: 400, monthlyUsage: 60, materialStock: 60 },
      { partNumber: 'D-410', shape: '丸物', price: 9000, materialCost: 1500, stock: 300, monthlyUsage: 30, materialStock: 0 },
    ],
    routes: {
      'A-100': [
        { name: '切断', minutesPerPiece: 3 },
        { name: '曲げ', minutesPerPiece: 12 },
        { name: '溶接', minutesPerPiece: 30 },
        { name: '検査', minutesPerPiece: 6 },
      ],
      'B-200': [
        { name: '切削', minutesPerPiece: 40 },
        { name: '熱処理', minutesPerPiece: 30 },
        { name: '研削', minutesPerPiece: 25 },
        { name: '検査', minutesPerPiece: 10 },
        { name: '梱包', minutesPerPiece: 5 },
      ],
      'C-310': [
        { name: '切断', minutesPerPiece: 3 },
        { name: '穴あけ', minutesPerPiece: 15 },
        { name: '検査', minutesPerPiece: 6 },
      ],
      'D-410': [
        { name: '切削', minutesPerPiece: 35 },
        { name: '研削', minutesPerPiece: 20 },
        { name: '検査', minutesPerPiece: 8 },
      ],
    },
    equipment: [
      { id: 'CUT-1', name: '切断機1', process: '切断', setupMinutes: 30, hourlyCost: 400, lastPart: 'C-310' },
      { id: 'BND-1', name: 'ベンダー1', process: '曲げ', setupMinutes: 45, hourlyCost: 500, lastPart: 'A-100' },
      { id: 'WLD-1', name: '溶接ロボ1', process: '溶接', setupMinutes: 20, hourlyCost: 700 },
      { id: 'WLD-2', name: '溶接ロボ2', process: '溶接', setupMinutes: 20, hourlyCost: 700 },
      { id: 'MC-1', name: 'マシニング1', process: '切削', setupMinutes: 60, hourlyCost: 1200, lastPart: 'B-200' },
      { id: 'HT-1', name: '熱処理炉1', process: '熱処理', setupMinutes: 30, hourlyCost: 1500, lastPart: 'B-200' },
      { id: 'GRD-1', name: '研削盤1', process: '研削', setupMinutes: 40, hourlyCost: 900, lastPart: 'B-200' },
      { id: 'DRL-1', name: 'ボール盤1', process: '穴あけ', setupMinutes: 15, hourlyCost: 300, lastPart: 'C-310' },
      { id: 'INS-1', name: '検査台1', process: '検査', setupMinutes: 10, hourlyCost: 200, lastPart: 'B-200' },
      { id: 'PCK-1', name: '梱包台1', process: '梱包', setupMinutes: 0, hourlyCost: 100, lastPart: 'B-200' },
    ],
    setupRules: [
      { process: '切削', fromShape: '丸物', toShape: '丸物', minutes: 20 },
      { process: '研削', fromShape: '丸物', toShape: '丸物', minutes: 15 },
      { process: '切断', fromShape: '板金', toShape: '板金', minutes: 10 },
      { process: '切断', fromShape: '板金', toShape: '角物', minutes: 25 },
      { process: '切断', fromShape: '角物', toShape: '板金', minutes: 25 },
      { process: '曲げ', fromShape: '板金', toShape: '板金', minutes: 20 },
    ],
    crews: [
      { name: '板金班', processes: ['切断', '曲げ', '溶接'], people: 3 },
      { name: '機械班', processes: ['切削', '熱処理', '研削', '穴あけ'], people: 2 },
      { name: '仕上げ班', processes: ['検査', '梱包'], people: 1 },
    ],
    attendance: [{ crew: '機械班', date: workday(2), people: 1 }],
    orders: [
      { id: '1030', partNumber: 'B-200', quantity: 10, due: workday(5) },
      { id: '1045', partNumber: 'B-200', quantity: 30, due: workday(8), materialOn: workday(1) },
      { id: '1021', partNumber: 'A-100', quantity: 50, due: workday(7) },
      { id: '1022', partNumber: 'A-100', quantity: 20, due: workday(9) },
      { id: '1040', partNumber: 'A-100', quantity: 15, due: nextMonth(10), materialOn: workday(2) },
      { id: '1034', partNumber: 'C-310', quantity: 30, due: nextMonth(5) },
      { id: '1050', partNumber: 'D-410', quantity: 40, due: monthAfterNext(15) },
    ],
    lots: [
      { id: 'L1021-1', orderId: '1021', quantity: 20, stepIndex: 1, arrivedOn: day(-2) },
      { id: 'L1021-2', orderId: '1021', quantity: 30, stepIndex: 2, arrivedOn: day(-1) },
      { id: 'L1022-1', orderId: '1022', quantity: 20, stepIndex: 1, arrivedOn: day(-4) },
      { id: 'L1030-1', orderId: '1030', quantity: 4, stepIndex: 4, arrivedOn: day(-1) },
      { id: 'L1030-2', orderId: '1030', quantity: 6, stepIndex: 5, arrivedOn: day(-1) },
      { id: 'L1034-1', orderId: '1034', quantity: 6, stepIndex: 1, arrivedOn: day(-2) },
      { id: 'L1034-2', orderId: '1034', quantity: 12, stepIndex: 2, arrivedOn: day(0) },
    ],
  }
  return { ...data, actuals: sampleActuals(data), customerOrders: sampleCustomerOrders(data.orders) }
}

const CUSTOMERS = ['取引先A', '取引先B', '取引先C', '取引先D', '取引先E']

function workdayBefore(date: IsoDate, count: number): IsoDate {
  let result = date
  for (let taken = 0; taken < count; ) {
    result = addDays(result, -1)
    if (weekday(result) !== 0 && weekday(result) !== 6) taken += 1
  }
  return result
}

// The date itself on a working day, else the working day before it.
function workdayOnOrBefore(date: IsoDate): IsoDate {
  return weekday(date) !== 0 && weekday(date) !== 6 ? date : workdayBefore(date, 1)
}

// The steps each lot has been through, made from the lots themselves so a saved sample
// gets the same history: one step a working day, the last on the working day before the
// lot reached where it is now. Each machine runs its lots in time order from 8:00, with a
// setup from the setup table whenever the part number changes. A piece now and then failed
// inspection on the way.
export function sampleActuals(
  data: Pick<PlantData, 'lots' | 'orders' | 'routes' | 'equipment' | 'parts' | 'setupRules'>,
): Actual[] {
  const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
  const runs = data.lots.flatMap((lot, lotIndex) => {
    const order = data.orders.find((candidate) => candidate.id === lot.orderId)
    if (!order) return []
    const route = data.routes[order.partNumber] ?? []
    const steps = []
    let good = lot.quantity
    for (let stepIndex = Math.min(lot.stepIndex, route.length) - 1; stepIndex >= 0; stepIndex -= 1) {
      const step = route[stepIndex]
      const machines = data.equipment.filter((equipment) => equipment.process === step.name)
      if (machines.length === 0) continue
      const defect = (lotIndex + stepIndex) % 5 === 0 ? 1 : 0
      steps.unshift({
        lotId: lot.id,
        lotIndex,
        stepIndex,
        partNumber: order.partNumber,
        minutes: Math.ceil((good + defect) * step.minutesPerPiece),
        machine: machines[lotIndex % machines.length],
        date: workdayBefore(lot.arrivedOn, lot.stepIndex - stepIndex),
        good,
        defect,
      })
      good += defect
    }
    return steps
  })
  // The day each machine last ran, when it was free that day and the part it ran.
  const machines = new Map<string, { date: IsoDate; free: number; partNumber: string }>()
  const records = [...runs]
    .sort((a, b) => a.date.localeCompare(b.date) || a.lotIndex - b.lotIndex)
    .map((run) => {
      const before = machines.get(run.machine.id)
      const setup = setupMinutes(data, run.machine, before?.partNumber ?? null, run.partNumber)
      const start = Math.min((before?.date === run.date ? before.free : 8 * 60) + setup, 17 * 60)
      const end = Math.min(start + run.minutes, 17 * 60)
      machines.set(run.machine.id, { date: run.date, free: end, partNumber: run.partNumber })
      return { run, actual: { lotId: run.lotId, stepIndex: run.stepIndex, equipmentId: run.machine.id, start: `${run.date}T${clock(start)}`, end: `${run.date}T${clock(end)}`, good: run.good, defect: run.defect } }
    })
  return records
    .sort((a, b) => a.run.lotIndex - b.run.lotIndex || a.run.stepIndex - b.run.stepIndex)
    .map((record) => record.actual)
}

// The customer orders each open order fills, made from the orders, all dated on working
// days. A larger order serves two customers, the first asking three working days before
// the order's due date and promised two, so the order with no slack misses that promise on
// any day of the week; the last order still waits for an answer on one of them.
export function sampleCustomerOrders(orders: Order[]): CustomerOrder[] {
  return orders.flatMap((order, index) => {
    const customer = (offset: number) => CUSTOMERS[(index + offset) % CUSTOMERS.length]
    const due = workdayOnOrBefore(order.due)
    if (order.quantity < 30) {
      return [{ id: `J${order.id}-1`, orderId: order.id, customer: customer(0), quantity: order.quantity, requested: due, answered: due }]
    }
    const first = Math.floor(order.quantity / 2)
    const last = index === orders.length - 1
    return [
      { id: `J${order.id}-1`, orderId: order.id, customer: customer(0), quantity: first, requested: workdayBefore(order.due, 3), answered: workdayBefore(order.due, 2) },
      { id: `J${order.id}-2`, orderId: order.id, customer: customer(1), quantity: order.quantity - first, requested: due, answered: last ? null : due },
    ]
  })
}
