import { Button, Card, Group, List, Stack, Text, Title } from '@mantine/core'
import { IconArrowBackUp } from '@tabler/icons-react'
import { useRef } from 'react'

import type { Decision } from '../state/store'
import { shortDateTime } from './format'

type Props = {
  decisions: Decision[]
  onRemove: (id: string) => void
}

export function DecisionsView({ decisions, onRemove }: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null)

  // The undone card disappears, so keep keyboard focus on the page (WCAG 2.4.3).
  function remove(id: string) {
    onRemove(id)
    headingRef.current?.focus()
  }

  return (
    <Stack gap="md" maw={820}>
      <Title order={2} size="h4" ref={headingRef} tabIndex={-1}>
        判断の記録
      </Title>
      {decisions.length === 0 ? (
        <Text c="dimmed">まだ記録はありません</Text>
      ) : (
        [...decisions].reverse().map((decision) => (
          <Card key={decision.id} withBorder padding="md">
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
