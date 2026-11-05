import { crewOfEquipment, crewPeople } from './crews'
import { addDays, daysBetween, MINUTES_PER_DAY, parseClock, weekday } from './dates'
import type { Scenario } from './scenario'
import { holidayHours, workHours } from './settings'
import type { IsoDate } from './types'

// Working time of one piece of equipment, in minutes from 00:00 of the plan's first day.
export type Calendar = {
  planStart: IsoDate
  // Weekday of the plan's first day, so day indexes map to weekdays without date math.
  firstWeekday: number
  workStart: number
  workEnd: number
  // The hours the equipment's crew works on a day off it comes in on.
  holidayStart: number
  holidayEnd: number
  workWeekdays: number[]
  // Day indexes, both ends included.
  down: { from: number; to: number }[]
  overtime: { from: number; to: number; minutesPerDay: number }[]
  // Days off that this equipment works anyway, with a person of its own.
  extraDays: number[]
  // Whether people of the equipment's crew come in on a day off, as holiday work.
  crewComesIn: (day: number) => boolean
}

// Work that cannot fit within this many days is treated as unschedulable.
export const SEARCH_LIMIT_DAYS = 366

export function equipmentCalendar(scenario: Scenario, equipmentId: string, planStart: IsoDate): Calendar {
  const day = (date: IsoDate) => daysBetween(planStart, date)
  const hours = workHours(scenario.settings)
  const holiday = holidayHours(scenario.settings)
  return {
    planStart,
    firstWeekday: weekday(planStart),
    workStart: parseClock(hours.start),
    workEnd: parseClock(hours.end),
    holidayStart: parseClock(holiday.start),
    holidayEnd: parseClock(holiday.end),
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
    crewComesIn: crewDaysOff(scenario, equipmentId, planStart),
  }
}

// Days off on which people of the equipment's crew come in, worked out once a day.
function crewDaysOff(scenario: Scenario, equipmentId: string, planStart: IsoDate): (day: number) => boolean {
  const crew = crewOfEquipment(scenario.data).get(equipmentId)
  if (!crew) return () => false
  const known = new Map<number, boolean>()
  return (day) => {
    let comes = known.get(day)
    if (comes === undefined) {
      comes = crewPeople(scenario, crew, addDays(planStart, day)) > 0
      known.set(day, comes)
    }
    return comes
  }
}

// A day of the working week, as opposed to a day off that may be worked as holiday work.
export function isRegularDay(calendar: Calendar, day: number): boolean {
  return calendar.workWeekdays.includes((((calendar.firstWeekday + day) % 7) + 7) % 7)
}

export function workingWindow(calendar: Calendar, day: number): { start: number; end: number } | null {
  if (!isRegularDay(calendar, day) && !calendar.extraDays.includes(day) && !calendar.crewComesIn(day)) return null
  if (calendar.down.some((range) => day >= range.from && day <= range.to)) return null
  const extra = calendar.overtime
    .filter((range) => day >= range.from && day <= range.to)
    .reduce((total, range) => total + range.minutesPerDay, 0)
  const dayStart = day * MINUTES_PER_DAY
  // On a day off only its crew comes in on, the crew's holiday hours.
  const crewOnly = !isRegularDay(calendar, day) && !calendar.extraDays.includes(day)
  const [start, end] = crewOnly ? [calendar.holidayStart, calendar.holidayEnd] : [calendar.workStart, calendar.workEnd]
  return {
    start: dayStart + start,
    end: Math.min(dayStart + end + extra, dayStart + MINUTES_PER_DAY),
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

// Night work by law: 22:00 to 05:00.
const NIGHT_START = 22 * 60
const NIGHT_END = 5 * 60

// Minutes between start and end that fall at night, whatever day they are on.
export function nightMinutes(start: number, end: number): number {
  let total = 0
  for (let day = Math.floor(start / MINUTES_PER_DAY) - 1; day <= Math.floor(end / MINUTES_PER_DAY); day += 1) {
    const from = day * MINUTES_PER_DAY + NIGHT_START
    const to = (day + 1) * MINUTES_PER_DAY + NIGHT_END
    total += Math.max(0, Math.min(end, to) - Math.max(start, from))
  }
  return total
}

// The stretches of working time between start and end, one per day at most.
export function workingSegments(calendar: Calendar, start: number, end: number): { day: number; start: number; end: number }[] {
  const segments: { day: number; start: number; end: number }[] = []
  for (let day = Math.floor(start / MINUTES_PER_DAY); day <= Math.floor((end - 1) / MINUTES_PER_DAY); day += 1) {
    const window = workingWindow(calendar, day)
    if (!window) continue
    const from = Math.max(start, window.start)
    const to = Math.min(end, window.end)
    if (from < to) segments.push({ day, start: from, end: to })
  }
  return segments
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
