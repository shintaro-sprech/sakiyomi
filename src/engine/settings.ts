import type { Settings } from './types'

export function createDefaultSettings(): Settings {
  return {
    horizonDays: 14,
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
  }
}
