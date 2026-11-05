import {
  ActionIcon,
  Alert,
  Button,
  FileButton,
  Grid,
  Group,
  Input,
  List,
  Modal,
  Paper,
  SegmentedControl,
  Select,
  Slider,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { IconDownload, IconRefresh, IconUpload } from '@tabler/icons-react'
import { useState } from 'react'

import { addDays, weekday } from '../engine/dates'
import { buildScenario } from '../engine/scenario'
import { SHIFT_STARTS } from '../engine/settings'
import type { Crew, IsoDate, Settings } from '../engine/types'
import type { AppState } from '../state/store'
import { shortDate, weekdayName } from './format'
import { NumberField } from './NumberField'

type PartNumberKey = 'price' | 'materialCost' | 'stock' | 'monthlyUsage'

const PART_NUMBERS: { key: PartNumberKey; label: string; suffix: string }[] = [
  { key: 'price', label: '売価', suffix: ' 円' },
  { key: 'materialCost', label: '材料費', suffix: ' 円' },
  { key: 'stock', label: '在庫', suffix: ' 個' },
  { key: 'monthlyUsage', label: '月間の出荷数', suffix: ' 個' },
]

// Select needs a value for "none"; an equipment without a last part keeps an empty one.
const NO_LAST_PART = 'none'

const WEEKDAYS = [
  { day: 1, label: '月' },
  { day: 2, label: '火' },
  { day: 3, label: '水' },
  { day: 4, label: '木' },
  { day: 5, label: '金' },
  { day: 6, label: '土' },
  { day: 0, label: '日' },
]

export function SettingsView({ app }: { app: AppState }) {
  const { saved } = app
  const { settings, data } = saved
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [resetOpened, reset] = useDisclosure(false)

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => app.updateSettings({ ...settings, [key]: value })
  const setNumber = (key: 'horizonDays' | 'transferMinutes' | 'stagnationWarningDays', min: number, max: number) =>
    (value: number) => set(key, clamp(value, min, max))

  const toggleWeekday = (day: number) =>
    set(
      'workWeekdays',
      settings.workWeekdays.includes(day)
        ? settings.workWeekdays.filter((item) => item !== day)
        : [...settings.workWeekdays, day].sort(),
    )

  const toggleStopped = (id: string, stopped: boolean) =>
    set(
      'stoppedEquipment',
      stopped ? [...settings.stoppedEquipment, id] : settings.stoppedEquipment.filter((item) => item !== id),
    )

  const setEquipmentNumber = (id: string, key: 'setupMinutes' | 'hourlyCost', value: number) => {
    app.updateData({
      ...data,
      equipment: data.equipment.map((item) => (item.id === id ? { ...item, [key]: clamp(value, 0, 1_000_000) } : item)),
    })
  }

  // 1 is the route's minutes per piece, and is saved as no speed at all.
  const setSpeed = (id: string, value: number) => {
    app.updateData({
      ...data,
      equipment: data.equipment.map((item) => {
        if (item.id !== id) return item
        const { speed: _previous, ...rest } = item
        return value === 1 ? rest : { ...rest, speed: value }
      }),
    })
  }

  const setLastPart = (id: string, lastPart: string) => {
    app.updateData({
      ...data,
      equipment: data.equipment.map((item) =>
        item.id === id ? { ...item, lastPart: lastPart === NO_LAST_PART ? '' : lastPart } : item,
      ),
    })
  }
  // The parts whose route passes the equipment's process: the only ones it can have run.
  const lastPartOptions = (processes: string[]) => [
    { value: NO_LAST_PART, label: 'なし' },
    ...data.parts
      .filter((part) => data.routes[part.partNumber]?.some((step) => processes.includes(step.name)))
      .map((part) => ({ value: part.partNumber, label: `${part.partNumber}　${part.shape}` })),
  ]

  const setPartNumber = (partNumber: string, key: PartNumberKey, value: number) => {
    app.updateData({
      ...data,
      parts: data.parts.map((part) =>
        part.partNumber === partNumber ? { ...part, [key]: clamp(value, 0, 100_000_000) } : part,
      ),
    })
  }

  const setCrewPeople = (name: string, key: 'people' | 'holidayPeople', value: number) => {
    app.updateData({
      ...data,
      crews: data.crews.map((crew) => (crew.name === name ? { ...crew, [key]: clamp(value, 0, 99) } : crew)),
    })
  }

  // The days the Gantt chart shows, days off among them: a crew may come in on a day off.
  const days = Array.from({ length: settings.horizonDays }, (_, index) => addDays(app.planState.today, index))
  const isDayOff = (date: IsoDate) => !settings.workWeekdays.includes(weekday(date))
  const usualPeople = (crew: Crew, date: IsoDate) => (isDayOff(date) ? (crew.holidayPeople ?? 0) : crew.people)

  // A day's number equal to the usual one for that day needs no entry of its own.
  const setAttendance = (crew: Crew, date: IsoDate, value: number) => {
    const people = clamp(value, 0, 99)
    const others = data.attendance.filter((entry) => !(entry.crew === crew.name && entry.date === date))
    app.updateData({
      ...data,
      attendance: people === usualPeople(crew, date) ? others : [...others, { crew: crew.name, date, people }],
    })
  }

  async function onImport(file: File | null) {
    if (!file) return
    const { readWorkbook } = await import('../data/excel')
    const { data: imported, errors } = await readWorkbook(file)
    setImportErrors(errors)
    if (imported) {
      app.replaceData(imported, 'excel')
      setImportMessage(`「${file.name}」を読み込みました（注残${imported.orders.length}件・Lot${imported.lots.length}件）`)
    } else {
      setImportMessage(null)
    }
  }

  // The workbook has the plan as it stands, with the orders added and the material ordered by
  // the decisions taken, so the plant's own records can catch up with it.
  async function onExport() {
    const { downloadWorkbook } = await import('../data/excel')
    const { data: planned } = buildScenario(data, app.saved.settings, app.planState.adopted, app.planState.today, [])
    downloadWorkbook(planned, 'sakiyomi-data.xlsx')
  }

  function onReset() {
    app.resetToSample()
    setImportErrors([])
    setImportMessage('サンプルに戻しました')
    reset.close()
  }

  return (
    <Stack gap="xl" maw={980}>
      {/* Data comes first: where the sample is replaced by a plant's own workbook. */}
      <section>
        <Title order={2} size="h4" mb="sm">
          データ
        </Title>
        <Group gap="sm">
          <Button variant="default" leftSection={<IconDownload size={16} />} onClick={() => void onExport()}>
            Excel に書き出す
          </Button>
          <FileButton onChange={(file) => void onImport(file)} accept=".xlsx,.xls">
            {(props) => (
              <Button variant="default" leftSection={<IconUpload size={16} />} {...props}>
                Excel を読み込む
              </Button>
            )}
          </FileButton>
          <Button variant="subtle" color="gray" leftSection={<IconRefresh size={16} />} onClick={reset.open}>
            サンプルに戻す
          </Button>
        </Group>
        {importMessage && (
          <Alert color="teal" variant="light" mt="md">
            {importMessage}
          </Alert>
        )}
        {importErrors.length > 0 && (
          <Alert color="red" variant="light" mt="md" title="読み込めませんでした">
            <List size="sm">
              {importErrors.map((message) => (
                <List.Item key={message}>{message}</List.Item>
              ))}
            </List>
            {/* The workbook written out is the template to fill in. */}
            <Button variant="default" mt="sm" leftSection={<IconDownload size={16} />} onClick={() => void onExport()}>
              ひな形を書き出す
            </Button>
          </Alert>
        )}
      </section>

      <section>
        <Title order={2} size="h4" mb="sm">
          稼働と計画
        </Title>
        <Paper withBorder p="lg">
          {/* Fields line up by their inputs, so a label that wraps on a narrow screen does not push its input down. */}
          <Grid gap="lg" align="flex-end">
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Input.Wrapper label="勤務" labelElement="div" labelProps={{ id: 'shifts-label' }}>
                <SegmentedControl
                  mt={4}
                  fullWidth
                  color="primary"
                  value={String(settings.shifts)}
                  onChange={(value) => set('shifts', Number(value) as Settings['shifts'])}
                  data={[
                    { value: '1', label: '日勤' },
                    { value: '3', label: '3交代' },
                  ]}
                  aria-labelledby="shifts-label"
                />
              </Input.Wrapper>
            </Grid.Col>
            {settings.shifts === 1 ? (
              <>
                <Grid.Col span={{ base: 6, lg: 3 }}>
                  <TextInput
                    type="time"
                    label="始業"
                    value={settings.workStart}
                    onChange={(event) => set('workStart', event.currentTarget.value)}
                  />
                </Grid.Col>
                <Grid.Col span={{ base: 6, lg: 3 }}>
                  <TextInput
                    type="time"
                    label="終業"
                    value={settings.workEnd}
                    onChange={(event) => set('workEnd', event.currentTarget.value)}
                  />
                </Grid.Col>
              </>
            ) : (
              <>
                <Grid.Col span={{ base: 6, lg: 3 }}>
                  <Input.Wrapper label="交代の時刻" labelElement="div">
                    <Text h={36} display="flex" style={{ alignItems: 'center' }} className="tabular">
                      {SHIFT_STARTS[settings.shifts].map((start) => start.replace(/^0/, '')).join('　')}
                    </Text>
                  </Input.Wrapper>
                </Grid.Col>
                <Grid.Col span={{ base: 6, lg: 3 }}>
                  <Input.Wrapper label="休日の勤務" labelElement="div" labelProps={{ id: 'holiday-shifts-label' }}>
                    <SegmentedControl
                      mt={4}
                      fullWidth
                      color="primary"
                      value={String(settings.holidayShifts)}
                      onChange={(value) => set('holidayShifts', Number(value) as Settings['holidayShifts'])}
                      data={[
                        { value: '1', label: '日勤' },
                        { value: '3', label: '3交代' },
                      ]}
                      aria-labelledby="holiday-shifts-label"
                    />
                  </Input.Wrapper>
                </Grid.Col>
              </>
            )}
            <Grid.Col span={{ base: 12, lg: 6 }}>
              <Input.Wrapper label="稼働する曜日" labelProps={{ id: 'workdays-label' }}>
                <Group gap={6} mt={4} role="group" aria-labelledby="workdays-label">
                  {WEEKDAYS.map(({ day, label }) => {
                    const on = settings.workWeekdays.includes(day)
                    return (
                      <ActionIcon
                        key={day}
                        size={36}
                        radius="xl"
                        variant={on ? 'filled' : 'default'}
                        aria-pressed={on}
                        aria-label={`${label}曜日`}
                        onClick={() => toggleWeekday(day)}
                      >
                        {label}
                      </ActionIcon>
                    )
                  })}
                </Group>
              </Input.Wrapper>
            </Grid.Col>
            <Grid.Col span={{ base: 6, lg: 3 }}>
              <NumberField
                label="ガントに出す期間"
                suffix=" 日"
                clampBehavior="blur"
                min={3}
                max={60}
                value={settings.horizonDays}
                onCommit={setNumber('horizonDays', 3, 60)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, lg: 3 }}>
              <NumberField
                label="工程間の待ち時間"
                suffix=" 分"
                min={0}
                max={24 * 60}
                step={10}
                value={settings.transferMinutes}
                onCommit={setNumber('transferMinutes', 0, 24 * 60)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, lg: 3 }}>
              <NumberField
                label={<span className="phrase">止まっているLotの警告</span>}
                suffix=" 日以上"
                min={1}
                max={60}
                value={settings.stagnationWarningDays}
                onCommit={setNumber('stagnationWarningDays', 1, 60)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, lg: 3 }}>
              <NumberField
                label="賃率（1人1時間）"
                suffix=" 円"
                thousandSeparator=","
                min={0}
                step={100}
                value={settings.laborRate}
                onCommit={(value) => set('laborRate', clamp(value, 0, 100000))}
              />
            </Grid.Col>
            {settings.shifts === 1 && (
              <Grid.Col span={{ base: 6, lg: 3 }}>
                <NumberField
                  label="残業の割増"
                  suffix=" %"
                  min={0}
                  max={100}
                  value={Math.round(settings.overtimePremium * 100)}
                  onCommit={(value) => set('overtimePremium', clamp(value, 0, 100) / 100)}
                />
              </Grid.Col>
            )}
            <Grid.Col span={{ base: 6, lg: 3 }}>
              <NumberField
                label="休日出勤の割増"
                suffix=" %"
                min={0}
                max={100}
                value={Math.round(settings.holidayPremium * 100)}
                onCommit={(value) => set('holidayPremium', clamp(value, 0, 100) / 100)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, lg: 3 }}>
              <NumberField
                label="深夜の割増"
                suffix=" %"
                min={0}
                max={100}
                value={Math.round(settings.nightPremium * 100)}
                onCommit={(value) => set('nightPremium', clamp(value, 0, 100) / 100)}
              />
            </Grid.Col>
          </Grid>
          <Stack gap={6} mt="xl">
            <Text size="sm" fw={500}>
              優先のつけ方
            </Text>
            <Group wrap="nowrap" gap="md">
              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                段取りを減らす
              </Text>
              <Slider
                style={{ flex: 1 }}
                min={0}
                max={1}
                step={0.1}
                value={settings.dueWeight}
                onChange={(value) => set('dueWeight', value)}
                label={null}
                thumbLabel="優先のつけ方"
                thumbValueText={describeWeight}
              />
              <Text size="sm" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                納期を守る
              </Text>
            </Group>
          </Stack>
        </Paper>
      </section>

      <section>
        <Title order={2} size="h4" mb="sm">
          品目
        </Title>
        <Paper withBorder>
          <Table.ScrollContainer minWidth={720}>
            <Table verticalSpacing="xs" horizontalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>型番</Table.Th>
                  <Table.Th>形状</Table.Th>
                  {PART_NUMBERS.map((column) => (
                    <Table.Th key={column.key} w={130}>
                      {column.label}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.parts.map((part) => (
                  <Table.Tr key={part.partNumber}>
                    <Table.Td>{part.partNumber}</Table.Td>
                    <Table.Td>{part.shape}</Table.Td>
                    {PART_NUMBERS.map((column) => (
                      <Table.Td key={column.key}>
                        <NumberField
                          size="xs"
                          suffix={column.suffix}
                          thousandSeparator=","
                          min={0}
                          value={part[column.key]}
                          onCommit={(value) => setPartNumber(part.partNumber, column.key, value)}
                          aria-label={`${part.partNumber}の${column.label}`}
                        />
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </section>

      <section>
        <Title order={2} size="h4" mb="sm">
          設備
        </Title>
        <Paper withBorder>
          <Table.ScrollContainer minWidth={840}>
            <Table verticalSpacing="xs" horizontalSpacing={6}>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th className="sticky-col">設備</Table.Th>
                  <Table.Th>担当工程</Table.Th>
                  <Table.Th w={110}>速さ</Table.Th>
                  <Table.Th w={110}>段取り</Table.Th>
                  <Table.Th w={120}>1時間の運転費</Table.Th>
                  <Table.Th w={160}>直前の型番</Table.Th>
                  <Table.Th w={80}>止める</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {data.equipment.map((equipment) => (
                  <Table.Tr key={equipment.id}>
                    <Table.Td className="sticky-col">{equipment.name}</Table.Td>
                    <Table.Td>{equipment.processes.join('・')}</Table.Td>
                    <Table.Td>
                      <NumberField
                        size="xs"
                        suffix=" 倍速"
                        allowDecimal
                        decimalScale={2}
                        min={0.1}
                        max={10}
                        step={0.05}
                        clampBehavior="blur"
                        value={equipment.speed ?? 1}
                        onCommit={(value) => setSpeed(equipment.id, value)}
                        aria-label={`${equipment.name}の速さ`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberField
                        size="xs"
                        suffix=" 分"
                        min={0}
                        max={24 * 60}
                        step={5}
                        value={equipment.setupMinutes}
                        onCommit={(value) => setEquipmentNumber(equipment.id, 'setupMinutes', value)}
                        aria-label={`${equipment.name}の段取り時間`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <NumberField
                        size="xs"
                        suffix=" 円"
                        thousandSeparator=","
                        min={0}
                        step={100}
                        value={equipment.hourlyCost}
                        onCommit={(value) => setEquipmentNumber(equipment.id, 'hourlyCost', value)}
                        aria-label={`${equipment.name}の1時間の運転費`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Select
                        size="xs"
                        data={lastPartOptions(equipment.processes)}
                        value={equipment.lastPart || NO_LAST_PART}
                        onChange={(value) => setLastPart(equipment.id, value ?? NO_LAST_PART)}
                        allowDeselect={false}
                        aria-label={`${equipment.name}の直前の型番`}
                      />
                    </Table.Td>
                    <Table.Td>
                      <Switch
                        checked={settings.stoppedEquipment.includes(equipment.id)}
                        onChange={(event) => toggleStopped(equipment.id, event.currentTarget.checked)}
                        aria-label={`${equipment.name}を止める`}
                      />
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Paper>
      </section>

      {data.crews.length > 0 && (
        <section>
          <Title order={2} size="h4" mb="sm">
            班と出勤
          </Title>
          <Paper withBorder>
            <Table.ScrollContainer minWidth={416 + days.length * 60}>
              <Table verticalSpacing="xs" horizontalSpacing={6}>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th className="sticky-col">班</Table.Th>
                    <Table.Th>担当工程</Table.Th>
                    <Table.Th w={96}>{settings.shifts === 1 ? 'いつも' : '1直'}</Table.Th>
                    <Table.Th w={96}>休日</Table.Th>
                    {days.map((date) => (
                      <Table.Th key={date} w={60} ta="center" className={`tabular${isDayOff(date) ? ' is-off' : ''}`}>
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
                      <Table.Td>{crew.processes.join('・')}</Table.Td>
                      <Table.Td>
                        <NumberField
                          size="xs"
                          suffix=" 人"
                          min={0}
                          max={99}
                          value={crew.people}
                          onCommit={(value) => setCrewPeople(crew.name, 'people', value)}
                          aria-label={settings.shifts === 1 ? `${crew.name}のいつもの人数` : `${crew.name}の1直の人数`}
                        />
                      </Table.Td>
                      <Table.Td>
                        <NumberField
                          size="xs"
                          suffix=" 人"
                          min={0}
                          max={99}
                          value={crew.holidayPeople ?? 0}
                          onCommit={(value) => setCrewPeople(crew.name, 'holidayPeople', value)}
                          aria-label={settings.shifts === 1 ? `${crew.name}の休日の人数` : `${crew.name}の休日の1直の人数`}
                        />
                      </Table.Td>
                      {days.map((date) => {
                        const entry = data.attendance.find((item) => item.crew === crew.name && item.date === date)
                        const differs = entry !== undefined && entry.people !== usualPeople(crew, date)
                        return (
                          <Table.Td key={date} className={isDayOff(date) ? 'is-off' : undefined}>
                            <NumberField
                              size="xs"
                              hideControls
                              min={0}
                              max={99}
                              value={entry?.people ?? usualPeople(crew, date)}
                              onCommit={(value) => setAttendance(crew, date, value)}
                              aria-label={`${crew.name}の${shortDate(date)}の人数`}
                              styles={{ input: { textAlign: 'center', fontWeight: differs ? 700 : undefined } }}
                              variant={differs ? 'filled' : 'default'}
                            />
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

      <Modal
        opened={resetOpened}
        onClose={reset.close}
        title="サンプルに戻す"
        centered
        closeButtonProps={{ 'aria-label': '閉じる' }}
      >
        <Text size="sm">読み込んだデータ、商談の変更、計画に渡した版と判断の記録は消えます。</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={reset.close} data-autofocus>
            やめる
          </Button>
          <Button color="red" onClick={onReset}>
            戻す
          </Button>
        </Group>
      </Modal>
    </Stack>
  )
}

// Read out by screen readers instead of the raw 0 to 1 value.
function describeWeight(dueWeight: number): string {
  const level = Math.round(dueWeight * 10)
  if (level >= 10) return '納期を守ることだけを見る'
  if (level <= 0) return '段取りを減らすことだけを見る'
  return `納期を守る側に ${level}、段取りを減らす側に ${10 - level}`
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.round(value), min), max)
}
