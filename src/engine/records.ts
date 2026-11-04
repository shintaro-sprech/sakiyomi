import { addDays, daysBetween } from './dates'
import { DAYS_PER_MONTH } from './demand'
import type { OrderForecast } from './scheduler'
import type { Actual, ChannelStock, CustomerOrder, IsoDate, PlantData } from './types'

// What material on hand does for pieces a part is short of: enough to start them now,
// some of them, or none, so the material has to be ordered first. Null when the plant
// does not track the part's material.
export type MaterialCover =
  | { kind: 'ready'; pieces: number }
  | { kind: 'partly'; pieces: number; toOrder: number }
  | { kind: 'none'; toOrder: number }

export function materialCover(data: PlantData, partNumber: string, pieces: number): MaterialCover | null {
  const onHand = data.parts.find((part) => part.partNumber === partNumber)?.materialStock
  if (onHand === undefined || pieces <= 0) return null
  if (onHand >= pieces) return { kind: 'ready', pieces }
  if (onHand > 0) return { kind: 'partly', pieces: onHand, toOrder: pieces - onHand }
  return { kind: 'none', toOrder: pieces }
}

// Where a distributor's stock stands today and when it will order again: its reported
// stock less what it sold since the report, plus what it has ordered and the plant has not
// shipped yet, the days those last at its rate of sale, and the day they fall to the
// distributor's reorder level, when a month of sales is expected as an order. Shown only;
// the plan's stock still runs on the part's monthly shipments, which include these orders.
export type ChannelOutlook = ChannelStock & {
  stockNow: number
  // Its customer orders behind open orders: ordered from the plant, not shipped yet.
  onOrder: number
  // Null when it sells nothing, so it never runs out or orders.
  daysLeft: number | null
  // Today when it is at or below its reorder level already.
  orderOn: IsoDate | null
  orderQuantity: number
}

export const DEFAULT_REORDER_DAYS = 30

export function channelOutlook(data: PlantData, today: IsoDate): ChannelOutlook[] {
  const partOf = new Map(data.orders.map((order) => [order.id, order.partNumber]))
  return (data.channelStocks ?? []).map((entry) => {
    const perDay = entry.monthlySales / DAYS_PER_MONTH
    const left = Math.max(0, entry.stock - perDay * Math.max(0, daysBetween(entry.asOf, today)))
    const stockNow = Math.round(left)
    const onOrder = (data.customerOrders ?? [])
      .filter(
        (order) =>
          order.channel === 'distributor' &&
          order.customer === entry.customer &&
          partOf.get(order.orderId) === entry.partNumber,
      )
      .reduce((total, order) => total + order.quantity, 0)
    if (perDay <= 0) return { ...entry, stockNow, onOrder, daysLeft: null, orderOn: null, orderQuantity: 0 }
    const daysLeft = Math.floor((left + onOrder) / perDay)
    const reorderDays = entry.reorderDays ?? DEFAULT_REORDER_DAYS
    return {
      ...entry,
      stockNow,
      onOrder,
      daysLeft,
      orderOn: addDays(today, Math.max(0, daysLeft - reorderDays)),
      orderQuantity: Math.round(entry.monthlySales),
    }
  })
}

// The steps one lot has been through, in route order.
export function lotHistory(data: PlantData, lotId: string): Actual[] {
  return (data.actuals ?? []).filter((actual) => actual.lotId === lotId).sort((a, b) => a.stepIndex - b.stepIndex)
}

// Each customer order an open order fills, and whether the plan meets the date promised:
// days late is the forecast finish date minus the answered date, null while unanswered or
// when the order cannot be planned at all, which unplanned tells apart.
export type Delivery = CustomerOrder & { daysLate: number | null; unplanned: boolean }

export function deliveriesOf(data: PlantData, orderId: string, forecast: OrderForecast | undefined): Delivery[] {
  const finish = forecast?.finishDate ?? null
  const unplanned = forecast?.status === 'unscheduled'
  return (data.customerOrders ?? [])
    .filter((entry) => entry.orderId === orderId)
    .map((entry) => ({
      ...entry,
      daysLate: entry.answered && finish ? daysBetween(entry.answered, finish) : null,
      unplanned,
    }))
}
