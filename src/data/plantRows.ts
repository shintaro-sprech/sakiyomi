import type {
  Actual,
  Attendance,
  ChannelStock,
  Crew,
  CustomerOrder,
  Equipment,
  IsoDate,
  Lot,
  Order,
  Part,
  PlantData,
  Routes,
  SetupRule,
} from '../engine/types'

// Sheet and column names of the Excel workbook. People fill these in, so they are Japanese.
export const SHEETS = {
  parts: '品目',
  routes: '工程表',
  equipment: '設備',
  setupRules: '段取り',
  crews: '班',
  attendance: '出勤',
  orders: '注残',
  lots: 'Lot',
  actuals: '実績',
  customerOrders: '受注',
  channelStocks: '販売在庫',
} as const

export const COLUMNS = {
  parts: {
    partNumber: '型番',
    shape: '形状',
    price: '売価',
    materialCost: '材料費',
    stock: '在庫',
    monthlyUsage: '月間の出荷数',
    materialStock: '材料在庫',
    materialLeadDays: '材料の調達日数',
  },
  routes: { partNumber: '型番', order: '順番', step: '工程名', minutes: '1個あたりの分' },
  equipment: {
    id: '設備ID',
    name: '設備名',
    processes: '担当工程',
    speed: '速さ',
    setup: '段取りの分',
    hourlyCost: '1時間の運転費',
    lastPart: '直前の型番',
  },
  setupRules: { process: '工程名', fromShape: '前の形状', toShape: '次の形状', minutes: '段取りの分' },
  crews: { name: '班名', processes: '担当工程', people: '人数' },
  attendance: { crew: '班名', date: '日付', people: '人数' },
  orders: { id: '注番', partNumber: '型番', quantity: '数量', due: '納期', materialOn: '材料入荷日' },
  lots: { id: 'Lot番号', orderId: '注番', quantity: '数量', step: '今の工程番号', arrivedOn: 'その工程に着いた日' },
  actuals: {
    lotId: 'Lot番号',
    step: '工程番号',
    equipmentId: '設備ID',
    start: '開始',
    end: '終了',
    good: '良品数',
    defect: '不良数',
  },
  customerOrders: {
    id: '受注番号',
    orderId: '注番',
    customer: '取引先',
    channel: '販路',
    quantity: '数量',
    requested: '希望納期',
    answered: '回答納期',
  },
  channelStocks: {
    customer: '取引先',
    partNumber: '型番',
    asOf: '基準日',
    stock: '在庫',
    monthlySales: '月間の実売',
    reorderDays: '注文の目安の日数',
  },
} as const

// How a customer order is sold, as written in the 販路 column.
const CHANNELS = { direct: '直販', distributor: '代理店' } as const

export const FINISHED = '完了'

// The earlier name of the equipment's running cost column.
const PREVIOUS_HOURLY_COST = '1時間の費用'

// A crew's processes share one cell, written 切断、曲げ、溶接, and so do those of a
// multi-tasking machine.
const PROCESS_SEPARATOR = '、'

export type Row = Record<string, unknown>
export type SheetRows = Record<string, Row[]>

export function toPlantRows(data: PlantData): SheetRows {
  const { parts, routes, equipment, setupRules, crews, attendance, orders, lots, actuals, customerOrders, channelStocks } =
    COLUMNS
  return {
    [SHEETS.parts]: data.parts.map((part) => ({
      [parts.partNumber]: part.partNumber,
      [parts.shape]: part.shape,
      [parts.price]: part.price,
      [parts.materialCost]: part.materialCost,
      [parts.stock]: part.stock,
      [parts.monthlyUsage]: part.monthlyUsage,
      [parts.materialStock]: part.materialStock ?? '',
      [parts.materialLeadDays]: part.materialLeadDays ?? '',
    })),
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
      [equipment.processes]: item.processes.join(PROCESS_SEPARATOR),
      [equipment.speed]: item.speed ?? 1,
      [equipment.setup]: item.setupMinutes,
      [equipment.hourlyCost]: item.hourlyCost,
      [equipment.lastPart]: item.lastPart ?? '',
    })),
    [SHEETS.setupRules]: data.setupRules.map((rule) => ({
      [setupRules.process]: rule.process,
      [setupRules.fromShape]: rule.fromShape,
      [setupRules.toShape]: rule.toShape,
      [setupRules.minutes]: rule.minutes,
    })),
    [SHEETS.crews]: data.crews.map((crew) => ({
      [crews.name]: crew.name,
      [crews.processes]: crew.processes.join(PROCESS_SEPARATOR),
      [crews.people]: crew.people,
    })),
    [SHEETS.attendance]: data.attendance.map((entry) => ({
      [attendance.crew]: entry.crew,
      [attendance.date]: entry.date,
      [attendance.people]: entry.people,
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
    [SHEETS.actuals]: (data.actuals ?? []).map((actual) => ({
      [actuals.lotId]: actual.lotId,
      [actuals.step]: actual.stepIndex + 1,
      [actuals.equipmentId]: actual.equipmentId,
      [actuals.start]: actual.start.replace('T', ' '),
      [actuals.end]: actual.end.replace('T', ' '),
      [actuals.good]: actual.good,
      [actuals.defect]: actual.defect,
    })),
    [SHEETS.customerOrders]: (data.customerOrders ?? []).map((entry) => ({
      [customerOrders.id]: entry.id,
      [customerOrders.orderId]: entry.orderId,
      [customerOrders.customer]: entry.customer,
      [customerOrders.channel]: CHANNELS[entry.channel ?? 'direct'],
      [customerOrders.quantity]: entry.quantity,
      [customerOrders.requested]: entry.requested,
      [customerOrders.answered]: entry.answered ?? '',
    })),
    [SHEETS.channelStocks]: (data.channelStocks ?? []).map((entry) => ({
      [channelStocks.customer]: entry.customer,
      [channelStocks.partNumber]: entry.partNumber,
      [channelStocks.asOf]: entry.asOf,
      [channelStocks.stock]: entry.stock,
      [channelStocks.monthlySales]: entry.monthlySales,
      [channelStocks.reorderDays]: entry.reorderDays ?? '',
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
  // Crews and attendance were added later; a workbook without them plans without people limits.
  const optionalRowsOf = (sheet: string) => sheets[sheet] ?? []
  // Row 1 holds the headers, so the first data row is row 2.
  const at = (sheet: string, index: number) => `${sheet}の${index + 2}行目`

  const parts: Part[] = []
  rowsOf(SHEETS.parts).forEach((row, index) => {
    const c = COLUMNS.parts
    const where = at(SHEETS.parts, index)
    const partNumber = text(row[c.partNumber])
    const values = [c.price, c.materialCost, c.stock, c.monthlyUsage].map((column) => number(row[column]))
    if (!partNumber || !text(row[c.shape])) return errors.push(`${where}：型番と形状を入れてください`)
    if (parts.some((part) => part.partNumber === partNumber)) return errors.push(`${where}：型番「${partNumber}」が重複しています`)
    if (values.some((value) => value === null || value < 0)) {
      return errors.push(`${where}：売価・材料費・在庫・月間の出荷数は0以上の数にしてください`)
    }
    const [price, materialCost, stock, monthlyUsage] = values as number[]
    // Left empty when the plant does not track material.
    const materialCell = text(row[c.materialStock])
    const materialStock = materialCell === '' ? null : number(row[c.materialStock])
    if (materialCell !== '' && (materialStock === null || materialStock < 0 || !Number.isInteger(materialStock))) {
      return errors.push(`${where}：材料在庫は0以上の整数にしてください`)
    }
    const leadCell = text(row[c.materialLeadDays])
    const materialLeadDays = leadCell === '' ? null : number(row[c.materialLeadDays])
    if (leadCell !== '' && (materialLeadDays === null || materialLeadDays < 0 || !Number.isInteger(materialLeadDays))) {
      return errors.push(`${where}：材料の調達日数は0以上の整数にしてください`)
    }
    parts.push({
      partNumber,
      shape: text(row[c.shape]),
      price,
      materialCost,
      stock,
      monthlyUsage,
      ...(materialStock !== null ? { materialStock } : {}),
      ...(materialLeadDays !== null ? { materialLeadDays } : {}),
    })
  })

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
  // The row each machine came from, for problems found once the crews are read.
  const equipmentRow = new Map<string, string>()
  rowsOf(SHEETS.equipment).forEach((row, index) => {
    const c = COLUMNS.equipment
    const where = at(SHEETS.equipment, index)
    const id = text(row[c.id])
    const processes = [...new Set(processList(row[c.processes]))]
    const setup = number(row[c.setup]) ?? 0
    const hourlyCost = number(row[c.hourlyCost] ?? row[PREVIOUS_HOURLY_COST]) ?? 0
    const lastPart = text(row[c.lastPart])
    // Left empty in workbooks made before machines had a speed.
    const speed = text(row[c.speed]) === '' ? 1 : number(row[c.speed])
    if (!id || processes.length === 0) return errors.push(`${where}：設備IDと担当工程を入れてください`)
    if (equipment.some((item) => item.id === id)) return errors.push(`${where}：設備ID「${id}」が重複しています`)
    if (speed === null || speed < 0.1 || speed > 10) {
      return errors.push(`${where}：速さは、工程表のとおりを1として、0.1以上10以下の数にしてください（2割速いなら1.2）`)
    }
    if (lastPart && !routes[lastPart]) return errors.push(`${where}：直前の型番「${lastPart}」が工程表にありません`)
    if (lastPart && !routes[lastPart].some((step) => processes.includes(step.name))) {
      return errors.push(`${where}：直前の型番「${lastPart}」の工程表に「${processes.join(PROCESS_SEPARATOR)}」がありません`)
    }
    equipmentRow.set(id, where)
    equipment.push({
      id,
      name: text(row[c.name]) || id,
      processes,
      ...(speed !== 1 ? { speed } : {}),
      setupMinutes: Math.max(0, setup),
      hourlyCost: Math.max(0, hourlyCost),
      ...(lastPart ? { lastPart } : {}),
    })
  })

  const setupRules: SetupRule[] = []
  rowsOf(SHEETS.setupRules).forEach((row, index) => {
    const c = COLUMNS.setupRules
    const where = at(SHEETS.setupRules, index)
    const minutes = number(row[c.minutes])
    const rule = { process: text(row[c.process]), fromShape: text(row[c.fromShape]), toShape: text(row[c.toShape]) }
    if (!rule.process || !rule.fromShape || !rule.toShape) {
      return errors.push(`${where}：工程名と前後の形状を入れてください`)
    }
    if (minutes === null || minutes < 0) return errors.push(`${where}：段取りの分は0以上の数にしてください`)
    setupRules.push({ ...rule, minutes })
  })

  const crews: Crew[] = []
  optionalRowsOf(SHEETS.crews).forEach((row, index) => {
    const c = COLUMNS.crews
    const where = at(SHEETS.crews, index)
    const name = text(row[c.name])
    const processes = processList(row[c.processes])
    const people = number(row[c.people])
    if (!name || processes.length === 0) return errors.push(`${where}：班名と担当工程を入れてください`)
    if (crews.some((crew) => crew.name === name)) return errors.push(`${where}：班名「${name}」が重複しています`)
    if (people === null || !Number.isInteger(people) || people < 0) return errors.push(`${where}：人数は0以上の整数にしてください`)
    for (const process of processes) {
      const other = crews.find((crew) => crew.processes.includes(process))
      if (other) return errors.push(`${where}：工程「${process}」は班「${other.name}」にもあります`)
      if (!equipment.some((item) => item.processes.includes(process))) {
        return errors.push(`${where}：工程「${process}」を担当する設備がありません`)
      }
    }
    crews.push({ name, processes, people })
  })
  // One person runs a machine, so all of a machine's processes belong to one crew.
  for (const item of equipment) {
    const owners = crews.filter((crew) => item.processes.some((process) => crew.processes.includes(process)))
    if (owners.length > 1) {
      errors.push(
        `${equipmentRow.get(item.id)}：担当工程が、班「${owners.map((crew) => crew.name).join('」と「')}」に分かれています。1台の設備の工程は、同じ班に入れてください`,
      )
    }
  }

  const attendance: Attendance[] = []
  optionalRowsOf(SHEETS.attendance).forEach((row, index) => {
    const c = COLUMNS.attendance
    const where = at(SHEETS.attendance, index)
    const crew = text(row[c.crew])
    const day = date(row[c.date])
    const people = number(row[c.people])
    if (!crews.some((candidate) => candidate.name === crew)) return errors.push(`${where}：班「${crew}」が班のシートにありません`)
    if (!day) return errors.push(`${where}：日付を入れてください`)
    if (attendance.some((entry) => entry.crew === crew && entry.date === day)) {
      return errors.push(`${where}：班「${crew}」の${day}が重複しています`)
    }
    if (people === null || !Number.isInteger(people) || people < 0) return errors.push(`${where}：人数は0以上の整数にしてください`)
    attendance.push({ crew, date: day, people })
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

  // Records of the steps lots have been through, and the customer orders behind the open
  // orders, came later and are shown only; a workbook without them plans the same.
  const actuals: Actual[] = []
  optionalRowsOf(SHEETS.actuals).forEach((row, index) => {
    const c = COLUMNS.actuals
    const where = at(SHEETS.actuals, index)
    const lot = lots.find((candidate) => candidate.id === text(row[c.lotId]))
    if (!lot) return errors.push(`${where}：Lot番号「${text(row[c.lotId])}」がLotのシートにありません`)
    const route = routes[orders.find((order) => order.id === lot.orderId)?.partNumber ?? ''] ?? []
    const stepNumber = number(row[c.step])
    if (lot.stepIndex === 0) return errors.push(`${where}：Lot「${lot.id}」はまだ通り終えた工程がありません`)
    if (stepNumber === null || !Number.isInteger(stepNumber) || stepNumber < 1 || stepNumber > lot.stepIndex) {
      return errors.push(`${where}：工程番号は、そのLotが通り終えた1〜${lot.stepIndex}にしてください`)
    }
    if (actuals.some((actual) => actual.lotId === lot.id && actual.stepIndex === stepNumber - 1)) {
      return errors.push(`${where}：Lot「${lot.id}」の工程${stepNumber}が重複しています`)
    }
    const machine = equipment.find((candidate) => candidate.id === text(row[c.equipmentId]))
    if (!machine || !machine.processes.includes(route[stepNumber - 1]?.name)) {
      return errors.push(`${where}：設備ID「${text(row[c.equipmentId])}」は工程「${route[stepNumber - 1]?.name}」の設備ではありません`)
    }
    const start = dateTime(row[c.start])
    const end = dateTime(row[c.end])
    if (!start || !end || end < start) return errors.push(`${where}：開始と終了を日時（2026-11-02 09:00 の形）で入れてください`)
    const good = number(row[c.good])
    const defect = text(row[c.defect]) === '' ? 0 : number(row[c.defect])
    if (good === null || defect === null || !Number.isInteger(good) || !Number.isInteger(defect) || good < 0 || defect < 0) {
      return errors.push(`${where}：良品数と不良数は0以上の整数にしてください`)
    }
    actuals.push({ lotId: lot.id, stepIndex: stepNumber - 1, equipmentId: machine.id, start, end, good, defect })
  })

  const customerOrders: CustomerOrder[] = []
  optionalRowsOf(SHEETS.customerOrders).forEach((row, index) => {
    const c = COLUMNS.customerOrders
    const where = at(SHEETS.customerOrders, index)
    const id = text(row[c.id])
    const order = orders.find((candidate) => candidate.id === text(row[c.orderId]))
    const quantity = number(row[c.quantity])
    const requested = date(row[c.requested])
    const answered = text(row[c.answered]) === '' ? null : date(row[c.answered])
    const channelCell = text(row[c.channel])
    const channel = (Object.keys(CHANNELS) as (keyof typeof CHANNELS)[]).find((key) => CHANNELS[key] === channelCell)
    if (!id) return errors.push(`${where}：受注番号を入れてください`)
    if (customerOrders.some((entry) => entry.id === id)) return errors.push(`${where}：受注番号「${id}」が重複しています`)
    if (!order) return errors.push(`${where}：注番「${text(row[c.orderId])}」が注残にありません`)
    if (quantity === null || !Number.isInteger(quantity) || quantity <= 0) return errors.push(`${where}：数量は正の整数にしてください`)
    if (!requested) return errors.push(`${where}：希望納期を日付で入れてください`)
    if (answered === null && text(row[c.answered]) !== '') return errors.push(`${where}：回答納期は日付か空欄にしてください`)
    if (channelCell !== '' && !channel) return errors.push(`${where}：販路は「直販」か「代理店」か空欄にしてください`)
    customerOrders.push({
      id,
      orderId: order.id,
      customer: text(row[c.customer]),
      ...(channel === 'distributor' ? { channel } : {}),
      quantity,
      requested,
      answered,
    })
  })

  // What distributors report holding and selling on; shown only, like the records above.
  const channelStocks: ChannelStock[] = []
  optionalRowsOf(SHEETS.channelStocks).forEach((row, index) => {
    const c = COLUMNS.channelStocks
    const where = at(SHEETS.channelStocks, index)
    const customer = text(row[c.customer])
    const partNumber = text(row[c.partNumber])
    const asOf = date(row[c.asOf])
    const stock = number(row[c.stock])
    const monthlySales = number(row[c.monthlySales])
    const reorderCell = text(row[c.reorderDays])
    const reorderDays = reorderCell === '' ? null : number(row[c.reorderDays])
    if (!customer) return errors.push(`${where}：取引先を入れてください`)
    if (!parts.some((part) => part.partNumber === partNumber)) return errors.push(`${where}：型番「${partNumber}」が品目にありません`)
    if (channelStocks.some((entry) => entry.customer === customer && entry.partNumber === partNumber)) {
      return errors.push(`${where}：取引先「${customer}」の型番「${partNumber}」が重複しています`)
    }
    if (!asOf) return errors.push(`${where}：基準日を日付で入れてください`)
    if (stock === null || !Number.isInteger(stock) || stock < 0) return errors.push(`${where}：在庫は0以上の整数にしてください`)
    if (monthlySales === null || monthlySales < 0) return errors.push(`${where}：月間の実売は0以上の数にしてください`)
    if (reorderCell !== '' && (reorderDays === null || !Number.isInteger(reorderDays) || reorderDays < 0)) {
      return errors.push(`${where}：注文の目安の日数は0以上の整数か空欄にしてください`)
    }
    channelStocks.push({
      customer,
      partNumber,
      asOf,
      stock,
      monthlySales,
      ...(reorderDays !== null ? { reorderDays } : {}),
    })
  })

  for (const order of orders) {
    const released = lots.filter((lot) => lot.orderId === order.id).reduce((total, lot) => total + lot.quantity, 0)
    if (released > order.quantity) {
      errors.push(`注番「${order.id}」は、Lotの数量の合計（${released}）が注残の数量（${order.quantity}）を超えています`)
    }
  }

  for (const partNumber of Object.keys(routes)) {
    if (!parts.some((part) => part.partNumber === partNumber)) {
      errors.push(`工程表の型番「${partNumber}」が品目にありません`)
    }
  }

  return errors.length > 0
    ? { data: null, errors }
    : {
        data: { parts, routes, equipment, setupRules, crews, attendance, orders, lots, actuals, customerOrders, channelStocks },
        errors,
      }
}

// Processes written in one cell, as 切断、曲げ or 切断,曲げ.
function processList(value: unknown): string[] {
  return text(value)
    .split(/[、,，・\s]+/)
    .filter((process) => process !== '')
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

// Accepts Date cells with a time and text like 2026-11-12 09:30 or 2026/11/12T09:30,
// written back as 2026-11-12T09:30.
function dateTime(value: unknown): string | null {
  const pad = (part: number) => String(part).padStart(2, '0')
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    // Excel keeps times as fractions of a day, which can land a hair before the minute.
    const minute = new Date(Math.round(value.getTime() / 60_000) * 60_000)
    return `${date(minute)}T${pad(minute.getHours())}:${pad(minute.getMinutes())}`
  }
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::\d{2})?$/.exec(text(value))
  if (!match) return null
  const day = date(`${match[1]}-${match[2]}-${match[3]}`)
  const [hours, minutes] = [Number(match[4]), Number(match[5])]
  if (!day || hours > 23 || minutes > 59) return null
  return `${day}T${pad(hours)}:${pad(minutes)}`
}

// Accepts Date cells and text like 2026-11-12 or 2026/11/12.
function date(value: unknown): IsoDate | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text(value))
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  // A day that does not exist, such as 2026-02-30, is refused rather than rolled over.
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}
