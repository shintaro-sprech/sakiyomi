import { Alert, Badge, Group, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title, VisuallyHidden } from '@mantine/core'
import { useMemo, useState } from 'react'

import { dealAnalytics, type Tally } from '../engine/dealAnalytics'
import { defaultBaseDate, reviewChances, type Outcome, type ReviewGroup } from '../engine/review'
import type { IsoDate, Part } from '../engine/types'
import type { DealInsights } from '../state/dealInsights'
import { chance, dateInYear, largeYen, percent, pieces, yearMonth } from './format'

const OUTCOMES: Record<Outcome, { label: string; color: string }> = {
  won: { label: '受注', color: 'teal' },
  lost: { label: '失注', color: 'gray' },
  open: { label: 'まだ', color: 'orange' },
  gone: { label: '削除', color: 'gray' },
}

function GroupTable({ title, groups }: { title: string; groups: ReviewGroup[] }) {
  return (
    <section>
      <Title order={3} size="h5" mb="xs">
        {title}
      </Title>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={460}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>
                  <VisuallyHidden>区分</VisuallyHidden>
                </Table.Th>
                <Table.Th ta="right">商談</Table.Th>
                <Table.Th ta="right">受注</Table.Th>
                <Table.Th ta="right">失注</Table.Th>
                <Table.Th ta="right">まだ</Table.Th>
                <Table.Th ta="right">予定日までに決着</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map((group) => (
                <Table.Tr key={group.label}>
                  <Table.Th scope="row" fw={400}>
                    {group.label}
                  </Table.Th>
                  {[group.deals, group.won, group.lost, group.open, group.onTime].map((value, index) => (
                    <Table.Td key={index} ta="right" className="tabular" c={value === 0 ? 'dimmed' : undefined}>
                      {value}
                    </Table.Td>
                  ))}
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </section>
  )
}

// What the chances of an earlier day came to.
export function ReviewPanel({ insights, parts, today }: { insights: DealInsights; parts: Part[]; today: IsoDate }) {
  const [baseDate, setBaseDate] = useState(defaultBaseDate(today))
  const review = useMemo(
    () => reviewChances(insights.deals, insights.changes, parts, baseDate),
    [insights.deals, insights.changes, parts, baseDate],
  )
  return (
    <Stack gap="lg">
      <TextInput
        type="date"
        label="この日の受注確率を見る"
        value={baseDate}
        max={today}
        onChange={(event) => {
          const value = event.currentTarget.value
          // A day still to come has no outcome to look back on.
          if (value) setBaseDate(value > today ? today : value)
        }}
        w={220}
      />
      {!review.ok ? (
        <Alert color="orange" variant="light">
          {review.reason}
        </Alert>
      ) : (
        <>
          <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
            <GroupTable title="その日の確率ごと" groups={review.byChance} />
            <GroupTable title="その日の受注予定日ごと" groups={review.byCloseDate} />
          </SimpleGrid>
          <section>
            <Title order={3} size="h5" mb="xs">
              商談ごと
            </Title>
            <Paper withBorder>
              <Table.ScrollContainer minWidth={820}>
                <Table verticalSpacing={6}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>商談名</Table.Th>
                      <Table.Th>型番</Table.Th>
                      <Table.Th>その日のステージ</Table.Th>
                      <Table.Th ta="right">その日の確率</Table.Th>
                      <Table.Th ta="right">その日の受注予定日</Table.Th>
                      <Table.Th>結果</Table.Th>
                      <Table.Th ta="right">決まった日</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {review.deals.map((entry) => (
                      <Table.Tr key={entry.deal.id}>
                        <Table.Th scope="row" fw={400}>
                          {entry.then.name}
                        </Table.Th>
                        <Table.Td>{entry.then.partNumber}</Table.Td>
                        <Table.Td>{entry.then.stage}</Table.Td>
                        <Table.Td ta="right" className="tabular">
                          {chance(entry.chance)}
                        </Table.Td>
                        <Table.Td ta="right" className="tabular">
                          {dateInYear(entry.then.closeDate, today)}
                        </Table.Td>
                        <Table.Td>
                          <Badge variant="light" color={OUTCOMES[entry.outcome].color} radius="sm" size="sm" fz="xs">
                            {OUTCOMES[entry.outcome].label}
                          </Badge>
                        </Table.Td>
                        <Table.Td ta="right" className="tabular" c={entry.decidedOn && !entry.onTime ? 'red' : undefined}>
                          {dateInYear(entry.decidedOn, today)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          </section>
          <section>
            <Title order={3} size="h5" mb="xs">
              型番ごと
            </Title>
            <Paper withBorder maw={600}>
              <Table.ScrollContainer minWidth={480}>
                <Table verticalSpacing={6}>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>型番</Table.Th>
                      <Table.Th ta="right">商談</Table.Th>
                      <Table.Th ta="right">その日の期待数量（月）</Table.Th>
                      <Table.Th ta="right">受注した数量（月）</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {review.byPart.map((part) => (
                      <Table.Tr key={part.partNumber}>
                        <Table.Th scope="row" fw={400}>
                          {part.partNumber}
                        </Table.Th>
                        <Table.Td ta="right" className="tabular">
                          {part.deals}
                        </Table.Td>
                        <Table.Td ta="right" className="tabular">
                          {pieces(part.expected)}
                        </Table.Td>
                        <Table.Td ta="right" className="tabular">
                          {pieces(part.wonQuantity)}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Paper>
          </section>
        </>
      )}
    </Stack>
  )
}

function Stat({ label, value, before }: { label: string; value: string; before: string }) {
  return (
    <Paper withBorder p="md">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="xl" fw={700} className="tabular">
        {value}
      </Text>
      <Text size="sm" c="dimmed" className="tabular">
        前の1年 {before}
      </Text>
    </Paper>
  )
}

function TallyTable({ title, rows }: { title: string; rows: Tally[] }) {
  return (
    <section>
      <Title order={3} size="h5" mb="xs">
        {title}
      </Title>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={420}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>
                  <VisuallyHidden>{title.replace('ごと', '')}</VisuallyHidden>
                </Table.Th>
                <Table.Th ta="right" className="nowrap">
                  決着
                </Table.Th>
                <Table.Th ta="right" className="nowrap">
                  受注率
                </Table.Th>
                <Table.Th ta="right" className="nowrap">
                  受注した数量（月）
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((row) => (
                <Table.Tr key={row.label}>
                  <Table.Th scope="row" fw={400} className="nowrap">
                    {row.label}
                  </Table.Th>
                  <Table.Td ta="right" className="tabular">
                    {row.decided}
                  </Table.Td>
                  <Table.Td ta="right" className="tabular">
                    {row.winRate === null ? '-' : percent(row.winRate)}
                  </Table.Td>
                  <Table.Td ta="right" className="tabular">
                    {pieces(row.wonQuantity)}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </section>
  )
}

// How sales have gone over the last year, set against the year before.
export function AnalyticsPanel({ insights, parts, today }: { insights: DealInsights; parts: Part[]; today: IsoDate }) {
  const analytics = useMemo(() => dealAnalytics(insights.deals, parts, today), [insights.deals, parts, today])
  const { current, previous } = analytics
  const top = Math.max(1, ...analytics.byMonth.map((month) => month.decided))
  return (
    <Stack gap="lg">
      <Text size="sm" c="dimmed" className="tabular">
        {yearMonth(current.from.slice(0, 7))}〜{yearMonth(current.to.slice(0, 7))}に決着した商談
      </Text>
      <SimpleGrid cols={{ base: 2, md: 4 }}>
        <Stat label="受注" value={`${current.won}件`} before={`${previous.won}件`} />
        <Stat
          label="受注率"
          value={current.winRate === null ? '-' : percent(current.winRate)}
          before={previous.winRate === null ? '-' : percent(previous.winRate)}
        />
        <Stat label="受注した数量（月）" value={`${pieces(current.wonQuantity)}個`} before={`${pieces(previous.wonQuantity)}個`} />
        <Stat label="受注の売上（年）" value={largeYen(current.wonValue)} before={largeYen(previous.wonValue)} />
      </SimpleGrid>
      <Text size="sm" c="dimmed" className="tabular">
        決着までの日数　受注 {current.daysToWin === null ? '-' : Math.round(current.daysToWin)}日・失注{' '}
        {current.daysToLose === null ? '-' : Math.round(current.daysToLose)}日
      </Text>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <section>
          <Title order={3} size="h5" mb="xs">
            月ごとの決着
          </Title>
          <Paper withBorder p="md">
            <Stack gap={6}>
              {analytics.byMonth.map((month) => (
                <Group key={month.month} gap="sm" wrap="nowrap">
                  <Text size="sm" w={72} className="tabular">
                    {yearMonth(month.month)}
                  </Text>
                  <div className="bar-track bar-split" aria-hidden>
                    <div className="bar-fill" style={{ width: `${(month.won / top) * 100}%` }} />
                    <div className="bar-fill bar-lost" style={{ width: `${(month.lost / top) * 100}%` }} />
                  </div>
                  <Text size="sm" w={112} ta="right" className="tabular">
                    受注{month.won}・失注{month.lost}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        </section>
        <section>
          <Title order={3} size="h5" mb="xs">
            進行中の商談
          </Title>
          <Paper withBorder>
            <Table verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>ステージ</Table.Th>
                  <Table.Th ta="right">商談</Table.Th>
                  <Table.Th ta="right">量産数量（月）</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {analytics.open.map((stage) => (
                  <Table.Tr key={stage.stage}>
                    <Table.Th scope="row" fw={400}>
                      {stage.stage}
                    </Table.Th>
                    <Table.Td ta="right" className="tabular">
                      {stage.deals}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {pieces(stage.quantity)}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Paper>
        </section>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <TallyTable title="取引先ごと" rows={analytics.byCustomer} />
        <TallyTable title="担当者ごと" rows={analytics.byOwner} />
        <TallyTable title="引き合いの経路ごと" rows={analytics.bySource} />
        <TallyTable title="用途ごと" rows={analytics.byUse} />
      </SimpleGrid>
    </Stack>
  )
}
