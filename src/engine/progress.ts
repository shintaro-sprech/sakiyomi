import { daysBetween } from './dates'
import type { OrderDemand } from './demand'
import type { IsoDate, Lot, Order, PlantData, RouteStep } from './types'

export type StepProgress = {
  name: string
  // Pieces that have finished this step.
  done: number
  // done / quantity, from 0 to 1.
  ratio: number
  // Lots sitting at this step (waiting or being worked on).
  lots: Lot[]
  wipQuantity: number
}

export type ProgressSummary = {
  quantity: number
  // Pieces not yet released as a lot.
  unstarted: number
  // Pieces in lots that are somewhere in the route.
  wip: number
  // Pieces that have finished the last step.
  finished: number
  // Share of all step work that is done, from 0 to 1.
  ratio: number
  wipLots: Lot[]
  steps: StepProgress[]
}

// Summarizes one order, or several orders of the same part number,
// against that part number's route.
export function summarizeProgress(orders: Order[], lots: Lot[], route: RouteStep[]): ProgressSummary {
  const orderIds = new Set(orders.map((order) => order.id))
  const released = lots.filter((lot) => orderIds.has(lot.orderId))
  const quantity = sum(orders.map((order) => order.quantity))
  const releasedQuantity = sum(released.map((lot) => lot.quantity))
  const wipLots = released.filter((lot) => lot.stepIndex < route.length)

  const steps = route.map((step, index) => {
    const done = sum(released.filter((lot) => lot.stepIndex > index).map((lot) => lot.quantity))
    const lotsHere = released.filter((lot) => lot.stepIndex === index)
    return {
      name: step.name,
      done,
      ratio: quantity === 0 ? 0 : done / quantity,
      lots: lotsHere,
      wipQuantity: sum(lotsHere.map((lot) => lot.quantity)),
    }
  })

  const finished = sum(released.filter((lot) => lot.stepIndex >= route.length).map((lot) => lot.quantity))
  const totalWork = quantity * route.length

  return {
    quantity,
    unstarted: quantity - releasedQuantity,
    wip: releasedQuantity - finished,
    finished,
    ratio: totalWork === 0 ? 0 : sum(steps.map((step) => step.done)) / totalWork,
    wipLots,
    steps,
  }
}

// Why an order is needed when it is: class A split by whether stock running out
// or the due date comes first, then classes B and C.
export type Urgency = 'A-stockout' | 'A-due' | 'B' | 'C'

export const URGENCIES: Urgency[] = ['A-stockout', 'A-due', 'B', 'C']

export type WipCell = {
  quantity: number
  lots: Lot[]
  // Pieces of each order not yet released as a lot (only in the unreleased column).
  unreleased: { orderId: string; quantity: number }[]
}

export type WipColumn = {
  kind: 'unreleased' | 'process' | 'finished'
  // The process name, for process columns.
  process: string | null
  crew: string | null
  // This month's (class A) pieces whose route has this process: how many have
  // passed it and how many sit at it now. Null when none, or not a process column.
  thisMonth: { quantity: number; passed: number; here: number } | null
  cells: Record<Urgency, WipCell>
}

export function urgencyOf(demand: OrderDemand, order: Order): Urgency {
  if (demand.priorityClass !== 'A') return demand.priorityClass
  return demand.stockoutOn !== null && demand.stockoutOn < order.due ? 'A-stockout' : 'A-due'
}

// Where the work of every order sits now, by process and urgency. Processes are
// grouped by crew in the crews' order, then those in no crew by how early they
// come in a route; the unreleased pieces come first and the finished lots last.
export function summarizeWip(data: PlantData, demands: OrderDemand[]): WipColumn[] {
  const demandOf = new Map(demands.map((demand) => [demand.orderId, demand]))
  const orderOf = new Map(data.orders.map((order) => [order.id, order]))
  const urgencyOfOrder = (orderId: string): Urgency | null => {
    const demand = demandOf.get(orderId)
    const order = orderOf.get(orderId)
    return demand && order ? urgencyOf(demand, order) : null
  }

  // Each routed process with the earliest step it is anywhere, in order of first appearance.
  const earliestStep = new Map<string, number>()
  for (const route of Object.values(data.routes)) {
    route.forEach((step, index) => earliestStep.set(step.name, Math.min(earliestStep.get(step.name) ?? index, index)))
  }
  const crewOf = new Map(data.crews.flatMap((crew) => crew.processes.map((process) => [process, crew.name] as const)))
  const processes = [
    ...data.crews.flatMap((crew) => crew.processes.filter((process) => earliestStep.has(process))),
    ...[...earliestStep.keys()]
      .filter((process) => !crewOf.has(process))
      .sort((a, b) => earliestStep.get(a)! - earliestStep.get(b)!),
  ]

  const unreleased = column('unreleased', null)
  const finished = column('finished', null)
  const byProcess = new Map(processes.map((process) => [process, column('process', process)]))

  for (const lot of data.lots) {
    const urgency = urgencyOfOrder(lot.orderId)
    const route = data.routes[orderOf.get(lot.orderId)?.partNumber ?? ''] ?? []
    const place = lot.stepIndex >= route.length ? finished : byProcess.get(route[lot.stepIndex].name)
    if (!urgency || !place) continue
    place.cells[urgency].quantity += lot.quantity
    place.cells[urgency].lots.push(lot)
  }

  for (const order of data.orders) {
    const urgency = urgencyOfOrder(order.id)
    const released = sum(data.lots.filter((lot) => lot.orderId === order.id).map((lot) => lot.quantity))
    const quantity = order.quantity - released
    if (!urgency) continue
    if (quantity > 0) {
      unreleased.cells[urgency].quantity += quantity
      unreleased.cells[urgency].unreleased.push({ orderId: order.id, quantity })
    }

    if (urgency !== 'A-stockout' && urgency !== 'A-due') continue
    const route = data.routes[order.partNumber] ?? []
    const lots = data.lots.filter((lot) => lot.orderId === order.id)
    // A route can pass a process more than once: a lot has passed it only after the last time.
    for (const process of new Set(route.map((step) => step.name))) {
      const place = byProcess.get(process)
      if (!place) continue
      const visits = route.flatMap((step, index) => (step.name === process ? [index] : []))
      place.thisMonth ??= { quantity: 0, passed: 0, here: 0 }
      place.thisMonth.quantity += order.quantity
      place.thisMonth.passed += sum(lots.filter((lot) => lot.stepIndex > visits.at(-1)!).map((lot) => lot.quantity))
      place.thisMonth.here += sum(lots.filter((lot) => visits.includes(lot.stepIndex)).map((lot) => lot.quantity))
    }
  }

  return [unreleased, ...byProcess.values(), finished]

  function column(kind: WipColumn['kind'], process: string | null): WipColumn {
    const cells = Object.fromEntries(
      URGENCIES.map((urgency) => [urgency, { quantity: 0, lots: [], unreleased: [] }]),
    ) as unknown as Record<Urgency, WipCell>
    return { kind, process, crew: process === null ? null : (crewOf.get(process) ?? null), thisMonth: null, cells }
  }
}

export function stagnantDays(lot: Lot, today: IsoDate): number {
  return daysBetween(lot.arrivedOn, today)
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
