import { beforeEach, describe, expect, it, vi } from 'vitest'

import { handleChat, type ChatEnv } from './chat.ts'

const create = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/sdk', () => {
  class APIError extends Error {}
  class RateLimitError extends APIError {}
  return {
    default: class {
      static APIError = APIError
      static RateLimitError = RateLimitError
      beta = { messages: { create } }
    },
  }
})

const limit = vi.fn()
const env = { ANTHROPIC_API_KEY: 'test-key', CHAT_RATE_LIMITER: { limit } } as unknown as ChatEnv

// The history the app sends back after one round of tool use: thinking and tool_use blocks in
// Claude's turn, and the tool's result in the planner's.
const messages = [
  { role: 'user', content: '注番1045の材料が2日遅れると連絡がありました' },
  {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '影響を試算する', signature: 'sig' },
      { type: 'text', text: '試算します。' },
      { type: 'tool_use', id: 'call-1', name: 'simulate_changes', input: { changes: [] } },
    ],
  },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call-1', content: '{}', is_error: false }] },
]

function post(contentType: string): Request {
  return new Request('http://localhost/api/chat', {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: JSON.stringify({ messages }),
  })
}

beforeEach(() => {
  create.mockReset().mockResolvedValue({ content: [{ type: 'text', text: '遅れます。' }], stop_reason: 'end_turn' })
  limit.mockReset().mockResolvedValue({ success: true })
})

describe('handleChat', () => {
  it('passes the app’s JSON conversation on to Claude', async () => {
    const response = await handleChat(post('application/json; charset=utf-8'), env)

    expect(response.status).toBe(200)
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0][0].messages).toEqual(messages)
  })

  // These are the types a page on another site can make a visitor's browser send without a
  // preflight, which this endpoint never answers.
  it.each(['text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x'])(
    'turns away a body sent as %s before it costs anything',
    async (contentType) => {
      const response = await handleChat(post(contentType), env)

      expect(response.status).toBe(415)
      expect(limit).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
    },
  )
})
