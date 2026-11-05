import { describe, expect, it } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import { COLUMNS, parsePlantRows, SHEETS, toPlantRows } from './plantRows'

describe('plant rows', () => {
  it('reads back what it writes', () => {
    const data = createSampleData('2026-11-03')
    const { data: parsed, errors } = parsePlantRows(toPlantRows(data))

    expect(errors).toEqual([])
    expect(parsed).toEqual(data)
  })

  it('accepts Excel date cells and slashed dates', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    rows[SHEETS.orders][0][COLUMNS.orders.due] = new Date(2026, 10, 20)
    rows[SHEETS.orders][1][COLUMNS.orders.due] = '2026/11/21'
    const { data } = parsePlantRows(rows)

    expect(data?.orders[0].due).toBe('2026-11-20')
    expect(data?.orders[1].due).toBe('2026-11-21')
  })

  it('reads the running cost from a workbook with the earlier column name', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    rows[SHEETS.equipment] = rows[SHEETS.equipment].map(({ [COLUMNS.equipment.hourlyCost]: cost, ...row }) => ({
      ...row,
      '1時間の費用': cost,
    }))
    const { data, errors } = parsePlantRows(rows)

    expect(errors).toEqual([])
    expect(data?.equipment.find((item) => item.id === 'MC-1')?.hourlyCost).toBe(1200)
  })

  it('writes the processes of a multi-tasking machine in one cell, and the speed of each machine', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    const row = (id: string) => rows[SHEETS.equipment].find((item) => item[COLUMNS.equipment.id] === id)!

    expect(row('MC-1')[COLUMNS.equipment.processes]).toBe('切削、タップ')
    expect(row('BND-1')[COLUMNS.equipment.speed]).toBe(1.2)
    expect(row('WLD-1')[COLUMNS.equipment.speed]).toBe(1)
  })

  it('reads a workbook made before machines had a speed', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    rows[SHEETS.equipment] = rows[SHEETS.equipment].map(({ [COLUMNS.equipment.speed]: _speed, ...row }) => row)
    const { data, errors } = parsePlantRows(rows)

    expect(errors).toEqual([])
    expect(data?.equipment.every((item) => item.speed === undefined)).toBe(true)
  })

  it('refuses a speed written as a percentage', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    const welder = rows[SHEETS.equipment].findIndex((row) => row[COLUMNS.equipment.id] === 'WLD-2')
    rows[SHEETS.equipment][welder][COLUMNS.equipment.speed] = 120
    const { errors } = parsePlantRows(rows)

    expect(errors).toContain(
      `設備の${welder + 2}行目：速さは、工程表のとおりを1として、0.1以上10以下の数にしてください（2割速いなら1.2）`,
    )
  })

  it('refuses a machine whose processes belong to two crews', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    const machining = rows[SHEETS.equipment].findIndex((row) => row[COLUMNS.equipment.id] === 'MC-1')
    rows[SHEETS.equipment][machining][COLUMNS.equipment.processes] = '切削、タップ、検査'
    const { errors } = parsePlantRows(rows)

    expect(errors).toContain(
      `設備の${machining + 2}行目：担当工程が、班「機械班」と「仕上げ班」に分かれています。1台の設備の工程は、同じ班に入れてください`,
    )
  })

  it('reads how each customer order is sold, and what distributors report', () => {
    const { data, errors } = parsePlantRows(toPlantRows(createSampleData('2026-11-03')))
    const rows = toPlantRows(createSampleData('2026-11-03'))
    delete rows[SHEETS.channelStocks]
    rows[SHEETS.customerOrders] = rows[SHEETS.customerOrders].map(({ [COLUMNS.customerOrders.channel]: _channel, ...row }) => row)
    const older = parsePlantRows(rows)

    expect(errors).toEqual([])
    expect(data?.customerOrders?.find((entry) => entry.customer === '取引先D')?.channel).toBe('distributor')
    expect(data?.channelStocks).toHaveLength(4)
    expect(older.errors).toEqual([])
    expect(older.data?.channelStocks).toEqual([])
    expect(older.data?.customerOrders?.every((entry) => entry.channel === undefined)).toBe(true)
  })

  it('refuses a channel, a report or a lead time it cannot read', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    rows[SHEETS.customerOrders][0][COLUMNS.customerOrders.channel] = '卸'
    rows[SHEETS.channelStocks][0][COLUMNS.channelStocks.partNumber] = 'Z-999'
    rows[SHEETS.channelStocks][1][COLUMNS.channelStocks.stock] = -1
    rows[SHEETS.parts][3][COLUMNS.parts.materialLeadDays] = 2.5
    const { errors } = parsePlantRows(rows)

    expect(errors).toContain('受注の2行目：販路は「直販」か「代理店」か空欄にしてください')
    expect(errors).toContain('販売在庫の2行目：型番「Z-999」が品目にありません')
    expect(errors).toContain('販売在庫の3行目：在庫は0以上の整数にしてください')
    expect(errors).toContain('品目の5行目：材料の調達日数は0以上の整数にしてください')
  })

  it('refuses a last part the equipment could not have run', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    const bending = rows[SHEETS.equipment].findIndex((row) => row[COLUMNS.equipment.id] === 'BND-1')
    rows[SHEETS.equipment][bending][COLUMNS.equipment.lastPart] = 'B-200'
    const { errors } = parsePlantRows(rows)

    expect(errors).toContain(`設備の${bending + 2}行目：直前の型番「B-200」の工程表に「曲げ」がありません`)
  })

  it('plans without people limits when the workbook has no crews', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    delete rows[SHEETS.crews]
    delete rows[SHEETS.attendance]
    const { data, errors } = parsePlantRows(rows)

    expect(errors).toEqual([])
    expect(data?.crews).toEqual([])
  })

  it('reads a workbook without records of steps or customer orders', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    delete rows[SHEETS.actuals]
    delete rows[SHEETS.customerOrders]
    const { data, errors } = parsePlantRows(rows)

    expect(errors).toEqual([])
    expect(data?.actuals).toEqual([])
    expect(data?.customerOrders).toEqual([])
  })

  it('refuses a record of a step the lot has not been through', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    const first = rows[SHEETS.actuals].findIndex((row) => row[COLUMNS.actuals.lotId] === 'L1034-2')
    rows[SHEETS.actuals][first][COLUMNS.actuals.step] = 3
    const { errors } = parsePlantRows(rows)

    expect(errors).toContain(`実績の${first + 2}行目：工程番号は、そのLotが通り終えた1〜2にしてください`)
  })

  it('refuses a process in two crews', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    rows[SHEETS.crews][1][COLUMNS.crews.processes] = '切削、溶接'
    const { errors } = parsePlantRows(rows)

    expect(errors).toContain('班の3行目：工程「溶接」は班「板金班」にもあります')
  })

  it('reports every problem with its sheet and row', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    rows[SHEETS.orders][0][COLUMNS.orders.partNumber] = 'Z-999'
    rows[SHEETS.lots][1][COLUMNS.lots.step] = 9
    delete rows[SHEETS.equipment]
    const { data, errors } = parsePlantRows(rows)

    expect(data).toBeNull()
    expect(errors).toContain('シート「設備」がありません')
    expect(errors).toContain('注残の2行目：型番「Z-999」が工程表にありません')
    expect(errors.some((message) => message.startsWith('Lotの3行目'))).toBe(true)
  })

  it('takes the day the stage changed and the postponements from the history when left empty', () => {
    const data = createSampleData('2026-11-03')
    const rows = toPlantRows(data)
    const c = COLUMNS.deals
    rows[SHEETS.deals] = rows[SHEETS.deals].map((row) => ({ ...row, [c.stageChangedOn]: '', [c.postponeCount]: '' }))

    const { data: parsed, errors } = parsePlantRows(rows)

    expect(errors).toEqual([])
    expect(parsed?.deals).toEqual(data.deals)
  })

  it('reads a deal with no part number, so the app can show it as a defect, and refuses what it cannot read', () => {
    const data = createSampleData('2026-11-03')
    const rows = toPlantRows(data)
    const c = COLUMNS.deals
    const h = COLUMNS.dealChanges
    rows[SHEETS.deals][0] = { ...rows[SHEETS.deals][0], [c.partNumber]: '', [c.monthlyQuantity]: 0 }
    const blank = parsePlantRows(rows)
    expect(blank.errors).toEqual([])
    expect(blank.data?.deals?.[0]).toMatchObject({ partNumber: '', monthlyQuantity: 0 })

    rows[SHEETS.deals][1] = { ...rows[SHEETS.deals][1], [c.closeDate]: '来月' }
    rows[SHEETS.dealChanges][0] = { ...rows[SHEETS.dealChanges][0], [h.field]: '金額' }
    rows[SHEETS.dealChanges][1] = { ...rows[SHEETS.dealChanges][1], [h.dealId]: 'S-9999' }

    expect(parsePlantRows(rows).errors).toEqual([
      '商談の履歴の2行目：項目「金額」は使えません',
      '商談の履歴の3行目：商談ID「S-9999」が商談にありません',
      '商談の3行目：受注予定日を日付で入れてください',
    ])
  })
})
