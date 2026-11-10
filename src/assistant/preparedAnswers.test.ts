import type Anthropic from '@anthropic-ai/sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSampleData } from '../../sample-data/sample'
import type { PlanState } from '../engine/plan'
import { createSampleSettings } from '../engine/settings'
import { converse } from './chatClient'
import { NOT_PREPARED, PLAN_CHANGED, preparedRequest } from './preparedAnswers'
import { RECORDED } from './preparedAnswers.recorded'
import { samplePrompts } from './samplePrompts'

type MessageParam = Anthropic.Beta.BetaMessageParam

const events = { onHistory: () => {}, onOptions: () => {} }

function freshSample(): PlanState {
  const today = RECORDED.recordedOn
  return { data: createSampleData(today), settings: createSampleSettings(), adopted: [], today }
}

function ask(prompt: string): MessageParam[] {
  return [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
}

describe('prepared answers', () => {
  // Another month, so nothing the replay depends on may read the real date.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2027-03-03T10:00:00'))
  })
  afterEach(() => vi.useRealTimers())

  it('has an answer for every sample question on the day they were recorded', () => {
    const prompts = samplePrompts(freshSample())
    expect(RECORDED.conversations.map((item) => item.prompt)).toEqual(prompts)
  })

  it('replays each answer on a fresh sample with the same tool results as when recorded', async () => {
    for (const conversation of RECORDED.conversations) {
      const state = freshSample()
      const { history, stopReason } = await converse(ask(conversation.prompt), () => state, events, preparedRequest(RECORDED, 0))
      expect(history.filter((message) => message.role === 'assistant')).toHaveLength(conversation.rounds.length)
      expect(stopReason).toBe(conversation.rounds[conversation.rounds.length - 1].stopReason)
    }
  })

  it('stops with a note when the plan has changed since the answers were recorded', async () => {
    const conversation = RECORDED.conversations.find((item) => item.rounds.length > 1)
    expect(conversation).toBeDefined()
    const state = freshSample()
    const [first, ...rest] = state.data.orders
    const changed: PlanState = { ...state, data: { ...state.data, orders: [{ ...first, quantity: first.quantity * 3 }, ...rest] } }
    await expect(converse(ask(conversation!.prompt), () => changed, events, preparedRequest(RECORDED, 0))).rejects.toThrow(PLAN_CHANGED)
  })

  it('answers only the prepared questions', async () => {
    const state = freshSample()
    await expect(converse(ask('来週いちばん混む設備はどれ？'), () => state, events, preparedRequest(RECORDED, 0))).rejects.toThrow(
      NOT_PREPARED,
    )
  })
})
