import {
  Badge,
  CloseButton,
  Group,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import { IconCalendarDue, IconClockExclamation, IconPackageOff } from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import { orderDemands, type PriorityClass } from '../engine/demand'
import type { Plan } from '../engine/plan'
import {
  stagnantDays,
  summarizeProgress,
  summarizeWip,
  URGENCIES,
  type ProgressSummary,
  type Urgency,
  type WipCell,
  type WipColumn,
} from '../engine/progress'
import type { OrderForecast } from '../engine/scheduler'
import type { IsoDate, Lot, Order } from '../engine/types'
import { percent, shortDate, shortDateTime } from './format'
import { ClassBadge } from './OutlookView'

type Props = {
  plan: Plan
  today: IsoDate
  warningDays: number
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

type Selection =
  | { kind: 'row'; rowKey: string; step: number | null }
  | { kind: 'board'; column: number | null; urgency: Urgency | null }

const URGENCY_LABELS: Record<Urgency, string> = {
  'A-stockout': 'A 今月・在庫切れ',
  'A-due': 'A 今月・納期',
  B: 'B 来月',
  C: 'C 以降',
}

export function ProgressView({ plan, today, warningDays }: Props) {
  const [mode, setMode] = useState<'order' | 'part'>('order')
  const [selection, setSelection] = useState<Selection | null>(null)
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

  const wip = useMemo(() => summarizeWip(data, orderDemands(data, today)), [data, today])
  const lateOrders = new Set(plan.result.orders.filter((forecast) => forecast.late).map((forecast) => forecast.orderId))

  const rows = mode === 'order' ? orderRows : partRows
  const stepCount = Math.max(1, ...rows.map((row) => row.route.length))
  const selectedRow = selection?.kind === 'row' ? (rows.find((row) => row.key === selection.rowKey) ?? null) : null
  const isWarned = (lot: Lot) => stagnantDays(lot, today) >= warningDays
  // Closing a panel returns focus to what opened it.
  const opener = useRef<HTMLElement | null>(null)
  const open = (next: Selection) => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelection(next)
  }
  const close = () => {
    setSelection(null)
    opener.current?.focus()
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
      {selection?.kind === 'board' && <LotPanel {...boardPanel(wip, selection)} {...panelProps} />}

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

      <Paper withBorder className="table-wrap">
        <table className="progress-table">
          <thead>
            <tr>
              {mode === 'order' ? (
                <>
                  <th>注番</th>
                  <th>型番</th>
                  <th className="num">数量</th>
                  <th>納期</th>
                </>
              ) : (
                <>
                  <th>型番</th>
                  <th className="num">注残</th>
                  <th className="num">数量</th>
                  <th>最短納期</th>
                </>
              )}
              <th>完成見込み</th>
              <th className="col-overall">工程全体</th>
              {Array.from({ length: stepCount }, (_, index) => (
                <th key={index}>工程{index + 1}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={selection?.kind === 'row' && selection.rowKey === row.key ? 'is-selected' : undefined}
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
                    <td>{shortDate(row.orders[0].due)}</td>
                  </>
                ) : (
                  <>
                    <td>{row.label}</td>
                    <td className="num">{row.orders.length}件</td>
                    <td className="num">{row.summary.quantity}</td>
                    <td>{shortDate(row.orders.map((order) => order.due).sort()[0])}</td>
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
          </tbody>
        </table>
      </Paper>

      {selectedRow && selection?.kind === 'row' && (
        <LotPanel
          title={
            selection.step === null
              ? `${selectedRow.label} の仕掛Lot一覧（全工程）`
              : `${selectedRow.label}・工程${selection.step + 1} ${selectedRow.route[selection.step]} の仕掛Lot一覧`
          }
          lots={selection.step === null ? selectedRow.summary.wipLots : selectedRow.summary.steps[selection.step].lots}
          unreleased={[]}
          {...panelProps}
        />
      )}
    </Stack>
  )

  function switchMode(next: 'order' | 'part') {
    setMode(next)
    if (selection?.kind === 'row') setSelection(null)
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

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'teal' | 'orange' }) {
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
  plan,
  today,
  warningDays,
  onClose,
}: {
  title: string
  lots: Lot[]
  unreleased: WipCell['unreleased']
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
                  <Table.Tr key={entry.key}>
                    <Table.Td>{entry.lot}</Table.Td>
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
    </Paper>
  )
}
