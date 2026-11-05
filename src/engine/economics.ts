import {
  equipmentCalendar,
  isRegularDay,
  nightMinutes,
  workingSegments,
  workingWindow,
} from './calendar'
import { crewPeople } from './crews'
import { addDays, daysBetween, MINUTES_PER_DAY, parseClock, weekday } from './dates'
import { dailyUsage, lastDayOfMonth, lastDayOfNextMonth, orderDemands, type PriorityClass } from './demand'
import type { Plan } from './plan'
import type { Change } from './scenario'
import { holidayHours, SHIFT_STARTS } from './settings'
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

// What the plan means for this calendar month. Gross profit here is revenue minus
// the costs the plan moves (direct costing): material for what is finished this month,
// machine running cost for the work done this month, and the pay the plan adds, for
// overtime on a day shift and for people called in on a day off. The base pay of the
// people on the regular shifts, night shifts and their premium included, is the same
// whatever the plan does: like other fixed costs, it is not taken off.
export type MonthlyOutlook = {
  month: string
  monthEnd: IsoDate
  completedPieces: number
  revenue: number
  materialCost: number
  // Pay for overtime and for the shifts called in on days off, premiums included.
  overtimePay: number
  holidayPay: number
  machineCost: number
  grossProfit: number
  // Overtime worked past the end of a day shift.
  overtimeHours: number
  // Hours of the people who come in on days off: each crew's holiday people for the whole
  // working day, and a person of its own for each shift a machine called in on its own runs
  // in, paid whole. Overtime on a day off adds the time worked past the end of the day shift,
  // at the holiday rate.
  holidayHours: number
  // Hours of that overtime and holiday work between 22:00 and 05:00, which add the night premium.
  nightHours: number
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

  let overtime = 0
  let overtimeNight = 0
  // Overtime on a day off: the time worked past the end of the shift called in.
  let holidayOvertime = 0
  let holidayOvertimeNight = 0
  let machineCost = 0
  let setup = 0
  // The shifts called in on days off, by machine and day, each kept once.
  const calledShifts = new Map<string, { start: number; end: number }>()
  const shiftStarts = SHIFT_STARTS[settings.shifts].map(parseClock)
  for (const operation of result.operations) {
    if (operation.start >= monthEndMinute) continue
    const calendar = equipmentCalendar(scenario, operation.equipmentId, today)
    for (const segment of workingSegments(calendar, operation.start, Math.min(operation.end, monthEndMinute))) {
      machineCost += ((segment.end - segment.start) / 60) * (equipment.get(operation.equipmentId)?.hourlyCost ?? 0)
      if (isRegularDay(calendar, segment.day)) {
        const from = Math.max(segment.start, segment.day * MINUTES_PER_DAY + calendar.workEnd)
        overtime += Math.max(0, segment.end - from)
        overtimeNight += nightMinutes(from, segment.end)
        continue
      }
      const window = workingWindow(calendar, segment.day)!
      const called = calendar.extraDays.includes(segment.day)
      const dayEnd = segment.day * MINUTES_PER_DAY + (called ? calendar.workEnd : calendar.holidayEnd)
      const shiftEnd = Math.min(window.end, dayEnd)
      // A machine called in on its own pays its person for each shift it runs in; work past the
      // end of the last shift calls that shift in too. On a day its crew comes in, the crew's
      // people are paid below.
      if (called) {
        for (const shift of shiftsOfDay({ start: window.start, end: shiftEnd }, segment.day, shiftStarts)) {
          const within = segment.start < shift.end && segment.end > shift.start
          const after = shift.end === shiftEnd && segment.end > shiftEnd
          if (within || after) calledShifts.set(`${operation.equipmentId}@${shift.start}`, shift)
        }
      }
      const from = Math.max(segment.start, shiftEnd)
      holidayOvertime += Math.max(0, segment.end - from)
      holidayOvertimeNight += nightMinutes(from, segment.end)
    }
    setup += operation.setupMinutes
  }
  // The crews' people who come in on days off this month, paid for their holiday hours.
  let crewHoliday = 0
  let crewHolidayNight = 0
  const hours = holidayHours(settings)
  for (let day = 0; day * MINUTES_PER_DAY < monthEndMinute; day += 1) {
    const date = addDays(today, day)
    if (settings.workWeekdays.includes(weekday(date))) continue
    const start = day * MINUTES_PER_DAY + parseClock(hours.start)
    const end = day * MINUTES_PER_DAY + parseClock(hours.end)
    for (const crew of data.crews) {
      const people = crewPeople(scenario, crew, date)
      crewHoliday += people * (end - start)
      crewHolidayNight += people * nightMinutes(start, end)
    }
  }
  const perMinute = settings.laborRate / 60
  const shifts = [...calledShifts.values()]
  const holiday = crewHoliday + holidayOvertime + shifts.reduce((total, shift) => total + shift.end - shift.start, 0)
  const holidayNight =
    crewHolidayNight + holidayOvertimeNight + shifts.reduce((total, shift) => total + nightMinutes(shift.start, shift.end), 0)
  const overtimePay = perMinute * (overtime * (1 + settings.overtimePremium) + overtimeNight * settings.nightPremium)
  const holidayPay = perMinute * (holiday * (1 + settings.holidayPremium) + holidayNight * settings.nightPremium)

  const amounts = {
    revenue: Math.round(revenue),
    materialCost: Math.round(materialCost),
    overtimePay: Math.round(overtimePay),
    holidayPay: Math.round(holidayPay),
    machineCost: Math.round(machineCost),
  }

  const classCounts: Record<PriorityClass, number> = { A: 0, B: 0, C: 0 }
  for (const demand of orderDemands(data, today)) classCounts[demand.priorityClass] += 1

  return {
    month: monthEnd.slice(0, 7),
    monthEnd,
    completedPieces,
    ...amounts,
    // From the rounded amounts, so the figures shown add up to it to the yen.
    grossProfit: amounts.revenue - amounts.materialCost - amounts.overtimePay - amounts.holidayPay - amounts.machineCost,
    overtimeHours: round1(overtime / 60),
    holidayHours: round1(holiday / 60),
    nightHours: round1((overtimeNight + holidayNight) / 60),
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

// Overtime and holiday work in which the plan runs nothing: no work falls in the extra time
// on those days, past the end of the day for overtime, also on a day off worked as holiday
// work, or anywhere in the day off for holiday work.
export function unusedChanges(plan: Plan, changes: Change[], today: IsoDate): Change[] {
  const { scenario, result } = plan
  return changes.filter((change) => {
    if (change.kind !== 'overtime' && change.kind !== 'holidayWork') return false
    const [from, to] = change.kind === 'overtime' ? [change.from, change.to] : [change.date, change.date]
    const start = daysBetween(today, from) * MINUTES_PER_DAY
    const end = (daysBetween(today, to) + 1) * MINUTES_PER_DAY
    const calendar = equipmentCalendar(scenario, change.equipmentId, today)
    return !result.operations.some((operation) => {
      if (operation.equipmentId !== change.equipmentId) return false
      return workingSegments(calendar, Math.max(operation.start, start), Math.min(operation.end, end)).some((segment) => {
        if (change.kind === 'holidayWork') return !isRegularDay(calendar, segment.day)
        // The day ends at the end of the crew's holiday shift on a day off only the crew comes in on.
        const crewOnly = !isRegularDay(calendar, segment.day) && !calendar.extraDays.includes(segment.day)
        return segment.end > segment.day * MINUTES_PER_DAY + (crewOnly ? calendar.holidayEnd : calendar.workEnd)
      })
    })
  })
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
      // A hair under zero, so a stock that exactly lasts is not short by rounding.
      if (stock < -1e-9) {
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

// The shifts of a working day: one for a day shift, or one from each shift's start to the next.
function shiftsOfDay(window: { start: number; end: number }, day: number, shiftStarts: number[]) {
  const edges = shiftStarts
    .map((start) => day * MINUTES_PER_DAY + start)
    .filter((edge) => edge > window.start && edge < window.end)
  const bounds = [window.start, ...edges, window.end]
  return bounds.slice(0, -1).map((start, index) => ({ start, end: bounds[index + 1] }))
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
