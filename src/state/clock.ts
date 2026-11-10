import { PREPARED_ANSWERS, PREPARED_DAY } from '../assistant/preparedAnswers'
import type { IsoDate } from '../engine/types'

// The day the app treats as today. The public sample stays on the day its prepared
// answers were recorded, because the sample is made from today and the answers name dates.
export const PINNED_DAY: IsoDate | null = PREPARED_ANSWERS ? PREPARED_DAY : null

// The time now. On a pinned day, the clock time of now on that day.
export function currentTime(): Date {
  const now = new Date()
  if (!PINNED_DAY) return now
  const [year, month, day] = PINNED_DAY.split('-').map(Number)
  return new Date(year, month - 1, day, now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds())
}

export function appToday(): IsoDate {
  const now = currentTime()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
