// Fictional sales opportunities made for this project. Customers, salespeople, deal names,
// notes and quantities do not come from any real company. Dates are relative to the day the
// app is opened, like the rest of the sample.
//
// The closed deals are drawn from a seeded random walk, so every day gives the same history:
// a deal moves through the open stages and is lost at a stage or won after the last one. How
// likely it moves on depends on what the deal is (a customer that already buys, how the
// inquiry came in, what the part is for) and on something no field shows. Weak deals are
// postponed more often, and the notes the salesperson writes lean the way the deal is going.
// The open deals are written out by hand, so the demand they add is the same on any day.
import { addDays } from '../src/engine/dates'
import { CUSTOMER_KINDS, DEAL_SOURCES, DEAL_USES, LOST_STAGE, OPEN_STAGES, WON_STAGE } from '../src/engine/deals'
import type { Deal, DealChange, IsoDate } from '../src/engine/types'

const OWNERS = ['営業A', '営業B', '営業C']
const KNOWN_CUSTOMERS = ['取引先A', '取引先B', '取引先C', '取引先D', '取引先E']
const NEW_CUSTOMERS = ['取引先M', '取引先N', '取引先P', '取引先Q', '取引先R', '取引先S', '取引先T', '取引先U']

// Typical monthly quantity per part, as a range in pieces.
const QUANTITIES: Record<string, [number, number]> = {
  'A-100': [20, 90],
  'B-200': [10, 50],
  'C-310': [30, 120],
  'D-410': [10, 40],
}

const OPENING_NOTES = ['初回の打ち合わせを済ませた', '図面を受け取った', '見積の条件を確認中']
const GOOD_NOTES = ['試作品の評価が良好', '先方の購買も前向き', '量産の時期を先方と相談中', '図面が確定した', '既存品と同じ材質で進める']
const BAD_NOTES = ['他社と価格を比較中', '先方の計画がまだ決まらない', '担当者が異動した', '予算の承認待ちが長引いている', '仕様の変更が続いている']

const NAMES = ['ブラケット', 'フレーム', 'シャフト', 'カバー', 'フランジ', 'ステー', 'アーム', '取付板', 'カップリング', 'ピン']

export function sampleDeals(today: IsoDate): { deals: Deal[]; dealChanges: DealChange[] } {
  const closed = closedDeals(today)
  const open = openDeals(today)
  const dealChanges = [...closed.dealChanges, ...open.dealChanges].sort((a, b) => a.at.localeCompare(b.at) || a.dealId.localeCompare(b.dealId))
  return { deals: [...closed.deals, ...open.deals], dealChanges }
}

// A small seeded generator (mulberry32), so the sample is the same every time.
function generator(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    between: (low: number, high: number) => low + Math.floor(next() * (high - low + 1)),
    pick: <T,>(items: readonly T[]) => items[Math.floor(next() * items.length)],
    normal: () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next()),
  }
}

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value))

const EFFECTS = {
  customerKind: { 既存: 0.6, 新規: -0.3 } as Record<string, number>,
  source: { 既存の取引先: 0.5, 紹介: 0.4, 展示会: -0.2, Webサイト: -0.5 } as Record<string, number>,
  use: { 建機: 0.2, 農機: 0, 産業機械: 0.1, 物流機器: -0.2 } as Record<string, number>,
}
// Moving on from each open stage gets easier the further a deal has come.
const STAGE_PASS = [1.0, 0.8, 1.1, 2.8]

function closedDeals(today: IsoDate): { deals: Deal[]; dealChanges: DealChange[] } {
  const random = generator(20261105)
  const deals: Deal[] = []
  const dealChanges: DealChange[] = []
  const clock = () => `T${String(random.between(9, 17)).padStart(2, '0')}:${String(random.pick([0, 15, 30, 45])).padStart(2, '0')}`

  for (let index = 0; index < 280; index += 1) {
    const id = `S-${String(index + 1).padStart(4, '0')}`
    const customerKind = random.next() < 0.55 ? CUSTOMER_KINDS[0] : CUSTOMER_KINDS[1]
    const customer = customerKind === '既存' ? random.pick(KNOWN_CUSTOMERS) : random.pick(NEW_CUSTOMERS)
    const source = customerKind === '既存' && random.next() < 0.6 ? DEAL_SOURCES[0] : random.pick(DEAL_SOURCES.slice(1))
    const use = random.pick(DEAL_USES)
    const partNumber = random.pick(Object.keys(QUANTITIES))
    const [low, high] = QUANTITIES[partNumber]
    const monthlyQuantity = Math.round(random.between(low, high) / 5) * 5
    const strength =
      EFFECTS.customerKind[customerKind] + EFFECTS.source[source] + EFFECTS.use[use] + 0.7 * random.normal() - (monthlyQuantity > 0.8 * high ? 0.2 : 0)

    // Walk the stages in days from the day the deal came in, then place the walk so the deal
    // closed at least a week ago, somewhere in the last two and a half years.
    type Step = { day: number; field: DealChange['field']; from: string; to: string }
    const steps: Step[] = [{ day: 0, field: 'created', from: '', to: '' }]
    const firstNote = random.pick(OPENING_NOTES)
    let closeDay = random.between(60, 150)
    let note = firstNote
    let day = 0
    let stage: string = OPEN_STAGES[0]
    let postponeCount = 0
    let stageChangedDay = 0
    for (let level = 0; level < OPEN_STAGES.length; level += 1) {
      const length = random.between(10, 45) + (strength < 0 ? random.between(0, 20) : 0)
      if (random.next() < 0.15 + (strength < 0 ? 0.25 : 0)) {
        const later = closeDay + random.between(14, 45)
        steps.push({ day: day + Math.floor(length / 2), field: 'closeDate', from: String(closeDay), to: String(later) })
        closeDay = later
        postponeCount += 1
      }
      if (level >= 1 && random.next() < 0.5) {
        const leaning = strength + 0.8 * random.normal() > 0
        const written = random.pick(leaning ? GOOD_NOTES : BAD_NOTES)
        if (written !== note) {
          steps.push({ day: day + Math.floor(length / 3), field: 'note', from: note, to: written })
          note = written
        }
      }
      day += length
      const passes = random.next() < sigmoid(strength + STAGE_PASS[level])
      const next = passes ? (level + 1 < OPEN_STAGES.length ? OPEN_STAGES[level + 1] : WON_STAGE) : LOST_STAGE
      steps.push({ day, field: 'stage', from: stage, to: next })
      stage = next
      stageChangedDay = day
      if (!passes) break
    }
    const createdOn = addDays(today, -(7 + day + random.between(0, 800)))
    const dateOf = (offset: number) => addDays(createdOn, offset)
    for (const step of steps) {
      const isDate = step.field === 'closeDate'
      dealChanges.push({
        dealId: id,
        field: step.field,
        from: isDate ? dateOf(Number(step.from)) : step.from,
        to: isDate ? dateOf(Number(step.to)) : step.to,
        at: `${dateOf(step.day)}${clock()}`,
      })
    }
    deals.push({
      id,
      name: `${use}の${random.pick(NAMES)}`,
      customer,
      owner: OWNERS[index % OWNERS.length],
      partNumber,
      stage,
      closeDate: dateOf(closeDay),
      monthlyQuantity,
      customerKind,
      source,
      use,
      note,
      createdOn,
      stageChangedOn: dateOf(stageChangedDay),
      postponeCount,
    })
  }
  // The rows of one deal were made in time order, but the stage rows were pushed after the
  // others of their stage; sort them so every list of changes runs in time order.
  dealChanges.sort((a, b) => a.at.localeCompare(b.at) || a.dealId.localeCompare(b.dealId))
  return { deals, dealChanges }
}

// The deals still open today, written out by hand.
type OpenDeal = {
  name: string
  customer: string
  customerKind: '既存' | '新規'
  source: (typeof DEAL_SOURCES)[number]
  use: (typeof DEAL_USES)[number]
  partNumber: string
  stage: (typeof OPEN_STAGES)[number]
  // Days from today to the close date, and the days ago the deal came in.
  closeIn: number
  createdAgo: number
  monthlyQuantity: number
  note: string
  // Times the close date was moved later, each by three weeks.
  postponed?: number
  // Days since the deal reached its stage; 12 when not given.
  stageAgo?: number
}

const OPEN_DEALS: OpenDeal[] = [
  { name: '新機種の油圧ブラケット', customer: '取引先A', customerKind: '既存', source: '既存の取引先', use: '建機', partNumber: 'A-100', stage: '量産の内示', closeIn: 20, createdAgo: 150, monthlyQuantity: 80, note: '量産の時期を先方と相談中' },
  { name: '旋回フレームの部品', customer: '取引先F', customerKind: '新規', source: '紹介', use: '建機', partNumber: 'B-200', stage: '試作', closeIn: 35, createdAgo: 110, monthlyQuantity: 60, note: '試作品の評価が良好' },
  { name: '搬送ラインの補強板', customer: '取引先G', customerKind: '新規', source: '展示会', use: '物流機器', partNumber: 'A-100', stage: '見積', closeIn: 45, createdAgo: 60, monthlyQuantity: 40, note: '他社と価格を比較中' },
  { name: 'コンバインのシャフト', customer: '取引先B', customerKind: '既存', source: '既存の取引先', use: '農機', partNumber: 'B-200', stage: '量産の内示', closeIn: 12, createdAgo: 180, monthlyQuantity: 45, note: '図面が確定した' },
  { name: '制御盤の取付板', customer: '取引先H', customerKind: '新規', source: 'Webサイト', use: '産業機械', partNumber: 'C-310', stage: '引き合い', closeIn: 70, createdAgo: 20, monthlyQuantity: 100, note: '初回の打ち合わせを済ませた' },
  { name: 'ポンプのカップリング', customer: '取引先C', customerKind: '既存', source: '紹介', use: '産業機械', partNumber: 'D-410', stage: '見積', closeIn: 40, createdAgo: 45, monthlyQuantity: 30, note: '見積の条件を確認中' },
  { name: 'フォークリフトのステー', customer: '取引先I', customerKind: '新規', source: '展示会', use: '物流機器', partNumber: 'C-310', stage: '試作', closeIn: 55, createdAgo: 90, monthlyQuantity: 80, note: '先方の計画がまだ決まらない', postponed: 2, stageAgo: 45 },
  { name: '油圧ユニットのフランジ', customer: '取引先A', customerKind: '既存', source: '既存の取引先', use: '建機', partNumber: 'D-410', stage: '試作', closeIn: 30, createdAgo: 75, monthlyQuantity: 25, note: '既存品と同じ材質で進める' },
  { name: '田植機のアーム', customer: '取引先J', customerKind: '新規', source: '紹介', use: '農機', partNumber: 'A-100', stage: '見積', closeIn: 60, createdAgo: 70, monthlyQuantity: 50, note: '予算の承認待ちが長引いている', postponed: 1 },
  { name: '工作機械のカバー', customer: '取引先K', customerKind: '新規', source: 'Webサイト', use: '産業機械', partNumber: '', stage: '引き合い', closeIn: 90, createdAgo: 10, monthlyQuantity: 60, note: '図面を受け取った' },
  { name: '新型ショベルのピン', customer: '取引先B', customerKind: '既存', source: '既存の取引先', use: '建機', partNumber: 'E-520', stage: '見積', closeIn: 50, createdAgo: 40, monthlyQuantity: 40, note: '見積の条件を確認中' },
  { name: '物流ロボットの軸', customer: '取引先L', customerKind: '新規', source: '展示会', use: '物流機器', partNumber: 'B-200', stage: '引き合い', closeIn: -5, createdAgo: 130, monthlyQuantity: 30, note: '担当者が異動した' },
  { name: 'トラクターのブラケット', customer: '取引先E', customerKind: '既存', source: '既存の取引先', use: '農機', partNumber: 'C-310', stage: '量産の内示', closeIn: 25, createdAgo: 160, monthlyQuantity: 60, note: '先方の購買も前向き' },
  { name: '搬送台車のフレーム', customer: '取引先G', customerKind: '新規', source: '展示会', use: '物流機器', partNumber: 'A-100', stage: '引き合い', closeIn: 80, createdAgo: 30, monthlyQuantity: 30, note: '仕様の変更が続いている' },
]

// Each open deal came in createdAgo days ago and moved up one stage at even steps to where it
// is, which it reached stageAgo days ago. A deal still at its first stage has been there since
// it came in. Its notes and postponements fall between.
function openDeals(today: IsoDate): { deals: Deal[]; dealChanges: DealChange[] } {
  const deals: Deal[] = []
  const dealChanges: DealChange[] = []
  OPEN_DEALS.forEach((spec, index) => {
    const id = `S-${String(index + 301).padStart(4, '0')}`
    const createdOn = addDays(today, -spec.createdAgo)
    const level = OPEN_STAGES.indexOf(spec.stage)
    const span = Math.max(spec.createdAgo - 14, 1)
    const reached = spec.createdAgo - (spec.stageAgo ?? 12)
    const stageDays = Array.from({ length: level }, (_, step) => Math.round((reached * (step + 1)) / level))
    const postponed = spec.postponed ?? 0
    const closeDate = addDays(today, spec.closeIn)
    const firstClose = addDays(closeDate, -21 * postponed)
    const at = (dayOffset: number, clock: string) => `${addDays(createdOn, dayOffset)}T${clock}`
    const rows: DealChange[] = [{ dealId: id, field: 'created', from: '', to: '', at: at(0, '10:00') }]
    stageDays.forEach((stageDay, step) => {
      rows.push({ dealId: id, field: 'stage', from: OPEN_STAGES[step], to: OPEN_STAGES[step + 1], at: at(stageDay, '15:00') })
    })
    for (let count = 0; count < postponed; count += 1) {
      const dayOffset = Math.round((span * (count + 1)) / (postponed + 1))
      rows.push({
        dealId: id,
        field: 'closeDate',
        from: addDays(firstClose, 21 * count),
        to: addDays(firstClose, 21 * (count + 1)),
        at: at(dayOffset, '11:30'),
      })
    }
    const opening = OPENING_NOTES[index % OPENING_NOTES.length]
    if (spec.note !== opening && spec.createdAgo > 14) {
      rows.push({ dealId: id, field: 'note', from: opening, to: spec.note, at: at(Math.max(spec.createdAgo - 10, 1), '16:30') })
    }
    rows.sort((a, b) => a.at.localeCompare(b.at))
    dealChanges.push(...rows)
    const lastStage = rows.filter((row) => row.field === 'stage').at(-1)
    deals.push({
      id,
      name: spec.name,
      customer: spec.customer,
      owner: OWNERS[index % OWNERS.length],
      partNumber: spec.partNumber,
      stage: spec.stage,
      closeDate,
      monthlyQuantity: spec.monthlyQuantity,
      customerKind: spec.customerKind,
      source: spec.source,
      use: spec.use,
      note: spec.note,
      createdOn,
      stageChangedOn: lastStage ? lastStage.at.slice(0, 10) : createdOn,
      postponeCount: postponed,
    })
  })
  dealChanges.sort((a, b) => a.at.localeCompare(b.at) || a.dealId.localeCompare(b.dealId))
  return { deals, dealChanges }
}
