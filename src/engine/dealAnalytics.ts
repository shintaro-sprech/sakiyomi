// Deals added up to see how sales go: deals won and lost by the month they were decided, the
// share won, how long deals take, and the same split by customer, salesperson, how the
// inquiry came in and what the part is for. The twelve calendar months up to this one are set
// against the twelve before them; this month counts as far as it has gone. The value of a deal
// is its monthly quantity at the part's price, times twelve.
import { addMonths, monthOf } from './dealDemand'
import { daysBetween } from './dates'
import { dealStatus, OPEN_STAGES } from './deals'
import type { Deal, IsoDate, Part } from './types'

export type Tally = { label: string; decided: number; won: number; lost: number; wonQuantity: number; wonValue: number; winRate: number | null }

export type DealAnalytics = {
  // The twelve calendar months up to this one, and the twelve before them.
  current: Tally & { from: IsoDate; to: IsoDate; daysToWin: number | null; daysToLose: number | null }
  previous: Tally & { from: IsoDate; to: IsoDate }
  byMonth: (Tally & { month: string })[]
  byCustomer: Tally[]
  byOwner: Tally[]
  bySource: Tally[]
  byUse: Tally[]
  // Open deals by stage, in the order of the stages.
  open: { stage: string; deals: number; quantity: number }[]
}

function tally(label: string, deals: Deal[], prices: Map<string, number>): Tally {
  const won = deals.filter((deal) => dealStatus(deal.stage) === 'won')
  const lost = deals.filter((deal) => dealStatus(deal.stage) === 'lost')
  const wonQuantity = won.reduce((total, deal) => total + deal.monthlyQuantity, 0)
  return {
    label,
    decided: won.length + lost.length,
    won: won.length,
    lost: lost.length,
    wonQuantity,
    wonValue: won.reduce((total, deal) => total + deal.monthlyQuantity * (prices.get(deal.partNumber) ?? 0) * 12, 0),
    winRate: won.length + lost.length > 0 ? won.length / (won.length + lost.length) : null,
  }
}

const meanDays = (deals: Deal[]) =>
  deals.length > 0 ? deals.reduce((total, deal) => total + daysBetween(deal.createdOn, deal.stageChangedOn), 0) / deals.length : null

export function dealAnalytics(deals: Deal[], parts: Part[], today: IsoDate): DealAnalytics {
  const prices = new Map(parts.map((part) => [part.partNumber, part.price]))
  const decided = deals.filter((deal) => ['won', 'lost'].includes(dealStatus(deal.stage)))
  // The twelve calendar months up to this one, and the twelve before them.
  const months = Array.from({ length: 12 }, (_, index) => addMonths(monthOf(today), index - 11))
  const from: IsoDate = `${months[0]}-01`
  const previousFrom: IsoDate = `${addMonths(months[0], -12)}-01`
  const inRange = (start: IsoDate, end: IsoDate) => decided.filter((deal) => deal.stageChangedOn >= start && deal.stageChangedOn < end)
  const current = inRange(from, `${addMonths(monthOf(today), 1)}-01`)
  const previous = inRange(previousFrom, from)
  const split = (key: (deal: Deal) => string) =>
    [...new Set(current.map(key))]
      .map((label) => tally(label, current.filter((deal) => key(deal) === label), prices))
      .sort((a, b) => b.wonQuantity - a.wonQuantity || b.decided - a.decided || a.label.localeCompare(b.label))
  return {
    current: {
      ...tally('この1年', current, prices),
      from,
      to: today,
      daysToWin: meanDays(current.filter((deal) => dealStatus(deal.stage) === 'won')),
      daysToLose: meanDays(current.filter((deal) => dealStatus(deal.stage) === 'lost')),
    },
    previous: { ...tally('その前の1年', previous, prices), from: previousFrom, to: from },
    byMonth: months.map((month) => ({ month, ...tally(month, decided.filter((deal) => monthOf(deal.stageChangedOn) === month), prices) })),
    byCustomer: split((deal) => deal.customer),
    byOwner: split((deal) => deal.owner),
    bySource: split((deal) => deal.source),
    byUse: split((deal) => deal.use),
    open: OPEN_STAGES.map((stage) => {
      const atStage = deals.filter((deal) => deal.stage === stage)
      return { stage, deals: atStage.length, quantity: atStage.reduce((total, deal) => total + deal.monthlyQuantity, 0) }
    }),
  }
}
