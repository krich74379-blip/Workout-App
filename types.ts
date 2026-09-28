export type WeightUnit = 'lb' | 'kg'

/** Strength = weight×reps×sets; cardio = miles|flights / calories / minutes. */
export type SetKind = 'strength' | 'cardio'

export interface Equipment {
  id: string
  name: string
  createdAt: string
}

export interface SetEntry {
  id: string
  equipmentId: string
  /** Snapshot so history stays readable if equipment is renamed/removed */
  equipmentName: string
  /** Strength load; unused / 0 for cardio sessions. */
  weight: number
  unit: WeightUnit
  /** Strength reps; unused / 0 for cardio. */
  reps: number
  /** How many sets of this weight×reps (default 1). Older entries omit it. */
  setCount?: number
  /** Cardio distance in miles (optional; empty when flights used). */
  miles?: number
  /** Cardio flights of stairs (optional; empty when miles used). */
  flights?: number
  /** Cardio calories burned (optional). */
  calories?: number
  /** Cardio duration in minutes (optional). */
  minutes?: number
  /** Explicit kind; inferred from cardio fields when omitted. */
  kind?: SetKind
  notes?: string
  loggedAt: string
  /** Local calendar day YYYY-MM-DD */
  date: string
}

export interface AppSettings {
  preferredUnit: WeightUnit
  /** When true, high-confidence voice parses auto-save without confirm */
  quickVoiceLog?: boolean
}

export interface AppData {
  version: 1
  equipment: Equipment[]
  sets: SetEntry[]
  settings: AppSettings
}

export type TabId = 'today' | 'log' | 'equipment' | 'history'

export interface DaySummary {
  date: string
  totalSets: number
  uniqueEquipment: number
  sets: SetEntry[]
}
