// Runs Claude's tools the way the app does, without calling the Claude API, so the
// system prompt and the tool definitions can be tried out by another agent.
//
//   node scripts/assistant-tool.mjs brief
//   node scripts/assistant-tool.mjs call <tool name> '<input JSON>'
//
// `brief` prints the system prompt and the tool definitions the Worker sends.
// `call` runs one tool against the sample data as of today, with nothing adopted,
// and prints only the tool result Claude would receive. The input JSON can also
// come from standard input. The exit code is 1 when the result is an error.
// Set SAKIYOMI_TOOL_LOG to a file path to append each call as one JSON line.
import { appendFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { runnerImport } from 'vite'

const root = fileURLToPath(new URL('..', import.meta.url))

async function load(path) {
  const { module } = await runnerImport(`${root}${path}`, { configFile: false, root, logLevel: 'silent' })
  return module
}

async function brief() {
  const { SYSTEM_PROMPT } = await load('worker/systemPrompt.ts')
  const { TOOLS } = await load('src/assistant/toolSchemas.ts')
  console.log(JSON.stringify({ system: SYSTEM_PROMPT, tools: TOOLS }, null, 2))
}

async function call(name, inputText) {
  const { executeTool } = await load('src/assistant/tools.ts')
  const { createSampleData } = await load('sample-data/sample.ts')
  const { createDefaultSettings } = await load('src/engine/settings.ts')
  const { localToday } = await load('src/engine/dates.ts')

  let input
  try {
    input = JSON.parse(inputText)
  } catch {
    console.log('入力が JSON として読めません')
    return 1
  }
  const today = localToday()
  const state = { data: createSampleData(today), settings: createDefaultSettings(), adopted: [], today }
  const outcome = executeTool(name, input, state)
  console.log(outcome.content)

  const log = process.env.SAKIYOMI_TOOL_LOG
  if (log) {
    const cards = outcome.options?.map(({ title, labels, reason, tradeoff }) => ({ title, labels, reason, tradeoff }))
    const entry = { name, input, isError: outcome.isError, content: outcome.content, event: outcome.event?.labels, cards }
    appendFileSync(log, `${JSON.stringify(entry)}\n`)
  }
  return outcome.isError ? 1 : 0
}

const [command, name, inputArg] = process.argv.slice(2)
if (command === 'brief') {
  await brief()
} else if (command === 'call' && name) {
  process.exitCode = await call(name, inputArg ?? readFileSync(0, 'utf8'))
} else {
  console.log('使い方: node scripts/assistant-tool.mjs brief | call <ツール名> [入力の JSON]')
  process.exitCode = 1
}
