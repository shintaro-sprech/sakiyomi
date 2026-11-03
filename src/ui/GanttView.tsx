import { useMemo, useState } from 'react'

import type { ProposedOption } from '../assistant/tools'
import { addDays, daysBetween, MINUTES_PER_DAY, parseClock, weekday } from '../engine/dates'
import type { Plan } from '../engine/plan'
import type { ScheduledOperation } from '../engine/scheduler'
import type { IsoDate } from '../engine/types'
import { shortDate, shortDateTime } from './format'

type Props = {
  plan: Plan
  today: IsoDate
  highlight: ProposedOption | null
}

const ZOOMS = [
  { label: '小', dayWidth: 90 },
  { label: '中', dayWidth: 150 },
  { label: '大', dayWidth: 260 },
]
const WEEKDAY_NAMES = ['日', '月', '火', '水', '木', '金', '土']

export function GanttView({ plan, today, highlight }: Props) {
  const [zoom, setZoom] = useState(1)
  const [focusOrder, setFocusOrder] = useState('')
  const [selected, setSelected] = useState<ScheduledOperation | null>(null)
  const { scenario, result } = plan
  const { settings, data } = scenario
  const dayWidth = ZOOMS[zoom].dayWidth
  const days = settings.horizonDays

  // Each day shows working hours only, widened to fit any overtime.
  const displayStart = parseClock(settings.workStart)
  const displayEnd = Math.max(
    parseClock(settings.workEnd) + Math.max(0, ...scenario.overtime.map((entry) => entry.minutesPerDay)),
    displayStart + 60,
  )
  const x = (minute: number) => {
    const day = Math.floor(minute / MINUTES_PER_DAY)
    const within = Math.min(Math.max(minute - day * MINUTES_PER_DAY - displayStart, 0), displayEnd - displayStart)
    return day * dayWidth + (within / (displayEnd - displayStart)) * dayWidth
  }

  const forecasts = useMemo(() => new Map(result.orders.map((forecast) => [forecast.orderId, forecast])), [result])
  const dueByOrder = useMemo(() => new Map(data.orders.map((order) => [order.id, order.due])), [data])
  const highlighted = new Set([
    ...(highlight?.comparison.shifted.map((shift) => shift.orderId) ?? []),
    ...(focusOrder ? [focusOrder] : []),
  ])
  const equipmentNames = new Map(data.equipment.map((equipment) => [equipment.id, equipment.name]))
  const dates = Array.from({ length: days }, (_, index) => addDays(today, index))

  const tone = (operation: ScheduledOperation) => {
    const forecast = forecasts.get(operation.orderId)
    if (forecast?.late) return 'late'
    const due = dueByOrder.get(operation.orderId)
    if (due && forecast?.finishDate && daysBetween(forecast.finishDate, due) <= 1) return 'tight'
    return 'ok'
  }

  return (
    <section className="gantt">
      <div className="toolbar">
        <div className="segmented" role="group" aria-label="表示の幅">
          {ZOOMS.map((item, index) => (
            <button key={item.label} aria-pressed={zoom === index} onClick={() => setZoom(index)}>
              {item.label}
            </button>
          ))}
        </div>
        <label className="inline-field">
          注番を強調
          <select value={focusOrder} onChange={(event) => setFocusOrder(event.target.value)}>
            <option value="">しない</option>
            {data.orders.map((order) => (
              <option key={order.id} value={order.id}>
                {order.id}（{order.partNumber}）
              </option>
            ))}
          </select>
        </label>
        <div className="legend">
          <span className="legend-item bar-ok">余裕あり</span>
          <span className="legend-item bar-tight">納期まで1日以内</span>
          <span className="legend-item bar-late">納期に遅れる</span>
          <span className="legend-item bar-setup">段取り</span>
        </div>
      </div>

      <div className="gantt-scroll">
        <div className="gantt-grid" style={{ width: 180 + days * dayWidth }}>
          <div className="gantt-row gantt-head">
            <div className="gantt-label">設備</div>
            <div className="gantt-track" style={{ width: days * dayWidth }}>
              {dates.map((date, index) => (
                <div
                  key={date}
                  className={`gantt-day${isOff(settings.workWeekdays, date) ? ' is-off' : ''}`}
                  style={{ left: index * dayWidth, width: dayWidth }}
                >
                  {shortDate(date)}（{WEEKDAY_NAMES[weekday(date)]}）
                </div>
              ))}
            </div>
          </div>

          {data.equipment.map((equipment) => {
            const stopped = settings.stoppedEquipment.includes(equipment.id)
            const operations = result.operations.filter((operation) => operation.equipmentId === equipment.id)
            const down = scenario.downtime.filter((entry) => entry.equipmentId === equipment.id)
            const extra = scenario.holidayWork.filter((entry) => entry.equipmentId === equipment.id)
            return (
              <div key={equipment.id} className={`gantt-row${stopped ? ' is-stopped' : ''}`}>
                <div className="gantt-label">
                  <strong>{equipment.name}</strong>
                  <span>{stopped ? '停止中' : equipment.process}</span>
                </div>
                <div className="gantt-track" style={{ width: days * dayWidth }}>
                  {dates.map((date, index) => {
                    const off = isOff(settings.workWeekdays, date) && !extra.some((entry) => entry.date === date)
                    const isDown = down.some((entry) => date >= entry.from && date <= entry.to)
                    return off || isDown ? (
                      <div
                        key={date}
                        className={`gantt-shade${isDown ? ' is-down' : ''}`}
                        style={{ left: index * dayWidth, width: dayWidth }}
                      />
                    ) : null
                  })}
                  {operations.map((operation) => {
                    const left = x(operation.start)
                    const width = Math.max(x(operation.end) - left, 3)
                    const setupWidth = operation.setupMinutes > 0 ? x(operation.setupEnd) - left : 0
                    if (left > days * dayWidth) return null
                    return (
                      <button
                        key={`${operation.lotId}-${operation.stepIndex}`}
                        className={[
                          'gantt-bar',
                          `bar-${tone(operation)}`,
                          operation.planned ? 'is-planned' : '',
                          highlighted.size > 0 && !highlighted.has(operation.orderId) ? 'is-dim' : '',
                          selected === operation ? 'is-selected' : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        style={{ left, width }}
                        title={`${operation.lotId}（注番${operation.orderId}）${operation.stepName} ${shortDateTime(operation.startAt)}〜${shortDateTime(operation.endAt)}`}
                        onClick={() => setSelected(operation)}
                      >
                        {setupWidth > 0 && <span className="bar-setup-part" style={{ width: setupWidth }} />}
                        <span className="bar-text">
                          {operation.orderId} {operation.partNumber}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {result.unscheduled.length > 0 && (
        <p className="chat-error">
          計画に入れられなかった工程があります：
          {result.unscheduled.map((entry) => `${entry.lotId} ${entry.stepName}（${entry.reason}）`).join('、')}
        </p>
      )}

      {selected && (
        <section className="lot-panel">
          <header>
            <h3>
              {selected.lotId}・{selected.stepName}
            </h3>
            <button className="ghost" onClick={() => setSelected(null)} aria-label="閉じる">
              ×
            </button>
          </header>
          <dl className="detail-grid">
            <dt>注番</dt>
            <dd>
              {selected.orderId}（{selected.partNumber}）
            </dd>
            <dt>設備</dt>
            <dd>{equipmentNames.get(selected.equipmentId)}</dd>
            <dt>数量</dt>
            <dd>
              {selected.quantity}個{selected.planned ? '（未投入）' : ''}
            </dd>
            <dt>加工</dt>
            <dd>
              {shortDateTime(selected.startAt)} 〜 {shortDateTime(selected.endAt)}
            </dd>
            <dt>段取り</dt>
            <dd>{selected.setupMinutes > 0 ? `${selected.setupMinutes}分` : 'なし'}</dd>
            <dt>納期 / 完成見込み</dt>
            <dd>
              {shortDate(dueByOrder.get(selected.orderId))} / {shortDateTime(forecasts.get(selected.orderId)?.finishAt)}
            </dd>
          </dl>
        </section>
      )}
    </section>
  )
}

function isOff(workWeekdays: number[], date: IsoDate): boolean {
  return !workWeekdays.includes(weekday(date))
}
