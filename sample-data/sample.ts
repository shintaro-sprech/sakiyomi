// Fictional sample data made for this project. Part numbers, steps and
// quantities do not come from any real plant. Dates are relative to the
// day the app is opened, so the sample never goes stale.
import { addDays } from '../src/engine/dates'
import type { IsoDate, PlantData } from '../src/engine/types'

export function createSampleData(today: IsoDate): PlantData {
  const day = (offset: number) => addDays(today, offset)

  return {
    routes: {
      'A-100': [{ name: '切断' }, { name: '曲げ' }, { name: '溶接' }, { name: '検査' }],
      'B-200': [{ name: '切削' }, { name: '熱処理' }, { name: '研削' }, { name: '検査' }, { name: '梱包' }],
      'C-310': [{ name: '切断' }, { name: '穴あけ' }, { name: '検査' }],
    },
    orders: [
      { id: '1021', partNumber: 'A-100', quantity: 50, due: day(9) },
      { id: '1022', partNumber: 'A-100', quantity: 20, due: day(12) },
      { id: '1040', partNumber: 'A-100', quantity: 15, due: day(17) },
      { id: '1030', partNumber: 'B-200', quantity: 10, due: day(7) },
      { id: '1034', partNumber: 'C-310', quantity: 30, due: day(15) },
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
