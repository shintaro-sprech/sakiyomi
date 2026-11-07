import { Badge, Button, Group, Paper, Popover, SimpleGrid, Stack, Table, Text, Title, VisuallyHidden } from '@mantine/core'
import { IconCheck, IconUser, IconUserFilled } from '@tabler/icons-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { addDays, daysBetween, MINUTES_PER_DAY, parseClock, weekday } from '../engine/dates'
import { stockoutWithDeals, type DealDemand } from '../engine/dealDemand'
import {
  coverageOf,
  dailyUsage,
  lastDayOfNextMonth,
  orderDemands,
  replenishments,
  type OrderDemand,
  type PriorityClass,
  type Replenishment,
} from '../engine/demand'
import { monthlyOutlook, type Shortage } from '../engine/economics'
import { todayFocus, type FocusItem } from '../engine/focus'
import { arrivalIfOrderedToday, type Plan, type ReleaseTiming } from '../engine/plan'
import { materialCover, type MaterialCover } from '../engine/records'
import { describeChange, type Change } from '../engine/scenario'
import type { CrewDay } from '../engine/scheduler'
import type { IsoDate, Order, Part } from '../engine/types'
import type { Decision } from '../state/store'
import { dateInYear, formatYen, largeYen, pieces, shortDate, shortDateTime, weekdayName } from './format'
import { TodayFocus } from './TodayFocus'
import { useCountUp } from './useCountUp'

type Props = {
  plan: Plan
  today: IsoDate
  // When a shortfall would start once added, and when to order its material.
  timingOf: (item: Replenishment) => ReleaseTiming
  // Absent while an option is previewed.
  onAdopt?: (decision: Omit<Decision, 'id' | 'at'>) => void
  // The deals counted for the plan, set beside the stock.
  dealDemand: DealDemand
  // Opens an order in the progress tab.
  onShowOrder: (orderId: string) => void
  // Opens a distributor's row on the head office's screen.
  onShowChannel: (customer: string, partNumber: string) => void
}

const CLASS_LABELS: Record<PriorityClass, string> = { A: 'A 今月', B: 'B 来月', C: 'C 以降' }
// The class is when an order is needed, not a warning, so every class is ink; A is bold.
const PERSON_SIZE = 16
const CREW_COLUMN_WIDTH = 96

export function ClassBadge({ value }: { value: PriorityClass }) {
  return (
    <Badge
      variant="outline"
      color="dark"
      radius="sm"
      size="sm"
      fz="xs"
      fw={value === 'A' ? 700 : 500}
      miw="max-content"
      className={`class-badge-${value.toLowerCase()}`}
    >
      {CLASS_LABELS[value]}
    </Badge>
  )
}

export function OutlookView({ plan, today, timingOf, onAdopt, dealDemand, onShowOrder, onShowChannel }: Props) {
  const outlook = useMemo(() => monthlyOutlook(plan, today), [plan, today])
  const { data, settings } = plan.scenario
  const demands = useMemo(() => orderDemands(data, today), [data, today])
  // The plan's own data, so a shortfall already added as an order is gone.
  const toRelease = useMemo(() => new Map(replenishments(data, today).map((item) => [item.partNumber, item])), [data, today])
  const timings = useMemo(
    () => new Map([...toRelease.values()].map((item) => [item.partNumber, timingOf(item)])),
    [toRelease, timingOf],
  )
  const focus = useMemo(() => todayFocus(plan, today, timingOf), [plan, today, timingOf])
  // Material still to order for what was added to the plan, shown in the part's row until the
  // workbook gives the order its material.
  const allFocus = useMemo(() => todayFocus(plan, today, timingOf, Number.POSITIVE_INFINITY), [plan, today, timingOf])
  const materialAsks = new Map(allFocus.flatMap((item) => (item.kind === 'orderMaterial' ? [[item.partNumber, item] as const] : [])))
  // Pieces added to the plan from this screen or an option, by part, until the plan's own data has them.
  const addedPieces = (partNumber: string) =>
    data.orders.filter((order) => order.id.startsWith('追加') && order.partNumber === partNumber).reduce((total, order) => total + order.quantity, 0)
  // The day material recorded as ordered for what was added arrives, the latest of them.
  const orderedOn = (partNumber: string) =>
    data.orders
      .filter((order) => order.id.startsWith('追加') && order.partNumber === partNumber && order.materialOn)
      .map((order) => order.materialOn as IsoDate)
      .sort()
      .at(-1) ?? null
  // The material for what was added is ordered: the plan then waits for it to arrive.
  const recordOrdered = (item: Extract<FocusItem, { kind: 'orderMaterial' }>, arrives: IsoDate) => {
    orderedFocused.current = null
    setOrdered(item.partNumber)
    const changes: Change[] = (item.orderIds ?? []).map((orderId) => ({ kind: 'materialOrdered', orderId, arrives }))
    onAdopt?.({
      title: `${item.partNumber}の材料を発注`,
      changes,
      labels: changes.map((change) => describeChange(change, data)),
      reason: `注残に足した分の材料${item.toOrder}個分を発注した`,
      tradeoff: `材料が${shortDate(arrives)}に着くまで、足した注番は着手しない`,
      note: '',
    })
  }
  const shownProfit = useCountUp(outlook.grossProfit)
  // Orders late for their due date or for a date promised to a customer, as today's focus counts them.
  const lateOrPromised = new Set([
    ...outlook.lateOrders.map((order) => order.orderId),
    ...allFocus.flatMap((item) => (item.kind === 'promiseMissed' ? [item.orderId] : [])),
  ]).size
  // The part just added keeps keyboard focus where its button was (WCAG 2.4.3).
  const [added, setAdded] = useState<string | null>(null)
  const addedRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (added) addedRef.current?.focus()
  }, [added])
  // Likewise, once, the line that says the material was ordered, in place of the button pressed.
  const [ordered, setOrdered] = useState<string | null>(null)
  const orderedRef = useRef<HTMLDivElement>(null)
  const orderedFocused = useRef<string | null>(null)
  useEffect(() => {
    if (!ordered || orderedFocused.current === ordered || !orderedRef.current) return
    orderedRef.current.focus()
    orderedFocused.current = ordered
  }, [ordered, data])
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
      tradeoff: `${material}作る分の材料費と設備の運転費がかかり、同じ設備を使う注番が後ろにずれることがある`,
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
  // Days off the crews come in on, shaded as on the Gantt chart.
  const holidayDates = new Set(crewDays.filter((day) => day.holiday).map((day) => day.date))
  // Each day is as wide as its largest crew's marks need, so one busy day does not widen the rest.
  const tableWidth = crewDates.reduce((width, date) => {
    const people = Math.max(0, ...crewDays.filter((day) => day.date === date).map((day) => day.people))
    return width + Math.max(48, people * PERSON_SIZE + 12)
  }, CREW_COLUMN_WIDTH)

  return (
    <Stack gap="lg">
      <div className="outlook-hero">
        <TodayFocus items={focus} today={today} onSelect={(item) => goTo(item, onShowOrder, onShowChannel)} />
        <Paper withBorder p="lg" className="profit-card">
          <Group justify="space-between" wrap="nowrap" gap="xs">
            <Text size="sm" c="dimmed">
              {outlook.month.replace('-', '年')}月の粗利
            </Text>
            <Text size="sm" c="dimmed" className="tabular nowrap">
              売上 {largeYen(outlook.revenue)}
            </Text>
          </Group>
          <Text className="profit-value tabular" aria-hidden="true">
            {formatYen(shownProfit)}
          </Text>
          <VisuallyHidden>{formatYen(outlook.grossProfit)}</VisuallyHidden>
          <ProfitBar
            revenue={outlook.revenue}
            profit={outlook.grossProfit}
            costs={[
              ['材料費', outlook.materialCost],
              ...(settings.shifts === 1 ? [['残業', outlook.overtimePay] as const] : []),
              ['休日出勤', outlook.holidayPay],
              ['設備の運転費', outlook.machineCost],
            ]}
          />
          <SimpleGrid cols={2} spacing="sm" mt="sm">
            <Metric label="納期か回答に遅れる注番" value={lateOrPromised} unit="件" tone={lateOrPromised > 0 ? 'red' : undefined} />
            <Metric
              label="来月末までの欠品"
              value={new Set(outlook.shortages.map((shortage) => shortage.partNumber)).size}
              unit="品目"
              tone={outlook.shortages.length > 0 ? 'red' : undefined}
            />
            {settings.shifts === 1 ? (
              <Metric label="残業" value={outlook.overtimeHours} unit="時間" />
            ) : (
              <Metric label="今月の完成" value={outlook.completedPieces} unit="個" />
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
                      <Table.Th key={date} ta="center" className={`tabular${holidayDates.has(date) ? ' is-off' : ''}`}>
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
                          <Table.Td key={date} ta="center" className={holidayDates.has(date) ? 'is-off' : undefined}>
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
          <Table.ScrollContainer minWidth={990}>
            <Table verticalSpacing={6} horizontalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  {/* What to act on comes first after the part, so it stays in view on a phone. */}
                  <Table.Th className="sticky-col">型番</Table.Th>
                  <Table.Th w={{ base: 150, sm: 280 }}>足りない分</Table.Th>
                  <Table.Th w={220}>欠品の見込み</Table.Th>
                  <Table.Th w={190}>商談が決まると</Table.Th>
                  <Table.Th ta="right">在庫</Table.Th>
                  <Table.Th ta="right">1日の出荷</Table.Th>
                  <Table.Th>形状</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.parts.map((part) => {
                  const shortages = outlook.shortages.filter((shortage) => shortage.partNumber === part.partNumber)
                  const shortfall = toRelease.get(part.partNumber)
                  return (
                    <Table.Tr key={part.partNumber} id={rowId('stock', part.partNumber)}>
                      <Table.Th scope="row" className="sticky-col" fw={400} tabIndex={-1}>
                        {part.partNumber}
                      </Table.Th>
                      <Table.Td>
                        {shortfall ? (
                          <Stack gap={4}>
                            <Group gap={6}>
                              <Text size="sm" className="tabular" style={{ whiteSpace: 'nowrap' }}>
                                {shortfall.quantity}個　{shortDate(shortfall.needBy)}までに
                              </Text>
                              {onAdopt && (
                                <Button
                                  size="compact-sm"
                                  variant="default"
                                  onClick={() => add(shortfall)}
                                  aria-label={`${part.partNumber}の足りない分${shortfall.quantity}個を注残に足す`}
                                >
                                  注残に足す
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
                        ) : addedPieces(part.partNumber) > 0 ? (
                          <Stack gap={4}>
                            <div ref={added === part.partNumber ? addedRef : undefined} tabIndex={-1} style={{ width: 'fit-content' }}>
                              <Text size="sm" c="teal" fw={700} className="tabular nowrap">
                                <IconCheck size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> 注残に足した {pieces(addedPieces(part.partNumber))}個
                              </Text>
                            </div>
                            {orderedOn(part.partNumber) && (
                              <div ref={ordered === part.partNumber ? orderedRef : undefined} tabIndex={-1} style={{ width: 'fit-content' }}>
                                <Text size="sm" c="teal" fw={700} className="tabular">
                                  <IconCheck size={14} style={{ verticalAlign: '-2px' }} aria-hidden="true" /> 材料を発注した（{shortDate(orderedOn(part.partNumber))}着）
                                </Text>
                              </div>
                            )}
                            <MaterialAsk
                              item={materialAsks.get(part.partNumber)}
                              today={today}
                              arrives={(lead) => arrivalIfOrderedToday(settings, today, lead)}
                              onOrdered={onAdopt ? (item, arrives) => recordOrdered(item, arrives) : undefined}
                            />
                          </Stack>
                        ) : (
                          <Text size="sm" c="dimmed">
                            —
                          </Text>
                        )}
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
                        <DealsLine part={part} coverage={coverageOf(data, part)} demand={dealDemand} today={today} />
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {pieces(part.stock)}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {Math.round(dailyUsage(part) * 10) / 10}
                      </Table.Td>
                      <Table.Td>{part.shape}</Table.Td>
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

function rowId(table: string, key: string): string {
  return `${table}-row-${key}`
}

// The month's sales as one bar, cut into what is left as gross profit (ink) and the costs the
// plan moves (gray), so the bar itself says profit is sales less those costs. The bar is one
// button: hovering it with a mouse, or pressing it (a tap, Enter or Space), shows the amounts
// as a statement; moving away, pressing it again or Escape closes them (WCAG 1.4.13).
function ProfitBar({ revenue, profit, costs }: { revenue: number; profit: number; costs: (readonly [string, number])[] }) {
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)
  const closing = useRef<number | null>(null)
  const statementId = useId()
  const opened = hovered || pinned
  useEffect(() => {
    if (!opened) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setHovered(false)
      setPinned(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opened])
  const stay = () => {
    if (closing.current !== null) window.clearTimeout(closing.current)
  }
  const leave = () => {
    stay()
    closing.current = window.setTimeout(() => setHovered(false), 300)
  }
  const shown = costs.filter(([, value]) => value > 0)
  const segments = [['粗利', Math.max(0, profit)] as const, ...shown]
  const whole = Math.max(revenue, segments.reduce((total, [, value]) => total + value, 0))
  if (whole <= 0) return null
  const share = revenue > 0 ? Math.round((profit / revenue) * 100) : null
  const statement = (
    <table className="profit-statement tabular">
      <tbody>
        <tr>
          <th scope="row">売上</th>
          <td>{formatYen(revenue)}</td>
        </tr>
        {shown.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>−{formatYen(value)}</td>
          </tr>
        ))}
        <tr className="profit-statement-total">
          <th scope="row">粗利</th>
          <td>{formatYen(profit)}</td>
        </tr>
      </tbody>
    </table>
  )
  return (
    <div className="profit-bar-block">
      <Popover
        opened={opened}
        onChange={(next) => {
          if (next) return
          setHovered(false)
          setPinned(false)
        }}
        position="bottom-start"
        offset={4}
        withRoles={false}
        shadow="sm"
      >
        <Popover.Target>
          <button
            type="button"
            className="profit-bar"
            aria-label="粗利の内訳"
            aria-describedby={statementId}
            aria-expanded={opened}
            onPointerEnter={(event) => {
              if (event.pointerType !== 'mouse') return
              stay()
              setHovered(true)
            }}
            onPointerLeave={(event) => {
              if (event.pointerType === 'mouse') leave()
            }}
            onClick={() => {
              if (pinned) {
                setHovered(false)
                setPinned(false)
              } else setPinned(true)
            }}
            onBlur={() => setPinned(false)}
          >
            <span className="profit-track">
              {segments.map(([label, value]) => (
                <span key={label} className={label === '粗利' ? 'profit-piece profit-piece-profit' : 'profit-piece'} style={{ flexGrow: value / whole }} />
              ))}
            </span>
          </button>
        </Popover.Target>
        <Popover.Dropdown
          // Pressing the statement keeps focus on the bar, so it stays open.
          onMouseDown={(event) => event.preventDefault()}
          onPointerEnter={(event) => {
            if (event.pointerType === 'mouse') stay()
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === 'mouse') leave()
          }}
          px="sm"
          py={8}
        >
          {statement}
        </Popover.Dropdown>
      </Popover>
      <VisuallyHidden id={statementId} aria-hidden="true">
        {[`売上 ${formatYen(revenue)}`, ...shown.map(([label, value]) => `${label} ${formatYen(value)}`), `粗利 ${formatYen(profit)}`].join('、')}
      </VisuallyHidden>
      {share !== null && (
        <Text size="sm" mt={4} className="tabular" c={profit < 0 ? 'red' : undefined}>
          粗利 {share}%
        </Text>
      )}
    </div>
  )
}

// Where a focus item is dealt with: the part's row in the stock outlook, briefly marked, the
// order in the progress tab, or the distributor's row on the head office's screen.
function goTo(
  item: FocusItem,
  onShowOrder: (orderId: string) => void,
  onShowChannel: (customer: string, partNumber: string) => void,
) {
  if (item.kind === 'lateOrder' || item.kind === 'promiseMissed') {
    onShowOrder(item.orderId)
    return
  }
  if (item.kind === 'distributorOrder') {
    onShowChannel(item.customer, item.partNumber)
    return
  }
  const row = document.getElementById(rowId('stock', item.partNumber))
  if (!row) return
  row.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  row.querySelector<HTMLElement>('th')?.focus({ preventScroll: true })
  row.classList.remove('is-pointed')
  void row.offsetWidth
  row.classList.add('is-pointed')
  window.setTimeout(() => row.classList.remove('is-pointed'), 2400)
}

// What the counted deals of a part would add a month, and, when it comes sooner with them,
// the day stock and what the open orders still have to finish would run out.
function DealsLine({ part, coverage, demand, today }: { part: Part; coverage: number; demand: DealDemand; today: IsoDate }) {
  const counted = demand.byPart.find((entry) => entry.partNumber === part.partNumber)
  if (!counted) {
    return (
      <Text size="sm" c="dimmed">
        —
      </Text>
    )
  }
  // Both days are looked for up to the end of the deals' period.
  const { leadMonths } = demand.options
  const now = stockoutWithDeals(coverage, part, [], leadMonths, today, demand.periodEnd)
  const withDeals = stockoutWithDeals(coverage, part, demand.counted, leadMonths, today, demand.periodEnd)
  const sooner = withDeals !== null && (now === null || withDeals < now)
  return (
    <Stack gap={0}>
      <Text size="sm" className="tabular">
        +{pieces(counted.expected)}個/月（{counted.deals}件）
      </Text>
      {sooner && (
        <Text size="sm" className="tabular" c={withDeals <= addDays(today, 30) ? 'orange' : undefined}>
          在庫と注残が尽きる{' '}
          <span className="nowrap">
            {now ? dateInYear(now, today) : `${dateInYear(demand.periodEnd, today)}より後`} → {dateInYear(withDeals, today)}
          </span>
        </Text>
      )}
    </Stack>
  )
}

// The material still to order for pieces already added to the plan, in the words of today's focus.
// Its button records the order placed, so the plan waits for the material and the reminder ends.
function MaterialAsk({
  item,
  today,
  arrives,
  onOrdered,
}: {
  item: FocusItem | undefined
  today: IsoDate
  // The day material ordered today arrives, for a lead time in days.
  arrives: (leadDays: number) => IsoDate
  onOrdered?: (item: Extract<FocusItem, { kind: 'orderMaterial' }>, arrives: IsoDate) => void
}) {
  if (!item || item.kind !== 'orderMaterial') return null
  const arrival = item.arrives ?? (item.leadDays !== null ? arrives(item.leadDays) : null)
  return (
    <Stack gap={4} align="flex-start">
      <Text size="sm" c="orange" fw={700} className="tabular">
        材料{item.toOrder}個分を{item.orderBy ? `${item.orderBy === today ? '今日' : shortDate(item.orderBy)}までに発注` : `今日発注して${shortDate(item.arrives)}着`}
      </Text>
      {onOrdered && item.orderIds && arrival && (
        <Button size="compact-sm" variant="default" onClick={() => onOrdered(item, arrival)}>
          発注した（{shortDate(arrival)}着）
        </Button>
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
        <Text size="sm" c="orange" fw={700}>
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
        {value.toLocaleString('ja-JP')}
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
