import {
  ActionIcon,
  Anchor,
  Button,
  CloseButton,
  Group,
  Menu,
  Paper,
  Select,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  VisuallyHidden,
} from '@mantine/core'
import { useElementSize, useReducedMotion } from '@mantine/hooks'
import { IconCheck, IconChevronDown, IconHistory, IconMinus, IconPlus } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import type { ProposedOption } from '../assistant/tools'
import { addDays, daysBetween, MINUTES_PER_DAY, parseClock, weekday } from '../engine/dates'
import type { Plan } from '../engine/plan'
import { SHIFT_STARTS, workHours } from '../engine/settings'
import { lotHistory } from '../engine/records'
import type { ScheduledOperation } from '../engine/scheduler'
import type { Equipment, IsoDate } from '../engine/types'
import { shortDate, shortDateTime } from './format'

type Props = {
  plan: Plan
  today: IsoDate
  highlight: ProposedOption | null
  onShowInProgress: (orderId: string, lotId: string) => void
}

// A bar shows how one lot flows through its steps; an equipment shows everything it runs.
// Kept by lot, step and order, so it survives the plan being rebuilt; a planned Lot
// number that a what-if hands to another order no longer matches.
type Selection =
  | { kind: 'operation'; lotId: string; stepIndex: number; orderId: string }
  | { kind: 'equipment'; id: string }

// How many days the chart fits across its width, from the closest look to the widest.
const SPANS = [
  { label: '1日', days: 1 },
  { label: '3日', days: 3 },
  { label: '1週間', days: 7 },
  { label: '2週間', days: 14 },
]
// The equipment column and the track's left margin, which the days share the rest beside.
const LABEL_WIDTH = 196
// Narrower than this, a day's date and bars no longer read; the chart scrolls instead.
const MIN_DAY_WIDTH = 48
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']
const NOW_TAG_WIDTH = 64
// The narrowest day whose date fits with its weekday, as 11/14（土）; narrower days show
// the date only, and days off stand apart by their shade.
const WEEKDAY_FITS = 76
const TONE_NAMES = { late: '、納期に遅れる', tight: '、納期まで1日以内', ok: '' }
const NO_FOCUS = 'none'

export function GanttView({ plan, today, highlight, onShowInProgress }: Props) {
  const [span, setSpan] = useState(2)
  const { ref: chartRef, width: chartWidth } = useElementSize()
  const [focusOrder, setFocusOrder] = useState('')
  const [selection, setSelection] = useState<Selection | null>(null)
  // Set when the planner opens a panel and cleared once focus has moved to it, so a
  // what-if that hides the panel and brings it back leaves focus alone.
  const [focusPending, setFocusPending] = useState(false)
  // The time now, moved on as each minute turns.
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setTimeout(() => setClock(new Date()), 60_000 - (clock.getSeconds() * 1000 + clock.getMilliseconds()))
    return () => window.clearTimeout(timer)
  }, [clock])
  const focused = useCallback(() => setFocusPending(false), [])
  const { scenario, result } = plan
  const { settings, data } = scenario
  const days = settings.horizonDays
  // Until the chart has been measured, a day takes the width it used to have.
  const dayWidth =
    chartWidth > 0
      ? Math.max(MIN_DAY_WIDTH, Math.floor((chartWidth - LABEL_WIDTH) / Math.min(SPANS[span].days, days)))
      : 150
  // The most days that fit side by side; a span wider than the one reaching it shows no more.
  const daysThatFit = Math.min(chartWidth > 0 ? Math.floor((chartWidth - LABEL_WIDTH) / MIN_DAY_WIDTH) : days, days)
  const showsMore = (index: number) => index === 0 || SPANS[index - 1].days < daysThatFit

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

  // Each day shows working hours only, widened to fit any overtime up to midnight, where the
  // working day ends as the calendar does.
  const hoursOfDay = workHours(settings)
  const displayStart = parseClock(hoursOfDay.start)
  const displayEnd = Math.min(
    Math.max(
      parseClock(hoursOfDay.end) + Math.max(0, ...scenario.overtime.map((entry) => entry.minutesPerDay)),
      displayStart + 60,
    ),
    MINUTES_PER_DAY,
  )
  // A tick under each date for every hour shown, numbered every hour or every few hours, so
  // numbers stay 24px apart as the day narrows or overtime widens it; at the narrowest only
  // the day's first hour is. A day ends where the next begins, so at that line the closing
  // hour stands to its left and the opening hour to its right, the closing one only where
  // the day is wide enough to fit it.
  const perHour = (dayWidth * 60) / (displayEnd - displayStart)
  const labelEvery = [1, 2, 3, 4, 6, 12].find((step) => perHour * step >= 24) ?? 24
  const firstHour = Math.ceil(displayStart / 60)
  // Ticks stand at every hour while they are 4px apart or more, otherwise at the numbered hours only.
  const hours = Array.from({ length: Math.max(0, Math.ceil(displayEnd / 60) - firstHour) }, (_, index) => firstHour + index).filter(
    (hour) => perHour >= 4 || (hour - firstHour) % labelEvery === 0,
  )
  const endHour = displayEnd % 60 === 0 ? displayEnd / 60 : null
  const lastLabeled = hours.filter((hour) => (hour - firstHour) % labelEvery === 0).at(-1) ?? firstHour
  // A day that runs round the clock ends where the next begins at 0, so it shows only 0.
  const showEnd = endHour !== null && displayEnd - displayStart < MINUTES_PER_DAY && perHour * (endHour - lastLabeled) >= 30
  // Where one shift hands over to the next, inside the day; the day's own edge is drawn already.
  const shiftLines = SHIFT_STARTS[settings.shifts]
    .map(parseClock)
    .filter((minute) => minute > displayStart && minute < displayEnd)
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
  // The plan starts at 00:00 today, so the time now sits on its first day. After midnight,
  // until the app moves on to the new day, the chart still shows yesterday: no line then.
  const pad = (value: number) => String(value).padStart(2, '0')
  const onFirstDay = `${clock.getFullYear()}-${pad(clock.getMonth() + 1)}-${pad(clock.getDate())}` === today
  const now = clock.getHours() * 60 + clock.getMinutes()
  // Outside working hours the line sits at the day's start or end, beside its hour.
  const nowLabel = `${pad(clock.getHours())}:${pad(clock.getMinutes())}`
  // The tag stays inside the first day's column, clear of the fixed equipment column.
  const tagLeft = Math.min(Math.max(x(now) - NOW_TAG_WIDTH / 2, 0), Math.max(0, dayWidth - NOW_TAG_WIDTH))

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
        <Group gap={0} wrap="nowrap" role="group" aria-label="表示の幅" className="span-control">
          <ActionIcon
            variant="default"
            size={36}
            onClick={() => setSpan((current) => Math.min(SPANS.length - 1, current + 1))}
            disabled={span === SPANS.length - 1 || !showsMore(span + 1)}
            aria-label="縮小（もっと先まで見る）"
          >
            <IconMinus size={16} />
          </ActionIcon>
          <Menu position="bottom" width={160}>
            <Menu.Target>
              <Button variant="default" h={36} rightSection={<IconChevronDown size={14} />} aria-label={`表示する日数：${SPANS[span].label}`}>
                {SPANS[span].label}
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {SPANS.map((item, index) => (
                <Menu.Item
                  key={item.label}
                  onClick={() => setSpan(index)}
                  disabled={index !== span && !showsMore(index)}
                  rightSection={index === span ? <IconCheck size={14} /> : undefined}
                  aria-current={index === span ? 'true' : undefined}
                >
                  {item.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
          <ActionIcon
            variant="default"
            size={36}
            onClick={() => setSpan((current) => Math.max(0, current - 1))}
            disabled={span === 0}
            aria-label="拡大（細かく見る）"
          >
            <IconPlus size={16} />
          </ActionIcon>
        </Group>
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

      <Paper withBorder className="gantt-scroll" ref={chartRef}>
        <div className="gantt-grid" style={{ width: 188 + days * dayWidth }}>
          {dates.flatMap((date, index) =>
            shiftLines.map((minute) => (
              <div
                key={`${date}-${minute}`}
                className="gantt-shift"
                style={{ left: 188 + x(index * MINUTES_PER_DAY + minute) }}
                aria-hidden="true"
              />
            )),
          )}
          {onFirstDay && <div className="gantt-now" style={{ left: 188 + x(now) }} aria-hidden="true" />}
          <div className="gantt-row gantt-head">
            <div className="gantt-label">設備</div>
            <div className="gantt-track" style={{ width: days * dayWidth }}>
              {onFirstDay && (
                <span className="gantt-now-tag" style={{ left: tagLeft, width: NOW_TAG_WIDTH }}>
                  今 {nowLabel}
                </span>
              )}
              {dates.map((date, index) => (
                <div
                  key={date}
                  className={`gantt-day${isOff(settings.workWeekdays, date) ? ' is-off' : ''}`}
                  style={{ left: index * dayWidth, width: dayWidth }}
                >
                  {shortDate(date)}
                  {dayWidth >= WEEKDAY_FITS && `（${WEEKDAY_NAMES[weekday(date)]}）`}
                </div>
              ))}
              <div className="gantt-hours" aria-hidden="true">
                {dates.flatMap((date, index) =>
                  hours.map((hour) => {
                    const left = x(index * MINUTES_PER_DAY + hour * 60)
                    const labeled = (hour - firstHour) % labelEvery === 0 && (showEnd || (index + 1) * dayWidth - left >= 18)
                    const opening = hour * 60 === displayStart
                    return (
                      <span key={`${date}-${hour}`} className="gantt-hour" style={{ left }}>
                        {labeled && <span className={`gantt-hour-label${opening ? ' is-start' : ''}`}>{hour}</span>}
                      </span>
                    )
                  }).concat(
                    showEnd ? (
                      <span key={`${date}-end`} className="gantt-hour-label is-end" style={{ left: (index + 1) * dayWidth }}>
                        {endHour}
                      </span>
                    ) : [],
                  ),
                )}
              </div>
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
                    <span>{stopped ? '停止中' : equipment.processes.join('・')}</span>
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
                      <Tooltip
                        key={barKey(operation)}
                        label={
                          <BarDetail
                            operation={operation}
                            lot={lotLabel(operation)}
                            detail={detail}
                            equipment={equipment.name}
                            setup={setupLabel(operation)}
                            due={dueByOrder.get(operation.orderId)}
                            finish={forecasts.get(operation.orderId)?.finishAt ?? null}
                          />
                        }
                        multiline
                        interactive
                        w={300}
                        openDelay={250}
                        events={{ hover: true, focus: true, touch: false }}
                      >
                      <button
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
                        onClick={() => toggle(operationSelection(operation))}
                      >
                        {setupWidth > 0 && <span className="bar-setup-part" style={{ width: setupWidth }} />}
                        <span className="bar-text">
                          <span className="bar-lot">{lotLabel(operation)}</span>
                          {/* On a machine with several processes, bars of one lot differ by process. */}
                          <span>{equipment.processes.length > 1 ? `${operation.stepName}・${detail}` : detail}</span>
                        </span>
                      </button>
                      </Tooltip>
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
          onShowInProgress={onShowInProgress}
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

// What one bar is, in the order a planner reads it: the lot, the step, the time, its setup, the order.
function BarDetail({
  operation,
  lot,
  detail,
  equipment,
  setup,
  due,
  finish,
}: {
  operation: ScheduledOperation
  lot: string
  detail: string
  equipment: string
  setup: string
  due: IsoDate | undefined
  finish: string | null
}) {
  return (
    <Stack gap={2}>
      <Text size="sm" fw={700}>
        {lot}・{detail}
      </Text>
      <Text size="sm">
        工程{operation.stepIndex + 1} {operation.stepName}　{equipment}
      </Text>
      <Text size="sm" className="tabular">
        {shortDateTime(operation.startAt)} 〜 {shortDateTime(operation.endAt)}
      </Text>
      <Text size="sm">段取り {setup}</Text>
      <Text size="sm" className="tabular">
        注番 {operation.orderId}　納期 {shortDate(due)}　完成見込み {finish ? shortDateTime(finish) : '—'}
      </Text>
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
  onShowInProgress,
  focusPending,
  onFocused,
  operation,
  plan,
  lotLabel,
  partLabel,
  setupLabel,
  onClose,
}: Labels & { operation: ScheduledOperation; onShowInProgress: (orderId: string, lotId: string) => void }) {
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
  // The steps already done, as recorded on the shop floor.
  const history = lotHistory(data, operation.lotId)

  return (
    <Panel
      focusPending={focusPending}
      onFocused={onFocused}
      action={
        <Button size="xs" variant="default" onClick={() => onShowInProgress(operation.orderId, operation.lotId)}>
          進捗で見る
        </Button>
      }
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
            {route.slice(0, firstPlanned).map((step, index) => {
              const actual = history.find((record) => record.stepIndex === index)
              return (
                <Table.Tr key={`done-${index}`} className="is-before">
                  <Table.Th scope="row">{stepName(index, step.name)}</Table.Th>
                  <Table.Td>{actual ? (equipmentNames.get(actual.equipmentId) ?? actual.equipmentId) : '—'}</Table.Td>
                  <Table.Td>—</Table.Td>
                  <Table.Td>{actual ? shortDateTime(actual.start) : '—'}</Table.Td>
                  <Table.Td>{actual ? shortDateTime(actual.end) : '—'}</Table.Td>
                  <Table.Td>済み</Table.Td>
                </Table.Tr>
              )
            })}
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
  const setups = operations.filter((operation) => operation.setupMinutes > 0)
  const setupMinutes = setups.reduce((total, operation) => total + operation.setupMinutes, 0)
  // Work minutes already include the setup before them.
  const hours = operations.reduce((total, operation) => total + operation.workMinutes, 0) / 60
  const first = operations[0]?.startAt
  const last = operations.at(-1)?.endAt
  const span = first && last ? `${shortDate(first.slice(0, 10))}〜${shortDate(last.slice(0, 10))}` : ''
  // A machine with several processes says which one each run is.
  const multi = equipment.processes.length > 1

  return (
    <Panel
      focusPending={focusPending}
      onFocused={onFocused}
      title={`${equipment.name} の予定`}
      summary={`${equipment.processes.join('・')}${speedLabel(equipment)}　${pieces}個 / ${lots}Lot　稼働 ${Math.round(hours * 10) / 10}時間（うち段取り ${setups.length}回・${setupMinutes}分）　${span}`}
      onClose={onClose}
    >
      <Table.ScrollContainer minWidth={900}>
        <Table verticalSpacing={6} horizontalSpacing={8}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>開始 〜 終了</Table.Th>
              {multi && <Table.Th>工程</Table.Th>}
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
                {multi && <Table.Td>—</Table.Td>}
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
                {multi && <Table.Td>{operation.stepName}</Table.Td>}
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

// The machine's speed against the route, said only when it is not the route's own.
function speedLabel(equipment: Equipment): string {
  return equipment.speed && equipment.speed !== 1 ? `（${equipment.speed}倍速）` : ''
}

function Panel({
  focusPending,
  onFocused,
  action,
  title,
  summary,
  onClose,
  children,
}: {
  focusPending: boolean
  onFocused: () => void
  action?: ReactNode
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
        <Group gap="xs" wrap="nowrap">
          {action}
          <CloseButton onClick={onClose} aria-label="閉じる" />
        </Group>
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
