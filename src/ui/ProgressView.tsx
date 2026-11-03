import { Badge, CloseButton, Group, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, Title } from '@mantine/core'
import { useReducedMotion } from '@mantine/hooks'
import { useEffect, useMemo, useRef, useState } from 'react'

import type { Plan } from '../engine/plan'
import { stagnantDays, summarizeProgress, type ProgressSummary } from '../engine/progress'
import type { OrderForecast } from '../engine/scheduler'
import type { IsoDate, Lot, Order } from '../engine/types'
import { percent, shortDate, shortDateTime } from './format'

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
}

type Selection = { rowKey: string; step: number | null }

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

  const rows = mode === 'order' ? orderRows : partRows
  const stepCount = Math.max(1, ...rows.map((row) => row.route.length))
  const selectedRow = rows.find((row) => row.key === selection?.rowKey) ?? null
  const isWarned = (lot: Lot) => stagnantDays(lot, today) >= warningDays

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
              <tr key={row.key} className={selection?.rowKey === row.key ? 'is-selected' : undefined}>
                {mode === 'order' ? (
                  <>
                    <td>{row.label}</td>
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
                    onOpen={() => setSelection({ rowKey: row.key, step: null })}
                  />
                </td>
                {Array.from({ length: stepCount }, (_, index) => (
                  <td key={index}>
                    {index < row.route.length && (
                      <StepChip
                        summary={row.summary}
                        index={index}
                        warned={row.summary.steps[index].lots.some(isWarned)}
                        onOpen={() => setSelection({ rowKey: row.key, step: index })}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Paper>

      {selectedRow && selection && (
        <LotPanel
          row={selectedRow}
          step={selection.step}
          plan={plan}
          today={today}
          warningDays={warningDays}
          onClose={() => setSelection(null)}
        />
      )}
    </Stack>
  )

  function switchMode(next: 'order' | 'part') {
    setMode(next)
    setSelection(null)
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

function LotPanel({
  row,
  step,
  plan,
  today,
  warningDays,
  onClose,
}: {
  row: Row
  step: number | null
  plan: Plan
  today: IsoDate
  warningDays: number
  onClose: () => void
}) {
  const orders = new Map(row.orders.map((order) => [order.id, order]))
  const lots = (step === null ? row.summary.wipLots : row.summary.steps[step].lots)
    .slice()
    .sort((a, b) => (orders.get(a.orderId)?.due ?? '').localeCompare(orders.get(b.orderId)?.due ?? '') || a.id.localeCompare(b.id))
  const equipmentNames = new Map(plan.scenario.data.equipment.map((equipment) => [equipment.id, equipment.name]))
  const nextOperation = (lot: Lot) =>
    plan.result.operations
      .filter((operation) => operation.lotId === lot.id && operation.stepIndex === lot.stepIndex)
      .at(0)
  const title =
    step === null ? `${row.label} の仕掛Lot一覧（全工程）` : `${row.label}・工程${step + 1} ${row.route[step]} の仕掛Lot一覧`

  const panelRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()
  // The panel opens below the table, often under the fold.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [row.key, step, reduceMotion])

  return (
    <Paper withBorder p="md" aria-label={title} ref={panelRef}>
      <Group justify="space-between" mb="xs" wrap="nowrap">
        <Group gap="sm">
          <Title order={3} size="h5">
            {title}
          </Title>
          <Text size="sm" c="dimmed">
            {lots.reduce((total, lot) => total + lot.quantity, 0)}個 / {lots.length}Lot
          </Text>
        </Group>
        <CloseButton onClick={onClose} aria-label="閉じる" />
      </Group>
      {lots.length === 0 ? (
        <Text size="sm" c="dimmed">
          仕掛Lotはありません
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
              {lots.map((lot) => {
                const days = stagnantDays(lot, today)
                const operation = nextOperation(lot)
                return (
                  <Table.Tr key={lot.id}>
                    <Table.Td>{lot.id}</Table.Td>
                    <Table.Td>{lot.orderId}</Table.Td>
                    <Table.Td>
                      工程{lot.stepIndex + 1} {row.route[lot.stepIndex]}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {lot.quantity}個
                    </Table.Td>
                    <Table.Td ta="right" className="tabular" c={days >= warningDays ? 'red' : undefined} fw={days >= warningDays ? 700 : undefined}>
                      {days}日
                    </Table.Td>
                    <Table.Td>{shortDate(orders.get(lot.orderId)?.due)}</Table.Td>
                    <Table.Td>
                      {operation
                        ? `${shortDateTime(operation.startAt)}〜 ${equipmentNames.get(operation.equipmentId) ?? operation.equipmentId}`
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
