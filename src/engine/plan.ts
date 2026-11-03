import { buildScenario, type Change, type Scenario } from './scenario'
import { schedule, type ScheduleResult } from './scheduler'
import type { IsoDate, PlantData, Settings } from './types'

// Everything the app needs to compute the current plan.
export type PlanState = {
  data: PlantData
  settings: Settings
  // Changes the planner has adopted, in order.
  adopted: Change[]
  today: IsoDate
}

export type Plan = {
  scenario: Scenario
  result: ScheduleResult
}

// The plan with the adopted changes, plus any extra what-if changes.
export function runPlan(state: PlanState, extra: Change[] = []): Plan {
  const scenario = buildScenario(state.data, state.settings, [...state.adopted, ...extra], state.today)
  return { scenario, result: schedule(scenario, state.today) }
}
