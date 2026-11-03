import { describe, expect, it } from 'vitest'
import { write } from 'xlsx'

import { createSampleData } from '../../sample-data/sample'
import { buildWorkbook, readWorkbook } from './excel'

describe('Excel workbook', () => {
  it('reads back a workbook it wrote', async () => {
    const data = createSampleData('2026-11-03')
    const bytes = write(buildWorkbook(data), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer

    const result = await readWorkbook(new Blob([bytes]))

    expect(result.errors).toEqual([])
    expect(result.data).toEqual(data)
  })

  it('reports a file that is not a workbook', async () => {
    const result = await readWorkbook(new Blob([new Uint8Array([0, 1, 2, 3])]))

    expect(result.data).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
  })
})
