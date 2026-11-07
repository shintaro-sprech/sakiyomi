import { Paper, Stack, Table, Text, Title } from '@mantine/core'
import { useEffect, useMemo } from 'react'

import { channelOutlook, type ChannelOutlook } from '../engine/records'
import type { IsoDate, PlantData } from '../engine/types'
import { shortDate } from './format'

type Props = {
  data: PlantData
  today: IsoDate
  // The distributor today's focus pointed to on the plan for this month.
  pointed: { customer: string; partNumber: string } | null
}

function rowId(customer: string, partNumber: string): string {
  return `channel-row-${customer}-${partNumber}`
}

// The head office's view of the distributors: the stock each holds, what it has ordered and
// when it is expected to order again. A distributor today's focus points to is brought into
// view, marked for a moment and given keyboard focus.
export function ChannelsView({ data, today, pointed }: Props) {
  const channels = useMemo(
    () =>
      [...channelOutlook(data, today)].sort(
        (a, b) => (a.orderOn ?? '9999').localeCompare(b.orderOn ?? '9999') || a.customer.localeCompare(b.customer),
      ),
    [data, today],
  )
  useEffect(() => {
    if (!pointed) return
    const row = document.getElementById(rowId(pointed.customer, pointed.partNumber))
    if (!row) return
    row.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
    row.querySelector<HTMLElement>('th')?.focus({ preventScroll: true })
    row.classList.add('is-pointed')
    const fade = window.setTimeout(() => row.classList.remove('is-pointed'), 2400)
    return () => {
      window.clearTimeout(fade)
      row.classList.remove('is-pointed')
    }
  }, [pointed])

  return (
    <Stack gap="md">
      <Title order={2} size="h4">
        代理店の在庫
      </Title>
      {channels.length === 0 ? (
        <Text c="dimmed">代理店からの在庫の報告はありません</Text>
      ) : (
        <section>
          <Text size="sm" c="dimmed" mb="sm">
            代理店から来る注文は、今月の計画の在庫の見通しで「1日の出荷」に入っています。
          </Text>
          <Paper withBorder>
            <Table.ScrollContainer minWidth={640}>
              <Table verticalSpacing={6} horizontalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th className="sticky-col">代理店・型番</Table.Th>
                    <Table.Th>報告</Table.Th>
                    <Table.Th ta="right">今の在庫</Table.Th>
                    <Table.Th ta="right">注文済み</Table.Th>
                    <Table.Th ta="right">実売の何日分</Table.Th>
                    <Table.Th pl="xl">注文が来る見込み</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {channels.map((entry) => (
                    <Table.Tr key={`${entry.customer}-${entry.partNumber}`} id={rowId(entry.customer, entry.partNumber)}>
                      <Table.Th scope="row" className="sticky-col" fw={400} style={{ whiteSpace: 'nowrap' }} tabIndex={-1}>
                        {entry.customer}　{entry.partNumber}
                      </Table.Th>
                      <Table.Td className="tabular">{shortDate(entry.asOf)}</Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {entry.stockNow}個
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {entry.onOrder > 0 ? `${entry.onOrder}個` : '—'}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {entry.daysLeft === null ? '—' : `${entry.daysLeft}日分`}
                      </Table.Td>
                      <Table.Td pl="xl">
                        <OrderExpected entry={entry} today={today} />
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        </section>
      )}
    </Stack>
  )
}

// When a distributor is expected to order from the plant, and how many.
function OrderExpected({ entry, today }: { entry: ChannelOutlook; today: IsoDate }) {
  if (entry.orderOn === null) return <Text size="sm">見込みなし</Text>
  if (entry.orderOn <= today) {
    return (
      <Text size="sm" fw={700} className="tabular" style={{ whiteSpace: 'nowrap' }}>
        今にも {entry.orderQuantity}個
      </Text>
    )
  }
  return (
    <Text size="sm" className="tabular" style={{ whiteSpace: 'nowrap' }}>
      {shortDate(entry.orderOn)}ごろ {entry.orderQuantity}個
    </Text>
  )
}
