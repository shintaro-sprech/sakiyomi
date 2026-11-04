import { addDays, weekday } from './dates'
import type { Replenishment } from './demand'
import { materialCover } from './records'
import { applyChanges, buildScenario, type Change, type Scenario } from './scenario'
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
  // Adopted changes that no longer apply, such as a hold on an order a since-undone
  // decision added in saved data. Left out so the plan still shows.
  skipped: Change[]
}

// The plan with the adopted changes, plus any extra what-if changes, which must all apply.
export function runPlan(state: PlanState, extra: Change[] = []): Plan {
  const skipped: Change[] = []
  const scenario = buildScenario(state.data, state.settings, state.adopted, state.today, skipped)
  applyChanges(scenario, extra, state.today)
  return { scenario, result: schedule(scenario, state.today), skipped }
}

// When to act on what a part lacks: the start the plan gives it once added as an open
// order, and, when material on hand does not cover it, the last working day to order the
// material so it arrives by that start, or today when that day fell on a day off just
// before. materialOrderBy is null when material on hand covers it or the part's lead time
// is not known; materialLate means material ordered today arrives on materialArrives, the
// working day on or after the lead time, after the start. The plan itself does not wait
// for the material.
export type ReleaseTiming = {
  startAt: string | null
  materialOrderBy: IsoDate | null
  materialLate: boolean
  materialArrives: IsoDate | null
  materialLeadDays: number | null
}

export function releaseTiming(state: PlanState, item: Replenishment, extra: Change[] = []): ReleaseTiming {
  const plan = runPlan(state, [
    ...extra,
    { kind: 'addOrder', partNumber: item.partNumber, quantity: item.quantity, due: item.needBy },
  ])
  // The order is added last, after any the planner or the what-if added before it.
  const added = plan.scenario.data.orders.at(-1)
  const first = plan.result.operations
    .filter((operation) => operation.orderId === added?.id)
    .reduce<{ start: number; startAt: string } | null>(
      (earliest, operation) => (earliest && earliest.start <= operation.start ? earliest : operation),
      null,
    )
  const startAt = first?.startAt ?? null
  const cover = materialCover(state.data, item.partNumber, item.quantity)
  const lead = state.data.parts.find((part) => part.partNumber === item.partNumber)?.materialLeadDays
  if (!startAt || !cover || cover.kind === 'ready' || lead === undefined) {
    return { startAt, materialOrderBy: null, materialLate: false, materialArrives: null, materialLeadDays: lead ?? null }
  }
  const { workWeekdays } = state.settings
  const start = startAt.slice(0, 10)
  const orderBy = workdayNear(addDays(start, -lead), workWeekdays, -1)
  const arrives = workdayNear(addDays(state.today, lead), workWeekdays, 1)
  const late = arrives > start
  return {
    startAt,
    materialOrderBy: late || orderBy >= state.today ? orderBy : state.today,
    materialLate: late,
    materialArrives: late ? arrives : null,
    materialLeadDays: lead,
  }
}

// The date itself when it is a working day, else the nearest working day before it (-1)
// or after it (1).
function workdayNear(date: IsoDate, workWeekdays: number[], direction: -1 | 1): IsoDate {
  let result = date
  for (let step = 0; step < 7 && !workWeekdays.includes(weekday(result)); step += 1) {
    result = addDays(result, direction)
  }
  return result
}
