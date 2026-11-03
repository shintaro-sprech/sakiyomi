import { addDays, daysBetween, MINUTES_PER_DAY, parseClock, weekday } from './dates'
import type { Scenario } from './scenario'
import type { IsoDate } from './types'

// Working time of one piece of equipment, in minutes from 00:00 of the plan's first day.
export type Calendar = {
  planStart: IsoDate
  workStart: number
  workEnd: number
  workWeekdays: number[]
  // Day indexes, both ends included.
  down: { from: number; to: number }[]
  overtime: { from: number; to: number; minutesPerDay: number }[]
  // Days off that this equipment works anyway.
  extraDays: number[]
}

// Work that cannot fit within this many days is treated as unschedulable.
const SEARCH_LIMIT_DAYS = 366

export function equipmentCalendar(scenario: Scenario, equipmentId: string, planStart: IsoDate): Calendar {
  const day = (date: IsoDate) => daysBetween(planStart, date)
  return {
    planStart,
    workStart: parseClock(scenario.settings.workStart),
    workEnd: parseClock(scenario.settings.workEnd),
    workWeekdays: scenario.settings.workWeekdays,
    down: scenario.downtime
      .filter((entry) => entry.equipmentId === equipmentId)
      .map((entry) => ({ from: day(entry.from), to: day(entry.to) })),
    overtime: scenario.overtime
      .filter((entry) => entry.equipmentId === equipmentId)
      .map((entry) => ({ from: day(entry.from), to: day(entry.to), minutesPerDay: entry.minutesPerDay })),
    extraDays: scenario.holidayWork
      .filter((entry) => entry.equipmentId === equipmentId)
      .map((entry) => day(entry.date)),
  }
}

export function workingWindow(calendar: Calendar, day: number): { start: number; end: number } | null {
  const workday = calendar.workWeekdays.includes(weekday(addDays(calendar.planStart, day)))
  if (!workday && !calendar.extraDays.includes(day)) return null
  if (calendar.down.some((range) => day >= range.from && day <= range.to)) return null
  const extra = calendar.overtime
    .filter((range) => day >= range.from && day <= range.to)
    .reduce((total, range) => total + range.minutesPerDay, 0)
  const dayStart = day * MINUTES_PER_DAY
  return {
    start: dayStart + calendar.workStart,
    end: Math.min(dayStart + calendar.workEnd + extra, dayStart + MINUTES_PER_DAY),
  }
}

// The first working minute at or after t, or null if there is none in reach.
export function nextWorkingMinute(calendar: Calendar, t: number): number | null {
  const firstDay = Math.floor(t / MINUTES_PER_DAY)
  for (let day = firstDay; day < firstDay + SEARCH_LIMIT_DAYS; day += 1) {
    const window = workingWindow(calendar, day)
    if (window && t < window.end) return Math.max(t, window.start)
  }
  return null
}

// Splits the working time between start and end into regular hours, overtime
// (past the end of a regular day) and holiday work (on a day off), in minutes.
export function splitWorkingMinutes(
  calendar: Calendar,
  start: number,
  end: number,
): { regular: number; overtime: number; holiday: number } {
  const split = { regular: 0, overtime: 0, holiday: 0 }
  if (end <= start) return split
  const overlap = (from: number, to: number) => Math.max(0, Math.min(end, to) - Math.max(start, from))
  for (let day = Math.floor(start / MINUTES_PER_DAY); day <= Math.floor((end - 1) / MINUTES_PER_DAY); day += 1) {
    const window = workingWindow(calendar, day)
    if (!window) continue
    if (!calendar.workWeekdays.includes(weekday(addDays(calendar.planStart, day)))) {
      split.holiday += overlap(window.start, window.end)
      continue
    }
    const regularEnd = day * MINUTES_PER_DAY + calendar.workEnd
    split.regular += overlap(window.start, Math.min(window.end, regularEnd))
    split.overtime += overlap(regularEnd, window.end)
  }
  return split
}

// When work of the given length ends if it starts at start, pausing outside working time.
export function addWorkingMinutes(calendar: Calendar, start: number, minutes: number): number | null {
  if (minutes === 0) return start
  let cursor = start
  let remaining = minutes
  const firstDay = Math.floor(start / MINUTES_PER_DAY)
  for (let day = firstDay; day < firstDay + SEARCH_LIMIT_DAYS; day += 1) {
    const window = workingWindow(calendar, day)
    if (!window) continue
    const from = Math.max(cursor, window.start)
    if (from >= window.end) continue
    const available = window.end - from
    if (remaining <= available) return from + remaining
    remaining -= available
    cursor = window.end
  }
  return null
}
