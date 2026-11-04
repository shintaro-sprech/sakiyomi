import { Badge, Button, Group, Paper, SimpleGrid, Stack, Table, Text, Title, VisuallyHidden } from '@mantine/core'
import { IconCheck, IconUser, IconUserFilled } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { addDays, daysBetween, MINUTES_PER_DAY, parseClock, weekday } from '../engine/dates'
import {
  dailyUsage,
  lastDayOfNextMonth,
  orderDemands,
  replenishments,
  type OrderDemand,
  type PriorityClass,
  type Replenishment,
} from '../engine/demand'
import { monthlyOutlook, type Shortage } from '../engine/economics'
import { todayFocus } from '../engine/focus'
import type { Plan, ReleaseTiming } from '../engine/plan'
import { channelOutlook, materialCover, type ChannelOutlook, type MaterialCover } from '../engine/records'
import { describeChange, type Change } from '../engine/scenario'
import type { CrewDay } from '../engine/scheduler'
import type { IsoDate, Order, Part } from '../engine/types'
import type { Decision } from '../state/store'
import { formatYen, shortDate, shortDateTime, weekdayName } from './format'
import { TodayFocus } from './TodayFocus'
import { useCountUp } from './useCountUp'

type Props = {
  plan: Plan
  today: IsoDate
  // When a shortfall would start once added, and when to order its material.
  timingOf: (item: Replenishment) => ReleaseTiming
  // Absent while an option is previewed.
  onAdopt?: (decision: Omit<Decision, 'id' | 'at'>) => void
}

const CLASS_LABELS: Record<PriorityClass, string> = { A: 'A 今月', B: 'B 来月', C: 'C 以降' }
const CLASS_COLORS: Record<PriorityClass, string> = { A: 'red', B: 'orange', C: 'gray' }
const PERSON_SIZE = 16
const CREW_COLUMN_WIDTH = 96

export function ClassBadge({ value }: { value: PriorityClass }) {
  return (
    <Badge
      variant="outline"
      color={CLASS_COLORS[value]}
      radius="sm"
      size="sm"
      fz="xs"
      miw="max-content"
      className={`class-badge-${value.toLowerCase()}`}
    >
      {CLASS_LABELS[value]}
    </Badge>
  )
}

export function OutlookView({ plan, today, timingOf, onAdopt }: Props) {
  const outlook = useMemo(() => monthlyOutlook(plan, today), [plan, today])
  const { data, settings } = plan.scenario
  const demands = useMemo(() => orderDemands(data, today), [data, today])
  // The plan's own data, so a shortfall already added as an order is gone.
  const toRelease = useMemo(() => new Map(replenishments(data, today).map((item) => [item.partNumber, item])), [data, today])
  const timings = useMemo(
    () => new Map([...toRelease.values()].map((item) => [item.partNumber, timingOf(item)])),
    [toRelease, timingOf],
  )
  const channels = useMemo(() => channelOutlook(data, today), [data, today])
  const focus = useMemo(() => todayFocus(plan, today, timingOf), [plan, today, timingOf])
  const shownProfit = useCountUp(outlook.grossProfit)
  // The part just added keeps keyboard focus where its button was (WCAG 2.4.3).
  const [added, setAdded] = useState<string | null>(null)
  const addedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (added) addedRef.current?.focus()
  }, [added])
  const add = (item: Replenishment) => {
    const change: Change = { kind: 'addOrder', partNumber: item.partNumber, quantity: item.quantity, due: item.needBy }
    // The plan does not wait for material it has no arrival date for, so the record says so,
    // with the day to order it by.
    const cover = materialCover(data, item.partNumber, item.quantity)
    const timing = timings.get(item.partNumber)
    const need =
      cover?.kind === 'partly'
        ? `材料は${cover.pieces}個分しかなく、${cover.toOrder}個分は発注が要る`
        : cover?.kind === 'none'
          ? `材料がなく、${cover.toOrder}個分の発注が要る`
          : ''
    const start = shortDate(timing?.startAt?.slice(0, 10))
    const when = !timing?.materialOrderBy
      ? ''
      : timing.materialLate
        ? `。今日発注しても${shortDate(timing.materialArrives)}着で、${start}の着手に間に合わない`
        : `。${start}の着手に間に合わせるには、${shortDate(timing.materialOrderBy)}までに発注する`
    const material = need ? `${need}${when}（計画は入荷を待たずに組んでいる）。` : ''
    onAdopt?.({
      title: `${item.partNumber}の足りない分を追加`,
      changes: [change],
      labels: [describeChange(change, data)],
      reason: `来月末までの出荷に、在庫と注残では${item.quantity}個足りない`,
      tradeoff: `${material}作る分の材料費・労務費・設備の運転費がかかり、同じ設備を使う注番が後ろにずれることがある`,
      note: '',
    })
    setAdded(item.partNumber)
  }
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
    settings.laborRate *
      (outlook.overtimeHours * settings.overtimePremium +
        outlook.holidayHours * settings.holidayPremium +
        outlook.nightHours * settings.nightPremium),
  )

  return (
    <Stack gap="lg">
      <div className="outlook-hero">
        <TodayFocus items={focus} today={today} />
        <Paper withBorder p="lg" className="profit-card">
          <Text size="sm" c="dimmed">
            {outlook.month.replace('-', '年')}月の粗利
          </Text>
          <Text className="profit-value tabular" aria-hidden="true">
            {formatYen(shownProfit)}
          </Text>
          <VisuallyHidden>{formatYen(outlook.grossProfit)}</VisuallyHidden>
          <Text size="sm" c="dimmed" className="tabular phrase">
            売上 {formatYen(outlook.revenue)} − 材料費 {formatYen(outlook.materialCost)} − 労務費{' '}
            {formatYen(outlook.laborCost)}
            {premium > 0 ? `（うち割増 ${formatYen(premium)}）` : ''} − 設備の運転費 {formatYen(outlook.machineCost)}
          </Text>
          <SimpleGrid cols={2} spacing="sm" mt="sm">
            <Metric
              label="納期に遅れる注番"
              value={outlook.lateOrders.length}
              unit="件"
              tone={outlook.lateOrders.length > 0 ? 'red' : undefined}
            />
            <Metric
              label="来月末までに欠品する型番"
              value={new Set(outlook.shortages.map((shortage) => shortage.partNumber)).size}
              unit="品目"
              tone={outlook.shortages.length > 0 ? 'red' : undefined}
            />
            {settings.shifts === 1 ? (
              <Metric label="残業" value={outlook.overtimeHours} unit="時間" />
            ) : (
              <Metric label="深夜" value={outlook.nightHours} unit="時間" />
            )}
            <Metric label="休日出勤" value={outlook.holidayHours} unit="時間" />
          </SimpleGrid>
        </Paper>
      </div>

      <FlowTimeline
        plan={plan}
        today={today}
        rows={rows}
        orders={orders}
        parts={data.parts}
        shortages={outlook.shortages}
        timings={timings}
      />

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
          <Table.ScrollContainer minWidth={820}>
            <Table verticalSpacing={6} horizontalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="sticky-col">型番</Table.Th>
                  <Table.Th>形状</Table.Th>
                  <Table.Th ta="right">在庫</Table.Th>
                  <Table.Th ta="right">1日の出荷</Table.Th>
                  <Table.Th w={220}>欠品の見込み</Table.Th>
                  {/* Narrow on a phone, where the button goes under the count beside the fixed part column. */}
                  <Table.Th w={{ base: 150, sm: 280 }}>足りない分</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.parts.map((part) => {
                  const shortages = outlook.shortages.filter((shortage) => shortage.partNumber === part.partNumber)
                  const shortfall = toRelease.get(part.partNumber)
                  return (
                    <Table.Tr key={part.partNumber}>
                      <Table.Th scope="row" className="sticky-col" fw={400}>
                        {part.partNumber}
                      </Table.Th>
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
                      <Table.Td>
                        {shortfall ? (
                          <Stack gap={4}>
                            <Group gap={6}>
                              <Text size="sm" className="tabular" style={{ whiteSpace: 'nowrap' }}>
                                {shortfall.quantity}個　{shortDate(shortfall.needBy)}までに
                              </Text>
                              {onAdopt && (
                                <Button
                                  size="xs"
                                  variant="default"
                                  onClick={() => add(shortfall)}
                                  aria-label={`${part.partNumber}の足りない分${shortfall.quantity}個を計画に反映する`}
                                >
                                  計画に反映する
                                </Button>
                              )}
                            </Group>
                            <MaterialLine cover={materialCover(data, part.partNumber, shortfall.quantity)} />
                            <TimingLine
                              timing={timings.get(part.partNumber)}
                              cover={materialCover(data, part.partNumber, shortfall.quantity)}
                              today={today}
                            />
                          </Stack>
                        ) : added === part.partNumber ? (
                          <div ref={addedRef} tabIndex={-1} style={{ width: 'fit-content' }}>
                            <Badge color="teal" variant="outline" size="lg" radius="sm" leftSection={<IconCheck size={14} />}>
                              反映済み
                            </Badge>
                          </div>
                        ) : (
                          <Text size="sm" c="dimmed">
                            —
                          </Text>
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

      {channels.length > 0 && (
        <section>
          <Title order={2} size="h4" mb={4}>
            代理店の在庫
          </Title>
          <Text size="sm" c="dimmed" mb="sm">
            代理店から来る注文は、在庫の見通しの「1日の出荷」に入っています。
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
                  {[...channels]
                    .sort((a, b) => (a.orderOn ?? '9999').localeCompare(b.orderOn ?? '9999') || a.customer.localeCompare(b.customer))
                    .map((entry) => (
                      <Table.Tr key={`${entry.customer}-${entry.partNumber}`}>
                        <Table.Th scope="row" className="sticky-col" fw={400} style={{ whiteSpace: 'nowrap' }}>
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

// Whether material on hand starts the pieces short, in the words a planner acts on.
export function MaterialLine({ cover }: { cover: MaterialCover | null }) {
  if (!cover) return null
  const text =
    cover.kind === 'ready'
      ? '材料あり：すぐ投入できる'
      : cover.kind === 'partly'
        ? `材料は${cover.pieces}個分：${cover.toOrder}個分は発注から`
        : '材料なし：発注から'
  return (
    <Text size="sm" style={{ whiteSpace: 'nowrap' }}>
      {text}
    </Text>
  )
}

// When the pieces short would start once added, and the day to order their material by.
// Past that day, material ordered today comes after the start, so the start holds only
// for the pieces material on hand covers.
function TimingLine({ timing, cover, today }: { timing: ReleaseTiming | undefined; cover: MaterialCover | null; today: IsoDate }) {
  if (!timing?.startAt) return null
  const start = shortDate(timing.startAt.slice(0, 10))
  const arrives = shortDate(timing.materialArrives)
  const short = cover !== null && cover.kind !== 'ready'
  if (timing.materialLate) {
    return (
      <div className="tabular">
        {cover?.kind === 'partly' && <Text size="sm">着手 {start}（材料のある{cover.pieces}個）</Text>}
        <Text size="sm" c="red" fw={700}>
          {cover?.kind === 'partly' ? `残りは今日発注して${arrives}着` : `材料を今日発注して${arrives}着`}
        </Text>
        {cover?.kind !== 'partly' && <Text size="sm">着手はそのあと</Text>}
      </div>
    )
  }
  const lastDay = timing.materialOrderBy === today
  return (
    <div className="tabular">
      <Text size="sm">着手 {start}</Text>
      {timing.materialOrderBy ? (
        <Text size="sm" fw={lastDay ? 700 : undefined}>
          材料の発注 {lastDay ? '今日' : shortDate(timing.materialOrderBy)}まで（調達{timing.materialLeadDays}日）
        </Text>
      ) : (
        short &&
        timing.materialLeadDays === null && (
          <Text size="sm" c="dimmed">
            材料の調達日数が未入力
          </Text>
        )
      )}
    </div>
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

function Metric({ label, value, unit, tone }: { label: string; value: number; unit: string; tone?: 'red' }) {
  return (
    <div className="metric">
      <Text size="xs" c="dimmed" className="phrase">
        {label}
      </Text>
      <Text c={tone} className="metric-value tabular">
        {value}
        <Text span size="sm" c="dimmed" ml={4}>
          {unit}
        </Text>
      </Text>
    </div>
  )
}

// Where each order stands from today to the end of next month: a bar to its forecast
// finish, its due date as a line, and above them the days a part's stock runs short,
// with when its material comes. The bars are drawn for the eye; each lane says the same
// in words for a screen reader.
function FlowTimeline({
  plan,
  today,
  rows,
  orders,
  parts,
  shortages,
  timings,
}: {
  plan: Plan
  today: IsoDate
  rows: OrderDemand[]
  orders: Map<string, Order>
  parts: Part[]
  shortages: Shortage[]
  timings: Map<string, ReleaseTiming>
}) {
  const start = addDays(today, -1)
  const end = lastDayOfNextMonth(today)
  const total = daysBetween(start, end) + 1
  const at = (dateTime: string) => {
    const minutes = dateTime.length > 10 ? parseClock(dateTime.slice(11, 16)) : 0
    const days = daysBetween(start, dateTime.slice(0, 10)) + minutes / MINUTES_PER_DAY
    return Math.min(100, Math.max(0, (days / total) * 100))
  }
  const pct = (value: number) => `${value}%`
  const now = at(today)
  // Mondays, leaving out one too close to the 今日 label.
  const mondays = Array.from({ length: total }, (_, index) => addDays(start, index)).filter(
    (date) => weekday(date) === 1 && Math.abs(daysBetween(today, date)) > 2,
  )
  const forecasts = new Map(plan.result.orders.map((forecast) => [forecast.orderId, forecast]))
  const shortParts = [...new Set(shortages.map((shortage) => shortage.partNumber))]

  return (
    <section>
      <Title order={2} size="h4" mb="sm">
        これからの流れ
      </Title>
      <Paper withBorder p="md">
        <div className="flow-scroll" tabIndex={0} role="region" aria-label="これからの流れ（横に送れます）">
          <div className="flow-grid">
            <div className="flow-row" aria-hidden="true">
              <span className="flow-label" />
              <div className="flow-ticks">
                {mondays.map((date) => (
                  <span key={date} className="flow-tick tabular" style={{ left: pct(at(date)) }}>
                    {shortDate(date)}
                  </span>
                ))}
                <span className="flow-tick is-today" style={{ left: pct(now) }}>
                  今日
                </span>
              </div>
            </div>
            <ol className="flow-lanes" aria-label="これからの流れ">
              {shortParts.map((partNumber, laneIndex) => {
                const part = parts.find((candidate) => candidate.partNumber === partNumber)
                const runs = shortages.filter((shortage) => shortage.partNumber === partNumber)
                const timing = timings.get(partNumber)
                const material = timing?.materialArrives
                  ? `材料は今日発注して${shortDate(timing.materialArrives)}着`
                  : timing?.materialOrderBy
                    ? `材料の発注は${shortDate(timing.materialOrderBy)}まで`
                    : ''
                return (
                  <li key={partNumber} className="flow-row">
                    <div className="flow-label">
                      <div>
                        <Text size="sm" fw={700}>
                          {partNumber}の在庫
                        </Text>
                        <Text size="xs" c="dimmed" className="tabular">
                          在庫{part?.stock ?? 0}個　1日{part ? Math.round(dailyUsage(part) * 10) / 10 : 0}個
                        </Text>
                      </div>
                    </div>
                    <div className="flow-track is-stock" aria-hidden="true">
                      <span className="flow-today" style={{ left: pct(now) }} />
                      {runs.map((run) => (
                        <span
                          key={run.from}
                          className="flow-short"
                          style={{
                            left: pct(at(run.from)),
                            width: pct((run.until ? at(run.until) : 100) - at(run.from)),
                            animationDelay: `${400 + laneIndex * 100}ms`,
                          }}
                        >
                          <span className="flow-short-label tabular">最大{run.maxShortage}個</span>
                        </span>
                      ))}
                      {timing?.materialArrives && (
                        <span className="flow-mark" style={{ left: pct(at(timing.materialArrives)) }}>
                          <span className="flow-mark-label tabular">材料{shortDate(timing.materialArrives)}着</span>
                        </span>
                      )}
                      {timing?.materialOrderBy && !timing.materialLate && (
                        <span className="flow-mark" style={{ left: pct(at(timing.materialOrderBy)) }}>
                          <span className="flow-mark-label tabular">発注{shortDate(timing.materialOrderBy)}まで</span>
                        </span>
                      )}
                    </div>
                    <VisuallyHidden>
                      {runs
                        .map(
                          (run) =>
                            `${shortDate(run.from)}から${run.until ? `${shortDate(run.until)}まで` : ''}最大${run.maxShortage}個欠品`,
                        )
                        .join('、')}
                      {material ? `、${material}` : ''}
                    </VisuallyHidden>
                  </li>
                )
              })}
              {rows.map((demand, index) => {
                const forecast = forecasts.get(demand.orderId)
                const order = orders.get(demand.orderId)
                const finishAt = forecast?.finishAt ?? null
                const due = order?.due ?? demand.needBy
                const beyond = due > end
                const finish = finishAt ? at(finishAt) : now
                const late = forecast?.late ?? false
                const delay = `${300 + index * 90}ms`
                return (
                  <li key={demand.orderId} className="flow-row">
                    <div className="flow-label">
                      <ClassBadge value={demand.priorityClass} />
                      <div>
                        <Text size="sm" fw={700} className="flow-name tabular">
                          <VisuallyHidden>注番</VisuallyHidden>
                          {demand.orderId}
                          <VisuallyHidden>、</VisuallyHidden>
                          <Text span size="xs" c="dimmed" fw={400} className="flow-part">
                            {demand.partNumber}・{order?.quantity}個
                          </Text>
                        </Text>
                        <Text size="xs" c="dimmed" className="tabular">
                          納期{shortDate(due)}
                        </Text>
                      </div>
                    </div>
                    <div className="flow-track" aria-hidden="true">
                      <span className="flow-today" style={{ left: pct(now) }} />
                      <span className={`flow-due${beyond ? ' is-beyond' : ''}`} style={{ left: pct(beyond ? 100 : at(due)) }} />
                      {forecast?.status === 'done' ? (
                        <span className="flow-note" style={{ left: pct(now) }}>
                          完了
                        </span>
                      ) : finishAt ? (
                        <>
                          <span
                            className={`flow-bar${late ? ' is-late' : ''}`}
                            style={{ left: pct(now), width: pct(Math.max(finish - now, 0)), animationDelay: delay }}
                          />
                          <span
                            className={`flow-finish tabular${late ? ' is-late' : ''}${finish > 85 ? ' is-left' : ''}`}
                            style={{ left: pct(finish), animationDelay: delay }}
                          >
                            {shortDate(finishAt.slice(0, 10))}
                          </span>
                        </>
                      ) : (
                        <span className="flow-note" style={{ left: pct(now) }}>
                          計画に入らない
                        </span>
                      )}
                    </div>
                    <VisuallyHidden>
                      {forecast?.status === 'done'
                        ? '完了'
                        : finishAt
                          ? `完成見込み${shortDateTime(finishAt)}${late && forecast?.lateDays ? `、${forecast.lateDays}日遅れ` : ''}`
                          : '計画に入らない'}
                    </VisuallyHidden>
                  </li>
                )
              })}
            </ol>
          </div>
        </div>
      </Paper>
    </section>
  )
}
