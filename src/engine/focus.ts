import { addDays } from './dates'
import { replenishments, type Replenishment } from './demand'
import { monthlyOutlook } from './economics'
import { materialTiming, type Plan, type ReleaseTiming } from './plan'
import { channelOutlook, deliveriesOf, materialCover } from './records'
import type { IsoDate } from './types'

// What a planner should act on first today, worked out from the plan: material to order
// before its last day, orders that miss their due date, distributors about to order,
// promises to customers the plan breaks, and stock about to run out.
export type FocusItem =
  | {
      kind: 'orderMaterial'
      partNumber: string
      // Pieces material on hand covers, and those to order.
      onHand: number
      toOrder: number
      startAt: string
      // Last working day to order; null once that has passed and material ordered today is late.
      orderBy: IsoDate | null
      arrives: IsoDate | null
      leadDays: number | null
      // Orders already added to the plan that wait on this material, when there are any.
      orderIds?: string[]
    }
  | { kind: 'lateOrder'; orderId: string; due: IsoDate; finishDate: IsoDate | null; lateDays: number | null }
  | { kind: 'distributorOrder'; customer: string; partNumber: string; quantity: number; on: IsoDate; stockNow: number; daysLeft: number }
  | { kind: 'promiseMissed'; orderId: string; customer: string; answered: IsoDate; finishDate: IsoDate | null; daysLate: number }
  | { kind: 'shortage'; partNumber: string; from: IsoDate; maxShortage: number }

// How far ahead an item counts as today's: material whose last day to order is this close,
// distributors expected to order within this many days, and stock running out this soon.
const SOON_DAYS = 7

export function todayFocus(
  plan: Plan,
  today: IsoDate,
  timingOf: (item: Replenishment) => ReleaseTiming,
  limit = 4,
): FocusItem[] {
  const data = plan.scenario.data
  const soon = addDays(today, SOON_DAYS)
  const outlook = monthlyOutlook(plan, today)
  const forecasts = new Map(plan.result.orders.map((forecast) => [forecast.orderId, forecast]))

  // What a part lacks and is not in the plan yet, and what was added to the plan for it
  // already: the plan does not wait for material, so ordering it stays on the list until the
  // workbook gives the order its material.
  const added = [...groupBy(data.orders.filter((order) => order.id.startsWith('追加') && !order.materialOn), (order) => order.partNumber)].map(
    ([partNumber, orders]) => {
      const ids = new Set(orders.map((order) => order.id))
      const startAt =
        plan.result.operations.filter((operation) => ids.has(operation.orderId)).sort((a, b) => a.start - b.start)[0]?.startAt ?? null
      const quantity = orders.reduce((total, order) => total + order.quantity, 0)
      return {
        partNumber,
        quantity,
        orderIds: orders.map((order) => order.id),
        timing: materialTiming(data, plan.scenario.settings, today, partNumber, quantity, startAt),
      }
    },
  )
  const toAdd = replenishments(data, today).map((item) => ({
    partNumber: item.partNumber,
    quantity: item.quantity,
    orderIds: undefined as string[] | undefined,
    timing: timingOf(item),
  }))
  const material: FocusItem[] = [...added, ...toAdd].flatMap((item) => {
    const timing = item.timing
    const cover = materialCover(data, item.partNumber, item.quantity)
    if (!timing.startAt || !cover || cover.kind === 'ready' || !timing.materialOrderBy) return []
    if (!timing.materialLate && timing.materialOrderBy > soon) return []
    return [
      {
        kind: 'orderMaterial' as const,
        partNumber: item.partNumber,
        onHand: cover.kind === 'partly' ? cover.pieces : 0,
        toOrder: cover.toOrder,
        startAt: timing.startAt,
        orderBy: timing.materialLate ? null : timing.materialOrderBy,
        arrives: timing.materialArrives,
        leadDays: timing.materialLeadDays,
        ...(item.orderIds ? { orderIds: item.orderIds } : {}),
      },
    ]
  })

  const late: FocusItem[] = outlook.lateOrders.map((order) => ({
    kind: 'lateOrder' as const,
    orderId: order.orderId,
    due: order.due,
    finishDate: order.finishDate,
    lateDays: order.lateDays,
  }))

  const distributors: FocusItem[] = channelOutlook(data, today)
    .filter((entry) => entry.orderOn !== null && entry.daysLeft !== null && entry.orderOn <= soon)
    .sort((a, b) => (a.orderOn ?? '').localeCompare(b.orderOn ?? ''))
    .map((entry) => ({
      kind: 'distributorOrder' as const,
      customer: entry.customer,
      partNumber: entry.partNumber,
      quantity: entry.orderQuantity,
      on: entry.orderOn ?? today,
      stockNow: entry.stockNow,
      daysLeft: entry.daysLeft ?? 0,
    }))

  // A promise counts once its order is on time: an order late for its due date is listed already.
  const lateIds = new Set(outlook.lateOrders.map((order) => order.orderId))
  const promises: FocusItem[] = data.orders
    .filter((order) => !lateIds.has(order.id))
    .flatMap((order) => {
      const forecast = forecasts.get(order.id)
      return deliveriesOf(data, order.id, forecast)
        .filter((entry) => entry.answered && entry.daysLate !== null && entry.daysLate > 0)
        .map((entry) => ({
          kind: 'promiseMissed' as const,
          orderId: order.id,
          customer: entry.customer,
          answered: entry.answered as IsoDate,
          finishDate: forecast?.finishDate ?? null,
          daysLate: entry.daysLate as number,
        }))
    })

  // Stock running out soon. Material ordered now may come too late for it, so it is listed
  // even when ordering that material is.
  const shortages: FocusItem[] = outlook.shortages
    .filter((shortage) => shortage.from <= soon)
    .map((shortage) => ({
      kind: 'shortage' as const,
      partNumber: shortage.partNumber,
      from: shortage.from,
      maxShortage: shortage.maxShortage,
    }))

  // Two material orders at most, so an order late for its due date still makes the list.
  return [...material.slice(0, 2), ...late, ...distributors, ...promises, ...shortages].slice(0, limit)
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item])
  return groups
}
