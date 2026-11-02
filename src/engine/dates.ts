import type { IsoDate } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

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
