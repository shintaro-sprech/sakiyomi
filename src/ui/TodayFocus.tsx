import { Group, Text, Title, UnstyledButton } from '@mantine/core'
import { IconChevronRight } from '@tabler/icons-react'

import type { FocusItem } from '../engine/focus'
import type { IsoDate } from '../engine/types'
import { shortDate } from './format'
import { Mascot } from './Mascot'

type Props = {
  items: FocusItem[]
  today: IsoDate
  // Takes the planner to where the item is dealt with.
  onSelect: (item: FocusItem) => void
}

type Line = { title: string; detail: string; tag: string; tone: 'red' | 'orange' | 'blue' }

// What to act on first today, in the order a planner would take it.
export function TodayFocus({ items, today, onSelect }: Props) {
  return (
    <section className="today-focus" aria-labelledby="today-focus-title">
      <Group gap="sm" wrap="nowrap" mb={4}>
        <span aria-hidden="true">
          <Mascot state="idle" size={44} still />
        </span>
        <Title order={2} id="today-focus-title" className="today-focus-title">
          今日の先読み
        </Title>
      </Group>
      {items.length === 0 ? (
        <Text c="dimmed">今日すぐに手を打つことはありません</Text>
      ) : (
        <ol className="focus-list">
          {items.map((item, index) => {
            const line = describe(item, today)
            return (
              <li key={`${item.kind}-${index}`} className="focus-item" style={{ animationDelay: `${120 + index * 90}ms` }}>
                <UnstyledButton className="focus-button" onClick={() => onSelect(item)}>
                  <span className="focus-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span className="focus-body">
                    <span className="focus-headline">
                      <Text component="span" fw={700} className="focus-title phrase">
                        {line.title}
                      </Text>
                      <Text component="span" fw={700} c={line.tone} className="focus-tag tabular">
                        {line.tag}
                      </Text>
                    </span>
                    <Text component="span" size="sm" c="dimmed" display="block" className="phrase tabular">
                      {line.detail}
                    </Text>
                  </span>
                  <IconChevronRight size={18} className="focus-chevron" aria-hidden="true" />
                </UnstyledButton>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

function describe(item: FocusItem, today: IsoDate): Line {
  switch (item.kind) {
    case 'orderMaterial': {
      const start = shortDate(item.startAt.slice(0, 10))
      if (!item.orderBy) {
        return {
          title: `${item.partNumber}の材料${item.toOrder}個分を発注`,
          detail:
            item.onHand > 0
              ? `今日発注して${shortDate(item.arrives)}着　着手は${start}に材料のある${item.onHand}個から`
              : `今日発注して${shortDate(item.arrives)}着　着手はそのあと`,
          tag: '今すぐ',
          tone: 'orange',
        }
      }
      return {
        title: `${item.partNumber}の材料${item.toOrder}個分を発注`,
        detail: `${start}の着手に間に合わせる（調達${item.leadDays}日）`,
        tag: item.orderBy === today ? '今日まで' : `${shortDate(item.orderBy)}まで`,
        tone: 'orange',
      }
    }
    case 'lateOrder':
      return {
        title: `注番${item.orderId}が納期に遅れる`,
        detail: `納期${shortDate(item.due)}　完成見込み${item.finishDate ? shortDate(item.finishDate) : 'なし'}`,
        tag: item.lateDays ? `${item.lateDays}日遅れ` : '計画に入らない',
        tone: 'red',
      }
    case 'distributorOrder':
      return {
        title: `${item.customer}から${item.partNumber}の注文が来そう`,
        detail: `${item.customer}の在庫は${item.stockNow}個（実売の${item.daysLeft}日分）　注文は1か月分の${item.quantity}個ほど`,
        tag: item.on <= today ? '今にも' : `${shortDate(item.on)}ごろ`,
        tone: 'blue',
      }
    case 'promiseMissed':
      return {
        title: `注番${item.orderId}の${item.customer}分が回答納期に遅れる`,
        detail: `回答納期${shortDate(item.answered)}　完成見込み${shortDate(item.finishDate)}`,
        tag: `${item.daysLate}日遅れ`,
        tone: 'red',
      }
    case 'shortage':
      return {
        title: `${item.partNumber}が${shortDate(item.from)}から欠品する`,
        detail: `最大${item.maxShortage}個足りない`,
        tag: `${shortDate(item.from)}から`,
        tone: 'red',
      }
  }
}
