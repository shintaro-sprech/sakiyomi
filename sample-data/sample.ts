// Fictional sample data made for this project. Part numbers, shapes, steps,
// equipment, prices and quantities do not come from any real plant. Dates are
// relative to the day the app is opened, so the sample never goes stale.
// Near due dates count weekdays, so the plan looks the same on any day of the week;
// later ones are set in next month and the month after, so their demand class holds.
import { addDays, weekday } from '../src/engine/dates'
import { lastDayOfMonth } from '../src/engine/demand'
import type { IsoDate, PlantData } from '../src/engine/types'

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
  const nextMonth = (dayOfMonth: number) => addDays(lastDayOfMonth(today), dayOfMonth)
  const monthAfterNext = (dayOfMonth: number) => addDays(lastDayOfMonth(addDays(lastDayOfMonth(today), 1)), dayOfMonth)

  return {
    parts: [
      { partNumber: 'A-100', shape: '板金', price: 6000, materialCost: 1200, stock: 120, monthlyUsage: 90 },
      { partNumber: 'B-200', shape: '丸物', price: 18000, materialCost: 3500, stock: 0, monthlyUsage: 45 },
      { partNumber: 'C-310', shape: '角物', price: 3500, materialCost: 700, stock: 400, monthlyUsage: 60 },
      { partNumber: 'D-410', shape: '丸物', price: 9000, materialCost: 1500, stock: 300, monthlyUsage: 30 },
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
      { id: 'CUT-1', name: '切断機1', process: '切断', setupMinutes: 30, hourlyCost: 400 },
      { id: 'BND-1', name: 'ベンダー1', process: '曲げ', setupMinutes: 45, hourlyCost: 500 },
      { id: 'WLD-1', name: '溶接ロボ1', process: '溶接', setupMinutes: 20, hourlyCost: 700 },
      { id: 'WLD-2', name: '溶接ロボ2', process: '溶接', setupMinutes: 20, hourlyCost: 700 },
      { id: 'MC-1', name: 'マシニング1', process: '切削', setupMinutes: 60, hourlyCost: 1200 },
      { id: 'HT-1', name: '熱処理炉1', process: '熱処理', setupMinutes: 30, hourlyCost: 1500 },
      { id: 'GRD-1', name: '研削盤1', process: '研削', setupMinutes: 40, hourlyCost: 900 },
      { id: 'DRL-1', name: 'ボール盤1', process: '穴あけ', setupMinutes: 15, hourlyCost: 300 },
      { id: 'INS-1', name: '検査台1', process: '検査', setupMinutes: 10, hourlyCost: 200 },
      { id: 'PCK-1', name: '梱包台1', process: '梱包', setupMinutes: 0, hourlyCost: 100 },
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
}
