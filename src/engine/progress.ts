import { daysBetween } from './dates'
import type { IsoDate, Lot, Order, RouteStep } from './types'

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

export function stagnantDays(lot: Lot, today: IsoDate): number {
  return daysBetween(lot.arrivedOn, today)
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}
