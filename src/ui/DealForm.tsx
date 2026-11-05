import { Autocomplete, Button, Drawer, Group, NumberInput, Select, Stack, Textarea, TextInput } from '@mantine/core'
import { useState } from 'react'

import { CUSTOMER_KINDS, DEAL_SOURCES, DEAL_STAGES, DEAL_USES, dealInputErrors, type DealInput, type DealInputError } from '../engine/deals'
import type { Deal } from '../engine/types'

type Props = {
  // The deal being edited, or null for a new one.
  deal: Deal | null
  opened: boolean
  parts: string[]
  owners: string[]
  customers: string[]
  // 既存 or 新規 for a customer already known, else null.
  kindOf: (customer: string) => string | null
  onClose: () => void
  onSave: (input: DealInput) => void
}

const EMPTY: DealInput = {
  name: '',
  customer: '',
  owner: '',
  partNumber: '',
  stage: DEAL_STAGES[0],
  closeDate: '',
  monthlyQuantity: 0,
  customerKind: '',
  source: '',
  use: '',
  note: '',
}

// Entering or editing one deal. Nothing is saved until 保存する; a field that cannot be saved
// as entered says why under it.
export function DealForm({ deal, opened, parts, owners, customers, kindOf, onClose, onSave }: Props) {
  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="right"
      size="md"
      title={deal ? deal.name : '商談を登録'}
      closeButtonProps={{ 'aria-label': '閉じる' }}
    >
      {/* A fresh form for each deal opened, so what was typed for one does not carry over. */}
      {opened && <DealFields key={deal?.id ?? 'new'} deal={deal} parts={parts} owners={owners} customers={customers} kindOf={kindOf} onSave={onSave} onCancel={onClose} />}
    </Drawer>
  )
}

function DealFields({
  deal,
  parts,
  owners,
  customers,
  kindOf,
  onSave,
  onCancel,
}: Omit<Props, 'opened' | 'onClose'> & { onCancel: () => void }) {
  const [input, setInput] = useState<DealInput>(() =>
    deal
      ? {
          name: deal.name,
          customer: deal.customer,
          owner: deal.owner,
          partNumber: deal.partNumber,
          stage: deal.stage,
          closeDate: deal.closeDate,
          monthlyQuantity: deal.monthlyQuantity,
          customerKind: deal.customerKind,
          source: deal.source,
          use: deal.use,
          note: deal.note,
        }
      : EMPTY,
  )
  const [errors, setErrors] = useState<DealInputError[]>([])
  const set = <K extends keyof DealInput>(key: K, value: DealInput[K]) => setInput((current) => ({ ...current, [key]: value }))
  const postponing = deal !== null && input.closeDate > deal.closeDate
  const choices = (values: readonly string[], current: string) => (values.includes(current) || current === '' ? [...values] : [...values, current])
  const error = (field: keyof DealInput) => errors.find((entry) => entry.field === field)?.message

  function save() {
    const found = dealInputErrors(input)
    setErrors(found)
    if (found.length === 0) onSave(input)
    // The first field to fix takes focus, and its message is read with it.
    else document.getElementById(`deal-${found[0].field}`)?.focus()
  }

  return (
    <Stack gap="sm">
      <TextInput id="deal-name" label="商談名" required value={input.name} error={error('name')} onChange={(event) => set('name', event.currentTarget.value)} />
      <Group grow align="flex-start">
        <Autocomplete
          id="deal-customer"
          label="取引先"
          required
          data={customers}
          value={input.customer}
          error={error('customer')}
          onChange={(value) => {
            set('customer', value)
            // A known customer brings whether it already buys.
            const kind = kindOf(value)
            if (kind) set('customerKind', kind)
          }}
        />
        <Autocomplete id="deal-owner" label="担当者" required data={owners} value={input.owner} error={error('owner')} onChange={(value) => set('owner', value)} />
      </Group>
      <Group grow align="flex-start">
        <Select
          id="deal-stage"
          label="ステージ"
          required
          allowDeselect={false}
          data={choices(DEAL_STAGES, input.stage)}
          value={input.stage}
          error={error('stage')}
          onChange={(value) => value && set('stage', value)}
        />
        <TextInput
          id="deal-closeDate"
          label="受注予定日"
          type="date"
          required
          value={input.closeDate}
          error={error('closeDate')}
          onChange={(event) => set('closeDate', event.currentTarget.value)}
          description={postponing ? `延期回数が${deal.postponeCount}から${deal.postponeCount + 1}になります` : undefined}
        />
      </Group>
      <Group grow align="flex-start">
        <Autocomplete id="deal-partNumber" label="型番" data={parts} value={input.partNumber} onChange={(value) => set('partNumber', value)} />
        <NumberInput
          id="deal-monthlyQuantity"
          label="量産数量（月）"
          required
          min={0}
          thousandSeparator=","
          value={input.monthlyQuantity}
          error={error('monthlyQuantity')}
          onChange={(value) => set('monthlyQuantity', typeof value === 'number' ? value : Number(value) || 0)}
        />
      </Group>
      <Group grow align="flex-start">
        <Select
          label="取引先の種別"
          allowDeselect={false}
          data={choices(CUSTOMER_KINDS, input.customerKind)}
          value={input.customerKind || null}
          onChange={(value) => set('customerKind', value ?? '')}
        />
        <Select
          label="引き合いの経路"
          allowDeselect={false}
          data={choices(DEAL_SOURCES, input.source)}
          value={input.source || null}
          onChange={(value) => set('source', value ?? '')}
        />
      </Group>
      <Select label="用途" data={choices(DEAL_USES, input.use)} value={input.use || null} onChange={(value) => set('use', value ?? '')} />
      <Textarea label="メモ" autosize minRows={2} value={input.note} onChange={(event) => set('note', event.currentTarget.value)} />
      <Group justify="flex-end">
        <Button variant="default" onClick={onCancel}>
          やめる
        </Button>
        <Button onClick={save}>保存する</Button>
      </Group>
    </Stack>
  )
}
