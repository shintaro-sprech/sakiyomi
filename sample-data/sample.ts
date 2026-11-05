// Fictional sample data made for this project. Part numbers, shapes, steps,
// equipment, prices and quantities do not come from any real plant. Dates are
// relative to the day the app is opened, so the sample never goes stale.
// Near due dates count weekdays, so the plan looks the same on any day of the week;
// later ones are set on a working day in next month and the month after, so their demand
// class holds.
import { addDays, weekday } from '../src/engine/dates'
import { lastDayOfMonth } from '../src/engine/demand'
import { setupMinutes } from '../src/engine/setup'
import type { Actual, ChannelStock, CustomerOrder, IsoDate, Order, PlantData } from '../src/engine/types'

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
      { partNumber: 'A-100', shape: '板金', price: 6000, materialCost: 1200, stock: 360, monthlyUsage: 270, materialStock: 600, materialLeadDays: 5 },
      { partNumber: 'B-200', shape: '丸物', price: 18000, materialCost: 3500, stock: 0, monthlyUsage: 135, materialStock: 60, materialLeadDays: 7 },
      { partNumber: 'C-310', shape: '角物', price: 3500, materialCost: 700, stock: 1200, monthlyUsage: 180, materialStock: 180, materialLeadDays: 3 },
      { partNumber: 'D-410', shape: '丸物', price: 9000, materialCost: 1500, stock: 900, monthlyUsage: 90, materialStock: 0, materialLeadDays: 10 },
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
        { name: 'タップ', minutesPerPiece: 5 },
        { name: '研削', minutesPerPiece: 20 },
        { name: '検査', minutesPerPiece: 8 },
      ],
    },
    equipment: [
      { id: 'CUT-1', name: '切断機1', processes: ['切断'], setupMinutes: 30, hourlyCost: 400, lastPart: 'C-310' },
      { id: 'BND-1', name: 'ベンダー1', processes: ['曲げ'], speed: 1.2, setupMinutes: 45, hourlyCost: 500, lastPart: 'A-100' },
      { id: 'WLD-1', name: '溶接ロボ1', processes: ['溶接'], setupMinutes: 20, hourlyCost: 700 },
      { id: 'WLD-2', name: '溶接ロボ2', processes: ['溶接'], setupMinutes: 20, hourlyCost: 700 },
      { id: 'MC-1', name: 'マシニング1', processes: ['切削', 'タップ'], setupMinutes: 60, hourlyCost: 1200, lastPart: 'B-200' },
      { id: 'HT-1', name: '熱処理炉1', processes: ['熱処理'], setupMinutes: 30, hourlyCost: 1500, lastPart: 'B-200' },
      { id: 'GRD-1', name: '研削盤1', processes: ['研削'], setupMinutes: 40, hourlyCost: 900, lastPart: 'B-200' },
      { id: 'DRL-1', name: 'ボール盤1', processes: ['穴あけ'], setupMinutes: 15, hourlyCost: 300, lastPart: 'C-310' },
      { id: 'INS-1', name: '検査台1', processes: ['検査'], setupMinutes: 10, hourlyCost: 200, lastPart: 'B-200' },
      { id: 'PCK-1', name: '梱包台1', processes: ['梱包'], setupMinutes: 0, hourlyCost: 100, lastPart: 'B-200' },
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
      // On Saturdays and Sundays one person of each crew comes in on the day shift, as holiday work.
      { name: '板金班', processes: ['切断', '曲げ', '溶接'], people: 3, holidayPeople: 1 },
      { name: '機械班', processes: ['切削', 'タップ', '熱処理', '研削', '穴あけ'], people: 2, holidayPeople: 1 },
      { name: '仕上げ班', processes: ['検査', '梱包'], people: 1, holidayPeople: 1 },
    ],
    attendance: [{ crew: '機械班', date: workday(2), people: 1 }],
    orders: [
      { id: '1030', partNumber: 'B-200', quantity: 30, due: workday(5) },
      { id: '1045', partNumber: 'B-200', quantity: 90, due: workday(7), materialOn: workday(1) },
      { id: '1021', partNumber: 'A-100', quantity: 150, due: workday(7) },
      { id: '1022', partNumber: 'A-100', quantity: 60, due: workday(9) },
      { id: '1040', partNumber: 'A-100', quantity: 45, due: nextMonth(10), materialOn: workday(2) },
      { id: '1034', partNumber: 'C-310', quantity: 90, due: nextMonth(5) },
      { id: '1050', partNumber: 'D-410', quantity: 120, due: monthAfterNext(15) },
    ],
    lots: [
      { id: 'L1021-1', orderId: '1021', quantity: 60, stepIndex: 1, arrivedOn: day(-2) },
      { id: 'L1021-2', orderId: '1021', quantity: 90, stepIndex: 2, arrivedOn: day(-1) },
      { id: 'L1022-1', orderId: '1022', quantity: 60, stepIndex: 1, arrivedOn: day(-4) },
      { id: 'L1030-1', orderId: '1030', quantity: 12, stepIndex: 4, arrivedOn: day(-1) },
      { id: 'L1030-2', orderId: '1030', quantity: 18, stepIndex: 5, arrivedOn: day(-1) },
      { id: 'L1034-1', orderId: '1034', quantity: 18, stepIndex: 1, arrivedOn: day(-2) },
      { id: 'L1034-2', orderId: '1034', quantity: 36, stepIndex: 2, arrivedOn: day(0) },
    ],
  }
  return {
    ...data,
    actuals: sampleActuals(data),
    customerOrders: sampleCustomerOrders(data.orders),
    channelStocks: sampleChannelStocks(today),
  }
}

const CUSTOMERS = ['取引先A', '取引先B', '取引先C', '取引先D', '取引先E']
// Customers that hold stock and sell it on; the others buy what they use.
const DISTRIBUTORS = ['取引先D', '取引先E']

// What the distributors reported at the end of last month: one with weeks of A-100 left,
// one about to order A-100 and B-200 again, and one with months of C-310. Their sales add
// up to about half of what the plant ships of each part; the rest is sold direct.
export function sampleChannelStocks(today: IsoDate): ChannelStock[] {
  const asOf = addDays(today, -Number(today.slice(8, 10)))
  return [
    { customer: '取引先D', partNumber: 'A-100', asOf, stock: 150, monthlySales: 90 },
    { customer: '取引先E', partNumber: 'A-100', asOf, stock: 45, monthlySales: 45 },
    { customer: '取引先E', partNumber: 'B-200', asOf, stock: 18, monthlySales: 60 },
    { customer: '取引先D', partNumber: 'C-310', asOf, stock: 360, monthlySales: 75 },
  ]
}

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
// lot reached where it is now. Each machine runs its lots in time order from 0:00, as the
// plant works three shifts, with a setup from the setup table whenever the part number
// changes. A piece now and then failed inspection on the way.
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
      // A machine kept for the step runs it when there is one, so a multi-tasking
      // machine is left to its own work.
      const able = data.equipment.filter((equipment) => equipment.processes.includes(step.name))
      const kept = able.filter((equipment) => equipment.processes.length === 1)
      const machines = kept.length > 0 ? kept : able
      if (machines.length === 0) continue
      const defect = (lotIndex + stepIndex) % 5 === 0 ? 1 : 0
      steps.unshift({
        lotId: lot.id,
        lotIndex,
        stepIndex,
        partNumber: order.partNumber,
        process: step.name,
        machine: machines[lotIndex % machines.length],
        pieces: good + defect,
        minutesPerPiece: step.minutesPerPiece,
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
      const setup = setupMinutes(data, run.machine, run.process, before?.partNumber ?? null, run.partNumber)
      const start = Math.min((before?.date === run.date ? before.free : 0) + setup, 24 * 60)
      const minutes = Math.ceil((run.pieces * run.minutesPerPiece) / (run.machine.speed ?? 1) - 1e-9)
      const end = Math.min(start + minutes, 24 * 60)
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
    const customer = (offset: number) => {
      const name = CUSTOMERS[(index + offset) % CUSTOMERS.length]
      return DISTRIBUTORS.includes(name) ? { customer: name, channel: 'distributor' as const } : { customer: name }
    }
    const due = workdayOnOrBefore(order.due)
    if (order.quantity < 90) {
      return [{ id: `J${order.id}-1`, orderId: order.id, ...customer(0), quantity: order.quantity, requested: due, answered: due }]
    }
    const first = Math.floor(order.quantity / 2)
    const last = index === orders.length - 1
    return [
      { id: `J${order.id}-1`, orderId: order.id, ...customer(0), quantity: first, requested: workdayBefore(order.due, 3), answered: workdayBefore(order.due, 2) },
      { id: `J${order.id}-2`, orderId: order.id, ...customer(1), quantity: order.quantity - first, requested: due, answered: last ? null : due },
    ]
  })
}
