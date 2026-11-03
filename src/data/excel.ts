import { read, utils, writeFile, type WorkBook } from 'xlsx'

import type { PlantData } from '../engine/types'
import { COLUMNS, parsePlantRows, SHEETS, toPlantRows, type SheetRows } from './plantRows'

export function buildWorkbook(data: PlantData): WorkBook {
  const rows = toPlantRows(data)
  const book = utils.book_new()
  // Headers go in even when a sheet has no rows, so a planner sees what to fill in.
  for (const [key, sheet] of Object.entries(SHEETS)) {
    const header = Object.values(COLUMNS[key as keyof typeof COLUMNS])
    utils.book_append_sheet(book, utils.json_to_sheet(rows[sheet], { header }), sheet)
  }
  return book
}

export function downloadWorkbook(data: PlantData, fileName: string): void {
  writeFile(buildWorkbook(data), fileName)
}

export async function readWorkbook(file: Blob): Promise<{ data: PlantData | null; errors: string[] }> {
  try {
    const book = read(await file.arrayBuffer(), { cellDates: true })
    const sheets: SheetRows = {}
    for (const name of book.SheetNames) {
      sheets[name] = utils.sheet_to_json(book.Sheets[name], { defval: '' })
    }
    return parsePlantRows(sheets)
  } catch {
    return { data: null, errors: ['Excel ファイルとして読めませんでした'] }
  }
}
