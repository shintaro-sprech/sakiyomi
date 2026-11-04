import type { Settings } from './types'

export function createDefaultSettings(): Settings {
  return {
    horizonDays: 14,
    shifts: 1,
    workStart: '08:00',
    workEnd: '17:00',
    workWeekdays: [1, 2, 3, 4, 5],
    dueWeight: 0.7,
    stoppedEquipment: [],
    transferMinutes: 60,
    stagnationWarningDays: 3,
    laborRate: 2500,
    overtimePremium: 0.25,
    holidayPremium: 0.35,
    nightPremium: 0.25,
  }
}

// When each shift starts. With three shifts the plant runs round the clock on a working
// day, and the day of the chart runs from 00:00 to 24:00, as the first shift does.
export const SHIFT_STARTS: Record<Settings['shifts'], string[]> = {
  1: [],
  3: ['00:00', '08:00', '16:00'],
}

// The working hours of a working day as HH:MM: the day shift's, or round the clock with
// three shifts.
export function workHours(settings: Settings): { start: string; end: string } {
  return settings.shifts === 3 ? { start: '00:00', end: '24:00' } : { start: settings.workStart, end: settings.workEnd }
}

// The sample plant runs three shifts on weekdays and stops at the weekend.
export function createSampleSettings(): Settings {
  return { ...createDefaultSettings(), shifts: 3 }
}
