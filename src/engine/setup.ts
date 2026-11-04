import type { Equipment, PlantData } from './types'

// Setup minutes when equipment switches from one part number to another to run process.
// Same part: none, even on another of the machine's processes. Otherwise the rule for the
// two shapes on that process, or the equipment's default when no rule covers the pair.
export function setupMinutes(
  data: Pick<PlantData, 'parts' | 'setupRules'>,
  equipment: Equipment,
  process: string,
  fromPart: string | null,
  toPart: string,
): number {
  if (fromPart === null || fromPart === toPart) return 0
  const fromShape = shapeOf(data, fromPart)
  const toShape = shapeOf(data, toPart)
  const rule = data.setupRules.find(
    (candidate) => candidate.process === process && candidate.fromShape === fromShape && candidate.toShape === toShape,
  )
  return rule ? rule.minutes : equipment.setupMinutes
}

function shapeOf(data: Pick<PlantData, 'parts'>, partNumber: string): string | null {
  return data.parts.find((part) => part.partNumber === partNumber)?.shape ?? null
}
