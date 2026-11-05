import { equipmentCalendar, workingWindow } from './calendar'
import { daysBetween, MINUTES_PER_DAY } from './dates'
import type { Plan } from './plan'
import type { ScheduledOperation } from './scheduler'

// How an order stands against its due date: late, finishing within a day of it, or with room.
export type Tone = 'ok' | 'tight' | 'late'

export function orderTones(plan: Plan): Map<string, Tone> {
  const due = new Map(plan.scenario.data.orders.map((order) => [order.id, order.due]))
  return new Map(
    plan.result.orders.map((forecast): [string, Tone] => {
      const dueDate = due.get(forecast.orderId)
      if (forecast.late) return [forecast.orderId, 'late']
      const tight = dueDate !== undefined && forecast.finishDate !== null && daysBetween(forecast.finishDate, dueDate) <= 1
      return [forecast.orderId, tight ? 'tight' : 'ok']
    }),
  )
}

// What a machine is doing at a moment: working on a lot (its setup first), free, outside its
// working hours, or stopped by the planner or a breakdown.
export type MachineState = 'running' | 'setup' | 'idle' | 'off' | 'stopped'

export type FloorLot = {
  lotId: string
  orderId: string
  partNumber: string
  quantity: number
  stepName: string
  // Pieces not yet released, under the Lot number they will get.
  planned: boolean
  tone: Tone
}

export type FloorMachine = {
  equipmentId: string
  state: MachineState
  // The lot on the machine and when its step ends, also while the machine is off between shifts.
  current: (FloorLot & { endAt: string }) | null
  // Lots that have reached the step this machine runs next for them, in the order it takes them.
  waiting: FloorLot[]
}

// The floor at a minute of the plan (from 00:00 of its first day): what each machine runs and
// which lots wait for it. A lot is where the plan has it: on the machine running its step, or
// waiting for the machine of its next step once the step before is done. Pieces not yet
// released are on the floor only once their first step has started. A lot whose next step the
// plan cannot place, because the machines for it are stopped, waits at those machines.
export function floorAt(plan: Plan, minute: number): FloorMachine[] {
  const { scenario, result } = plan
  const tones = orderTones(plan)
  const lot = (operation: ScheduledOperation): FloorLot => ({
    lotId: operation.lotId,
    orderId: operation.orderId,
    partNumber: operation.partNumber,
    quantity: operation.quantity,
    stepName: operation.stepName,
    planned: operation.planned,
    tone: tones.get(operation.orderId) ?? 'ok',
  })

  const stepsOfLot = new Map<string, ScheduledOperation[]>()
  for (const operation of result.operations) {
    const key = `${operation.orderId}/${operation.lotId}`
    stepsOfLot.set(key, [...(stepsOfLot.get(key) ?? []), operation])
  }
  const current = new Map<string, ScheduledOperation>()
  const stuckAt = new Map<string, FloorLot[]>()
  const waiting = new Map<string, ScheduledOperation[]>()
  for (const steps of stepsOfLot.values()) {
    steps.sort((a, b) => a.stepIndex - b.stepIndex)
    const running = steps.find((operation) => operation.start <= minute && minute < operation.end)
    if (running) {
      current.set(running.equipmentId, running)
      continue
    }
    const next = steps.find((operation) => operation.start > minute)
    if (!next || (next.planned && next === steps[0])) continue
    waiting.set(next.equipmentId, [...(waiting.get(next.equipmentId) ?? []), next])
  }

  const { data, settings } = scenario
  const scheduledLots = new Set(stepsOfLot.keys())
  const stuck = new Set<string>()
  for (const entry of result.unscheduled) {
    const key = `${entry.orderId}/${entry.lotId}`
    const lotOnFloor = data.lots.find((item) => item.id === entry.lotId && item.orderId === entry.orderId)
    if (entry.planned || !lotOnFloor || stuck.has(key)) continue
    // Only once the steps the plan did place are done.
    const placed = stepsOfLot.get(key) ?? []
    if (scheduledLots.has(key) && placed.some((operation) => operation.end > minute)) continue
    stuck.add(key)
    const order = data.orders.find((item) => item.id === entry.orderId)
    const waitingLot: FloorLot = {
      lotId: entry.lotId,
      orderId: entry.orderId,
      partNumber: order?.partNumber ?? '',
      quantity: lotOnFloor.quantity,
      stepName: entry.stepName,
      planned: false,
      tone: tones.get(entry.orderId) ?? 'ok',
    }
    // In front of the first of those machines only, so each lot stands in one place.
    const at = data.equipment.find((equipment) => settings.stoppedEquipment.includes(equipment.id) && equipment.processes.includes(entry.stepName))
    if (at) stuckAt.set(at.id, [...(stuckAt.get(at.id) ?? []), waitingLot])
  }

  const day = Math.floor(minute / MINUTES_PER_DAY)
  return scenario.data.equipment.map((equipment) => {
    const running = current.get(equipment.id) ?? null
    const calendar = equipmentCalendar(scenario, equipment.id, plan.result.planStart)
    const window = workingWindow(calendar, day)
    const stopped =
      scenario.settings.stoppedEquipment.includes(equipment.id) ||
      calendar.down.some((range) => day >= range.from && day <= range.to)
    const working = window !== null && minute >= window.start && minute < window.end
    const state: MachineState = stopped
      ? 'stopped'
      : !working
        ? 'off'
        : running
          ? minute < running.setupEnd
            ? 'setup'
            : 'running'
          : 'idle'
    return {
      equipmentId: equipment.id,
      state,
      current: running && { ...lot(running), endAt: running.endAt },
      waiting: [...(waiting.get(equipment.id) ?? []).sort((a, b) => a.start - b.start).map(lot), ...(stuckAt.get(equipment.id) ?? [])],
    }
  })
}
