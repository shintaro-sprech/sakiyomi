import { daysBetween } from './dates'
import type { OrderForecast, ScheduleResult } from './scheduler'
import type { IsoDate } from './types'

export type OrderShift = {
  orderId: string
  partNumber: string
  due: IsoDate
  before: IsoDate | null
  after: IsoDate | null
  // after minus before in days; null when either side has no date.
  shiftDays: number | null
  lateBefore: boolean
  lateAfter: boolean
}

export type ScheduleComparison = {
  // Orders whose forecast finish date or lateness changed.
  shifted: OrderShift[]
  newlyLate: string[]
  noLongerLate: string[]
  lateBefore: number
  lateAfter: number
}

export function compareSchedules(before: ScheduleResult, after: ScheduleResult): ScheduleComparison {
  const previous = new Map(before.orders.map((order) => [order.orderId, order]))
  const shifted: OrderShift[] = []

  for (const order of after.orders) {
    const old = previous.get(order.orderId)
    const shift = toShift(old, order)
    if (shift.before !== shift.after || shift.lateBefore !== shift.lateAfter) {
      shifted.push(shift)
    }
  }

  return {
    shifted,
    newlyLate: shifted.filter((shift) => shift.lateAfter && !shift.lateBefore).map((shift) => shift.orderId),
    noLongerLate: shifted.filter((shift) => shift.lateBefore && !shift.lateAfter).map((shift) => shift.orderId),
    lateBefore: before.orders.filter((order) => order.late).length,
    lateAfter: after.orders.filter((order) => order.late).length,
  }
}

function toShift(old: OrderForecast | undefined, order: OrderForecast): OrderShift {
  const before = old?.finishDate ?? null
  const after = order.finishDate
  return {
    orderId: order.orderId,
    partNumber: order.partNumber,
    due: order.due,
    before,
    after,
    shiftDays: before && after ? daysBetween(before, after) : null,
    lateBefore: old?.late ?? false,
    lateAfter: order.late,
  }
}
