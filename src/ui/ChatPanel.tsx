import type Anthropic from '@anthropic-ai/sdk'
import { ActionIcon, Alert, Button, Group, Paper, ScrollArea, Stack, Text, Textarea, Title } from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import { IconCalculator, IconListSearch, IconPlus, IconRoute, IconSend, IconStack2 } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { ChatError, converse } from '../assistant/chatClient'
import { TOOL_NAMES } from '../assistant/toolSchemas'
import { changesToApply, type ProposedOption, type ReportedEvent } from '../assistant/tools'
import { addDays, weekday } from '../engine/dates'
import type { PlanState } from '../engine/plan'
import { describeChange, parseChange } from '../engine/scenario'
import type { PlantData } from '../engine/types'
import type { Decision } from '../state/store'
import { Mascot, type MascotState } from './Mascot'
import { EffectSummary, OptionCard } from './OptionCard'
import { RichText } from './RichText'

type MessageParam = Anthropic.Beta.BetaMessageParam
type ToolUse = Anthropic.Beta.BetaToolUseBlock

type Props = {
  planState: PlanState
  sampleData: boolean
  decisions: Decision[]
  previewing: ProposedOption | null
  onPreview: (option: ProposedOption | null) => void
  // Returns why the option cannot go into the plan, or null once it is in.
  onAdopt: (decision: Omit<Decision, 'id' | 'at'>) => string | null
}

const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

// The machine stops on the next working day, so the example moves the plan whichever day
// the app is opened: tomorrow, or on Friday and Saturday the coming Monday.
function samplePrompts({ today, settings }: PlanState): string[] {
  const tomorrow = addDays(today, 1)
  let stopOn = tomorrow
  for (let step = 0; step < 7 && !settings.workWeekdays.includes(weekday(stopOn)); step += 1) stopOn = addDays(stopOn, 1)
  const when = stopOn === tomorrow ? '明日' : `${WEEKDAY_NAMES[weekday(stopOn)]}曜に`
  return [
    '注番1045の材料が2日遅れると連絡がありました',
    '旋回フレームの部品の商談が取れたら、納期に間に合いますか？',
    `マシニング1が${when}1日止まります`,
    '今いちばん危ない注番はどれ？',
  ]
}
const GENERAL_PROMPTS = ['今いちばん危ない注番はどれ？', '来週いちばん混む設備はどれ？']

// Marks text the app adds to the planner's next message after a button press.
const SCREEN_NOTE = '［画面での操作］'
const SPEAKING_MS = 1600

export function ChatPanel({ planState, sampleData, decisions, previewing, onPreview, onAdopt }: Props) {
  const [history, setHistory] = useState<MessageParam[]>([])
  const [options, setOptions] = useState<Record<string, ProposedOption[]>>({})
  // Cards follow the decision log, so undoing a decision reopens its proposal.
  const adoptedKeys = decisions.flatMap((decision) => (decision.sourceKey ? [decision.sourceKey] : []))
  const reduceMotion = useReducedMotion()
  const [pendingNotes, setPendingNotes] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stateRef = useRef(planState)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    stateRef.current = planState
  }, [planState])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [history, busy, reduceMotion])

  useEffect(() => {
    if (!speaking) return
    const timer = window.setTimeout(() => setSpeaking(false), SPEAKING_MS)
    return () => window.clearTimeout(timer)
  }, [speaking])

  const turns = useMemo(() => buildTurns(history), [history])
  const activity = busy ? latestActivity(history, planState.data) : null
  const mascotState: MascotState = busy ? 'thinking' : speaking ? 'speaking' : 'idle'

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy) return
    const content: Anthropic.Beta.BetaTextBlockParam[] = [
      ...pendingNotes.map((note) => ({ type: 'text' as const, text: `${SCREEN_NOTE}${note}` })),
      { type: 'text', text: message },
    ]
    const next: MessageParam[] = [...history, { role: 'user', content }]
    setHistory(next)
    setPendingNotes([])
    setInput('')
    setError(null)
    setBusy(true)
    try {
      await converse(next, () => stateRef.current, {
        onHistory: setHistory,
        onOptions: (id, proposed) => setOptions((current) => ({ ...current, [id]: proposed })),
      })
      setSpeaking(true)
    } catch (caught) {
      setError(caught instanceof ChatError ? caught.message : '相談の途中でエラーが起きました。もう一度送ってください')
    } finally {
      setBusy(false)
    }
  }

  function adopt(key: string, option: ProposedOption, note: string): string | null {
    const refused = onAdopt({
      title: option.title,
      ...changesToApply(option, planState.adopted),
      reason: option.reason,
      tradeoff: option.tradeoff,
      note,
      sourceKey: key,
    })
    if (refused) return refused
    setPendingNotes((current) => [...current, `案「${option.title}」を計画に反映しました。${note ? `理由: ${note}` : ''}`])
    if (previewing === option) onPreview(null)
    return null
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void send(input)
    }
  }

  function reset() {
    setHistory([])
    setOptions({})
    setPendingNotes([])
    setError(null)
  }

  function renderOptions(toolUseId: string) {
    const proposed = options[toolUseId] ?? []
    // The options of one proposal are alternatives: once one is adopted, the rest close.
    const decided = adoptedKeys.some((key) => key.startsWith(`${toolUseId}:`))
    return (
      <Stack gap={8}>
        {proposed[0] && <EventSummary event={proposed[0].event} />}
        {proposed.map((option, index) => {
          const key = `${toolUseId}:${index}`
          return (
            <OptionCard
              key={key}
              option={option}
              state={adoptedKeys.includes(key) ? 'adopted' : decided ? 'closed' : 'open'}
              previewing={previewing === option}
              onPreview={() => onPreview(previewing === option ? null : option)}
              onAdopt={(note) => adopt(key, option, note)}
            />
          )
        })}
      </Stack>
    )
  }

  const empty = history.length === 0

  return (
    <div className="chat">
      <Group className="chat-header" justify="space-between" wrap="nowrap">
        <Group gap={8} wrap="nowrap">
          {!empty && <Mascot state={mascotState} size={36} />}
          <Title order={2} size="h5">
            Claude に相談
          </Title>
        </Group>
        {!empty && (
          <Button variant="subtle" size="xs" leftSection={<IconPlus size={14} />} onClick={reset} disabled={busy}>
            新しい相談
          </Button>
        )}
      </Group>

      <ScrollArea className="chat-log" type="auto" scrollbarSize={6}>
        {empty ? (
          <Stack className="chat-welcome" align="center" gap="md">
            <Mascot state={mascotState} size={96} />
            <div className="speech speech-center">何がありましたか？</div>
            <Stack gap={6} w="100%">
              {(sampleData ? samplePrompts(planState) : GENERAL_PROMPTS).map((prompt) => (
                <Button
                  key={prompt}
                  variant="default"
                  justify="flex-start"
                  fullWidth
                  onClick={() => void send(prompt)}
                  disabled={busy}
                  styles={{ label: { whiteSpace: 'normal', textAlign: 'left' } }}
                  h="auto"
                  py={8}
                >
                  {prompt}
                </Button>
              ))}
            </Stack>
          </Stack>
        ) : (
          <Stack gap="sm" p="sm" role="log" aria-live="polite" aria-label="相談のやり取り">
            {turns.map((turn, index) => (
              <Stack key={index} gap={8}>
                {turn.userText && <div className="bubble bubble-user">{turn.userText}</div>}
                {turn.trail.length > 0 && <Trail uses={turn.trail} data={planState.data} />}
                {turn.items.map((item, itemIndex) =>
                  item.kind === 'text' ? (
                    <AssistantBubble key={itemIndex}>
                      <RichText text={item.text} />
                    </AssistantBubble>
                  ) : (
                    <div key={itemIndex}>{renderOptions(item.toolUseId)}</div>
                  ),
                )}
              </Stack>
            ))}
            {busy && (
              <AssistantBubble>
                <span className="typing" role="status" aria-label={activity ?? '考えています'}>
                  <span />
                  <span />
                  <span />
                </span>
              </AssistantBubble>
            )}
            {error && (
              <Alert color="red" variant="light">
                {error}
              </Alert>
            )}
            <div ref={endRef} />
          </Stack>
        )}
      </ScrollArea>

      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault()
          void send(input)
        }}
      >
        <Textarea
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          onKeyDown={onKeyDown}
          placeholder="例：注番1045の材料が2日遅れる"
          autosize
          minRows={1}
          maxRows={5}
          disabled={busy}
          aria-label="Claude への相談"
          style={{ flex: 1 }}
        />
        <ActionIcon type="submit" size="lg" disabled={busy || !input.trim()} aria-label="送信">
          <IconSend size={18} />
        </ActionIcon>
      </form>
    </div>
  )
}

function AssistantBubble({ children }: { children: ReactNode }) {
  return (
    <Group gap={6} align="flex-start" wrap="nowrap">
      <Mascot state="idle" size={28} still />
      <div className="bubble bubble-assistant">{children}</div>
    </Group>
  )
}

function EventSummary({ event }: { event: ReportedEvent }) {
  if (event.changes.length === 0) return null
  return (
    <Paper className="event-box" p="sm" radius="md">
      <Stack gap={6}>
        <Text fw={700} size="sm">
          {event.labels.join('、')}
        </Text>
        <Text size="xs" c="dimmed">
          対策をしないと
        </Text>
        <EffectSummary effect={event.effect} />
      </Stack>
    </Paper>
  )
}

function Trail({ uses, data }: { uses: ToolUse[]; data: PlantData }) {
  return (
    <ul className="trail" aria-label="Claude が使った道具">
      {uses.map((use) => {
        const { icon, label } = describeToolUse(use, data)
        return (
          <li key={use.id} title={label}>
            {icon}
            <span>{label}</span>
          </li>
        )
      })}
    </ul>
  )
}

type Turn = {
  userText: string | null
  trail: ToolUse[]
  items: ({ kind: 'text'; text: string } | { kind: 'options'; toolUseId: string })[]
}

// Groups the API history into what the planner sees: their message, the tools Claude
// used in between, and Claude's replies and option cards in order.
function buildTurns(history: MessageParam[]): Turn[] {
  const turns: Turn[] = []
  for (const message of history) {
    const blocks = typeof message.content === 'string' ? [{ type: 'text' as const, text: message.content }] : (message.content ?? [])
    if (message.role === 'user') {
      const texts = blocks.flatMap((block) =>
        block.type === 'text' && !block.text.startsWith(SCREEN_NOTE) ? [block.text] : [],
      )
      if (texts.length > 0) turns.push({ userText: texts.join('\n'), trail: [], items: [] })
      continue
    }
    if (turns.length === 0) turns.push({ userText: null, trail: [], items: [] })
    const turn = turns[turns.length - 1]
    for (const block of blocks) {
      if (block.type === 'text' && block.text.trim()) turn.items.push({ kind: 'text', text: block.text })
      if (block.type === 'tool_use') {
        turn.trail.push(block as ToolUse)
        if (block.name === TOOL_NAMES.presentOptions) turn.items.push({ kind: 'options', toolUseId: block.id })
      }
    }
  }
  return turns
}

function latestActivity(history: MessageParam[], data: PlantData): string | null {
  const last = history[history.length - 1]
  if (!last || last.role !== 'user' || typeof last.content === 'string') return null
  const previous = history[history.length - 2]
  if (!previous || previous.role !== 'assistant' || typeof previous.content === 'string') return null
  const uses = (previous.content ?? []).filter((block) => block.type === 'tool_use') as ToolUse[]
  return uses.length > 0 ? describeToolUse(uses[uses.length - 1], data).label : null
}

function describeToolUse(use: ToolUse, data: PlantData): { icon: ReactNode; label: string } {
  const input = use.input as Record<string, unknown>
  switch (use.name) {
    case TOOL_NAMES.getSituation:
      return { icon: <IconListSearch size={13} />, label: '計画を確認' }
    case TOOL_NAMES.getOrderPlan:
      return {
        icon: <IconRoute size={13} />,
        label: Array.isArray(input.changes) && input.changes.length > 0
          ? `注番${String(input.orderId)}の予定：${labelChanges(input.changes, data)}`
          : `注番${String(input.orderId)}の予定`,
      }
    case TOOL_NAMES.simulateChanges:
      return { icon: <IconCalculator size={13} />, label: `試算：${labelChanges(input.changes, data)}` }
    case TOOL_NAMES.presentOptions:
      return { icon: <IconStack2 size={13} />, label: '案を表示' }
    default:
      return { icon: null, label: use.name }
  }
}

function labelChanges(changes: unknown, data: PlantData): string {
  if (!Array.isArray(changes)) return '変更'
  return changes
    .map((change) => {
      try {
        return describeChange(parseChange(change), data)
      } catch {
        return '（読み取れない変更）'
      }
    })
    .join('、')
}
