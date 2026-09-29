import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  downloadJson,
  exportJson,
  loadData,
  parseImportJson,
  saveData,
} from '../storage'
import type {
  AppData,
  DaySummary,
  Equipment,
  SetEntry,
  SetKind,
  WeightUnit,
} from '../types'
import { entryKind, entrySetCount, isCardioEquipmentName, todayKey, uid } from '../utils'

export function useWorkoutStore() {
  const [data, setData] = useState<AppData>(() => loadData())

  useEffect(() => {
    saveData(data)
  }, [data])

  const update = useCallback((fn: (prev: AppData) => AppData) => {
    setData((prev) => fn(prev))
  }, [])

  const preferredUnit = data.settings.preferredUnit

  const setPreferredUnit = useCallback(
    (unit: WeightUnit) => {
      update((prev) => ({
        ...prev,
        settings: { ...prev.settings, preferredUnit: unit },
      }))
    },
    [update],
  )

  const quickVoiceLog = Boolean(data.settings.quickVoiceLog)

  const setQuickVoiceLog = useCallback(
    (enabled: boolean) => {
      update((prev) => ({
        ...prev,
        settings: { ...prev.settings, quickVoiceLog: enabled },
      }))
    },
    [update],
  )

  const equipmentSorted = useMemo(
    () =>
      [...data.equipment].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [data.equipment],
  )

  const ensureEquipment = useCallback(
    (name: string): Equipment => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Equipment name required')
      const existing = data.equipment.find(
        (e) => e.name.toLowerCase() === trimmed.toLowerCase(),
      )
      if (existing) return existing
      const created: Equipment = {
        id: uid(),
        name: trimmed,
        createdAt: new Date().toISOString(),
      }
      update((prev) => ({
        ...prev,
        equipment: [...prev.equipment, created],
      }))
      return created
    },
    [data.equipment, update],
  )

  const addEquipment = useCallback(
    (name: string) => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Name required')
      if (
        data.equipment.some(
          (e) => e.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        throw new Error('That equipment already exists')
      }
      const created: Equipment = {
        id: uid(),
        name: trimmed,
        createdAt: new Date().toISOString(),
      }
      update((prev) => ({
        ...prev,
        equipment: [...prev.equipment, created],
      }))
      return created
    },
    [data.equipment, update],
  )

  const renameEquipment = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim()
      if (!trimmed) throw new Error('Name required')
      if (
        data.equipment.some(
          (e) =>
            e.id !== id && e.name.toLowerCase() === trimmed.toLowerCase(),
        )
      ) {
        throw new Error('That name is already used')
      }
      update((prev) => ({
        ...prev,
        equipment: prev.equipment.map((e) =>
          e.id === id ? { ...e, name: trimmed } : e,
        ),
        sets: prev.sets.map((s) =>
          s.equipmentId === id ? { ...s, equipmentName: trimmed } : s,
        ),
      }))
    },
    [data.equipment, update],
  )

  const removeEquipment = useCallback(
    (id: string) => {
      update((prev) => ({
        ...prev,
        equipment: prev.equipment.filter((e) => e.id !== id),
      }))
    },
    [update],
  )

  const logSet = useCallback(
    (input: {
      equipmentName: string
      weight?: number
      unit?: WeightUnit
      reps?: number
      setCount?: number
      miles?: number
      flights?: number
      calories?: number
      minutes?: number
      kind?: SetKind
      notes?: string
      date?: string
    }) => {
      const kind: SetKind =
        input.kind ??
        entryKind({
          kind: input.kind,
          miles: input.miles,
          flights: input.flights,
          calories: input.calories,
          minutes: input.minutes,
          equipmentName: input.equipmentName,
        })
      const isCardio =
        kind === 'cardio' ||
        isCardioEquipmentName(input.equipmentName) ||
        (input.miles ?? 0) > 0 ||
        (input.flights ?? 0) > 0 ||
        (input.calories ?? 0) > 0 ||
        (input.minutes ?? 0) > 0

      let weight = input.weight ?? 0
      let reps = input.reps ?? 0
      let setCount = entrySetCount({ setCount: input.setCount ?? 1 })
      const unit = input.unit ?? preferredUnit

      if (isCardio) {
        weight = Number.isFinite(weight) && weight >= 0 ? weight : 0
        reps = Number.isFinite(reps) && reps >= 0 ? Math.floor(reps) : 0
        setCount = 1
        const miles = input.miles
        const flights = input.flights
        const calories = input.calories
        const minutes = input.minutes
        if (
          !(typeof miles === 'number' && miles > 0) &&
          !(typeof flights === 'number' && flights > 0) &&
          !(typeof calories === 'number' && calories > 0) &&
          !(typeof minutes === 'number' && minutes > 0)
        ) {
          throw new Error('Add miles/flights, calories, or minutes for cardio')
        }
        if (miles !== undefined && (!(miles >= 0) || Number.isNaN(miles))) {
          throw new Error('Enter valid miles')
        }
        if (
          flights !== undefined &&
          (!(flights >= 0) || Number.isNaN(flights) || !Number.isInteger(flights))
        ) {
          throw new Error('Flights must be a whole number')
        }
        if (
          calories !== undefined &&
          (!(calories >= 0) || Number.isNaN(calories) || !Number.isInteger(calories))
        ) {
          throw new Error('Calories must be a whole number')
        }
        if (minutes !== undefined && (!(minutes >= 0) || Number.isNaN(minutes))) {
          throw new Error('Enter valid minutes')
        }
      } else {
        if (!(weight >= 0) || Number.isNaN(weight)) {
          throw new Error('Enter a valid weight')
        }
        if (!(reps > 0) || !Number.isInteger(reps)) {
          throw new Error('Reps must be a positive whole number')
        }
        if (!(setCount >= 1) || setCount > 30 || !Number.isInteger(setCount)) {
          throw new Error('Sets must be a whole number from 1 to 30')
        }
      }

      const eq = ensureEquipment(input.equipmentName)
      const entry: SetEntry = {
        id: uid(),
        equipmentId: eq.id,
        equipmentName: eq.name,
        weight,
        unit,
        reps,
        setCount,
        kind: isCardio ? 'cardio' : 'strength',
        miles: isCardio && (input.miles ?? 0) > 0 ? input.miles : undefined,
        flights:
          isCardio && (input.flights ?? 0) > 0 ? input.flights : undefined,
        calories:
          isCardio && (input.calories ?? 0) > 0 ? input.calories : undefined,
        minutes:
          isCardio && (input.minutes ?? 0) > 0 ? input.minutes : undefined,
        notes: input.notes?.trim() || undefined,
        loggedAt: new Date().toISOString(),
        date: input.date ?? todayKey(),
      }
      update((prev) => ({ ...prev, sets: [...prev.sets, entry] }))
      return entry
    },
    [ensureEquipment, preferredUnit, update],
  )

  const updateSet = useCallback(
    (
      id: string,
      patch: Partial<
        Pick<SetEntry, 'weight' | 'unit' | 'reps' | 'setCount' | 'miles' | 'flights' | 'calories' | 'minutes' | 'kind' | 'notes' | 'equipmentName'>
      >,
    ) => {
      update((prev) => {
        const target = prev.sets.find((s) => s.id === id)
        if (!target) return prev

        let equipmentId = target.equipmentId
        let equipmentName = target.equipmentName
        let equipment = prev.equipment

        if (patch.equipmentName !== undefined) {
          const trimmed = patch.equipmentName.trim()
          if (!trimmed) throw new Error('Equipment name required')
          const existing = prev.equipment.find(
            (e) => e.name.toLowerCase() === trimmed.toLowerCase(),
          )
          if (existing) {
            equipmentId = existing.id
            equipmentName = existing.name
          } else {
            const created: Equipment = {
              id: uid(),
              name: trimmed,
              createdAt: new Date().toISOString(),
            }
            equipment = [...prev.equipment, created]
            equipmentId = created.id
            equipmentName = created.name
          }
        }

        const nextKind = entryKind({
          ...target,
          ...patch,
          equipmentName: equipmentName,
        })
        if (patch.reps !== undefined && nextKind !== 'cardio') {
          if (!(patch.reps > 0) || !Number.isInteger(patch.reps)) {
            throw new Error('Reps must be a positive whole number')
          }
        }
        if (patch.weight !== undefined) {
          if (!(patch.weight >= 0) || Number.isNaN(patch.weight)) {
            throw new Error('Enter a valid weight')
          }
        }
        let nextSetCount: number | undefined
        if (patch.setCount !== undefined) {
          const sc = entrySetCount({ setCount: patch.setCount })
          if (!(sc >= 1) || sc > 30 || !Number.isInteger(sc)) {
            throw new Error('Sets must be a whole number from 1 to 30')
          }
          nextSetCount = sc
        }

        return {
          ...prev,
          equipment,
          sets: prev.sets.map((s) =>
            s.id === id
              ? {
                  ...s,
                  equipmentId,
                  equipmentName,
                  weight: patch.weight ?? s.weight,
                  unit: patch.unit ?? s.unit,
                  reps: patch.reps ?? s.reps,
                  setCount:
                    nextSetCount !== undefined
                      ? nextSetCount
                      : entrySetCount(s),
                  miles: patch.miles !== undefined ? patch.miles : s.miles,
                  flights: patch.flights !== undefined ? patch.flights : s.flights,
                  calories:
                    patch.calories !== undefined ? patch.calories : s.calories,
                  minutes:
                    patch.minutes !== undefined ? patch.minutes : s.minutes,
                  kind: patch.kind ?? nextKind,
                  notes:
                    patch.notes !== undefined
                      ? patch.notes.trim() || undefined
                      : s.notes,
                }
              : s,
          ),
        }
      })
    },
    [update],
  )

  const deleteSet = useCallback(
    (id: string) => {
      update((prev) => ({
        ...prev,
        sets: prev.sets.filter((s) => s.id !== id),
      }))
    },
    [update],
  )

  const todaySets = useMemo(() => {
    const key = todayKey()
    return data.sets
      .filter((s) => s.date === key)
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
  }, [data.sets])

  /** Single most recently logged set across all days (for "repeat last set"). */
  const mostRecentSet = useMemo(() => {
    if (data.sets.length === 0) return null
    return [...data.sets].sort((a, b) =>
      b.loggedAt.localeCompare(a.loggedAt),
    )[0]
  }, [data.sets])

  const historyByDay = useMemo((): DaySummary[] => {    const map = new Map<string, SetEntry[]>()
    for (const s of data.sets) {
      const list = map.get(s.date) ?? []
      list.push(s)
      map.set(s.date, list)
    }
    return [...map.entries()]
      .map(([date, sets]) => {
        const sorted = [...sets].sort((a, b) =>
          a.loggedAt.localeCompare(b.loggedAt),
        )
        const unique = new Set(sorted.map((s) => s.equipmentId))
        return {
          date,
          totalSets: sorted.reduce((n, s) => n + entrySetCount(s), 0),
          uniqueEquipment: unique.size,
          sets: sorted,
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [data.sets])

  const lastSetForEquipment = useCallback(
    (equipmentId: string): SetEntry | undefined => {
      const matches = data.sets
        .filter((s) => s.equipmentId === equipmentId)
        .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt))
      return matches[0]
    },
    [data.sets],
  )

  const progressForEquipment = useCallback(
    (equipmentId: string) => {
      const matches = data.sets
        .filter((s) => s.equipmentId === equipmentId)
        .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))
      if (matches.length === 0) return null
      const byDate = new Map<string, SetEntry[]>()
      for (const s of matches) {
        const list = byDate.get(s.date) ?? []
        list.push(s)
        byDate.set(s.date, list)
      }
      const days = [...byDate.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, sets]) => {
          const best = sets.reduce((acc, s) => {
            // Compare within same unit preference: convert roughly if mixed
            const score =
              (s.unit === 'kg' ? s.weight * 2.20462 * s.reps : s.weight * s.reps) *
              entrySetCount(s)
            const accScore =
              (acc.unit === 'kg'
                ? acc.weight * 2.20462 * acc.reps
                : acc.weight * acc.reps) * entrySetCount(acc)
            return score >= accScore ? s : acc
          }, sets[0])
          const heaviest = sets.reduce((a, b) => {
            const aw = a.unit === 'kg' ? a.weight * 2.20462 : a.weight
            const bw = b.unit === 'kg' ? b.weight * 2.20462 : b.weight
            return bw >= aw ? b : a
          }, sets[0])
          return { date, sets, best, heaviest }
        })
      const latest = days[days.length - 1]
      const previous = days.length > 1 ? days[days.length - 2] : null
      return {
        totalSets: matches.reduce((n, s) => n + entrySetCount(s), 0),
        dayCount: days.length,
        latest,
        previous,
        days: days.slice(-8),
      }
    },
    [data.sets],
  )

  const exportData = useCallback(() => {
    const stamp = todayKey()
    downloadJson(`workout-log-${stamp}.json`, exportJson(data))
  }, [data])

  const importData = useCallback((text: string) => {
    const next = parseImportJson(text)
    setData(next)
  }, [])

  const clearAll = useCallback(() => {
    setData({
      version: 1,
      equipment: [],
      sets: [],
      settings: {
        preferredUnit: data.settings.preferredUnit,
        quickVoiceLog: data.settings.quickVoiceLog,
      },
    })
  }, [data.settings.preferredUnit, data.settings.quickVoiceLog])

  return {
    data,
    preferredUnit,
    setPreferredUnit,
    quickVoiceLog,
    setQuickVoiceLog,
    equipmentSorted,
    addEquipment,
    renameEquipment,
    removeEquipment,
    ensureEquipment,
    logSet,
    updateSet,
    deleteSet,
    todaySets,
    historyByDay,
    mostRecentSet,
    lastSetForEquipment,
    progressForEquipment,
    exportData,
    importData,
    clearAll,
  }
}

export type WorkoutStore = ReturnType<typeof useWorkoutStore>
