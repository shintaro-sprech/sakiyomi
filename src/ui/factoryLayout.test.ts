import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import {
  cardPlace,
  cartonsOf,
  CELL,
  factoryLayout,
  forkliftAt,
  LOT_SCALE,
  LOTS_REACH,
  meetsHull,
  modelOf,
  NAME_PLACES,
  namePlaces,
  PILE_MAX,
  pileSpots,
  RUNNING_SPOT,
  type LoadSpot,
  type NameSpot,
  type Rect,
} from './factoryLayout'

describe('factoryLayout', () => {
  const data = createSampleData('2026-11-04')

  it('lays the crews out from material to finished goods, each in two rows', () => {
    const layout = factoryLayout(data)

    expect(layout.zones.map((zone) => zone.name)).toEqual(['板金班', '機械班', '仕上げ班'])
    expect(layout.machines).toHaveLength(data.equipment.length)
    expect(layout.material.x1).toBeLessThanOrEqual(layout.zones[0].x0)
    expect(layout.finished.x0).toBeGreaterThanOrEqual(layout.zones.at(-1)!.x1)
    // No two machines share a place.
    expect(new Set(layout.machines.map((machine) => `${machine.x},${machine.z}`)).size).toBe(layout.machines.length)
  })

  it('keeps the main aisle along the front clear of the machines, the lots and the stores', () => {
    const layout = factoryLayout(data)
    const aisleBack = layout.aisle.z - layout.aisle.width / 2

    expect(layout.aisle.z + layout.aisle.width / 2).toBeLessThanOrEqual(layout.front)
    for (const machine of layout.machines) expect(machine.z + LOTS_REACH).toBeLessThanOrEqual(aisleBack)
    for (const store of [layout.material, layout.finished]) {
      expect(store.spots).toHaveLength(data.parts.length)
      for (const spot of store.spots) {
        expect(spot.z + 0.7).toBeLessThanOrEqual(aisleBack)
        expect(spot.x).toBeGreaterThan(store.x0)
        expect(spot.x).toBeLessThan(store.x1)
      }
    }
  })

  it('puts the pallets of many parts in more than one file', () => {
    const parts = Array.from({ length: 9 }, (_, index) => ({ ...data.parts[0], partNumber: `P-${index}` }))
    const layout = factoryLayout({ ...data, parts })
    const places = layout.material.spots.map((spot) => `${spot.x},${spot.z}`)

    expect(new Set(places).size).toBe(parts.length)
    expect(new Set(layout.material.spots.map((spot) => spot.x)).size).toBeGreaterThan(1)
    for (const spot of layout.material.spots) expect(spot.x).toBeGreaterThan(0)
  })

  it('leaves room in front of a machine of the back row for its lots, clear of the machine in front', () => {
    const layout = factoryLayout(data)
    const rows = [...new Set(layout.machines.map((machine) => machine.z))].sort((a, b) => a - b)

    expect(rows).toHaveLength(2)
    // The deepest machine reaches about 1.1 m behind its middle.
    expect(rows[0] + LOTS_REACH + 1.15).toBeLessThan(rows[1])
  })

  it('puts machines of no crew in an area of their own', () => {
    const extra = { id: 'X-1', name: 'X', processes: ['塗装'], setupMinutes: 0, hourlyCost: 0 }
    const layout = factoryLayout({ ...data, equipment: [...data.equipment, extra] })

    expect(layout.zones.at(-1)?.name).toBe('')
    expect(layout.machines.find((machine) => machine.equipment.id === 'X-1')?.model).toBe('generic_machine')
  })

  it('picks a model from what the first process does', () => {
    const model = (process: string) => modelOf({ id: 'M', name: 'M', processes: [process], setupMinutes: 0, hourlyCost: 0 })

    expect(['切断', '曲げ', '溶接', '切削', '熱処理', '研削', '穴あけ', '検査', '梱包'].map(model)).toEqual([
      'cutter',
      'press_brake',
      'welding_robot',
      'machining_center',
      'furnace',
      'grinder',
      'drill_press',
      'inspection_table',
      'packing_table',
    ])
  })
})

describe('pileSpots', () => {
  // Half a lot's pallet.
  const half = (1.1 * LOT_SCALE) / 2

  it('puts the lot a machine takes next nearest to it, row by row', () => {
    const spots = pileSpots(5)

    expect(spots).toHaveLength(5)
    for (let index = 1; index < spots.length; index++) expect(spots[index].z).toBeGreaterThanOrEqual(spots[index - 1].z)
    // Three in the first row and two in the second, each row centered on the machine.
    const rows = [...new Set(spots.map((spot) => spot.z))].map((z) => spots.filter((spot) => spot.z === z))
    expect(rows.map((row) => row.length)).toEqual([3, 2])
    for (const row of rows) expect(row.reduce((sum, spot) => sum + spot.x, 0)).toBeCloseTo(0, 9)
    expect(pileSpots(1)).toEqual([{ x: 0, z: spots[0].z }])
  })

  it('draws as many as fit and no more', () => {
    expect(pileSpots(PILE_MAX + 4)).toHaveLength(PILE_MAX)
    expect(pileSpots(0)).toEqual([])
  })

  it('keeps the pallets apart, in front of the machine, clear of the lot it runs and of the next machine', () => {
    const spots = pileSpots(PILE_MAX)
    for (const [index, spot] of spots.entries()) {
      for (const other of spots.slice(index + 1)) expect(Math.max(Math.abs(spot.x - other.x), Math.abs(spot.z - other.z))).toBeGreaterThan(2 * half)
      // Clear of the lot on the machine and of the person at its front, about 1.4 m out.
      expect(Math.max(Math.abs(spot.x - RUNNING_SPOT.x), Math.abs(spot.z - RUNNING_SPOT.z))).toBeGreaterThan(2 * half)
      expect(spot.z - half).toBeGreaterThan(1.4)
      // Inside the machine's width of the floor, apart from the lots of the machine beside it.
      expect(Math.abs(spot.x) + half).toBeLessThan(CELL / 2 - 0.3)
      expect(spot.z + half).toBeLessThanOrEqual(LOTS_REACH + 1e-9)
    }
  })
})

describe('cartonsOf', () => {
  it('stacks a carton for every 15 pieces or part of them, up to eight', () => {
    expect([1, 15, 16, 60, 90, 120, 500].map(cartonsOf)).toEqual([1, 1, 2, 4, 6, 8, 8])
  })
})

describe('cardPlace', () => {
  const stage = { width: 1000, height: 700 }
  const card = { width: 220, height: 150 }
  const zoom: Rect = { x: 920, y: 658, width: 68, height: 32 }
  const clock: Rect = { x: 12, y: 10, width: 90, height: 20 }
  const covers = (place: { x: number; y: number }, area: Rect) =>
    place.x < area.x + area.width && place.x + card.width > area.x && place.y < area.y + area.height && place.y + card.height > area.y
  const insideStage = (place: { x: number; y: number }) =>
    place.x >= 0 && place.y >= 0 && place.x + card.width <= stage.width && place.y + card.height <= stage.height

  it('puts the card at the right of the machine and its lots, level with their top', () => {
    const keep = { x: 300, y: 200, width: 120, height: 140 }

    expect(cardPlace(keep, card, stage, [zoom, clock])).toEqual({ x: 432, y: 200 })
  })

  it('goes to the left near the right edge, and keeps inside the stage near the bottom', () => {
    const keep = { x: 800, y: 600, width: 120, height: 90 }
    const place = cardPlace(keep, card, stage, [zoom, clock])

    expect(place.x + card.width).toBeLessThanOrEqual(keep.x)
    expect(insideStage(place)).toBe(true)
  })

  it('never covers the machine or the zoom buttons while some place beside it is clear', () => {
    for (let x = 0; x <= stage.width - 120; x += 40) {
      for (let y = 0; y <= stage.height - 140; y += 40) {
        const keep = { x, y, width: 120, height: 140 }
        const place = cardPlace(keep, card, stage, [zoom, clock])

        expect(insideStage(place)).toBe(true)
        expect(covers(place, keep)).toBe(false)
        expect(covers(place, zoom)).toBe(false)
      }
    }
  })

  it('takes the place that covers the machine least when none beside it is clear', () => {
    const keep = { x: 100, y: 100, width: 800, height: 500 }
    const place = cardPlace(keep, card, stage, [zoom, clock])

    expect(insideStage(place)).toBe(true)
    // In the top right corner, over the machine's corner: less of it than at either side or over
    // its middle, and clear of the clock in the other corner.
    expect(place).toEqual({ x: 772, y: 8 })
  })

  it('keeps off the side where another machine’s lots stand', () => {
    const keep = { x: 300, y: 200, width: 120, height: 140 }
    // Lots at its right, as the screen shows a box of the floor.
    const lots: [number, number][][] = [
      [
        [450, 210],
        [520, 200],
        [540, 260],
        [470, 280],
      ],
    ]

    expect(cardPlace(keep, card, stage, [zoom, clock], { lots })).toEqual({ x: 68, y: 200 })
  })

  it('would rather cover another machine than its lots, and a name than a red tag', () => {
    // A tall machine and its lots on a short stage: the card fits only at their right or their left.
    const short = { width: 1000, height: 300 }
    const keep = { x: 390, y: 20, width: 220, height: 260 }
    const right: [number, number][] = [
      [630, 0],
      [850, 0],
      [850, 300],
      [630, 300],
    ]
    const left: [number, number][] = [
      [150, 0],
      [370, 0],
      [370, 300],
      [150, 300],
    ]

    expect(cardPlace(keep, card, short, [], { lots: [right], solids: [left] })).toEqual({ x: 158, y: 20 })
    expect(cardPlace(keep, card, short, [], { lots: [left], solids: [right] })).toEqual({ x: 622, y: 20 })
    // A name or a tag gives way whole, however little of it the card covers: here an edge of the
    // red tag at the right, most of the name at the left.
    const tag: Rect = { x: 835, y: 145, width: 80, height: 22 }
    const name: Rect = { x: 150, y: 145, width: 80, height: 22 }
    expect(cardPlace(keep, card, short, [], { tags: [tag], names: [name] })).toEqual({ x: 158, y: 20 })
  })
})

describe('meetsHull', () => {
  // A diamond, as the floor under a machine looks from a corner, with corners given twice over.
  const diamond: [number, number][] = [
    [50, 0],
    [100, 50],
    [50, 100],
    [0, 50],
    [50, 0],
    [100, 50],
  ]

  it('tells a box over the shape from one in the empty corner of the box round it', () => {
    expect(meetsHull(diamond, { x: 40, y: 40, width: 20, height: 20 })).toBe(true)
    expect(meetsHull(diamond, { x: 90, y: 45, width: 30, height: 10 })).toBe(true)
    expect(meetsHull(diamond, { x: 80, y: 80, width: 30, height: 30 })).toBe(false)
    expect(meetsHull(diamond, { x: 0, y: 0, width: 20, height: 20 })).toBe(false)
    expect(meetsHull(diamond, { x: 120, y: 0, width: 20, height: 100 })).toBe(false)
  })
})

describe('namePlaces', () => {
  const stage = { width: 600, height: 400 }
  // A machine's name: the point just over the machine at top, the middle of its front 60 px lower,
  // and the box round the machine from 24 px over that point to its front, 50 px across.
  const name = (machine: string, top: [number, number], extra: Partial<NameSpot> = {}): NameSpot => ({
    machine,
    top,
    foot: [top[0], top[1] + 60],
    body: [
      [top[0] - 25, top[1] - 24],
      [top[0] + 25, top[1] - 24],
      [top[0] + 25, top[1] + 60],
      [top[0] - 25, top[1] + 60],
    ],
    width: 80,
    height: 22,
    chosen: false,
    lot: false,
    ...extra,
  })
  // A load as the screen shows a box of the floor from above and the left: its corners, top and bottom.
  const load = (machine: string, x: number, y: number, width = 40, height = 36): LoadSpot => ({
    machine,
    corners: [
      [x + 10, y],
      [x + width, y],
      [x + width, y + height - 10],
      [x + width - 10, y + height],
      [x, y + height],
      [x, y + 10],
    ],
  })
  // Where a name stands at its place.
  const rectOf = (spot: NameSpot, place: { x: number; y: number }): Rect => ({ ...place, width: spot.width, height: spot.height })
  const apart = (a: Rect, b: Rect) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y

  it('stands a name over the point just over its machine, its bottom on the point', () => {
    const spot = name('M', [200, 200])
    const { places } = namePlaces({ names: [spot], loads: [], tags: [], signs: [], avoid: [], stage })

    expect(places).toEqual([{ x: 160, y: 178 }])
    expect(NAME_PLACES[0]).toEqual({ from: 'top', shift: [-0.5, -1] })
  })

  it('keeps off the shape of a crew’s sign, not the box round it', () => {
    // A sign on the back wall, its bottom edge rising to the right as the screen shows it.
    const sign: [number, number][] = [
      [200, 40],
      [290, 10],
      [290, 60],
      [200, 90],
    ]
    const spot = name('M', [325, 107])
    const { places } = namePlaces({ names: [spot], loads: [], tags: [], signs: [sign], avoid: [], stage })

    expect(places).toEqual([{ x: 285, y: 85 }])
    // The box round the sign takes in that place's corner.
    expect(apart(rectOf(spot, places[0]!), { x: 200, y: 10, width: 90, height: 80 })).toBe(false)
  })

  it('leans a name off a load behind its machine, keeping it over the point', () => {
    const spot = name('FRONT', [200, 200])
    const behind = load('BACK', 130, 150, 50)
    const { places } = namePlaces({ names: [spot], loads: [behind], tags: [], signs: [], avoid: [], stage })

    expect(places).toEqual([{ x: 188, y: 178 }])
    const rect = rectOf(spot, places[0]!)
    expect(meetsHull(behind.corners, rect)).toBe(false)
    expect(rect.x).toBeLessThan(200)
    expect(rect.x + rect.width).toBeGreaterThan(200)
  })

  it('puts the name of a low machine under its front where the loads behind stand all round its top', () => {
    const spot = name('LOW', [200, 200])
    const behind = load('BACK', 110, 150, 180, 60)
    const { places } = namePlaces({ names: [spot], loads: [behind], tags: [], signs: [], avoid: [], stage })

    // Its top edge on the middle of the machine's front.
    expect(places).toEqual([{ x: 160, y: 260 }])
    // With its own lots in front of it too, it gives way.
    const own = load('LOW', 150, 255, 100, 40)
    expect(namePlaces({ names: [spot], loads: [behind, own], tags: [], signs: [], avoid: [], stage }).places).toEqual([null])
  })

  it('places the name of a machine with a lot on it first, and keeps the others off it', () => {
    const idle = name('IDLE', [200, 100])
    const busy = name('BUSY', [240, 100], { lot: true })
    const { places } = namePlaces({ names: [idle, busy], loads: [], tags: [], signs: [], avoid: [], stage })

    // The busy machine's name stands over it; the idle one's moves to the left of its top.
    expect(places).toEqual([
      { x: 116, y: 89 },
      { x: 200, y: 78 },
    ])
    expect(apart(rectOf(idle, places[0]!), rectOf(busy, places[1]!))).toBe(true)
  })

  it('never puts a name over a load, a tag, another name or what lies over the floor, nor out of the stage', () => {
    // A row of machines at the back and one at the front, with loads of many sizes between them.
    let seed = 7
    const random = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    for (let round = 0; round < 60; round++) {
      const names = Array.from({ length: 8 }, (_, index) =>
        name(`M${index}`, [40 + index * 70 + random() * 20, index % 2 === 0 ? 120 + random() * 30 : 260 + random() * 30], {
          lot: random() < 0.4,
          height: random() < 0.5 ? 22 : 38,
        }),
      )
      const loads = names.flatMap((spot) =>
        Array.from({ length: Math.floor(random() * 4) }, () => load(spot.machine, spot.top[0] - 40 + random() * 60, spot.top[1] + 20 + random() * 60, 30 + random() * 30)),
      )
      const tags: Rect[] = [{ x: 20 + random() * 500, y: 60 + random() * 260, width: 70, height: 20 }]
      // The clock, and a crew's sign on the back wall.
      const clock: Rect = { x: 10, y: 8, width: 90, height: 20 }
      const sign: [number, number][] = [
        [180, 70],
        [260, 50],
        [260, 95],
        [180, 115],
      ]
      const { places, hiddenTags } = namePlaces({ names, loads, tags, signs: [sign], avoid: [clock], stage })

      expect(hiddenTags).toEqual([])
      const shown = names.flatMap((spot, index) => {
        const place = places[index]
        return place === null ? [] : [{ spot, rect: rectOf(spot, place) }]
      })
      for (const [index, { rect }] of shown.entries()) {
        expect(rect.x).toBeGreaterThanOrEqual(0)
        expect(rect.y).toBeGreaterThanOrEqual(0)
        expect(rect.x + rect.width).toBeLessThanOrEqual(stage.width)
        expect(rect.y + rect.height).toBeLessThanOrEqual(stage.height)
        for (const other of [...loads.map(({ corners }) => corners), sign]) expect(meetsHull(other, rect)).toBe(false)
        for (const area of [...tags, clock, ...shown.slice(index + 1).map((other) => other.rect)]) expect(apart(area, rect)).toBe(true)
      }
      // Most names find a place.
      expect(shown.length).toBeGreaterThanOrEqual(4)
    }
  })

  it('stands the chosen machine’s name clear of its machine where it can', () => {
    const chosen = name('ME', [200, 200], { chosen: true })
    const { places } = namePlaces({ names: [chosen], loads: [], tags: [], signs: [], avoid: [], stage })

    // Over the box round the machine, not on the point just over its middle, which the box takes in.
    expect(places).toEqual([{ x: 160, y: 152 }])
    expect(meetsHull(chosen.body, rectOf(chosen, places[0]!))).toBe(false)
  })

  it('always shows the chosen machine’s name, off its own lots, and hides the red tag under it', () => {
    // Close round the chosen machine: its own lots in front, other machines' lots at its right and
    // its left, and a red tag over it, so every place covers something.
    const chosen = name('ME', [200, 200], { chosen: true, lot: true })
    const loads = [load('ME', 150, 262, 100, 40), load('RIGHT', 230, 180, 60, 40), load('LEFT', 100, 180, 60, 40)]
    const tags: Rect[] = [{ x: 150, y: 140, width: 100, height: 20 }]
    const other = name('NEAR', [400, 200])
    const { places, hiddenTags } = namePlaces({ names: [other, chosen], loads, tags, signs: [], avoid: [], stage })

    // Over the machine, on the tag, which gives way, rather than on another machine's lots.
    expect(places[1]).toEqual({ x: 160, y: 152 })
    const rect = rectOf(chosen, places[1]!)
    expect(meetsHull(loads[0].corners, rect)).toBe(false)
    expect(hiddenTags).toEqual([0])
    // Other names keep off the chosen one.
    expect(places[0]).not.toBeNull()
    expect(apart(rectOf(other, places[0]!), rect)).toBe(true)
  })

  it('would rather let the chosen machine’s name cover a corner of a crew’s sign than hide a red tag', () => {
    const chosen = name('ME', [200, 200], { chosen: true })
    // A sign over the machine, a red tag at its right, another machine's lots at its left and its
    // own lots under its front.
    const sign: [number, number][] = [
      [140, 130],
      [260, 130],
      [260, 165],
      [140, 165],
    ]
    const tags: Rect[] = [{ x: 228, y: 176, width: 60, height: 20 }]
    const loads = [load('LEFT', 95, 176, 60, 30), load('ME', 150, 262, 100, 40)]
    const { places, hiddenTags } = namePlaces({ names: [chosen], loads, tags, signs: [sign], avoid: [], stage })

    expect(places).toEqual([{ x: 160, y: 152 }])
    expect(hiddenTags).toEqual([])
  })
})

describe('forkliftAt', () => {
  it('goes to and fro without a jump, stopping at each end with its forks up', () => {
    const run = 20
    let last = forkliftAt(0, run)
    let stops = 0
    for (let t = 0.05; t < 120; t += 0.05) {
      const now = forkliftAt(t, run)
      // Never faster than about twice its pace, and never off the run.
      expect(Math.abs(now.x - last.x)).toBeLessThan(0.2)
      expect(now.x).toBeGreaterThanOrEqual(0)
      expect(now.x).toBeLessThanOrEqual(run)
      if (now.lift > 0.3 && last.lift <= 0.3) stops++
      last = now
    }
    expect(stops).toBeGreaterThanOrEqual(4)
    expect(forkliftAt(1.6, run)).toEqual({ x: 0, lift: expect.closeTo(0.32, 2) })
  })
})
