import { describe, expect, it } from 'vitest'

import { sampleDeals } from '../../sample-data/deals'
import { createSampleData } from '../../sample-data/sample'
import { dealAnalytics } from './dealAnalytics'

const today = '2026-11-05'
const parts = createSampleData(today).parts
const { deals } = sampleDeals(today)

describe('dealAnalytics', () => {
  const analytics = dealAnalytics(deals, parts, today)

  it('adds up the last year and the year before, and splits the year every way to the same totals', () => {
    expect(analytics.current.from).toBe('2025-12-01')
    // The months add up to the year.
    expect(analytics.byMonth.reduce((total, month) => total + month.decided, 0)).toBe(analytics.current.decided)
    expect(analytics.current.decided).toBe(analytics.current.won + analytics.current.lost)
    expect(analytics.current.decided).toBeGreaterThan(50)
    expect(analytics.previous.decided).toBeGreaterThan(50)
    for (const split of [analytics.byCustomer, analytics.byOwner, analytics.bySource, analytics.byUse]) {
      expect(split.reduce((total, entry) => total + entry.decided, 0)).toBe(analytics.current.decided)
      expect(split.reduce((total, entry) => total + entry.wonValue, 0)).toBeCloseTo(analytics.current.wonValue)
    }
    expect(analytics.byMonth.length).toBe(12)
    expect(analytics.byMonth.at(-1)?.month).toBe('2026-11')
  })

  it('counts the open deals by stage', () => {
    expect(analytics.open.map((entry) => entry.stage)).toEqual(['引き合い', '見積', '試作', '量産の内示'])
    expect(analytics.open.reduce((total, entry) => total + entry.deals, 0)).toBe(14)
  })
})
