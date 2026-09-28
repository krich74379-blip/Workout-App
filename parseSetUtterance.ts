import type { WeightUnit } from '../types'

export type ParsedSetUtterance = {
  equipmentName: string
  weight: number
  reps: number
  /** Number of sets (default 1). e.g. "3 sets of 15" → setCount=3, reps=15 */
  setCount: number
  unit: WeightUnit
  /** Cardio distance (miles). Present when utterance is a cardio session. */
  miles?: number
  /** Cardio flights of stairs (stair machines). */
  flights?: number
  /** Cardio calories. */
  calories?: number
  /** Cardio duration (minutes). */
  minutes?: number
  /** strength (default) or cardio when miles/cal/min/flights detected or catalog kind. */
  kind?: 'strength' | 'cardio'
  /** 0–1 rough confidence for quick-log gating */
  confidence: number
  matchedLibrary: boolean
  raw: string
}

export type ParseOptions = {
  equipmentNames?: string[]
  preferredUnit?: WeightUnit
  /** Lowercase spoken alias → canonical equipment name (from exercise catalog). */
  equipmentAliases?: Record<string, string>
  /**
   * Guided logging: user already picked equipment. Ignore spoken machine names
   * (Whisper invents) and force this catalog name onto the parse.
   */
  lockedEquipment?: string
  /** When locked, prefer cardio vs strength number parsing. */
  lockedKind?: 'strength' | 'cardio'
}

const ONES: Record<string, number> = {
  zero: 0,
  oh: 0,
  o: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
}

const TENS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
}

const UNIT_WORDS = new Set([
  'pound',
  'pounds',
  'lb',
  'lbs',
  'kilo',
  'kilos',
  'kilogram',
  'kilograms',
  'kg',
])

const REP_WORDS = new Set(['rep', 'reps', 'repetition', 'repetitions'])

const CONNECTORS = new Set([
  'for',
  'fore',
  'by',
  'times',
  'x',
  'of',
  'at',
  'with',
  'and', // Whisper: "40 pounds and 15 reps and 4 sets"
])

function normalizeTranscript(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[’']/g, '') // captain's → captains (aliases also store sans apostrophe)
    .replace(/[×✕✖⨯]/g, ' x ')
    .replace(/(\d)\s*[xX]\s*(\d)/g, '$1 x $2')
    .replace(/(\d)\s*\/\s*(\d)/g, '$1 x $2')
    // Split glued weight units: 200lbs → 200 lbs
    .replace(/(\d)(lbs?|pounds?|kgs?|kilos?|kilograms?)\b/g, '$1 $2')
    // Split glued cardio units: 4miles → 4 miles, 200cal → 200 cal, 20min → 20 min
    .replace(/(\d)(miles?|mi|flights?|calories?|cals?|kcals?|minutes?|mins?)\b/gi, '$1 $2')
    // Keep leading catalog angles with the name (45 degree leg press)
    .replace(/\b(\d+)\s*-?\s*degrees?\b/g, '$1-degree')
    .replace(/@/g, ' at ')
    .replace(/[^\w\s-]/g, ' ') // keep hyphens (one-handed, close-grip, pull-up)
    .replace(/\b(please\s+)?log(\s+a)?\b/g, ' ')
    .replace(/^(a|an|the)\s+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** Parse spoken/digit number tokens starting at index `i`. */
export function parseNumberAt(
  tokens: string[],
  i: number,
): { value: number; next: number } | null {
  if (i >= tokens.length) return null
  const t0 = tokens[i]

  if (/^\d+(\.\d+)?$/.test(t0)) {
    return { value: Number(t0), next: i + 1 }
  }

  // "one hundred eighty five"
  if (ONES[t0] !== undefined && ONES[t0] < 10 && tokens[i + 1] === 'hundred') {
    let value = ONES[t0] * 100
    let j = i + 2
    const rest = parseNumberAt(tokens, j)
    if (rest && rest.value < 100) {
      value += rest.value
      return { value, next: rest.next }
    }
    return { value, next: j }
  }

  // Gym shorthand: "one eighty five" → 185, "two twenty five" → 225
  if (ONES[t0] !== undefined && ONES[t0] >= 1 && ONES[t0] <= 9) {
    const hundreds = ONES[t0]
    let j = i + 1
    if (j < tokens.length && TENS[tokens[j]] !== undefined) {
      let value = hundreds * 100 + TENS[tokens[j]]
      j += 1
      if (
        j < tokens.length &&
        ONES[tokens[j]] !== undefined &&
        ONES[tokens[j]] < 10
      ) {
        value += ONES[tokens[j]]
        j += 1
      }
      return { value, next: j }
    }
    if (
      j < tokens.length &&
      ONES[tokens[j]] !== undefined &&
      ONES[tokens[j]] >= 10
    ) {
      return { value: hundreds * 100 + ONES[tokens[j]], next: j + 1 }
    }
  }

  if (TENS[t0] !== undefined) {
    let value = TENS[t0]
    let j = i + 1
    if (
      j < tokens.length &&
      ONES[tokens[j]] !== undefined &&
      ONES[tokens[j]] < 10
    ) {
      value += ONES[tokens[j]]
      j += 1
    }
    return { value, next: j }
  }

  if (ONES[t0] !== undefined) {
    return { value: ONES[t0], next: i + 1 }
  }

  return null
}

function titleCaseName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 2) return 99
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      )
    }
  }
  return dp[m][n]
}

function stripMachineSuffix(s: string): string {
  return s.replace(/\s+machines?$/i, '').trim()
}

function scoreEquipmentMatch(spoken: string, libraryName: string): number {
  const norm = (s: string) =>
    s.toLowerCase().trim().replace(/[’']/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ')
  const a = norm(spoken)
  const b = norm(libraryName)
  if (!a || !b) return 0
  if (a === b) return 1

  const aStem = stripMachineSuffix(a)
  const bStem = stripMachineSuffix(b)
  // "glute" ↔ "Glute Machine", "chest press machine" ↔ "Chest Press"
  if (aStem && bStem && aStem === bStem && (a !== aStem || b !== bStem)) {
    return 0.97
  }

  if (b.includes(a) || a.includes(b) || bStem.includes(aStem) || aStem.includes(bStem)) {
    const aa = aStem || a
    const bb = bStem || b
    // Prefer longer library names when spoken contains the library stem
    // ("clean and jerk" should beat bare "clean"; "leg press" beats "press")
    const lenBoost = Math.min(aa.length, bb.length) / Math.max(aa.length, bb.length)
    let score = 0.85 + 0.1 * lenBoost
    // Extra boost when spoken is longer and contains the library name as a stem
    // but prefer the longer library entry when comparing externally via length tie-break.
    if (aa.length > bb.length && aa.includes(bb)) {
      // Strongly prefer the longer spoken/library match (Smith Machine One-Handed Row
      // must beat bare Smith Machine when the spoken phrase is longer).
      score -= 0.2
    }
    if (bb.length > aa.length && bb.includes(aa) && aa.length >= 4) {
      score += 0.08 // boost longer library name that contains spoken
    }
    return score
  }
  const at = aStem.split(/\s+/).filter(Boolean)
  const bt = bStem.split(/\s+/).filter(Boolean)
  const aw = new Set(at)
  const hit = bt.filter((w) => aw.has(w)).length
  let tokenScore = hit === 0 ? 0 : (hit / Math.max(bt.length, at.length)) * 0.75

  // Near-miss tokens (e.g. "lag press" ≈ "leg press"): edit-distance ≤ 1
  if (at.length === bt.length && at.length > 0) {
    let near = 0
    for (let i = 0; i < at.length; i++) {
      if (at[i] === bt[i]) near += 1
      else if (editDistance(at[i], bt[i]) <= 1) near += 0.85
    }
    const fuzzy = (near / at.length) * 0.9
    if (fuzzy > tokenScore) tokenScore = fuzzy
  }

  return tokenScore
}

function matchEquipment(
  candidate: string,
  library: string[],
  aliases?: Record<string, string>,
): { name: string; matched: boolean; score: number } {
  const cleaned = candidate.replace(/\s+/g, ' ').trim()
  if (!cleaned) return { name: '', matched: false, score: 0 }
  const lower = cleaned.toLowerCase()
  const lowerNorm = lower.replace(/[’']/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ')
  const libraryByLower = new Map(library.map((n) => [n.toLowerCase(), n]))
  for (const n of library) {
    const k = n.toLowerCase().replace(/[’']/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ')
    if (!libraryByLower.has(k)) libraryByLower.set(k, n)
  }

  // Exact catalog alias → canonical library name
  if (aliases) {
    const canon = aliases[lower] || aliases[lowerNorm]
    if (canon) {
      const libHit =
        libraryByLower.get(canon.toLowerCase()) ||
        libraryByLower.get(canon.toLowerCase().replace(/[’']/g, '').replace(/-/g, ' '))
      if (libHit) return { name: libHit, matched: true, score: 1 }
    }
  }

  let best: { name: string; score: number } | null = null
  for (const name of library) {
    const score = scoreEquipmentMatch(cleaned, name)
    if (!best || score > best.score) {
      best = { name, score }
    } else if (score === best.score) {
      // Prefer closer length to the spoken phrase (bare "curl" → Leg Curl not Dumbbell Curl)
      const dNew = Math.abs(name.length - cleaned.length)
      const dBest = Math.abs(best.name.length - cleaned.length)
      if (dNew < dBest) best = { name, score }
      else if (dNew === dBest && name.length > best.name.length) best = { name, score }
    } else if (best && score >= best.score - 0.02 && name.length > best.name.length + 5) {
      // Near-tie: prefer substantially longer catalog name (Smith Machine One-Handed Row
      // over Smith Machine; Hip Abduction Machine over Hip Abduction when spoken has machine)
      const spokenHas = (w: string) => cleaned.toLowerCase().includes(w)
      if (spokenHas('machine') && /machine/i.test(name) && !/machine/i.test(best.name)) {
        best = { name, score }
      } else if (spokenHas('smith') && /smith/i.test(name) && !/smith/i.test(best.name)) {
        best = { name, score }
      }
    }
  }

  if (best && best.score >= 0.45) {
    return { name: best.name, matched: true, score: best.score }
  }

  // Title-case exact match (case-insensitive) → treat as library hit
  const titled = titleCaseName(cleaned)
  const exact = library.find((n) => n.toLowerCase() === titled.toLowerCase())
  if (exact) {
    return { name: exact, matched: true, score: 0.95 }
  }
  // Also accept cleaned lower equals library lower (hyphen/spacing already normalized)
  const exactRaw = library.find((n) => n.toLowerCase() === cleaned.toLowerCase())
  if (exactRaw) {
    return { name: exactRaw, matched: true, score: 0.95 }
  }

  // Gym-catalog bias: NEVER invent freeform equipment (e.g. "Isa Curls").
  // Prefer nearest catalog match when there is any meaningful signal; otherwise
  // leave equipment blank for the user to edit.
  if (best && best.score >= 0.28) {
    return { name: best.name, matched: true, score: best.score }
  }
  return { name: '', matched: false, score: 0 }
}

function detectUnit(tokens: string[], fallback: WeightUnit): WeightUnit {
  for (const t of tokens) {
    if (
      t === 'kg' ||
      t === 'kilo' ||
      t === 'kilos' ||
      t === 'kilogram' ||
      t === 'kilograms'
    ) {
      return 'kg'
    }
    if (t === 'lb' || t === 'lbs' || t === 'pound' || t === 'pounds') {
      return 'lb'
    }
  }
  return fallback
}

type NumSpan = { value: number; start: number; end: number }

function pickWeightReps(
  spans: NumSpan[],
  tokens: string[],
): { weightSpan: NumSpan; repsSpan: NumSpan; confidenceBoost: number } | null {
  if (spans.length === 0) return null

  if (spans.length === 1) {
    return {
      weightSpan: spans[0],
      repsSpan: { value: 0, start: spans[0].end, end: spans[0].end },
      confidenceBoost: -0.25,
    }
  }

  for (let s = 1; s < spans.length; s++) {
    const between = tokens.slice(spans[s - 1].end, spans[s].start)
    if (between.some((t) => CONNECTORS.has(t))) {
      return {
        weightSpan: spans[s - 1],
        repsSpan: spans[s],
        confidenceBoost: 0.1,
      }
    }
  }

  for (let s = 1; s < spans.length; s++) {
    const after = tokens[spans[s].end]
    if (after && REP_WORDS.has(after)) {
      return {
        weightSpan: spans[s - 1],
        repsSpan: spans[s],
        confidenceBoost: 0.1,
      }
    }
  }

  if (spans.length >= 3) {
    const a = spans[spans.length - 3]
    const mid = spans[spans.length - 2]
    const b = spans[spans.length - 1]
    const midTok = tokens[mid.start]
    const midIsFourish =
      mid.value >= 1 &&
      mid.value <= 9 &&
      (midTok === 'four' ||
        midTok === 'fore' ||
        midTok === 'for' ||
        mid.value === 4)
    if (
      midIsFourish &&
      a.value >= 15 &&
      b.value >= 1 &&
      b.value <= 50 &&
      a.value > b.value
    ) {
      return { weightSpan: a, repsSpan: b, confidenceBoost: 0.05 }
    }
  }

  const w = spans[spans.length - 2]
  const r = spans[spans.length - 1]

  if (w.value >= 15 && r.value >= 1 && r.value <= 50) {
    return { weightSpan: w, repsSpan: r, confidenceBoost: 0.05 }
  }
  if (r.value >= 15 && w.value >= 1 && w.value <= 50 && r.value > w.value) {
    return { weightSpan: r, repsSpan: w, confidenceBoost: 0 }
  }

  return { weightSpan: w, repsSpan: r, confidenceBoost: 0 }
}


/**
 * Pull set-count phrases out of the token stream so they don't confuse weight/reps.
 * Supports: "3 sets of 15", "sets of 15" (reps only), "for 15 for 3 sets", "3 sets".
 */
function setCountAliasValue(tok: string): number | null {
  const t = tok.toLowerCase()
  // Whisper / Southern: word immediately before "sets" should be a number
  if (t === 'for' || t === 'fore' || t === 'sex' || t === 'a') return 4
  if (t === 'free' || t === 'tree') return 3
  if (t === 'to' || t === 'too') return 2
  return null
}

function extractSetCount(tokens: string[]): {
  tokens: string[]
  setCount: number
  repsFromSetsOf: number | null
} {
  let setCount = 1
  let repsFromSetsOf: number | null = null
  const out: string[] = []
  let i = 0
  while (i < tokens.length) {
    // N sets of M  → setCount=N, reps=M
    if (i + 3 < tokens.length) {
      const n = parseNumberAt(tokens, i)
      if (
        n &&
        tokens[n.next] === 'sets' &&
        tokens[n.next + 1] === 'of'
      ) {
        const m = parseNumberAt(tokens, n.next + 2)
        if (m && n.value >= 1 && n.value <= 30 && m.value >= 1 && m.value <= 100) {
          setCount = Math.round(n.value)
          repsFromSetsOf = Math.round(m.value)
          i = m.next
          continue
        }
      }
      // singular "set of M" with leading N already handled; also "N set of M"
      if (
        n &&
        tokens[n.next] === 'set' &&
        tokens[n.next + 1] === 'of'
      ) {
        const m = parseNumberAt(tokens, n.next + 2)
        if (m && n.value >= 1 && n.value <= 30 && m.value >= 1 && m.value <= 100) {
          setCount = Math.round(n.value)
          repsFromSetsOf = Math.round(m.value)
          i = m.next
          continue
        }
      }
    }
    // N sets / N set (trailing set count, no "of")
    if (i + 1 < tokens.length) {
      const n = parseNumberAt(tokens, i)
      if (n && (tokens[n.next] === 'sets' || tokens[n.next] === 'set')) {
        // Avoid swallowing "set" used as filler alone — require a number
        if (n.value >= 1 && n.value <= 30) {
          setCount = Math.round(n.value)
          i = n.next + 1
          continue
        }
      }
    }
    // Alias word before sets (for/fore/sex ≈ 4) when parseNumberAt missed it
    if (i + 1 < tokens.length) {
      const alias = setCountAliasValue(tokens[i])
      if (alias != null && (tokens[i + 1] === 'sets' || tokens[i + 1] === 'set')) {
        if (tokens[i + 1] === 'sets' && tokens[i + 2] === 'of') {
          const m = parseNumberAt(tokens, i + 3)
          if (m && m.value >= 1 && m.value <= 100) {
            setCount = alias
            repsFromSetsOf = Math.round(m.value)
            i = m.next
            continue
          }
        }
        setCount = alias
        i = i + 2
        continue
      }
    }
    // "sets of M" without leading count → reps only
    if (tokens[i] === 'sets' && tokens[i + 1] === 'of') {
      const m = parseNumberAt(tokens, i + 2)
      if (m && m.value >= 1 && m.value <= 100) {
        repsFromSetsOf = Math.round(m.value)
        i = m.next
        continue
      }
    }
    out.push(tokens[i])
    i += 1
  }
  return { tokens: out, setCount, repsFromSetsOf }
}


const MILE_WORDS = new Set(['mile', 'miles', 'mi'])
const FLIGHT_WORDS = new Set(['flight', 'flights'])
const CAL_WORDS = new Set([
  'calorie',
  'calories',
  'cal',
  'cals',
  'kcal',
  'kcals',
])
const MIN_WORDS = new Set([
  'minute',
  'minutes',
  'min',
  'mins',
])

const CARDIO_METRIC_WORDS = new Set([
  ...MILE_WORDS,
  ...FLIGHT_WORDS,
  ...CAL_WORDS,
  ...MIN_WORDS,
  'stair',
  'stairs',
])

type CardioMetrics = {
  miles: number | null
  flights: number | null
  calories: number | null
  minutes: number | null
  /** Token indices consumed by metric phrases (inclusive start, exclusive end). */
  consumed: Array<[number, number]>
}

/**
 * Extract "4 miles", "10 flights", "200 calories", "20 minutes" style spans.
 * Returns null when no cardio metric words are present.
 */
function extractCardioMetrics(tokens: string[]): CardioMetrics | null {
  let miles: number | null = null
  let flights: number | null = null
  let calories: number | null = null
  let minutes: number | null = null
  const consumed: Array<[number, number]> = []
  let i = 0
  let sawMetric = false
  while (i < tokens.length) {
    const num = parseNumberAt(tokens, i)
    if (num) {
      const unitTok = tokens[num.next]
      if (unitTok && MILE_WORDS.has(unitTok)) {
        miles = num.value
        consumed.push([i, num.next + 1])
        sawMetric = true
        i = num.next + 1
        continue
      }
      if (unitTok && FLIGHT_WORDS.has(unitTok)) {
        flights = Math.round(num.value)
        let end = num.next + 1
        // "10 flights of stairs" / "10 flights of stair"
        if (
          tokens[end] === 'of' &&
          (tokens[end + 1] === 'stairs' || tokens[end + 1] === 'stair')
        ) {
          end += 2
        }
        consumed.push([i, end])
        sawMetric = true
        i = end
        continue
      }
      if (unitTok && CAL_WORDS.has(unitTok)) {
        calories = Math.round(num.value)
        consumed.push([i, num.next + 1])
        sawMetric = true
        i = num.next + 1
        continue
      }
      if (unitTok && MIN_WORDS.has(unitTok)) {
        minutes = num.value
        consumed.push([i, num.next + 1])
        sawMetric = true
        i = num.next + 1
        continue
      }
    }
    // Unit-first rare forms: "miles 4" — skip; spoken order is number then unit.
    i += 1
  }
  // Cardio class: trailing bare N after minutes (Whisper dropped "calories")
  if (minutes != null && calories == null) {
    for (let j = 0; j < tokens.length; j++) {
      let taken = false
      for (const [a, b] of consumed) {
        if (j >= a && j < b) {
          taken = true
          break
        }
      }
      if (taken) continue
      const num = parseNumberAt(tokens, j)
      if (!num) continue
      const unitTok = tokens[num.next]
      if (
        unitTok &&
        (MILE_WORDS.has(unitTok) ||
          FLIGHT_WORDS.has(unitTok) ||
          CAL_WORDS.has(unitTok) ||
          MIN_WORDS.has(unitTok) ||
          UNIT_WORDS.has(unitTok) ||
          REP_WORDS.has(unitTok))
      ) {
        continue
      }
      const afterMinutes = consumed.some(([, b]) => j >= b)
      const trailing = num.next >= tokens.length
      if ((afterMinutes || trailing) && num.value >= 10 && num.value <= 9999) {
        calories = Math.round(num.value)
        consumed.push([j, num.next])
        sawMetric = true
        break
      }
    }
  }
  if (!sawMetric) return null
  return { miles, flights, calories, minutes, consumed }
}

function isTokenConsumed(idx: number, consumed: Array<[number, number]>): boolean {
  for (const [a, b] of consumed) {
    if (idx >= a && idx < b) return true
  }
  return false
}

/**
 * Parse cardio utterance: equipment + miles/calories/minutes.
 * Returns null when no cardio metrics are present.
 */
function parseCardioUtterance(
  raw: string,
  tokens: string[],
  options: ParseOptions,
): ParsedSetUtterance | null {
  const metrics = extractCardioMetrics(tokens)
  if (!metrics) return null

  const preferredUnit = options.preferredUnit ?? 'lb'
  const library = options.equipmentNames ?? []
  const aliases = options.equipmentAliases

  const EQUIP_STOP = new Set([
    'for',
    'fore',
    'by',
    'times',
    'x',
    'at',
    'and',
    'with',
    'of',
  ])
  const equipWords = tokens.filter((t, idx) => {
    if (isTokenConsumed(idx, metrics.consumed)) return false
    if (CARDIO_METRIC_WORDS.has(t)) return false
    if (UNIT_WORDS.has(t) || REP_WORDS.has(t) || EQUIP_STOP.has(t)) return false
    if (/^\d+(\.\d+)?$/.test(t)) return false
    if (ONES[t] !== undefined || TENS[t] !== undefined || t === 'hundred') return false
    if (t === 'sets' || t === 'set') return false
    return true
  })

  const equipRaw = equipWords.join(' ')
  const matched = equipRaw
    ? matchEquipment(equipRaw, library, aliases)
    : { name: '', matched: false, score: 0 }

  if (
    !matched.name &&
    metrics.miles == null &&
    metrics.flights == null &&
    metrics.calories == null &&
    metrics.minutes == null
  ) {
    return null
  }

  let confidence = 0.45
  if (matched.matched) confidence += 0.35 * matched.score
  else if (matched.name) confidence += 0.1
  const metricCount =
    (metrics.miles != null ? 1 : 0) +
    (metrics.flights != null ? 1 : 0) +
    (metrics.calories != null ? 1 : 0) +
    (metrics.minutes != null ? 1 : 0)
  confidence += 0.08 * metricCount
  if (
    /\bmiles?\b|\bmi\b|\bflights?\b|\bcal(?:ories)?\b|\bmins?\b|\bminutes?\b/i.test(
      raw,
    )
  ) {
    confidence += 0.1
  }
  confidence = Math.max(0.05, Math.min(1, confidence))

  return {
    equipmentName: matched.name,
    weight: 0,
    reps: 0,
    setCount: 1,
    unit: preferredUnit,
    miles: metrics.miles ?? undefined,
    flights: metrics.flights ?? undefined,
    calories: metrics.calories ?? undefined,
    minutes: metrics.minutes ?? undefined,
    kind: 'cardio',
    confidence,
    matchedLibrary: matched.matched,
    raw: raw.trim(),
  }
}


/**
 * Guided mode: stamp locked equipment onto a parse so Whisper machine-name
 * invents cannot rename the set. Returns null unchanged when nothing locked.
 */
function applyLockedEquipment(
  parsed: ParsedSetUtterance | null,
  options: ParseOptions,
): ParsedSetUtterance | null {
  const locked = options.lockedEquipment?.trim()
  if (!locked || !parsed) return parsed
  const kind =
    options.lockedKind === 'cardio' || options.lockedKind === 'strength'
      ? options.lockedKind
      : parsed.kind
  return {
    ...parsed,
    equipmentName: locked,
    matchedLibrary: true,
    kind: kind ?? parsed.kind,
    confidence: Math.max(parsed.confidence, 0.85),
  }
}

/**
 * Parse a spoken/typed set utterance into equipment + weight + reps.
 * Forgiving of Whisper punctuation and for→four mishears.
 * Returns null only when there is no usable equipment name AND no numbers.
 */
export function parseSetUtterance(
  raw: string,
  options: ParseOptions = {},
): ParsedSetUtterance | null {
  const preferredUnit = options.preferredUnit ?? 'lb'
  const library = options.equipmentNames ?? []
  const aliases = options.equipmentAliases
  const locked = options.lockedEquipment?.trim() || ''
  const lockedKind = options.lockedKind
  const normalized = normalizeTranscript(raw)
  if (!normalized) return null

  const rawTokens = tokenize(normalized)
  if (rawTokens.length === 0) return null

  // Cardio path: miles / flights / calories / minutes (do not force weight×reps×sets)
  // Guided strength: skip cardio so "10 flights" wording is not required — but if
  // the user locked a cardio machine, prefer cardio metrics first.
  const preferCardio =
    lockedKind === 'cardio' || lockedKind !== 'strength'
  if (preferCardio) {
    const cardio = parseCardioUtterance(raw, rawTokens, options)
    if (cardio) return applyLockedEquipment(cardio, options)
    // Guided cardio with only metric words may still fail if ASR dropped units;
    // fall through to strength only when not locked to cardio.
    if (locked && lockedKind === 'cardio') {
      // Still try strength? No — return null so UI asks to re-speak numbers.
      return null
    }
  }

  const extracted = extractSetCount(rawTokens)
  const tokens = extracted.tokens
  let setCount = extracted.setCount
  if (tokens.length === 0 && extracted.repsFromSetsOf == null) return null

  const unit = detectUnit([...rawTokens], preferredUnit)

  const spans: NumSpan[] = []
  let i = 0
  while (i < tokens.length) {
    if (
      UNIT_WORDS.has(tokens[i]) ||
      REP_WORDS.has(tokens[i]) ||
      CONNECTORS.has(tokens[i])
    ) {
      i += 1
      continue
    }
    const num = parseNumberAt(tokens, i)
    if (num) {
      spans.push({ value: num.value, start: i, end: num.next })
      i = num.next
    } else {
      i += 1
    }
  }

  if (spans.length === 0) {
    return null
  }

  const picked = pickWeightReps(spans, tokens)
  if (!picked) return null

  const weight = picked.weightSpan.value
  let reps = Math.round(picked.repsSpan.value)
  // Prefer reps from "N sets of M" / "sets of M" when present
  if (extracted.repsFromSetsOf != null) {
    reps = extracted.repsFromSetsOf
  }
  if (!(weight >= 0) || weight > 2000) return null
  if (reps < 0 || reps > 100) return null
  if (!(setCount >= 1) || setCount > 30) setCount = 1

  const equipEnd = picked.weightSpan.start
  const spanRanges = spans.map((s) => [s.start, s.end] as const)
  // Do not strip "with"/"of" from equipment names ("Cable Curl With Bar", "Clean and Jerk")
  const EQUIP_STOP = new Set(['for', 'fore', 'by', 'times', 'x', 'at'])
  const equipWords = tokens.slice(0, equipEnd).filter((t, idx) => {
    if (UNIT_WORDS.has(t) || EQUIP_STOP.has(t) || REP_WORDS.has(t)) return false
    if (/^\d+(\.\d+)?$/.test(t)) return false
    if (ONES[t] !== undefined || TENS[t] !== undefined || t === 'hundred') {
      return false
    }
    for (const [a, b] of spanRanges) {
      if (idx >= a && idx < b) return false
    }
    return true
  })

  let equipRaw = equipWords.join(' ')

  // Trailing equipment: "4 sets of 10 at 40 pounds bicep curl"
  // When little/no leading name, harvest content words after the last number span.
  if (equipWords.length < 2) {
    const lastEnd = Math.max(...spans.map((s) => s.end), equipEnd)
    const trailing = tokens.slice(lastEnd).filter((t) => {
      // Drop connectors ("and") — leftover list-chain glue; "and" is a
      // substring of catalog names like Landmine Row and must not harvest.
      if (UNIT_WORDS.has(t) || EQUIP_STOP.has(t) || REP_WORDS.has(t) || CONNECTORS.has(t)) return false
      if (/^\d+(\.\d+)?$/.test(t)) return false
      if (ONES[t] !== undefined || TENS[t] !== undefined || t === 'hundred') return false
      if (t === 'sets' || t === 'set' || t === 'of') return false
      return true
    })
    if (trailing.length > 0) {
      const trailRaw = trailing.join(' ')
      const trailMatch = matchEquipment(trailRaw, library, aliases)
      if (trailMatch.matched && trailMatch.score >= 0.45) {
        equipRaw = trailRaw
      } else if (!equipRaw) {
        equipRaw = trailRaw
      }
    }
  }

  if (!equipRaw && !(weight > 0 || reps > 0)) return null

  const matched = equipRaw
    ? matchEquipment(equipRaw, library, aliases)
    : { name: '', matched: false, score: 0 }

  let confidence = 0.4
  if (matched.matched) confidence += 0.35 * matched.score
  else if (matched.name) confidence += 0.1
  if (weight > 0 && reps > 0) confidence += 0.15
  else if (weight > 0 && reps === 0) confidence += 0.02
  if (/\d/.test(raw) || /\bfor\b|\bby\b|\btimes\b|\breps?\b|\bx\b/i.test(raw)) {
    confidence += 0.1
  }
  confidence += picked.confidenceBoost
  confidence = Math.max(0.05, Math.min(1, confidence))

  return applyLockedEquipment(
    {
      equipmentName: matched.name,
      weight,
      reps,
      setCount,
      unit,
      confidence,
      matchedLibrary: matched.matched,
      raw: raw.trim(),
    },
    options,
  )
}
