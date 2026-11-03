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

const yen = new Intl.NumberFormat('ja-JP')

// 720360 -> 720,360円
export function formatYen(value: number): string {
  return `${yen.format(Math.round(value))}円`
}

// 5625 -> +5,625円, -5625 -> −5,625円
export function signedYen(value: number): string {
  if (Math.round(value) === 0) return '±0円'
  return `${value > 0 ? '+' : '−'}${yen.format(Math.abs(Math.round(value)))}円`
}

export function signedHours(value: number): string {
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}時間`
}
