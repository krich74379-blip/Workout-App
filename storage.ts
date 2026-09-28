import type { AppData, Equipment } from './types'


import { STARTER_EQUIPMENT_NAMES } from './data/exerciseCatalog'

function normalizeSet<T extends { setCount?: number; reps: number; weight: number }>(s: T): T {
  const setCount =
    typeof s.setCount === 'number' && Number.isFinite(s.setCount) && s.setCount >= 1
      ? Math.floor(s.setCount)
      : 1
  return { ...s, setCount }
}

export const STORAGE_KEY = 'workout-log:v1'

/** Full exercise library seeded from shared/exerciseCatalog.json (400+ names). */
const STARTER_EQUIPMENT: readonly string[] = STARTER_EQUIPMENT_NAMES


function ensureStarterEquipment(data: AppData): AppData {
  const names = new Set(data.equipment.map((e) => e.name.toLowerCase()))
  const extras: Equipment[] = STARTER_EQUIPMENT.filter(
    (n) => !names.has(n.toLowerCase()),
  ).map((name) => ({
    id: crypto.randomUUID(),
    name,
    createdAt: new Date().toISOString(),
  }))
  if (!extras.length) return data
  return { ...data, equipment: [...data.equipment, ...extras] }
}

export const defaultData = (): AppData =>
  ensureStarterEquipment({
    version: 1,
    equipment: [],
    sets: [],
    settings: { preferredUnit: 'lb', quickVoiceLog: false },
  })

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaultData()
    const parsed = JSON.parse(raw) as AppData
    if (!parsed || parsed.version !== 1) return defaultData()
    return ensureStarterEquipment({
      version: 1,
      equipment: Array.isArray(parsed.equipment) ? parsed.equipment : [],
      sets: Array.isArray(parsed.sets) ? parsed.sets.map(normalizeSet) : [],
      settings: {
        preferredUnit: parsed.settings?.preferredUnit === 'kg' ? 'kg' : 'lb',
        quickVoiceLog: Boolean(parsed.settings?.quickVoiceLog),
      },
    })
  } catch {
    return defaultData()
  }
}

export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function exportJson(data: AppData): string {
  return JSON.stringify(data, null, 2)
}

export function parseImportJson(text: string): AppData {
  const parsed = JSON.parse(text) as AppData
  if (!parsed || parsed.version !== 1) {
    throw new Error('Unsupported or missing data version')
  }
  if (!Array.isArray(parsed.equipment) || !Array.isArray(parsed.sets)) {
    throw new Error('Invalid workout data shape')
  }
  return ensureStarterEquipment({
    version: 1,
    equipment: parsed.equipment,
    sets: parsed.sets.map(normalizeSet),
    settings: {
      preferredUnit: parsed.settings?.preferredUnit === 'kg' ? 'kg' : 'lb',
      quickVoiceLog: Boolean(parsed.settings?.quickVoiceLog),
    },
  })
}

export function downloadJson(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
