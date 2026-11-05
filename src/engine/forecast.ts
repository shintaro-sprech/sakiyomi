// Demand forecast from the months of orders already taken, per part and plant: pieces that
// will be ordered in each coming month if orders keep the way they have gone. Deals are not
// in it; the two are shown side by side and never added up.
//
// Two ways are compared on the last three months the history has, each month predicted from
// the months before it: the average of the three months before (the simple way), and
// gradient-boosted trees trained on every series at once (gbdt.ts) on the earlier months.
// The trees are used when they miss by at least 10% less than the simple way, and every
// series has at least MODEL_MONTHS months; otherwise the simple way is used. A series with
// fewer than three months gets the average of what it has, as a figure for reference only.
//
// The months are counted from each series' first month to the last month of all the history,
// with no orders as 0. The forecast starts the month after that last month. The trees predict
// one month at a time, each month's prediction standing in for its orders in the next.
import { addMonths } from './dealDemand'
import { predictMargin, trainBooster, type Booster, type BoostOptions } from './gbdt'
import type { MonthlyOrder } from './types'

export const FORECAST_OPTIONS: BoostOptions = {
  objective: 'regression',
  rounds: 150,
  learningRate: 0.05,
  maxDepth: 3,
  minLeafRows: 5,
  l2: 1,
  featureFraction: 0.9,
  bins: 32,
  earlyStop: 150,
  seed: 11,
}

// Months a series needs before the trees may be used for it.
export const MODEL_MONTHS = 24
// How much smaller the trees' error must be, as a share of the simple way's.
export const MIN_IMPROVEMENT = 0.1
const BACKTEST_MONTHS = 3

export type ForecastMethod = 'model' | 'recentAverage' | 'tooShort'

export type SeriesKey = { partNumber: string; site: string }

export type SeriesForecast = SeriesKey & {
  method: ForecastMethod
  // Months of history, from the first month with orders to the last month of all the history.
  months: number
  history: { month: string; ordered: number; shipped: number }[]
  forecast: { month: string; quantity: number }[]
}

export type ErrorScores = { mae: number; rmse: number; mape: number | null; smape: number }

export type DemandForecast = {
  // The last month of history, and the months forecast after it.
  lastMonth: string
  months: string[]
  series: SeriesForecast[]
  // How the two ways did on the last three months, when they could be compared.
  backtest: { model: ErrorScores; recentAverage: ErrorScores; improvement: number; chosen: 'model' | 'recentAverage' } | null
  reason: string
}

type Series = SeriesKey & { first: string; ordered: number[]; shipped: number[] }

function seriesOf(history: MonthlyOrder[], lastMonth: string): Series[] {
  const groups = new Map<string, MonthlyOrder[]>()
  for (const entry of history) {
    const key = `${entry.partNumber}|${entry.site}`
    groups.set(key, [...(groups.get(key) ?? []), entry])
  }
  return [...groups.values()]
    .map((entries) => {
      const first = entries.map((entry) => entry.month).sort()[0]
      const months: string[] = []
      for (let month = first; month <= lastMonth; month = addMonths(month, 1)) months.push(month)
      const at = new Map(entries.map((entry) => [entry.month, entry]))
      return {
        partNumber: entries[0].partNumber,
        site: entries[0].site,
        first,
        ordered: months.map((month) => at.get(month)?.ordered ?? 0),
        shipped: months.map((month) => at.get(month)?.shipped ?? 0),
      }
    })
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber) || a.site.localeCompare(b.site))
}

const mean = (values: number[]) => (values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0)

// What the trees see to predict the month at `index` of a series: its orders and shipments in
// the months before, how they have moved, and the calendar month. A month before the series
// began is −1.
function featuresAt(series: Series, ordered: number[], shipped: number[], index: number): number[] {
  const back = (values: number[], lag: number) => (index - lag >= 0 ? values[index - lag] : -1)
  const window = (size: number) => ordered.slice(Math.max(0, index - size), index)
  const recent = window(3)
  const spread = recent.length > 1 ? Math.sqrt(mean(recent.map((value) => (value - mean(recent)) ** 2))) : -1
  const calendarMonth = Number(addMonths(series.first, index).slice(5, 7))
  return [
    back(ordered, 1),
    back(ordered, 2),
    back(ordered, 3),
    back(ordered, 6),
    back(ordered, 12),
    mean(window(3)),
    mean(window(6)),
    mean(window(12)),
    spread,
    back(shipped, 1),
    calendarMonth,
    index,
  ]
}

function trainOn(series: Series[], untilIndex: (entry: Series) => number): Booster {
  const x: number[][] = []
  const y: number[] = []
  for (const entry of series) {
    // Each month with at least three months before it is a row to learn from.
    for (let index = 3; index <= untilIndex(entry); index += 1) {
      x.push(featuresAt(entry, entry.ordered, entry.shipped, index))
      y.push(entry.ordered[index])
    }
  }
  return trainBooster({ x, y, w: y.map(() => 1) }, null, FORECAST_OPTIONS)
}

export function errorScores(actual: number[], predicted: number[]): ErrorScores {
  const errors = actual.map((value, index) => predicted[index] - value)
  const nonZero = actual.map((value, index) => ({ value, error: errors[index] })).filter((entry) => entry.value !== 0)
  return {
    mae: mean(errors.map(Math.abs)),
    rmse: Math.sqrt(mean(errors.map((error) => error * error))),
    mape: nonZero.length > 0 ? mean(nonZero.map((entry) => Math.abs(entry.error) / entry.value)) : null,
    smape: mean(
      actual.map((value, index) => {
        const total = Math.abs(value) + Math.abs(predicted[index])
        return total === 0 ? 0 : (2 * Math.abs(predicted[index] - value)) / total
      }),
    ),
  }
}

export function forecastDemand(history: MonthlyOrder[], horizon: number): DemandForecast {
  if (history.length === 0) return { lastMonth: '', months: [], series: [], backtest: null, reason: '月ごとの受注の実績がありません' }
  const lastMonth = history.map((entry) => entry.month).sort().at(-1)!
  const months = Array.from({ length: horizon }, (_, index) => addMonths(lastMonth, index + 1))
  const series = seriesOf(history, lastMonth)
  const long = series.filter((entry) => entry.ordered.length >= MODEL_MONTHS)

  // Compare the two ways on the last three months of the series long enough for the trees.
  let backtest: DemandForecast['backtest'] = null
  let reason = `${MODEL_MONTHS}か月以上の実績がないので、直近3か月の平均を使っています`
  if (long.length > 0) {
    const model = trainOn(long, (entry) => entry.ordered.length - 1 - BACKTEST_MONTHS)
    const actual: number[] = []
    const fromModel: number[] = []
    const fromAverage: number[] = []
    for (const entry of long) {
      for (let index = entry.ordered.length - BACKTEST_MONTHS; index < entry.ordered.length; index += 1) {
        actual.push(entry.ordered[index])
        fromModel.push(Math.max(0, predictMargin(model, featuresAt(entry, entry.ordered, entry.shipped, index))))
        fromAverage.push(mean(entry.ordered.slice(index - 3, index)))
      }
    }
    const modelScores = errorScores(actual, fromModel)
    const averageScores = errorScores(actual, fromAverage)
    const improvement = averageScores.mae > 0 ? (averageScores.mae - modelScores.mae) / averageScores.mae : 0
    const chosen = improvement >= MIN_IMPROVEMENT ? 'model' : 'recentAverage'
    backtest = { model: modelScores, recentAverage: averageScores, improvement, chosen }
    reason =
      chosen === 'model'
        ? `学習した予測を使っています（最後の3か月を1か月ずつ当てた誤差が、直近3か月の平均より${Math.round(improvement * 100)}%小さい）`
        : `直近3か月の平均を使っています（学習した予測の誤差が、${Math.round(MIN_IMPROVEMENT * 100)}%以上は小さくならなかった）`
  }
  const useModel = backtest?.chosen === 'model'
  const finalModel = useModel ? trainOn(long, (entry) => entry.ordered.length - 1) : null

  const forecasts: SeriesForecast[] = series.map((entry) => {
    const history = entry.ordered.map((ordered, index) => ({ month: addMonths(entry.first, index), ordered, shipped: entry.shipped[index] }))
    const base = { partNumber: entry.partNumber, site: entry.site, months: entry.ordered.length, history }
    if (entry.ordered.length < 3) {
      const average = mean(entry.ordered)
      return { ...base, method: 'tooShort', forecast: months.map((month) => ({ month, quantity: average })) }
    }
    if (finalModel && entry.ordered.length >= MODEL_MONTHS) {
      const ordered = [...entry.ordered]
      const shipped = [...entry.shipped]
      const forecast = months.map((month) => {
        const quantity = Math.max(0, predictMargin(finalModel, featuresAt(entry, ordered, shipped, ordered.length)))
        ordered.push(quantity)
        shipped.push(quantity)
        return { month, quantity }
      })
      return { ...base, method: 'model', forecast }
    }
    const average = mean(entry.ordered.slice(-3))
    return { ...base, method: 'recentAverage', forecast: months.map((month) => ({ month, quantity: average })) }
  })
  return { lastMonth, months, series: forecasts, backtest, reason }
}

// Checks before trusting a series: months it has, months with no orders, how much orders
// swing (standard deviation over the mean) and the largest jump from one month to the next.
export function seriesChecks(entry: SeriesForecast) {
  const values = entry.history.map((month) => month.ordered)
  const average = mean(values)
  const spread = Math.sqrt(mean(values.map((value) => (value - average) ** 2)))
  const jumps = values.slice(1).map((value, index) => (values[index] > 0 ? Math.abs(value - values[index]) / values[index] : 0))
  const warnings: string[] = []
  if (entry.months < 6) warnings.push('実績が6か月に足りません')
  else if (entry.months < MODEL_MONTHS) warnings.push(`実績が${MODEL_MONTHS}か月に足りないので、学習した予測は使いません`)
  const empty = values.filter((value) => value === 0).length
  if (empty > 0) warnings.push(`受注のない月が${empty}か月あります`)
  const jump = Math.max(0, ...jumps)
  if (jump >= 1) warnings.push(`前の月から${Math.round(jump * 100)}%動いた月があります`)
  return { months: entry.months, empty, variation: average > 0 ? spread / average : null, jump, warnings }
}
