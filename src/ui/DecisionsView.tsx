import type { Decision } from '../state/store'
import { shortDateTime } from './format'

type Props = {
  decisions: Decision[]
  onRemove: (id: string) => void
}

export function DecisionsView({ decisions, onRemove }: Props) {
  if (decisions.length === 0) {
    return (
      <section className="decisions">
        <h2>判断の記録</h2>
        <p className="empty">
          まだ記録はありません。Claude に相談して案を計画に反映すると、何をなぜ選んだのかがここに残ります。
        </p>
      </section>
    )
  }

  return (
    <section className="decisions">
      <h2>判断の記録</h2>
      <p className="hint">計画に反映した変更と、その理由です。取り消すと、その変更を外した計画に戻ります。</p>
      <ol className="decision-list">
        {[...decisions].reverse().map((decision) => (
          <li key={decision.id} className="decision">
            <header>
              <h3>{decision.title}</h3>
              <time dateTime={decision.at}>{shortDateTime(toLocalDateTime(decision.at))}</time>
            </header>
            <ul className="option-changes">
              {decision.labels.map((label) => (
                <li key={label}>{label}</li>
              ))}
            </ul>
            <dl className="option-notes">
              <dt>効く理由</dt>
              <dd>{decision.reason}</dd>
              <dt>代わりに起きること</dt>
              <dd>{decision.tradeoff}</dd>
              {decision.note && (
                <>
                  <dt>担当者のメモ</dt>
                  <dd>{decision.note}</dd>
                </>
              )}
            </dl>
            <button className="ghost" onClick={() => onRemove(decision.id)}>
              この変更を取り消す
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

function toLocalDateTime(iso: string): string {
  const date = new Date(iso)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
