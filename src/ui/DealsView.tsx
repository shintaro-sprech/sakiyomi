import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Group,
  Pagination,
  Paper,
  Radio,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
} from '@mantine/core'
import { IconChevronDown, IconChevronRight, IconPlus, IconSearch } from '@tabler/icons-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'

import { dealDemand, DEAL_DEMAND_DEFAULTS, THRESHOLDS, type DealDemand } from '../engine/dealDemand'
import { createDeal, dealProblems, dealStatus, editDeal, type DealInput, type DealProblem } from '../engine/deals'
import type { Deal, IsoDate, Part } from '../engine/types'
import type { DealInsights } from '../state/dealInsights'
import type { AppState } from '../state/store'
import { nowAt } from './clock'
import { DealForm } from './DealForm'
import { AnalyticsPanel, ReviewPanel } from './DealReview'
import { chance, dateInYear, percent, pieces, shortDate, yearMonth } from './format'

type Props = {
  app: AppState
  today: IsoDate
  insights: DealInsights
  threshold: number
  onThreshold: (threshold: number) => void
}

type View = 'outlook' | 'list' | 'problems' | 'review' | 'analytics' | 'model'
type MonthValue = 'expected' | 'quantity' | 'firstOrder'

const PAGE_SIZE = 50
const PAGE_CONTROLS: Record<string, string> = { first: '最初のページ', previous: '前のページ', next: '次のページ', last: '最後のページ' }

export function DealsView({ app, today, insights, threshold, onThreshold }: Props) {
  const [view, setView] = useState<View>('list')
  // The deal just saved, marked in the list.
  const [pointed, setPointed] = useState<string | null>(null)
  const [editing, setEditing] = useState<Deal | null | 'new'>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const data = app.saved.data
  const { deals, changes } = insights
  const partNumbers = data.parts.map((part) => part.partNumber)
  const owners = [...new Set(deals.map((deal) => deal.owner))].sort()
  const customers = [...new Set(deals.map((deal) => deal.customer))].sort()
  // A customer that has won a deal already buys from the plant.
  const buyers = new Set(deals.filter((deal) => dealStatus(deal.stage) === 'won').map((deal) => deal.customer))
  const kindOf = (customer: string) => (customers.includes(customer) ? (buyers.has(customer) ? '既存' : '新規') : null)

  function save(input: DealInput) {
    const at = nowAt()
    if (editing === 'new') {
      const next = Math.max(0, ...deals.map((deal) => Number(deal.id.replace(/\D/g, '')) || 0)) + 1
      const { deal, changes: added } = createDeal(`S-${String(next).padStart(4, '0')}`, input, at)
      app.updateData({ ...data, deals: [...deals, deal], dealChanges: [...changes, ...added] })
      setView('list')
      setPointed(deal.id)
    } else if (editing) {
      const { deal, changes: added } = editDeal(editing, input, at)
      app.updateData({
        ...data,
        deals: deals.map((entry) => (entry.id === deal.id ? deal : entry)),
        dealChanges: [...changes, ...added],
      })
      // A deal won or lost leaves the open list with the button that opened it, so keyboard
      // focus goes back to the heading (WCAG 2.4.3); one still open is marked in the list.
      if (dealStatus(deal.stage) !== 'open') requestAnimationFrame(() => headingRef.current?.focus())
      else {
        setView('list')
        setPointed(deal.id)
      }
    }
    setEditing(null)
  }

  const problemCount = deals.filter((deal) => dealStatus(deal.stage) === 'open' && dealProblems(deal, data.parts, today).length > 0).length

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap">
        <Title order={2} size="h4" ref={headingRef} tabIndex={-1}>
          商談
        </Title>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')}>
          商談を登録
        </Button>
      </Group>
      <Tabs value={view} onChange={(value) => value && setView(value as View)}>
        <Tabs.List className="sub-tabs">
          <Tabs.Tab value="list">一覧</Tabs.Tab>
          <Tabs.Tab value="outlook">見込み</Tabs.Tab>
          <Tabs.Tab
            value="problems"
            rightSection={
              problemCount > 0 ? (
                <Badge size="sm" fz="xs" color="orange" variant="light" circle>
                  {problemCount}
                </Badge>
              ) : undefined
            }
          >
            確認
            {problemCount > 0 && <VisuallyHidden>件</VisuallyHidden>}
          </Tabs.Tab>
          {/* Looking back comes apart from the day's work, at the far end. */}
          <Tabs.Tab value="review" ml="auto">
            答え合わせ
          </Tabs.Tab>
          <Tabs.Tab value="analytics">分析</Tabs.Tab>
          <Tabs.Tab value="model">確率の学習</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="outlook" pt="md">
          <OutlookPanel insights={insights} today={today} threshold={threshold} onThreshold={onThreshold} parts={data.parts} />
        </Tabs.Panel>
        <Tabs.Panel value="list" pt="md">
          <ListPanel insights={insights} today={today} parts={data.parts} onEdit={setEditing} pointed={pointed} onPointed={() => setPointed(null)} />
        </Tabs.Panel>
        <Tabs.Panel value="problems" pt="md">
          <ProblemsPanel insights={insights} today={today} parts={data.parts} onEdit={setEditing} />
        </Tabs.Panel>
        <Tabs.Panel value="review" pt="md">
          {view === 'review' && <ReviewPanel insights={insights} parts={data.parts} today={today} />}
        </Tabs.Panel>
        <Tabs.Panel value="analytics" pt="md">
          {view === 'analytics' && <AnalyticsPanel insights={insights} parts={data.parts} today={today} />}
        </Tabs.Panel>
        <Tabs.Panel value="model" pt="md">
          <ModelPanel insights={insights} />
        </Tabs.Panel>
      </Tabs>
      <DealForm
        deal={editing === 'new' ? null : editing}
        opened={editing !== null}
        parts={partNumbers}
        owners={owners}
        customers={customers}
        kindOf={kindOf}
        onClose={() => setEditing(null)}
        onSave={save}
      />
    </Stack>
  )
}

function OutlookPanel({
  insights,
  today,
  threshold,
  onThreshold,
  parts,
}: {
  insights: DealInsights
  today: IsoDate
  threshold: number
  onThreshold: (threshold: number) => void
  parts: Part[]
}) {
  const { demand, deals, chances } = insights
  const [open, setOpen] = useState<string | null>(null)
  const [monthValue, setMonthValue] = useState<MonthValue>('expected')
  // The same deals counted at each threshold, to pick one by what it counts.
  const byThreshold = useMemo(
    () => THRESHOLDS.map((value) => ({ value, demand: dealDemand(deals, chances, parts, today, { ...DEAL_DEMAND_DEFAULTS, threshold: value }) })),
    [deals, chances, parts, today],
  )
  return (
    <Stack gap="lg">
      <Radio.Group
        value={String(threshold)}
        onChange={(value) => onThreshold(Number(value))}
        label="数える受注確率"
        description={`受注予定日が${dateInYear(demand.periodEnd, today)}までの進行中の商談と、30日以内に受注した商談`}
      >
        <SimpleGrid cols={{ base: 1, sm: 3 }} mt="xs">
          {byThreshold.map(({ value, demand: counted }) => (
            <Radio.Card key={value} value={String(value)} p="md" radius="md">
              <Group wrap="nowrap" align="flex-start">
                <Radio.Indicator />
                <Stack gap={2}>
                  <Group gap={8} wrap="nowrap">
                    <Text fw={700}>{percent(value)}以上</Text>
                    {value === DEAL_DEMAND_DEFAULTS.threshold && (
                      <Badge variant="light" color="blue" radius="sm" size="sm" fz="xs">
                        計画に渡す
                      </Badge>
                    )}
                  </Group>
                  <Text size="sm" className="tabular">
                    {counted.counted.length}件・{counted.byPart.length}型番
                  </Text>
                  <Text size="sm" className="tabular">
                    {pieces(counted.byPart.reduce((total, part) => total + part.expected, 0))}個/月
                  </Text>
                </Stack>
              </Group>
            </Radio.Card>
          ))}
        </SimpleGrid>
      </Radio.Group>

      <section>
        <Title order={3} size="h5" mb="xs">
          型番ごと
        </Title>
        <Paper withBorder>
          <Table.ScrollContainer minWidth={760}>
            <Table verticalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="sticky-col">型番</Table.Th>
                  <Table.Th ta="right">商談</Table.Th>
                  <Table.Th ta="right">量産数量（月）</Table.Th>
                  <Table.Th ta="right">期待数量（月）</Table.Th>
                  <Table.Th ta="right">初回の目安</Table.Th>
                  <Table.Th ta="right">最大の確率</Table.Th>
                  <Table.Th ta="right">最も早い受注予定日</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {demand.byPart.length === 0 && (
                  <Table.Tr>
                    <Table.Td colSpan={7}>
                      <Text size="sm" c="dimmed">
                        数える商談はありません
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                )}
                {demand.byPart.map((part) => (
                  <Fragment key={part.partNumber}>
                    <Table.Tr>
                      <Table.Th scope="row" className="sticky-col" fw={400}>
                        <Group gap={4} wrap="nowrap">
                          <ActionIcon
                            variant="subtle"
                            color="gray"
                            size="sm"
                            onClick={() => setOpen(open === part.partNumber ? null : part.partNumber)}
                            aria-expanded={open === part.partNumber}
                            aria-label={`${part.partNumber}の担当者ごと`}
                          >
                            {open === part.partNumber ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
                          </ActionIcon>
                          {part.partNumber}
                        </Group>
                      </Table.Th>
                      <Table.Td ta="right" className="tabular">
                        {part.deals}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {pieces(part.quantity)}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular" fw={700}>
                        {pieces(part.expected)}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {pieces(part.firstOrder)}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {chance(part.maxChance)}
                      </Table.Td>
                      <Table.Td ta="right" className="tabular">
                        {dateInYear(part.earliestClose, today)}
                      </Table.Td>
                    </Table.Tr>
                    {open === part.partNumber &&
                      part.owners.map((owner) => (
                        <Table.Tr key={owner.owner} className="sub-row">
                          <Table.Th scope="row" className="sticky-col" fw={400} pl={40}>
                            {owner.owner}
                          </Table.Th>
                          <Table.Td ta="right" className="tabular">
                            {owner.deals}
                          </Table.Td>
                          <Table.Td ta="right" className="tabular">
                            {pieces(owner.quantity)}
                          </Table.Td>
                          <Table.Td ta="right" className="tabular">
                            {pieces(owner.expected)}
                          </Table.Td>
                          <Table.Td />
                          <Table.Td ta="right" className="tabular">
                            {chance(owner.maxChance)}
                          </Table.Td>
                          <Table.Td ta="right" className="tabular">
                            {dateInYear(owner.earliestClose, today)}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                  </Fragment>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
        <Text size="sm" c="dimmed" mt={6} className="tabular">
          数えていない進行中の商談：確率が{percent(threshold)}未満 {demand.belowThreshold}件・受注予定日が{dateInYear(demand.periodEnd, today)}より後 {demand.outsidePeriod}件・不備 {demand.withDefect}件
        </Text>
      </section>

      <MonthTable demand={demand} value={monthValue} onValue={setMonthValue} />
    </Stack>
  )
}

const MONTH_VALUES: { value: MonthValue; label: string }[] = [
  { value: 'expected', label: '期待数量' },
  { value: 'quantity', label: 'すべて受注した場合' },
  { value: 'firstOrder', label: '初回の目安' },
]

function MonthTable({ demand, value, onValue }: { demand: DealDemand; value: MonthValue; onValue: (value: MonthValue) => void }) {
  const parts = [...new Set(demand.byMonth.map((entry) => entry.partNumber))]
  // The expected quantity takes in the first orders with their chances, as the handoff does.
  const cell = (partNumber: string, month: string) => {
    const entry = demand.byMonth.find((candidate) => candidate.partNumber === partNumber && candidate.month === month)
    if (!entry) return 0
    return value === 'expected' ? entry.expected + entry.expectedFirstOrder : entry[value]
  }
  return (
    <section>
      <Group justify="space-between" mb="xs" wrap="wrap">
        <Title order={3} size="h5">
          月ごと
        </Title>
        <SegmentedControl
          size="xs"
          color="primary"
          aria-label="月ごとに出す数"
          data={MONTH_VALUES}
          value={value}
          onChange={(next) => onValue(next as MonthValue)}
        />
      </Group>
      <Paper withBorder>
        <Table.ScrollContainer minWidth={120 + demand.months.length * 90}>
          <Table verticalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th className="sticky-col">型番</Table.Th>
                {demand.months.map((month) => (
                  <Table.Th key={month} ta="right">
                    {yearMonth(month)}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {parts.map((partNumber) => (
                <Table.Tr key={partNumber}>
                  <Table.Th scope="row" className="sticky-col" fw={400}>
                    {partNumber}
                  </Table.Th>
                  {demand.months.map((month) => {
                    const amount = cell(partNumber, month)
                    return (
                      <Table.Td key={month} ta="right" className="tabular" c={amount === 0 ? 'dimmed' : undefined}>
                        {amount === 0 ? '—' : pieces(amount)}
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
  )
}

function StageBadge({ stage }: { stage: string }) {
  const status = dealStatus(stage)
  const color = status === 'won' ? 'teal' : status === 'lost' ? 'gray' : status === 'unknown' ? 'red' : 'blue'
  return (
    <Badge variant="light" color={color} radius="sm" size="sm" fz="xs" miw="max-content">
      {stage}
    </Badge>
  )
}

function ProblemBadges({ problems }: { problems: DealProblem[] }) {
  const defects = problems.filter((problem) => problem.level === 'defect').length
  const warnings = problems.length - defects
  if (defects + warnings === 0) return null
  return (
    <Group gap={4} wrap="nowrap">
      {defects > 0 && (
        <Badge color="red" variant="light" radius="sm" size="sm" fz="xs">
          不備 {defects}
        </Badge>
      )}
      {warnings > 0 && (
        <Badge color="orange" variant="light" radius="sm" size="sm" fz="xs">
          注意 {warnings}
        </Badge>
      )}
    </Group>
  )
}

function DealLink({ deal, onEdit }: { deal: Deal; onEdit: (deal: Deal) => void }) {
  return (
    <Anchor component="button" type="button" size="sm" ta="left" onClick={() => onEdit(deal)}>
      {deal.name}
    </Anchor>
  )
}

function ListPanel({
  insights,
  today,
  parts,
  onEdit,
  pointed,
  onPointed,
}: {
  insights: DealInsights
  today: IsoDate
  parts: Part[]
  onEdit: (deal: Deal) => void
  pointed: string | null
  onPointed: () => void
}) {
  const [scope, setScope] = useState<'open' | 'all'>('open')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const tableRef = useRef<HTMLDivElement>(null)
  const { deals, chances } = insights
  // The deals handed to the plan, at its threshold.
  const counted = new Set(insights.handoffDemand.counted.map((entry) => entry.deal.id))
  const words = query.trim().toLowerCase()
  const shown = deals
    .filter((deal) => scope === 'all' || dealStatus(deal.stage) === 'open')
    .filter((deal) => words === '' || [deal.name, deal.customer, deal.partNumber, deal.owner].some((field) => field.toLowerCase().includes(words)))
    .sort((a, b) => (scope === 'all' ? b.closeDate.localeCompare(a.closeDate) : a.closeDate.localeCompare(b.closeDate)) || a.id.localeCompare(b.id))
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE))
  const pointedPage = pointed ? Math.floor(shown.findIndex((deal) => deal.id === pointed) / PAGE_SIZE) + 1 : 0
  const current = Math.min(pointedPage > 0 ? pointedPage : page, pages)
  // The deal just saved is brought into view, marked for a moment and given keyboard focus.
  // Its page stays shown until the planner moves to another.
  useEffect(() => {
    if (!pointed) return
    const row = document.getElementById(`deal-row-${pointed}`)
    if (!row) return
    row.scrollIntoView({ block: 'center' })
    row.classList.add('is-pointed')
    // After the drawer has closed and handed focus back to what opened it.
    const focus = window.setTimeout(() => row.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }), 350)
    const fade = window.setTimeout(() => row.classList.remove('is-pointed'), 2400)
    return () => {
      window.clearTimeout(focus)
      window.clearTimeout(fade)
    }
  }, [pointed])
  return (
    <Stack gap="sm">
      <Group gap="sm" wrap="wrap">
        <SegmentedControl
          color="primary"
          aria-label="表示する商談"
          data={[
            { value: 'open', label: '進行中' },
            { value: 'all', label: 'すべて' },
          ]}
          value={scope}
          onChange={(value) => {
            setScope(value as 'open' | 'all')
            setPage(1)
            onPointed()
          }}
        />
        <TextInput
          aria-label="商談を探す"
          placeholder="商談名・取引先・型番・担当者"
          leftSection={<IconSearch size={16} />}
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value)
            setPage(1)
            onPointed()
          }}
          w={280}
        />
        <Text size="sm" c="dimmed" className="tabular" aria-live="polite">
          {shown.length}件
        </Text>
      </Group>
      <Paper withBorder ref={tableRef}>
        <Table.ScrollContainer minWidth={1000}>
          <Table verticalSpacing={6} highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                {/* The chance and whether the deal goes to the plan come right after its name. */}
                <Table.Th className="sticky-col">商談名</Table.Th>
                <Table.Th ta="right">受注確率</Table.Th>
                <Table.Th>ステージ</Table.Th>
                <Table.Th ta="right">受注予定日</Table.Th>
                <Table.Th>型番</Table.Th>
                <Table.Th ta="right">量産数量（月）</Table.Th>
                <Table.Th ta="right">期待数量</Table.Th>
                <Table.Th>取引先</Table.Th>
                <Table.Th>担当者</Table.Th>
                <Table.Th ta="right">延期</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {shown.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={10}>
                    <Text size="sm" c="dimmed">
                      見つかりません
                    </Text>
                  </Table.Td>
                </Table.Tr>
              )}
              {shown.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE).map((deal) => {
                const probability = chances.get(deal.id)
                const open = dealStatus(deal.stage) === 'open'
                return (
                  <Table.Tr key={deal.id} id={`deal-row-${deal.id}`}>
                    <Table.Th scope="row" className="sticky-col" fw={400}>
                      <Stack gap={2} align="flex-start">
                        <DealLink deal={deal} onEdit={onEdit} />
                        {open && <ProblemBadges problems={dealProblems(deal, parts, today)} />}
                      </Stack>
                    </Table.Th>
                    <Table.Td ta="right" className="tabular">
                      <Group gap={6} justify="flex-end" wrap="nowrap">
                        {counted.has(deal.id) && (
                          <Badge variant="light" color="blue" radius="sm" size="sm" fz="xs" miw="max-content">
                            計画に渡す
                          </Badge>
                        )}
                        {probability === undefined ? '—' : chance(probability)}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <StageBadge stage={deal.stage} />
                    </Table.Td>
                    <Table.Td ta="right" className="tabular" c={open && deal.closeDate < today ? 'red' : undefined}>
                      {dateInYear(deal.closeDate, today)}
                    </Table.Td>
                    <Table.Td>{deal.partNumber || '—'}</Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {pieces(deal.monthlyQuantity)}
                    </Table.Td>
                    <Table.Td ta="right" className="tabular">
                      {probability === undefined ? '—' : pieces(deal.monthlyQuantity * probability)}
                    </Table.Td>
                    <Table.Td>{deal.customer}</Table.Td>
                    <Table.Td>{deal.owner}</Table.Td>
                    <Table.Td ta="right" className="tabular" fw={deal.postponeCount >= 3 ? 700 : undefined}>
                      {deal.postponeCount}
                    </Table.Td>
                  </Table.Tr>
                )
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Paper>
      {pages > 1 && (
        <Pagination
          total={pages}
          value={current}
          onChange={(next) => {
            setPage(next)
            onPointed()
            tableRef.current?.scrollIntoView({ block: 'start' })
          }}
          getControlProps={(control) => ({ 'aria-label': PAGE_CONTROLS[control] ?? control })}
          getItemProps={(item) => ({ 'aria-label': `${item}ページ` })}
        />
      )}
    </Stack>
  )
}

function ProblemsPanel({ insights, today, parts, onEdit }: { insights: DealInsights; today: IsoDate; parts: Part[]; onEdit: (deal: Deal) => void }) {
  const rows = insights.deals
    .filter((deal) => dealStatus(deal.stage) === 'open')
    .flatMap((deal) => dealProblems(deal, parts, today).map((problem) => ({ deal, problem })))
    .sort((a, b) => a.problem.level.localeCompare(b.problem.level) || a.deal.closeDate.localeCompare(b.deal.closeDate))
  if (rows.length === 0) return <Text c="dimmed">確認の要る商談はありません</Text>
  return (
    <Paper withBorder>
      <Table.ScrollContainer minWidth={760}>
        <Table verticalSpacing={6}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={150}>
                <VisuallyHidden>区分</VisuallyHidden>
              </Table.Th>
              <Table.Th>内容</Table.Th>
              <Table.Th>商談名</Table.Th>
              <Table.Th>取引先</Table.Th>
              <Table.Th>担当者</Table.Th>
              <Table.Th ta="right">受注予定日</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map(({ deal, problem }) => (
              <Table.Tr key={`${deal.id}-${problem.code}`}>
                <Table.Td>
                  <Badge color={problem.level === 'defect' ? 'red' : 'orange'} variant="light" radius="sm" size="sm" fz="xs" miw="max-content">
                    {problem.level === 'defect' ? '不備・数えない' : '注意・数える'}
                  </Badge>
                </Table.Td>
                <Table.Td>{problem.message}</Table.Td>
                <Table.Th scope="row" fw={400}>
                  <DealLink deal={deal} onEdit={onEdit} />
                </Table.Th>
                <Table.Td>{deal.customer}</Table.Td>
                <Table.Td>{deal.owner}</Table.Td>
                <Table.Td ta="right" className="tabular">
                  {dateInYear(deal.closeDate, today)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Paper>
  )
}

function ModelPanel({ insights }: { insights: DealInsights }) {
  const { training } = insights
  if (!training.ok) {
    return (
      <Alert color="orange" variant="light" title="受注確率を出せません">
        {training.reason}
      </Alert>
    )
  }
  const { scores } = training
  const metrics: { label: string; value: string }[] = [
    { label: 'AUC', value: scores.auc.toFixed(3) },
    { label: '平均適合率', value: scores.averagePrecision.toFixed(3) },
    { label: '適合率（50%で切る）', value: scores.precision.toFixed(3) },
    { label: '再現率（50%で切る）', value: scores.recall.toFixed(3) },
    { label: 'F1', value: scores.f1.toFixed(3) },
    { label: '正解率', value: scores.accuracy.toFixed(3) },
    { label: '対数損失', value: scores.logLoss.toFixed(3) },
  ]
  return (
    <Stack gap="lg" maw={960}>
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Paper withBorder p="md">
          <Text size="sm" c="dimmed">
            学習した商談
          </Text>
          <Text size="xl" fw={700} className="tabular">
            {scores.wonDeals + scores.lostDeals}件
          </Text>
          <Text size="sm" className="tabular">
            受注 {scores.wonDeals}・失注 {scores.lostDeals}
          </Text>
        </Paper>
        <Paper withBorder p="md">
          <Text size="sm" c="dimmed">
            Brier スコア
          </Text>
          <Text size="xl" fw={700} className="tabular">
            {scores.brier.toFixed(3)}
          </Text>
          <Text size="sm" className="tabular">
            全部に同じ確率なら {scores.baselineBrier.toFixed(3)}
          </Text>
        </Paper>
        <Paper withBorder p="md">
          <Text size="sm" c="dimmed">
            学習した日
          </Text>
          <Text size="xl" fw={700} className="tabular">
            {shortDate(training.model.trainedOn)}
          </Text>
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
        <section>
          <Title order={3} size="h5" mb="xs">
            確率の帯ごとの受注の割合
          </Title>
          <Paper withBorder p="md">
            <Stack gap={6}>
              {scores.calibration.map((bin) => (
                <Group key={bin.from} gap="sm" wrap="nowrap">
                  <Text size="sm" w={64} className="tabular">
                    {percent(bin.from)}〜
                  </Text>
                  <div className="bar-track" aria-hidden>
                    <div className="bar-fill" style={{ width: `${bin.won * 100}%` }} />
                    {bin.rows > 0 && <div className="bar-mark" style={{ left: `${bin.predicted * 100}%` }} />}
                  </div>
                  <Text size="sm" w={128} ta="right" className="tabular">
                    {bin.rows === 0 ? '—' : `予測${percent(bin.predicted)} 実際${percent(bin.won)}`}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        </section>
        <section>
          <Title order={3} size="h5" mb="xs">
            効いている特徴
          </Title>
          <Paper withBorder p="md">
            <Stack gap={6}>
              {scores.importance.slice(0, 10).map((entry) => (
                <Group key={entry.feature} gap="sm" wrap="nowrap">
                  <Text size="sm" w={200} truncate="end" title={entry.feature}>
                    {entry.feature}
                  </Text>
                  <div className="bar-track" aria-hidden>
                    <div className="bar-fill" style={{ width: `${(entry.share / scores.importance[0].share) * 100}%` }} />
                  </div>
                  <Text size="sm" w={56} ta="right" className="tabular">
                    {percent(entry.share)}
                  </Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        </section>
      </SimpleGrid>

      <section>
        <Title order={3} size="h5" mb="xs">
          学習に使っていない商談で当てた成績
        </Title>
        <Paper withBorder>
          <Table>
            <Table.Tbody>
              {metrics.map((metric) => (
                <Table.Tr key={metric.label}>
                  <Table.Th scope="row" fw={400}>
                    {metric.label}
                  </Table.Th>
                  <Table.Td ta="right" className="tabular">
                    {metric.value}
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Paper>
      </section>
    </Stack>
  )
}
