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
  NumberInput,
  Paper,
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

import type { Settings } from '../engine/types'
import type { AppState } from '../state/store'

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
    (value: number | string) => {
      if (typeof value === 'number') set(key, clamp(value, min, max))
    }

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

  const setSetup = (id: string, value: number | string) => {
    if (typeof value !== 'number') return
    app.updateData({
      ...data,
      equipment: data.equipment.map((item) => (item.id === id ? { ...item, setupMinutes: clamp(value, 0, 24 * 60) } : item)),
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

  async function onExport() {
    const { downloadWorkbook } = await import('../data/excel')
    downloadWorkbook(data, 'sakiyomi-data.xlsx')
  }

  function onReset() {
    app.resetToSample()
    setImportErrors([])
    setImportMessage(null)
    reset.close()
  }

  return (
    <Stack gap="xl" maw={980}>
      <section>
        <Title order={2} size="h4" mb="sm">
          稼働と計画
        </Title>
        <Paper withBorder p="lg">
          <Grid gap="lg">
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
              <NumberInput
                label="ガントに出す期間"
                suffix=" 日"
                min={3}
                max={60}
                value={settings.horizonDays}
                onChange={setNumber('horizonDays', 3, 60)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, lg: 3 }}>
              <NumberInput
                label="工程間の待ち時間"
                suffix=" 分"
                min={0}
                max={24 * 60}
                step={10}
                value={settings.transferMinutes}
                onChange={setNumber('transferMinutes', 0, 24 * 60)}
              />
            </Grid.Col>
            <Grid.Col span={{ base: 6, lg: 3 }}>
              <NumberInput
                label="止まっているLotの警告"
                suffix=" 日以上"
                min={1}
                max={60}
                value={settings.stagnationWarningDays}
                onChange={setNumber('stagnationWarningDays', 1, 60)}
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
          設備
        </Title>
        <Paper withBorder>
          <Table verticalSpacing="xs" horizontalSpacing={6}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>設備</Table.Th>
                <Table.Th>担当工程</Table.Th>
                <Table.Th w={150}>段取り</Table.Th>
                <Table.Th w={90}>止める</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {data.equipment.map((equipment) => (
                <Table.Tr key={equipment.id}>
                  <Table.Td>{equipment.name}</Table.Td>
                  <Table.Td>{equipment.process}</Table.Td>
                  <Table.Td>
                    <NumberInput
                      size="xs"
                      suffix=" 分"
                      min={0}
                      max={24 * 60}
                      step={5}
                      value={equipment.setupMinutes}
                      onChange={(value) => setSetup(equipment.id, value)}
                      aria-label={`${equipment.name}の段取り時間`}
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
        </Paper>
      </section>

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
          </Alert>
        )}
      </section>

      <Modal
        opened={resetOpened}
        onClose={reset.close}
        title="サンプルに戻す"
        centered
        closeButtonProps={{ 'aria-label': '閉じる' }}
      >
        <Text size="sm">読み込んだデータと判断の記録は消えます。</Text>
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
