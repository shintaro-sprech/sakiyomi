import { useCallback, useEffect, useMemo, useState } from 'react'

import { createSampleData } from '../../sample-data/sample'
import { localToday } from '../engine/dates'
import type { PlanState } from '../engine/plan'
import type { Change } from '../engine/scenario'
import { createDefaultSettings } from '../engine/settings'
import type { PlantData, Settings } from '../engine/types'

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
    settings: createDefaultSettings(),
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
      if (parsed.version === 3) return parsed
    }
    const previous = window.localStorage.getItem(PREVIOUS_KEY)
    if (previous) {
      const parsed = JSON.parse(previous) as Omit<SavedState, 'version'> & { version: number }
      if (parsed.version === 2) return fromVersion2(parsed)
    }
  } catch {
    // Fall through to a fresh sample.
  }
  return createInitialState()
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

  const adopt = useCallback((decision: Omit<Decision, 'id' | 'at'>) => {
    setSaved((current) => ({
      ...current,
      decisions: [
        ...current.decisions,
        { ...decision, id: crypto.randomUUID(), at: new Date().toISOString() },
      ],
    }))
  }, [])

  const removeDecision = useCallback((id: string) => {
    setSaved((current) => ({ ...current, decisions: current.decisions.filter((decision) => decision.id !== id) }))
  }, [])

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
