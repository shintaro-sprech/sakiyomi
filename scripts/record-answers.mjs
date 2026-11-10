// Records Claude's replies to the sample questions for the public sample, which has no API key.
//
//   node scripts/record-answers.mjs
//
// Reads ANTHROPIC_API_KEY from .dev.vars, asks each sample question the way the app does on a
// fresh sample through the same Worker code, and writes src/assistant/preparedAnswers.recorded.ts.
// The sample is made from today, and the public sample then runs on today's date, so run it
// on the day the public sample should show. Each question calls the Claude API several times.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { runnerImport } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))

async function load(path) {
  const { module } = await runnerImport(`${root}${path}`, { configFile: false, root, logLevel: 'silent' })
  return module
}

function readKey() {
  const vars = readFileSync(`${root}.dev.vars`, 'utf8')
  const line = vars.split('\n').find((item) => item.startsWith('ANTHROPIC_API_KEY='))
  const key = line?.slice('ANTHROPIC_API_KEY='.length).trim().replace(/^"|"$/g, '')
  if (!key) throw new Error('.dev.vars に ANTHROPIC_API_KEY がありません')
  return key
}

// Only what the screen shows: text, and the tools Claude used.
function keep(content) {
  return content.flatMap((block) => {
    if (block.type === 'text') return [{ type: 'text', text: block.text }]
    if (block.type === 'tool_use') return [{ type: 'tool_use', id: block.id, name: block.name, input: block.input }]
    return []
  })
}

const { converse } = await load('src/assistant/chatClient.ts')
const { resultHashes } = await load('src/assistant/preparedAnswers.ts')
const { samplePrompts } = await load('src/assistant/samplePrompts.ts')
const { createSampleData } = await load('sample-data/sample.ts')
const { createSampleSettings } = await load('src/engine/settings.ts')
const { localToday } = await load('src/engine/dates.ts')
const { handleChat } = await load('worker/chat.ts')

const env = { ANTHROPIC_API_KEY: readKey(), CHAT_RATE_LIMITER: { limit: async () => ({ success: true }) } }
const today = localToday()
// The app starts the sample with these settings and nothing adopted.
const state = { data: createSampleData(today), settings: createSampleSettings(), adopted: [], today }

const conversations = []
for (const prompt of samplePrompts(state)) {
  const rounds = []
  const request = async (messages) => {
    if (rounds.length > 0) rounds[rounds.length - 1].resultHashes = resultHashes(messages[messages.length - 1])
    const response = await handleChat(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages }),
      }),
      env,
    )
    const reply = await response.json()
    if (!response.ok) throw new Error(reply.error ?? `Claude への問い合わせに失敗しました（${response.status}）`)
    rounds.push({ content: keep(reply.content), stopReason: reply.stop_reason, resultHashes: [] })
    return reply
  }
  const history = [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  const { stopReason } = await converse(history, () => state, { onHistory: () => {}, onOptions: () => {} }, request)
  console.log(`${prompt}：${rounds.length}回（${stopReason}）`)
  conversations.push({ prompt, rounds })
}

const body = JSON.stringify({ recordedOn: today, conversations }, null, 2)
writeFileSync(
  `${root}src/assistant/preparedAnswers.recorded.ts`,
  `// Written by \`node scripts/record-answers.mjs\`. Do not edit by hand.\nimport type { RecordedAnswers } from './preparedAnswers'\n\nexport const RECORDED: RecordedAnswers = ${body}\n`,
)
console.log(`src/assistant/preparedAnswers.recorded.ts に ${conversations.length} 問を書きました（${today}）`)
