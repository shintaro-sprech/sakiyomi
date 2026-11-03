import { compareSchedules, type ScheduleComparison } from '../engine/compare'
import { runPlan, type PlanState } from '../engine/plan'
import { summarizeProgress } from '../engine/progress'
import { ChangeError, describeChange, parseChange, sameChange, type Change } from '../engine/scenario'
import { TOOL_NAMES } from './toolSchemas'

// What the planner reported (a delay, a breakdown) and its effect if nothing is done.
export type ReportedEvent = {
  changes: Change[]
  labels: string[]
  comparison: ScheduleComparison
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
  comparison: ScheduleComparison
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
        return ok(describeOrderPlan(state, field(input, 'orderId')))
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

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

export function describeSituation(state: PlanState) {
  const { scenario, result } = runPlan(state)
  const { data, settings } = scenario
  const forecasts = new Map(result.orders.map((forecast) => [forecast.orderId, forecast]))

  return {
    today: state.today,
    workHours: `${settings.workStart}-${settings.workEnd}`,
    workdays: settings.workWeekdays.map((day) => WEEKDAY_NAMES[day]).join(''),
    transferMinutes: settings.transferMinutes,
    dueWeight: settings.dueWeight,
    adoptedChanges: state.adopted.map((change) => describeChange(change, data)),
    equipment: data.equipment.map((equipment) => {
      const operations = result.operations.filter((operation) => operation.equipmentId === equipment.id)
      return {
        id: equipment.id,
        name: equipment.name,
        process: equipment.process,
        setupMinutes: equipment.setupMinutes,
        stopped: settings.stoppedEquipment.includes(equipment.id),
        plannedHours: Math.round(operations.reduce((total, operation) => total + operation.workMinutes, 0) / 6) / 10,
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
      return {
        id: order.id,
        partNumber: order.partNumber,
        quantity: order.quantity,
        due: order.due,
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

function describeOrderPlan(state: PlanState, orderIdInput: unknown) {
  if (typeof orderIdInput !== 'string') throw new ChangeError('orderId を文字で指定してください')
  const { scenario, result } = runPlan(state)
  const order = scenario.data.orders.find((candidate) => candidate.id === orderIdInput)
  if (!order) throw new ChangeError(`注番${orderIdInput}は見つかりません`)
  const forecast = result.orders.find((candidate) => candidate.orderId === order.id)

  return {
    orderId: order.id,
    partNumber: order.partNumber,
    quantity: order.quantity,
    due: order.due,
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
        start: operation.startAt,
        end: operation.endAt,
      })),
  }
}

function simulate(state: PlanState, changes: Change[]) {
  const comparison = compare(state, changes)
  const { scenario, result } = runPlan(state, changes)
  return {
    changes: changes.map((change) => describeChange(change, scenario.data)),
    lateBefore: comparison.lateBefore,
    lateAfter: comparison.lateAfter,
    newlyLate: comparison.newlyLate,
    noLongerLate: comparison.noLongerLate,
    shifted: comparison.shifted,
    lateOrders: result.orders
      .filter((forecast) => forecast.late)
      .map((forecast) => ({ orderId: forecast.orderId, due: forecast.due, finish: forecast.finishDate, lateDays: forecast.lateDays })),
  }
}

function compare(state: PlanState, changes: Change[]): ScheduleComparison {
  return compareSchedules(runPlan(state).result, runPlan(state, changes).result)
}

function presentOptions(state: PlanState, eventInput: unknown, optionsInput: unknown): ToolOutcome {
  if (!Array.isArray(optionsInput) || optionsInput.length === 0) {
    throw new ChangeError('options を1つ以上指定してください')
  }
  const eventChanges = parseChanges(eventInput)
  const event: ReportedEvent = {
    changes: eventChanges,
    labels: eventChanges.map((change) => describeChange(change, state.data)),
    comparison: compare(state, eventChanges),
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
      comparison: compare(state, [...eventChanges, ...changes]),
    }
  })

  const effect = (comparison: ScheduleComparison) => ({
    lateAfter: comparison.lateAfter,
    newlyLate: comparison.newlyLate,
    noLongerLate: comparison.noLongerLate,
  })
  return {
    content: JSON.stringify({
      ifNothingIsDone: effect(event.comparison),
      options: options.map((option) => ({ title: option.title, ...effect(option.comparison) })),
    }),
    isError: false,
    event,
    options,
  }
}
