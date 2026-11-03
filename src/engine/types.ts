// Dates are calendar days in ISO form (YYYY-MM-DD), independent of time zone.
export type IsoDate = string

export type RouteStep = {
  name: string
  minutesPerPiece: number
}

// Process route for each part number, in the order the work flows.
export type Routes = Record<string, RouteStep[]>

// A machine or work station. It runs the steps whose name matches process.
export type Equipment = {
  id: string
  name: string
  process: string
  // Charged when the part number changes on this equipment.
  setupMinutes: number
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
  routes: Routes
  equipment: Equipment[]
  orders: Order[]
  lots: Lot[]
}

export type Settings = {
  // How many days the Gantt chart shows.
  horizonDays: number
  // Working hours as HH:MM.
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
}
