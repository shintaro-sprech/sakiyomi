import { addDays, daysBetween } from './dates'
import type { IsoDate, Lot, Order, Part, PlantData } from './types'

// A: needed by the end of this month (due, or stock runs out). B: needed next month. C: later.
export type PriorityClass = 'A' | 'B' | 'C'

export type OrderDemand = {
  orderId: string
  partNumber: string
  // The earlier of the order's due date and the day stock would run out without it.
  needBy: IsoDate
  // Day stock runs out if this order and the ones after it are not made; null when never.
  stockoutOn: IsoDate | null
  priorityClass: PriorityClass
}

// Average month used to turn monthly usage into a daily rate.
const DAYS_PER_MONTH = 30

export function lastDayOfMonth(date: IsoDate): IsoDate {
  const [year, month] = date.split('-').map(Number)
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10)
}

export function lastDayOfNextMonth(date: IsoDate): IsoDate {
  return lastDayOfMonth(addDays(lastDayOfMonth(date), 1))
}

export function classify(needBy: IsoDate, today: IsoDate): PriorityClass {
  if (needBy <= lastDayOfMonth(today)) return 'A'
  if (needBy <= lastDayOfNextMonth(today)) return 'B'
  return 'C'
}

export function dailyUsage(part: Part): number {
  return part.monthlyUsage / DAYS_PER_MONTH
}

// The day stock that covers `coverage` pieces runs out at the part's usage rate.
export function stockoutDate(coverage: number, part: Part, today: IsoDate): IsoDate | null {
  const perDay = dailyUsage(part)
  if (perDay <= 0) return null
  if (coverage <= 0) return today
  return addDays(today, Math.floor(coverage / perDay))
}

// Each open order of a part refills stock. Taken in due order, an order is needed
// when stock plus the orders before it run out, or by its own due date if earlier.
export function orderDemands(data: PlantData, today: IsoDate): OrderDemand[] {
  const parts = new Map(data.parts.map((part) => [part.partNumber, part]))
  const demands: OrderDemand[] = []

  for (const [partNumber, orders] of groupBy(data.orders, (order) => order.partNumber)) {
    const part = parts.get(partNumber)
    let coverage = part?.stock ?? 0
    for (const order of [...orders].sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))) {
      const stockoutOn = part ? stockoutDate(coverage, part, today) : null
      const needBy = stockoutOn && stockoutOn < order.due ? stockoutOn : order.due
      demands.push({ orderId: order.id, partNumber, needBy, stockoutOn, priorityClass: classify(needBy, today) })
      coverage += remainingQuantity(order, data.lots, data.routes[partNumber]?.length ?? 0)
    }
  }

  return demands.sort((a, b) => a.orderId.localeCompare(b.orderId))
}

// What a part lacks to ship through the end of next month once its stock and every
// open order are counted, and the day those run out. It comes from the quantities
// alone, not from when the plan finishes them: a late order is a matter of time.
export type Replenishment = {
  partNumber: string
  quantity: number
  needBy: IsoDate
}

export function replenishments(data: PlantData, today: IsoDate): Replenishment[] {
  const days = daysBetween(today, lastDayOfNextMonth(today)) + 1
  return data.parts.flatMap((part) => {
    const perDay = dailyUsage(part)
    // A part with no route cannot be made, so there is nothing to add for it.
    if (perDay <= 0 || !data.routes[part.partNumber]) return []
    const routeLength = data.routes[part.partNumber].length
    const coverage =
      part.stock +
      data.orders
        .filter((order) => order.partNumber === part.partNumber)
        .reduce((total, order) => total + remainingQuantity(order, data.lots, routeLength), 0)
    // A hair under, so a shortfall that is a whole number in exact arithmetic stays one.
    const quantity = Math.ceil(perDay * days - coverage - 1e-9)
    if (quantity <= 0) return []
    const runsOut = stockoutDate(coverage, part, today) ?? today
    return [{ partNumber: part.partNumber, quantity, needBy: runsOut < today ? today : runsOut }]
  })
}

// Pieces of the order not yet finished (finished lots are already counted in stock).
function remainingQuantity(order: Order, lots: Lot[], routeLength: number): number {
  const finished = lots
    .filter((lot) => lot.orderId === order.id && lot.stepIndex >= routeLength)
    .reduce((total, lot) => total + lot.quantity, 0)
  return order.quantity - finished
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  }
  return groups
}
