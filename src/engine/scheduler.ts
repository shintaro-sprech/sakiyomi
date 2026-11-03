import { addWorkingMinutes, equipmentCalendar, nextWorkingMinute, type Calendar } from './calendar'
import { daysBetween, MINUTES_PER_DAY, minuteToDate, minuteToDateTime, parseClock } from './dates'
import { orderDemands, type PriorityClass } from './demand'
import type { Scenario } from './scenario'
import { setupMinutes } from './setup'
import type { Equipment, IsoDate, PlantData } from './types'

export type ScheduledOperation = {
  lotId: string
  orderId: string
  partNumber: string
  stepIndex: number
  stepName: string
  equipmentId: string
  quantity: number
  // True for quantity not yet released as a lot.
  planned: boolean
  setupMinutes: number
  // Working minutes spent, setup included.
  workMinutes: number
  // Minutes from 00:00 of the plan's first day.
  start: number
  setupEnd: number
  end: number
  startAt: string
  endAt: string
}

export type UnscheduledOperation = {
  lotId: string
  orderId: string
  stepName: string
  reason: string
}

export type OrderForecast = {
  orderId: string
  partNumber: string
  due: IsoDate
  needBy: IsoDate
  priorityClass: PriorityClass
  // done: nothing left to make. unscheduled: some step has no equipment that can run it.
  status: 'done' | 'scheduled' | 'unscheduled'
  finishAt: string | null
  finishDate: IsoDate | null
  // finishDate minus due in days; positive means late.
  lateDays: number | null
  late: boolean
}

export type ScheduleResult = {
  planStart: IsoDate
  operations: ScheduledOperation[]
  unscheduled: UnscheduledOperation[]
  orders: OrderForecast[]
}

type Job = {
  lotId: string
  orderId: string
  partNumber: string
  quantity: number
  planned: boolean
  needBy: IsoDate
  // End of the working day the order is needed by, in plan minutes.
  needByEnd: number
  priorityClass: PriorityClass
  expedited: boolean
  steps: { index: number; name: string; minutes: number }[]
  next: number
  readyAt: number
}

type Machine = {
  equipment: Equipment
  calendar: Calendar
  freeAt: number
  lastPart: string | null
}

type Candidate = {
  job: Job
  machine: Machine
  setup: number
  start: number
  setupEnd: number
  end: number
}

// List scheduler in the Giffler-Thompson style. Each round finds the
// operation that could finish first, then lets every operation that would
// start before that on the same equipment compete by priority:
// expedited first, then demand class (A this month, B next month, C later),
// then a score mixing slack to the need date (days) and setup time (hours)
// by settings.dueWeight, then need date, order id and lot id.
// Setup comes from the shape-to-shape rules; the first operation on each
// piece of equipment needs none.
export function schedule(scenario: Scenario, planStart: IsoDate): ScheduleResult {
  const { data, settings } = scenario
  const workEnd = parseClock(settings.workEnd)
  const jobs = buildJobs(scenario, planStart, workEnd)
  const machines: Machine[] = data.equipment
    .filter((equipment) => !settings.stoppedEquipment.includes(equipment.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((equipment) => ({
      equipment,
      calendar: equipmentCalendar(scenario, equipment.id, planStart),
      freeAt: 0,
      lastPart: null,
    }))

  const operations: ScheduledOperation[] = []
  const unscheduled: UnscheduledOperation[] = []
  let active = jobs.filter((job) => job.next < job.steps.length)

  while (active.length > 0) {
    const candidates: Candidate[] = []
    for (const job of active) {
      const step = job.steps[job.next]
      const eligible = machines.filter((machine) => machine.equipment.process === step.name)
      const found = eligible
        .map((machine) => evaluate(data, job, machine, step.minutes))
        .filter((candidate): candidate is Candidate => candidate !== null)
      if (found.length === 0) {
        for (const rest of job.steps.slice(job.next)) {
          unscheduled.push({
            lotId: job.lotId,
            orderId: job.orderId,
            stepName: rest.name,
            reason: eligible.length === 0 ? `「${step.name}」を担当できる設備がありません` : '稼働できる日が見つかりません',
          })
        }
        job.next = job.steps.length
      }
      candidates.push(...found)
    }

    if (candidates.length > 0) {
      const earliest = candidates.reduce((best, candidate) =>
        candidate.end < best.end ||
        (candidate.end === best.end && candidate.machine.equipment.id < best.machine.equipment.id)
          ? candidate
          : best,
      )
      const conflict = candidates.filter(
        (candidate) => candidate.machine === earliest.machine && candidate.start < earliest.end,
      )
      const chosen = conflict.sort((a, b) => compareCandidates(a, b, settings.dueWeight))[0]
      commit(chosen, planStart, operations, settings.transferMinutes)
    }

    active = active.filter((job) => job.next < job.steps.length)
  }

  operations.sort(
    (a, b) => a.equipmentId.localeCompare(b.equipmentId) || a.start - b.start || a.lotId.localeCompare(b.lotId),
  )

  return {
    planStart,
    operations,
    unscheduled,
    orders: forecastOrders(scenario, planStart, operations, unscheduled),
  }
}

function buildJobs(scenario: Scenario, planStart: IsoDate, workEnd: number): Job[] {
  const { data } = scenario
  const demands = new Map(orderDemands(data, planStart).map((demand) => [demand.orderId, demand]))
  const orders = [...data.orders].sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
  const jobs: Job[] = []

  for (const order of orders) {
    const route = data.routes[order.partNumber] ?? []
    const demand = demands.get(order.id)
    const needBy = demand?.needBy ?? order.due
    const holdUntil = scenario.holds
      .filter((hold) => hold.orderId === order.id)
      .reduce((latest, hold) => Math.max(latest, daysBetween(planStart, hold.until) * MINUTES_PER_DAY), 0)
    const base = {
      orderId: order.id,
      partNumber: order.partNumber,
      needBy,
      needByEnd: daysBetween(planStart, needBy) * MINUTES_PER_DAY + workEnd,
      priorityClass: demand?.priorityClass ?? 'C',
      expedited: scenario.expedited.includes(order.id),
    }
    const stepsFrom = (first: number, quantity: number) =>
      route.slice(first).map((step, offset) => ({
        index: first + offset,
        name: step.name,
        minutes: Math.ceil(quantity * step.minutesPerPiece),
      }))

    const lots = data.lots
      .filter((lot) => lot.orderId === order.id)
      .sort((a, b) => a.id.localeCompare(b.id))
    for (const lot of lots) {
      jobs.push({
        ...base,
        lotId: lot.id,
        quantity: lot.quantity,
        planned: false,
        steps: stepsFrom(lot.stepIndex, lot.quantity),
        next: 0,
        readyAt: holdUntil,
      })
    }

    const unreleased = order.quantity - lots.reduce((total, lot) => total + lot.quantity, 0)
    if (unreleased > 0) {
      const materialDay = order.materialOn ? daysBetween(planStart, order.materialOn) : 0
      jobs.push({
        ...base,
        lotId: `${order.id}-未投入`,
        quantity: unreleased,
        planned: true,
        steps: stepsFrom(0, unreleased),
        next: 0,
        readyAt: Math.max(0, materialDay * MINUTES_PER_DAY, holdUntil),
      })
    }
  }
  return jobs
}

function evaluate(data: PlantData, job: Job, machine: Machine, minutes: number): Candidate | null {
  const setup = setupMinutes(data, machine.equipment, machine.lastPart, job.partNumber)
  const start = nextWorkingMinute(machine.calendar, Math.max(machine.freeAt, job.readyAt))
  if (start === null) return null
  const setupEnd = addWorkingMinutes(machine.calendar, start, setup)
  const end = setupEnd === null ? null : addWorkingMinutes(machine.calendar, setupEnd, minutes)
  if (setupEnd === null || end === null) return null
  return { job, machine, setup, start, setupEnd, end }
}

function compareCandidates(a: Candidate, b: Candidate, dueWeight: number): number {
  if (a.job.expedited !== b.job.expedited) return a.job.expedited ? -1 : 1
  return (
    a.job.priorityClass.localeCompare(b.job.priorityClass) ||
    score(a, dueWeight) - score(b, dueWeight) ||
    a.job.needBy.localeCompare(b.job.needBy) ||
    a.job.orderId.localeCompare(b.job.orderId) ||
    a.job.lotId.localeCompare(b.job.lotId)
  )
}

function score(candidate: Candidate, dueWeight: number): number {
  const { job } = candidate
  const remaining = job.steps.slice(job.next + 1).reduce((total, step) => total + step.minutes, 0)
  const slackDays = (job.needByEnd - (candidate.end + remaining)) / MINUTES_PER_DAY
  return dueWeight * slackDays + (1 - dueWeight) * (candidate.setup / 60)
}

function commit(candidate: Candidate, planStart: IsoDate, operations: ScheduledOperation[], transfer: number): void {
  const { job, machine } = candidate
  const step = job.steps[job.next]
  operations.push({
    lotId: job.lotId,
    orderId: job.orderId,
    partNumber: job.partNumber,
    stepIndex: step.index,
    stepName: step.name,
    equipmentId: machine.equipment.id,
    quantity: job.quantity,
    planned: job.planned,
    setupMinutes: candidate.setup,
    workMinutes: candidate.setup + step.minutes,
    start: candidate.start,
    setupEnd: candidate.setupEnd,
    end: candidate.end,
    startAt: minuteToDateTime(planStart, candidate.start),
    endAt: minuteToDateTime(planStart, candidate.end),
  })
  machine.freeAt = candidate.end
  machine.lastPart = job.partNumber
  job.readyAt = candidate.end + transfer
  job.next += 1
}

function forecastOrders(
  scenario: Scenario,
  planStart: IsoDate,
  operations: ScheduledOperation[],
  unscheduled: UnscheduledOperation[],
): OrderForecast[] {
  const demands = new Map(orderDemands(scenario.data, planStart).map((demand) => [demand.orderId, demand]))
  return [...scenario.data.orders]
    .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
    .map((order): OrderForecast => {
      const demand = demands.get(order.id)
      const base = {
        orderId: order.id,
        partNumber: order.partNumber,
        due: order.due,
        needBy: demand?.needBy ?? order.due,
        priorityClass: demand?.priorityClass ?? 'C',
      }
      if (unscheduled.some((entry) => entry.orderId === order.id)) {
        return { ...base, status: 'unscheduled', finishAt: null, finishDate: null, lateDays: null, late: true }
      }
      const ends = operations.filter((operation) => operation.orderId === order.id).map((operation) => operation.end)
      if (ends.length === 0) {
        return { ...base, status: 'done', finishAt: null, finishDate: null, lateDays: null, late: false }
      }
      const finish = Math.max(...ends)
      const finishDate = minuteToDate(planStart, finish)
      const lateDays = daysBetween(order.due, finishDate)
      return {
        ...base,
        status: 'scheduled',
        finishAt: minuteToDateTime(planStart, finish),
        finishDate,
        lateDays,
        late: lateDays > 0,
      }
    })
}
