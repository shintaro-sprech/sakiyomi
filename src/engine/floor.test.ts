import { describe, expect, it } from 'vitest'

import { floorAt, orderTones } from './floor'
import { runPlan } from './plan'
import { createDefaultSettings } from './settings'
import type { PlantData, Settings } from './types'

// 2026-11-03 is a Tuesday. A day shift from 08:00 to 17:00 and one machine that last ran
// another part, so it sets up for 30 minutes, then takes an hour a piece: lot L1 runs
// 08:00-10:30, setup included. Order 3 has 2 pieces not yet released, planned as L3-1 from
// 10:30 to 12:30, and lot L2 follows until 13:30.
const today = '2026-11-03'

function plant(due = '2026-11-20'): PlantData {
  return {
    parts: [{ partNumber: 'P', shape: '丸物', price: 0, materialCost: 0, stock: 100, monthlyUsage: 0 }],
    routes: { P: [{ name: '加工', minutesPerPiece: 60 }] },
    equipment: [{ id: 'M1', name: 'M1', processes: ['加工'], setupMinutes: 30, hourlyCost: 0, lastPart: 'Q' }],
    setupRules: [],
    crews: [],
    attendance: [],
    orders: [
      { id: '1', partNumber: 'P', quantity: 2, due },
      { id: '2', partNumber: 'P', quantity: 1, due },
      { id: '3', partNumber: 'P', quantity: 2, due },
    ],
    lots: [
      { id: 'L1', orderId: '1', quantity: 2, stepIndex: 0, arrivedOn: '2026-11-02' },
      { id: 'L2', orderId: '2', quantity: 1, stepIndex: 0, arrivedOn: '2026-11-02' },
    ],
  }
}

function floor(clock: string, settings: Partial<Settings> = {}, data = plant()) {
  const [hours, minutes] = clock.split(':').map(Number)
  const plan = runPlan({ data, settings: { ...createDefaultSettings(), transferMinutes: 0, ...settings }, adopted: [], today })
  return floorAt(plan, hours * 60 + minutes)[0]
}

describe('floorAt', () => {
  it('has the lots wait at the machine before the shift starts', () => {
    const machine = floor('07:00')

    expect(machine.state).toBe('off')
    expect(machine.current).toBeNull()
    expect(machine.waiting.map((lot) => lot.lotId)).toEqual(['L1', 'L2'])
  })

  it('puts the lot on the machine through its setup and its run', () => {
    expect(floor('08:10')).toMatchObject({ state: 'setup', current: { lotId: 'L1', quantity: 2, endAt: '2026-11-03T10:30' } })
    const running = floor('09:00')

    expect(running).toMatchObject({ state: 'running', current: { lotId: 'L1' } })
    expect(running.waiting.map((lot) => lot.lotId)).toEqual(['L2'])
  })

  it('leaves pieces not yet released off the floor until their first step starts', () => {
    expect(floor('10:00').waiting.map((lot) => lot.lotId)).toEqual(['L2'])
    expect(floor('11:00')).toMatchObject({ current: { lotId: 'L3-1', planned: true }, waiting: [{ lotId: 'L2' }] })
  })

  it('shows a free machine once its work is done', () => {
    expect(floor('16:00')).toMatchObject({ state: 'idle', current: null, waiting: [] })
  })

  it('shows a machine the planner stopped, with the lots that wait for it', () => {
    const machine = floor('09:00', { stoppedEquipment: ['M1'] })

    expect(machine).toMatchObject({ state: 'stopped', current: null })
    // The released lots wait; the pieces not yet released do not come onto the floor.
    expect(machine.waiting.map((lot) => [lot.lotId, lot.quantity])).toEqual([
      ['L1', 2],
      ['L2', 1],
    ])
  })

  it('puts a lot no machine can take in front of the first stopped machine of its step only', () => {
    const data = plant()
    const twoMachines = { ...data, equipment: [...data.equipment, { ...data.equipment[0], id: 'M2', name: 'M2' }] }
    const plan = runPlan({
      data: twoMachines,
      settings: { ...createDefaultSettings(), transferMinutes: 0, stoppedEquipment: ['M1', 'M2'] },
      adopted: [],
      today,
    })
    const [first, second] = floorAt(plan, 9 * 60)

    expect(first.waiting.map((lot) => lot.lotId)).toEqual(['L1', 'L2'])
    expect(second.waiting).toEqual([])
  })
})

describe('orderTones', () => {
  it('tells late orders and orders within a day of their due date from the rest', () => {
    const plan = (due: string) =>
      orderTones(runPlan({ data: plant(due), settings: { ...createDefaultSettings(), transferMinutes: 0 }, adopted: [], today }))

    expect(plan('2026-11-20').get('1')).toBe('ok')
    expect(plan('2026-11-03').get('3')).toBe('tight')
    expect(plan('2026-11-02').get('1')).toBe('late')
  })
})
