import { Badge, Button, Card, Group, List, Stack, Text, Textarea } from '@mantine/core'
import { IconCheck, IconEye, IconEyeOff } from '@tabler/icons-react'
import { useEffect, useRef, useState } from 'react'

import type { ProposedOption } from '../assistant/tools'
import type { ScheduleComparison } from '../engine/compare'
import { shortDate } from './format'

type Props = {
  option: ProposedOption
  // closed: another option of the same proposal is in the plan.
  state: 'open' | 'adopted' | 'closed'
  previewing: boolean
  onPreview: () => void
  onAdopt: (note: string) => void
}

export function OptionCard({ option, state, previewing, onPreview, onAdopt }: Props) {
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const adoptedHere = useRef(false)

  // Keep keyboard focus on the card as its controls change (WCAG 2.4.3).
  useEffect(() => {
    if (noting) noteRef.current?.focus()
  }, [noting])

  useEffect(() => {
    if (state === 'adopted' && adoptedHere.current) resultRef.current?.focus()
  }, [state])

  function adopt() {
    adoptedHere.current = true
    setNoting(false)
    onAdopt(note.trim())
  }

  return (
    <Card
      withBorder
      padding="sm"
      className="option-card"
      data-previewing={previewing || undefined}
      data-closed={state === 'closed' || undefined}
    >
      <Stack gap={8}>
        <Text fw={700}>{option.title}</Text>
        {option.labels.length > 0 && (
          <List size="sm" spacing={2}>
            {option.labels.map((label) => (
              <List.Item key={label}>{label}</List.Item>
            ))}
          </List>
        )}
        <EffectSummary comparison={option.comparison} />
        <dl className="option-notes">
          <dt>理由</dt>
          <dd>{option.reason}</dd>
          <dt>代わりに</dt>
          <dd>{option.tradeoff}</dd>
        </dl>
        {state === 'adopted' ? (
          <div ref={resultRef} tabIndex={-1}>
            <Badge color="teal" variant="outline" size="lg" radius="sm" leftSection={<IconCheck size={14} />}>
              反映済み
            </Badge>
          </div>
        ) : state === 'closed' ? null : noting ? (
          <Stack gap={6}>
            <Textarea
              ref={noteRef}
              label="選んだ理由（任意）"
              value={note}
              onChange={(event) => setNote(event.currentTarget.value)}
              autosize
              minRows={2}
            />
            <Group gap={8}>
              <Button size="xs" onClick={adopt}>
                反映する
              </Button>
              <Button size="xs" variant="default" onClick={() => setNoting(false)}>
                戻る
              </Button>
            </Group>
          </Stack>
        ) : (
          <Group gap={8}>
            <Button
              size="xs"
              variant="default"
              leftSection={previewing ? <IconEyeOff size={14} /> : <IconEye size={14} />}
              onClick={onPreview}
              aria-pressed={previewing}
            >
              {previewing ? '表示をやめる' : '案を見る'}
            </Button>
            <Button size="xs" onClick={() => setNoting(true)}>
              計画に反映する
            </Button>
          </Group>
        )}
      </Stack>
    </Card>
  )
}

export function EffectSummary({ comparison }: { comparison: ScheduleComparison }) {
  return (
    <Stack gap={4}>
      <Badge
        variant="outline"
        color={comparison.lateAfter > 0 ? 'red' : 'teal'}
        size="lg"
        radius="sm"
        w="fit-content"
        className="tabular"
      >
        遅れ {comparison.lateBefore} → {comparison.lateAfter}件
      </Badge>
      {comparison.shifted.map((shift) => (
        <Text
          key={shift.orderId}
          size="sm"
          c={shift.lateAfter ? 'red' : shift.lateBefore ? 'teal' : undefined}
          fw={shift.lateAfter !== shift.lateBefore ? 700 : undefined}
          className="tabular"
        >
          注番{shift.orderId}　{shortDate(shift.before)} → {shortDate(shift.after)}（納期 {shortDate(shift.due)}）
        </Text>
      ))}
    </Stack>
  )
}
