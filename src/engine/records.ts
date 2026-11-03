import { daysBetween } from './dates'
import type { OrderForecast } from './scheduler'
import type { Actual, CustomerOrder, PlantData } from './types'

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
