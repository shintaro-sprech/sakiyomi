import { describe, expect, it } from 'vitest'

import { monthlyOutlook, unusedChanges } from './economics'
import { runPlan } from './plan'
import type { Change } from './scenario'
import { createDefaultSettings } from './settings'
import type { PlantData, Settings } from './types'

// One machine that costs 10 yen a minute, labor at 50 yen a minute.
function plant(quantity: number, stock = 100, monthlyUsage = 0): PlantData {
  return {
    parts: [{ partNumber: 'P', shape: '丸物', price: 10000, materialCost: 4000, stock, monthlyUsage }],
    routes: { P: [{ name: '加工', minutesPerPiece: 60 }] },
    equipment: [{ id: 'M1', name: 'M1', processes: ['加工'], setupMinutes: 0, hourlyCost: 600 }],
    setupRules: [],
    crews: [],
    attendance: [],
    orders: [{ id: '1', partNumber: 'P', quantity, due: '2026-12-31' }],
    lots: [],
  }
}

function outlook(data: PlantData, today: string, changes: Change[] = [], shifts: Settings['shifts'] = 1) {
  const settings = { ...createDefaultSettings(), transferMinutes: 0, laborRate: 3000, shifts }
  return monthlyOutlook(runPlan({ data, settings, adopted: changes, today }), today)
}

describe('monthlyOutlook', () => {
  it('takes material, machine running cost and the pay the plan adds from revenue', () => {
    const result = outlook(plant(1), '2026-11-03')

    // The base pay of the day shift is a fixed cost and does not come off.
    expect(result).toMatchObject({
      month: '2026-11',
      completedPieces: 1,
      revenue: 10000,
      materialCost: 4000,
      overtimePay: 0,
      holidayPay: 0,
      machineCost: 600,
      grossProfit: 5400,
    })
  })

  it('pays the overtime premium for time past the end of the day, and the night premium after 22:00', () => {
    const tuesday = (minutesPerDay: number): Change[] => [
      { kind: 'overtime', equipmentId: 'M1', from: '2026-11-03', to: '2026-11-03', minutesPerDay },
    ]
    const hour = outlook(plant(10), '2026-11-03', tuesday(60))
    // 08:00 to 23:00: six hours past 17:00, one of them at night.
    const late = outlook(plant(15), '2026-11-03', tuesday(360))

    expect(hour).toMatchObject({ overtimeHours: 1, nightHours: 0, overtimePay: 50 * 60 * 1.25 })
    expect(late).toMatchObject({ overtimeHours: 6, nightHours: 1, overtimePay: 50 * (360 * 1.25 + 60 * 0.25) })
  })

  it('adds no pay for three shifts through the night on working days', () => {
    // 30 hours from Tuesday 00:00, with 12 of them at night: the night shift is paid either way.
    const result = outlook(plant(30), '2026-11-03', [], 3)

    expect(result).toMatchObject({ overtimeHours: 0, holidayHours: 0, nightHours: 0, overtimePay: 0, holidayPay: 0 })
    expect(result.grossProfit).toBe(300000 - 120000 - 30 * 600)
  })

  it('pays each shift called in on a day off whole, with the night premium on its night hours', () => {
    const saturday: Change[] = [{ kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-07' }]
    // After Friday's 24 hours, Saturday runs from 00:00 to 06:00: the 00:00 shift comes in.
    const morning = outlook(plant(30), '2026-11-06', saturday, 3)
    // Saturday runs round the clock: all three shifts, 7 hours of them at night.
    const allDay = outlook(plant(60), '2026-11-06', saturday, 3)

    expect(morning).toMatchObject({ holidayHours: 8, nightHours: 5, holidayPay: 50 * (480 * 1.35 + 300 * 0.25) })
    expect(allDay).toMatchObject({ holidayHours: 24, nightHours: 7, holidayPay: 50 * (1440 * 1.35 + 420 * 0.25) })
  })

  it('pays a day shift called in on a day off for the whole day, and its overtime as worked', () => {
    const saturday: Change = { kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-07' }
    // 2026-11-06 is a Friday: nine pieces that day, the tenth on Saturday from 08:00 to 09:00.
    const hour = outlook(plant(10), '2026-11-06', [saturday])
    // Two hours of overtime from Friday to Saturday: 11 pieces on Friday, the last 7 on Saturday
    // from 08:00 to 15:00, so no time past 17:00 is worked on Saturday.
    const overtime: Change = { kind: 'overtime', equipmentId: 'M1', from: '2026-11-06', to: '2026-11-07', minutesPerDay: 120 }
    const short = outlook(plant(18), '2026-11-06', [saturday, overtime])
    // 22 pieces: Saturday runs from 08:00 to 19:00, two hours past 17:00.
    const long = outlook(plant(22), '2026-11-06', [saturday, overtime])

    expect(hour).toMatchObject({ holidayHours: 9, nightHours: 0, holidayPay: 50 * 540 * 1.35 })
    expect(short).toMatchObject({ holidayHours: 9, holidayPay: 50 * 540 * 1.35 })
    expect(long).toMatchObject({ holidayHours: 11, holidayPay: 50 * 660 * 1.35 })
  })

  it('calls the day shift in for work on a day off that runs only past its end', () => {
    // M1 cuts 18 pieces from Friday 08:00 to Saturday 17:00; M2 finishes the lot from 17:00 to
    // 17:18 on Saturday overtime. M2's person comes in for the day shift and the 18 minutes.
    const data = plant(18)
    const twoSteps: PlantData = {
      ...data,
      routes: { P: [{ name: '加工', minutesPerPiece: 60 }, { name: '仕上', minutesPerPiece: 1 }] },
      equipment: [...data.equipment, { id: 'M2', name: 'M2', processes: ['仕上'], setupMinutes: 0, hourlyCost: 0 }],
    }
    const result = outlook(twoSteps, '2026-11-06', [
      { kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-07' },
      { kind: 'holidayWork', equipmentId: 'M2', date: '2026-11-07' },
      { kind: 'overtime', equipmentId: 'M2', from: '2026-11-07', to: '2026-11-07', minutesPerDay: 120 },
    ])

    expect(result.holidayHours).toBe(18.3)
    expect(result.holidayPay).toBe(50 * (540 + 540 + 18) * 1.35)
  })

  it('pays the crews\' holiday people for the whole day off, whether a machine runs or not', () => {
    // 2026-11-27 is a Friday: the crew comes in on Saturday 11/28 and Sunday 11/29.
    const data = { ...plant(1), crews: [{ name: '加工班', processes: ['加工'], people: 1, holidayPeople: 1 }] }
    const result = outlook(data, '2026-11-27')

    expect(result).toMatchObject({ holidayHours: 18, holidayPay: 50 * 1080 * 1.35 })
  })

  it('pays the holiday people of a three-shift plant for its day shift, and a machine called in for its shifts', () => {
    const crews = [{ name: '加工班', processes: ['加工'], people: 1, holidayPeople: 1 }]
    const data = { ...plant(1), crews }
    // 2026-11-27 is a Friday: the crew comes in from 08:00 to 16:00 on Saturday and Sunday.
    const dayShift = outlook(data, '2026-11-27', [], 3)
    // Called in on Saturday as well, though nothing is left to run that day: no shift is paid for it.
    const called = outlook(data, '2026-11-27', [{ kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-28' }], 3)

    expect(dayShift).toMatchObject({ holidayHours: 16, nightHours: 0, holidayPay: Math.round(50 * 960 * 1.35) })
    expect(called.holidayPay).toBe(dayShift.holidayPay)
  })

  it('counts revenue only for what is finished this month, and costs only for work done this month', () => {
    // 2026-11-30 is a Monday; the order finishes on 12/1.
    const result = outlook(plant(10), '2026-11-30')

    expect(result.revenue).toBe(0)
    expect(result.machineCost).toBe(9 * 600)
  })

  it('projects when stock runs short and when finished lots refill it', () => {
    const result = outlook(plant(10, 0, 30), '2026-11-03')

    expect(result.shortages).toEqual([
      { partNumber: 'P', from: '2026-11-03', until: '2026-11-04', maxShortage: 1 },
      { partNumber: 'P', from: '2026-11-13', until: null, maxShortage: 49 },
    ])
  })
})

describe('unusedChanges', () => {
  const today = '2026-11-06'
  const settings = { ...createDefaultSettings(), transferMinutes: 0 }
  const unused = (quantity: number, changes: Change[]) =>
    unusedChanges(runPlan({ data: plant(quantity), settings, adopted: changes, today }), changes, today)

  it('finds holiday work on a day when nothing is left to run', () => {
    // 2026-11-06 is a Friday: one piece is done that day, so Saturday has nothing to run.
    const saturday: Change = { kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-07' }

    expect(unused(1, [saturday])).toEqual([saturday])
    expect(unused(10, [saturday])).toEqual([])
  })

  it('keeps overtime on a day off worked as holiday work when work runs past the end of the day', () => {
    const saturday: Change = { kind: 'holidayWork', equipmentId: 'M1', date: '2026-11-07' }
    const overtime: Change = { kind: 'overtime', equipmentId: 'M1', from: '2026-11-07', to: '2026-11-07', minutesPerDay: 120 }

    // 20 pieces: 9 on Friday, then Saturday from 08:00 to 19:00.
    expect(unused(20, [saturday, overtime])).toEqual([])
    expect(unused(12, [saturday, overtime])).toEqual([overtime])
  })

  it('keeps overtime on a day off only the crew comes in on, past the end of its shift', () => {
    // Three shifts, and a crew that comes in on the day shift at the weekend: 30 pieces end
    // Saturday at 14:00, or with two hours more each weekend day the work runs past 16:00.
    const crews = [{ name: '加工班', processes: ['加工'], people: 1, holidayPeople: 1 }]
    const settings = { ...createDefaultSettings(), transferMinutes: 0, shifts: 3 as const }
    const overtime: Change = { kind: 'overtime', equipmentId: 'M1', from: '2026-11-07', to: '2026-11-08', minutesPerDay: 120 }
    const unusedWith = (quantity: number) =>
      unusedChanges(runPlan({ data: { ...plant(quantity), crews }, settings, adopted: [overtime], today }), [overtime], today)

    expect(unusedWith(36)).toEqual([])
    expect(unusedWith(30)).toEqual([overtime])
  })

  it('keeps overtime that work runs into', () => {
    const friday: Change = { kind: 'overtime', equipmentId: 'M1', from: '2026-11-06', to: '2026-11-06', minutesPerDay: 60 }

    expect(unused(10, [friday])).toEqual([])
    expect(unused(1, [friday])).toEqual([friday])
  })
})
