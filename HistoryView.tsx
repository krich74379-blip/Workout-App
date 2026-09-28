import { useState } from 'react'
import type { WorkoutStore } from '../hooks/useWorkoutStore'
import type { DaySummary, SetEntry } from '../types'
import { entrySetCount, formatDisplayDate, formatSetLoad, formatTime, plural } from '../utils'
import { EmptyState } from './EmptyState'

type Props = {
  store: WorkoutStore
}

export function HistoryView({ store }: Props) {
  const days = store.historyByDay
  const [selected, setSelected] = useState<string | null>(null)
  const day = days.find((d) => d.date === selected) ?? null

  if (day) {
    return <DayDetail day={day} onBack={() => setSelected(null)} />
  }

  return (
    <div className="panel">
      <header className="panel-header">
        <h1>History</h1>
        <p className="muted">Browse past days and open a session.</p>
      </header>

      {days.length === 0 ? (
        <EmptyState
          icon="📅"
          title="No history yet"
          body="After you log sets, each day shows up here with totals for sets and equipment."
        />
      ) : (
        <ul className="history-list">
          {days.map((d) => (
            <li key={d.date}>
              <button
                type="button"
                className="history-row"
                onClick={() => setSelected(d.date)}
              >
                <div>
                  <strong>{formatDisplayDate(d.date)}</strong>
                  <span className="muted block">{d.date}</span>
                </div>
                <div className="history-meta">
                  <span>{plural(d.totalSets, 'set')}</span>
                  <span>
                    {plural(d.uniqueEquipment, 'equipment piece', 'equipment')}
                  </span>
                  <span className="chevron" aria-hidden>
                    ›
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function DayDetail({ day, onBack }: { day: DaySummary; onBack: () => void }) {
  const grouped = day.sets.reduce<Record<string, SetEntry[]>>((acc, s) => {
    ;(acc[s.equipmentId] ??= []).push(s)
    return acc
  }, {})

  return (
    <div className="panel">
      <header className="panel-header">
        <button type="button" className="btn btn-ghost btn-sm back-btn" onClick={onBack}>
          ← Back
        </button>
        <h1>{formatDisplayDate(day.date)}</h1>
        <p className="muted">
          {plural(day.totalSets, 'set')} ·{' '}
          {plural(day.uniqueEquipment, 'equipment piece', 'equipment pieces')}
        </p>
      </header>

      <div className="stack">
        {Object.entries(grouped).map(([eqId, list]) => (
          <section key={eqId} className="card">
            <div className="card-title-row">
              <h2>{list[0].equipmentName}</h2>
              <span className="badge">
                {plural(
                  list.reduce((n, s) => n + entrySetCount(s), 0),
                  'set',
                )}
              </span>
            </div>
            <ul className="set-list">
              {list.map((s, i) => (
                <li key={s.id} className="set-row readonly">
                  <div className="set-main">
                    <span className="set-index">#{i + 1}</span>
                    <strong>{formatSetLoad(s)}</strong>
                    <span className="muted set-time">{formatTime(s.loggedAt)}</span>
                  </div>
                  {s.notes ? <p className="set-notes">{s.notes}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
