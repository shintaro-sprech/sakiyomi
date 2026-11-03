import type Anthropic from '@anthropic-ai/sdk'

import type { PlanState } from '../engine/plan'
import { executeTool, type ProposedOption } from './tools'

type MessageParam = Anthropic.Beta.BetaMessageParam
type Message = Anthropic.Beta.BetaMessage

// Rounds of tool use allowed for one message from the planner.
const MAX_ROUNDS = 12

export class ChatError extends Error {}

export type ChatEvents = {
  // Called with the whole history each time it grows.
  onHistory: (history: MessageParam[]) => void
  onOptions: (toolUseId: string, options: ProposedOption[]) => void
}

async function requestReply(messages: MessageParam[]): Promise<Message> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages }),
  })
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null
    throw new ChatError(body?.error ?? `相談に失敗しました（${response.status}）`)
  }
  return (await response.json()) as Message
}

// Sends the history to Claude and runs the tools it asks for until it answers.
// The history is only ever appended to, so thinking blocks stay valid.
export async function converse(
  history: MessageParam[],
  getState: () => PlanState,
  events: ChatEvents,
): Promise<{ history: MessageParam[]; stopReason: string | null }> {
  let current = history
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const reply = await requestReply(current)
    current = [...current, { role: 'assistant', content: reply.content }]
    events.onHistory(current)

    if (reply.stop_reason !== 'tool_use') {
      return { history: current, stopReason: reply.stop_reason }
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = []
    for (const block of reply.content) {
      if (block.type !== 'tool_use') continue
      const outcome = executeTool(block.name, block.input, getState())
      if (outcome.options) events.onOptions(block.id, outcome.options)
      results.push({ type: 'tool_result', tool_use_id: block.id, content: outcome.content, is_error: outcome.isError })
    }
    current = [...current, { role: 'user', content: results }]
    events.onHistory(current)
  }
  throw new ChatError('やり取りが長くなりすぎたので止めました。質問を分けて送ってください')
}
