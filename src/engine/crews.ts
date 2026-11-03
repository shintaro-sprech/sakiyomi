import type { Scenario } from './scenario'
import type { Crew, IsoDate, PlantData } from './types'

// The crew whose people run each piece of equipment, by equipment id.
// Equipment whose process is in no crew is not in the map.
export function crewOfEquipment(data: PlantData): Map<string, Crew> {
  const crews = new Map<string, Crew>()
  for (const equipment of data.equipment) {
    const crew = data.crews.find((candidate) => candidate.processes.includes(equipment.process))
    if (crew) crews.set(equipment.id, crew)
  }
  return crews
}

// People of a crew at work on a regular working day: the usual number, then
// the attendance in the data, then headcount changes, later entries winning.
export function crewPeople(scenario: Scenario, crew: Crew, date: IsoDate): number {
  let people = crew.people
  for (const entry of scenario.data.attendance) {
    if (entry.crew === crew.name && entry.date === date) people = entry.people
  }
  for (const entry of scenario.headcount) {
    if (entry.crew === crew.name && date >= entry.from && date <= entry.to) people = entry.people
  }
  return people
}
