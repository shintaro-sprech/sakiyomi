import type { Equipment, IsoDate, Lot, Order, PlantData, Routes } from '../engine/types'

// Sheet and column names of the Excel workbook. People fill these in, so they are Japanese.
export const SHEETS = {
  routes: '工程表',
  equipment: '設備',
  orders: '注残',
  lots: 'Lot',
} as const

export const COLUMNS = {
  routes: { partNumber: '型番', order: '順番', step: '工程名', minutes: '1個あたりの分' },
  equipment: { id: '設備ID', name: '設備名', process: '担当工程', setup: '段取りの分' },
  orders: { id: '注番', partNumber: '型番', quantity: '数量', due: '納期', materialOn: '材料入荷日' },
  lots: { id: 'Lot番号', orderId: '注番', quantity: '数量', step: '今の工程番号', arrivedOn: 'その工程に着いた日' },
} as const

export const FINISHED = '完了'

export type Row = Record<string, unknown>
export type SheetRows = Record<string, Row[]>

export function toPlantRows(data: PlantData): SheetRows {
  const { routes, equipment, orders, lots } = COLUMNS
  return {
    [SHEETS.routes]: Object.entries(data.routes).flatMap(([partNumber, route]) =>
      route.map((step, index) => ({
        [routes.partNumber]: partNumber,
        [routes.order]: index + 1,
        [routes.step]: step.name,
        [routes.minutes]: step.minutesPerPiece,
      })),
    ),
    [SHEETS.equipment]: data.equipment.map((item) => ({
      [equipment.id]: item.id,
      [equipment.name]: item.name,
      [equipment.process]: item.process,
      [equipment.setup]: item.setupMinutes,
    })),
    [SHEETS.orders]: data.orders.map((order) => ({
      [orders.id]: order.id,
      [orders.partNumber]: order.partNumber,
      [orders.quantity]: order.quantity,
      [orders.due]: order.due,
      [orders.materialOn]: order.materialOn ?? '',
    })),
    [SHEETS.lots]: data.lots.map((lot) => ({
      [lots.id]: lot.id,
      [lots.orderId]: lot.orderId,
      [lots.quantity]: lot.quantity,
      [lots.step]: lot.stepIndex >= (data.routes[orderPart(data, lot)] ?? []).length ? FINISHED : lot.stepIndex + 1,
      [lots.arrivedOn]: lot.arrivedOn,
    })),
  }
}

function orderPart(data: PlantData, lot: Lot): string {
  return data.orders.find((order) => order.id === lot.orderId)?.partNumber ?? ''
}

// Reads the sheets back into plant data. Every problem is reported with its sheet and row,
// so a planner can fix the workbook in one pass.
export function parsePlantRows(sheets: SheetRows): { data: PlantData | null; errors: string[] } {
  const errors: string[] = []
  const rowsOf = (sheet: string) => {
    const rows = sheets[sheet]
    if (!rows) errors.push(`シート「${sheet}」がありません`)
    return rows ?? []
  }
  // Row 1 holds the headers, so the first data row is row 2.
  const at = (sheet: string, index: number) => `${sheet}の${index + 2}行目`

  const routeSteps = new Map<string, { order: number; name: string; minutesPerPiece: number }[]>()
  rowsOf(SHEETS.routes).forEach((row, index) => {
    const c = COLUMNS.routes
    const where = at(SHEETS.routes, index)
    const partNumber = text(row[c.partNumber])
    const name = text(row[c.step])
    const order = number(row[c.order])
    const minutes = number(row[c.minutes])
    if (!partNumber || !name) return errors.push(`${where}：型番と工程名を入れてください`)
    if (order === null || order < 1) return errors.push(`${where}：順番は1以上の数にしてください`)
    if (minutes === null || minutes <= 0) return errors.push(`${where}：1個あたりの分は正の数にしてください`)
    routeSteps.set(partNumber, [...(routeSteps.get(partNumber) ?? []), { order, name, minutesPerPiece: minutes }])
  })
  const routes: Routes = Object.fromEntries(
    [...routeSteps].map(([partNumber, steps]) => [
      partNumber,
      steps.sort((a, b) => a.order - b.order).map(({ name, minutesPerPiece }) => ({ name, minutesPerPiece })),
    ]),
  )

  const equipment: Equipment[] = []
  rowsOf(SHEETS.equipment).forEach((row, index) => {
    const c = COLUMNS.equipment
    const where = at(SHEETS.equipment, index)
    const id = text(row[c.id])
    const process = text(row[c.process])
    const setup = number(row[c.setup]) ?? 0
    if (!id || !process) return errors.push(`${where}：設備IDと担当工程を入れてください`)
    if (equipment.some((item) => item.id === id)) return errors.push(`${where}：設備ID「${id}」が重複しています`)
    equipment.push({ id, name: text(row[c.name]) || id, process, setupMinutes: Math.max(0, setup) })
  })

  const orders: Order[] = []
  rowsOf(SHEETS.orders).forEach((row, index) => {
    const c = COLUMNS.orders
    const where = at(SHEETS.orders, index)
    const id = text(row[c.id])
    const partNumber = text(row[c.partNumber])
    const quantity = number(row[c.quantity])
    const due = date(row[c.due])
    const materialOn = date(row[c.materialOn])
    if (!id) return errors.push(`${where}：注番を入れてください`)
    if (orders.some((order) => order.id === id)) return errors.push(`${where}：注番「${id}」が重複しています`)
    if (!routes[partNumber]) return errors.push(`${where}：型番「${partNumber}」が工程表にありません`)
    if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) {
      return errors.push(`${where}：数量は正の整数にしてください`)
    }
    if (!due) return errors.push(`${where}：納期を日付で入れてください`)
    orders.push({ id, partNumber, quantity, due, ...(materialOn ? { materialOn } : {}) })
  })

  const lots: Lot[] = []
  rowsOf(SHEETS.lots).forEach((row, index) => {
    const c = COLUMNS.lots
    const where = at(SHEETS.lots, index)
    const id = text(row[c.id])
    const order = orders.find((candidate) => candidate.id === text(row[c.orderId]))
    const quantity = number(row[c.quantity])
    const arrivedOn = date(row[c.arrivedOn])
    if (!id) return errors.push(`${where}：Lot番号を入れてください`)
    if (!order) return errors.push(`${where}：注番「${text(row[c.orderId])}」が注残にありません`)
    if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) {
      return errors.push(`${where}：数量は正の整数にしてください`)
    }
    const route = routes[order.partNumber]
    const stepCell = text(row[c.step])
    const stepNumber = stepCell === FINISHED ? route.length + 1 : number(row[c.step])
    if (stepNumber === null || !Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > route.length + 1) {
      return errors.push(`${where}：今の工程番号は1〜${route.length}か「${FINISHED}」にしてください`)
    }
    if (!arrivedOn) return errors.push(`${where}：その工程に着いた日を日付で入れてください`)
    lots.push({ id, orderId: order.id, quantity, stepIndex: stepNumber - 1, arrivedOn })
  })

  for (const order of orders) {
    const released = lots.filter((lot) => lot.orderId === order.id).reduce((total, lot) => total + lot.quantity, 0)
    if (released > order.quantity) {
      errors.push(`注番「${order.id}」は、Lotの数量の合計（${released}）が注残の数量（${order.quantity}）を超えています`)
    }
  }

  return errors.length > 0 ? { data: null, errors } : { data: { routes, equipment, orders, lots }, errors }
}

function text(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function number(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

// Accepts Date cells and text like 2026-11-12 or 2026/11/12.
function date(value: unknown): IsoDate | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text(value))
  if (!match) return null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}
