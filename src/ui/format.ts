import { weekday } from '../engine/dates'
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
// 193500000 -> 1億9,350万円: a large amount, short enough to keep on one line.
export function largeYen(value: number): string {
  const rounded = Math.round(value / 10_000)
  const oku = Math.floor(rounded / 10_000)
  const man = rounded % 10_000
  if (oku === 0) return `${yen.format(man)}万円`
  return man === 0 ? `${yen.format(oku)}億円` : `${yen.format(oku)}億${yen.format(man)}万円`
}

export function signedYen(value: number): string {
  if (Math.round(value) === 0) return '±0円'
  return `${value > 0 ? '+' : '−'}${yen.format(Math.abs(Math.round(value)))}円`
}

export function signedHours(value: number): string {
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}時間`
}

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

export function weekdayName(date: IsoDate): string {
  return WEEKDAY_NAMES[weekday(date)]
}


const decimal = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 })

// 0.9312 -> 93.1%, 0.96 -> 96.0%: a chance to one decimal, cut down rather than rounded, so one
// just under a threshold never reads as on it.
export function chance(ratio: number): string {
  return `${(Math.floor(ratio * 1000 + 1e-9) / 10).toFixed(1)}%`
}

// The day as 11/12 in this year and as 2025/11/12 in any other.
export function dateInYear(date: IsoDate | null | undefined, today: IsoDate): string {
  if (!date) return '-'
  return date.slice(0, 4) === today.slice(0, 4) ? shortDate(date) : `${date.slice(0, 4)}/${shortDate(date)}`
}

// 1234.56 -> 1,234.6: a quantity that may have a fraction, such as an expected quantity.
export function pieces(value: number): string {
  return decimal.format(Math.round(value * 10) / 10)
}

// 2027-01 -> 2027/01
export function yearMonth(month: string): string {
  return month.replace('-', '/')
}
