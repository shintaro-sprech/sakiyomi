// Fictional sample data made for this project. Part numbers, steps,
// equipment and quantities do not come from any real plant. Dates are
// relative to the day the app is opened, so the sample never goes stale.
// Due dates count weekdays, so the plan looks the same on any day of the week.
import { addDays, weekday } from '../src/engine/dates'
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

  return {
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
    },
    equipment: [
      { id: 'CUT-1', name: '切断機1', process: '切断', setupMinutes: 30 },
      { id: 'BND-1', name: 'ベンダー1', process: '曲げ', setupMinutes: 45 },
      { id: 'WLD-1', name: '溶接ロボ1', process: '溶接', setupMinutes: 20 },
      { id: 'WLD-2', name: '溶接ロボ2', process: '溶接', setupMinutes: 20 },
      { id: 'MC-1', name: 'マシニング1', process: '切削', setupMinutes: 60 },
      { id: 'HT-1', name: '熱処理炉1', process: '熱処理', setupMinutes: 30 },
      { id: 'GRD-1', name: '研削盤1', process: '研削', setupMinutes: 40 },
      { id: 'DRL-1', name: 'ボール盤1', process: '穴あけ', setupMinutes: 15 },
      { id: 'INS-1', name: '検査台1', process: '検査', setupMinutes: 10 },
      { id: 'PCK-1', name: '梱包台1', process: '梱包', setupMinutes: 0 },
    ],
    orders: [
      { id: '1021', partNumber: 'A-100', quantity: 50, due: workday(7) },
      { id: '1022', partNumber: 'A-100', quantity: 20, due: workday(9) },
      { id: '1040', partNumber: 'A-100', quantity: 15, due: workday(13), materialOn: workday(2) },
      { id: '1030', partNumber: 'B-200', quantity: 10, due: workday(5) },
      { id: '1045', partNumber: 'B-200', quantity: 30, due: workday(8), materialOn: workday(1) },
      { id: '1034', partNumber: 'C-310', quantity: 30, due: workday(11) },
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
