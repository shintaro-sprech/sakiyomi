import { describe, expect, it } from 'vitest'

import { sampleDeals } from '../../sample-data/deals'
import { createSampleData } from '../../sample-data/sample'
import { addDays } from './dates'
import { createDeal, dealAsOf, dealInputErrors, dealProblems, dealStatus, editDeal, type DealInput } from './deals'
import type { Deal } from './types'

const today = '2026-11-05'
const parts = createSampleData(today).parts

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

describe('dealStatus', () => {
  it('reads open, won and lost from the stage, and nothing else', () => {
    expect(['引き合い', '見積', '試作', '量産の内示', '受注', '失注', '商談中'].map(dealStatus)).toEqual([
      'open',
      'open',
      'open',
      'open',
      'won',
      'lost',
      'unknown',
    ])
  })
})

describe('createDeal and editDeal', () => {
  it('records a new deal with one created row, stamped with the same time', () => {
    const { deal, changes } = createDeal('S-1', input, '2026-11-05T10:00')

    expect(deal).toMatchObject({ createdOn: '2026-11-05', stageChangedOn: '2026-11-05', postponeCount: 0 })
    expect(changes).toEqual([{ dealId: 'S-1', field: 'created', from: '', to: '', at: '2026-11-05T10:00' }])
  })

  it('keeps one row per changed field and counts a later close date as a postponement', () => {
    const { deal } = createDeal('S-1', input, '2026-11-05T10:00')
    const later = editDeal(deal, { ...input, stage: '見積', closeDate: '2027-01-15' }, '2026-11-20T15:00')

    expect(later.changes.map((change) => [change.field, change.from, change.to])).toEqual([
      ['stage', '引き合い', '見積'],
      ['closeDate', '2026-12-10', '2027-01-15'],
    ])
    expect(later.deal).toMatchObject({ stageChangedOn: '2026-11-20', postponeCount: 1 })

    const earlier = editDeal(later.deal, { ...input, stage: '見積', closeDate: '2026-12-20' }, '2026-11-25T09:00')
    expect(earlier.deal.postponeCount).toBe(1)
    expect(earlier.deal.stageChangedOn).toBe('2026-11-20')
  })

  it('refuses input that cannot be saved', () => {
    expect(dealInputErrors(input)).toEqual([])
    expect(dealInputErrors({ ...input, name: ' ', stage: '商談中', monthlyQuantity: 0, closeDate: '2026-13-01x' })).toEqual([
      { field: 'name', message: '商談名を入れてください' },
      { field: 'stage', message: 'ステージを選んでください' },
      { field: 'closeDate', message: '受注予定日を日付で入れてください' },
      { field: 'monthlyQuantity', message: '量産数量（月）は0より大きい数にしてください' },
    ])
  })
})

describe('dealProblems', () => {
  const base: Deal = { ...createDeal('S-1', input, '2026-11-01T10:00').deal }

  it('keeps a deal with no part or no quantity out, and flags the rest', () => {
    expect(dealProblems(base, parts, today)).toEqual([])
    expect(dealProblems({ ...base, partNumber: '' }, parts, today).map((problem) => [problem.code, problem.level])).toEqual([['noPart', 'defect']])
    expect(dealProblems({ ...base, monthlyQuantity: 0 }, parts, today).map((problem) => problem.code)).toEqual(['badQuantity'])
    expect(dealProblems({ ...base, partNumber: 'Z-999' }, parts, today).map((problem) => [problem.code, problem.level])).toEqual([
      ['unknownPart', 'warning'],
    ])
  })

  it('flags an open deal past its close date or stuck at a stage, but not a closed one', () => {
    const stuck = { ...base, closeDate: addDays(today, -1), stageChangedOn: addDays(today, -90) }

    expect(dealProblems(stuck, parts, today).map((problem) => problem.code)).toEqual(['closeDatePassed', 'staleStage'])
    expect(dealProblems({ ...stuck, stage: '受注' }, parts, today)).toEqual([])
  })
})

describe('dealAsOf', () => {
  it('rolls a deal back through the changes made at or after a moment', () => {
    const created = createDeal('S-1', input, '2026-11-05T10:00')
    const first = editDeal(created.deal, { ...input, stage: '見積', closeDate: '2027-01-15', monthlyQuantity: 80 }, '2026-11-20T15:00')
    const second = editDeal(first.deal, { ...input, stage: '試作', closeDate: '2027-01-15', monthlyQuantity: 80 }, '2026-12-01T15:00')
    const changes = [...created.changes, ...first.changes, ...second.changes]

    expect(dealAsOf(second.deal, changes, '2026-11-05T10:00')).toBeNull()
    expect(dealAsOf(second.deal, changes, '2026-11-10T00:00')).toMatchObject({
      stage: '引き合い',
      closeDate: '2026-12-10',
      monthlyQuantity: 100,
      postponeCount: 0,
      stageChangedOn: '2026-11-05',
    })
    expect(dealAsOf(second.deal, changes, '2026-11-25T00:00')).toMatchObject({
      stage: '見積',
      closeDate: '2027-01-15',
      monthlyQuantity: 80,
      postponeCount: 1,
      stageChangedOn: '2026-11-20',
    })
  })
})

describe('sampleDeals', () => {
  const { deals, dealChanges } = sampleDeals(today)
  const closed = deals.filter((deal) => dealStatus(deal.stage) !== 'open')
  const open = deals.filter((deal) => dealStatus(deal.stage) === 'open')

  it('has a history of closed deals that all closed at least a week ago, and the open ones', () => {
    expect(closed.length).toBe(280)
    expect(open.length).toBe(14)
    expect(closed.every((deal) => deal.stageChangedOn <= addDays(today, -7))).toBe(true)
    expect(dealChanges.every((change, index) => index === 0 || dealChanges[index - 1].at <= change.at)).toBe(true)
  })

  it('keeps every deal consistent with its own changes', () => {
    for (const deal of deals) {
      const own = dealChanges.filter((change) => change.dealId === deal.id)
      expect(own[0]).toMatchObject({ field: 'created', at: expect.stringMatching(new RegExp(`^${deal.createdOn}T`)) })
      expect(own.filter((change) => change.field === 'closeDate' && change.to > change.from).length).toBe(deal.postponeCount)
      expect(dealAsOf(deal, dealChanges, `${addDays(deal.createdOn, 0)}T23:59`)?.stage ?? '引き合い').toBe('引き合い')
      expect(dealAsOf(deal, dealChanges, '9999-12-31T00:00')).toEqual(deal)
    }
  })

  it('wins about two deals in five, more often with a customer that already buys', () => {
    const won = closed.filter((deal) => deal.stage === '受注')
    const rate = (kind: string) => {
      const of = closed.filter((deal) => deal.customerKind === kind)
      return of.filter((deal) => deal.stage === '受注').length / of.length
    }

    expect(won.length / closed.length).toBeGreaterThan(0.25)
    expect(won.length / closed.length).toBeLessThan(0.6)
    expect(rate('既存')).toBeGreaterThan(rate('新規'))
  })
})
