import { EXERCISE_CATALOG, type ExerciseKind } from './data/exerciseCatalog'
import type { SetEntry, SetKind } from './types'

/** Local calendar date as YYYY-MM-DD */
export function todayKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function formatDisplayDate(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const today = todayKey()
  const yesterday = todayKey(new Date(Date.now() - 86400000))
  if (dateKey === today) return 'Today'
  if (dateKey === yesterday) return 'Yesterday'
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined,
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? `1 ${one}` : `${n} ${many}`
}

/** Effective set count (older entries default to 1). */
export function entrySetCount(s: { setCount?: number }): number {
  const n = s.setCount
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
}

export function catalogKindForName(name: string): ExerciseKind | string | undefined {
  const lower = name.trim().toLowerCase()
  if (!lower) return undefined
  const hit = EXERCISE_CATALOG.find((e) => e.name.toLowerCase() === lower)
  return hit?.kind
}

export function isCardioEquipmentName(name: string): boolean {
  return catalogKindForName(name) === 'cardio'
}

export function entryKind(s: {
  kind?: SetKind
  miles?: number
  flights?: number
  calories?: number
  minutes?: number
  equipmentName?: string
}): SetKind {
  if (s.kind === 'cardio' || s.kind === 'strength') return s.kind
  if (
    (typeof s.miles === 'number' && s.miles > 0) ||
    (typeof s.flights === 'number' && s.flights > 0) ||
    (typeof s.calories === 'number' && s.calories > 0) ||
    (typeof s.minutes === 'number' && s.minutes > 0)
  ) {
    return 'cardio'
  }
  if (s.equipmentName && isCardioEquipmentName(s.equipmentName)) return 'cardio'
  return 'strength'
}

/** Display like "3×15 @ 90 lb" or "4 mi · 200 cal · 20 min" for cardio. */
export function formatSetLoad(s: {
  weight: number
  unit: string
  reps: number
  setCount?: number
  miles?: number
  flights?: number
  calories?: number
  minutes?: number
  kind?: SetKind
  equipmentName?: string
}): string {
  if (entryKind(s) === 'cardio') {
    const parts: string[] = []
    if (typeof s.flights === 'number' && s.flights > 0) {
      parts.push(`${trimNum(s.flights)} flights`)
    } else if (typeof s.miles === 'number' && s.miles > 0) {
      parts.push(`${trimNum(s.miles)} mi`)
    }
    if (typeof s.calories === 'number' && s.calories > 0) {
      parts.push(`${trimNum(s.calories)} cal`)
    }
    if (typeof s.minutes === 'number' && s.minutes > 0) {
      parts.push(`${trimNum(s.minutes)} min`)
    }
    return parts.length > 0 ? parts.join(' · ') : 'cardio'
  }
  const sc = entrySetCount(s)
  if (sc > 1) return `${sc}×${s.reps} @ ${s.weight} ${s.unit}`
  return `${s.weight} ${s.unit} × ${s.reps}`
}

function trimNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)
}

export type { SetEntry }
