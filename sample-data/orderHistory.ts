// Fictional monthly orders made for this project: three years per part up to last month, at
// the one sample plant. Each part has its own level, a yearly swing (busier in spring and
// autumn), a trend and noise from a seeded generator, so the history is the same every day.
// The last three months average about the part's monthly shipments in the sample. Pieces
// shipped follow pieces ordered with about a month's lag.
import { addMonths, monthOf } from '../src/engine/dealDemand'
import type { IsoDate, MonthlyOrder, Part } from '../src/engine/types'

export const SAMPLE_SITE = '本社工場'
const MONTHS = 36

// Per part: growth per month and how noisy the orders are.
const SHAPES: Record<string, { trend: number; noise: number }> = {
  'A-100': { trend: 0.012, noise: 0.08 },
  'B-200': { trend: 0.004, noise: 0.12 },
  'C-310': { trend: -0.006, noise: 0.07 },
  'D-410': { trend: 0.0, noise: 0.2 },
}

function generator(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  return () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next())
}

export function sampleOrderHistory(parts: Part[], today: IsoDate): MonthlyOrder[] {
  const last = addMonths(monthOf(today), -1)
  const first = addMonths(last, -(MONTHS - 1))
  return parts.flatMap((part, partIndex) => {
    const shape = SHAPES[part.partNumber] ?? { trend: 0, noise: 0.1 }
    const normal = generator(9100 + partIndex)
    const months = Array.from({ length: MONTHS }, (_, index) => addMonths(first, index))
    const raw = months.map((month, index) => {
      const calendarMonth = Number(month.slice(5, 7))
      const season = 1 + 0.15 * Math.sin((2 * Math.PI * (calendarMonth - 2)) / 6)
      return season * (1 + shape.trend * (index - (MONTHS - 2))) * (1 + shape.noise * normal())
    })
    // Scale so the last three months average the part's monthly shipments.
    const recent = (raw[MONTHS - 1] + raw[MONTHS - 2] + raw[MONTHS - 3]) / 3
    const ordered = raw.map((value) => Math.max(0, Math.round((value / recent) * part.monthlyUsage)))
    return months.map((month, index) => ({
      month,
      partNumber: part.partNumber,
      site: SAMPLE_SITE,
      ordered: ordered[index],
      shipped: Math.round(0.7 * (ordered[index - 1] ?? ordered[index]) + 0.3 * ordered[index]),
    }))
  })
}
