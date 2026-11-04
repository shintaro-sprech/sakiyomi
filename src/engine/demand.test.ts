import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { classify, lastDayOfMonth, lastDayOfNextMonth, orderDemands, replenishments, stockoutDate } from './demand'
import type { Part, PlantData } from './types'

const today = '2026-11-03'

const part = (stock: number, monthlyUsage: number): Part => ({
  partNumber: 'P',
  shape: '丸物',
  price: 0,
  materialCost: 0,
  stock,
  monthlyUsage,
})

describe('month boundaries', () => {
  it('finds the last day of this month and next month', () => {
    expect(lastDayOfMonth(today)).toBe('2026-11-30')
    expect(lastDayOfNextMonth(today)).toBe('2026-12-31')
    expect(lastDayOfMonth('2028-02-10')).toBe('2028-02-29')
  })

  it('classifies by the month a date falls in', () => {
    expect(classify('2026-11-30', today)).toBe('A')
    expect(classify('2026-12-01', today)).toBe('B')
    expect(classify('2027-01-01', today)).toBe('C')
  })
})

describe('stockoutDate', () => {
  it('is today when nothing is in stock, and never without usage', () => {
    expect(stockoutDate(0, part(0, 30), today)).toBe(today)
    expect(stockoutDate(30, part(30, 30), today)).toBe('2026-12-03')
    expect(stockoutDate(30, part(30, 0), today)).toBeNull()
  })
})

describe('orderDemands', () => {
  it('needs each order when stock plus the orders before it run out', () => {
    const data: PlantData = {
      parts: [part(10, 30)],
      routes: { P: [{ name: '加工', minutesPerPiece: 1 }] },
      equipment: [],
      setupRules: [],
      crews: [],
      attendance: [],
      orders: [
        { id: 'o1', partNumber: 'P', quantity: 20, due: '2027-01-31' },
        { id: 'o2', partNumber: 'P', quantity: 10, due: '2027-02-28' },
      ],
      lots: [],
    }

    expect(orderDemands(data, today)).toEqual([
      { orderId: 'o1', partNumber: 'P', needBy: '2026-11-13', stockoutOn: '2026-11-13', priorityClass: 'A' },
      { orderId: 'o2', partNumber: 'P', needBy: '2026-12-03', stockoutOn: '2026-12-03', priorityClass: 'B' },
    ])
  })

  it('puts the sample orders into all three classes', () => {
    const classes = Object.fromEntries(
      orderDemands(createSampleData(today), today).map((demand) => [demand.orderId, demand.priorityClass]),
    )

    expect(classes).toMatchObject({ '1045': 'A', '1030': 'A', '1040': 'B', '1034': 'B', '1050': 'C' })
  })
})

describe('replenishments', () => {
  it('finds what stock and every open order leave short through the end of next month', () => {
    // B-200 ships 4.5 a day: 59 days to 12/31 need 265.5, while stock and orders give 102.
    expect(replenishments(createSampleData(today), today)).toEqual([
      { partNumber: 'B-200', quantity: 164, needBy: '2026-11-25' },
    ])
  })

  it('leaves out a part with no route, which cannot be made', () => {
    const data = createSampleData(today)
    data.parts.push({ partNumber: 'P-900', shape: '丸物', price: 0, materialCost: 0, stock: 0, monthlyUsage: 30 })

    expect(replenishments(data, today).map((item) => item.partNumber)).toEqual(['B-200'])
  })

  it('is gone once an order for the shortfall is added', () => {
    const data = createSampleData(today)
    data.orders.push({ id: '追加1', partNumber: 'B-200', quantity: 164, due: '2026-11-25' })

    expect(replenishments(data, today)).toEqual([])
  })
})
