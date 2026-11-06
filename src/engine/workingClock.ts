import { equipmentCalendar, nextWorkingMinute, workingWindow } from './calendar'
import { MINUTES_PER_DAY } from './dates'
import type { Plan } from './plan'

// When no machine on the floor is in its working hours at a minute of the plan (from 00:00 of
// its first day), the minute the next shift starts on any machine that is not stopped; null
// while some machine is at work, or when none ever is again.
export function nextShiftStart(plan: Plan, minute: number): number | null {
  const { scenario } = plan
  const day = Math.floor(minute / MINUTES_PER_DAY)
  let next: number | null = null
  for (const equipment of scenario.data.equipment) {
    if (scenario.settings.stoppedEquipment.includes(equipment.id)) continue
    const calendar = equipmentCalendar(scenario, equipment.id, plan.result.planStart)
    const window = workingWindow(calendar, day)
    if (window && minute >= window.start && minute < window.end) return null
    const start = nextWorkingMinute(calendar, minute)
    if (start !== null && (next === null || start < next)) next = start
  }
  return next
}
