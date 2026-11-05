import { Alert, Badge, Button, Group, Paper, SegmentedControl, SimpleGrid, Stack, Table, Tabs, Text, Title, VisuallyHidden } from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import { useMemo, useRef, useState } from 'react'

import { addMonths } from '../engine/dealDemand'
import { forecastDemand, seriesChecks, type DemandForecast } from '../engine/forecast'
import { currentVersion, forecastVersion, methodName, monthsFrom, openOrdersByMonth, type HandoffKind, type HandoffVersion } from '../engine/handoff'
import type { IsoDate } from '../engine/types'
import type { AppState } from '../state/store'
import { nowAt } from './clock'
import { pieces, shortDateTime, yearMonth } from './format'
import { OrdersChart } from './OrdersChart'

type View = 'handoff' | 'forecast' | 'history'

const KIND_NAMES: Record<HandoffKind, string> = { deals: '商談からの見込み', forecast: '受注実績からの予測' }
// This month and the six after it, the months the deals are counted over.
const PLAN_MONTHS = 7

export function DemandView({ app, today }: { app: AppState; today: IsoDate }) {
  const [view, setView] = useState<View>('handoff')
  const [horizon, setHorizon] = useState(3)
  const data = app.saved.data
  const forecast = useMemo(() => forecastDemand(data.orderHistory ?? [], horizon), [data.orderHistory, horizon])
  const versions = app.saved.handoffs ?? []
  return (
    <Stack gap="md">
      <Title order={2} size="h4">
        需要予測
      </Title>
      <Tabs value={view} onChange={(value) => value && setView(value as View)}>
        <Tabs.List className="sub-tabs">
          <Tabs.Tab value="handoff">計画への受け渡し</Tabs.Tab>
          <Tabs.Tab value="forecast">予測</Tabs.Tab>
          <Tabs.Tab value="history">受注の実績</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="handoff" pt="md">
          <HandoffPanel app={app} today={today} versions={versions} />
        </Tabs.Panel>
        <Tabs.Panel value="forecast" pt="md">
          <ForecastPanel
            forecast={forecast}
            horizon={horizon}
            onHorizon={setHorizon}
            handed={currentVersion(versions, 'forecast')}
            onHand={() => app.saveHandoff(forecastVersion(forecast, today, nowAt()))}
          />
        </Tabs.Panel>
        <Tabs.Panel value="history" pt="md">
          <HistoryPanel forecast={forecast} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  )
}

function VersionCard({
  kind,
  version,
  viewing,
  onBack,
  headingRef,
}: {
  kind: HandoffKind
  version: HandoffVersion | null
  viewing: boolean
  onBack: () => void
  headingRef: React.RefObject<HTMLParagraphElement | null>
}) {
  return (
    <Paper withBorder p="md">
      <Group justify="space-between" wrap="nowrap" align="flex-start">
        <Stack gap={2}>
          <Text fw={700} ref={headingRef} tabIndex={-1}>
            {KIND_NAMES[kind]}
          </Text>
          {version ? (
            <>
              <Text size="sm" className="tabular">
                {viewing ? '前の版' : '今の版'}　{shortDateTime(version.createdAt)}
              </Text>
              <Text size="sm" c="dimmed">
                {version.conditions}
              </Text>
            </>
          ) : (
            <Text size="sm" c="dimmed">
              まだ渡していません
            </Text>
          )}
        </Stack>
        {viewing && (
          <Button size="xs" variant="default" onClick={onBack}>
            今の版に戻す
          </Button>
        )}
      </Group>
    </Paper>
  )
}

// The plan's open orders, the deals' version and the forecast's version, part by part and
// month by month, in rows of their own: they are never added up.
function HandoffPanel({ app, today, versions }: { app: AppState; today: IsoDate; versions: HandoffVersion[] }) {
  const [viewing, setViewing] = useState<Partial<Record<HandoffKind, string>>>({})
  const headings = { deals: useRef<HTMLParagraphElement>(null), forecast: useRef<HTMLParagraphElement>(null) }
  const data = app.saved.data
  const months = monthsFrom(today, PLAN_MONTHS)
  const pick = (kind: HandoffKind) => versions.find((entry) => entry.id === viewing[kind]) ?? currentVersion(versions, kind)
  const deals = pick('deals')
  const forecast = pick('forecast')
  const orders = openOrdersByMonth(data, today)
  const parts = data.parts.map((part) => part.partNumber)
  const extra = [...new Set([...(deals?.rows ?? []), ...(forecast?.rows ?? [])].map((row) => row.partNumber))].filter((partNumber) => !parts.includes(partNumber))
  // The shown version changes under the button pressed, so keyboard focus goes to its card.
  const show = (kind: HandoffKind, id: string | undefined) => {
    setViewing((current) => ({ ...current, [kind]: id }))
    requestAnimationFrame(() => headings[kind].current?.focus())
  }
  const sum = (rows: { month: string; value: number }[], month: string) => rows.filter((row) => row.month === month).reduce((total, row) => total + row.value, 0)
  const lines = (partNumber: string) => [
    { label: '注残', rows: orders.filter((row) => row.partNumber === partNumber).map((row) => ({ month: row.month, value: row.quantity })) },
    {
      // Volume and first orders, each with its deal's chance, as the stock outlook counts them.
      label: '商談の見込み',
      rows: (deals?.rows ?? [])
        .filter((row) => row.partNumber === partNumber)
        .map((row) => ({ month: row.month, value: (row.expected ?? 0) + (row.expectedFirstOrder ?? 0) })),
    },
    {
      label: '需要予測',
      rows: (forecast?.rows ?? []).filter((row) => row.partNumber === partNumber).map((row) => ({ month: row.month, value: row.forecast ?? 0 })),
    },
  ]
  return (
    <Stack gap="lg">
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {(['deals', 'forecast'] as const).map((kind) => (
          <VersionCard
            key={kind}
            kind={kind}
            version={kind === 'deals' ? deals : forecast}
            viewing={Boolean(viewing[kind])}
            onBack={() => show(kind, undefined)}
            headingRef={headings[kind]}
          />
        ))}
      </SimpleGrid>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={140 + months.length * 88}>
          <Table verticalSpacing={4} withRowBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className="sticky-col">
                  <VisuallyHidden>型番と数</VisuallyHidden>
                </Table.Th>
                {months.map((month) => (
                  <Table.Th key={month} ta="right">
                    {yearMonth(month)}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            {[...parts, ...extra].map((partNumber) => (
              <Table.Tbody key={partNumber} className="handoff-part">
                <Table.Tr>
                  <Table.Th scope="rowgroup" colSpan={months.length + 1} className="sticky-col" pt="sm">
                    {partNumber}
                  </Table.Th>
                </Table.Tr>
                {lines(partNumber).map((line, index) => (
                  <Table.Tr key={line.label}>
                    <Table.Th scope="row" className="sticky-col" fw={400}>
                      <Text size="sm" c={index === 0 ? undefined : 'dimmed'}>
                        {line.label}
                      </Text>
                    </Table.Th>
                    {months.map((month) => {
                      // A month the forecast does not reach is blank, not 0.
                      if (line.label === '需要予測' && forecast && !line.rows.some((row) => row.month === month)) {
                        return <Table.Td key={month} />
                      }
                      const value = sum(line.rows, month)
                      return (
                        <Table.Td key={month} ta="right" className="tabular" c={value === 0 ? 'dimmed' : undefined} fw={index === 0 && value > 0 ? 700 : undefined}>
                          {value === 0 ? '-' : pieces(value)}
                        </Table.Td>
                      )
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            ))}
          </Table>
        </Table.ScrollContainer>
      </Paper>
      <section>
        <Title order={3} size="h5" mb="xs">
          渡した履歴
        </Title>
        <Paper withBorder>
          <Table.ScrollContainer minWidth={600}>
            <Table verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="nowrap">種類</Table.Th>
                  <Table.Th className="nowrap">作った日時</Table.Th>
                  <Table.Th>条件</Table.Th>
                  <Table.Th>
                    <VisuallyHidden>表示</VisuallyHidden>
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {[...versions].reverse().map((version) => {
                  const current = currentVersion(versions, version.kind)?.id === version.id
                  const shown = (viewing[version.kind] ?? currentVersion(versions, version.kind)?.id) === version.id
                  return (
                    <Table.Tr key={version.id}>
                      <Table.Td className="nowrap">{KIND_NAMES[version.kind]}</Table.Td>
                      <Table.Td className="tabular nowrap">{shortDateTime(version.createdAt)}</Table.Td>
                      <Table.Td>
                        <Text size="sm">{version.conditions}</Text>
                      </Table.Td>
                      <Table.Td>
                        {shown ? (
                          <Badge variant="light" color={current ? 'blue' : 'gray'} radius="sm" size="sm" fz="xs" miw="max-content">
                            {current ? '今の版' : '表示中'}
                          </Badge>
                        ) : (
                          <Button size="compact-sm" variant="default" onClick={() => show(version.kind, current ? undefined : version.id)}>
                            表示する
                          </Button>
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

function ForecastPanel({
  forecast,
  horizon,
  onHorizon,
  handed,
  onHand,
}: {
  forecast: DemandForecast
  horizon: number
  onHorizon: (months: number) => void
  handed: HandoffVersion | null
  onHand: () => void
}) {
  const [justHanded, setJustHanded] = useState(false)
  if (forecast.series.length === 0) {
    return (
      <Alert color="orange" variant="light">
        {forecast.reason}
      </Alert>
    )
  }
  const { backtest } = forecast
  return (
    <Stack gap="lg">
      <Group justify="space-between" wrap="wrap" align="flex-end">
        <SegmentedControl
          color="primary"
          aria-label="予測する月数"
          data={[1, 2, 3, 4, 5, 6].map((months) => ({ value: String(months), label: `${months}か月` }))}
          value={String(horizon)}
          onChange={(value) => {
            onHorizon(Number(value))
            setJustHanded(false)
          }}
        />
        <Group gap="sm">
          {/* Always there, so a screen reader reads the time each time a forecast is handed over. */}
          <Text size="sm" c="dimmed" className="tabular" aria-live="polite">
            {handed ? `渡した版 ${shortDateTime(handed.createdAt)}` : ''}
          </Text>
          <Button
            onClick={() => {
              onHand()
              setJustHanded(true)
            }}
            leftSection={justHanded ? <IconCheck size={16} /> : undefined}
            variant={justHanded ? 'default' : 'filled'}
          >
            {justHanded ? '渡しました' : '計画に渡す'}
          </Button>
        </Group>
      </Group>
      <Text size="sm">{forecast.reason}</Text>
      {backtest && (
        <Paper withBorder maw={560}>
          <Table.ScrollContainer minWidth={420}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="nowrap">最後の3か月の誤差</Table.Th>
                  <Table.Th ta="right" className="nowrap">
                    学習した予測
                  </Table.Th>
                  <Table.Th ta="right" className="nowrap">
                    直近3か月の平均
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {(
                  [
                    ['平均の誤差（個）', backtest.model.mae, backtest.recentAverage.mae],
                    ['二乗平均の誤差（個）', backtest.model.rmse, backtest.recentAverage.rmse],
                    ['誤差の割合', backtest.model.mape, backtest.recentAverage.mape],
                  ] as const
                ).map(([label, model, average]) => (
                  <Table.Tr key={label}>
                    <Table.Th scope="row" fw={400}>
                      {label}
                    </Table.Th>
                    {[model, average].map((value, index) => (
                      <Table.Td key={index} ta="right" className="tabular" fw={(index === 0) === (backtest.chosen === 'model') ? 700 : undefined}>
                        {value === null ? '-' : label === '誤差の割合' ? `${pieces(value * 100)}%` : pieces(value)}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      )}
      <SimpleGrid cols={{ base: 1, md: 2 }}>
        {forecast.series.map((entry) => (
          <Paper key={`${entry.partNumber}|${entry.site}`} withBorder p="sm">
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <Text fw={700}>{entry.partNumber}</Text>
                <Text size="sm" c="dimmed">
                  {entry.site}
                </Text>
              </Group>
              <Badge variant="light" color={entry.method === 'tooShort' ? 'gray' : 'blue'} radius="sm" size="sm" fz="xs" miw="max-content">
                {methodName(entry.method)}
              </Badge>
            </Group>
            <OrdersChart
              label={`${entry.partNumber}の月ごとの受注と予測`}
              actual={entry.history.slice(-12).map((month) => ({ month: month.month, quantity: month.ordered }))}
              forecast={entry.forecast}
            />
          </Paper>
        ))}
      </SimpleGrid>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={300 + forecast.months.length * 90}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className="sticky-col">型番</Table.Th>
                <Table.Th>拠点</Table.Th>
                {forecast.months.map((month) => (
                  <Table.Th key={month} ta="right">
                    {yearMonth(month)}
                  </Table.Th>
                ))}
                <Table.Th ta="right">合計</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {forecast.series.map((entry) => (
                <Table.Tr key={`${entry.partNumber}|${entry.site}`}>
                  <Table.Th scope="row" className="sticky-col" fw={400}>
                    {entry.partNumber}
                  </Table.Th>
                  <Table.Td>{entry.site}</Table.Td>
                  {entry.forecast.map((month) => (
                    <Table.Td key={month.month} ta="right" className="tabular">
                      {pieces(month.quantity)}
                    </Table.Td>
                  ))}
                  <Table.Td ta="right" className="tabular" fw={700}>
                    {pieces(entry.forecast.reduce((total, month) => total + month.quantity, 0))}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  )
}

// The months of orders and shipments behind the forecast, and what to look at before
// trusting a part's history.
function HistoryPanel({ forecast }: { forecast: DemandForecast }) {
  if (forecast.series.length === 0) {
    return (
      <Alert color="orange" variant="light">
        {forecast.reason}
      </Alert>
    )
  }
  // The last twelve months of all the history, whatever month each series began.
  const months = Array.from({ length: 12 }, (_, index) => addMonths(forecast.lastMonth, index - 11))
  return (
    <Stack gap="lg">
      <Paper withBorder>
        <Table.ScrollContainer minWidth={720}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className="sticky-col">型番</Table.Th>
                <Table.Th>拠点</Table.Th>
                <Table.Th ta="right">実績の月数</Table.Th>
                <Table.Th ta="right">直近3か月の平均</Table.Th>
                <Table.Th ta="right">ばらつき</Table.Th>
                <Table.Th>確認</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {forecast.series.map((entry) => {
                const checks = seriesChecks(entry)
                const recent = entry.history.slice(-3)
                return (
                  <Table.Tr key={`${entry.partNumber}|${entry.site}`}>
                    <Table.Th scope="row" className="sticky-col" fw={400}>
                      {entry.partNumber}
                    </Table.Th>
                    <Table.Td>{entry.site}</Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {checks.months}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {pieces(recent.reduce((total, month) => total + month.ordered, 0) / Math.max(1, recent.length))}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {checks.variation === null ? '-' : `${pieces(checks.variation * 100)}%`}
                    </Table.Td>
                    <Table.Td>
                      {checks.warnings.length === 0 ? (
                        <Text size="sm" c="teal">
                          なし
                        </Text>
                      ) : (
                        checks.warnings.map((warning) => (
                          <Text key={warning} size="sm" c="orange">
                            {warning}
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
      <Paper withBorder>
        <Table.ScrollContainer minWidth={120 + months.length * 76}>
          <Table verticalSpacing={4} withRowBorders={false}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className="sticky-col">
                  <VisuallyHidden>型番と数</VisuallyHidden>
                </Table.Th>
                {months.map((month) => (
                  <Table.Th key={month} ta="right">
                    {yearMonth(month)}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            {forecast.series.map((entry) => {
              const byMonth = new Map(entry.history.map((month) => [month.month, month]))
              return (
                <Table.Tbody key={`${entry.partNumber}|${entry.site}`} className="handoff-part">
                  <Table.Tr>
                    <Table.Th scope="rowgroup" colSpan={months.length + 1} className="sticky-col" pt="sm">
                      {entry.partNumber}　{entry.site}
                    </Table.Th>
                  </Table.Tr>
                  {(['ordered', 'shipped'] as const).map((key, index) => (
                    <Table.Tr key={key}>
                      <Table.Th scope="row" className="sticky-col" fw={400}>
                        <Text size="sm" c={index === 0 ? undefined : 'dimmed'}>
                          {key === 'ordered' ? '受注' : '出荷'}
                        </Text>
                      </Table.Th>
                      {months.map((month) => {
                        const value = byMonth.get(month)?.[key]
                        return (
                          <Table.Td key={month} ta="right" className="tabular" c={value === undefined ? 'dimmed' : undefined}>
                            {value === undefined ? '-' : pieces(value)}
                          </Table.Td>
                        )
                      })}
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              )
            })}
          </Table>
        </Table.ScrollContainer>
      </Paper>
    </Stack>
  )
}
