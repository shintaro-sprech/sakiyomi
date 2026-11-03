import { useState } from 'react'

import type { ProposedOption } from '../assistant/tools'
import type { ScheduleComparison } from '../engine/compare'
import { shortDate } from './format'

type Props = {
  option: ProposedOption
  // closed: another option of the same proposal was adopted.
  state: 'open' | 'adopted' | 'closed'
  previewing: boolean
  onPreview: () => void
  onAdopt: (note: string) => void
}

export function OptionCard({ option, state, previewing, onPreview, onAdopt }: Props) {
  const [noting, setNoting] = useState(false)
  const [note, setNote] = useState('')

  return (
    <article className={`option-card${previewing ? ' is-previewing' : ''}${state === 'closed' ? ' is-closed' : ''}`}>
      <h4>{option.title}</h4>
      {option.labels.length > 0 ? (
        <ul className="option-changes">
          {option.labels.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      ) : (
        <p className="hint">計画は変えない</p>
      )}
      <EffectSummary comparison={option.comparison} />
      <dl className="option-notes">
        <dt>効く理由</dt>
        <dd>{option.reason}</dd>
        <dt>代わりに起きること</dt>
        <dd>{option.tradeoff}</dd>
      </dl>
      {state === 'adopted' ? (
        <p className="option-adopted">計画に反映しました</p>
      ) : state === 'closed' ? (
        <p className="hint">別の案を反映しました</p>
      ) : noting ? (
        <div className="option-confirm">
          <label>
            この案を選んだ理由やコツ（任意）
            <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} />
          </label>
          <div className="button-row">
            <button className="primary" onClick={() => onAdopt(note.trim())}>
              反映する
            </button>
            <button onClick={() => setNoting(false)}>やめる</button>
          </div>
        </div>
      ) : (
        <div className="button-row">
          <button onClick={onPreview}>{previewing ? '表示中' : '案を見る'}</button>
          <button className="primary" onClick={() => setNoting(true)}>
            計画に反映する
          </button>
        </div>
      )}
    </article>
  )
}

export function EffectSummary({ comparison }: { comparison: ScheduleComparison }) {
  return (
    <>
      <p className="option-effect">
        遅れる注番 <strong>{comparison.lateBefore}件</strong> → <strong>{comparison.lateAfter}件</strong>
        {comparison.noLongerLate.length > 0 && (
          <span className="tag tag-ok">間に合う: {comparison.noLongerLate.join('・')}</span>
        )}
        {comparison.newlyLate.length > 0 && (
          <span className="tag tag-danger">新たに遅れる: {comparison.newlyLate.join('・')}</span>
        )}
      </p>
      {comparison.shifted.length > 0 && (
        <ul className="option-shifts">
          {comparison.shifted.map((shift) => (
            <li key={shift.orderId} className={shift.lateAfter ? 'late' : undefined}>
              注番{shift.orderId}：{shortDate(shift.before)} → {shortDate(shift.after)}（納期 {shortDate(shift.due)}）
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
