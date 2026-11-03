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
  // Used when the part number changes and no setup rule covers the two shapes.
  setupMinutes: number
  // Running cost per working hour, in yen.
  hourlyCost: number
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
  // People at work on a regular working day.
  people: number
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
  // Labor cost per person-hour in yen, and the premiums on top of it
  // (0.25 = 25%; the statutory minimums in Japan are 25% and 35%).
  laborRate: number
  overtimePremium: number
  holidayPremium: number
}
