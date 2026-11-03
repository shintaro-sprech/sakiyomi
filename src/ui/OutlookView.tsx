import { Badge, Group, Paper, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core'
import { IconUser, IconUserFilled } from '@tabler/icons-react'
import { useMemo } from 'react'

import { dailyUsage, orderDemands, type PriorityClass } from '../engine/demand'
import { monthlyOutlook } from '../engine/economics'
import type { Plan } from '../engine/plan'
import type { CrewDay } from '../engine/scheduler'
import type { IsoDate } from '../engine/types'
import { formatYen, shortDate, shortDateTime, weekdayName } from './format'

type Props = {
  plan: Plan
  today: IsoDate
}

const CLASS_LABELS: Record<PriorityClass, string> = { A: 'A 今月', B: 'B 来月', C: 'C 以降' }
const CLASS_COLORS: Record<PriorityClass, string> = { A: 'red', B: 'orange', C: 'gray' }
const PERSON_SIZE = 16
const CREW_COLUMN_WIDTH = 96

export function ClassBadge({ value }: { value: PriorityClass }) {
  return (
    <Badge variant="outline" color={CLASS_COLORS[value]} radius="sm" size="sm">
      {CLASS_LABELS[value]}
    </Badge>
  )
}

export function OutlookView({ plan, today }: Props) {
  const outlook = useMemo(() => monthlyOutlook(plan, today), [plan, today])
  const { data, settings } = plan.scenario
  const demands = useMemo(() => orderDemands(data, today), [data, today])
  const forecasts = new Map(plan.result.orders.map((forecast) => [forecast.orderId, forecast]))
  const orders = new Map(data.orders.map((order) => [order.id, order]))
  const rows = [...demands].sort(
    (a, b) => a.priorityClass.localeCompare(b.priorityClass) || a.needBy.localeCompare(b.needBy),
  )
  const crewDays = plan.result.crewDays
  const crewDates = [...new Set(crewDays.map((day) => day.date))]
  // Each day is as wide as its largest crew's marks need, so one busy day does not widen the rest.
  const tableWidth = crewDates.reduce((width, date) => {
    const people = Math.max(0, ...crewDays.filter((day) => day.date === date).map((day) => day.people))
    return width + Math.max(48, people * PERSON_SIZE + 12)
  }, CREW_COLUMN_WIDTH)
  const premium = Math.round(
    (settings.laborRate * (outlook.overtimeHours * settings.overtimePremium + outlook.holidayHours * settings.holidayPremium)),
  )

  return (
    <Stack gap="lg">
      <Paper withBorder p="md">
        <Group gap="lg" align="flex-end" wrap="wrap" className="equation">
          <Figure label={`${outlook.month.replace('-', '年')}月の粗利`} value={formatYen(outlook.grossProfit)} strong />
          <Text c="dimmed" aria-hidden="true">
            ＝
          </Text>
          <Figure label="売上" value={formatYen(outlook.revenue)} />
          <Text c="dimmed" aria-hidden="true">
            −
          </Text>
          <Figure label="材料費" value={formatYen(outlook.materialCost)} />
          <Text c="dimmed" aria-hidden="true">
            −
          </Text>
          <Figure
            label="労務費"
            value={formatYen(outlook.laborCost)}
            note={premium > 0 ? `うち割増 ${formatYen(premium)}` : undefined}
          />
          <Text c="dimmed" aria-hidden="true">
            −
          </Text>
          <Figure label="設備費" value={formatYen(outlook.machineCost)} />
        </Group>
      </Paper>

      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <Metric label="納期に遅れる注番" value={`${outlook.lateOrders.length}件`} tone={outlook.lateOrders.length > 0 ? 'red' : 'teal'} />
        <Metric label="来月末までに欠品する型番" value={`${new Set(outlook.shortages.map((shortage) => shortage.partNumber)).size}品目`} tone={outlook.shortages.length > 0 ? 'red' : 'teal'} />
        <Metric label="残業" value={`${outlook.overtimeHours}時間`} />
        <Metric label="休日出勤" value={`${outlook.holidayHours}時間`} />
      </SimpleGrid>

      <section>
        <Title order={2} size="h4" mb="sm">
          作る順番
        </Title>
        <Paper withBorder>
          <Table.ScrollContainer minWidth={720}>
            <Table verticalSpacing={6} horizontalSpacing={6} highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>区分</Table.Th>
                  <Table.Th>注番</Table.Th>
                  <Table.Th>型番</Table.Th>
                  <Table.Th ta="right">数量</Table.Th>
                  <Table.Th>必要日</Table.Th>
                  <Table.Th>納期</Table.Th>
                  <Table.Th>完成見込み</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((demand) => {
                  const forecast = forecasts.get(demand.orderId)
                  const order = orders.get(demand.orderId)
                  const late = forecast?.late ?? false
                  return (
                    <Table.Tr key={demand.orderId}>
                      <Table.Td>
                        <ClassBadge value={demand.priorityClass} />
                      </Table.Td>
                      <Table.Td>{demand.orderId}</Table.Td>
                      <Table.Td>{demand.partNumber}</Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {order?.quantity}
                      </Table.Td>
                      <Table.Td className="tabular">
                        {shortDate(demand.needBy)}
                        {demand.stockoutOn === demand.needBy && demand.stockoutOn !== order?.due && (
                          <Text span size="xs" c="dimmed" ml={4}>
                            在庫切れ
                          </Text>
                        )}
                      </Table.Td>
                      <Table.Td className="tabular">{shortDate(order?.due)}</Table.Td>
                      <Table.Td className="tabular" c={late ? 'red' : undefined} fw={late ? 700 : undefined}>
                        {forecast?.status === 'done' ? '完了' : shortDateTime(forecast?.finishAt)}
                        {late && forecast?.lateDays ? `（${forecast.lateDays}日遅れ）` : ''}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </section>

      {data.crews.length > 0 && (
        <section>
          <Title order={2} size="h4" mb="sm">
            人の割り当て
          </Title>
          <Paper withBorder>
            <Table.ScrollContainer minWidth={tableWidth}>
              <Table verticalSpacing={6} horizontalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th className="sticky-col" w={CREW_COLUMN_WIDTH}>
                      班
                    </Table.Th>
                    {crewDates.map((date) => (
                      <Table.Th key={date} ta="center" className="tabular">
                        {shortDate(date)}
                        <Text span display="block" size="xs" c="dimmed">
                          {weekdayName(date)}
                        </Text>
                      </Table.Th>
                    ))}
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.crews.map((crew) => (
                    <Table.Tr key={crew.name}>
                      <Table.Th scope="row" className="sticky-col" style={{ whiteSpace: 'nowrap' }}>
                        {crew.name}
                      </Table.Th>
                      {crewDates.map((date) => {
                        const day = crewDays.find((item) => item.crew === crew.name && item.date === date)
                        return (
                          <Table.Td key={date} ta="center">
                            {day && <People day={day} />}
                          </Table.Td>
                        )
                      })}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Paper>
        </section>
      )}

      <section>
        <Title order={2} size="h4" mb="sm">
          在庫の見通し
        </Title>
        <Paper withBorder>
          <Table.ScrollContainer minWidth={640}>
            <Table verticalSpacing={6} horizontalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>型番</Table.Th>
                  <Table.Th>形状</Table.Th>
                  <Table.Th ta="right">在庫</Table.Th>
                  <Table.Th ta="right">1日の出荷</Table.Th>
                  <Table.Th>欠品の見込み</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.parts.map((part) => {
                  const shortages = outlook.shortages.filter((shortage) => shortage.partNumber === part.partNumber)
                  return (
                    <Table.Tr key={part.partNumber}>
                      <Table.Td>{part.partNumber}</Table.Td>
                      <Table.Td>{part.shape}</Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {part.stock}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {Math.round(dailyUsage(part) * 10) / 10}
                      </Table.Td>
                      <Table.Td>
                        {shortages.length === 0 ? (
                          <Text size="sm" c="teal">
                            なし
                          </Text>
                        ) : (
                          shortages.map((shortage) => (
                            <Text key={shortage.from} size="sm" c="red" className="tabular">
                              {shortDate(shortage.from)}〜{shortage.until ? shortDate(shortage.until) : ''}（最大{shortage.maxShortage}個）
                            </Text>
                          ))
                        )}
                      </Table.Td>
                    </Table.Tr>
                  )
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </section>
    </Stack>
  )
}

// One mark per person at work: filled while running a machine at the busiest moment of the day.
function People({ day }: { day: CrewDay }) {
  if (day.people === 0) {
    return (
      <Text span size="sm" c="dimmed" role="img" aria-label="出勤なし">
        0
      </Text>
    )
  }
  const full = day.peak >= day.people
  return (
    <Group
      gap={0}
      justify="center"
      wrap="nowrap"
      role="img"
      aria-label={`${day.people}人中${day.peak}人が設備に付く`}
      className={full ? 'people is-full' : 'people'}
    >
      {Array.from({ length: day.people }, (_, index) =>
        index < day.peak ? (
          <IconUserFilled key={index} size={PERSON_SIZE} className="person-busy" aria-hidden="true" />
        ) : (
          <IconUser key={index} size={PERSON_SIZE} className="person-free" aria-hidden="true" />
        ),
      )}
    </Group>
  )
}

function Figure({ label, value, note, strong }: { label: string; value: string; note?: string; strong?: boolean }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fz={strong ? 26 : 18} fw={700} className="tabular" style={{ whiteSpace: 'nowrap' }}>
        {value}
      </Text>
      {note && (
        <Text size="xs" c="dimmed" className="tabular">
          {note}
        </Text>
      )}
    </Stack>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'teal' }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed" className="phrase">
        {label}
      </Text>
      <Text fz={22} fw={700} c={tone} className="tabular" style={{ whiteSpace: 'nowrap' }}>
        {value}
      </Text>
    </Paper>
  )
}
