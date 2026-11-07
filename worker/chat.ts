import Anthropic from '@anthropic-ai/sdk'

import { TOOLS } from '../src/assistant/toolSchemas.ts'
import { SYSTEM_PROMPT } from './systemPrompt.ts'

export type ChatEnv = Env & { ANTHROPIC_API_KEY?: string }

// Limits that keep this endpoint from working as a general-purpose Claude relay.
const MAX_BODY_BYTES = 400_000
const MAX_MESSAGES = 80

export async function handleChat(request: Request, env: ChatEnv): Promise<Response> {
  if (request.method !== 'POST') {
    return error(405, 'POST で送ってください')
  }
  // The app sends JSON. A page on another site can only make a visitor's browser post plain text,
  // form data or nothing as the type without asking first, and this endpoint answers no such
  // question, so taking JSON alone keeps other sites from spending the key through visitors.
  if (mediaType(request.headers.get('content-type')) !== 'application/json') {
    return error(415, 'JSON（application/json）で送ってください')
  }
  if (!env.ANTHROPIC_API_KEY) {
    return error(503, 'この環境では相談機能を使えません（ANTHROPIC_API_KEY が設定されていません）')
  }

  const ip = request.headers.get('cf-connecting-ip') ?? 'local'
  const { success } = await env.CHAT_RATE_LIMITER.limit({ key: ip })
  if (!success) {
    return error(429, '相談の回数が多すぎます。1分ほど待ってからもう一度送ってください')
  }

  const body = await request.text()
  if (body.length > MAX_BODY_BYTES) {
    return error(413, '会話が長くなりすぎました。新しい相談を始めてください')
  }

  const messages = parseMessages(body)
  if (!messages) {
    return error(400, '送られてきた会話の形式が正しくありません')
  }

  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  try {
    const message = await client.beta.messages.create({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    })
    return Response.json(message)
  } catch (caught) {
    if (caught instanceof Anthropic.RateLimitError) {
      return error(429, 'Claude が混み合っています。少し待ってからもう一度送ってください')
    }
    if (caught instanceof Anthropic.APIError) {
      console.error('Claude API error', caught.status, caught.message)
      return error(502, `Claude への問い合わせに失敗しました（${caught.status ?? '接続エラー'}）`)
    }
    throw caught
  }
}

// Accepts only user and assistant turns, starting with the user.
function parseMessages(body: string): Anthropic.Beta.BetaMessageParam[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return null
  }
  const messages = (parsed as { messages?: unknown } | null)?.messages
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) return null
  const valid = messages.every(
    (message, index) =>
      typeof message === 'object' &&
      message !== null &&
      (message.role === 'user' || message.role === 'assistant') &&
      (index > 0 || message.role === 'user') &&
      (typeof message.content === 'string' || Array.isArray(message.content)),
  )
  return valid ? (messages as Anthropic.Beta.BetaMessageParam[]) : null
}

// "application/json; charset=utf-8" is still JSON.
function mediaType(contentType: string | null): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

function error(status: number, message: string): Response {
  return Response.json({ error: message }, { status })
}
