import { currentTime } from '../state/clock'

// Local date and time now, YYYY-MM-DDTHH:MM.
export function nowAt(): string {
  const now = currentTime()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}
