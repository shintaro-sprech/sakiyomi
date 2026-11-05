import { describe, expect, it } from 'vitest'

import { sampleDeals } from '../../sample-data/deals'
import { createDeal, editDeal, type DealInput } from './deals'
import { predictOpenDeals, scoresOf, tokenize, trainingRows, trainWinModel } from './winModel'

const today = '2026-11-05'
const sample = sampleDeals(today)

const input: DealInput = {
  name: '新機種のブラケット',
  customer: '取引先A',
  owner: '営業A',
  partNumber: 'A-100',
  stage: '引き合い',
  closeDate: '2026-12-10',
  monthlyQuantity: 100,
  customerKind: '既存',
  source: '紹介',
  use: '建機',
  note: '図面を受け取った',
}

describe('tokenize', () => {
  it('splits a note into words with the browser word breaker', () => {
    expect(tokenize('試作品の評価が良好')).toEqual(expect.arrayContaining(['評価', '良好']))
    expect(tokenize('、。 ')).toEqual([])
  })
})

describe('trainingRows', () => {
  it('takes one row at the middle of each open stage a closed deal went through, as the deal stood then', () => {
    const created = createDeal('S-1', input, '2026-10-01T00:00')
    const quoted = editDeal(created.deal, { ...input, stage: '見積', closeDate: '2026-12-20' }, '2026-10-11T00:00')
    const won = editDeal(quoted.deal, { ...input, stage: '受注', closeDate: '2026-12-20', note: '先方の購買も前向き' }, '2026-10-31T00:00')
    const rows = trainingRows([won.deal], [...created.changes, ...quoted.changes, ...won.changes])

    expect(rows.map((row) => [row.label, row.features.categories.stage, row.features.numeric])).toEqual([
      [1, '引き合い', [5, 5, 0, 65]],
      [1, '見積', [10, 20, 1, 60]],
    ])
    expect(rows[1].features.tokens).toEqual(tokenize('図面を受け取った'))
  })

  it('takes nothing from an open deal or a closed one with no stage changes kept', () => {
    const open = createDeal('S-1', input, '2026-10-01T00:00')
    const closed = { ...createDeal('S-2', input, '2026-10-01T00:00').deal, stage: '失注' }

    expect(trainingRows([open.deal, closed], open.changes)).toEqual([])
  })
})

describe('trainWinModel', () => {
  const result = trainWinModel(sample.deals, sample.dealChanges, today)

  it('learns from the closed deals better than giving every deal the same chance', () => {
    if (!result.ok) throw new Error(result.reason)
    const { scores } = result

    expect(scores.folds).toBe(5)
    expect(scores.wonDeals + scores.lostDeals).toBe(280)
    expect(scores.auc).toBeGreaterThan(0.7)
    expect(scores.brier).toBeLessThan(scores.baselineBrier)
    expect(scores.calibration.reduce((total, bin) => total + bin.rows, 0)).toBe(scores.rows)
    expect(scores.importance[0].share).toBeGreaterThan(0)
  })

  it('gives every open deal a chance, the same every time', () => {
    if (!result.ok) throw new Error(result.reason)
    const chances = predictOpenDeals(result.model, sample.deals, sample.dealChanges, today)
    const again = trainWinModel(sample.deals, sample.dealChanges, today)
    if (!again.ok) throw new Error(again.reason)

    expect(chances.size).toBe(14)
    expect([...chances.values()].every((chance) => chance > 0 && chance < 1)).toBe(true)
    expect(predictOpenDeals(again.model, sample.deals, sample.dealChanges, today)).toEqual(chances)
    // A deal at the last open stage with a customer that already buys is more likely won than
    // a new customer's first inquiry from the website.
    expect(chances.get('S-0304')!).toBeGreaterThan(chances.get('S-0305')!)
  })

  it('says why it cannot learn without wins and losses', () => {
    const lostOnly = sample.deals.filter((deal) => deal.stage === '失注')

    expect(trainWinModel(lostOnly, sample.dealChanges, today)).toEqual({ ok: false, reason: '受注と失注の商談が、それぞれ2件以上要ります' })
    expect(trainWinModel([], [], today)).toMatchObject({ ok: false })
  })
})

describe('scoresOf', () => {
  it('scores a perfect ranking and a coin toss', () => {
    expect(scoresOf([1, 1, 0, 0], [0.9, 0.8, 0.2, 0.1])).toMatchObject({ auc: 1, averagePrecision: 1, precision: 1, recall: 1, accuracy: 1 })
    expect(scoresOf([1, 0, 1, 0], [0.5, 0.5, 0.5, 0.5]).auc).toBe(0.5)
  })
})
