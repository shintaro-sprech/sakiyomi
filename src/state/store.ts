import { useCallback, useEffect, useMemo, useState } from 'react'

import { createSampleData, sampleActuals, sampleChannelStocks, sampleCustomerOrders } from '../../sample-data/sample'
import { localToday } from '../engine/dates'
import type { PlanState } from '../engine/plan'
import { applyChanges, buildScenario, ChangeError, pinAddedOrders, type Change } from '../engine/scenario'
import { createDefaultSettings, createSampleSettings } from '../engine/settings'
import type { Equipment, PlantData, Settings } from '../engine/types'

// A change the planner put into the plan, kept with the reasoning behind it.
export type Decision = {
  id: string
  // ISO date and time the planner adopted it.
  at: string
  title: string
  changes: Change[]
  labels: string[]
  reason: string
  tradeoff: string
  // What the planner wrote about why they chose it.
  note: string
  // The option card it came from, so the card shows whether it is still in the plan.
  sourceKey?: string
}

export type SavedState = {
  version: 3
  data: PlantData
  settings: Settings
  decisions: Decision[]
  dataSource: 'sample' | 'excel'
}

// Bumped when the saved shape changes. Version 2 had no crews; it is carried
// over with the sample's crews, or none for data read from Excel. Older saves
// are replaced by the sample.
const STORAGE_KEY = 'sakiyomi:v3'
const PREVIOUS_KEY = 'sakiyomi:v2'

function createInitialState(): SavedState {
  return {
    version: 3,
    data: createSampleData(localToday()),
    settings: createSampleSettings(),
    decisions: [],
    dataSource: 'sample',
  }
}

// Browser storage can be missing or blocked; the app then runs on the sample without saving.
function load(): SavedState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SavedState
      if (parsed.version === 3) return withSampleAdditions(withProcessLists(withShiftSettings(parsed)))
    }
    const previous = window.localStorage.getItem(PREVIOUS_KEY)
    if (previous) {
      const parsed = JSON.parse(previous) as Omit<SavedState, 'version'> & { version: number }
      if (parsed.version === 2) return withSampleAdditions(withProcessLists(withShiftSettings(fromVersion2(parsed))))
    }
  } catch {
    // Fall through to a fresh sample.
  }
  return createInitialState()
}

// Settings saved before shifts were kept had a day shift only and no night premium. Data
// read from Excel keeps its day shift. The sample plant runs three shifts now, with three
// times the quantities to fill them, so a sample saved before is made afresh: its orders and
// the decisions on them no longer fit. The planner's other settings stay, the day shift's
// hours among them.
export function withShiftSettings(saved: SavedState, today = localToday()): SavedState {
  const settings: Partial<Settings> = saved.settings
  if (settings.shifts !== undefined) return saved
  if (saved.dataSource !== 'sample') {
    const { shifts, nightPremium } = createDefaultSettings()
    return { ...saved, settings: { ...saved.settings, shifts, nightPremium } }
  }
  const { shifts, nightPremium } = createSampleSettings()
  return {
    ...saved,
    data: createSampleData(today),
    settings: { ...saved.settings, shifts, nightPremium },
    decisions: [],
  }
}

// Machines saved before one could take several processes had a single process and no
// speed. A saved sample takes the sample's machines, routes and crews' processes, none of
// which the app edits, so its multi-tasking machine has work; the crews keep their people.
function withProcessLists(saved: SavedState): SavedState {
  const equipment = saved.data.equipment as (Equipment & { process?: string })[]
  if (equipment.every((item) => Array.isArray(item.processes))) return saved
  const lists = equipment.map(({ process, ...item }) => ({ ...item, processes: item.processes ?? [process ?? ''] }))
  if (saved.dataSource !== 'sample') return { ...saved, data: { ...saved.data, equipment: lists } }
  const sample = createSampleData(localToday())
  const fromSample = new Map(sample.equipment.map((item) => [item.id, item]))
  const crewProcesses = new Map(sample.crews.map((crew) => [crew.name, crew.processes]))
  return {
    ...saved,
    data: {
      ...saved.data,
      routes: sample.routes,
      equipment: lists.map((item) => {
        const match = fromSample.get(item.id)
        return match ? { ...item, processes: match.processes, ...(match.speed ? { speed: match.speed } : {}) } : item
      }),
      crews: saved.data.crews.map((crew) => ({ ...crew, processes: crewProcesses.get(crew.name) ?? crew.processes })),
    },
  }
}

// A sample saved before the sample had something gets it, each part on its own: the part
// each machine ran last, material on hand and its lead time. Something the planner cleared,
// such as a machine's last part set to none, is kept as empty and not filled in again. The
// steps lots have been through, the customer orders and the distributors' reports are not
// edited in the app, so they are made afresh from the saved lots and orders and from today:
// their dates fit a sample saved on another day. An order with no customer orders saved
// keeps none.
function withSampleAdditions(saved: SavedState): SavedState {
  if (saved.dataSource !== 'sample') return saved
  const sample = createSampleData(localToday())
  let data = saved.data
  if (!data.equipment.some((item) => 'lastPart' in item)) {
    const lastParts = new Map(sample.equipment.map((item) => [item.id, item.lastPart]))
    data = { ...data, equipment: data.equipment.map((item) => ({ ...item, lastPart: lastParts.get(item.id) })) }
  }
  if (!data.parts.some((part) => 'materialStock' in part)) {
    const material = new Map(sample.parts.map((part) => [part.partNumber, part.materialStock]))
    data = { ...data, parts: data.parts.map((part) => ({ ...part, materialStock: material.get(part.partNumber) })) }
  }
  if (!data.parts.some((part) => 'materialLeadDays' in part)) {
    const lead = new Map(sample.parts.map((part) => [part.partNumber, part.materialLeadDays]))
    data = { ...data, parts: data.parts.map((part) => ({ ...part, materialLeadDays: lead.get(part.partNumber) })) }
  }
  const customerOrders = sampleCustomerOrders(data.orders)
  const served = data.customerOrders && new Set(data.customerOrders.map((entry) => entry.orderId))
  data = {
    ...data,
    actuals: sampleActuals(data),
    customerOrders: served ? customerOrders.filter((entry) => served.has(entry.orderId)) : customerOrders,
    channelStocks: sampleChannelStocks(localToday()),
  }
  return { ...saved, data }
}

function fromVersion2(saved: Omit<SavedState, 'version'>): SavedState {
  const sample = createSampleData(localToday())
  const fromSample = saved.dataSource === 'sample'
  return {
    ...saved,
    version: 3,
    data: {
      ...saved.data,
      crews: fromSample ? sample.crews : [],
      attendance: fromSample ? sample.attendance : [],
    },
  }
}

function save(state: SavedState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Keep working without saving.
  }
}

export function useAppState() {
  const [saved, setSaved] = useState<SavedState>(load)
  const today = localToday()

  useEffect(() => save(saved), [saved])

  const planState: PlanState = useMemo(
    () => ({
      data: saved.data,
      settings: saved.settings,
      adopted: saved.decisions.flatMap((decision) => decision.changes),
      today,
    }),
    [saved, today],
  )

  // A decision whose changes no longer apply, such as an option Claude made before a
  // decision it names was undone, is not adopted. Returns why, or null once adopted.
  const adopt = useCallback(
    (decision: Omit<Decision, 'id' | 'at'>): string | null => {
      const adopted = saved.decisions.flatMap((entry) => entry.changes)
      const changes = pinAddedOrders(saved.data, saved.settings, adopted, decision.changes, today)
      try {
        applyChanges(buildScenario(saved.data, saved.settings, adopted, today, []), changes, today)
      } catch (error) {
        if (error instanceof ChangeError) return error.message
        throw error
      }
      setSaved((current) => ({
        ...current,
        decisions: [...current.decisions, { ...decision, changes, id: crypto.randomUUID(), at: new Date().toISOString() }],
      }))
      return null
    },
    [saved, today],
  )

  // A decision a later one builds on, such as the order a later hold names, stays until the
  // later one is undone. Returns the titles of those later decisions, or null once undone.
  // Changes that already did not apply do not count.
  const removeDecision = useCallback(
    (id: string): string | null => {
      const failing = (decisions: Decision[]) => {
        const skipped: Change[] = []
        buildScenario(saved.data, saved.settings, decisions.flatMap((decision) => decision.changes), today, skipped)
        return skipped
      }
      const before = failing(saved.decisions)
      const rest = saved.decisions.filter((decision) => decision.id !== id)
      const broken = failing(rest).filter((change) => !before.includes(change))
      if (broken.length > 0) {
        return rest
          .filter((decision) => decision.changes.some((change) => broken.includes(change)))
          .map((decision) => `「${decision.title}」`)
          .join('')
      }
      setSaved((current) => ({ ...current, decisions: current.decisions.filter((decision) => decision.id !== id) }))
      return null
    },
    [saved, today],
  )

  const updateSettings = useCallback((settings: Settings) => {
    setSaved((current) => ({ ...current, settings }))
  }, [])

  // Edits that keep the same orders and lots, such as setup times, keep the decisions too.
  const updateData = useCallback((data: PlantData) => {
    setSaved((current) => ({ ...current, data }))
  }, [])

  const replaceData = useCallback((data: PlantData, dataSource: SavedState['dataSource']) => {
    setSaved((current) => ({ ...current, data, dataSource, decisions: [] }))
  }, [])

  const resetToSample = useCallback(() => setSaved(createInitialState()), [])

  return { saved, planState, adopt, removeDecision, updateSettings, updateData, replaceData, resetToSample }
}

export type AppState = ReturnType<typeof useAppState>
