import { crewOfEquipment } from '../engine/crews'
import type { Equipment, PlantData } from '../engine/types'

// The machine models in public/models, made by scripts/models/build.mjs.
export type MachineModel =
  | 'cutter'
  | 'press_brake'
  | 'welding_robot'
  | 'machining_center'
  | 'furnace'
  | 'grinder'
  | 'drill_press'
  | 'inspection_table'
  | 'packing_table'
  | 'generic_machine'

// A machine looks like what its first process does; a process with another name gets a plain machine.
const MODELS: [RegExp, MachineModel][] = [
  [/切断|シャー|レーザ/, 'cutter'],
  [/曲げ|ベンド/, 'press_brake'],
  [/溶接/, 'welding_robot'],
  [/切削|マシニング|旋盤|フライス|タップ/, 'machining_center'],
  [/熱処理|焼入|焼鈍|炉/, 'furnace'],
  [/研削|研磨/, 'grinder'],
  [/穴あけ|ドリル|ボール盤/, 'drill_press'],
  [/検査|測定/, 'inspection_table'],
  [/梱包|包装/, 'packing_table'],
]

export function modelOf(equipment: Equipment): MachineModel {
  const process = equipment.processes[0] ?? ''
  return MODELS.find(([pattern]) => pattern.test(process))?.[1] ?? 'generic_machine'
}

// Meters. x runs along the flow from material on the left to finished goods on the right,
// z toward the viewer; each machine faces the viewer with its waiting lots in front of it.
export const CELL = 4.4
const ROW_DEPTH = 5.4
const STORE_WIDTH = 4.4

export type PlacedMachine = { equipment: Equipment; model: MachineModel; x: number; z: number }
export type Zone = { name: string; x0: number; x1: number; equipmentIds: string[] }
export type Store = { x: number; zs: number[] }

export type FactoryLayout = {
  zones: Zone[]
  machines: PlacedMachine[]
  // Where material and finished goods stand, one pallet per part along z.
  material: Store
  finished: Store
  width: number
  depth: number
}

// Crews in their order in the data, each an area of machines in two rows, then machines in
// no crew. Material stands to the left of the first area, finished goods to the right of the last.
export function factoryLayout(data: PlantData): FactoryLayout {
  const crews = crewOfEquipment(data)
  const groups = [
    ...data.crews.map((crew) => ({ name: crew.name, equipment: data.equipment.filter((item) => crews.get(item.id) === crew) })),
    { name: '', equipment: data.equipment.filter((item) => !crews.has(item.id)) },
  ].filter((group) => group.equipment.length > 0)

  const zones: Zone[] = []
  const machines: PlacedMachine[] = []
  let x = STORE_WIDTH
  for (const group of groups) {
    const columns = Math.ceil(group.equipment.length / 2)
    group.equipment.forEach((equipment, index) => {
      const column = index % columns
      const row = Math.floor(index / columns)
      machines.push({ equipment, model: modelOf(equipment), x: x + (column + 0.5) * CELL, z: row === 0 ? -ROW_DEPTH / 2 : ROW_DEPTH / 2 })
    })
    zones.push({ name: group.name, x0: x, x1: x + columns * CELL, equipmentIds: group.equipment.map((item) => item.id) })
    x += columns * CELL
  }
  const parts = data.parts.length
  const zs = Array.from({ length: parts }, (_, index) => (index - (parts - 1) / 2) * 1.8)
  return {
    zones,
    machines,
    material: { x: STORE_WIDTH / 2, zs },
    finished: { x: x + STORE_WIDTH / 2, zs },
    width: x + STORE_WIDTH,
    // Room in front of each row for the lot on the machine and the lots waiting for it, and
    // for the crews' names along the front.
    depth: Math.max(ROW_DEPTH * 2 + 3.6, parts * 1.8 + 1),
  }
}
