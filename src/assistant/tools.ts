import { compareSchedules, type ScheduleComparison } from '../engine/compare'
import { orderDemands } from '../engine/demand'
import { monthlyOutlook, type MonthlyOutlook } from '../engine/economics'
import { runPlan, type PlanState } from '../engine/plan'
import { summarizeProgress } from '../engine/progress'
import { ChangeError, describeChange, parseChange, sameChange, type Change } from '../engine/scenario'
import { TOOL_NAMES } from './toolSchemas'

// The effect of a set of changes on the current plan, computed by the engine.
export type Effect = {
  comparison: ScheduleComparison
  // This month's outlook with the changes applied.
  outlook: MonthlyOutlook
  // Gross profit and premium hours with the changes, minus without them.
  grossProfitDelta: number
  overtimeHoursDelta: number
  holidayHoursDelta: number
}

// What the planner reported (a delay, a breakdown) and its effect if nothing is done.
export type ReportedEvent = {
  changes: Change[]
  labels: string[]
  effect: Effect
}

// A countermeasure Claude put in front of the planner. Its effect, with the event
// applied too, is computed here, not taken from Claude.
export type ProposedOption = {
  title: string
  reason: string
  tradeoff: string
  event: ReportedEvent
  changes: Change[]
  labels: string[]
  effect: Effect
}

// What adopting or previewing an option adds to the plan: the event, unless an
// earlier decision already put it in, and then the countermeasure.
export function changesToApply(option: ProposedOption, adopted: Change[]): { changes: Change[]; labels: string[] } {
  const pending = option.event.changes
    .map((change, index) => ({ change, label: option.event.labels[index] }))
    .filter(({ change }) => !adopted.some((existing) => sameChange(existing, change)))
  return {
    changes: [...pending.map(({ change }) => change), ...option.changes],
    labels: [...pending.map(({ label }) => label), ...option.labels],
  }
}

export type ToolOutcome = {
  content: string
  isError: boolean
  event?: ReportedEvent
  options?: ProposedOption[]
}

export function executeTool(name: string, input: unknown, state: PlanState): ToolOutcome {
  try {
    switch (name) {
      case TOOL_NAMES.getSituation:
        return ok(describeSituation(state))
      case TOOL_NAMES.getOrderPlan:
        return ok(describeOrderPlan(state, field(input, 'orderId'), optionalField(input, 'changes') ?? []))
      case TOOL_NAMES.simulateChanges:
        return ok(simulate(state, parseChanges(field(input, 'changes'))))
      case TOOL_NAMES.presentOptions:
        return presentOptions(state, optionalField(input, 'event') ?? [], field(input, 'options'))
      default:
        return { content: `ツール「${name}」はありません`, isError: true }
    }
  } catch (error) {
    if (error instanceof ChangeError) return { content: error.message, isError: true }
    throw error
  }
}

function ok(value: unknown): ToolOutcome {
  return { content: JSON.stringify(value), isError: false }
}

function field(input: unknown, key: string): unknown {
  if (typeof input !== 'object' || input === null || !(key in input)) {
    throw new ChangeError(`${key} を指定してください`)
  }
  return (input as Record<string, unknown>)[key]
}

function optionalField(input: unknown, key: string): unknown {
  return typeof input === 'object' && input !== null ? (input as Record<string, unknown>)[key] : undefined
}

function parseChanges(input: unknown): Change[] {
  if (!Array.isArray(input)) throw new ChangeError('changes は配列で指定してください')
  return input.map(parseChange)
}

export function effectOf(state: PlanState, changes: Change[]): Effect {
  const before = runPlan(state)
  const after = runPlan(state, changes)
  const outlookBefore = monthlyOutlook(before, state.today)
  const outlook = monthlyOutlook(after, state.today)
  return {
    comparison: compareSchedules(before.result, after.result),
    outlook,
    grossProfitDelta: outlook.grossProfit - outlookBefore.grossProfit,
    overtimeHoursDelta: round1(outlook.overtimeHours - outlookBefore.overtimeHours),
    holidayHoursDelta: round1(outlook.holidayHours - outlookBefore.holidayHours),
  }
}

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

export function describeSituation(state: PlanState) {
  const plan = runPlan(state)
  const { scenario, result } = plan
  const { data, settings } = scenario
  const forecasts = new Map(result.orders.map((forecast) => [forecast.orderId, forecast]))
  const demands = new Map(orderDemands(data, state.today).map((demand) => [demand.orderId, demand]))

  return {
    today: state.today,
    workHours: `${settings.workStart}-${settings.workEnd}`,
    workdays: settings.workWeekdays.map((day) => WEEKDAY_NAMES[day]).join(''),
    transferMinutes: settings.transferMinutes,
    dueWeight: settings.dueWeight,
    laborRatePerHour: settings.laborRate,
    overtimePremium: settings.overtimePremium,
    holidayPremium: settings.holidayPremium,
    adoptedChanges: state.adopted.map((change) => describeChange(change, data)),
    thisMonth: summarizeOutlook(monthlyOutlook(plan, state.today)),
    parts: data.parts,
    setupRules: data.setupRules,
    crews: data.crews.map((crew) => ({
      name: crew.name,
      processes: crew.processes,
      usualPeople: crew.people,
      equipment: data.equipment.filter((equipment) => crew.processes.includes(equipment.process)).map((equipment) => equipment.id),
      days: result.crewDays
        .filter((day) => day.crew === crew.name)
        .map((day) => ({ date: day.date, people: day.people, mostRunningAtOnce: day.peak })),
    })),
    equipment: data.equipment.map((equipment) => {
      const operations = result.operations.filter((operation) => operation.equipmentId === equipment.id)
      return {
        id: equipment.id,
        name: equipment.name,
        process: equipment.process,
        defaultSetupMinutes: equipment.setupMinutes,
        runningCostPerHour: equipment.hourlyCost,
        stopped: settings.stoppedEquipment.includes(equipment.id),
        plannedHours: round1(operations.reduce((total, operation) => total + operation.workMinutes, 0) / 60),
        busyUntil: operations.length > 0 ? operations[operations.length - 1].endAt : null,
      }
    }),
    routes: Object.fromEntries(
      Object.entries(data.routes).map(([partNumber, route]) => [
        partNumber,
        route.map((step) => `${step.name}(${step.minutesPerPiece}分/個)`).join(' → '),
      ]),
    ),
    orders: data.orders.map((order) => {
      const progress = summarizeProgress([order], data.lots, data.routes[order.partNumber] ?? [])
      const forecast = forecasts.get(order.id)
      const demand = demands.get(order.id)
      return {
        id: order.id,
        partNumber: order.partNumber,
        quantity: order.quantity,
        due: order.due,
        priorityClass: demand?.priorityClass ?? null,
        needBy: demand?.needBy ?? null,
        stockoutOn: demand?.stockoutOn ?? null,
        materialOn: order.materialOn ?? null,
        unstarted: progress.unstarted,
        wip: progress.wip,
        finished: progress.finished,
        forecastFinish: forecast?.finishAt ?? null,
        lateDays: forecast?.lateDays ?? null,
        status: forecast?.status ?? 'done',
      }
    }),
    unscheduled: result.unscheduled,
  }
}

function summarizeOutlook(outlook: MonthlyOutlook) {
  return {
    month: outlook.month,
    revenue: outlook.revenue,
    materialCost: outlook.materialCost,
    laborCost: outlook.laborCost,
    machineRunningCost: outlook.machineCost,
    grossProfit: outlook.grossProfit,
    overtimeHours: outlook.overtimeHours,
    holidayHours: outlook.holidayHours,
    setupHours: outlook.setupHours,
    lateOrders: outlook.lateOrders,
    shortagesUntilEndOfNextMonth: outlook.shortages,
    ordersByClass: outlook.classCounts,
  }
}

function describeOrderPlan(state: PlanState, orderIdInput: unknown, changesInput: unknown) {
  if (typeof orderIdInput !== 'string') throw new ChangeError('orderId を文字で指定してください')
  const changes = parseChanges(changesInput)
  const { scenario, result } = runPlan(state, changes)
  const order = scenario.data.orders.find((candidate) => candidate.id === orderIdInput)
  if (!order) throw new ChangeError(`注番${orderIdInput}は見つかりません`)
  const forecast = result.orders.find((candidate) => candidate.orderId === order.id)

  return {
    changes: changes.map((change) => describeChange(change, scenario.data)),
    orderId: order.id,
    partNumber: order.partNumber,
    quantity: order.quantity,
    due: order.due,
    priorityClass: forecast?.priorityClass ?? null,
    needBy: forecast?.needBy ?? null,
    forecastFinish: forecast?.finishAt ?? null,
    operations: result.operations
      .filter((operation) => operation.orderId === order.id)
      .sort((a, b) => a.start - b.start)
      .map((operation) => ({
        lot: operation.lotId,
        step: operation.stepName,
        equipmentId: operation.equipmentId,
        quantity: operation.quantity,
        setupMinutes: operation.setupMinutes,
        waitedForPeople: operation.waitedForPeople,
        start: operation.startAt,
        end: operation.endAt,
      })),
  }
}

function simulate(state: PlanState, changes: Change[]) {
  const effect = effectOf(state, changes)
  const data = runPlan(state, changes).scenario.data
  return {
    changes: changes.map((change) => describeChange(change, data)),
    lateBefore: effect.comparison.lateBefore,
    lateAfter: effect.comparison.lateAfter,
    newlyLate: effect.comparison.newlyLate,
    noLongerLate: effect.comparison.noLongerLate,
    // Finish dates with their time, so Claude can tell how close a due date is.
    shifted: effect.comparison.shifted.map(({ before, after, beforeAt, afterAt, ...shift }) => ({
      ...shift,
      before: beforeAt ?? before,
      after: afterAt ?? after,
    })),
    grossProfitDelta: effect.grossProfitDelta,
    overtimeHoursDelta: effect.overtimeHoursDelta,
    holidayHoursDelta: effect.holidayHoursDelta,
    thisMonthAfter: summarizeOutlook(effect.outlook),
  }
}

function presentOptions(state: PlanState, eventInput: unknown, optionsInput: unknown): ToolOutcome {
  if (!Array.isArray(optionsInput) || optionsInput.length === 0) {
    throw new ChangeError('options を1つ以上指定してください')
  }
  const eventChanges = parseChanges(eventInput)
  const event: ReportedEvent = {
    changes: eventChanges,
    labels: eventChanges.map((change) => describeChange(change, state.data)),
    effect: effectOf(state, eventChanges),
  }
  const options = optionsInput.map((raw): ProposedOption => {
    const changes = parseChanges(field(raw, 'changes'))
    return {
      title: String(field(raw, 'title')),
      reason: String(field(raw, 'reason')),
      tradeoff: String(field(raw, 'tradeoff')),
      event,
      changes,
      labels: changes.map((change) => describeChange(change, state.data)),
      effect: effectOf(state, [...eventChanges, ...changes]),
    }
  })

  const brief = (effect: Effect) => ({
    lateAfter: effect.comparison.lateAfter,
    newlyLate: effect.comparison.newlyLate,
    noLongerLate: effect.comparison.noLongerLate,
    grossProfitDelta: effect.grossProfitDelta,
    overtimeHoursDelta: effect.overtimeHoursDelta,
    holidayHoursDelta: effect.holidayHoursDelta,
  })
  return {
    content: JSON.stringify({
      ifNothingIsDone: brief(event.effect),
      options: options.map((option) => ({ title: option.title, ...brief(option.effect) })),
    }),
    isError: false,
    event,
    options,
  }
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
