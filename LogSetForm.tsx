import type { FormEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import type { WorkoutStore } from '../hooks/useWorkoutStore'
import { VoiceLogPanel } from './VoiceLogPanel'
import type { WeightUnit } from '../types'
import { entryKind, isCardioEquipmentName } from '../utils'

type Props = {
  store: WorkoutStore
  onLogged?: () => void
  prefillEquipmentId?: string | null
  focusVoice?: boolean
  deepLinkUtterance?: string | null
  deepLinkAutolog?: boolean
  onDeepLinkConsumed?: () => void
}

export function LogSetForm({
  store,
  onLogged,
  prefillEquipmentId,
  focusVoice = false,
  deepLinkUtterance = null,
  deepLinkAutolog = true,
  onDeepLinkConsumed,
}: Props) {
  const [equipmentName, setEquipmentName] = useState('')
  const [weight, setWeight] = useState('')
  const [reps, setReps] = useState('')
  const [setCount, setSetCount] = useState('1')
  const [miles, setMiles] = useState('')
  const [flights, setFlights] = useState('')
  /** When true, the miles/flights field stores flights. */
  const [distanceAsFlights, setDistanceAsFlights] = useState(false)
  const [calories, setCalories] = useState('')
  const [minutes, setMinutes] = useState('')
  const [notes, setNotes] = useState('')
  const [unit, setUnit] = useState<WeightUnit>(store.preferredUnit)
  const [error, setError] = useState<string | null>(null)
  const [okFlash, setOkFlash] = useState(false)
  const [showSuggestions, setShowSuggestions] = useState(false)

  useEffect(() => {
    setUnit(store.preferredUnit)
  }, [store.preferredUnit])

  useEffect(() => {
    if (!prefillEquipmentId) return
    const eq = store.equipmentSorted.find((e) => e.id === prefillEquipmentId)
    if (!eq) return
    setEquipmentName(eq.name)
    const last = store.lastSetForEquipment(eq.id)
    if (last) {
      if (entryKind(last) === 'cardio') {
        if (last.flights != null && last.flights > 0) {
          setFlights(String(last.flights))
          setMiles('')
          setDistanceAsFlights(true)
        } else {
          setMiles(last.miles != null ? String(last.miles) : '')
          setFlights('')
          setDistanceAsFlights(false)
        }
        setCalories(last.calories != null ? String(last.calories) : '')
        setMinutes(last.minutes != null ? String(last.minutes) : '')
        setWeight('')
        setReps('')
        setSetCount('1')
      } else {
        setWeight(String(last.weight))
        setReps(String(last.reps))
        setSetCount(String(last.setCount ?? 1))
        setMiles('')
        setFlights('')
        setDistanceAsFlights(false)
        setCalories('')
        setMinutes('')
      }
      setUnit(last.unit)
      setNotes(last.notes ?? '')
    }
  }, [prefillEquipmentId, store])

  const suggestions = useMemo(() => {
    const q = equipmentName.trim().toLowerCase()
    if (!q) return store.equipmentSorted.slice(0, 8)
    return store.equipmentSorted
      .filter((e) => e.name.toLowerCase().includes(q))
      .slice(0, 8)
  }, [equipmentName, store.equipmentSorted])

  const selectedEquipment = store.equipmentSorted.find(
    (e) => e.name.toLowerCase() === equipmentName.trim().toLowerCase(),
  )
  const progress = selectedEquipment
    ? store.progressForEquipment(selectedEquipment.id)
    : null
  const last = selectedEquipment
    ? store.lastSetForEquipment(selectedEquipment.id)
    : null

  const cardioMode =
    isCardioEquipmentName(equipmentName) ||
    (last != null && entryKind(last) === 'cardio')

  useEffect(() => {
    const n = equipmentName.trim().toLowerCase()
    if (/stair|stepmaster|step mill|stepmill/.test(n)) {
      setDistanceAsFlights(true)
    }
  }, [equipmentName])

  function applyRepeat() {
    if (!last) return
    if (entryKind(last) === 'cardio') {
      if (last.flights != null && last.flights > 0) {
        setFlights(String(last.flights))
        setMiles('')
        setDistanceAsFlights(true)
      } else {
        setMiles(last.miles != null ? String(last.miles) : '')
        setFlights('')
        setDistanceAsFlights(false)
      }
      setCalories(last.calories != null ? String(last.calories) : '')
      setMinutes(last.minutes != null ? String(last.minutes) : '')
      setWeight('')
      setReps('')
      setSetCount('1')
    } else {
      setWeight(String(last.weight))
      setReps(String(last.reps))
      setSetCount(String(last.setCount ?? 1))
      setMiles('')
      setFlights('')
      setDistanceAsFlights(false)
      setCalories('')
      setMinutes('')
    }
    setUnit(last.unit)
    setNotes(last.notes ?? '')
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (cardioMode) {
        store.logSet({
          equipmentName,
          kind: 'cardio',
          miles:
            !distanceAsFlights && miles !== '' ? Number(miles) : undefined,
          flights:
            distanceAsFlights && flights !== ''
              ? Math.round(Number(flights))
              : undefined,
          calories: calories === '' ? undefined : Math.round(Number(calories)),
          minutes: minutes === '' ? undefined : Number(minutes),
          unit,
          notes,
        })
        setMiles('')
        setFlights('')
        setDistanceAsFlights(false)
        setCalories('')
        setMinutes('')
      } else {
        const w = Number(weight)
        const r = Number(reps)
        const sc = Number(setCount)
        store.logSet({
          equipmentName,
          weight: w,
          unit,
          reps: r,
          setCount: sc,
          notes,
        })
        store.setPreferredUnit(unit)
        setReps('')
        setSetCount('1')
      }
      setOkFlash(true)
      setTimeout(() => setOkFlash(false), 1400)
      setNotes('')
      onLogged?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log set')
    }
  }

  return (
    <div className="panel">
      <header className="panel-header">
        <h1>Log a set</h1>
        <p className="muted">Strength: weight × reps × sets. Cardio: miles/flights, calories, minutes.</p>
      </header>

      <VoiceLogPanel
        store={store}
        emphasize={focusVoice}
        onLogged={onLogged}
        deepLinkUtterance={deepLinkUtterance}
        deepLinkAutolog={deepLinkAutolog}
        onDeepLinkConsumed={onDeepLinkConsumed}
      />


      <form className="form" onSubmit={onSubmit} autoComplete="off">
        <label className="field">
          <span>Equipment</span>
          <input
            className="input"
            value={equipmentName}
            onChange={(e) => {
              setEquipmentName(e.target.value)
              setShowSuggestions(true)
            }}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            placeholder="e.g. Barbell squat"
            required
            enterKeyHint="next"
          />
        </label>

        {showSuggestions && suggestions.length > 0 ? (
          <div className="chip-row" role="listbox" aria-label="Equipment suggestions">
            {suggestions.map((eq) => (
              <button
                key={eq.id}
                type="button"
                className="chip"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setEquipmentName(eq.name)
                  setShowSuggestions(false)
                  const prev = store.lastSetForEquipment(eq.id)
                  if (prev) {
                    if (entryKind(prev) === 'cardio') {
                      if (prev.flights != null && prev.flights > 0) {
                        setFlights(String(prev.flights))
                        setMiles('')
                        setDistanceAsFlights(true)
                      } else {
                        setMiles(prev.miles != null ? String(prev.miles) : '')
                        setFlights('')
                        setDistanceAsFlights(false)
                      }
                      setCalories(prev.calories != null ? String(prev.calories) : '')
                      setMinutes(prev.minutes != null ? String(prev.minutes) : '')
                      setWeight('')
                      setReps('')
                      setSetCount('1')
                    } else {
                      setWeight(String(prev.weight))
                      setReps(String(prev.reps))
                      setSetCount(String(prev.setCount ?? 1))
                      setMiles('')
                      setFlights('')
                      setDistanceAsFlights(false)
                      setCalories('')
                      setMinutes('')
                    }
                    setUnit(prev.unit)
                  }
                }}
              >
                {eq.name}
              </button>
            ))}
          </div>
        ) : null}

        {last ? (
          <div className="inline-actions">
            <button type="button" className="btn btn-ghost" onClick={applyRepeat}>
              Repeat last:{' '}
              {entryKind(last) === 'cardio'
                ? [
                    last.flights ? `${last.flights} flights` : last.miles ? `${last.miles} mi` : null,
                    last.calories ? `${last.calories} cal` : null,
                    last.minutes ? `${last.minutes} min` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'cardio'
                : `${(last.setCount ?? 1) > 1 ? `${last.setCount}×` : ''}${last.reps} @ ${last.weight} ${last.unit}`}
            </button>
          </div>
        ) : null}

        {cardioMode ? (
          <div className="row-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
            <label className="field">
              <span>miles / flights</span>
              <input
                className="input"
                inputMode="decimal"
                value={distanceAsFlights ? flights : miles}
                onChange={(e) => {
                  const v = e.target.value
                  if (distanceAsFlights) setFlights(v)
                  else setMiles(v)
                }}
                placeholder="0"
              />
            </label>
            <label className="field">
              <span>Calories</span>
              <input
                className="input"
                inputMode="numeric"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="field">
              <span>Minutes</span>
              <input
                className="input"
                inputMode="decimal"
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
                placeholder="0"
              />
            </label>
          </div>
        ) : (
          <>
            <div className="row-2">
              <label className="field">
                <span>Weight</span>
                <div className="input-with-toggle">
                  <input
                    className="input"
                    inputMode="decimal"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                    placeholder="0"
                    required
                  />
                  <div className="unit-toggle" role="group" aria-label="Weight unit">
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
                  placeholder="0"
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
                placeholder="1"
                required
              />
            </label>
          </>
        )}

        <label className="field">
          <span>Notes (optional)</span>
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Form cue, RPE, machine setting…"
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}
        {okFlash ? (
          <p className="form-ok">{cardioMode ? 'Cardio logged ✓' : 'Set logged ✓'}</p>
        ) : null}

        <button type="submit" className="btn btn-primary btn-block">
          {cardioMode ? 'Add cardio' : 'Add set'}
        </button>
      </form>

      {progress ? (
        <section className="progress-card" aria-label="Progress glance">
          <h2>Progress glance</h2>
          <p className="muted">
            {progress.totalSets} sets across {progress.dayCount} days
          </p>
          <div className="progress-stats">
            <div>
              <span className="stat-label">Latest best</span>
              <strong>
                {progress.latest.heaviest.weight} {progress.latest.heaviest.unit} ×{' '}
                {progress.latest.heaviest.reps}
              </strong>
            </div>
            {progress.previous ? (
              <div>
                <span className="stat-label">Prev session heavy</span>
                <strong>
                  {progress.previous.heaviest.weight}{' '}
                  {progress.previous.heaviest.unit} × {progress.previous.heaviest.reps}
                </strong>
              </div>
            ) : null}
          </div>
          <div className="spark" aria-hidden>
            {progress.days.map((d) => {
              const maxW = Math.max(
                ...progress.days.map((x) =>
                  x.heaviest.unit === 'kg'
                    ? x.heaviest.weight * 2.20462
                    : x.heaviest.weight,
                ),
                1,
              )
              const w =
                d.heaviest.unit === 'kg'
                  ? d.heaviest.weight * 2.20462
                  : d.heaviest.weight
              const h = Math.max(12, Math.round((w / maxW) * 48))
              return <span key={d.date} style={{ height: h }} title={d.date} />
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}
