import type Anthropic from '@anthropic-ai/sdk'
import { Fragment, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

import { ChatError, converse } from '../assistant/chatClient'
import { TOOL_NAMES } from '../assistant/toolSchemas'
import { changesToApply, type ProposedOption, type ReportedEvent } from '../assistant/tools'
import type { PlanState } from '../engine/plan'
import { describeChange, parseChange } from '../engine/scenario'
import type { PlantData } from '../engine/types'
import type { Decision } from '../state/store'
import { EffectSummary, OptionCard } from './OptionCard'
import { RichText } from './RichText'

type MessageParam = Anthropic.Beta.BetaMessageParam

type Props = {
  planState: PlanState
  sampleData: boolean
  previewing: ProposedOption | null
  onPreview: (option: ProposedOption | null) => void
  onAdopt: (decision: Omit<Decision, 'id' | 'at'>) => void
}

const SAMPLE_PROMPTS = [
  '注番1045の材料が2日遅れると連絡がありました',
  '注番1022を30個に増やせますか？',
  '溶接ロボ1が明日1日止まります',
  '今いちばん危ない注番はどれ？',
]

const GENERAL_PROMPTS = ['今いちばん危ない注番はどれ？', '来週いちばん混む設備はどれ？']

export function ChatPanel({ planState, sampleData, previewing, onPreview, onAdopt }: Props) {
  const [history, setHistory] = useState<MessageParam[]>([])
  const [options, setOptions] = useState<Record<string, ProposedOption[]>>({})
  const [adoptedKeys, setAdoptedKeys] = useState<string[]>([])
  const [pendingNotes, setPendingNotes] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stateRef = useRef(planState)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    stateRef.current = planState
  }, [planState])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [history, busy])

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy) return
    const content: Anthropic.Beta.BetaTextBlockParam[] = [
      ...pendingNotes.map((note) => ({ type: 'text' as const, text: `［画面での操作］${note}` })),
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
    } catch (caught) {
      setError(caught instanceof ChatError ? caught.message : '相談の途中でエラーが起きました。もう一度送ってください')
    } finally {
      setBusy(false)
    }
  }

  function adopt(key: string, option: ProposedOption, note: string) {
    onAdopt({
      title: option.title,
      ...changesToApply(option, planState.adopted),
      reason: option.reason,
      tradeoff: option.tradeoff,
      note,
    })
    setAdoptedKeys((current) => [...current, key])
    setPendingNotes((current) => [...current, `案「${option.title}」を計画に反映しました。${note ? `理由: ${note}` : ''}`])
    if (previewing === option) onPreview(null)
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
    setAdoptedKeys([])
    setPendingNotes([])
    setError(null)
  }

  const prompts = sampleData ? SAMPLE_PROMPTS : GENERAL_PROMPTS

  return (
    <aside className="chat" aria-label="Claude に相談">
      <header className="chat-header">
        <h2>Claude に相談</h2>
        {history.length > 0 && (
          <button className="ghost" onClick={reset} disabled={busy}>
            新しい相談
          </button>
        )}
      </header>

      <div className="chat-log">
        {history.length === 0 && (
          <div className="chat-empty">
            <p>材料の遅れ、数量の変更、設備の停止などを話しかけてください。出荷日への影響を試算して、組み替え案を出します。</p>
            <div className="prompt-list">
              {prompts.map((prompt) => (
                <button key={prompt} onClick={() => void send(prompt)} disabled={busy}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {history.map((message, index) => (
          <Fragment key={index}>
            {renderMessage(message, planState.data, (block) => {
              const proposed = options[block.id] ?? []
              // The options of one proposal are alternatives: once one is adopted, the rest close.
              const decided = adoptedKeys.some((key) => key.startsWith(`${block.id}:`))
              return (
                <>
                  {proposed[0] && <EventSummary event={proposed[0].event} />}
                  {proposed.map((option, optionIndex) => {
                    const key = `${block.id}:${optionIndex}`
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
                </>
              )
            })}
          </Fragment>
        ))}

        {busy && <p className="chat-busy">考えています…</p>}
        {error && <p className="chat-error">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="chat-input"
        onSubmit={(event) => {
          event.preventDefault()
          void send(input)
        }}
      >
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="例：注番1045の材料が2日遅れる"
          rows={2}
          disabled={busy}
        />
        <button className="primary" type="submit" disabled={busy || !input.trim()}>
          送信
        </button>
      </form>
    </aside>
  )
}

function EventSummary({ event }: { event: ReportedEvent }) {
  if (event.changes.length === 0) return null
  return (
    <section className="event-box">
      <h4>聞いた出来事</h4>
      <ul className="option-changes">
        {event.labels.map((label) => (
          <li key={label}>{label}</li>
        ))}
      </ul>
      <p className="event-caption">何もしないと</p>
      <EffectSummary comparison={event.comparison} />
    </section>
  )
}

function renderMessage(
  message: MessageParam,
  data: PlantData,
  renderOptions: (block: Anthropic.Beta.BetaToolUseBlock) => ReactNode,
) {
  if (!message.content) return null
  if (typeof message.content === 'string') {
    return <div className={`bubble bubble-${message.role}`}>{message.content}</div>
  }

  if (message.role === 'user') {
    const texts = message.content.flatMap((block) =>
      block.type === 'text' && !block.text.startsWith('［画面での操作］') ? [block.text] : [],
    )
    return texts.length > 0 ? <div className="bubble bubble-user">{texts.join('\n')}</div> : null
  }

  return message.content.map((block, index) => {
    if (block.type === 'text' && block.text.trim()) {
      return (
        <div key={index} className="bubble bubble-assistant">
          <RichText text={block.text} />
        </div>
      )
    }
    if (block.type === 'tool_use') {
      return (
        <Fragment key={index}>
          <p className="chat-activity">{describeToolUse(block, data)}</p>
          {block.name === TOOL_NAMES.presentOptions && <div className="option-list">{renderOptions(block)}</div>}
        </Fragment>
      )
    }
    return null
  })
}

function describeToolUse(block: Anthropic.Beta.BetaToolUseBlock, data: PlantData): string {
  const input = block.input as Record<string, unknown>
  switch (block.name) {
    case TOOL_NAMES.getSituation:
      return '今の計画を確認しました'
    case TOOL_NAMES.getOrderPlan:
      return `注番${String(input.orderId)}の加工予定を確認しました`
    case TOOL_NAMES.simulateChanges:
      return `試算：${labelChanges(input.changes, data)}`
    case TOOL_NAMES.presentOptions:
      return '案を出しました'
    default:
      return block.name
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
