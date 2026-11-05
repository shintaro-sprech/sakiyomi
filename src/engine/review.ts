// Looking back at past chances: what the model would have said of the open deals on an
// earlier day, set against how those deals have gone since. The deals are rolled back to
// that day through their history and the model is trained on what was closed by then, so the
// chances are the ones the app would have shown that day.
import { addCalendarMonths, monthOf } from './dealDemand'
import { addDays } from './dates'
import { dealAsOf, dealProblems, dealStatus } from './deals'
import type { Deal, DealChange, IsoDate, Part } from './types'
import { predictOpenDeals, trainWinModel } from './winModel'

export type Outcome = 'won' | 'lost' | 'open' | 'gone'

export type ReviewedDeal = {
  deal: Deal
  // The deal as it stood on the base day, and its chance then.
  then: Deal
  chance: number
  outcome: Outcome
  // The day it was won or lost.
  decidedOn: IsoDate | null
  // Won or lost by the close date it had on the base day.
  onTime: boolean
}

export type ReviewGroup = { label: string; deals: number; won: number; lost: number; open: number; gone: number; onTime: number }

export type Review =
  | { ok: false; reason: string }
  | {
      ok: true
      baseDate: IsoDate
      deals: ReviewedDeal[]
      byChance: ReviewGroup[]
      // By the close date on the base day: up to today, then month by month.
      byCloseDate: ReviewGroup[]
      byPart: { partNumber: string; deals: number; expected: number; wonQuantity: number }[]
    }

// The bands of chance, highest first, and the smallest chance counted.
export const REVIEW_BANDS = [0.9, 0.8, 0.7, 0.5]

// The newest day at least four weeks back, so the deals have had time to go one way or other.
export function defaultBaseDate(today: IsoDate): IsoDate {
  return addDays(today, -28)
}

export function reviewChances(deals: Deal[], changes: DealChange[], parts: Part[], baseDate: IsoDate, minChance = 0.7): Review {
  const moment = `${baseDate}T23:59`
  const changesThen = changes.filter((change) => change.at < moment)
  const dealsThen = deals.flatMap((deal) => {
    const then = dealAsOf(deal, changes, moment)
    return then ? [{ deal, then }] : []
  })
  const training = trainWinModel(
    dealsThen.map((entry) => entry.then),
    changesThen,
    baseDate,
  )
  if (!training.ok) return { ok: false, reason: `${baseDate.replaceAll('-', '/')}の時点では、${training.reason}` }
  const chances = predictOpenDeals(
    training.model,
    dealsThen.map((entry) => entry.then),
    changesThen,
    baseDate,
  )
  const periodEnd = addCalendarMonths(baseDate, 6)
  const reviewed: ReviewedDeal[] = dealsThen
    .filter(({ then }) => dealStatus(then.stage) === 'open' && !dealProblems(then, parts, baseDate).some((problem) => problem.level === 'defect'))
    .filter(({ then }) => then.closeDate <= periodEnd)
    .flatMap(({ deal, then }) => {
      const chance = chances.get(deal.id)
      if (chance === undefined || chance < minChance) return []
      const status = dealStatus(deal.stage)
      const outcome: Outcome = status === 'won' ? 'won' : status === 'lost' ? 'lost' : status === 'open' ? 'open' : 'gone'
      const decidedOn = outcome === 'won' || outcome === 'lost' ? deal.stageChangedOn : null
      return [{ deal, then, chance, outcome, decidedOn, onTime: decidedOn !== null && decidedOn <= then.closeDate }]
    })
    .sort((a, b) => b.chance - a.chance)

  const group = (label: string, members: ReviewedDeal[]): ReviewGroup => ({
    label,
    deals: members.length,
    won: members.filter((entry) => entry.outcome === 'won').length,
    lost: members.filter((entry) => entry.outcome === 'lost').length,
    open: members.filter((entry) => entry.outcome === 'open').length,
    gone: members.filter((entry) => entry.outcome === 'gone').length,
    onTime: members.filter((entry) => entry.onTime).length,
  })
  const bands = REVIEW_BANDS.filter((band) => band >= minChance)
  const byChance = bands.map((band, index) => {
    const upper = index === 0 ? Infinity : bands[index - 1]
    const label = index === 0 ? `${Math.round(band * 100)}%以上` : `${Math.round(band * 100)}〜${Math.round(upper * 100)}%`
    return group(label, reviewed.filter((entry) => entry.chance >= band && entry.chance < upper))
  })
  // By the month of the close date on the base day; one already past then counts in that month.
  const closeMonth = (entry: ReviewedDeal) => monthOf(entry.then.closeDate < baseDate ? baseDate : entry.then.closeDate)
  const months = [...new Set(reviewed.map(closeMonth))].sort()
  const byCloseDate = months.map((month) =>
    group(`${month === monthOf(baseDate) ? '〜' : ''}${month.replace('-', '/')}`, reviewed.filter((entry) => closeMonth(entry) === month)),
  )
  const parts_ = [...new Set(reviewed.map((entry) => entry.then.partNumber))].sort()
  const byPart = parts_.map((partNumber) => {
    const members = reviewed.filter((entry) => entry.then.partNumber === partNumber)
    return {
      partNumber,
      deals: members.length,
      expected: members.reduce((total, entry) => total + entry.then.monthlyQuantity * entry.chance, 0),
      wonQuantity: members.filter((entry) => entry.outcome === 'won').reduce((total, entry) => total + entry.deal.monthlyQuantity, 0),
    }
  })
  return { ok: true, baseDate, deals: reviewed, byChance, byCloseDate, byPart }
}
