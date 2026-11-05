import { describe, expect, it } from 'vitest'

import { sampleDeals } from '../../sample-data/deals'
import { createSampleData } from '../../sample-data/sample'
import { defaultBaseDate, reviewChances } from './review'

const today = '2026-11-05'
const parts = createSampleData(today).parts
const { deals, dealChanges } = sampleDeals(today)

describe('reviewChances', () => {
  it('sets the chances of four weeks ago against how the deals went since', () => {
    const review = reviewChances(deals, dealChanges, parts, defaultBaseDate(today))
    if (!review.ok) throw new Error(review.reason)

    expect(review.baseDate).toBe('2026-10-08')
    expect(review.deals.length).toBeGreaterThan(3)
    expect(review.deals.every((entry) => entry.chance >= 0.7)).toBe(true)
    // Every deal counted falls in one band and in one close-date group.
    const total = (groups: { deals: number }[]) => groups.reduce((sum, group) => sum + group.deals, 0)
    expect(total(review.byChance)).toBe(review.deals.length)
    expect(total(review.byCloseDate)).toBe(review.deals.length)
    // A deal decided after the base day was open then, with the close date it had then.
    for (const entry of review.deals) {
      expect(entry.then.stage).not.toBe('受注')
      if (entry.decidedOn) expect(entry.decidedOn > '2026-10-08').toBe(true)
    }
  })

  it('says why there is nothing to look back on', () => {
    expect(reviewChances([], [], parts, '2026-10-08')).toMatchObject({ ok: false })
  })
})
