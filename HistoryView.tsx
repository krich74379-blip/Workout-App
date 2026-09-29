import { useMemo, useState } from 'react'
import type { WorkoutStore } from '../hooks/useWorkoutStore'
import type { DaySummary, SetEntry, WeightUnit } from '../types'
import { entrySetCount, formatDisplayDate, formatSetLoad, formatTime, plural } from '../utils'
import { computeAchievements, formatProgress } from '../lib/achievements'
import { EmptyState } from './EmptyState'

type Props = {
  store: WorkoutStore
}

type PersonalRecord = {
  id: string
  name: string
  weight: number
  unit: WeightUnit
  reps: number
  date: string
}

const toLb = (weight: number, unit: WeightUnit) =>
  unit === 'kg' ? weight * 2.20462 : weight

export function HistoryView({ store }: Props) {
  const days = store.historyByDay
  const [selected, setSelected] = useState<string | null>(null)
  const day = days.find((d) => d.date === selected) ?? null

  /** Heaviest set per exercise across all history. */
  const records = useMemo((): PersonalRecord[] => {
    const best = new Map<string, PersonalRecord>()
    for (const d of days) {
      for (const s of d.sets) {
        if (s.kind === 'cardio' || !(s.weight > 0)) continue
        const cur = best.get(s.equipmentId)
        const w = toLb(s.weight, s.unit)
        const cw = cur ? toLb(cur.weight, cur.unit) : -1
        if (!cur || w > cw || (w === cw && s.reps > cur.reps)) {
          best.set(s.equipmentId, {
            id: s.equipmentId,
            name: s.equipmentName,
            weight: s.weight,
            unit: s.unit,
            reps: s.reps,
            date: d.date,
          })
        }
      }
    }
    return [...best.values()].sort(
      (a, b) => toLb(b.weight, b.unit) - toLb(a.weight, a.unit),
    )
  }, [days])

  /** Achievements + XP level, computed from all logged sets. */
  const ach = useMemo(
    () => computeAchievements(store.data.sets),
    [store.data.sets],
  )

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
        <>
          {records.length > 0 ? (
            <section className="card records-card" aria-label="Personal records">
              <h2>🏆 Personal records</h2>
              <p className="muted">Heaviest set per exercise, all time.</p>
              <ul className="records-list">
                {records.map((r) => (
                  <li key={r.id}>
                    <strong>{r.name}</strong>
                    <span className="muted">
                      {r.weight} {r.unit} × {r.reps} ·{' '}
                      {formatDisplayDate(r.date)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="card achievements-card" aria-label="Achievements">
            <h2>🎖️ Achievements</h2>
            <div className="level-banner">
              <span className="level-icon" aria-hidden>
                {ach.level.icon}
              </span>
              <div className="level-info">
                <strong>
                  Level {ach.level.level} · {ach.level.name}
                </strong>
                <div
                  className="progress-track"
                  role="progressbar"
                  aria-valuenow={ach.level.xp - ach.level.xpForCurrent}
                  aria-valuemax={ach.level.xpForNext - ach.level.xpForCurrent}
                  aria-label={`Progress to level ${ach.level.level + 1}`}
                >
                  <div
                    className="progress-fill"
                    style={{
                      width: `${Math.min(
                        100,
                        ((ach.level.xp - ach.level.xpForCurrent) /
                          Math.max(
                            1,
                            ach.level.xpForNext - ach.level.xpForCurrent,
                          )) *
                          100,
                      )}%`,
                    }}
                  />
                </div>
                <span className="muted level-xp">
                  {ach.level.xp.toLocaleString()} XP ·{' '}
                  {(
                    ach.level.xpForNext - ach.level.xp
                  ).toLocaleString()}{' '}
                  to Level {ach.level.level + 1}
                </span>
              </div>
            </div>
            <p className="muted">
              {ach.unlockedCount} of {ach.achievements.length} unlocked · XP
              from every set: 10 per set, plus volume and cardio bonuses.
            </p>
            <ul className="ach-grid">
              {ach.achievements.map((a) => (
                <li
                  key={a.id}
                  className={`ach-badge${a.unlocked ? ' ach-unlocked' : ''}`}
                >
                  <span className="ach-icon" aria-hidden>
                    {a.icon}
                  </span>
                  <strong className="ach-name">{a.name}</strong>
                  <span className="muted ach-desc">{a.desc}</span>
                  {a.unlocked ? (
                    <span className="ach-earned">
                      ✓ {a.earnedDate ? formatDisplayDate(a.earnedDate) : ''}
                    </span>
                  ) : (
                    <>
                      <span className="muted ach-progress">
                        {formatProgress(a)}
                      </span>
                      <div className="progress-track ach-track">
                        <div
                          className="progress-fill"
                          style={{
                            width: `${Math.min(
                              100,
                              (a.progress / a.goal) * 100,
                            )}%`,
                          }}
                        />
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
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
        </>
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
