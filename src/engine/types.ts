// Dates are calendar days in ISO form (YYYY-MM-DD), independent of time zone.
export type IsoDate = string

export type RouteStep = {
  name: string
  minutesPerPiece: number
}

// Process route for each part number, in the order the work flows.
export type Routes = Record<string, RouteStep[]>

// A machine or work station. It runs the steps whose name is one of its processes;
// a multi-tasking machine has more than one.
export type Equipment = {
  id: string
  name: string
  processes: string[]
  // How fast it runs against the route's minutes per piece: 1.25 takes 1/1.25 of the time.
  // Left out for 1.
  speed?: number
  // Used when the part number changes and no setup rule covers the two shapes.
  setupMinutes: number
  // Running cost per working hour, in yen: what running the machine uses up, such as
  // power and tools. Depreciation is not in it, as fixed costs are not allocated.
  hourlyCost: number
  // Part number it ran last before the plan starts; its first setup is from this one.
  // Empty when the planner chose none.
  lastPart?: string
}

// What the plant makes and keeps in stock, per part number.
export type Part = {
  partNumber: string
  // Shape family. Setup time depends on the shape changed from and to.
  shape: string
  // Yen per piece.
  price: number
  materialCost: number
  // Finished pieces on hand now.
  stock: number
  // Pieces shipped in an average month.
  monthlyUsage: number
  // Raw material on hand that no open order has set aside, counted in the pieces it can
  // make. An open order with no material arrival date has its material already.
  materialStock?: number
  // Calendar days from ordering the material to its arrival. Absent when not known.
  materialLeadDays?: number
}

// Setup minutes on a process when the shape changes from one to another.
// fromShape === toShape covers a part number change within the same shape.
export type SetupRule = {
  process: string
  fromShape: string
  toShape: string
  minutes: number
}

// The people who run the machines of a group of processes (a crew, 班).
// Each running machine needs one of them, so on a regular working day no more
// machines of the crew run at once than people are at work.
export type Crew = {
  name: string
  processes: string[]
  // People at work on a regular working day, on each shift where the plant runs shifts.
  people: number
  // People who come in on a day off, as holiday work, on each shift; none when not set.
  holidayPeople?: number
}

// People of a crew at work on one day, when it is not the usual number.
export type Attendance = {
  crew: string
  date: IsoDate
  people: number
}

// An open manufacturing order (製造注残).
export type Order = {
  id: string
  partNumber: string
  quantity: number
  due: IsoDate
  // Material for the quantity not yet released arrives on this day.
  // Absent means it is already in stock.
  materialOn?: IsoDate
}

// A lot released to the floor. stepIndex is the step it is at now;
// stepIndex === route.length means every step is done.
export type Lot = {
  id: string
  orderId: string
  quantity: number
  stepIndex: number
  arrivedOn: IsoDate
}

export type PlantData = {
  parts: Part[]
  routes: Routes
  equipment: Equipment[]
  setupRules: SetupRule[]
  // Processes in no crew are not limited by people.
  crews: Crew[]
  attendance: Attendance[]
  orders: Order[]
  lots: Lot[]
  // Shown only; the plan does not read them. Data from before they were kept has none.
  actuals?: Actual[]
  customerOrders?: CustomerOrder[]
  channelStocks?: ChannelStock[]
  // Sales opportunities and how each one changed. The plan does not read them either;
  // they are set beside it as demand that may come.
  deals?: Deal[]
  dealChanges?: DealChange[]
  // Pieces ordered and shipped per part, plant and month, for the demand forecast.
  orderHistory?: MonthlyOrder[]
}

// Pieces customers ordered and pieces shipped of a part in one calendar month, at one plant.
// A company with several plants keeps one row per plant; one plant writes the same name.
export type MonthlyOrder = {
  // YYYY-MM
  month: string
  partNumber: string
  site: string
  ordered: number
  shipped: number
}

// A sales opportunity (商談): a customer that may order a part in volume, as the salesperson
// keeps it. Once won, the customer orders about monthlyQuantity pieces a month.
export type Deal = {
  id: string
  name: string
  customer: string
  // The salesperson who has the deal.
  owner: string
  // The part the customer would order. Empty while it is not decided.
  partNumber: string
  // One of DEAL_STAGES in deals.ts.
  stage: string
  // The day the customer is expected to decide.
  closeDate: IsoDate
  // Pieces a month once the customer orders in volume.
  monthlyQuantity: number
  // Whether the customer already buys from the plant: 既存 or 新規.
  customerKind: string
  // How the inquiry came in, such as 紹介 or 展示会.
  source: string
  // What the customer uses the part for.
  use: string
  // What the salesperson wrote about the deal.
  note: string
  createdOn: IsoDate
  // The day the stage last changed.
  stageChangedOn: IsoDate
  // How many times the close date was moved later.
  postponeCount: number
}

// The fields of a deal whose changes are kept.
export type DealField =
  | 'name'
  | 'customer'
  | 'owner'
  | 'partNumber'
  | 'stage'
  | 'closeDate'
  | 'monthlyQuantity'
  | 'customerKind'
  | 'source'
  | 'use'
  | 'note'

// One change to a deal, kept so a deal can be seen as it stood on any past day. A new deal
// has one row with field 'created'. Rows are only ever added.
export type DealChange = {
  dealId: string
  field: DealField | 'created'
  // Values as text; empty for none and on the created row.
  from: string
  to: string
  // Local date and time, YYYY-MM-DDTHH:MM.
  at: string
}

// One step a lot has already been through, as recorded on the shop floor.
export type Actual = {
  lotId: string
  stepIndex: number
  equipmentId: string
  // Local date and time, YYYY-MM-DDTHH:MM.
  start: string
  end: string
  good: number
  defect: number
}

// A customer's order that an open order fills: the date the customer asked for and the
// date promised back, which is null until answered.
export type CustomerOrder = {
  id: string
  orderId: string
  customer: string
  // Sold straight to the user of the part, or to a distributor that holds stock and sells
  // it on. Absent means direct.
  channel?: 'direct' | 'distributor'
  quantity: number
  requested: IsoDate
  answered: IsoDate | null
}

// Stock a distributor holds and how many it sells on in a month, as its last report said.
// What leaves the plant is not sold until it leaves the distributor, so real demand is the
// distributor's sales, and the distributor orders again when its stock runs low.
export type ChannelStock = {
  customer: string
  partNumber: string
  asOf: IsoDate
  stock: number
  monthlySales: number
  // The distributor orders when its stock falls to this many days of sales. Absent is 30.
  reorderDays?: number
}

export type Settings = {
  // How many days the Gantt chart shows.
  horizonDays: number
  // 1: a day shift only, between workStart and workEnd. 3: three shifts that cover the
  // whole day, so there is no time left for overtime (see workHours in settings.ts).
  shifts: 1 | 3
  // Where three shifts run: whether the crews that come in on a day off work its day shift
  // only (1), or all three shifts (3). A day-shift plant works its day shift on days off too.
  // See holidayHours in settings.ts.
  holidayShifts: 1 | 3
  // The day shift's hours as HH:MM, kept while three shifts run.
  workStart: string
  workEnd: string
  // 0 = Sunday ... 6 = Saturday.
  workWeekdays: number[]
  // 1 = only due dates matter, 0 = only avoiding setups matters.
  dueWeight: number
  stoppedEquipment: string[]
  // Wait between the end of one step and the start of the next.
  transferMinutes: number
  // Lots sitting at a step this many days or more get a warning.
  stagnationWarningDays: number
  // The labor rate, pay per person-hour in yen, and the premiums on top of it
  // (0.25 = 25%; the statutory minimums in Japan are 25% and 35%). The night premium is
  // for work between 22:00 and 05:00 (25% by law) and adds to the others.
  laborRate: number
  overtimePremium: number
  holidayPremium: number
  nightPremium: number
}
