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

  it('plans without people limits when the workbook has no crews', () => {
    const rows = toPlantRows(createSampleData('2026-11-03'))
    delete rows[SHEETS.crews]
    delete rows[SHEETS.attendance]
    const { data, errors } = parsePlantRows(rows)

    expect(errors).toEqual([])
    expect(data?.crews).toEqual([])
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
})
