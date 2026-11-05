import { weekday } from './dates'
import type { Scenario } from './scenario'
import type { Crew, IsoDate, PlantData } from './types'

// The crew whose people run each piece of equipment, by equipment id: the crew of any of
// its processes, as a machine's processes all belong to one crew. Equipment whose
// processes are in no crew is not in the map.
export function crewOfEquipment(data: PlantData): Map<string, Crew> {
  const crews = new Map<string, Crew>()
  for (const equipment of data.equipment) {
    const crew = data.crews.find((candidate) => equipment.processes.some((process) => candidate.processes.includes(process)))
    if (crew) crews.set(equipment.id, crew)
  }
  return crews
}

// People of a crew at work on a day: the usual number on a working day or the holiday number
// on a day off, then the attendance in the data, then, on a working day, headcount changes,
// later entries winning. Headcount changes, such as help from another crew, are for working days.
export function crewPeople(scenario: Scenario, crew: Crew, date: IsoDate): number {
  const working = scenario.settings.workWeekdays.includes(weekday(date))
  let people = working ? crew.people : (crew.holidayPeople ?? 0)
  for (const entry of scenario.data.attendance) {
    if (entry.crew === crew.name && entry.date === date) people = entry.people
  }
  for (const entry of scenario.headcount) {
    if (working && entry.crew === crew.name && date >= entry.from && date <= entry.to) people = entry.people
  }
  return people
}
