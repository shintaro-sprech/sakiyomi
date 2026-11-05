import { afterEach, describe, expect, it, vi } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import type { PlanState } from '../engine/plan'
import { createSampleSettings } from '../engine/settings'
import { ChatError, converse } from './chatClient'

const today = '2026-11-03'
const state: PlanState = { data: createSampleData(today), settings: createSampleSettings(), adopted: [], today }

function reply(content: unknown[], stopReason: string) {
  return new Response(JSON.stringify({ content, stop_reason: stopReason }), { status: 200 })
}

afterEach(() => vi.unstubAllGlobals())

describe('converse', () => {
  it('runs the tools Claude asks for and sends the results back', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        reply(
          [
            {
              type: 'tool_use',
              id: 'call-1',
              name: 'simulate_changes',
              input: { changes: [{ kind: 'materialDelay', orderId: '1045', days: 2 }] },
            },
          ],
          'tool_use',
        ),
      )
      .mockResolvedValueOnce(reply([{ type: 'text', text: '注番1045が納期に遅れます。' }], 'end_turn'))
    vi.stubGlobal('fetch', fetchMock)
    const onHistory = vi.fn()

    const { history, stopReason } = await converse([{ role: 'user', content: '材料が遅れる' }], () => state, {
      onHistory,
      onOptions: vi.fn(),
    })

    expect(stopReason).toBe('end_turn')
    expect(history.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    const sent = JSON.parse(fetchMock.mock.calls[1][1].body).messages
    const toolResult = sent[2].content[0]
    expect(toolResult).toMatchObject({ type: 'tool_result', tool_use_id: 'call-1', is_error: false })
    expect(JSON.parse(toolResult.content).newlyLate).toEqual(['1045'])
  })

  it('hands the options from present_options to the screen', async () => {
    const options = [
      {
        title: '1045を優先する',
        changes: [{ kind: 'expedite', orderId: '1045' }],
        reason: '切削が詰まっている',
        tradeoff: 'ほかの注番が後ろにずれる',
      },
    ]
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(reply([{ type: 'tool_use', id: 'call-2', name: 'present_options', input: { event: [], options } }], 'tool_use'))
        .mockResolvedValueOnce(reply([{ type: 'text', text: '案を出しました。' }], 'end_turn')),
    )
    const onOptions = vi.fn()

    await converse([{ role: 'user', content: '案を出して' }], () => state, { onHistory: vi.fn(), onOptions })

    expect(onOptions).toHaveBeenCalledWith('call-2', [expect.objectContaining({ title: '1045を優先する' })])
  })

  it('shows the error the server sent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: '鍵がありません' }), { status: 503 })),
    )

    await expect(
      converse([{ role: 'user', content: 'こんにちは' }], () => state, { onHistory: vi.fn(), onOptions: vi.fn() }),
    ).rejects.toThrow(new ChatError('鍵がありません'))
  })
})
