import type { IsoDate } from './types'

export const MINUTES_PER_DAY = 24 * 60
const DAY_MS = MINUTES_PER_DAY * 60 * 1000

function toUtcDays(date: IsoDate): number {
  const [year, month, day] = date.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / DAY_MS
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toUtcDays(to) - toUtcDays(from)
}

// Today in the viewer's own time zone (toISOString would give the UTC date).
export function localToday(): IsoDate {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date((toUtcDays(date) + days) * DAY_MS).toISOString().slice(0, 10)
}

// 0 = Sunday ... 6 = Saturday.
export function weekday(date: IsoDate): number {
  return new Date(toUtcDays(date) * DAY_MS).getUTCDay()
}

export function parseClock(clock: string): number {
  const [hours, minutes] = clock.split(':').map(Number)
  return hours * 60 + minutes
}

export function formatClock(minuteOfDay: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(Math.floor(minuteOfDay / 60))}:${pad(minuteOfDay % 60)}`
}

// Schedules count minutes from 00:00 of the plan's first day.
export function minuteToDate(planStart: IsoDate, minute: number): IsoDate {
  return addDays(planStart, Math.floor(minute / MINUTES_PER_DAY))
}

export function minuteToDateTime(planStart: IsoDate, minute: number): string {
  const day = Math.floor(minute / MINUTES_PER_DAY)
  return `${addDays(planStart, day)}T${formatClock(minute - day * MINUTES_PER_DAY)}`
}
