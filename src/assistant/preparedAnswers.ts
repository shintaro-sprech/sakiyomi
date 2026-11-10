import type Anthropic from '@anthropic-ai/sdk'

import type { IsoDate } from '../engine/types'
import { ChatError, type RequestReply } from './chatClient'
import { RECORDED } from './preparedAnswers.recorded'

type MessageParam = Anthropic.Beta.BetaMessageParam
type Message = Anthropic.Beta.BetaMessage

// One reply of Claude, kept to what the screen shows: its text and the tools it used.
export type RecordedRound = {
  content: ({ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: unknown })[]
  stopReason: string | null
  // Hashes of the tool results the app sent back after this reply, in order.
  resultHashes: string[]
}

export type RecordedAnswers = {
  // The sample is made from this day, and the public sample runs on it.
  recordedOn: IsoDate
  conversations: { prompt: string; rounds: RecordedRound[] }[]
}

// The public sample has no API key. It answers the sample questions with replies Claude
// gave on the day they were recorded, so the app runs on that day (see state/clock.ts).
export const PREPARED_ANSWERS = import.meta.env.VITE_SAKIYOMI_PREPARED_ANSWERS === '1'
export const PREPARED_DAY: IsoDate = RECORDED.recordedOn

export const NOT_PREPARED = '見本では、用意した質問にだけお答えします。「新しい相談」から質問を選んでください'
export const PLAN_CHANGED = '見本の答えは、サンプルの最初の計画に合わせて用意しています。歯車の「設定とデータ」でサンプルに戻すと、また試せます'

// Time between replies, so the steps show one by one as they do with Claude.
const REPLY_DELAY_MS = 900

export function preparedRequest(recorded: RecordedAnswers = RECORDED, delayMs = REPLY_DELAY_MS): RequestReply {
  return async (messages: MessageParam[]): Promise<Message> => {
    const start = lastQuestionIndex(messages)
    const texts = blocksOf(messages[start]).flatMap((block) => (block.type === 'text' ? [block.text] : []))
    // Notes from button presses mean the plan has moved since the replies were recorded.
    if (texts.length !== 1) throw new ChatError(PLAN_CHANGED)
    const conversation = recorded.conversations.find((item) => item.prompt === texts[0])
    if (!conversation) throw new ChatError(NOT_PREPARED)

    const round = messages.slice(start).filter((message) => message.role === 'assistant').length
    if (round > 0 && !sameHashes(resultHashes(messages[messages.length - 1]), conversation.rounds[round - 1].resultHashes)) {
      throw new ChatError(PLAN_CHANGED)
    }
    const reply = conversation.rounds[round]
    if (!reply) throw new ChatError(PLAN_CHANGED)
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    return { content: reply.content, stop_reason: reply.stopReason } as Message
  }
}

// The last message from the planner that is not only tool results.
function lastQuestionIndex(messages: MessageParam[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role === 'user' && blocksOf(message).some((block) => block.type === 'text')) return index
  }
  throw new ChatError(NOT_PREPARED)
}

// A message's content as blocks; plain text counts as one text block.
function blocksOf(message: MessageParam): Exclude<NonNullable<MessageParam['content']>, string> {
  const content = message.content ?? []
  return typeof content === 'string' ? [{ type: 'text', text: content }] : content
}

export function resultHashes(message: MessageParam): string[] {
  if (message.role !== 'user') return []
  return blocksOf(message).flatMap((block) => {
    if (block.type !== 'tool_result') return []
    const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? '')
    return [hashText(content)]
  })
}

function sameHashes(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((hash, index) => hash === expected[index])
}

// A short hash (cyrb53) to tell whether a tool gave the same result as when recorded.
export function hashText(text: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
