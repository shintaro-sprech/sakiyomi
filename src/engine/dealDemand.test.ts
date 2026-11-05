import { describe, expect, it } from 'vitest'

import { sampleDeals } from '../../sample-data/deals'
import { createSampleData } from '../../sample-data/sample'
import { addCalendarMonths, addMonths, dealDemand, stockoutWithDeals } from './dealDemand'
import { stockoutDate } from './demand'
import type { Deal } from './types'

const today = '2026-11-05'
const parts = createSampleData(today).parts

const deal = (id: string, fields: Partial<Deal>): Deal => ({
  id,
  name: id,
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
  ...fields,
})

describe('calendar months', () => {
  it('moves by months, keeping the day where the month has it', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02')
    expect(addMonths('2027-01', -1)).toBe('2026-12')
    expect(addCalendarMonths('2026-08-31', 6)).toBe('2027-02-28')
    expect(addCalendarMonths(today, 6)).toBe('2027-05-05')
  })
})

describe('dealDemand', () => {
  const deals = [
    deal('P', { closeDate: '2026-12-08', monthlyQuantity: 60 }),
    deal('Q', { closeDate: '2027-02-15', monthlyQuantity: 40, owner: '営業B' }),
    deal('R', { closeDate: '2027-01-10', monthlyQuantity: 100 }),
    deal('S', { closeDate: '2027-06-01' }),
    deal('V', { closeDate: '2026-11-01', partNumber: 'C-310', monthlyQuantity: 10 }),
    deal('T', { partNumber: '' }),
    deal('U', { stage: '受注', stageChangedOn: '2026-09-01' }),
  ]
  const chances = new Map([
    ['P', 0.95],
    ['Q', 0.8],
    ['R', 0.79],
    ['S', 0.99],
    ['T', 0.99],
    ['V', 0.9],
  ])
  const demand = dealDemand(deals, chances, parts, today)

  it('counts open deals in the period at the threshold or above, a slipped one as closing today, and says why the others are not', () => {
    expect(demand.counted.map((entry) => [entry.deal.id, entry.expected])).toEqual([
      ['P', 57],
      ['Q', 32],
      ['V', 9],
    ])
    expect(demand.byMonth.find((entry) => entry.partNumber === 'C-310' && entry.month === '2026-11')).toMatchObject({ firstOrder: 30, expectedFirstOrder: 27 })
    expect(demand.byMonth.find((entry) => entry.partNumber === 'C-310' && entry.month === '2026-12')).toMatchObject({ expected: 9 })
    expect(demand).toMatchObject({ belowThreshold: 1, outsidePeriod: 1, withDefect: 1, noChance: 0, periodEnd: '2027-05-05' })
    expect(demand.months).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05'])
  })

  it('adds the counted deals up by part and by salesperson', () => {
    expect(demand.byPart.filter((part) => part.partNumber === 'A-100')).toEqual([
      {
        partNumber: 'A-100',
        deals: 2,
        quantity: 100,
        expected: 89,
        firstOrder: 300,
        maxChance: 0.95,
        earliestClose: '2026-12-08',
        owners: [
          { owner: '営業A', deals: 1, quantity: 60, expected: 57, maxChance: 0.95, earliestClose: '2026-12-08' },
          { owner: '営業B', deals: 1, quantity: 40, expected: 32, maxChance: 0.8, earliestClose: '2027-02-15' },
        ],
      },
    ])
  })

  it('starts volume the month after a deal closes and puts the first order in the month it closes', () => {
    const at = (month: string) => demand.byMonth.find((entry) => entry.partNumber === 'A-100' && entry.month === month)
    expect(at('2026-11')).toBeUndefined()
    expect(at('2026-12')).toMatchObject({ expected: 0, quantity: 0, firstOrder: 180, expectedFirstOrder: 171 })
    expect(at('2027-01')).toMatchObject({ expected: 57, quantity: 60, firstOrder: 0 })
    expect(at('2027-02')).toMatchObject({ expected: 57, quantity: 60, firstOrder: 120 })
    expect(at('2027-03')).toMatchObject({ expected: 89, quantity: 100, firstOrder: 0 })
    expect(at('2027-05')).toMatchObject({ expected: 89, quantity: 100 })
  })

  it('counts a deal won in the last 30 days at a chance of 1 from the day it was won', () => {
    const won = dealDemand([deal('X', { stage: '受注', stageChangedOn: '2026-10-25', partNumber: 'D-410', monthlyQuantity: 20 })], new Map(), parts, today)

    expect(won.counted.map((entry) => [entry.deal.id, entry.chance, entry.won])).toEqual([['X', 1, true]])
    expect(won.byMonth.find((entry) => entry.month === '2026-12')).toMatchObject({ partNumber: 'D-410', expected: 20 })
    // Thirty days on, its orders are taken to be in the plan.
    expect(dealDemand([deal('X', { stage: '受注', stageChangedOn: '2026-10-06' })], new Map(), parts, today).counted).toEqual([])
  })

  it('starts volume in the month a deal closes when the lead is 0', () => {
    const now = dealDemand(deals, chances, parts, today, { threshold: 0.8, horizonMonths: 6, leadMonths: 0 })
    expect(now.byMonth.find((entry) => entry.partNumber === 'A-100' && entry.month === '2026-12')).toMatchObject({ expected: 57, firstOrder: 180 })
  })
})

describe('stock with deals', () => {
  const part = parts.find((entry) => entry.partNumber === 'A-100')!
  const counted = (closeDate: string, monthlyQuantity: number, chance: number) => [{ deal: deal('W', { closeDate, monthlyQuantity }), chance, expected: monthlyQuantity * chance }]

  it('runs out on the same day as the usage alone when no deal is counted', () => {
    expect(stockoutWithDeals(360, part, [], 1, today, '2027-12-31')).toBe(stockoutDate(360, part, today))
  })

  it('ships a first order over the month from the close date, then the volume from the month after', () => {
    // 9 a day of usage; from 11/20 a first order of 90 × 0.9 × 3 over 30 days adds 8.1 a day,
    // and from 12/1 the volume of 90 × 0.9 a month adds 2.7 a day more.
    expect(stockoutWithDeals(360, part, counted('2026-11-20', 90, 0.9), 1, today, '2027-12-31')).toBe('2026-12-02')
    // Nothing moves before the close date, so a later deal leaves the day as it was.
    expect(stockoutWithDeals(360, part, counted('2027-01-10', 90, 0.9), 1, today, '2027-12-31')).toBe(stockoutDate(360, part, today))
  })
})

describe('the sample', () => {
  it('counts the likely deals of the sample at the usual threshold', () => {
    const { deals } = sampleDeals(today)
    const chances = new Map(deals.map((entry) => [entry.id, 0.85]))
    const demand = dealDemand(deals, chances, parts, today)

    expect(demand.withDefect).toBe(1)
    expect(demand.outsidePeriod).toBe(0)
    // The deal for a part not in the parts sheet and the one past its close date are only
    // warned about, so they count.
    expect(demand.counted.filter((entry) => !entry.won).length).toBe(13)
    // And the history has deals won in the last 30 days, still waiting for their orders.
    expect(demand.counted.filter((entry) => entry.won).length).toBe(5)
  })
})
