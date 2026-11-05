import { describe, expect, it } from 'vitest'

import { sampleOrderHistory } from '../../sample-data/orderHistory'
import { createSampleData } from '../../sample-data/sample'
import { errorScores, forecastDemand, seriesChecks } from './forecast'
import type { MonthlyOrder } from './types'

const today = '2026-11-05'
const parts = createSampleData(today).parts
const history = sampleOrderHistory(parts, today)

const row = (month: string, ordered: number, partNumber = 'Z-1', site = '自社'): MonthlyOrder => ({ month, partNumber, site, ordered, shipped: ordered })

describe('errorScores', () => {
  it('measures how far predictions miss', () => {
    expect(errorScores([10, 20], [12, 17])).toEqual({ mae: 2.5, rmse: Math.sqrt(6.5), mape: (0.2 + 0.15) / 2, smape: (4 / 22 + 6 / 37) / 2 })
    expect(errorScores([0], [0]).mape).toBeNull()
  })
})

describe('the sample history', () => {
  it('runs three years per part up to last month, ending near the monthly shipments', () => {
    const a100 = history.filter((entry) => entry.partNumber === 'A-100')
    expect(a100.length).toBe(36)
    expect(a100.at(-1)?.month).toBe('2026-10')
    const recent = a100.slice(-3).reduce((total, entry) => total + entry.ordered, 0) / 3
    expect(Math.abs(recent - 270)).toBeLessThan(2)
  })
})

describe('forecastDemand', () => {
  it('compares the two ways on the last three months and forecasts from next month', () => {
    const result = forecastDemand(history, 3)

    expect(result.lastMonth).toBe('2026-10')
    expect(result.months).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(result.backtest).not.toBeNull()
    expect(result.series.map((entry) => entry.partNumber)).toEqual(['A-100', 'B-200', 'C-310', 'D-410'])
    expect(result.series.every((entry) => entry.method === result.backtest!.chosen)).toBe(true)
    expect(result.series.every((entry) => entry.forecast.every((month) => month.quantity >= 0))).toBe(true)
    expect(forecastDemand(history, 3)).toEqual(result)
  })

  it('uses the recent average for a series too short for the trees, and the mean of a very short one', () => {
    const tenMonths = Array.from({ length: 10 }, (_, index) => row(`2025-${String(index + 1).padStart(2, '0')}`, 100 + index, 'S-1'))
    const result = forecastDemand([...tenMonths, row('2025-09', 50, 'S-2'), row('2025-10', 51, 'S-2')], 2)

    expect(result.backtest).toBeNull()
    expect(result.series.map((entry) => [entry.partNumber, entry.method, entry.forecast.map((month) => month.quantity)])).toEqual([
      ['S-1', 'recentAverage', [108, 108]],
      ['S-2', 'tooShort', [50.5, 50.5]],
    ])
  })

  it('counts a month with no row as no orders, up to the last month of all the history', () => {
    const result = forecastDemand([row('2026-01', 30), row('2026-03', 60), row('2026-04', 90, 'Z-2')], 1)
    const z1 = result.series.find((entry) => entry.partNumber === 'Z-1')!

    expect(z1.history.map((month) => month.ordered)).toEqual([30, 0, 60, 0])
    expect(z1.forecast).toEqual([{ month: '2026-05', quantity: 20 }])
    expect(seriesChecks(z1).warnings).toEqual(['実績が6か月に足りません', '受注のない月が2か月あります', '前の月から100%動いた月があります'])
  })

  it('says why there is nothing to forecast', () => {
    expect(forecastDemand([], 3)).toMatchObject({ series: [], reason: '月ごとの受注の実績がありません' })
  })
})
