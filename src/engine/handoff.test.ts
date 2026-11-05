import { describe, expect, it } from 'vitest'

import { sampleOrderHistory } from '../../sample-data/orderHistory'
import { createSampleData } from '../../sample-data/sample'
import { dealDemand } from './dealDemand'
import { forecastDemand } from './forecast'
import { addVersion, currentVersion, dealsVersion, forecastVersion, monthsFrom, openOrdersByMonth } from './handoff'
import type { Deal } from './types'

const today = '2026-11-05'
const data = createSampleData(today)

const deal: Deal = {
  id: 'P',
  name: 'P',
  customer: '取引先A',
  owner: '営業A',
  partNumber: 'A-100',
  stage: '量産の内示',
  closeDate: '2026-12-08',
  monthlyQuantity: 60,
  customerKind: '既存',
  source: '紹介',
  use: '建機',
  note: '',
  createdOn: '2026-09-01',
  stageChangedOn: '2026-10-20',
  postponeCount: 0,
}

describe('versions', () => {
  it('hands the deals over month by month with the conditions they were counted by', () => {
    const version = dealsVersion(dealDemand([deal], new Map([['P', 0.9]]), data.parts, today), today, '2026-11-05T09:00')

    expect(version).toMatchObject({ kind: 'deals', createdBy: 'auto', baseDate: today, conditions: '確率80%以上・受注予定日が5/5まで・量産は受注予定月の翌月から' })
    expect(version.rows.find((row) => row.month === '2027-01')).toEqual({
      partNumber: 'A-100',
      month: '2027-01',
      expected: 54,
      quantity: 60,
      firstOrder: 0,
      expectedFirstOrder: 0,
    })
  })

  it('hands a forecast over with its method, and keeps the newest of each kind', () => {
    const forecast = forecastDemand(sampleOrderHistory(data.parts, today), 3)
    const version = forecastVersion(forecast, today, '2026-11-05T10:00')
    expect(version.rows.length).toBe(12)
    expect(version.conditions).toBe('学習した予測・3か月（実績は2026/10まで）')

    const old = { ...version, id: 'old', createdAt: '2025-01-01T09:00' }
    const kept = addVersion([old], version, today)
    expect(kept.map((entry) => entry.id)).toEqual([version.id])
    expect(addVersion([], old, today).map((entry) => entry.id)).toEqual(['old'])
    expect(currentVersion(kept, 'forecast')?.id).toBe(version.id)
    expect(currentVersion(kept, 'deals')).toBeNull()

    // Two handed over in the same minute: the later one is the current one.
    const again = forecastVersion(forecastDemand(sampleOrderHistory(data.parts, today), 6), today, '2026-11-05T10:00')
    const both = addVersion(kept, again, today)
    expect(again.id).not.toBe(version.id)
    expect(currentVersion(both, 'forecast')?.id).toBe(again.id)
  })
})

describe('openOrdersByMonth', () => {
  it('counts what open orders still have to finish, by the month they are due', () => {
    const rows = openOrdersByMonth(data, today)
    const a100 = rows.filter((row) => row.partNumber === 'A-100')

    expect(a100.reduce((total, row) => total + row.quantity, 0)).toBe(150 + 60 + 45)
    expect(monthsFrom(today, 3)).toEqual(['2026-11', '2026-12', '2027-01'])
  })
})
