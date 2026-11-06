import { Alert, Button, Card, Group, List, Stack, Text, Title } from '@mantine/core'
import { IconArrowBackUp } from '@tabler/icons-react'
import { useRef, useState } from 'react'

import type { Decision } from '../state/store'
import { shortDateTime } from './format'

type Props = {
  decisions: Decision[]
  // Returns the later decisions that keep this one, or null once it is undone.
  onRemove: (id: string) => string | null
}

export function DecisionsView({ decisions, onRemove }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [refused, setRefused] = useState<{ id: string; later: string } | null>(null)

  // The undone card disappears, so keep keyboard focus on the page (WCAG 2.4.3). A card
  // that stays keeps focus on its button, and says why below it.
  function remove(id: string) {
    const later = onRemove(id)
    setRefused(later ? { id, later } : null)
    if (!later) headingRef.current?.focus()
  }

  return (
    <Stack gap="md" maw={820}>
      <Title order={2} size="h4" ref={headingRef} tabIndex={-1}>
        判断の記録
      </Title>
      {decisions.length === 0 ? (
        <Text c="dimmed">相談の案を「計画に反映する」と、選んだ理由と一緒にここに残ります</Text>
      ) : (
        [...decisions].reverse().map((decision) => (
          <Card key={decision.id} withBorder padding="md" className="decision-card">
            <Stack gap={8}>
              <Group justify="space-between" wrap="nowrap">
                <Text fw={700}>{decision.title}</Text>
                <Text size="xs" c="dimmed" component="time" dateTime={decision.at}>
                  {shortDateTime(toLocalDateTime(decision.at))}
                </Text>
              </Group>
              <List size="sm" spacing={2}>
                {decision.labels.map((label) => (
                  <List.Item key={label}>{label}</List.Item>
                ))}
              </List>
              <dl className="option-notes">
                <dt>理由</dt>
                <dd>{decision.reason}</dd>
                <dt>代わりに</dt>
                <dd>{decision.tradeoff}</dd>
                {decision.note && (
                  <>
                    <dt>担当者のメモ</dt>
                    <dd>{decision.note}</dd>
                  </>
                )}
              </dl>
              <Group>
                <Button
                  size="xs"
                  variant="subtle"
                  color="gray"
                  leftSection={<IconArrowBackUp size={14} />}
                  onClick={() => remove(decision.id)}
                >
                  取り消す
                </Button>
              </Group>
              {refused?.id === decision.id && (
                <Alert color="orange" variant="light" role="status" p="xs">
                  <Text size="sm">
                    あとの判断{refused.later}が、この判断の変更を使っています。先にそちらを取り消してください。
                  </Text>
                </Alert>
              )}
            </Stack>
          </Card>
        ))
      )}
    </Stack>
  )
}

function toLocalDateTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
