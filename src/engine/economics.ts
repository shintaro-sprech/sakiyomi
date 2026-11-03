import { equipmentCalendar, splitWorkingMinutes } from './calendar'
import { addDays, daysBetween, MINUTES_PER_DAY } from './dates'
import { dailyUsage, lastDayOfMonth, lastDayOfNextMonth, orderDemands, type PriorityClass } from './demand'
import type { Plan } from './plan'
import type { IsoDate } from './types'

export type Shortage = {
  partNumber: string
  from: IsoDate
  // First day stock is back to zero or more; null when it stays short to the end of next month.
  until: IsoDate | null
  maxShortage: number
}

export type LateOrder = {
  orderId: string
  priorityClass: PriorityClass
  due: IsoDate
  finishDate: IsoDate | null
  lateDays: number | null
}

// What the plan means for this calendar month. Gross profit here is
// revenue minus variable cost: material for what is finished this month,
// labor (one person per running machine, with overtime and holiday premiums)
// and machine running cost for the work done this month. Fixed costs are not allocated.
export type MonthlyOutlook = {
  month: string
  monthEnd: IsoDate
  completedPieces: number
  revenue: number
  materialCost: number
  laborCost: number
  machineCost: number
  grossProfit: number
  regularHours: number
  overtimeHours: number
  holidayHours: number
  setupHours: number
  lateOrders: LateOrder[]
  shortages: Shortage[]
  classCounts: Record<PriorityClass, number>
}

export function monthlyOutlook(plan: Plan, today: IsoDate): MonthlyOutlook {
  const { scenario, result } = plan
  const { data, settings } = scenario
  const monthEnd = lastDayOfMonth(today)
  const monthEndMinute = (daysBetween(today, monthEnd) + 1) * MINUTES_PER_DAY
  const parts = new Map(data.parts.map((part) => [part.partNumber, part]))
  const equipment = new Map(data.equipment.map((item) => [item.id, item]))

  // A lot is finished when its last step ends.
  const completions = finalOperations(plan)
  let completedPieces = 0
  let revenue = 0
  let materialCost = 0
  for (const operation of completions) {
    if (operation.end > monthEndMinute) continue
    const part = parts.get(operation.partNumber)
    completedPieces += operation.quantity
    revenue += operation.quantity * (part?.price ?? 0)
    materialCost += operation.quantity * (part?.materialCost ?? 0)
  }

  let regular = 0
  let overtime = 0
  let holiday = 0
  let machineCost = 0
  let setup = 0
  for (const operation of result.operations) {
    if (operation.start >= monthEndMinute) continue
    const calendar = equipmentCalendar(scenario, operation.equipmentId, today)
    const split = splitWorkingMinutes(calendar, operation.start, Math.min(operation.end, monthEndMinute))
    regular += split.regular
    overtime += split.overtime
    holiday += split.holiday
    const worked = split.regular + split.overtime + split.holiday
    machineCost += (worked / 60) * (equipment.get(operation.equipmentId)?.hourlyCost ?? 0)
    setup += operation.setupMinutes
  }
  const laborCost =
    (settings.laborRate / 60) *
    (regular + overtime * (1 + settings.overtimePremium) + holiday * (1 + settings.holidayPremium))

  const classCounts: Record<PriorityClass, number> = { A: 0, B: 0, C: 0 }
  for (const demand of orderDemands(data, today)) classCounts[demand.priorityClass] += 1

  return {
    month: monthEnd.slice(0, 7),
    monthEnd,
    completedPieces,
    revenue: Math.round(revenue),
    materialCost: Math.round(materialCost),
    laborCost: Math.round(laborCost),
    machineCost: Math.round(machineCost),
    grossProfit: Math.round(revenue - materialCost - laborCost - machineCost),
    regularHours: round1(regular / 60),
    overtimeHours: round1(overtime / 60),
    holidayHours: round1(holiday / 60),
    setupHours: round1(setup / 60),
    lateOrders: result.orders
      .filter((forecast) => forecast.late)
      .map((forecast) => ({
        orderId: forecast.orderId,
        priorityClass: forecast.priorityClass,
        due: forecast.due,
        finishDate: forecast.finishDate,
        lateDays: forecast.lateDays,
      })),
    shortages: projectShortages(plan, today, completions),
    classCounts,
  }
}

// Stock day by day to the end of next month: usage takes it down, finished lots bring it up.
function projectShortages(plan: Plan, today: IsoDate, completions: ReturnType<typeof finalOperations>): Shortage[] {
  const lastDay = daysBetween(today, lastDayOfNextMonth(today))
  const shortages: Shortage[] = []

  for (const part of plan.scenario.data.parts) {
    const perDay = dailyUsage(part)
    if (perDay <= 0) continue
    const arrivals = new Map<number, number>()
    for (const operation of completions.filter((candidate) => candidate.partNumber === part.partNumber)) {
      const day = Math.floor(operation.end / MINUTES_PER_DAY)
      arrivals.set(day, (arrivals.get(day) ?? 0) + operation.quantity)
    }

    let stock = part.stock
    let current: Shortage | null = null
    for (let day = 0; day <= lastDay; day += 1) {
      stock += (arrivals.get(day) ?? 0) - perDay
      if (stock < 0) {
        current ??= { partNumber: part.partNumber, from: addDays(today, day), until: null, maxShortage: 0 }
        current.maxShortage = Math.max(current.maxShortage, Math.ceil(-stock))
      } else if (current) {
        current.until = addDays(today, day)
        shortages.push(current)
        current = null
      }
    }
    if (current) shortages.push(current)
  }
  return shortages
}

function finalOperations(plan: Plan) {
  const { data } = plan.scenario
  return plan.result.operations.filter(
    (operation) => operation.stepIndex === (data.routes[operation.partNumber]?.length ?? 0) - 1,
  )
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
