import { useCallback, useEffect, useState } from 'react'
import { EquipmentLibrary } from './components/EquipmentLibrary'
import { HistoryView } from './components/HistoryView'
import { LogSetForm } from './components/LogSetForm'
import { TodaySession } from './components/TodaySession'
import { useWorkoutStore } from './hooks/useWorkoutStore'
import {
  clearDeepLinkParams,
  readDeepLinkParams,
} from './lib/deepLinkLog'
import type { TabId } from './types'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: '◉' },
  { id: 'log', label: 'Log', icon: '+' },
  { id: 'equipment', label: 'Gear', icon: '☰' },
  { id: 'history', label: 'History', icon: '◷' },
]

export default function App() {
  const store = useWorkoutStore()
  const [tab, setTab] = useState<TabId>('today')
  const [prefillEquipmentId, setPrefillEquipmentId] = useState<string | null>(
    null,
  )
  const [focusVoice, setFocusVoice] = useState(false)
  const [deepLinkUtterance, setDeepLinkUtterance] = useState<string | null>(
    null,
  )
  const [deepLinkAutolog, setDeepLinkAutolog] = useState(true)

  const consumeDeepLinkFromLocation = useCallback(() => {
    const payload = readDeepLinkParams()
    if (!payload) return
    // Clear URL first so refresh / back doesn't re-trigger
    clearDeepLinkParams()
    setDeepLinkAutolog(payload.autolog)
    setDeepLinkUtterance(payload.utterance)
    setFocusVoice(true)
    setTab('log')
  }, [])

  useEffect(() => {
    consumeDeepLinkFromLocation()

    const onPop = () => consumeDeepLinkFromLocation()
    const onFocus = () => consumeDeepLinkFromLocation()
    const onVis = () => {
      if (document.visibilityState === 'visible') consumeDeepLinkFromLocation()
    }

    window.addEventListener('popstate', onPop)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [consumeDeepLinkFromLocation])

  const isFirstRun =
    store.data.sets.length === 0 && store.data.equipment.length === 0

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          <div>
            <strong>Workout Log</strong>
            <span className="muted brand-sub">Local · private · gym-ready</span>
          </div>
        </div>
      </header>

      <main className="main">
        {isFirstRun && tab === 'today' ? (
          <div className="welcome card">
            <h1>Ready when you are</h1>
            <p>
              Track equipment, weight, and reps. Multiple sets per piece, history by
              day, and a library that remembers what you use — all saved in this
              browser.
            </p>
            <button
              type="button"
              className="btn btn-primary btn-block"
              onClick={() => setTab('log')}
            >
              Log your first set
            </button>
          </div>
        ) : null}

        {tab === 'today' ? (
          <TodaySession
            store={store}
            onGoLog={() => {
              setFocusVoice(false)
              setTab('log')
            }}
            onGoVoice={() => {
              setFocusVoice(true)
              setTab('log')
            }}
          />
        ) : null}
        {tab === 'log' ? (
          <LogSetForm
            store={store}
            prefillEquipmentId={prefillEquipmentId}
            focusVoice={focusVoice}
            deepLinkUtterance={deepLinkUtterance}
            deepLinkAutolog={deepLinkAutolog}
            onDeepLinkConsumed={() => setDeepLinkUtterance(null)}
            onLogged={() => {
              setPrefillEquipmentId(null)
              setFocusVoice(false)
            }}
          />
        ) : null}
        {tab === 'equipment' ? (
          <EquipmentLibrary
            store={store}
            onLogEquipment={(id) => {
              setPrefillEquipmentId(id)
              setTab('log')
            }}
          />
        ) : null}
        {tab === 'history' ? <HistoryView store={store} /> : null}
      </main>

      <nav className="bottom-nav" aria-label="Primary">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              if (t.id !== 'log') setFocusVoice(false)
              setTab(t.id)
            }}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className="nav-icon" aria-hidden>
              {t.icon}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
