// Demand handed to the plan, as versions the planner can look back on. Two kinds are kept
// apart and never added up: what the open deals may bring (made each day the app is opened)
// and the forecast from past orders (made when the planner hands a forecast over). The plan
// shows them beside its open orders; neither changes the plan by itself.
import { addMonths, monthOf, type DealDemand } from './dealDemand'
import type { DemandForecast, ForecastMethod } from './forecast'
import type { IsoDate, Lot, PlantData } from './types'

export type HandoffKind = 'deals' | 'forecast'

export type HandoffRow = {
  partNumber: string
  site?: string
  month: string
  // From deals: with each deal's chance, if every one is won, and the first orders as they are
  // and with each deal's chance.
  expected?: number
  quantity?: number
  firstOrder?: number
  expectedFirstOrder?: number
  // From the forecast.
  forecast?: number
  method?: ForecastMethod
}

export type HandoffVersion = {
  id: string
  kind: HandoffKind
  // Local date and time it was made, YYYY-MM-DDTHH:MM.
  createdAt: string
  // Made by the app each day, or handed over by the planner.
  createdBy: 'auto' | 'planner'
  baseDate: IsoDate
  // What it was made with, in words for the screen.
  conditions: string
  rows: HandoffRow[]
}

// Versions are kept this many days; the newest of each kind stays whatever its age.
export const KEEP_DAYS = 400

// A version's id is unique even when two are made in the same minute.
function versionId(kind: HandoffKind, at: string): string {
  return `${kind}-${at}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function dealsVersion(demand: DealDemand, today: IsoDate, at: string): HandoffVersion {
  const { threshold, leadMonths } = demand.options
  return {
    id: versionId('deals', at),
    kind: 'deals',
    createdAt: at,
    createdBy: 'auto',
    baseDate: today,
    conditions: `確率${Math.round(threshold * 100)}%以上・受注予定日が${Number(demand.periodEnd.slice(5, 7))}/${Number(demand.periodEnd.slice(8, 10))}まで・量産は受注予定月の${leadMonths === 1 ? '翌月' : `${leadMonths}か月後`}から`,
    rows: demand.byMonth.map((entry) => ({
      partNumber: entry.partNumber,
      month: entry.month,
      expected: entry.expected,
      quantity: entry.quantity,
      firstOrder: entry.firstOrder,
      expectedFirstOrder: entry.expectedFirstOrder,
    })),
  }
}

const METHOD_NAMES: Record<ForecastMethod, string> = { model: '学習した予測', recentAverage: '直近3か月の平均', tooShort: '参考値' }

export function forecastVersion(forecast: DemandForecast, today: IsoDate, at: string): HandoffVersion {
  const methods = [...new Set(forecast.series.map((entry) => METHOD_NAMES[entry.method]))].join('・')
  return {
    id: versionId('forecast', at),
    kind: 'forecast',
    createdAt: at,
    createdBy: 'planner',
    baseDate: today,
    conditions: `${methods}・${forecast.months.length}か月（実績は${forecast.lastMonth.replace('-', '/')}まで）`,
    rows: forecast.series.flatMap((entry) =>
      entry.forecast.map((month) => ({ partNumber: entry.partNumber, site: entry.site, month: month.month, forecast: month.quantity, method: entry.method })),
    ),
  }
}

export function methodName(method: ForecastMethod): string {
  return METHOD_NAMES[method]
}

// Adds a version after the others, keeping the newest of each kind and the rest made within
// KEEP_DAYS.
export function addVersion(versions: HandoffVersion[], version: HandoffVersion, today: IsoDate): HandoffVersion[] {
  const all = [...versions, version]
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
  return all.filter((entry) => currentVersion(all, entry.kind)?.id === entry.id || entry.createdAt.slice(0, 10) >= cutoff)
}

// The newest version of a kind; of two made in the same minute, the one added later.
export function currentVersion(versions: HandoffVersion[], kind: HandoffKind): HandoffVersion | null {
  let current: HandoffVersion | null = null
  for (const entry of versions) if (entry.kind === kind && (!current || entry.createdAt >= current.createdAt)) current = entry
  return current
}

// The open orders still to finish, by part and the month they are due: what the plan is set
// to make, for the deals and the forecast to be set beside. Overdue orders count in this month.
export function openOrdersByMonth(data: PlantData, today: IsoDate): { partNumber: string; month: string; quantity: number }[] {
  const cells = new Map<string, { partNumber: string; month: string; quantity: number }>()
  for (const order of data.orders) {
    const routeLength = data.routes[order.partNumber]?.length ?? 0
    const finished = data.lots
      .filter((lot: Lot) => lot.orderId === order.id && lot.stepIndex >= routeLength)
      .reduce((total, lot) => total + lot.quantity, 0)
    const month = order.due < today ? monthOf(today) : monthOf(order.due)
    const key = `${order.partNumber}|${month}`
    const cell = cells.get(key) ?? { partNumber: order.partNumber, month, quantity: 0 }
    cell.quantity += order.quantity - finished
    cells.set(key, cell)
  }
  return [...cells.values()].filter((cell) => cell.quantity > 0).sort((a, b) => a.partNumber.localeCompare(b.partNumber) || a.month.localeCompare(b.month))
}

// Months from this month for `count` months, YYYY-MM.
export function monthsFrom(today: IsoDate, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addMonths(monthOf(today), index))
}
