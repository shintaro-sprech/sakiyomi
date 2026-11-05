import { useMemo } from 'react'

import { DEAL_DEMAND_DEFAULTS, dealDemand } from '../engine/dealDemand'
import type { Deal, DealChange, IsoDate, PlantData } from '../engine/types'
import { predictOpenDeals, trainWinModel } from '../engine/winModel'

const NO_DEALS: Deal[] = []
const NO_CHANGES: DealChange[] = []

// The win model, each open deal's chance and the demand the deals add up to. The model is
// trained again only when the deals change or the day turns.
export function useDealInsights(data: PlantData, today: IsoDate, threshold: number) {
  const deals = data.deals ?? NO_DEALS
  const changes = data.dealChanges ?? NO_CHANGES
  const training = useMemo(() => trainWinModel(deals, changes, today), [deals, changes, today])
  const chances = useMemo(
    () => (training.ok ? predictOpenDeals(training.model, deals, changes, today) : new Map<string, number>()),
    [training, deals, changes, today],
  )
  const demand = useMemo(
    () => dealDemand(deals, chances, data.parts, today, { ...DEAL_DEMAND_DEFAULTS, threshold }),
    [deals, chances, data.parts, today, threshold],
  )
  // What is handed to the plan is counted at the usual threshold, whatever the deals tab shows.
  const handoffDemand = useMemo(() => dealDemand(deals, chances, data.parts, today), [deals, chances, data.parts, today])
  return { deals, changes, training, chances, demand, handoffDemand }
}

export type DealInsights = ReturnType<typeof useDealInsights>
