import type { IsoDate } from '../engine/types'

// 2026-11-12 -> 11/12
export function shortDate(date: IsoDate | null | undefined): string {
  if (!date) return '—'
  const [, month, day] = date.split('-')
  return `${Number(month)}/${Number(day)}`
}

// 2026-11-12T13:05 -> 11/12 13:05
export function shortDateTime(dateTime: string | null | undefined): string {
  if (!dateTime) return '—'
  const [date, time] = dateTime.split('T')
  return `${shortDate(date)} ${time}`
}

export function percent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}
