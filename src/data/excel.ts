import { read, utils, writeFile, type WorkBook } from 'xlsx'

import type { PlantData } from '../engine/types'
import { parsePlantRows, SHEETS, toPlantRows, type SheetRows } from './plantRows'

export function buildWorkbook(data: PlantData): WorkBook {
  const rows = toPlantRows(data)
  const book = utils.book_new()
  for (const sheet of Object.values(SHEETS)) {
    utils.book_append_sheet(book, utils.json_to_sheet(rows[sheet]), sheet)
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
