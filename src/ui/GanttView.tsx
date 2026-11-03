import {
  Anchor,
  CloseButton,
  Group,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Table,
  Text,
  Title,
  VisuallyHidden,
} from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import { IconHistory } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { ProposedOption } from '../assistant/tools'
import { addDays, daysBetween, MINUTES_PER_DAY, parseClock, weekday } from '../engine/dates'
import type { Plan } from '../engine/plan'
import type { ScheduledOperation } from '../engine/scheduler'
import type { Equipment, IsoDate } from '../engine/types'
import { shortDate, shortDateTime } from './format'

type Props = {
  plan: Plan
  today: IsoDate
  highlight: ProposedOption | null
}

// A bar shows how one lot flows through its steps; an equipment shows everything it runs.
// Kept by lot, step and order, so it survives the plan being rebuilt; a planned Lot
// number that a what-if hands to another order no longer matches.
type Selection =
  | { kind: 'operation'; lotId: string; stepIndex: number; orderId: string }
  | { kind: 'equipment'; id: string }

const ZOOMS = [
  { label: '小', dayWidth: 90 },
  { label: '中', dayWidth: 150 },
  { label: '大', dayWidth: 260 },
]
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']
const TONE_NAMES = { late: '、納期に遅れる', tight: '、納期まで1日以内', ok: '' }
const NO_FOCUS = 'none'

export function GanttView({ plan, today, highlight }: Props) {
  const [zoom, setZoom] = useState(1)
  const [focusOrder, setFocusOrder] = useState('')
  const [selection, setSelection] = useState<Selection | null>(null)
  // Set when the planner opens a panel and cleared once focus has moved to it, so a
  // what-if that hides the panel and brings it back leaves focus alone.
  const [focusPending, setFocusPending] = useState(false)
  const focused = useCallback(() => setFocusPending(false), [])
  const { scenario, result } = plan
  const { settings, data } = scenario
  const dayWidth = ZOOMS[zoom].dayWidth
  const days = settings.horizonDays

  // Closing a panel returns focus to what opened it.
  const opener = useRef<HTMLElement | null>(null)
  const toggle = (next: Selection, from?: HTMLElement | null) => {
    if (sameSelection(selection, next)) return close()
    opener.current = from ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    setSelection(next)
    setFocusPending(true)
  }
  const close = () => {
    setSelection(null)
    if (opener.current?.isConnected) opener.current.focus()
  }
  const barKey = (operation: ScheduledOperation) => `${operation.lotId}-${operation.stepIndex}`
  const operationSelection = (operation: ScheduledOperation): Selection => ({
    kind: 'operation',
    lotId: operation.lotId,
    stepIndex: operation.stepIndex,
    orderId: operation.orderId,
  })
  // From the equipment's table, focus comes back to the lot's bar in the chart, or to
  // its equipment when the bar is past the days shown.
  const openLot = (operation: ScheduledOperation) =>
    toggle(
      operationSelection(operation),
      document.querySelector<HTMLElement>(`.gantt-bar[data-op="${CSS.escape(barKey(operation))}"]`) ??
        document.querySelector<HTMLElement>(`.gantt-equipment[data-eq="${CSS.escape(operation.equipmentId)}"]`),
    )

  // Each day shows working hours only, widened to fit any overtime.
  const displayStart = parseClock(settings.workStart)
  const displayEnd = Math.max(
    parseClock(settings.workEnd) + Math.max(0, ...scenario.overtime.map((entry) => entry.minutesPerDay)),
    displayStart + 60,
  )
  const x = (minute: number) => {
    const day = Math.floor(minute / MINUTES_PER_DAY)
    const within = Math.min(Math.max(minute - day * MINUTES_PER_DAY - displayStart, 0), displayEnd - displayStart)
    return day * dayWidth + (within / (displayEnd - displayStart)) * dayWidth
  }

  const forecasts = useMemo(() => new Map(result.orders.map((forecast) => [forecast.orderId, forecast])), [result])
  const dueByOrder = useMemo(() => new Map(data.orders.map((order) => [order.id, order.due])), [data])
  const shapes = useMemo(() => new Map(data.parts.map((part) => [part.partNumber, part.shape])), [data])
  const operationsOn = useMemo(() => {
    const byEquipment = new Map<string, ScheduledOperation[]>()
    for (const operation of [...result.operations].sort((a, b) => a.start - b.start)) {
      byEquipment.set(operation.equipmentId, [...(byEquipment.get(operation.equipmentId) ?? []), operation])
    }
    return byEquipment
  }, [result])
  // The part each operation's equipment ran just before it, which its setup is from.
  const previousPart = useMemo(() => {
    const previous = new Map<ScheduledOperation, string | null>()
    for (const equipment of data.equipment) {
      let last = equipment.lastPart || null
      for (const operation of operationsOn.get(equipment.id) ?? []) {
        previous.set(operation, last)
        last = operation.partNumber
      }
    }
    return previous
  }, [data, operationsOn])

  // Rebuilding the plan can remove what was chosen; then nothing is.
  const selectedOperation =
    selection?.kind === 'operation'
      ? result.operations.find(
          (operation) =>
            operation.lotId === selection.lotId &&
            operation.stepIndex === selection.stepIndex &&
            operation.orderId === selection.orderId,
        )
      : undefined
  const selectedEquipment =
    selection?.kind === 'equipment' ? data.equipment.find((equipment) => equipment.id === selection.id) : undefined
  const selectedLot = selectedOperation?.lotId ?? null
  const highlighted = new Set([
    ...(highlight?.effect.comparison.shifted.map((shift) => shift.orderId) ?? []),
    ...(focusOrder ? [focusOrder] : []),
  ])
  // A chosen lot comes first; otherwise the orders an option moves, or the one picked above.
  const isDim = (operation: ScheduledOperation) =>
    selectedLot !== null ? operation.lotId !== selectedLot : highlighted.size > 0 && !highlighted.has(operation.orderId)
  const dates = Array.from({ length: days }, (_, index) => addDays(today, index))

  const tone = (operation: ScheduledOperation) => {
    const forecast = forecasts.get(operation.orderId)
    if (forecast?.late) return 'late'
    const due = dueByOrder.get(operation.orderId)
    if (due && forecast?.finishDate && daysBetween(forecast.finishDate, due) <= 1) return 'tight'
    return 'ok'
  }
  const lotLabel = (operation: ScheduledOperation) => (operation.planned ? `${operation.lotId} 予定` : operation.lotId)
  const partLabel = (partNumber: string) => `${partNumber} ${shapes.get(partNumber) ?? ''}`.trim()
  const setupLabel = (operation: ScheduledOperation) => {
    const from = previousPart.get(operation) ?? null
    if (operation.setupMinutes > 0) {
      return `${operation.setupMinutes}分（${shapes.get(from ?? '') ?? from} → ${shapes.get(operation.partNumber)}）`
    }
    return from === operation.partNumber ? 'なし（同じ型番）' : 'なし'
  }

  return (
    <Stack gap="md">
      <Group gap="md" wrap="wrap" align="flex-end">
        <SegmentedControl
          value={String(zoom)}
          onChange={(value) => setZoom(Number(value))}
          data={ZOOMS.map((item, index) => ({ value: String(index), label: item.label }))}
          aria-label="表示の幅"
        />
        <Select
          label="強調する注番"
          value={focusOrder || NO_FOCUS}
          onChange={(value) => setFocusOrder(!value || value === NO_FOCUS ? '' : value)}
          data={[
            { value: NO_FOCUS, label: 'なし' },
            ...data.orders.map((order) => ({ value: order.id, label: `${order.id}（${order.partNumber}）` })),
          ]}
          allowDeselect={false}
          w={200}
        />
        <Group gap="md" className="legend" h={36}>
          <span className="legend-item bar-ok">余裕あり</span>
          <span className="legend-item bar-tight">納期まで1日以内</span>
          <span className="legend-item bar-late">納期に遅れる</span>
          <span className="legend-item bar-setup">段取り</span>
          <span className="legend-item bar-planned">投入予定</span>
          <span className="legend-item bar-down">設備停止</span>
        </Group>
      </Group>

      <Paper withBorder className="gantt-scroll">
        <div className="gantt-grid" style={{ width: 188 + days * dayWidth }}>
          <div className="gantt-row gantt-head">
            <div className="gantt-label">設備</div>
            <div className="gantt-track" style={{ width: days * dayWidth }}>
              {dates.map((date, index) => (
                <div
                  key={date}
                  className={`gantt-day${isOff(settings.workWeekdays, date) ? ' is-off' : ''}`}
                  style={{ left: index * dayWidth, width: dayWidth }}
                >
                  {shortDate(date)}（{WEEKDAY_NAMES[weekday(date)]}）
                </div>
              ))}
            </div>
          </div>

          {data.equipment.map((equipment) => {
            const stopped = settings.stoppedEquipment.includes(equipment.id)
            const operations = operationsOn.get(equipment.id) ?? []
            const down = scenario.downtime.filter((entry) => entry.equipmentId === equipment.id)
            const extra = scenario.holidayWork.filter((entry) => entry.equipmentId === equipment.id)
            const pressed = selectedEquipment?.id === equipment.id
            return (
              <div
                key={equipment.id}
                className={['gantt-row', stopped ? 'is-stopped' : '', pressed ? 'is-selected' : ''].filter(Boolean).join(' ')}
              >
                <div className="gantt-label">
                  <button
                    className="gantt-equipment"
                    data-eq={equipment.id}
                    aria-pressed={pressed}
                    onClick={() => toggle({ kind: 'equipment', id: equipment.id })}
                  >
                    <strong>{equipment.name}</strong>
                    <span>{stopped ? '停止中' : equipment.process}</span>
                    {equipment.lastPart && (
                      <span className="gantt-last">
                        <VisuallyHidden>直前の加工</VisuallyHidden>
                        <IconHistory size={12} aria-hidden />
                        {partLabel(equipment.lastPart)}
                      </span>
                    )}
                  </button>
                </div>
                <div className="gantt-track" style={{ width: days * dayWidth }}>
                  {dates.map((date, index) => {
                    const off = isOff(settings.workWeekdays, date) && !extra.some((entry) => entry.date === date)
                    const isDown = down.some((entry) => date >= entry.from && date <= entry.to)
                    return off || isDown ? (
                      <div
                        key={date}
                        className={`gantt-shade${isDown ? ' is-down' : ''}`}
                        style={{ left: index * dayWidth, width: dayWidth }}
                      />
                    ) : null
                  })}
                  {operations.map((operation) => {
                    const left = x(operation.start)
                    const width = Math.max(x(operation.end) - left, 8)
                    const setupWidth = operation.setupMinutes > 0 ? x(operation.setupEnd) - left : 0
                    if (left > days * dayWidth) return null
                    const chosen = selectedOperation === operation
                    const detail = `${partLabel(operation.partNumber)}・${operation.quantity}個`
                    return (
                      <button
                        key={barKey(operation)}
                        data-op={barKey(operation)}
                        className={[
                          'gantt-bar',
                          `bar-${tone(operation)}`,
                          operation.planned ? 'is-planned' : '',
                          isDim(operation) ? 'is-dim' : '',
                          chosen ? 'is-selected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{ left, width }}
                        aria-pressed={chosen}
                        aria-label={`${lotLabel(operation)} ${detail} ${operation.stepName} ${shortDateTime(operation.startAt)}〜${shortDateTime(operation.endAt)}${TONE_NAMES[tone(operation)]}`}
                        title={`${lotLabel(operation)}（注番${operation.orderId}）${operation.stepName} ${shortDateTime(operation.startAt)}〜${shortDateTime(operation.endAt)}`}
                        onClick={() => toggle(operationSelection(operation))}
                      >
                        {setupWidth > 0 && <span className="bar-setup-part" style={{ width: setupWidth }} />}
                        <span className="bar-text">
                          <span className="bar-lot">{lotLabel(operation)}</span>
                          <span>{detail}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </Paper>

      {result.unscheduled.length > 0 && (
        <Text c="red" size="sm">
          計画に入れられなかった工程：
          {result.unscheduled
            .map((entry) => `${entry.planned ? `${entry.lotId} 予定` : entry.lotId} ${entry.stepName}（${entry.reason}）`)
            .join('、')}
        </Text>
      )}

      {selectedOperation && (
        <LotFlow
          focusPending={focusPending}
          onFocused={focused}
          operation={selectedOperation}
          plan={plan}
          lotLabel={lotLabel}
          partLabel={partLabel}
          setupLabel={setupLabel}
          onClose={close}
        />
      )}
      {selectedEquipment && (
        <EquipmentSchedule
          focusPending={focusPending}
          onFocused={focused}
          equipment={selectedEquipment}
          operations={operationsOn.get(selectedEquipment.id) ?? []}
          plan={plan}
          lotLabel={lotLabel}
          partLabel={partLabel}
          setupLabel={setupLabel}
          onOpenLot={openLot}
          onClose={close}
        />
      )}
    </Stack>
  )
}

type Labels = {
  focusPending: boolean
  onFocused: () => void
  plan: Plan
  lotLabel: (operation: ScheduledOperation) => string
  partLabel: (partNumber: string) => string
  setupLabel: (operation: ScheduledOperation) => string
  onClose: () => void
}

// Every step of the chosen bar's lot, in order, with the chosen step marked: the steps
// it has done, the planned ones, and any the plan could not place.
function LotFlow({
  focusPending,
  onFocused,
  operation,
  plan,
  lotLabel,
  partLabel,
  setupLabel,
  onClose,
}: Labels & { operation: ScheduledOperation }) {
  const { data } = plan.scenario
  const route = data.routes[operation.partNumber] ?? []
  const steps = plan.result.operations
    .filter((candidate) => candidate.lotId === operation.lotId)
    .sort((a, b) => a.stepIndex - b.stepIndex)
  const firstPlanned = steps[0]?.stepIndex ?? 0
  const unplaced = plan.result.unscheduled.filter(
    (entry) => entry.lotId === operation.lotId && entry.orderId === operation.orderId,
  )
  const late = plan.result.orders.find((candidate) => candidate.orderId === operation.orderId)?.late ?? false
  const due = data.orders.find((order) => order.id === operation.orderId)?.due
  const finish = unplaced.length === 0 ? steps.at(-1)?.endAt : undefined
  const equipmentNames = new Map(data.equipment.map((equipment) => [equipment.id, equipment.name]))
  const stepName = (index: number, name: string) => `工程${index + 1} ${name}`

  return (
    <Panel
      focusPending={focusPending}
      onFocused={onFocused}
      title={`${lotLabel(operation)}・${operation.partNumber}・${operation.quantity}個 の流れ`}
      summary={`注番 ${operation.orderId}　${partLabel(operation.partNumber)}　納期 ${shortDate(due)}　完成見込み ${finish ? shortDateTime(finish) : '—'}`}
      onClose={onClose}
    >
      <Table.ScrollContainer minWidth={720}>
        <Table verticalSpacing={6} horizontalSpacing={8}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>工程</Table.Th>
              <Table.Th>設備</Table.Th>
              <Table.Th>段取り</Table.Th>
              <Table.Th>開始</Table.Th>
              <Table.Th>終了</Table.Th>
              <Table.Th>次の工程まで</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {route.slice(0, firstPlanned).map((step, index) => (
              <Table.Tr key={`done-${index}`} className="is-before">
                <Table.Th scope="row">{stepName(index, step.name)}</Table.Th>
                <Table.Td>—</Table.Td>
                <Table.Td>—</Table.Td>
                <Table.Td>—</Table.Td>
                <Table.Td>—</Table.Td>
                <Table.Td>済み</Table.Td>
              </Table.Tr>
            ))}
            {steps.map((step, index) => {
              const next = steps[index + 1]
              const chosen = step === operation
              return (
                <Table.Tr key={step.stepIndex} className={chosen ? 'is-chosen' : undefined} aria-current={chosen || undefined}>
                  <Table.Th scope="row">{stepName(step.stepIndex, step.stepName)}</Table.Th>
                  <Table.Td>{equipmentNames.get(step.equipmentId) ?? step.equipmentId}</Table.Td>
                  <Table.Td>{setupLabel(step)}</Table.Td>
                  <Table.Td>{shortDateTime(step.startAt)}</Table.Td>
                  <Table.Td>{shortDateTime(step.endAt)}</Table.Td>
                  <Table.Td>
                    {next ? (
                      waitLabel(step, next)
                    ) : unplaced.length > 0 ? (
                      '—'
                    ) : (
                      <Text span size="sm" fw={700} c={late ? 'red' : undefined}>
                        {late ? '完成・遅れ' : '完成'}（納期 {shortDate(due)}）
                      </Text>
                    )}
                  </Table.Td>
                </Table.Tr>
              )
            })}
            {unplaced.map((entry) => (
              <Table.Tr key={`unplaced-${entry.stepIndex}`}>
                <Table.Th scope="row">{stepName(entry.stepIndex, entry.stepName)}</Table.Th>
                <Table.Td colSpan={5}>
                  <Text span size="sm" c="red">
                    計画に入らない：{entry.reason}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Panel>
  )
}

// Everything one equipment runs, in time order, after the part it ran last.
function EquipmentSchedule({
  focusPending,
  onFocused,
  equipment,
  operations,
  plan,
  lotLabel,
  partLabel,
  setupLabel,
  onOpenLot,
  onClose,
}: Labels & {
  equipment: Equipment
  operations: ScheduledOperation[]
  onOpenLot: (operation: ScheduledOperation) => void
}) {
  const forecasts = new Map(plan.result.orders.map((forecast) => [forecast.orderId, forecast]))
  const dueByOrder = new Map(plan.scenario.data.orders.map((order) => [order.id, order.due]))
  // A lot that passes the equipment twice counts once.
  const lotQuantities = new Map(operations.map((operation) => [operation.lotId, operation.quantity]))
  const pieces = [...lotQuantities.values()].reduce((total, quantity) => total + quantity, 0)
  const lots = lotQuantities.size

  return (
    <Panel
      focusPending={focusPending}
      onFocused={onFocused}
      title={`${equipment.name} の予定`}
      summary={`${equipment.process}　${pieces}個 / ${lots}Lot`}
      onClose={onClose}
    >
      <Table.ScrollContainer minWidth={900}>
        <Table verticalSpacing={6} horizontalSpacing={8}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>開始 〜 終了</Table.Th>
              <Table.Th>Lot</Table.Th>
              <Table.Th>注番</Table.Th>
              <Table.Th>型番・形状</Table.Th>
              <Table.Th ta="right">数量</Table.Th>
              <Table.Th>段取り</Table.Th>
              <Table.Th>納期</Table.Th>
              <Table.Th>完成見込み</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {equipment.lastPart && (
              <Table.Tr className="is-before">
                <Table.Th scope="row">
                  <Group gap={6} wrap="nowrap">
                    <IconHistory size={14} aria-hidden />
                    直前の加工
                  </Group>
                </Table.Th>
                <Table.Td>—</Table.Td>
                <Table.Td>—</Table.Td>
                <Table.Td>{partLabel(equipment.lastPart)}</Table.Td>
                <Table.Td ta="right">—</Table.Td>
                <Table.Td>—</Table.Td>
                <Table.Td>—</Table.Td>
                <Table.Td>—</Table.Td>
              </Table.Tr>
            )}
            {operations.map((operation) => (
              <Table.Tr key={`${operation.lotId}-${operation.stepIndex}`}>
                <Table.Th scope="row" style={{ whiteSpace: 'nowrap' }}>
                  {shortDateTime(operation.startAt)} 〜 {shortDateTime(operation.endAt)}
                </Table.Th>
                <Table.Td>
                  <Anchor component="button" type="button" size="sm" onClick={() => onOpenLot(operation)}>
                    {lotLabel(operation)}
                  </Anchor>
                </Table.Td>
                <Table.Td>{operation.orderId}</Table.Td>
                <Table.Td>{partLabel(operation.partNumber)}</Table.Td>
                <Table.Td ta="right" className="tabular">
                  {operation.quantity}個
                </Table.Td>
                <Table.Td>{setupLabel(operation)}</Table.Td>
                <Table.Td>{shortDate(dueByOrder.get(operation.orderId))}</Table.Td>
                <Table.Td>{shortDateTime(forecasts.get(operation.orderId)?.finishAt)}</Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Panel>
  )
}

function Panel({
  focusPending,
  onFocused,
  title,
  summary,
  onClose,
  children,
}: {
  focusPending: boolean
  onFocused: () => void
  title: string
  summary: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const reduceMotion = useReducedMotion()
  // The panel opens below the chart, often under the fold, so focus moves to its heading
  // rather than staying on a button the scroll may hide under the header. Only when the
  // planner opens it: a rebuilt plan that changes the title leaves focus alone.
  useEffect(() => {
    if (!focusPending) return
    headingRef.current?.focus({ preventScroll: true })
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
    onFocused()
  }, [focusPending, onFocused, reduceMotion])

  return (
    <Paper component="section" withBorder p="md" aria-label={title} ref={panelRef}>
      <Group justify="space-between" mb="xs" wrap="nowrap" align="flex-start">
        <Group gap="md" align="baseline">
          <Title order={3} size="h5" ref={headingRef} tabIndex={-1}>
            {title}
          </Title>
          <Text size="sm" c="dimmed">
            {summary}
          </Text>
        </Group>
        <CloseButton onClick={onClose} aria-label="閉じる" />
      </Group>
      {children}
    </Paper>
  )
}

// How long the lot waits before its next step: a time on the same day, else the days ahead.
function waitLabel(step: ScheduledOperation, next: ScheduledOperation): string {
  const days = daysBetween(step.endAt.slice(0, 10), next.startAt.slice(0, 10))
  if (days >= 2) return `${days}日後`
  if (days === 1) return '翌日'
  const minutes = next.start - step.end
  if (minutes <= 0) return 'すぐ'
  const hours = Math.floor(minutes / 60)
  return [hours > 0 ? `${hours}時間` : '', minutes % 60 > 0 ? `${minutes % 60}分` : ''].join('')
}

function sameSelection(current: Selection | null, next: Selection): boolean {
  if (current?.kind === 'operation' && next.kind === 'operation') {
    return current.lotId === next.lotId && current.stepIndex === next.stepIndex && current.orderId === next.orderId
  }
  if (current?.kind === 'equipment' && next.kind === 'equipment') return current.id === next.id
  return false
}

function isOff(workWeekdays: number[], date: IsoDate): boolean {
  return !workWeekdays.includes(weekday(date))
}
