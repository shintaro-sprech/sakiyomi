// The chance that each open deal is won in the end, learned from the deals already won or
// lost. It is not the chance of winning by the close date.
//
// Training: every closed deal gives one row for each open stage it went through, taken at
// the middle of its time at that stage, with the deal rolled back to how it stood then. The
// row is labelled with how the deal ended. A deal with no stage changes kept gives none.
// Features: days at the stage, days since the deal came in, postponements so far and days to
// the close date; the stage, the kind of customer, how the inquiry came in and what the part
// is for, one column per value; and the words of the salesperson's note, weighted by how
// rare they are across notes (tf-idf, scaled to length 1).
// Model: gradient-boosted trees (gbdt.ts). The closed deals are split into up to five groups
// with about the same share of wins, keeping each deal's rows together; each group is
// predicted by trees trained on the others, which gives the scores below, and an open deal
// gets the average of those trees. Rows are not reweighted by outcome, so the chance is
// multiplied into quantities as it is.
import { dealAsOf, dealStatus, OPEN_STAGES } from './deals'
import { logLoss, predictProbability, trainBooster, type Booster, type BoostOptions, type Dataset } from './gbdt'
import type { Deal, DealChange, IsoDate } from './types'

export const MODEL_OPTIONS: BoostOptions = {
  rounds: 300,
  learningRate: 0.1,
  maxDepth: 3,
  minLeafRows: 8,
  l2: 1,
  featureFraction: 0.8,
  bins: 32,
  earlyStop: 30,
  seed: 7,
}

const CATEGORICAL = ['stage', 'customerKind', 'source', 'use'] as const
type CategoricalField = (typeof CATEGORICAL)[number]
const CATEGORY_NAMES: Record<CategoricalField, string> = { stage: 'ステージ', customerKind: '取引先の種別', source: '引き合いの経路', use: '用途' }
const NUMERIC_NAMES = ['ステージにいる日数', '登録からの日数', '延期回数', '受注予定日までの日数']

export type FeatureSpace = {
  levels: Record<CategoricalField, string[]>
  vocabulary: string[]
  idf: number[]
}

export type WinModel = {
  trainedOn: IsoDate
  space: FeatureSpace
  boosters: Booster[]
}

export type ModelScores = {
  rows: number
  wonDeals: number
  lostDeals: number
  folds: number
  // Out-of-fold scores: each row predicted by trees that never saw its deal.
  auc: number
  averagePrecision: number
  // At a cut of 50%.
  precision: number
  recall: number
  f1: number
  accuracy: number
  logLoss: number
  brier: number
  // The Brier score of giving every row the share of won rows: what the model must beat.
  baselineBrier: number
  // Rows grouped by predicted chance in tenths: how often those deals were won.
  calibration: { from: number; to: number; rows: number; predicted: number; won: number }[]
  // How much each feature lowered the loss, as a share of the total, largest first.
  importance: { feature: string; share: number }[]
}

export type TrainResult = { ok: true; model: WinModel; scores: ModelScores } | { ok: false; reason: string }

type Row = { dealId: string; label: number; features: Features }
type Features = { numeric: number[]; categories: Record<CategoricalField, string>; tokens: string[] }

const MINUTES_PER_DAY = 24 * 60

// Minutes since 1970 of a local date and time, YYYY-MM-DDTHH:MM, counted as if UTC.
function minutesOf(at: string): number {
  const [day, clock = '00:00'] = at.split('T')
  const [year, month, date] = day.split('-').map(Number)
  const [hours, minutes] = clock.split(':').map(Number)
  return Date.UTC(year, month - 1, date, hours, minutes) / 60_000
}

function atOf(minutes: number): string {
  return new Date(Math.round(minutes) * 60_000).toISOString().slice(0, 16)
}

let segmenter: Intl.Segmenter | null = null

// The words of a note, as the browser's own Japanese word breaker finds them. Words written in
// hiragana alone, such as particles and the endings of verbs, carry little of their own and
// are left out.
export function tokenize(note: string): string[] {
  segmenter ??= new Intl.Segmenter('ja', { granularity: 'word' })
  return [...segmenter.segment(note.normalize('NFKC'))]
    .filter((part) => part.isWordLike && !/^[\u3041-\u309f]+$/.test(part.segment))
    .map((part) => part.segment.toLowerCase())
}

// The deal as it stood at a moment, with the time the stage it was at began.
function featuresAt(deal: Deal, stageStart: number, now: number): Features {
  return {
    numeric: [
      (now - stageStart) / MINUTES_PER_DAY,
      (now - minutesOf(`${deal.createdOn}T00:00`)) / MINUTES_PER_DAY,
      deal.postponeCount,
      (minutesOf(`${deal.closeDate}T00:00`) - now) / MINUTES_PER_DAY,
    ],
    categories: { stage: deal.stage, customerKind: deal.customerKind, source: deal.source, use: deal.use },
    tokens: tokenize(deal.note),
  }
}

// One row per open stage a closed deal went through.
export function trainingRows(deals: Deal[], changes: DealChange[]): Row[] {
  const byDeal = new Map<string, DealChange[]>()
  for (const change of changes) byDeal.set(change.dealId, [...(byDeal.get(change.dealId) ?? []), change])
  const rows: Row[] = []
  for (const deal of deals) {
    const status = dealStatus(deal.stage)
    if (status !== 'won' && status !== 'lost') continue
    const own = (byDeal.get(deal.id) ?? []).sort((a, b) => a.at.localeCompare(b.at))
    const stageChanges = own.filter((change) => change.field === 'stage')
    if (stageChanges.length === 0) continue
    const created = own.find((change) => change.field === 'created')?.at ?? `${deal.createdOn}T00:00`
    const periods = stageChanges.map((change, index) => ({
      stage: change.from,
      start: index === 0 ? created : stageChanges[index - 1].at,
      end: change.at,
    }))
    for (const period of periods) {
      if (!(OPEN_STAGES as readonly string[]).includes(period.stage)) continue
      const start = minutesOf(period.start)
      const end = minutesOf(period.end)
      if (end <= start) continue
      const middle = (start + end) / 2
      const past = dealAsOf(deal, own, atOf(middle))
      if (!past) continue
      rows.push({ dealId: deal.id, label: status === 'won' ? 1 : 0, features: featuresAt({ ...past, stage: period.stage }, start, middle) })
    }
  }
  return rows
}

function buildSpace(rows: Row[]): FeatureSpace {
  const levels = Object.fromEntries(
    CATEGORICAL.map((field) => [field, [...new Set(rows.map((row) => row.features.categories[field]))].sort()]),
  ) as Record<CategoricalField, string[]>
  // A word kept must appear in at least two notes and in no more than eight notes in ten.
  const documentCount = new Map<string, number>()
  for (const row of rows) for (const token of new Set(row.features.tokens)) documentCount.set(token, (documentCount.get(token) ?? 0) + 1)
  const vocabulary = [...documentCount.entries()]
    .filter(([, count]) => count >= 2 && count <= 0.8 * rows.length)
    .map(([token]) => token)
    .sort()
  const idf = vocabulary.map((token) => Math.log((1 + rows.length) / (1 + (documentCount.get(token) ?? 0))) + 1)
  return { levels, vocabulary, idf }
}

function featureNames(space: FeatureSpace): string[] {
  return [
    ...NUMERIC_NAMES,
    ...CATEGORICAL.flatMap((field) => space.levels[field].map((level) => `${CATEGORY_NAMES[field]}：${level}`)),
    ...space.vocabulary.map((token) => `メモの「${token}」`),
  ]
}

function vectorOf(space: FeatureSpace, features: Features): number[] {
  const oneHot = CATEGORICAL.flatMap((field) => space.levels[field].map((level) => (features.categories[field] === level ? 1 : 0)))
  const counts = new Map<string, number>()
  for (const token of features.tokens) counts.set(token, (counts.get(token) ?? 0) + 1)
  const weights = space.vocabulary.map((token, index) => (counts.get(token) ?? 0) * space.idf[index])
  const length = Math.sqrt(weights.reduce((total, weight) => total + weight * weight, 0))
  return [...features.numeric, ...oneHot, ...weights.map((weight) => (length > 0 ? weight / length : 0))]
}

// Splits the deals into folds with about the same share of wins, the same way every time.
function foldsOf(rows: Row[], count: number): Map<string, number> {
  const labels = new Map(rows.map((row) => [row.dealId, row.label]))
  const fold = new Map<string, number>()
  for (const label of [1, 0]) {
    const ids = [...labels.entries()].filter(([, value]) => value === label).map(([id]) => id).sort()
    ids.forEach((id, index) => fold.set(id, index % count))
  }
  return fold
}

export function trainWinModel(deals: Deal[], changes: DealChange[], today: IsoDate, options = MODEL_OPTIONS): TrainResult {
  const rows = trainingRows(deals, changes)
  if (rows.length === 0) return { ok: false, reason: '学習に使える、受注か失注になった商談のステージの履歴がありません' }
  const dealLabels = new Map(rows.map((row) => [row.dealId, row.label]))
  const wonDeals = [...dealLabels.values()].filter((label) => label === 1).length
  const lostDeals = dealLabels.size - wonDeals
  if (wonDeals < 2 || lostDeals < 2) return { ok: false, reason: '受注と失注の商談が、それぞれ2件以上要ります' }
  const space = buildSpace(rows)
  const vectors = rows.map((row) => vectorOf(space, row.features))
  const folds = Math.min(5, wonDeals, lostDeals)
  const foldOf = foldsOf(rows, folds)
  const outOfFold = new Array<number>(rows.length).fill(0)
  const boosters: Booster[] = []
  for (let fold = 0; fold < folds; fold += 1) {
    const pick = (inFold: boolean): Dataset => {
      const chosen = rows.map((row, index) => ({ row, index })).filter(({ row }) => (foldOf.get(row.dealId) === fold) === inFold)
      return { x: chosen.map(({ index }) => vectors[index]), y: chosen.map(({ row }) => row.label), w: chosen.map(() => 1) }
    }
    const booster = trainBooster(pick(false), pick(true), { ...options, seed: options.seed + fold })
    boosters.push(booster)
    rows.forEach((row, index) => {
      if (foldOf.get(row.dealId) === fold) outOfFold[index] = predictProbability(booster, vectors[index])
    })
  }
  const labels = rows.map((row) => row.label)
  return {
    ok: true,
    model: { trainedOn: today, space, boosters },
    scores: { rows: rows.length, wonDeals, lostDeals, folds, ...scoresOf(labels, outOfFold), importance: importanceOf(boosters, featureNames(space)) },
  }
}

// The chance each open deal is won, as of today. The time at the stage counts from the last
// stage change kept, or from the day the stage changed when none is kept.
export function predictOpenDeals(model: WinModel, deals: Deal[], changes: DealChange[], today: IsoDate): Map<string, number> {
  const now = minutesOf(`${today}T23:59`)
  const lastStage = new Map<string, string>()
  for (const change of changes) if (change.field === 'stage') lastStage.set(change.dealId, change.at)
  const chances = new Map<string, number>()
  for (const deal of deals) {
    if (dealStatus(deal.stage) !== 'open') continue
    const start = minutesOf(lastStage.get(deal.id) ?? `${deal.stageChangedOn}T00:00`)
    const vector = vectorOf(model.space, featuresAt(deal, Math.min(start, now), now))
    const chance = model.boosters.reduce((total, booster) => total + predictProbability(booster, vector), 0) / model.boosters.length
    chances.set(deal.id, chance)
  }
  return chances
}

function importanceOf(boosters: Booster[], names: string[]): ModelScores['importance'] {
  const gains = new Array<number>(names.length).fill(0)
  for (const booster of boosters) {
    for (const tree of booster.trees) for (const node of tree) if ('feature' in node) gains[node.feature] += node.gain
  }
  const total = gains.reduce((sum, gain) => sum + gain, 0)
  return names
    .map((feature, index) => ({ feature, share: total > 0 ? gains[index] / total : 0 }))
    .filter((entry) => entry.share > 0)
    .sort((a, b) => b.share - a.share)
}

export function scoresOf(y: number[], p: number[]): Omit<ModelScores, 'rows' | 'wonDeals' | 'lostDeals' | 'folds' | 'importance'> {
  const n = y.length
  const positives = y.filter((label) => label === 1).length
  const order = p.map((_, index) => index).sort((a, b) => p[b] - p[a])
  // Area under the ROC curve from ranks, ties sharing their average rank.
  const ranks = new Array<number>(n)
  const ascending = [...order].reverse()
  for (let start = 0; start < n; ) {
    let end = start
    while (end + 1 < n && p[ascending[end + 1]] === p[ascending[start]]) end += 1
    for (let index = start; index <= end; index += 1) ranks[ascending[index]] = (start + end) / 2 + 1
    start = end + 1
  }
  const negatives = n - positives
  const rankSum = y.reduce((total, label, index) => total + (label === 1 ? ranks[index] : 0), 0)
  const auc = positives > 0 && negatives > 0 ? (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives) : 0.5
  // Average precision: precision at each won row, going down the chances.
  let hits = 0
  let precisionSum = 0
  order.forEach((index, position) => {
    if (y[index] === 1) {
      hits += 1
      precisionSum += hits / (position + 1)
    }
  })
  const averagePrecision = positives > 0 ? precisionSum / positives : 0
  const predicted = p.map((value) => (value >= 0.5 ? 1 : 0))
  const truePositive = predicted.filter((value, index) => value === 1 && y[index] === 1).length
  const predictedPositive = predicted.filter((value) => value === 1).length
  const precision = predictedPositive > 0 ? truePositive / predictedPositive : 0
  const recall = positives > 0 ? truePositive / positives : 0
  const share = positives / n
  const calibration = Array.from({ length: 10 }, (_, tenth) => {
    const members = p.map((_, index) => index).filter((index) => Math.min(Math.floor(p[index] * 10), 9) === tenth)
    return {
      from: tenth / 10,
      to: (tenth + 1) / 10,
      rows: members.length,
      predicted: members.length > 0 ? members.reduce((total, index) => total + p[index], 0) / members.length : 0,
      won: members.length > 0 ? members.filter((index) => y[index] === 1).length / members.length : 0,
    }
  })
  return {
    auc,
    averagePrecision,
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    accuracy: predicted.filter((value, index) => value === y[index]).length / n,
    logLoss: logLoss(y, p),
    brier: p.reduce((total, value, index) => total + (value - y[index]) ** 2, 0) / n,
    baselineBrier: y.reduce((total, label) => total + (share - label) ** 2, 0) / n,
    calibration,
  }
}
