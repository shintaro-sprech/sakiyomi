import { useMemo, useState } from 'react'

import { changesToApply, type ProposedOption } from './assistant/tools'
import { runPlan } from './engine/plan'
import { useAppState } from './state/store'
import { ChatPanel } from './ui/ChatPanel'
import { DecisionsView } from './ui/DecisionsView'
import { GanttView } from './ui/GanttView'
import { ProgressView } from './ui/ProgressView'
import { SettingsView } from './ui/SettingsView'

type Tab = 'progress' | 'gantt' | 'decisions' | 'settings'

const TABS: { id: Tab; label: string }[] = [
  { id: 'progress', label: '進捗' },
  { id: 'gantt', label: 'ガント' },
  { id: 'decisions', label: '判断の記録' },
  { id: 'settings', label: '設定とデータ' },
]

function App() {
  const app = useAppState()
  const [tab, setTab] = useState<Tab>('progress')
  const [preview, setPreview] = useState<ProposedOption | null>(null)
  const [chatOpen, setChatOpen] = useState(true)
  const { planState, saved } = app

  const plan = useMemo(
    () => runPlan(planState, preview ? changesToApply(preview, planState.adopted).changes : []),
    [planState, preview],
  )

  return (
    <div className={`app${chatOpen ? ' with-chat' : ''}`}>
      <header className="app-header">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <span>サキヨミ</span>
          {saved.dataSource === 'sample' && <span className="tag">サンプルデータ</span>}
        </div>
        <nav className="tabs" aria-label="画面">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'is-active' : undefined}
              aria-current={tab === item.id ? 'page' : undefined}
              onClick={() => setTab(item.id)}
            >
              {item.label}
              {item.id === 'decisions' && saved.decisions.length > 0 && (
                <span className="count">{saved.decisions.length}</span>
              )}
            </button>
          ))}
        </nav>
        <button className={chatOpen ? 'is-active' : undefined} onClick={() => setChatOpen((open) => !open)}>
          {chatOpen ? '相談を閉じる' : 'Claude に相談'}
        </button>
      </header>

      <div className="app-body">
        <main className="app-main">
          {preview && (
            <div className="preview-banner" role="status">
              <span>
                案「{preview.title}」を当てた計画を表示しています。まだ計画には反映していません。
              </span>
              <button onClick={() => setPreview(null)}>元の計画に戻す</button>
            </div>
          )}
          {tab === 'progress' && (
            <ProgressView plan={plan} today={planState.today} warningDays={saved.settings.stagnationWarningDays} />
          )}
          {tab === 'gantt' && <GanttView plan={plan} today={planState.today} highlight={preview} />}
          {tab === 'decisions' && <DecisionsView decisions={saved.decisions} onRemove={app.removeDecision} />}
          {tab === 'settings' && <SettingsView app={app} />}
        </main>

        {chatOpen && (
          <ChatPanel
            planState={planState}
            sampleData={saved.dataSource === 'sample'}
            previewing={preview}
            onPreview={setPreview}
            onAdopt={app.adopt}
          />
        )}
      </div>
    </div>
  )
}

export default App
