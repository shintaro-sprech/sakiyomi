import { addDays } from './dates'
import type { Crew, Equipment, IsoDate, Order, PlantData, Settings } from './types'

// A what-if change. Claude's tools, the option cards and the decision log
// all speak in these.
export type Change =
  | { kind: 'materialDelay'; orderId: string; days: number }
  // Material ordered for an order that had none coming, arriving on the day given. The
  // planner records it from the screen; Claude does not propose it.
  | { kind: 'materialOrdered'; orderId: string; arrives: IsoDate }
  | { kind: 'quantity'; orderId: string; quantity: number }
  | { kind: 'equipmentDown'; equipmentId: string; from: IsoDate; to: IsoDate }
  | { kind: 'overtime'; equipmentId: string; from: IsoDate; to: IsoDate; minutesPerDay: number }
  | { kind: 'holidayWork'; equipmentId: string; date: IsoDate }
  | { kind: 'expedite'; orderId: string }
  | { kind: 'hold'; orderId: string; until: IsoDate }
  // orderId is the number the order got when the planner adopted it, so later changes that
  // name it still find it after an earlier decision is undone. Without it the order takes
  // the next free 追加 number.
  | { kind: 'addOrder'; partNumber: string; quantity: number; due: IsoDate; orderId?: string }
  | { kind: 'headcount'; crew: string; from: IsoDate; to: IsoDate; people: number }

export type Downtime = { equipmentId: string; from: IsoDate; to: IsoDate }
export type Overtime = { equipmentId: string; from: IsoDate; to: IsoDate; minutesPerDay: number }
export type HolidayWork = { equipmentId: string; date: IsoDate }
export type Hold = { orderId: string; until: IsoDate }
// People of a crew on the working days of a period: help from elsewhere, or someone off.
export type Headcount = { crew: string; from: IsoDate; to: IsoDate; people: number }

export type Scenario = {
  data: PlantData
  settings: Settings
  downtime: Downtime[]
  overtime: Overtime[]
  holidayWork: HolidayWork[]
  expedited: string[]
  // Orders that must not start before a day.
  holds: Hold[]
  // Later entries win where periods overlap.
  headcount: Headcount[]
}

// Raised when a change cannot apply. The message is shown to people and Claude.
export class ChangeError extends Error {}

// With skipped given, a change that cannot apply is left out and listed there instead of
// stopping the whole plan.
export function buildScenario(
  data: PlantData,
  settings: Settings,
  changes: Change[],
  today: IsoDate,
  skipped?: Change[],
): Scenario {
  const scenario: Scenario = {
    data: structuredClone(data),
    settings: structuredClone(settings),
    downtime: [],
    overtime: [],
    holidayWork: [],
    expedited: [],
    holds: [],
    headcount: [],
  }
  for (const change of changes) {
    try {
      applyChange(scenario, change, today)
    } catch (error) {
      if (!skipped || !(error instanceof ChangeError)) throw error
      skipped.push(change)
    }
  }
  return scenario
}

// Applies more changes to a scenario, stopping at the first that cannot apply.
export function applyChanges(scenario: Scenario, changes: Change[], today: IsoDate): void {
  for (const change of changes) applyChange(scenario, change, today)
}

// The changes of a decision about to be adopted, each added order given the number it gets
// after the decisions already adopted.
export function pinAddedOrders(
  data: PlantData,
  settings: Settings,
  adopted: Change[],
  changes: Change[],
  today: IsoDate,
): Change[] {
  const scenario = buildScenario(data, settings, adopted, today, [])
  return changes.map((change) => {
    const pinned = change.kind === 'addOrder' && !change.orderId ? { ...change, orderId: nextAddedOrderId(scenario.data) } : change
    try {
      applyChange(scenario, pinned, today)
    } catch (error) {
      if (!(error instanceof ChangeError)) throw error
    }
    return pinned
  })
}

function applyChange(scenario: Scenario, change: Change, today: IsoDate): void {
  switch (change.kind) {
    case 'materialDelay': {
      const order = findOrder(scenario.data, change.orderId)
      order.materialOn = addDays(order.materialOn ?? today, change.days)
      return
    }
    case 'materialOrdered': {
      findOrder(scenario.data, change.orderId).materialOn = change.arrives
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
    case 'hold': {
      findOrder(scenario.data, change.orderId)
      scenario.holds.push({ orderId: change.orderId, until: change.until })
      return
    }
    case 'addOrder': {
      if (!scenario.data.routes[change.partNumber]) {
        throw new ChangeError(`型番${change.partNumber}の工程表がありません`)
      }
      if (!Number.isInteger(change.quantity) || change.quantity <= 0) {
        throw new ChangeError('追加する数量は正の整数にしてください')
      }
      if (change.orderId && scenario.data.orders.some((order) => order.id === change.orderId)) {
        throw new ChangeError(`注番${change.orderId}はもうあります`)
      }
      scenario.data.orders.push({
        id: change.orderId ?? nextAddedOrderId(scenario.data),
        partNumber: change.partNumber,
        quantity: change.quantity,
        due: change.due,
      })
      return
    }
    case 'headcount': {
      findCrew(scenario.data, change.crew)
      if (!Number.isInteger(change.people) || change.people < 0 || change.to < change.from) {
        throw new ChangeError('人数は0以上の整数にし、期間の始まりと終わりを正しく指定してください')
      }
      scenario.headcount.push({ crew: change.crew, from: change.from, to: change.to, people: change.people })
      return
    }
  }
}

// Added orders are numbered in the order they are applied, so the same changes give the same ids.
const ADDED_ORDER_PREFIX = '追加'

function nextAddedOrderId(data: PlantData): string {
  let number = 1
  while (data.orders.some((order) => order.id === `${ADDED_ORDER_PREFIX}${number}`)) number += 1
  return `${ADDED_ORDER_PREFIX}${number}`
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
    case 'materialOrdered':
      return { kind: 'materialOrdered', orderId: text('orderId'), arrives: date('arrives') }
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
    case 'hold':
      return { kind: 'hold', orderId: text('orderId'), until: date('until') }
    case 'addOrder':
      return { kind: 'addOrder', partNumber: text('partNumber'), quantity: integer('quantity'), due: date('due') }
    case 'headcount':
      return { kind: 'headcount', crew: text('crew'), from: date('from'), to: date('to'), people: integer('people') }
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
    case 'materialOrdered':
      return `注番${change.orderId}の材料を発注（${Number(change.arrives.slice(5, 7))}/${Number(change.arrives.slice(8, 10))}着）`
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
    case 'hold':
      return `注番${change.orderId}を${formatRange(change.until, change.until).replace(/に$/, '')}まで着手しない`
    case 'addOrder':
      return `${change.partNumber}を${change.quantity}個、${formatRange(change.due, change.due).replace(/に$/, '')}納期で追加する`
    case 'headcount':
      return `${change.crew}を${formatRange(change.from, change.to).replace(/に$/, '')}は${change.people}人にする`
  }
}

// Changes come from parseChange, so equal changes serialize the same way.
// The same change, whether or not an added order has had its number pinned.
export function sameChange(a: Change, b: Change): boolean {
  const plain = (change: Change) => (change.kind === 'addOrder' ? { ...change, orderId: undefined } : change)
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b))
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

function findCrew(data: PlantData, name: string): Crew {
  const crew = data.crews.find((candidate) => candidate.name === name)
  if (!crew) throw new ChangeError(`班「${name}」は見つかりません`)
  return crew
}

function findEquipment(data: PlantData, id: string): Equipment {
  const equipment = data.equipment.find((candidate) => candidate.id === id)
  if (!equipment) throw new ChangeError(`設備${id}は見つかりません`)
  return equipment
}
