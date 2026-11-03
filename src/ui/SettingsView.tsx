import { useState, type ChangeEvent } from 'react'

import type { Settings } from '../engine/types'
import type { AppState } from '../state/store'

const WEEKDAYS = [
  { day: 1, label: '月' },
  { day: 2, label: '火' },
  { day: 3, label: '水' },
  { day: 4, label: '木' },
  { day: 5, label: '金' },
  { day: 6, label: '土' },
  { day: 0, label: '日' },
]

export function SettingsView({ app }: { app: AppState }) {
  const { saved } = app
  const { settings, data } = saved
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importMessage, setImportMessage] = useState<string | null>(null)

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => app.updateSettings({ ...settings, [key]: value })

  const toggleWeekday = (day: number) =>
    set(
      'workWeekdays',
      settings.workWeekdays.includes(day)
        ? settings.workWeekdays.filter((item) => item !== day)
        : [...settings.workWeekdays, day].sort(),
    )

  const toggleStopped = (id: string) =>
    set(
      'stoppedEquipment',
      settings.stoppedEquipment.includes(id)
        ? settings.stoppedEquipment.filter((item) => item !== id)
        : [...settings.stoppedEquipment, id],
    )

  const setSetup = (id: string, minutes: number) =>
    app.updateData({
      ...data,
      equipment: data.equipment.map((item) => (item.id === id ? { ...item, setupMinutes: minutes } : item)),
    })

  async function onImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const { readWorkbook } = await import('../data/excel')
    const { data: imported, errors } = await readWorkbook(file)
    setImportErrors(errors)
    if (imported) {
      app.replaceData(imported, 'excel')
      setImportMessage(`「${file.name}」を読み込みました。注残${imported.orders.length}件、Lot${imported.lots.length}件です。`)
    } else {
      setImportMessage(null)
    }
  }

  async function exportWorkbook() {
    const { downloadWorkbook } = await import('../data/excel')
    downloadWorkbook(data, 'sakiyomi-data.xlsx')
  }

  function onReset() {
    if (window.confirm('サンプルデータに戻します。読み込んだデータと判断の記録は消えます。よろしいですか？')) {
      app.resetToSample()
      setImportErrors([])
      setImportMessage(null)
    }
  }

  return (
    <section className="settings">
      <h2>稼働と計画</h2>
      <div className="form-grid">
        <label>
          始業
          <input type="time" value={settings.workStart} onChange={(event) => set('workStart', event.target.value)} />
        </label>
        <label>
          終業
          <input type="time" value={settings.workEnd} onChange={(event) => set('workEnd', event.target.value)} />
        </label>
        <fieldset>
          <legend>稼働する曜日</legend>
          <div className="checkbox-row">
            {WEEKDAYS.map(({ day, label }) => (
              <label key={day} className="checkbox">
                <input type="checkbox" checked={settings.workWeekdays.includes(day)} onChange={() => toggleWeekday(day)} />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <label>
          ガントに出す期間（日）
          <input
            type="number"
            min={3}
            max={60}
            value={settings.horizonDays}
            onChange={(event) => set('horizonDays', clamp(Number(event.target.value), 3, 60))}
          />
        </label>
        <label>
          工程間の待ち時間（分）
          <input
            type="number"
            min={0}
            step={10}
            value={settings.transferMinutes}
            onChange={(event) => set('transferMinutes', clamp(Number(event.target.value), 0, 24 * 60))}
          />
        </label>
        <label>
          止まっているLotを警告する日数
          <input
            type="number"
            min={1}
            value={settings.stagnationWarningDays}
            onChange={(event) => set('stagnationWarningDays', clamp(Number(event.target.value), 1, 60))}
          />
        </label>
        <label className="span-2">
          優先のつけ方
          <span className="slider-row">
            <span>段取りを減らす</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={settings.dueWeight}
              onChange={(event) => set('dueWeight', Number(event.target.value))}
            />
            <span>納期を守る</span>
          </span>
          <span className="hint">{describeWeight(settings.dueWeight)}</span>
        </label>
      </div>

      <h2>設備</h2>
      <table className="settings-table">
        <thead>
          <tr>
            <th>設備</th>
            <th>担当工程</th>
            <th>型番が替わるときの段取り（分）</th>
            <th>止める</th>
          </tr>
        </thead>
        <tbody>
          {data.equipment.map((equipment) => (
            <tr key={equipment.id}>
              <td>
                {equipment.name}
                <span className="hint">（{equipment.id}）</span>
              </td>
              <td>{equipment.process}</td>
              <td>
                <input
                  type="number"
                  min={0}
                  step={5}
                  value={equipment.setupMinutes}
                  onChange={(event) => setSetup(equipment.id, clamp(Number(event.target.value), 0, 24 * 60))}
                />
              </td>
              <td>
                <input
                  type="checkbox"
                  aria-label={`${equipment.name}を止める`}
                  checked={settings.stoppedEquipment.includes(equipment.id)}
                  onChange={() => toggleStopped(equipment.id)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>データ</h2>
      <p className="hint">
        工程表・設備・注残・Lot の4つのシートを持つ Excel を読み込めます。まず今のデータを書き出して、その形に合わせて入力するのが早いです。
      </p>
      <div className="button-row">
        <button onClick={() => void exportWorkbook()}>今のデータを Excel に書き出す</button>
        <label className="button file-button">
          Excel を読み込む
          <input type="file" accept=".xlsx,.xls" onChange={(event) => void onImport(event)} />
        </label>
        <button className="ghost" onClick={onReset}>
          サンプルに戻す
        </button>
      </div>
      {importMessage && <p className="notice">{importMessage}</p>}
      {importErrors.length > 0 && (
        <div className="chat-error">
          <p>読み込めませんでした。次の箇所を直してください。</p>
          <ul>
            {importErrors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(Math.round(value), min), max)
}

// The scheduler scores dueWeight × slack days + (1 − dueWeight) × setup hours,
// so one day of slack weighs as much as dueWeight / (1 − dueWeight) hours of setup.
function describeWeight(dueWeight: number): string {
  if (dueWeight >= 1) return '納期の余裕だけを見て、次に流すLotを選びます'
  if (dueWeight <= 0) return '段取りの少なさだけを見て、次に流すLotを選びます'
  const hours = Math.round((dueWeight / (1 - dueWeight)) * 10) / 10
  return `納期の余裕1日と、段取り${hours}時間を同じ重さとして、次に流すLotを選びます`
}
