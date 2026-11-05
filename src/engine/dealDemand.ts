// Demand that may come from open deals, part by part and month by month.
//
// A deal counts when it is open, has no defect, its close date is no later than the end of
// the period, and its chance of being won is at least the threshold. An open deal past its
// close date has slipped, not gone away, so it counts as closing today. Its expected quantity
// is the monthly quantity times that chance. Laid out by month, a won deal is taken to start
// volume orders leadMonths after the month it closes and to keep them until the end of the
// period; the month it closes gets the first order, three months of quantity, with no chance
// applied. A deal won in the last WON_WAIT_DAYS days counts too, at a chance of 1 and closing
// the day it was won: its orders have yet to come in as open orders. These numbers are set
// beside the plan and never added to its orders.
import { addDays, daysBetween } from './dates'
import { DAYS_PER_MONTH, dailyUsage } from './demand'
import { dealProblems, dealStatus } from './deals'
import type { Deal, IsoDate, Part } from './types'

export type DealDemandOptions = {
  // 0.7, 0.8 or 0.9: the smallest chance counted.
  threshold: number
  // Calendar months from today that close dates may fall in.
  horizonMonths: number
  // Months from the month a deal closes to the month volume orders start.
  leadMonths: number
}

export const DEAL_DEMAND_DEFAULTS: DealDemandOptions = { threshold: 0.8, horizonMonths: 6, leadMonths: 1 }
export const THRESHOLDS = [0.7, 0.8, 0.9] as const
// Months of quantity in the first order.
export const FIRST_ORDER_MONTHS = 3
// Days a won deal is still counted, while its orders are entered as open orders.
export const WON_WAIT_DAYS = 30

// won is true for a deal already won, counted at a chance of 1 from the day it was won.
export type CountedDeal = { deal: Deal; chance: number; expected: number; won?: boolean }

export type PartDealDemand = {
  partNumber: string
  deals: number
  // Pieces a month if every counted deal is won, and with each one's chance applied.
  quantity: number
  expected: number
  firstOrder: number
  maxChance: number
  earliestClose: IsoDate
  // The same, salesperson by salesperson: most likely first.
  owners: { owner: string; deals: number; quantity: number; expected: number; maxChance: number; earliestClose: IsoDate }[]
}

// expectedFirstOrder is the first orders with each deal's chance applied.
export type MonthDemand = { partNumber: string; month: string; expected: number; quantity: number; firstOrder: number; expectedFirstOrder: number }

export type DealDemand = {
  options: DealDemandOptions
  periodEnd: IsoDate
  // YYYY-MM from this month to the month the period ends.
  months: string[]
  counted: CountedDeal[]
  // Open deals left out, and why.
  belowThreshold: number
  outsidePeriod: number
  withDefect: number
  noChance: number
  byPart: PartDealDemand[]
  byMonth: MonthDemand[]
}

export function monthOf(date: IsoDate): string {
  return date.slice(0, 7)
}

export function addMonths(month: string, count: number): string {
  const [year, value] = month.split('-').map(Number)
  const index = year * 12 + (value - 1) + count
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`
}

// The same day `count` calendar months later, or the month's last day when it has no such day.
export function addCalendarMonths(date: IsoDate, count: number): IsoDate {
  const month = addMonths(monthOf(date), count)
  const lastDay = daysBetween(`${month}-01`, `${addMonths(month, 1)}-01`)
  return `${month}-${String(Math.min(Number(date.slice(8, 10)), lastDay)).padStart(2, '0')}`
}

export function dealDemand(
  deals: Deal[],
  chances: Map<string, number>,
  parts: Part[],
  today: IsoDate,
  options: DealDemandOptions = DEAL_DEMAND_DEFAULTS,
): DealDemand {
  const periodEnd = addCalendarMonths(today, options.horizonMonths)
  const months: string[] = []
  for (let month = monthOf(today); month <= monthOf(periodEnd); month = addMonths(month, 1)) months.push(month)
  const counted: CountedDeal[] = []
  let belowThreshold = 0
  let outsidePeriod = 0
  let withDefect = 0
  let noChance = 0
  for (const deal of deals) {
    const status = dealStatus(deal.stage)
    if (status === 'won' && daysBetween(deal.stageChangedOn, today) < WON_WAIT_DAYS) {
      if (!dealProblems(deal, parts, today).some((problem) => problem.level === 'defect')) {
        counted.push({ deal: { ...deal, closeDate: deal.stageChangedOn }, chance: 1, expected: deal.monthlyQuantity, won: true })
      }
      continue
    }
    if (status !== 'open') continue
    if (dealProblems(deal, parts, today).some((problem) => problem.level === 'defect')) {
      withDefect += 1
      continue
    }
    const chance = chances.get(deal.id)
    if (chance === undefined) {
      noChance += 1
      continue
    }
    if (deal.closeDate > periodEnd) {
      outsidePeriod += 1
      continue
    }
    if (chance < options.threshold) {
      belowThreshold += 1
      continue
    }
    counted.push({ deal, chance, expected: deal.monthlyQuantity * chance })
  }

  const byPart = [...groupBy(counted, (entry) => entry.deal.partNumber)].map(([partNumber, entries]) => ({
    partNumber,
    ...summary(entries),
    firstOrder: FIRST_ORDER_MONTHS * sum(entries, (entry) => entry.deal.monthlyQuantity),
    owners: [...groupBy(entries, (entry) => entry.deal.owner)]
      .map(([owner, own]) => ({ owner, ...summary(own) }))
      .sort((a, b) => b.maxChance - a.maxChance || b.quantity - a.quantity || a.owner.localeCompare(b.owner)),
  }))
  byPart.sort((a, b) => b.expected - a.expected || a.partNumber.localeCompare(b.partNumber))

  const cells = new Map<string, MonthDemand>()
  const cell = (partNumber: string, month: string) => {
    const key = `${partNumber}|${month}`
    if (!cells.has(key)) cells.set(key, { partNumber, month, expected: 0, quantity: 0, firstOrder: 0, expectedFirstOrder: 0 })
    return cells.get(key)!
  }
  for (const { deal, chance } of counted) {
    const closeMonth = monthOf(deal.closeDate < today ? today : deal.closeDate)
    const first = cell(deal.partNumber, closeMonth)
    first.firstOrder += FIRST_ORDER_MONTHS * deal.monthlyQuantity
    first.expectedFirstOrder += FIRST_ORDER_MONTHS * deal.monthlyQuantity * chance
    for (let month = addMonths(closeMonth, options.leadMonths); month <= months[months.length - 1]; month = addMonths(month, 1)) {
      const entry = cell(deal.partNumber, month)
      entry.expected += deal.monthlyQuantity * chance
      entry.quantity += deal.monthlyQuantity
    }
  }
  const byMonth = [...cells.values()].sort((a, b) => a.partNumber.localeCompare(b.partNumber) || a.month.localeCompare(b.month))
  return { options, periodEnd, months, counted, belowThreshold, outsidePeriod, withDefect, noChance, byPart, byMonth }
}

function summary(entries: CountedDeal[]) {
  return {
    deals: entries.length,
    quantity: sum(entries, (entry) => entry.deal.monthlyQuantity),
    expected: sum(entries, (entry) => entry.expected),
    maxChance: Math.max(...entries.map((entry) => entry.chance)),
    earliestClose: entries.map((entry) => entry.deal.closeDate).sort()[0],
  }
}

function sum<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0)
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}

// The day stock that covers `coverage` pieces runs out when, besides the part's own usage
// rate, the counted deals of the part are shipped with each one's chance: its first order over
// the month from its close date (today for one past it), and its monthly quantity from the
// month volume starts, both at an even daily rate, as stockoutDate in demand.ts does for the
// usage alone. Null when it lasts past `until`.
export function stockoutWithDeals(
  coverage: number,
  part: Part,
  counted: CountedDeal[],
  leadMonths: number,
  today: IsoDate,
  until: IsoDate,
): IsoDate | null {
  const deals = counted
    .filter((entry) => entry.deal.partNumber === part.partNumber)
    .map(({ deal, chance }) => {
      const closeOn = deal.closeDate < today ? today : deal.closeDate
      return {
        firstFrom: closeOn,
        firstUntil: addDays(closeOn, DAYS_PER_MONTH),
        firstPerDay: (FIRST_ORDER_MONTHS * deal.monthlyQuantity * chance) / DAYS_PER_MONTH,
        volumeFrom: `${addMonths(monthOf(closeOn), leadMonths)}-01`,
        volumePerDay: (deal.monthlyQuantity * chance) / DAYS_PER_MONTH,
      }
    })
  let used = 0
  for (let date = today; date <= until; date = addDays(date, 1)) {
    const rate =
      dailyUsage(part) +
      deals.reduce(
        (total, deal) =>
          total + (date >= deal.firstFrom && date < deal.firstUntil ? deal.firstPerDay : 0) + (date >= deal.volumeFrom ? deal.volumePerDay : 0),
        0,
      )
    if (rate > 0 && used + rate > coverage) return date
    used += rate
  }
  return null
}
