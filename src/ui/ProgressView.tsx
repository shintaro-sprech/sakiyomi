import {
  Anchor,
  Badge,
  CloseButton,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
} from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import {
  IconCalendarDue,
  IconChevronDown,
  IconChevronUp,
  IconClockExclamation,
  IconPackageOff,
  IconSearch,
  IconSelector,
} from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { orderDemands, type OrderDemand, type PriorityClass } from '../engine/demand'
import { monthlyOutlook, type Shortage } from '../engine/economics'
import type { Plan } from '../engine/plan'
import { deliveriesOf, lotHistory, materialCover, type Delivery } from '../engine/records'
import {
  monthReach,
  stagnantDays,
  summarizeProgress,
  summarizeWip,
  URGENCIES,
  type MonthReach,
  type ProgressSummary,
  type Urgency,
  type WipCell,
  type WipColumn,
} from '../engine/progress'
import type { OrderForecast } from '../engine/scheduler'
import type { Actual, IsoDate, Lot, Order } from '../engine/types'
import { percent, shortDate, shortDateTime } from './format'
import { ClassBadge, MaterialLine } from './OutlookView'

type Props = {
  plan: Plan
  today: IsoDate
  warningDays: number
  // A lot to open on, asked for from the Gantt chart.
  focus: { orderId: string; lotId: string } | null
}

type Row = {
  key: string
  label: string
  orders: Order[]
  route: string[]
  summary: ProgressSummary
  forecast: { finish: string | null; late: boolean; lateCount: number }
  priorityClass: PriorityClass | null
}

type SortKey = 'due' | 'finish' | 'progress'

type Selection =
  | { kind: 'row'; rowKey: string; step: number | null }
  | { kind: 'deliveries'; orderId: string }
  | { kind: 'board'; column: number | null; urgency: Urgency | null }

const URGENCY_LABELS: Record<Urgency, string> = {
  'A-stockout': 'A 今月・在庫切れ',
  'A-due': 'A 今月・納期',
  B: 'B 来月',
  C: 'C 以降',
}

export function ProgressView({ plan, today, warningDays, focus }: Props) {
  const [mode, setMode] = useState<'order' | 'part'>('order')
  // The tab is drawn afresh each time it opens, so a lot asked for opens its order's list.
  const [selection, setSelection] = useState<Selection | null>(() =>
    focus ? { kind: 'row', rowKey: `o:${focus.orderId}`, step: null } : null,
  )
  const { data } = plan.scenario
  const forecasts = useMemo(
    () => new Map(plan.result.orders.map((forecast) => [forecast.orderId, forecast])),
    [plan],
  )

  const orderRows = useMemo(
    () =>
      [...data.orders]
        .sort((a, b) => a.due.localeCompare(b.due) || a.id.localeCompare(b.id))
        .map((order) => buildRow(`o:${order.id}`, order.id, [order], data, forecasts)),
    [data, forecasts],
  )
  const partRows = useMemo(
    () =>
      Object.keys(data.routes)
        .sort()
        .map((partNumber) => {
          const orders = data.orders.filter((order) => order.partNumber === partNumber)
          return buildRow(`p:${partNumber}`, partNumber, orders, data, forecasts)
        })
        .filter((row) => row.orders.length > 0),
    [data, forecasts],
  )

  const demandList = useMemo(() => orderDemands(data, today), [data, today])
  const demands = new Map(demandList.map((demand) => [demand.orderId, demand]))
  const wip = useMemo(() => summarizeWip(data, demandList), [data, demandList])
  const shortages = useMemo(() => monthlyOutlook(plan, today).shortages, [plan, today])
  const reaches = useMemo(() => new Map(monthReach(data, today).map((item) => [item.partNumber, item])), [data, today])
  const lateOrders = new Set(plan.result.orders.filter((forecast) => forecast.late).map((forecast) => forecast.orderId))

  // Narrowing and order of the rows: a search over orders, part numbers and lots, finished
  // rows hidden, only rows with lots that have stopped, and a sort by a column.
  const [query, setQuery] = useState('')
  const [hideFinished, setHideFinished] = useState(false)
  const [stoppedOnly, setStoppedOnly] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'due', descending: false })
  // Lots on the floor, and the Lot numbers the pieces not yet released will get.
  const lotIdsOf = useMemo(() => {
    const ids = new Map<string, Set<string>>()
    const add = (orderId: string, lotId: string) => ids.set(orderId, (ids.get(orderId) ?? new Set()).add(lotId))
    data.lots.forEach((lot) => add(lot.orderId, lot.id))
    plan.result.operations.filter((operation) => operation.planned).forEach((operation) => add(operation.orderId, operation.lotId))
    return ids
  }, [data, plan])
  const matches = (row: Row) => {
    const words = query.trim().toLowerCase()
    if (!words) return true
    const lotIds = row.orders.flatMap((order) => [...(lotIdsOf.get(order.id) ?? [])])
    return [row.label, ...row.orders.map((order) => `${order.id} ${order.partNumber}`), ...lotIds]
      .some((value) => value.toLowerCase().includes(words))
  }
  const sortValue = (row: Row): string | number => {
    if (sort.key === 'finish') return row.forecast.finish ?? '9999'
    if (sort.key === 'progress') return row.summary.ratio
    return row.orders.map((order) => order.due).sort()[0] ?? ''
  }
  const rows = (mode === 'order' ? orderRows : partRows)
    .filter(matches)
    .filter((row) => !hideFinished || row.summary.finished < row.summary.quantity)
    .filter((row) => !stoppedOnly || row.summary.wipLots.some((lot) => stagnantDays(lot, today) >= warningDays))
    .sort((a, b) => {
      const [x, y] = [sortValue(a), sortValue(b)]
      const order = x < y ? -1 : x > y ? 1 : 0
      return sort.descending ? -order : order
    })
  const sortBy = (key: SortKey) =>
    setSort((current) => ({ key, descending: current.key === key ? !current.descending : false }))
  const ariaSort = (key: SortKey) => (sort.key === key ? (sort.descending ? 'descending' : 'ascending') : undefined)
  const stepCount = Math.max(1, ...rows.map((row) => row.route.length))
  const selectedRow = selection?.kind === 'row' ? (rows.find((row) => row.key === selection.rowKey) ?? null) : null
  // A panel belongs to its row, so it closes when narrowing hides the row, and does not
  // come back on its own when the row does.
  const selectionHidden =
    (selection?.kind === 'row' && !selectedRow) ||
    (selection?.kind === 'deliveries' &&
      !rows.some((row) => row.orders.length === 1 && row.orders[0].id === selection.orderId))
  if (selectionHidden) setSelection(null)
  const isWarned = (lot: Lot) => stagnantDays(lot, today) >= warningDays
  // Closing a panel returns focus to what opened it. A panel the Gantt chart opened has no
  // opener here, so focus goes to the search box above the rows.
  const opener = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const open = (next: Selection) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelection(next)
  }
  const close = () => {
    setSelection(null)
    ;(opener.current?.isConnected ? opener.current : searchRef.current)?.focus()
  }
  // Keyboard focus goes to the lot the Gantt chart asked for once, when the tab opens.
  const lotFocused = useRef(false)
  const claimLotFocus = () => {
    if (lotFocused.current) return false
    lotFocused.current = true
    return true
  }
  const panelProps = { plan, today, warningDays, onClose: close }

  const allWip = orderRows.flatMap((row) => row.summary.wipLots)
  const lateCount = plan.result.orders.filter((forecast) => forecast.late).length

  return (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
        <Metric label="注残" value={`${data.orders.length}件`} />
        <Metric label="納期に遅れる見込み" value={`${lateCount}件`} tone={lateCount > 0 ? 'red' : 'teal'} />
        <Metric
          label="仕掛"
          value={`${allWip.reduce((total, lot) => total + lot.quantity, 0)}個 / ${allWip.length}Lot`}
        />
        <Metric
          label={`${warningDays}日以上止まっているLot`}
          value={`${allWip.filter(isWarned).length}Lot`}
          tone={allWip.some(isWarned) ? 'orange' : undefined}
        />
      </SimpleGrid>

      <WipBoard
        columns={wip}
        lateOrders={lateOrders}
        isWarned={isWarned}
        selected={selection?.kind === 'board' ? selection : null}
        onSelect={(column, urgency) =>
          selection?.kind === 'board' && selection.column === column && selection.urgency === urgency
            ? close()
            : open({ kind: 'board', column, urgency })
        }
      />
      {selection?.kind === 'board' && <LotPanel key={boardPanel(wip, selection).title} {...boardPanel(wip, selection)} {...panelProps} />}

      <SegmentedControl
        w="fit-content"
        value={mode}
        onChange={(value) => switchMode(value as 'order' | 'part')}
        data={[
          { value: 'order', label: '注残ごと' },
          { value: 'part', label: '型番ごと' },
        ]}
        aria-label="表示の単位"
      />
      <Group gap="md" wrap="wrap" align="center">
        <TextInput
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="注番・型番・Lot"
          aria-label="注番・型番・Lot で絞り込む"
          leftSection={<IconSearch size={16} aria-hidden />}
          w={220}
        />
        <Switch
          checked={hideFinished}
          onChange={(event) => setHideFinished(event.currentTarget.checked)}
          label="完了を隠す"
        />
        <Switch
          checked={stoppedOnly}
          onChange={(event) => setStoppedOnly(event.currentTarget.checked)}
          label={`${warningDays}日以上止まっているLotがあるものだけ`}
        />
      </Group>

      <Paper withBorder className="table-wrap">
        <table className="progress-table">
          <thead>
            <tr>
              {mode === 'order' ? (
                <>
                  <th>注番</th>
                  <th>型番</th>
                  <th className="num">数量</th>
                  <SortHeader label="納期" sort={ariaSort('due')} onSort={() => sortBy('due')} />
                  <th>必要日</th>
                </>
              ) : (
                <>
                  <th>型番</th>
                  <th className="num">注残</th>
                  <th className="num">数量</th>
                  <SortHeader label="最短納期" sort={ariaSort('due')} onSort={() => sortBy('due')} />
                  <th>欠品の見込み</th>
                  <th>今月分</th>
                </>
              )}
              <SortHeader label="完成見込み" sort={ariaSort('finish')} onSort={() => sortBy('finish')} />
              <SortHeader label="工程全体" sort={ariaSort('progress')} onSort={() => sortBy('progress')} className="col-overall" />
              {Array.from({ length: stepCount }, (_, index) => (
                <th key={index}>工程{index + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={
                  (selection?.kind === 'row' && selection.rowKey === row.key) ||
                  (selection?.kind === 'deliveries' && row.orders.length === 1 && selection.orderId === row.orders[0].id)
                    ? 'is-selected'
                    : undefined
                }
              >
                {mode === 'order' ? (
                  <>
                    <td>
                      <Group gap={6} wrap="nowrap">
                        {row.label}
                        {row.priorityClass && <ClassBadge value={row.priorityClass} />}
                      </Group>
                    </td>
                    <td>{row.orders[0].partNumber}</td>
                    <td className="num">{row.summary.quantity}</td>
                    <td>
                      <DueCell
                        orderId={row.orders[0].id}
                        due={row.orders[0].due}
                        deliveries={deliveriesOf(data, row.orders[0].id, forecasts.get(row.orders[0].id))}
                        pressed={selection?.kind === 'deliveries' && selection.orderId === row.orders[0].id}
                        onOpen={() =>
                          selection?.kind === 'deliveries' && selection.orderId === row.orders[0].id
                            ? close()
                            : open({ kind: 'deliveries', orderId: row.orders[0].id })
                        }
                      />
                    </td>
                    <td>
                      <NeedBy demand={demands.get(row.orders[0].id)} due={row.orders[0].due} />
                    </td>
                  </>
                ) : (
                  <>
                    <td>{row.label}</td>
                    <td className="num">{row.orders.length}件</td>
                    <td className="num">{row.summary.quantity}</td>
                    <td>{shortDate(row.orders.map((order) => order.due).sort()[0])}</td>
                    <td>
                      <PartShortages shortages={shortages.filter((shortage) => shortage.partNumber === row.label)} />
                    </td>
                    <td>
                      <MonthNeed reach={reaches.get(row.label)} data={data} />
                    </td>
                  </>
                )}
                <td className={row.forecast.late ? 'late' : undefined}>
                  {row.forecast.finish ? shortDateTime(row.forecast.finish) : '完了'}
                  {row.forecast.lateCount > 0 && (
                    <Badge color="red" variant="light" size="sm" ml={6}>
                      遅れ{row.forecast.lateCount}
                    </Badge>
                  )}
                </td>
                <td className="col-overall">
                  <OverallCell
                    summary={row.summary}
                    warned={row.summary.wipLots.some(isWarned)}
                    onOpen={() => open({ kind: 'row', rowKey: row.key, step: null })}
                  />
                </td>
                {Array.from({ length: stepCount }, (_, index) => (
                  <td key={index}>
                    {index < row.route.length && (
                      <StepChip
                        summary={row.summary}
                        index={index}
                        warned={row.summary.steps[index].lots.some(isWarned)}
                        onOpen={() => open({ kind: 'row', rowKey: row.key, step: index })}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={99} className="wip-empty">
                  当てはまる注残はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Paper>

      {selectedRow && selection?.kind === 'row' && (
        <LotPanel
          key={`${selectedRow.key}-${selection.step}`}
          title={
            selection.step === null
              ? `${selectedRow.label} の仕掛Lot一覧（全工程）`
              : `${selectedRow.label}・工程${selection.step + 1} ${selectedRow.route[selection.step]} の仕掛Lot一覧`
          }
          lots={selection.step === null ? selectedRow.summary.wipLots : selectedRow.summary.steps[selection.step].lots}
          // The whole order, and its first step, include the pieces not yet released, under
          // their planned Lot number.
          unreleased={
            selection.step === null || selection.step === 0
              ? selectedRow.orders.flatMap((order) => {
                  const quantity = order.quantity - data.lots.filter((lot) => lot.orderId === order.id).reduce((total, lot) => total + lot.quantity, 0)
                  return quantity > 0 ? [{ orderId: order.id, quantity }] : []
                })
              : []
          }
          highlightLot={focus?.lotId}
          claimFocus={claimLotFocus}
          {...panelProps}
        />
      )}
      {selection?.kind === 'deliveries' && (
        <DeliveriesPanel
          orderId={selection.orderId}
          deliveries={deliveriesOf(data, selection.orderId, forecasts.get(selection.orderId))}
          finish={forecasts.get(selection.orderId)?.finishAt ?? null}
          onClose={close}
        />
      )}
    </Stack>
  )

  function switchMode(next: 'order' | 'part') {
    setMode(next)
    if (selection?.kind === 'row' || selection?.kind === 'deliveries') setSelection(null)
  }
}

function buildRow(
  key: string,
  label: string,
  orders: Order[],
  data: Plan['scenario']['data'],
  forecasts: Map<string, OrderForecast>,
): Row {
  const route = data.routes[orders[0].partNumber] ?? []
  const summary = summarizeProgress(orders, data.lots, route)
  const orderForecasts = orders.map((order) => forecasts.get(order.id)).filter((forecast) => forecast !== undefined)
  const finishes = orderForecasts.map((forecast) => forecast.finishAt).filter((finish) => finish !== null)
  const lateCount = orderForecasts.filter((forecast) => forecast.late).length
  return {
    key,
    label,
    orders,
    route: route.map((step) => step.name),
    summary,
    forecast: { finish: finishes.sort().at(-1) ?? null, late: lateCount > 0, lateCount: orders.length > 1 ? lateCount : 0 },
    priorityClass: orders.length === 1 ? (orderForecasts[0]?.priorityClass ?? null) : null,
  }
}

// A column header that sorts the rows; pressing it again turns the order around.
function SortHeader({
  label,
  sort,
  onSort,
  className,
}: {
  label: string
  sort: 'ascending' | 'descending' | undefined
  onSort: () => void
  className?: string
}) {
  return (
    <th aria-sort={sort} className={className}>
      <button type="button" className="sort-head" onClick={onSort}>
        {label}
        {sort === 'ascending' ? (
          <IconChevronUp size={12} aria-hidden />
        ) : sort === 'descending' ? (
          <IconChevronDown size={12} aria-hidden />
        ) : (
          <IconSelector size={12} aria-hidden />
        )}
      </button>
    </th>
  )
}

// When an order is needed, and whether stock running out or its due date sets that day.
// The mark shows only when stock running out comes first; otherwise the due date sets it.
function NeedBy({ demand, due }: { demand: OrderDemand | undefined; due: IsoDate }) {
  if (!demand) return <span className="wip-empty">—</span>
  const stockout = demand.stockoutOn !== null && demand.stockoutOn < due
  return (
    <span className="need-by">
      {stockout && <IconPackageOff size={14} aria-hidden />}
      {shortDate(demand.needBy)}
      <VisuallyHidden>{stockout ? '（在庫切れ）' : '（納期）'}</VisuallyHidden>
    </span>
  )
}

function PartShortages({ shortages }: { shortages: Shortage[] }) {
  if (shortages.length === 0)
    return (
      <Text size="sm" c="teal">
        なし
      </Text>
    )
  return (
    <Stack gap={0}>
      {shortages.map((shortage) => (
        <Text key={shortage.from} size="sm" c="red" className="tabular" style={{ whiteSpace: 'nowrap' }}>
          {shortDate(shortage.from)}〜{shortage.until ? shortDate(shortage.until) : ''}（最大{shortage.maxShortage}個）
        </Text>
      ))}
    </Stack>
  )
}

// How far back in the route this month's shipments reach for the part: to which step's lots,
// into the pieces not yet released, or past both.
function MonthNeed({ reach, data }: { reach: MonthReach | undefined; data: Plan['scenario']['data'] }) {
  if (!reach) return <span className="wip-empty">—</span>
  const { need } = reach
  const text =
    reach.reach.kind === 'lots'
      ? `工程${reach.reach.stepIndex + 1} ${reach.reach.stepName}まで（${reach.reach.pieces}個）`
      : reach.reach.kind === 'unreleased'
        ? `未投入から${reach.reach.pieces}個`
        : `${reach.reach.pieces}個足りない`
  return (
    <Stack gap={0}>
      <Text size="sm" fw={700} className="tabular">
        {need}個
      </Text>
      <Text size="sm" c={reach.reach.kind === 'short' ? 'red' : undefined} style={{ whiteSpace: 'nowrap' }}>
        {text}
      </Text>
      {reach.reach.kind === 'short' && <MaterialLine cover={materialCover(data, reach.partNumber, reach.reach.pieces)} />}
    </Stack>
  )
}

// The order's due date opens its customer orders; a promise the plan misses, or one not yet
// answered, shows under it.
function DueCell({
  orderId,
  due,
  deliveries,
  pressed,
  onOpen,
}: {
  orderId: string
  due: IsoDate
  deliveries: Delivery[]
  pressed: boolean
  onOpen: () => void
}) {
  // A promise is missed when the forecast comes after it, or when the order cannot be planned.
  const missed = deliveries.filter(
    (entry) => entry.answered !== null && (entry.unplanned || (entry.daysLate !== null && entry.daysLate > 0)),
  ).length
  const unanswered = deliveries.filter((entry) => entry.answered === null).length
  const notesId = `due-notes-${orderId}`
  return (
    <Stack gap={0} align="flex-start">
      <Anchor
        component="button"
        type="button"
        size="sm"
        fw={pressed ? 700 : undefined}
        aria-pressed={pressed}
        aria-label={`注番${orderId} 納期${shortDate(due)} 受注と納期回答を開く`}
        aria-describedby={missed > 0 || unanswered > 0 ? notesId : undefined}
        onClick={onOpen}
      >
        {shortDate(due)}
      </Anchor>
      <span id={notesId}>
        {missed > 0 && (
          <Text span display="block" size="xs" c="red" fw={700} style={{ whiteSpace: 'nowrap' }}>
            回答に遅れ{missed}件
          </Text>
        )}
        {unanswered > 0 && (
          <Text span display="block" size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
            未回答{unanswered}件
          </Text>
        )}
      </span>
    </Stack>
  )
}

// The customer orders behind one open order, each promised date set against the forecast.
function DeliveriesPanel({
  orderId,
  deliveries,
  finish,
  onClose,
}: {
  orderId: string
  deliveries: Delivery[]
  finish: string | null
  onClose: () => void
}) {
  const title = `注番${orderId} の受注と納期回答`
  const panelRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [title, reduceMotion])

  return (
    <Paper component="section" withBorder p="md" aria-label={title} ref={panelRef}>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Group gap="sm">
          <Title order={3} size="h5">
            {title}
          </Title>
          <Text size="sm" c="dimmed">
            完成見込み {finish ? shortDateTime(finish) : '—'}
          </Text>
        </Group>
        <CloseButton onClick={onClose} aria-label="閉じる" />
      </Group>
      {deliveries.length === 0 ? (
        <Text size="sm" c="dimmed">
          受注の記録はありません
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={680}>
          <Table striped verticalSpacing={6} horizontalSpacing={8}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>受注番号</Table.Th>
                <Table.Th>取引先</Table.Th>
                <Table.Th>販路</Table.Th>
                <Table.Th ta="right">数量</Table.Th>
                <Table.Th>希望納期</Table.Th>
                <Table.Th>回答納期</Table.Th>
                <Table.Th>完成見込みと比べて</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {deliveries.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Th scope="row" fw={400}>
                    {entry.id}
                  </Table.Th>
                  <Table.Td>{entry.customer}</Table.Td>
                  <Table.Td>{entry.channel === 'distributor' ? '代理店' : '直販'}</Table.Td>
                  <Table.Td ta="right" className="tabular">
                    {entry.quantity}個
                  </Table.Td>
                  <Table.Td>{shortDate(entry.requested)}</Table.Td>
                  <Table.Td>{entry.answered ? shortDate(entry.answered) : '未回答'}</Table.Td>
                  <Table.Td>
                    {entry.unplanned ? (
                      <Text span size="sm" c="red" fw={700}>
                        計画に入らない
                      </Text>
                    ) : entry.daysLate === null ? (
                      '—'
                    ) : entry.daysLate > 0 ? (
                      <Text span size="sm" c="red" fw={700}>
                        {entry.daysLate}日遅れる
                      </Text>
                    ) : (
                      '間に合う'
                    )}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Paper>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'teal' | 'orange' }) {
  return (
    <Paper withBorder p="sm">
      <Text size="xs" c="dimmed" className="phrase">
        {label}
      </Text>
      <Text c={tone} className="metric-value tabular">
        {value}
      </Text>
    </Paper>
  )
}

function OverallCell({ summary, warned, onOpen }: { summary: ProgressSummary; warned: boolean; onOpen: () => void }) {
  // Only non-empty parts are drawn, so the 2px gaps separate real segments.
  const segments = [
    { className: 'seg-unstarted', value: summary.unstarted },
    { className: 'seg-wip', value: summary.wip },
    { className: 'seg-done', value: summary.finished },
  ].filter((segment) => segment.value > 0)
  const extra = [
    summary.unstarted > 0 ? `未着手${summary.unstarted}` : '',
    summary.finished > 0 ? `完成${summary.finished}` : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <button className="overall" onClick={onOpen} aria-label={`工程全体 ${percent(summary.ratio)} 仕掛Lot一覧を開く`}>
      <span className="overall-top">
        <strong>{percent(summary.ratio)}</strong>
        {warned && <WarnIcon />}
      </span>
      <span className="segbar" aria-hidden="true">
        {segments.map((segment) => (
          <span key={segment.className} className={segment.className} style={{ flex: `${segment.value} 1 0` }} />
        ))}
      </span>
      <span className="overall-wip">{summary.wip > 0 ? `仕掛${summary.wip}個/${summary.wipLots.length}Lot` : '仕掛なし'}</span>
      <span className="overall-extra">{extra || '\u00a0'}</span>
    </button>
  )
}

function StepChip({
  summary,
  index,
  warned,
  onOpen,
}: {
  summary: ProgressSummary
  index: number
  warned: boolean
  onOpen: () => void
}) {
  const step = summary.steps[index]
  const ratio = step.ratio
  if (ratio >= 1) {
    return (
      <button className="chip chip-done" onClick={onOpen}>
        <span className="chip-line">
          <span>✓ {step.name}</span>
          <span>完了</span>
        </span>
        <span className="chip-line chip-sub">
          {step.done}/{summary.quantity}
        </span>
      </button>
    )
  }
  const idle = step.done === 0 && step.wipQuantity === 0
  const tone = ratio >= 0.67 ? 'high' : ratio >= 0.34 ? 'mid' : 'low'
  const sub =
    step.wipQuantity > 0
      ? `${step.wipQuantity}個/${step.lots.length}Lot`
      : index === 0 && summary.unstarted > 0
        ? `未着手${summary.unstarted}`
        : '—'
  return (
    <button className={`chip chip-${tone}${idle ? ' chip-idle' : ''}`} onClick={onOpen}>
      <span className="chip-fill" style={{ width: percent(ratio) }} aria-hidden="true" />
      <span className="chip-line">
        <span className="chip-name">
          <span className="chip-dot" aria-hidden="true" />
          {step.name}
        </span>
        <span>{percent(ratio)}</span>
      </span>
      <span className="chip-line chip-sub">
        {sub}
        {warned && <WarnIcon />}
      </span>
    </button>
  )
}

function WarnIcon() {
  return (
    <span className="warn-icon" role="img" aria-label="長く止まっているLotあり">
      ⚠
    </span>
  )
}

// Where the work sits now: processes grouped by crew across, urgency down. Each cell,
// place and urgency opens its lots. Right under the two rows of this month, a row
// shows how far this month's pieces have got through each process.
function WipBoard({
  columns,
  lateOrders,
  isWarned,
  selected,
  onSelect,
}: {
  columns: WipColumn[]
  lateOrders: Set<string>
  isWarned: (lot: Lot) => boolean
  selected: { column: number | null; urgency: Urgency | null } | null
  onSelect: (column: number | null, urgency: Urgency | null) => void
}) {
  const isSelected = (column: number | null, urgency: Urgency | null) =>
    selected !== null && selected.column === column && selected.urgency === urgency
  const hasCrews = columns.some((column) => column.crew !== null)
  // Runs of columns that share a place: the unreleased pieces, each crew, the finished lots.
  const groups: { start: number; span: number; crew: string | null }[] = []
  columns.forEach((column, index) => {
    const last = groups.at(-1)
    if (last && !startsGroup(index)) last.span += 1
    else groups.push({ start: index, span: 1, crew: column.crew })
  })
  function startsGroup(index: number) {
    if (index === 0) return true
    const [previous, column] = [columns[index - 1], columns[index]]
    return previous.kind !== column.kind || previous.crew !== column.crew
  }
  const groupClass = (index: number) => (index > 0 && startsGroup(index) ? 'wip-group-start' : undefined)
  const total = (column: WipColumn) => mergeCells(URGENCIES.map((urgency) => column.cells[urgency]))
  const urgencyRow = (urgency: Urgency) => (
    <tr key={urgency}>
      <th scope="row" className="sticky-col">
        <HeadButton selected={isSelected(null, urgency)} onClick={() => onSelect(null, urgency)} align="left">
          <UrgencyLabel urgency={urgency} />
        </HeadButton>
      </th>
      {columns.map((column, index) => {
        // Finished lots no longer wait or run late.
        const open = column.kind !== 'finished'
        const cell = column.cells[urgency]
        return (
          <td key={index} className={groupClass(index)}>
            <WipCellButton
              cell={cell}
              label={`${placeLabel(column)}・${URGENCY_LABELS[urgency]}`}
              className={`wip-cell urgency-${urgency.charAt(0)}`}
              late={open && cellOrders(cell).some((orderId) => lateOrders.has(orderId))}
              warned={open && cell.lots.some(isWarned)}
              selected={isSelected(index, urgency)}
              onClick={() => onSelect(index, urgency)}
            />
          </td>
        )
      })}
    </tr>
  )

  return (
    <Paper withBorder className="table-wrap wip-wrap">
      <table className="wip-board" style={{ '--wip-columns': columns.length } as CSSProperties}>
        <colgroup span={1} />
        {groups.map((group) => (
          <colgroup key={group.start} span={group.span} />
        ))}
        <thead>
          {hasCrews && (
            <tr>
              <td className="sticky-col" />
              {groups.map((group) =>
                group.crew === null ? (
                  <td key={group.start} colSpan={group.span} className={groupClass(group.start)} />
                ) : (
                  <th key={group.start} colSpan={group.span} scope="colgroup" className={`wip-crew ${groupClass(group.start) ?? ''}`}>
                    {group.crew}
                  </th>
                ),
              )}
            </tr>
          )}
          <tr>
            <td className="sticky-col" />
            {columns.map((column, index) => (
              <th key={index} scope="col" className={groupClass(index)}>
                <HeadButton selected={isSelected(index, null)} onClick={() => onSelect(index, null)}>
                  {placeLabel(column)}
                </HeadButton>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {urgencyRow('A-stockout')}
          {urgencyRow('A-due')}
          <tr className="wip-month">
            <th scope="row" className="sticky-col">
              <span className="wip-month-head">
                <ClassBadge value="A" />
                <span className="wip-month-label">通過</span>
              </span>
            </th>
            {columns.map((column, index) => (
              <td key={index} className={groupClass(index)}>
                {column.kind === 'process' && <ThisMonthBar column={column} />}
              </td>
            ))}
          </tr>
          {urgencyRow('B')}
          {urgencyRow('C')}
          <tr className="wip-total">
            <th scope="row" className="sticky-col">
              計
            </th>
            {columns.map((column, index) => {
              const cell = total(column)
              return (
                <td key={index} className={groupClass(index)}>
                  {cell.quantity === 0 ? (
                    <span className="wip-empty">—</span>
                  ) : (
                    <span className="wip-count">
                      <strong>{cell.quantity}個</strong>
                      <span>{cell.lots.length > 0 ? `${cell.lots.length}Lot` : ' '}</span>
                    </span>
                  )}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
    </Paper>
  )
}

function HeadButton({
  selected,
  onClick,
  align,
  children,
}: {
  selected: boolean
  onClick: () => void
  align?: 'left'
  children: ReactNode
}) {
  return (
    <button
      className={`wip-head${selected ? ' is-selected' : ''}`}
      style={align ? { textAlign: align, alignItems: 'flex-start' } : undefined}
      aria-pressed={selected}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

// How far this month's pieces have got through the process, in the same order and
// colors as the overall bar of each order: still before it, here now, passed.
function ThisMonthBar({ column }: { column: WipColumn }) {
  const month = column.thisMonth
  if (!month) return <span className="wip-empty">—</span>
  const segments = [
    { className: 'seg-unstarted', value: month.quantity - month.passed - month.here },
    { className: 'seg-wip', value: month.here },
    { className: 'seg-done', value: month.passed },
  ].filter((segment) => segment.value > 0)
  return (
    <span className="wip-bar">
      <span className="segbar" aria-hidden="true">
        {segments.map((segment) => (
          <span key={segment.className} className={segment.className} style={{ flex: `${segment.value} 1 0` }} />
        ))}
      </span>
      <span className="wip-ratio" aria-hidden="true">
        {month.passed}/{month.quantity}
      </span>
      <VisuallyHidden>
        今月分{month.quantity}個のうち、通過{month.passed}個、ここに{month.here}個
      </VisuallyHidden>
    </span>
  )
}

function UrgencyLabel({ urgency }: { urgency: Urgency }) {
  if (urgency === 'B' || urgency === 'C') return <ClassBadge value={urgency} />
  return (
    <>
      <ClassBadge value="A" />
      <span className="wip-reason">
        {urgency === 'A-stockout' ? <IconPackageOff size={14} aria-hidden /> : <IconCalendarDue size={14} aria-hidden />}
        {urgency === 'A-stockout' ? '在庫切れ' : '納期'}
      </span>
    </>
  )
}

function WipCellButton({
  cell,
  label,
  className,
  late,
  warned,
  selected,
  onClick,
}: {
  cell: WipCell
  label: string
  className: string
  late: boolean
  warned: boolean
  selected: boolean
  onClick: () => void
}) {
  if (cell.quantity === 0) return <span className="wip-empty">—</span>
  const lots = cell.lots.length > 0 ? `${cell.lots.length}Lot` : ''
  const notes = [late ? '納期に遅れる注番あり' : '', warned ? '長く止まっているLotあり' : ''].filter(Boolean)
  return (
    <button
      className={`${className}${selected ? ' is-selected' : ''}`}
      aria-pressed={selected}
      aria-label={[`${label} ${cell.quantity}個${lots ? ` ${lots}` : ''}`, ...notes].join('、')}
      onClick={onClick}
    >
      <span className="wip-count">
        <strong>
          {cell.quantity}個
          {late && <IconClockExclamation size={13} className="wip-late" aria-hidden />}
          {warned && <WarnIcon />}
        </strong>
        <span>{lots || ' '}</span>
      </span>
    </button>
  )
}

function placeLabel(column: WipColumn): string {
  if (column.kind === 'unreleased') return '未投入'
  if (column.kind === 'finished') return '完成'
  return column.process ?? ''
}

function cellOrders(cell: WipCell): string[] {
  return [...cell.lots.map((lot) => lot.orderId), ...cell.unreleased.map((item) => item.orderId)]
}

function mergeCells(cells: WipCell[]): WipCell {
  return {
    quantity: cells.reduce((total, cell) => total + cell.quantity, 0),
    lots: cells.flatMap((cell) => cell.lots),
    unreleased: cells.flatMap((cell) => cell.unreleased),
  }
}

// The lots behind a cell, a process or an urgency of the board.
function boardPanel(columns: WipColumn[], selection: { column: number | null; urgency: Urgency | null }) {
  const picked = selection.column === null ? columns : [columns[selection.column]]
  const urgencies = selection.urgency === null ? URGENCIES : [selection.urgency]
  const cell = mergeCells(picked.flatMap((column) => urgencies.map((urgency) => column.cells[urgency])))
  const place = selection.column === null ? '' : placeLabel(columns[selection.column])
  const urgency = selection.urgency === null ? '' : URGENCY_LABELS[selection.urgency]
  return { title: `${[place, urgency].filter(Boolean).join('・')} の一覧`, lots: cell.lots, unreleased: cell.unreleased }
}

function LotPanel({
  title,
  lots,
  unreleased,
  highlightLot,
  claimFocus,
  plan,
  today,
  warningDays,
  onClose,
}: {
  title: string
  lots: Lot[]
  unreleased: WipCell['unreleased']
  highlightLot?: string
  claimFocus?: () => boolean
  plan: Plan
  today: IsoDate
  warningDays: number
  onClose: () => void
}) {
  const { data } = plan.scenario
  const orders = new Map(data.orders.map((order) => [order.id, order]))
  const equipmentNames = new Map(data.equipment.map((equipment) => [equipment.id, equipment.name]))
  const routeOf = (orderId: string) => data.routes[orders.get(orderId)?.partNumber ?? ''] ?? []
  const nextOperation = (lotId: string, stepIndex: number) =>
    plan.result.operations.find((operation) => operation.lotId === lotId && operation.stepIndex === stepIndex)
  const stepLabel = (orderId: string, stepIndex: number) => {
    const route = routeOf(orderId)
    return stepIndex < route.length ? `工程${stepIndex + 1} ${route[stepIndex].name}` : '完成'
  }
  const entries = [
    ...lots.map((lot) => ({
      key: lot.id,
      lotId: lot.id,
      lot: lot.id,
      orderId: lot.orderId,
      step: stepLabel(lot.orderId, lot.stepIndex),
      quantity: lot.quantity,
      // Finished lots no longer wait.
      days: lot.stepIndex < routeOf(lot.orderId).length ? stagnantDays(lot, today) : null,
      operation: nextOperation(lot.id, lot.stepIndex),
    })),
    ...unreleased.map((item) => {
      // The pieces not yet released run under the Lot number they will get.
      const operation = plan.result.operations.find(
        (candidate) => candidate.orderId === item.orderId && candidate.planned && candidate.stepIndex === 0,
      )
      return {
        key: `${item.orderId}-planned`,
        lotId: operation?.lotId,
        lot: operation ? `${operation.lotId} 予定` : '未投入',
        orderId: item.orderId,
        step: stepLabel(item.orderId, 0),
        quantity: item.quantity,
        days: null,
        operation,
      }
    }),
  ].sort(
    (a, b) =>
      (orders.get(a.orderId)?.due ?? '').localeCompare(orders.get(b.orderId)?.due ?? '') || a.key.localeCompare(b.key),
  )

  const panelRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  // The panel opens below a table, often under the fold.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [title, reduceMotion])
  // A lot's own record of the steps it has been through opens under the list.
  const [historyOf, setHistoryOf] = useState<string | null>(null)
  const lotIds = new Set(lots.map((lot) => lot.id))
  // A lot asked for from the Gantt chart is marked, and keyboard focus goes to it the first time.
  const highlightRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (highlightLot && claimFocus?.()) highlightRef.current?.focus()
  }, [highlightLot, claimFocus])

  return (
    <Paper component="section" withBorder p="md" aria-label={title} ref={panelRef}>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Group gap="sm">
          <Title order={3} size="h5">
            {title}
          </Title>
          <Text size="sm" c="dimmed">
            {entries.reduce((total, entry) => total + entry.quantity, 0)}個
            {lots.length > 0 && ` / ${lots.length}Lot`}
          </Text>
        </Group>
        <CloseButton onClick={onClose} aria-label="閉じる" />
      </Group>
      {entries.length === 0 ? (
        <Text size="sm" c="dimmed">
          該当するLotはありません
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table striped highlightOnHover verticalSpacing={6} horizontalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Lot</Table.Th>
                <Table.Th>注番</Table.Th>
                <Table.Th>工程</Table.Th>
                <Table.Th ta="right">数量</Table.Th>
                <Table.Th ta="right">滞留</Table.Th>
                <Table.Th>納期</Table.Th>
                <Table.Th>この工程の加工予定</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {entries.map((entry) => {
                const warned = entry.days !== null && entry.days >= warningDays
                return (
                  <Table.Tr
                    key={entry.key}
                    ref={entry.lotId === highlightLot ? highlightRef : undefined}
                    tabIndex={entry.lotId === highlightLot ? -1 : undefined}
                    className={entry.lotId === highlightLot ? 'is-chosen' : undefined}
                    aria-current={entry.lotId === highlightLot || undefined}
                  >
                    <Table.Td>
                      {lotIds.has(entry.lot) ? (
                        <Anchor
                          component="button"
                          type="button"
                          size="sm"
                          aria-expanded={historyOf === entry.lot}
                          onClick={() => setHistoryOf((current) => (current === entry.lot ? null : entry.lot))}
                        >
                          {entry.lot}
                        </Anchor>
                      ) : (
                        entry.lot
                      )}
                    </Table.Td>
                    <Table.Td>{entry.orderId}</Table.Td>
                    <Table.Td>{entry.step}</Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {entry.quantity}個
                    </Table.Td>
                    <Table.Td ta="right" className="tabular" c={warned ? 'red' : undefined} fw={warned ? 700 : undefined}>
                      {entry.days === null ? '—' : `${entry.days}日`}
                    </Table.Td>
                    <Table.Td>{shortDate(orders.get(entry.orderId)?.due)}</Table.Td>
                    <Table.Td>
                      {entry.operation
                        ? `${shortDateTime(entry.operation.startAt)}〜 ${equipmentNames.get(entry.operation.equipmentId) ?? entry.operation.equipmentId}`
                        : '—'}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {historyOf && (
        <LotHistory
          lotId={historyOf}
          history={lotHistory(data, historyOf)}
          stepLabel={(stepIndex) => stepLabel(lots.find((lot) => lot.id === historyOf)?.orderId ?? '', stepIndex)}
          equipmentNames={equipmentNames}
        />
      )}
    </Paper>
  )
}

// The steps one lot has been through, as recorded on the shop floor.
function LotHistory({
  lotId,
  history,
  stepLabel,
  equipmentNames,
}: {
  lotId: string
  history: Actual[]
  stepLabel: (stepIndex: number) => string
  equipmentNames: Map<string, string>
}) {
  const headingRef = useRef<HTMLHeadingElement>(null)
  const sectionRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  // Keyboard focus follows the record that just opened (WCAG 2.4.3), and it scrolls into view.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
    sectionRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [lotId, reduceMotion])

  return (
    <Stack gap={6} mt="md" ref={sectionRef}>
      <Title order={4} size="h6" ref={headingRef} tabIndex={-1}>
        {lotId} の実績
      </Title>
      {history.length === 0 ? (
        <Text size="sm" c="dimmed">
          記録はありません
        </Text>
      ) : (
        <Table.ScrollContainer minWidth={560}>
          <Table verticalSpacing={4} horizontalSpacing={8}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>工程</Table.Th>
                <Table.Th>設備</Table.Th>
                <Table.Th>開始</Table.Th>
                <Table.Th>終了</Table.Th>
                <Table.Th ta="right">良品</Table.Th>
                <Table.Th ta="right">不良</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {history.map((actual) => (
                <Table.Tr key={actual.stepIndex}>
                  <Table.Th scope="row" fw={400}>
                    {stepLabel(actual.stepIndex)}
                  </Table.Th>
                  <Table.Td>{equipmentNames.get(actual.equipmentId) ?? actual.equipmentId}</Table.Td>
                  <Table.Td className="tabular">{shortDateTime(actual.start)}</Table.Td>
                  <Table.Td className="tabular">{shortDateTime(actual.end)}</Table.Td>
                  <Table.Td ta="right" className="tabular">
                    {actual.good}個
                  </Table.Td>
                  <Table.Td ta="right" className="tabular" c={actual.defect > 0 ? 'red' : undefined}>
                    {actual.defect}個
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  )
}
