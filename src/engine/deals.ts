import { daysBetween } from './dates'
import type { Deal, DealChange, DealField, IsoDate, Part } from './types'

// The stages of a deal in the order it moves through them. The first four are open; a deal
// is closed when it is won or lost.
export const OPEN_STAGES = ['引き合い', '見積', '試作', '量産の内示'] as const
export const WON_STAGE = '受注'
export const LOST_STAGE = '失注'
export const DEAL_STAGES = [...OPEN_STAGES, WON_STAGE, LOST_STAGE] as const

// Choices for the fields the win model reads. Values outside them are kept as written.
export const CUSTOMER_KINDS = ['既存', '新規'] as const
export const DEAL_SOURCES = ['既存の取引先', '紹介', '展示会', 'Webサイト'] as const
export const DEAL_USES = ['建機', '農機', '産業機械', '物流機器'] as const

// An open deal whose stage has not moved for this many days is flagged.
export const STALE_STAGE_DAYS = 90

export type DealStatus = 'open' | 'won' | 'lost' | 'unknown'

export function dealStatus(stage: string): DealStatus {
  if ((OPEN_STAGES as readonly string[]).includes(stage)) return 'open'
  if (stage === WON_STAGE) return 'won'
  if (stage === LOST_STAGE) return 'lost'
  return 'unknown'
}

// What a deal holds that the salesperson enters; the rest is kept by the app.
export type DealInput = Pick<
  Deal,
  'name' | 'customer' | 'owner' | 'partNumber' | 'stage' | 'closeDate' | 'monthlyQuantity' | 'customerKind' | 'source' | 'use' | 'note'
>

const FIELDS: DealField[] = [
  'name',
  'customer',
  'owner',
  'partNumber',
  'stage',
  'closeDate',
  'monthlyQuantity',
  'customerKind',
  'source',
  'use',
  'note',
]

// A new deal and the row that records it. at is the local date and time, YYYY-MM-DDTHH:MM.
export function createDeal(id: string, input: DealInput, at: string): { deal: Deal; changes: DealChange[] } {
  const day = at.slice(0, 10)
  const deal: Deal = { id, ...input, createdOn: day, stageChangedOn: day, postponeCount: 0 }
  return { deal, changes: [{ dealId: id, field: 'created', from: '', to: '', at }] }
}

// Saves an edit: one row for each field that changed, all at the same time. Moving the
// close date later counts as one more postponement; moving it earlier does not take one back.
export function editDeal(deal: Deal, input: DealInput, at: string): { deal: Deal; changes: DealChange[] } {
  const changes: DealChange[] = FIELDS.filter((field) => String(deal[field]) !== String(input[field])).map((field) => ({
    dealId: deal.id,
    field,
    from: String(deal[field]),
    to: String(input[field]),
    at,
  }))
  const postponed = input.closeDate > deal.closeDate
  return {
    deal: {
      ...deal,
      ...input,
      stageChangedOn: input.stage !== deal.stage ? at.slice(0, 10) : deal.stageChangedOn,
      postponeCount: deal.postponeCount + (postponed ? 1 : 0),
    },
    changes,
  }
}

// Something wrong with a deal. A defect keeps it out of the demand it adds up to; a warning
// leaves it in and asks the salesperson to look.
export type DealProblem = {
  code: 'noPart' | 'badQuantity' | 'badStage' | 'unknownPart' | 'closeDatePassed' | 'staleStage'
  level: 'defect' | 'warning'
  message: string
}

export function dealProblems(deal: Deal, parts: Part[], today: IsoDate): DealProblem[] {
  const problems: DealProblem[] = []
  const status = dealStatus(deal.stage)
  if (status === 'unknown') problems.push({ code: 'badStage', level: 'defect', message: `ステージ「${deal.stage}」は使えません` })
  if (deal.partNumber.trim() === '') {
    problems.push({ code: 'noPart', level: 'defect', message: '型番が入っていません' })
  } else if (!parts.some((part) => part.partNumber === deal.partNumber)) {
    problems.push({ code: 'unknownPart', level: 'warning', message: `型番「${deal.partNumber}」が品目にありません` })
  }
  if (!(deal.monthlyQuantity > 0) || !Number.isFinite(deal.monthlyQuantity)) {
    problems.push({ code: 'badQuantity', level: 'defect', message: '量産数量（月）が0より大きくありません' })
  }
  if (status === 'open' && deal.closeDate < today) {
    problems.push({ code: 'closeDatePassed', level: 'warning', message: '受注予定日が過ぎています' })
  }
  if (status === 'open' && daysBetween(deal.stageChangedOn, today) >= STALE_STAGE_DAYS) {
    problems.push({ code: 'staleStage', level: 'warning', message: `ステージが${STALE_STAGE_DAYS}日以上変わっていません` })
  }
  return problems
}

export function hasDefect(deal: Deal, parts: Part[], today: IsoDate): boolean {
  return dealProblems(deal, parts, today).some((problem) => problem.level === 'defect')
}

// Why a deal cannot be saved as entered, field by field, or an empty list.
export type DealInputError = { field: keyof DealInput; message: string }

export function dealInputErrors(input: DealInput): DealInputError[] {
  const errors: DealInputError[] = []
  if (input.name.trim() === '') errors.push({ field: 'name', message: '商談名を入れてください' })
  if (input.customer.trim() === '') errors.push({ field: 'customer', message: '取引先を入れてください' })
  if (input.owner.trim() === '') errors.push({ field: 'owner', message: '担当者を入れてください' })
  if (!(DEAL_STAGES as readonly string[]).includes(input.stage)) errors.push({ field: 'stage', message: 'ステージを選んでください' })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.closeDate) || input.closeDate < '2000-01-01' || input.closeDate > '2099-12-31') {
    errors.push({ field: 'closeDate', message: '受注予定日を日付で入れてください' })
  }
  if (!Number.isFinite(input.monthlyQuantity) || input.monthlyQuantity <= 0) {
    errors.push({ field: 'monthlyQuantity', message: '量産数量（月）は0より大きい数にしてください' })
  }
  return errors
}

// The deal as it stood just before a moment, rolled back through the changes made at or
// after it. Returns null when the deal did not exist yet. Changes must be in time order.
export function dealAsOf(deal: Deal, changes: DealChange[], at: string): Deal | null {
  const own = changes.filter((change) => change.dealId === deal.id)
  const created = own.find((change) => change.field === 'created')
  if ((created ? created.at : deal.createdOn) >= at) return null
  const past: Deal = { ...deal }
  let postponeCount = deal.postponeCount
  let stageChangedOn: IsoDate | null = null
  for (const change of [...own].reverse()) {
    if (change.at < at || change.field === 'created') continue
    if (change.field === 'monthlyQuantity') past.monthlyQuantity = Number(change.from)
    else past[change.field] = change.from
    if (change.field === 'closeDate' && change.to > change.from) postponeCount -= 1
  }
  for (const change of own) {
    if (change.at < at && change.field === 'stage') stageChangedOn = change.at.slice(0, 10)
  }
  return { ...past, postponeCount: Math.max(0, postponeCount), stageChangedOn: stageChangedOn ?? past.createdOn }
}
