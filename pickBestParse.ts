/**
 * Dual-engine speech: Apple (Web Speech / SFSpeech) is PRIMARY.
 * Whisper is backup only when Apple is empty/failed or scores strictly worse.
 * Tie → Apple.
 */

import type { ParsedSetUtterance } from './parseSetUtterance'

export type SpeechEngine = 'apple' | 'whisper'

export type ScoredParseCandidate = {
  engine: SpeechEngine
  /** Gym-cleaned transcript used for parsing */
  transcript: string
  parsed: ParsedSetUtterance | null
}

export type BestParseResult = {
  engine: SpeechEngine
  transcript: string
  parsed: ParsedSetUtterance | null
  score: number
  /** Human-readable winner note for UI */
  engineLabel: string
  appleScore: number | null
  whisperScore: number | null
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

/**
 * Higher is better. Components (roughly):
 * - matched catalog equipment: +40
 * - non-empty equipment name: +15 (even if weak match)
 * - weight > 0: +15
 * - reps > 0: +15
 * - setCount > 1 (explicit multi-set): +5
 * - parse confidence * 20
 * - empty/null parse: 0
 */
export function scoreParsedUtterance(
  parsed: ParsedSetUtterance | null,
): number {
  if (!parsed) return 0
  let score = 0
  if (parsed.matchedLibrary && parsed.equipmentName.trim()) score += 40
  else if (parsed.equipmentName.trim()) score += 15
  const cardio =
    parsed.kind === 'cardio' ||
    (parsed.miles ?? 0) > 0 ||
    (parsed.flights ?? 0) > 0 ||
    (parsed.calories ?? 0) > 0 ||
    (parsed.minutes ?? 0) > 0
  if (cardio) {
    if ((parsed.miles ?? 0) > 0) score += 10
    if ((parsed.flights ?? 0) > 0) score += 10
    if ((parsed.calories ?? 0) > 0) score += 10
    if ((parsed.minutes ?? 0) > 0) score += 10
  } else {
    if (parsed.weight > 0) score += 15
    if (parsed.reps > 0) score += 15
    const sets = parsed.setCount >= 1 ? parsed.setCount : 1
    if (sets > 1) score += 5
  }
  score += clamp(parsed.confidence, 0, 1) * 20
  return score
}

export function engineDisplayLabel(engine: SpeechEngine): string {
  return engine === 'apple' ? 'Used Apple speech' : 'Used Whisper'
}

/**
 * True when Apple's parse is a solid catalog hit (equipment + weight + reps).
 * Callers may short-circuit Whisper when this is already true, but the default
 * path still runs both engines in parallel and picks here.
 */
export function isStrongAppleCatalogParse(
  parsed: ParsedSetUtterance | null,
): boolean {
  if (!parsed) return false
  const cardio =
    parsed.kind === 'cardio' ||
    (parsed.miles ?? 0) > 0 ||
    (parsed.flights ?? 0) > 0 ||
    (parsed.calories ?? 0) > 0 ||
    (parsed.minutes ?? 0) > 0
  const metricsOk = cardio
    ? (parsed.miles ?? 0) > 0 ||
      (parsed.flights ?? 0) > 0 ||
      (parsed.calories ?? 0) > 0 ||
      (parsed.minutes ?? 0) > 0
    : parsed.weight > 0 && parsed.reps > 0
  return (
    Boolean(parsed.matchedLibrary) &&
    Boolean(parsed.equipmentName.trim()) &&
    metricsOk &&
    parsed.confidence >= 0.55
  )
}

/**
 * Pick the best of Apple / Whisper candidates.
 *
 * Apple-primary policy:
 * - Prefer higher score.
 * - On tie, always prefer Apple (Whisper is backup only).
 * - If Apple has a catalog match and Whisper does not, prefer Apple even when
 *   Whisper's raw score is slightly higher (confidence-only edge ≤ 5).
 *
 * @param preferAppleOnTie - defaults true (Apple primary). Pass false only for tests.
 */
export function pickBestParse(
  candidates: ScoredParseCandidate[],
  options: { preferAppleOnTie?: boolean } = {},
): BestParseResult | null {
  const preferAppleOnTie = options.preferAppleOnTie ?? true
  const usable = candidates.filter((c) => c.transcript.trim().length > 0)
  if (usable.length === 0) return null

  const scored = usable.map((c) => ({
    ...c,
    score: scoreParsedUtterance(c.parsed),
  }))

  const apple = scored.find((c) => c.engine === 'apple')
  const whisper = scored.find((c) => c.engine === 'whisper')
  const appleScore = apple?.score ?? null
  const whisperScore = whisper?.score ?? null

  // Catalog-match bias: Apple with library match beats Whisper without one,
  // unless Whisper is clearly more complete (score gap > 5).
  if (
    preferAppleOnTie &&
    apple &&
    whisper &&
    apple.parsed?.matchedLibrary &&
    apple.parsed.equipmentName.trim() &&
    !(whisper.parsed?.matchedLibrary && whisper.parsed.equipmentName.trim())
  ) {
    if (apple.score + 5 >= whisper.score) {
      return {
        engine: 'apple',
        transcript: apple.transcript,
        parsed: apple.parsed,
        score: apple.score,
        engineLabel: engineDisplayLabel('apple'),
        appleScore,
        whisperScore,
      }
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (preferAppleOnTie) {
      if (a.engine === 'apple' && b.engine !== 'apple') return -1
      if (b.engine === 'apple' && a.engine !== 'apple') return 1
    } else {
      // Test / non-primary path: prefer Whisper on tie
      if (a.engine === 'whisper' && b.engine !== 'whisper') return -1
      if (b.engine === 'whisper' && a.engine !== 'whisper') return 1
    }
    return 0
  })

  const best = scored[0]
  return {
    engine: best.engine,
    transcript: best.transcript,
    parsed: best.parsed,
    score: best.score,
    engineLabel: engineDisplayLabel(best.engine),
    appleScore,
    whisperScore,
  }
}
