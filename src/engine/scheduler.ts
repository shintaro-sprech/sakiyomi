import {
  addWorkingMinutes,
  equipmentCalendar,
  isRegularDay,
  nextWorkingMinute,
  SEARCH_LIMIT_DAYS,
  workingSegments,
  type Calendar,
} from './calendar'
import { crewOfEquipment, crewPeople } from './crews'
import { addDays, daysBetween, MINUTES_PER_DAY, minuteToDate, minuteToDateTime, parseClock, weekday } from './dates'
import { orderDemands, type PriorityClass } from './demand'
import type { Scenario } from './scenario'
import { setupMinutes } from './setup'
import type { Crew, Equipment, IsoDate, Lot, PlantData } from './types'

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
  // True when it starts later than the equipment allowed because no one of its crew was free.
  waitedForPeople: boolean
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
  // Pieces not yet released, under the Lot number they will get.
  planned: boolean
  stepIndex: number
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

// People of a crew on one regular working day, the most machines of the crew
// running at once, and the machines that ran.
export type CrewDay = {
  crew: string
  date: IsoDate
  people: number
  peak: number
  machines: string[]
}

export type ScheduleResult = {
  planStart: IsoDate
  operations: ScheduledOperation[]
  unscheduled: UnscheduledOperation[]
  orders: OrderForecast[]
  // Working days within settings.horizonDays, for every crew.
  crewDays: CrewDay[]
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
  crew: Crew | null
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
  waitedForPeople: boolean
}

// Work of each crew already planned, as stretches of working time on regular
// working days. Holiday work brings its own person, so it is not counted.
class Staffing {
  // Keyed by crew name and day, so each check looks at one day's work only.
  private readonly work = new Map<string, { equipmentId: string; start: number; end: number }[]>()
  private readonly people = new Map<string, number>()
  private readonly scenario: Scenario
  private readonly planStart: IsoDate

  constructor(scenario: Scenario, planStart: IsoDate) {
    this.scenario = scenario
    this.planStart = planStart
  }

  peopleOn(crew: Crew, day: number): number {
    const key = `${crew.name}|${day}`
    let people = this.people.get(key)
    if (people === undefined) {
      people = crewPeople(this.scenario, crew, addDays(this.planStart, day))
      this.people.set(key, people)
    }
    return people
  }

  // The first minute of the work at which fewer than spare + 1 people of the
  // crew would be free, or null when there are enough throughout.
  firstShortMinute(machine: Machine, start: number, end: number, spare = 0): number | null {
    if (!machine.crew) return null
    for (const segment of regularSegments(machine, start, end)) {
      const others = this.othersOn(machine, segment.day)
      const limit = this.peopleOn(machine.crew, segment.day) - spare
      const moments = [segment.start, ...others.map((item) => item.start)]
        .filter((moment) => moment >= segment.start && moment < segment.end)
        .sort((a, b) => a - b)
      for (const moment of moments) {
        if (others.filter((item) => item.start <= moment && moment < item.end).length >= limit) return moment
      }
    }
    return null
  }

  // When someone of the crew is next free after a short minute: the first end
  // of the other work running then, or the next day when no one is at work.
  nextFree(machine: Machine, moment: number): number {
    const day = Math.floor(moment / MINUTES_PER_DAY)
    const ends = this.othersOn(machine, day)
      .filter((item) => item.start <= moment && moment < item.end)
      .map((item) => item.end)
    return ends.length > 0 ? Math.min(...ends) : (day + 1) * MINUTES_PER_DAY
  }

  assign(machine: Machine, start: number, end: number): void {
    if (!machine.crew) return
    for (const segment of regularSegments(machine, start, end)) {
      const key = `${machine.crew.name}|${segment.day}`
      this.work.set(key, [
        ...(this.work.get(key) ?? []),
        { equipmentId: machine.equipment.id, start: segment.start, end: segment.end },
      ])
    }
  }

  // The most machines of the crew running at once on the day, and which ran.
  dayOf(crew: Crew, day: number): { peak: number; machines: string[] } {
    const work = this.work.get(`${crew.name}|${day}`) ?? []
    const peak = work.reduce(
      (most, item) => Math.max(most, work.filter((other) => other.start <= item.start && item.start < other.end).length),
      0,
    )
    return { peak, machines: [...new Set(work.map((item) => item.equipmentId))].sort() }
  }

  private othersOn(machine: Machine, day: number) {
    return (this.work.get(`${machine.crew?.name}|${day}`) ?? []).filter(
      (item) => item.equipmentId !== machine.equipment.id,
    )
  }
}

function regularSegments(machine: Machine, start: number, end: number) {
  return workingSegments(machine.calendar, start, end).filter((segment) => isRegularDay(machine.calendar, segment.day))
}

// List scheduler in the Giffler-Thompson style. Each round finds the
// operation that could finish first, then lets every operation that would
// start before that on the same equipment compete by priority:
// expedited first, then demand class (A this month, B next month, C later),
// then a score mixing slack to the need date (days) and setup time (hours)
// by settings.dueWeight, then need date, order id and lot id.
// Setup comes from the shape-to-shape rules; the first operation on each
// piece of equipment needs none.
// A running machine needs one person of its crew, so on a regular working day
// no more machines of a crew run at once than its people at work; people move
// between the crew's machines as work ends. When an operation would take the
// last free person of its crew, the crew's other machines join the
// competition, so people go to the work with the higher priority.
export function schedule(scenario: Scenario, planStart: IsoDate): ScheduleResult {
  const { data, settings } = scenario
  const workEnd = parseClock(settings.workEnd)
  const jobs = buildJobs(scenario, planStart, workEnd)
  const crews = crewOfEquipment(data)
  const staffing = new Staffing(scenario, planStart)
  const machines: Machine[] = data.equipment
    .filter((equipment) => !settings.stoppedEquipment.includes(equipment.id))
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((equipment) => ({
      equipment,
      calendar: equipmentCalendar(scenario, equipment.id, planStart),
      crew: crews.get(equipment.id) ?? null,
      freeAt: 0,
      lastPart: equipment.lastPart || null,
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
        .map((machine) => evaluate(data, staffing, job, machine, step.minutes))
        .filter((candidate): candidate is Candidate => candidate !== null)
      if (found.length === 0) {
        for (const rest of job.steps.slice(job.next)) {
          unscheduled.push({
            lotId: job.lotId,
            orderId: job.orderId,
            planned: job.planned,
            stepIndex: rest.index,
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
      const crewWide = staffing.firstShortMinute(earliest.machine, earliest.start, earliest.end, 1) !== null
      const conflict = candidates.filter(
        (candidate) =>
          candidate.start < earliest.end &&
          (candidate.machine === earliest.machine || (crewWide && candidate.machine.crew === earliest.machine.crew)),
      )
      const chosen = conflict.sort((a, b) => compareCandidates(a, b, settings.dueWeight))[0]
      commit(chosen, planStart, operations, settings.transferMinutes)
      staffing.assign(chosen.machine, chosen.start, chosen.end)
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
    crewDays: describeCrewDays(scenario, planStart, staffing),
  }
}

function describeCrewDays(scenario: Scenario, planStart: IsoDate, staffing: Staffing): CrewDay[] {
  const { data, settings } = scenario
  const days: CrewDay[] = []
  for (const crew of data.crews) {
    for (let day = 0; day < settings.horizonDays; day += 1) {
      const date = addDays(planStart, day)
      if (!settings.workWeekdays.includes(weekday(date))) continue
      days.push({ crew: crew.name, date, people: staffing.peopleOn(crew, day), ...staffing.dayOf(crew, day) })
    }
  }
  return days
}

// The Lot number the pieces not yet released will get: the order's highest number after
// a - or _ plus one, written the same way (L1034-2 → L1034-3), or L<order>-1 when it has
// none. Numbers in taken, real or already given to other orders, are skipped.
export function plannedLotId(orderId: string, lots: Lot[], taken = new Set(lots.map((lot) => lot.id))): string {
  const numbered = lots
    .filter((lot) => lot.orderId === orderId)
    .map((lot) => /^(.*[-_])(\d+)$/.exec(lot.id))
    .filter((match) => match !== null)
    .sort((a, b) => Number(b[2]) - Number(a[2]))
  const [prefix, digits] = numbered.length > 0 ? [numbered[0][1], numbered[0][2]] : [`L${orderId}-`, '0']
  const make = (number: number) => `${prefix}${String(number).padStart(digits.length, '0')}`
  let next = Number(digits) + 1
  while (taken.has(make(next))) next += 1
  taken.add(make(next))
  return make(next)
}

function buildJobs(scenario: Scenario, planStart: IsoDate, workEnd: number): Job[] {
  const { data } = scenario
  const demands = new Map(orderDemands(data, planStart).map((demand) => [demand.orderId, demand]))
  const orders = [...data.orders].sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
  const jobs: Job[] = []
  // Planned Lot numbers go out in order of order number, so a what-if that moves due
  // dates or needs does not move them.
  const lotIds = new Set(data.lots.map((lot) => lot.id))
  const released = (orderId: string) =>
    data.lots.filter((lot) => lot.orderId === orderId).reduce((total, lot) => total + lot.quantity, 0)
  const plannedIds = new Map(
    [...data.orders]
      .filter((order) => order.quantity > released(order.id))
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map((order) => [order.id, plannedLotId(order.id, data.lots, lotIds)]),
  )

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
        lotId: plannedIds.get(order.id) ?? plannedLotId(order.id, data.lots, lotIds),
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

// Where the operation fits on the machine: the first time both the machine and
// the job are free and someone of the crew is free from start to end.
function evaluate(data: PlantData, staffing: Staffing, job: Job, machine: Machine, minutes: number): Candidate | null {
  const setup = setupMinutes(data, machine.equipment, machine.lastPart, job.partNumber)
  const searchEnd = (Math.floor(Math.max(machine.freeAt, job.readyAt) / MINUTES_PER_DAY) + SEARCH_LIMIT_DAYS) * MINUTES_PER_DAY
  let from = Math.max(machine.freeAt, job.readyAt)
  for (let attempt = 0; from < searchEnd; attempt += 1) {
    const start = nextWorkingMinute(machine.calendar, from)
    if (start === null) return null
    const setupEnd = addWorkingMinutes(machine.calendar, start, setup)
    const end = setupEnd === null ? null : addWorkingMinutes(machine.calendar, setupEnd, minutes)
    if (setupEnd === null || end === null) return null
    const short = staffing.firstShortMinute(machine, start, end)
    if (short === null) return { job, machine, setup, start, setupEnd, end, waitedForPeople: attempt > 0 }
    from = staffing.nextFree(machine, short)
  }
  return null
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
    waitedForPeople: candidate.waitedForPeople,
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
