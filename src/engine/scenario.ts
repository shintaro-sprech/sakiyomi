import { addDays } from './dates'
import type { Equipment, IsoDate, Order, PlantData, Settings } from './types'

// A what-if change. Claude's tools, the option cards and the decision log
// all speak in these.
export type Change =
  | { kind: 'materialDelay'; orderId: string; days: number }
  | { kind: 'quantity'; orderId: string; quantity: number }
  | { kind: 'equipmentDown'; equipmentId: string; from: IsoDate; to: IsoDate }
  | { kind: 'overtime'; equipmentId: string; from: IsoDate; to: IsoDate; minutesPerDay: number }
  | { kind: 'holidayWork'; equipmentId: string; date: IsoDate }
  | { kind: 'expedite'; orderId: string }

export type Downtime = { equipmentId: string; from: IsoDate; to: IsoDate }
export type Overtime = { equipmentId: string; from: IsoDate; to: IsoDate; minutesPerDay: number }
export type HolidayWork = { equipmentId: string; date: IsoDate }

export type Scenario = {
  data: PlantData
  settings: Settings
  downtime: Downtime[]
  overtime: Overtime[]
  holidayWork: HolidayWork[]
  expedited: string[]
}

// Raised when a change cannot apply. The message is shown to people and Claude.
export class ChangeError extends Error {}

export function buildScenario(data: PlantData, settings: Settings, changes: Change[], today: IsoDate): Scenario {
  const scenario: Scenario = {
    data: structuredClone(data),
    settings: structuredClone(settings),
    downtime: [],
    overtime: [],
    holidayWork: [],
    expedited: [],
  }
  for (const change of changes) {
    applyChange(scenario, change, today)
  }
  return scenario
}

function applyChange(scenario: Scenario, change: Change, today: IsoDate): void {
  switch (change.kind) {
    case 'materialDelay': {
      const order = findOrder(scenario.data, change.orderId)
      order.materialOn = addDays(order.materialOn ?? today, change.days)
      return
    }
    case 'quantity': {
      const order = findOrder(scenario.data, change.orderId)
      const released = scenario.data.lots
        .filter((lot) => lot.orderId === order.id)
        .reduce((total, lot) => total + lot.quantity, 0)
      if (!Number.isInteger(change.quantity) || change.quantity < released) {
        throw new ChangeError(
          `注番${order.id}はすでに${released}個を投入済みなので、数量を${change.quantity}個にはできません`,
        )
      }
      order.quantity = change.quantity
      return
    }
    case 'equipmentDown': {
      findEquipment(scenario.data, change.equipmentId)
      if (change.to < change.from) {
        throw new ChangeError(`設備の停止期間の終わり（${change.to}）が始まり（${change.from}）より前です`)
      }
      scenario.downtime.push({ equipmentId: change.equipmentId, from: change.from, to: change.to })
      return
    }
    case 'overtime': {
      findEquipment(scenario.data, change.equipmentId)
      if (change.minutesPerDay <= 0 || change.to < change.from) {
        throw new ChangeError('残業は、1日あたりの分数を正の数にし、期間の始まりと終わりを正しく指定してください')
      }
      scenario.overtime.push({ ...change })
      return
    }
    case 'holidayWork': {
      findEquipment(scenario.data, change.equipmentId)
      scenario.holidayWork.push({ equipmentId: change.equipmentId, date: change.date })
      return
    }
    case 'expedite': {
      findOrder(scenario.data, change.orderId)
      if (!scenario.expedited.includes(change.orderId)) {
        scenario.expedited.push(change.orderId)
      }
      return
    }
  }
}

// Turns untrusted input (a tool call from Claude, a saved file) into a Change.
export function parseChange(input: unknown): Change {
  if (typeof input !== 'object' || input === null) throw new ChangeError('変更の形式が正しくありません')
  const value = input as Record<string, unknown>
  const text = (key: string) => {
    if (typeof value[key] !== 'string' || value[key] === '') throw new ChangeError(`${key} を文字で指定してください`)
    return value[key] as string
  }
  const integer = (key: string) => {
    if (!Number.isInteger(value[key])) throw new ChangeError(`${key} を整数で指定してください`)
    return value[key] as number
  }
  const date = (key: string) => {
    const result = text(key)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new ChangeError(`${key} は YYYY-MM-DD で指定してください`)
    return result
  }

  switch (value.kind) {
    case 'materialDelay':
      return { kind: 'materialDelay', orderId: text('orderId'), days: integer('days') }
    case 'quantity':
      return { kind: 'quantity', orderId: text('orderId'), quantity: integer('quantity') }
    case 'equipmentDown':
      return { kind: 'equipmentDown', equipmentId: text('equipmentId'), from: date('from'), to: date('to') }
    case 'overtime':
      return {
        kind: 'overtime',
        equipmentId: text('equipmentId'),
        from: date('from'),
        to: date('to'),
        minutesPerDay: integer('minutesPerDay'),
      }
    case 'holidayWork':
      return { kind: 'holidayWork', equipmentId: text('equipmentId'), date: date('date') }
    case 'expedite':
      return { kind: 'expedite', orderId: text('orderId') }
    default:
      throw new ChangeError(`変更の種類「${String(value.kind)}」には対応していません`)
  }
}

export function describeChange(change: Change, data: PlantData): string {
  switch (change.kind) {
    case 'materialDelay':
      return change.days >= 0
        ? `注番${change.orderId}の材料が${change.days}日遅れる`
        : `注番${change.orderId}の材料が${-change.days}日早く届く`
    case 'quantity':
      return `注番${change.orderId}の数量を${change.quantity}個にする`
    case 'equipmentDown':
      return `${equipmentName(data, change.equipmentId)}を${formatRange(change.from, change.to)}止める`
    case 'overtime':
      return `${equipmentName(data, change.equipmentId)}で${formatRange(change.from, change.to)}、1日${change.minutesPerDay}分残業する`
    case 'holidayWork':
      return `${equipmentName(data, change.equipmentId)}を${formatRange(change.date, change.date)}休日出勤で動かす`
    case 'expedite':
      return `注番${change.orderId}を最優先にする`
  }
}

// Changes come from parseChange, so equal changes serialize the same way.
export function sameChange(a: Change, b: Change): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function formatRange(from: IsoDate, to: IsoDate): string {
  const short = (date: IsoDate) => {
    const [, month, day] = date.split('-')
    return `${Number(month)}/${Number(day)}`
  }
  return from === to ? `${short(from)}に` : `${short(from)}〜${short(to)}に`
}

function equipmentName(data: PlantData, id: string): string {
  return data.equipment.find((equipment) => equipment.id === id)?.name ?? id
}

function findOrder(data: PlantData, id: string): Order {
  const order = data.orders.find((candidate) => candidate.id === id)
  if (!order) throw new ChangeError(`注番${id}は見つかりません`)
  return order
}

function findEquipment(data: PlantData, id: string): Equipment {
  const equipment = data.equipment.find((candidate) => candidate.id === id)
  if (!equipment) throw new ChangeError(`設備${id}は見つかりません`)
  return equipment
}
