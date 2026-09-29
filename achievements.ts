import type { SetEntry, WeightUnit } from '../types'
import { entryKind, entrySetCount } from '../utils'

export interface Achievement {
  id: string
  name: string
  desc: string
  icon: string
  unlocked: boolean
  /** Current progress toward the goal (capped display at goal). */
  progress: number
  goal: number
  unit?: string
  /** YYYY-MM-DD the achievement was first earned, or null. */
  earnedDate: string | null
}

export interface LevelInfo {
  level: number
  name: string
  icon: string
  xp: number
  xpForCurrent: number
  xpForNext: number
}

const toLb = (weight: number, unit: WeightUnit) =>
  unit === 'kg' ? weight * 2.20462 : weight

const LEVEL_NAMES: [number, string, string][] = [
  [1, 'Rookie', '🌱'],
  [2, 'Regular', '🔥'],
  [3, 'Contender', '⚡'],
  [4, 'Athlete', '🏅'],
  [5, 'Beast', '🦍'],
  [6, 'Elite', '💎'],
]

/** Cumulative XP needed to reach a level. L1=0, L2=500, L3=1500, L4=3000… */
function xpForLevel(level: number): number {
  return 500 * ((level - 1) * level) / 2
}

export function levelForXp(xp: number): LevelInfo {
  let level = 1
  while (xpForLevel(level + 1) <= xp) level++
  const [baseLevel, name, icon] =
    LEVEL_NAMES.find(([l]) => l === level) ?? [level, 'Legend', '👑']
  return {
    level: baseLevel,
    name,
    icon,
    xp: Math.floor(xp),
    xpForCurrent: xpForLevel(baseLevel),
    xpForNext: xpForLevel(baseLevel + 1),
  }
}

function dayDiff(a: string, b: string): number {
  const pa = a.split('-').map(Number)
  const pb = b.split('-').map(Number)
  return (
    (Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) /
    86400000
  )
}

interface CountGoal {
  id: string
  name: string
  desc: string
  icon: string
  goal: number
  /** Unit label appended in progress displays, e.g. "lb". */
  unit?: string
  /** (totals) => current value */
  value: (t: Totals) => number
  format?: (n: number) => string
}

interface Totals {
  sets: number
  volumeLb: number
  cardioSessions: number
  cardioMinutes: number
  miles: number
  recordMoments: number
}

const COUNT_GOALS: CountGoal[] = [
  { id: 'first-set', name: 'First Rep', desc: 'Log your very first set.', icon: '🌱', goal: 1, value: (t) => t.sets },
  { id: 'sets-25', name: 'Warming Up', desc: 'Log 25 total sets.', icon: '🔥', goal: 25, value: (t) => t.sets },
  { id: 'sets-100', name: 'Century Club', desc: 'Log 100 total sets.', icon: '💯', goal: 100, value: (t) => t.sets },
  { id: 'sets-500', name: 'Iron Addict', desc: 'Log 500 total sets.', icon: '🏋️', goal: 500, value: (t) => t.sets },
  { id: 'vol-5k', name: 'Mover', desc: 'Lift 5,000 lb all time.', icon: '📦', goal: 5000, unit: 'lb', value: (t) => t.volumeLb, format: (n) => `${Math.floor(n).toLocaleString()} lb` },
  { id: 'vol-25k', name: 'Heavy Hauler', desc: 'Lift 25,000 lb all time.', icon: '🚚', goal: 25000, unit: 'lb', value: (t) => t.volumeLb, format: (n) => `${Math.floor(n).toLocaleString()} lb` },
  { id: 'vol-100k', name: 'Beast Mode', desc: 'Lift 100,000 lb all time.', icon: '🦍', goal: 100000, unit: 'lb', value: (t) => t.volumeLb, format: (n) => `${Math.floor(n).toLocaleString()} lb` },
  { id: 'record-1', name: 'Record Setter', desc: 'Beat your own best on any exercise.', icon: '🥇', goal: 1, value: (t) => t.recordMoments },
  { id: 'record-10', name: 'Record Collector', desc: 'Set 10 new personal bests.', icon: '👑', goal: 10, value: (t) => t.recordMoments },
  { id: 'cardio-1', name: 'Cardio Starter', desc: 'Log your first cardio session.', icon: '❤️', goal: 1, value: (t) => t.cardioSessions },
  { id: 'miles-262', name: 'Marathoner', desc: 'Cover 26.2 miles of cardio all time.', icon: '🏃', goal: 26.2, unit: 'mi', value: (t) => t.miles, format: (n) => `${n.toFixed(1)} mi` },
]

const STREAK_GOALS = [
  { id: 'streak-3', name: 'On a Roll', desc: 'Work out 3 days in a row.', icon: '🔗', goal: 3 },
  { id: 'streak-7', name: 'Week Warrior', desc: 'Work out 7 days in a row.', icon: '⚡', goal: 7 },
  { id: 'streak-14', name: 'Unstoppable', desc: 'Work out 14 days in a row.', icon: '🏆', goal: 14 },
]

function setVolumeLb(s: SetEntry): number {
  if (entryKind(s) !== 'strength' || !(s.weight > 0)) return 0
  return toLb(s.weight, s.unit) * s.reps * entrySetCount(s)
}

function setXp(s: SetEntry): number {
  const kind = entryKind(s)
  if (kind === 'cardio') {
    const mins = s.minutes && s.minutes > 0 ? s.minutes : 0
    const miles = s.miles && s.miles > 0 ? s.miles : 0
    return 10 + mins * 5 + miles * 20
  }
  return entrySetCount(s) * 10 + setVolumeLb(s) / 100
}

export interface AchievementsResult {
  achievements: Achievement[]
  level: LevelInfo
  unlockedCount: number
}

export function computeAchievements(sets: SetEntry[]): AchievementsResult {
  const ordered = [...sets].sort(
    (a, b) => a.date.localeCompare(b.date) || a.loggedAt.localeCompare(b.loggedAt),
  )

  const totals: Totals = {
    sets: 0,
    volumeLb: 0,
    cardioSessions: 0,
    cardioMinutes: 0,
    miles: 0,
    recordMoments: 0,
  }
  let xp = 0
  const bestByExercise = new Map<string, number>()
  const earned = new Map<string, string>()
  const daysWithSets = new Set<string>()

  const checkCountGoals = (date: string) => {
    for (const g of COUNT_GOALS) {
      if (!earned.has(g.id) && g.value(totals) >= g.goal) earned.set(g.id, date)
    }
  }

  for (const s of ordered) {
    const kind = entryKind(s)
    const n = entrySetCount(s)
    totals.sets += n
    totals.volumeLb += setVolumeLb(s)
    xp += setXp(s)
    daysWithSets.add(s.date)
    if (kind === 'cardio') {
      totals.cardioSessions += 1
      if (s.minutes && s.minutes > 0) totals.cardioMinutes += s.minutes
      if (s.miles && s.miles > 0) totals.miles += s.miles
    } else if (s.weight > 0) {
      const key = s.equipmentName.trim().toLowerCase()
      const w = toLb(s.weight, s.unit)
      const prev = bestByExercise.get(key)
      if (prev === undefined) {
        bestByExercise.set(key, w)
      } else if (w > prev) {
        bestByExercise.set(key, w)
        totals.recordMoments += 1
      }
    }
    checkCountGoals(s.date)
  }

  // Streaks: first end-date reaching each goal length.
  const days = [...daysWithSets].sort()
  const streakEarned = new Map<string, string>()
  let runStart = 0
  for (let i = 1; i <= days.length; i++) {
    const continues = i < days.length && dayDiff(days[i - 1], days[i]) === 1
    if (!continues) {
      const runLen = i - runStart
      for (const g of STREAK_GOALS) {
        if (runLen >= g.goal && !streakEarned.has(g.id)) {
          // end date = start + (goal-1) days
          const [y, m, d] = days[runStart].split('-').map(Number)
          const end = new Date(Date.UTC(y, m - 1, d + (g.goal - 1)))
          streakEarned.set(
            g.id,
            end.toISOString().slice(0, 10),
          )
        }
      }
      runStart = i
    }
  }
  const bestStreak = (() => {
    let best = 0
    let run = 0
    let prev: string | null = null
    for (const d of days) {
      run = prev !== null && dayDiff(prev, d) === 1 ? run + 1 : 1
      best = Math.max(best, run)
      prev = d
    }
    return best
  })()

  const achievements: Achievement[] = [
    ...COUNT_GOALS.map((g) => {
      const v = g.value(totals)
      return {
        id: g.id,
        name: g.name,
        desc: g.desc,
        icon: g.icon,
        unlocked: earned.has(g.id),
        progress: v,
        goal: g.goal,
        unit: g.unit,
        earnedDate: earned.get(g.id) ?? null,
      }
    }),
    ...STREAK_GOALS.map((g) => ({
      id: g.id,
      name: g.name,
      desc: g.desc,
      icon: g.icon,
      unlocked: streakEarned.has(g.id),
      progress: Math.min(bestStreak, g.goal),
      goal: g.goal,
      earnedDate: streakEarned.get(g.id) ?? null,
    })),
  ]
  // Hardest first within unlocked, then by progress ratio.
  achievements.sort((a, b) => {
    if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1
    return b.progress / b.goal - a.progress / a.goal
  })

  return {
    achievements,
    level: levelForXp(xp),
    unlockedCount: achievements.filter((a) => a.unlocked).length,
  }
}

/** Format a progress value like "7/10" or "3,200/5,000 lb". */
export function formatProgress(a: Achievement): string {
  const fmt = (n: number) =>
    Number.isInteger(a.goal) ? Math.floor(n).toLocaleString() : n.toFixed(1)
  const goal = Number.isInteger(a.goal)
    ? a.goal.toLocaleString()
    : a.goal.toFixed(1)
  const unit = a.unit ? ` ${a.unit}` : ''
  return `${fmt(Math.min(a.progress, a.goal))} / ${goal}${unit}`
}
