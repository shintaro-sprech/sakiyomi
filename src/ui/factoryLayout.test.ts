import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { factoryLayout, modelOf } from './factoryLayout'

describe('factoryLayout', () => {
  const data = createSampleData('2026-11-04')

  it('lays the crews out from material to finished goods, each in two rows', () => {
    const layout = factoryLayout(data)

    expect(layout.zones.map((zone) => zone.name)).toEqual(['板金班', '機械班', '仕上げ班'])
    expect(layout.machines).toHaveLength(data.equipment.length)
    expect(layout.material.x).toBeLessThan(layout.zones[0].x0)
    expect(layout.finished.x).toBeGreaterThan(layout.zones.at(-1)!.x1)
    // No two machines share a place.
    expect(new Set(layout.machines.map((machine) => `${machine.x},${machine.z}`)).size).toBe(layout.machines.length)
  })

  it('puts machines of no crew in an area of their own', () => {
    const extra = { id: 'X-1', name: 'X', processes: ['塗装'], setupMinutes: 0, hourlyCost: 0 }
    const layout = factoryLayout({ ...data, equipment: [...data.equipment, extra] })

    expect(layout.zones.at(-1)?.name).toBe('')
    expect(layout.machines.find((machine) => machine.equipment.id === 'X-1')?.model).toBe('generic_machine')
  })

  it('picks a model from what the first process does', () => {
    const model = (process: string) => modelOf({ id: 'M', name: 'M', processes: [process], setupMinutes: 0, hourlyCost: 0 })

    expect(['切断', '曲げ', '溶接', '切削', '熱処理', '研削', '穴あけ', '検査', '梱包'].map(model)).toEqual([
      'cutter',
      'press_brake',
      'welding_robot',
      'machining_center',
      'furnace',
      'grinder',
      'drill_press',
      'inspection_table',
      'packing_table',
    ])
  })
})
