import type { FormEvent } from 'react'
import { useState } from 'react'
import type { WorkoutStore } from '../hooks/useWorkoutStore'
import type { SetEntry, WeightUnit } from '../types'
import { entrySetCount, formatSetLoad, formatTime, plural } from '../utils'
import { EmptyState } from './EmptyState'

type Props = {
  store: WorkoutStore
  onGoLog: () => void
  onGoVoice?: () => void
}

export function TodaySession({ store, onGoLog, onGoVoice }: Props) {
  const sets = store.todaySets
  const unique = new Set(sets.map((s) => s.equipmentId)).size
  const [editing, setEditing] = useState<SetEntry | null>(null)

  const grouped = sets.reduce<Record<string, SetEntry[]>>((acc, s) => {
    const key = s.equipmentId
    ;(acc[key] ??= []).push(s)
    return acc
  }, {})

  const order = Object.keys(grouped)

  return (
    <div className="panel">
      <header className="panel-header">
        <h1>Today</h1>
        {sets.length > 0 ? (
          <p className="muted">
            {plural(
              sets.reduce((n, s) => n + entrySetCount(s), 0),
              'set',
            )}{' '}
            · {plural(unique, 'equipment piece', 'equipment pieces')}
          </p>
        ) : (
          <p className="muted">Your session for today.</p>
        )}
      </header>

      <div className="row-actions wrap" style={{ marginBottom: 12 }}>
        <button type="button" className="btn btn-primary" onClick={onGoVoice ?? onGoLog}>
          🎤 Voice log a set
        </button>
        <button type="button" className="btn btn-ghost" onClick={onGoLog}>
          Manual log
        </button>
      </div>

      {sets.length === 0 ? (
        <EmptyState
          icon="🏋️"
          title="No sets yet today"
          body="Log your first set — pick equipment, enter weight and reps. Everything stays on this device."
          actionLabel="Log a set"
          onAction={onGoLog}
        />
      ) : (
        <div className="stack">
          {order.map((eqId) => {
            const list = grouped[eqId]
            const name = list[0].equipmentName
            return (
              <section key={eqId} className="card">
                <div className="card-title-row">
                  <h2>{name}</h2>
                  <span className="badge">
                    {plural(
                      list.reduce((n, s) => n + entrySetCount(s), 0),
                      'set',
                    )}
                  </span>
                </div>
                <ul className="set-list">
                  {list.map((s, i) => (
                    <li key={s.id} className="set-row">
                      <div className="set-main">
                        <span className="set-index">#{i + 1}</span>
                        <strong>{formatSetLoad(s)}</strong>
                        <span className="muted set-time">{formatTime(s.loggedAt)}</span>
                      </div>
                      {s.notes ? <p className="set-notes">{s.notes}</p> : null}
                      <div className="row-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => setEditing(s)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger-ghost btn-sm"
                          onClick={() => {
                            if (confirm('Delete this set?')) store.deleteSet(s.id)
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      {editing ? (
        <EditSetModal
          entry={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            store.updateSet(editing.id, patch)
            setEditing(null)
          }}
        />
      ) : null}
    </div>
  )
}

function EditSetModal({
  entry,
  onClose,
  onSave,
}: {
  entry: SetEntry
  onClose: () => void
  onSave: (patch: {
    equipmentName: string
    weight: number
    unit: WeightUnit
    reps: number
    setCount: number
    notes: string
  }) => void
}) {
  const [equipmentName, setEquipmentName] = useState(entry.equipmentName)
  const [weight, setWeight] = useState(String(entry.weight))
  const [reps, setReps] = useState(String(entry.reps))
  const [setCount, setSetCount] = useState(String(entry.setCount ?? 1))
  const [unit, setUnit] = useState<WeightUnit>(entry.unit)
  const [notes, setNotes] = useState(entry.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    try {
      onSave({
        equipmentName,
        weight: Number(weight),
        unit,
        reps: Number(reps),
        setCount: Number(setCount),
        notes,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-set-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-set-title">Edit set</h2>
        <form className="form" onSubmit={submit}>
          <label className="field">
            <span>Equipment</span>
            <input
              className="input"
              value={equipmentName}
              onChange={(e) => setEquipmentName(e.target.value)}
              required
            />
          </label>
          <div className="row-2">
            <label className="field">
              <span>Weight</span>
              <div className="input-with-toggle">
                <input
                  className="input"
                  inputMode="decimal"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  required
                />
                <div className="unit-toggle">
                  <button
                    type="button"
                    className={unit === 'lb' ? 'active' : ''}
                    onClick={() => setUnit('lb')}
                  >
                    lb
                  </button>
                  <button
                    type="button"
                    className={unit === 'kg' ? 'active' : ''}
                    onClick={() => setUnit('kg')}
                  >
                    kg
                  </button>
                </div>
              </div>
            </label>
            <label className="field">
              <span>Reps</span>
              <input
                className="input"
                inputMode="numeric"
                value={reps}
                onChange={(e) => setReps(e.target.value)}
                required
              />
            </label>
          </div>
          <label className="field">
            <span>Sets</span>
            <input
              className="input"
              inputMode="numeric"
              value={setCount}
              onChange={(e) => setSetCount(e.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <input
              className="input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
