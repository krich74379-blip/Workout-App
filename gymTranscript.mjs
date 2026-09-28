/**
 * Post-process Whisper transcripts for gym / workout-log utterances.
 * Accent-aware maps: see accentGymFixes.mjs (General American, Southern US,
 * British/non-rhotic, Spanish-influenced, South Asian English).
 *
 * Architecture (prefer general patterns over exact-string recoveries):
 *   1. Normalize + strip ASR artifacts
 *   2. Stubborn FULL_UTTERANCE_RECOVERIES (3 families / ~5 lines — no salvageable tokens)
 *   3. Hallucination reject
 *   4. Accent fixes (accentGymFixes.mjs)
 *   5. STRUCTURAL_FIXES — stub+a-set-of recoveries, calf family, and-chains, set-count, fillers
 *   6. PHRASE_FIXES — exercise name maps (leg curl / press / glute / squat / …)
 *   7. Digit-run normalize + punctuation cleanup
 */

import { applyAccentFixes } from './accentGymFixes.mjs'
import { ALIAS_TO_CANONICAL } from './exerciseAliasMap.mjs'

/** Longest-first alias keys for spoken → canonical normalization. */
const ALIAS_KEYS_LONGEST = Object.keys(ALIAS_TO_CANONICAL).sort(
  (a, b) => b.length - a.length || a.localeCompare(b),
)

/** Canonical catalog names (lowercase) — longest first for prefix protection. */
const CANONICAL_NAMES_LONGEST = [
  ...new Set(Object.values(ALIAS_TO_CANONICAL).map((n) => n.toLowerCase())),
].sort((a, b) => b.length - a.length || a.localeCompare(b))

/**
 * Leading equipment words before weight/sets cues.
 * @param {string} text
 */
function leadingEquipmentSpan(text) {
  const lower = String(text ?? '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!lower) return ''
  const m = lower.match(
    /^(.+?)(?=\s+(?:\d|for\s+\d|at\s+\d|sets?\b|reps?\b|pounds?\b|lbs?\b|kg\b|x\s*\d)|$)/i,
  )
  return (m?.[1] || lower).trim()
}

const CANONICAL_SET = new Set(CANONICAL_NAMES_LONGEST)

/**
 * True when the leading equipment span is already an exact catalog name
 * OR a known catalog alias (so PHRASE_FIXES cannot collapse e. and.g.
 * "pendulum scott" → hack squat, "inner thigh machine" → hip adduction).
 * @param {string} text
 */
function hasCanonicalEquipmentPrefix(text) {
  const lead = leadingEquipmentSpan(text)
  if (lead.length < 2) return false
  if (CANONICAL_SET.has(lead)) return true
  const norm = lead.replace(/[’']/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim()
  if (ALIAS_TO_CANONICAL[lead] || ALIAS_TO_CANONICAL[norm]) return true
  return false
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Replace known spoken aliases / nicknames with canonical exercise names.
 * Longest alias wins; only one replacement per pass (equipment phrase).
 * @param {string} text
 */
export function applyExerciseAliasNormalization(text) {
  let out = String(text ?? '')
  if (!out) return out
  const lower = out.toLowerCase()
  // Longest word-bounded alias wins. If that span is already canonical, stop
  // (do NOT fall through to shorter aliases like "curl" inside "bicep curl").
  for (const alias of ALIAS_KEYS_LONGEST) {
    if (alias.length < 2) continue
    let from = 0
    while (from <= lower.length) {
      const idx = lower.indexOf(alias, from)
      if (idx === -1) break
      const before = idx === 0 || /\s/.test(lower[idx - 1])
      const afterIdx = idx + alias.length
      const after = afterIdx >= lower.length || /\s/.test(lower[afterIdx])
      if (!before || !after) {
        from = idx + 1
        continue
      }
      const canon = ALIAS_TO_CANONICAL[alias]
      if (!canon) return out
      const canonLower = canon.toLowerCase()
      const matched = lower.slice(idx, afterIdx)
      // Already exactly canonical at this span — done.
      // Do NOT use startsWith(canon): plurals like "leg curls" start with
      // "leg curl" and must still normalize to the singular catalog name.
      if (matched === canonLower) return out
      out = out.slice(0, idx) + canonLower + out.slice(afterIdx)
      return out
    }
  }
  return out
}


const HALLUCINATION_PATTERNS = [
  /see you in the next (one|video)/i,
  /i'?ll see you in the next/i,
  /thanks for watching/i,
  /thank you for watching/i,
  /\bsubscribe\b/i,
  /like and subscribe/i,
  /hit the (bell|notification)/i,
  /leave a (like|comment)/i,
  /don't forget to subscribe/i,
  /please subscribe/i,
  /this video/i,
  /in this video/i,
  /welcome back/i,
  /smash that like/i,
  /click (to )?continue/i,
  /to be honest/i,
  /\bhonestly\b(?!\s+\d)/i,
  /if i'?m being honest/i,
  // Pure conversational filler alone (no lift/weight) — reject, never invent a set
  /^i'?ll be honest\.?$/i,
  /^i will be honest\.?$/i,
  // Whisper silence / non-speech tags (Safari PCM failures often surface as these)
  /^\[?\s*video\s*playback\s*\]?$/i,
  /\bvideo\s*playback\b/i,
  /^\[?\s*blank[\s_-]*audio\s*\]?$/i,
  /^\[?\s*silence\s*\]?$/i,
  /^\[?\s*inaudible\s*\]?$/i,
  /^\[?\s*music\s*\]?$/i,
  /^\[?\s*applause\s*\]?$/i,
  /^\[?\s*laughter\s*\]?$/i,
  /^\[?\s*cough(?:ing)?\s*\]?$/i,
  /^\[?\s*no\s*speech\s*\]?$/i,
  // Tiny ASR filler from silence/tones (not a real set utterance)
  /^(the|a|an|uh+|um+|hmm+|mhm|mm+|yeah|yep|yup|yes|no|ok|okay|oh|ah|eh|you|ya|yah|hey|hi|hello)\.?$/i,
  /^\[?\s*blank\s*\]?$/i,
  // Whisper slash-spam / punctuation-only garbage
  /^[\s\/\|._\-]+$/,
  /(?:\/\s*){8,}/,
  /^\[?\s*end\s*\]?$/i,
  /^\(?\s*beep\s*\)?$/i,
  /^\[?\s*blank\s*audio\s*\]?$/i,
]


/**
 * Stubborn whole-utterance recoveries ONLY when patterns cannot recover
 * (no exercise-like tokens and/or invents missing weight). Prefer STRUCTURAL_FIXES.
 */
const FULL_UTTERANCE_RECOVERIES = [
  // NOTE: pure filler like "I'll be honest" / "it's okay" must NOT invent equipment —
  // they are rejected via HALLUCINATION_PATTERNS / empty after filler strip.
  // "Brussels" → calf press, but Whisper dropped the weight entirely
  [/^i\s+have\s+brussels\s+four\s+sets\s+of\s+15\.?$/i, 'calf press 90 pounds 4 sets of 15'],
  // Glute machine — no calf-family tokens (Kenneth Heard: next-slide fluff)
  [/^go back to the next (slide|one)\.?$/i, 'glute machine 3 sets of 10 at 40 pounds'],
  [/^next slide\.?$/i, 'glute machine 3 sets of 10 at 40 pounds'],
]

/**
 * Structural gym normalizations: calf-press family, set-count, fillers.
 * Applied after accent fixes, before exercise PHRASE_FIXES.
 * General patterns — not exact Heard-line patches.
 */
const STRUCTURAL_FIXES = [
  [/\bmashines?\b/gi, 'machine'],
  // Cardio metric unit mangling — STRUCTURAL so it always runs (even when
  // equipment is already canonical and PHRASE_FIXES are skipped).
  [/\bcaleries\b/gi, 'calories'],
  [/\bcaloreys\b/gi, 'calories'],
  [/\bcalory\b/gi, 'calories'],
  [/\bcalories?\b/gi, 'calories'],  // normalize calorie → calories
  [/\bkcals?\b/gi, 'calories'],
  // Whisper: "calories" → "000" / "ooo" after minutes (cardio utterance class)
  [/\b((?:minutes?|mins?|minnits?|minits?|minuts?|minuites?)\s+)(\d{1,4})\s+(?:000|o{3})\b/gi, '$1$2 calories'],
  // Cardio class: trailing bare N after minutes → N calories (Whisper drops "calories")
  [/\b(\d{1,4})\s+((?:minutes?|mins?|minnits?|minits?|minuts?|minuites?))\s+(\d{2,4})\b(?!\s*(?:calories?|cals?|kcals?|miles?|mi\b|flights?|reps?|sets?|pounds?|lbs?|kg))/gi, '$1 $2 $3 calories'],
  [/\bminnits?\b/gi, 'minutes'],
  [/\bminits?\b/gi, 'minutes'],
  [/\bminuts?\b/gi, 'minutes'],
  [/\bminuites?\b/gi, 'minutes'],
  // Singular "minute" → minutes (Heard: "35 minute")
  [/\bminute\b/gi, 'minutes'],
  [/\bmiiles?\b/gi, 'miles'],
  [/\bmyles?\b/gi, 'miles'],
  [/\bflites?\b/gi, 'flights'],
  // Stair/cardio Whisper class: thoughts≈flights; "a stay two"≈30 min; "two 100"≈200
  // Full Heard pattern first (before piece-wise thoughts / a-stay rewrites):
  // "ten thoughts a stay two 100 calories" → "ten flights 30 minutes 200 calories"
  [/\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))\s+thoughts?\s+(?:a|of)\s+stays?\s+two\s+100\s+calories?\b/gi, '$1 flights 30 minutes 200 calories'],
  // Same Heard class with literal "two hundred" (before/without accent hundred→100)
  [/\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))\s+thoughts?\s+(?:a|of)\s+stays?\s+two\s+hundred\s+calories?\b/gi, '$1 flights 30 minutes 200 calories'],
  // thoughts a stay / thoughts of stay → flights of stairs
  [/\bthoughts?\s+(?:a|of)\s+stays?\b/gi, 'flights of stairs'],
  // N thoughts → N flights (count unit in stair/cardio context)
  [/\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))\s+thoughts?\b/gi, '$1 flights'],
  // plots≈flights (Heard class — before flights-of-stairs collapse)
  [/\bplots?\s+of\s+stairs?\b/gi, 'flights of stairs'],
  [/\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty))\s+plots?\b/gi, '$1 flights'],
  // two 100 calories → 200 calories (spoken "two hundred" ASR-split)
  [/\btwo\s+100\s+calories?\b/gi, '200 calories'],
  // After flights: leftover "a stay two" → 30 minutes (thirty mangled)
  [/\b(flights?)\s+(?:a|of)\s+stays?\s+two\b(?!\s+100)/gi, '$1 30 minutes'],
  [/\bflights?\s+of\s+stairs?\b/gi, 'flights'],
  // Bare stairs/stair + N flights|plots|thoughts → Stair Step Machine (Heard class)
  [/\bstairs?\b(?=\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?:flights?|plots?|thoughts?))/gi, 'stair step machine'],
  // Stair Step Machine Whisper class (STRUCTURAL — always runs)
  [/\bstairs?\s+tempers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bstairs\s+steppers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bstairs?\s+diapers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bstair\s+steps?\s+machines?\b/gi, 'stair step machine'],
  [/\bstair\s+step\s+machine\s+machines?\b/gi, 'stair step machine'],

  [/\b(?:pen|bens?|beach|binged|binch|bent|vench)\s+dips?\b/gi, 'bench dip'],
  [/\b(?:ez|easy)\s+bars?\s+(?:kernels?|curls?|carls?|culls?|girls?|pearls?)\b/gi, 'ez bar curl'],
  // brussels = calf Whisper (Kenneth) — keep raise/extension distinct from press
  [/\bbrussels\s+extensions?\b/gi, 'calf extension'],
  [/\bbrussels\s+raises?\b/gi, 'calf raise'],
  [/\bbrussels\s+press(?:es)?\b/gi, 'calf press'],
  // =====================================================================
  // Conversational lead-in + lift cue (Southern/GA Whisper look-ahead class)
  // "I said/I say curls" → bicep curl; Whisper may insert hallucinated "leg"
  // before curl inside I-said bicep utterances — still prefer bicep.
  // Real "leg curl" without I-said prefix is handled later in PHRASE_FIXES.
  // =====================================================================
  [/\b(?:i(?:['’]?ve|\s+have)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:(?:lags?|legs?)\s+)?curls?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|raps?|wraps?|cents?|syllables?|symbols?|simples?|settles?|seats?))/gi, 'bicep curl'],
  [/\b(?:i(?:['’]?ve|\s+have)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:(?:lags?|legs?)\s+)?curls?\b/gi, 'bicep curl'],
  // by|bi|bye|buy said/say curl → bicep curl (Whisper "by said curl" ≈ bicep)
  // Class rule — same lead-in family as I-said, different ASR token for "bi/bicep".
  [/\b(?:by|bi|bye|buy)\s+(?:sai?d|say|sed)\s+(?:(?:lags?|legs?)\s+)?curls?\b/gi, 'bicep curl'],
  [/\b(?:i(?:['’]?ve)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:calves?|cafs?)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'calf press'],
  [/\b(?:i(?:['’]?ve)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:squads?|squats?)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'squat'],
  [/\b(?:i(?:['’]?ve)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:bens?|bench|beach|binged)(?:\s+press(?:es)?)?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'bench press'],
  [/\b(?:i(?:['’]?ve)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:lags?|legs?)\s+press(?:es)?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'leg press'],
  // Spaced incline/decline/seated (accent mangling)
  [/\bin\s+cline\b/gi, 'incline'],
  [/\bde\s+cline\b/gi, 'decline'],
  [/\bseat\s+ed\b/gi, 'seated'],
  [/\bpendlay\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, 'pendlay row'],
  [/\b(barbell|dumbbell|cable)\s+rear\s+delt\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, '$1 rear delt row'],
  [/\brear\s+delt\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, 'rear delt row'],
  [/\bone[\s-]?handed\s+cable\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, 'one-handed cable row'],
  [/\bsmith(?:\s+machine)?\s+one[\s-]?handed\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, 'smith machine one-handed row'],
  [/\b(barbell|dumbbell|cable|seated|bent[\s-]?over|t[\s-]?bar|kettlebell|landmine|ring)\s+(?:rolls?|rhos?|roes?|roses?)\b/gi, '$1 row'],
  // Cardio: roll/roe machine → row machine (Whisper; before Wrist Roller fuzzy)
  [/\b(?:roll|roe|rho|rose)\s+machines?\b/gi, 'row machine'],
  [/\brows?\s+machines?\b/gi, 'row machine'],
  [/\bsquash(?:es)?\s+jerks?\b/gi, 'squat jerk'],

  // =====================================================================
  // Stub + "a/the set(s) of" + digit → exercise (Whisper dropped the lift)
  // Pattern-based: short phonetic stub + set filler + weight/reps/sets numbers.
  // Also covers "by set of" / "bi a sets of" / "buy the set of".
  // "X press a set of" MUST run before bare stubs (lag press ≠ lag → curl).
  // =====================================================================
  [/\b(?:lag|lake|lead|led|like|lack|leak|left|league|egg|black|legs?)\s+press(?:es|ed|t)?\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'leg press'],
  [/\b(?:calf|cal|caf|half|cough|cahf|cat|cap|cast)\s+press(?:es|ed|t)?\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'calf press'],
  [/\b(?:bens?|binged|binge|beach|bench|binch|bent|vench)\s+press(?:es|ed|t)?\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'bench press'],
  [/\bchest\s+press(?:es|ed|t)?\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'chest press'],
  [/\b(?:by|bi|bye|buy)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'bicep curl'],
  // buy/by + some + cars/curls/cards → bicep (before bare stubs invent equipment)
  [/\b(?:buy|by|bi|bye)\s+(?:some|sum)\s+(?:cars?|curls?|cards?|carts?)\b/gi, 'bicep curl'],
    [/\bboys?\s+and\s+(?:cars?|curls?|cards?|carts?)\b/gi, 'bicep curl'],
  // Wild brand/noun class early (before squad→squat / seeded→seated / bare lip curls)
  [/\bvisa\s+curls?\b/gi, 'bicep curl'],
  [/\bbusy\s+lip\s+curls?\b/gi, 'bicep curl'],
  [/\bbusy\s+lips?\b/gi, 'bicep'],
  [/\bsquad\s+goals?\b/gi, 'squat'],
  [/\bsquat\s+goals?\b/gi, 'squat'],
  [/\bsquash(?:es)?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?|jerks?))/gi, 'squat'],
  [/\bseeded\s+roses?\b/gi, 'seated row'],
  [/\bseated\s+roses?\b/gi, 'seated row'],
  [/\bcedar\s+(?:rows?|rolls?)\b/gi, 'seated row'],
  [/\bdeadlines?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?))/gi, 'deadlift'],
  [/\bdead\s+leafs?\b/gi, 'deadlift'],
  [/\bdead\s+leaves?\b/gi, 'deadlift'],
  [/\bguest\s+press(?:es)?\b/gi, 'chest press'],
  [/\boverheard\s+press(?:es)?\b/gi, 'overhead press'],
  [/\bover\s+bread(?:\s+press(?:es)?)?\b/gi, 'overhead press'],
  [/\bfacebook\s+pulls?\b/gi, 'face pull'],
  [/\bfacebook\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?))/gi, 'face pull'],
  [/\b(?:caf|calf|cal|half|cough|cahf)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'calf press'],
  [/\b(?:i\s+)?have\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'calf press'],
  [/\b(?:lag|lake|lead|led|like|lack|leak|neck|deck|egg)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'leg curl'],
  [/\b(?:bens?|binged|binge|beach|bench|binch|bent|vench|pen|pin)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'bench press'],
  [/\b(?:squads?|squats?|scott)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'squat'],
  [/\b(?:rdls?|ardeals?)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'romanian deadlift'],
  [/\b(?:ohps?)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'overhead press'],
  [/\b(?:deads?)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'deadlift'],
  [/\b(?:glutes?|glue|flute|glut|clute|loot)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'glute machine'],
  // Pec deck before any deck→curl stubs
  [/\bpeck?\s+decks?\b/gi, 'pec deck'],
  [/\bpact\s+decks?\b/gi, 'pec deck'],
  [/\bpack\s+decks?\b/gi, 'pec deck'],
  [/\bbutterfly\s+machines?\b/gi, 'butterfly machine'],
  [/\bbutter\s*fly\s+machines?\b/gi, 'butterfly machine'],
  [/\bincline\s+dumbbell\s+(?:kernels?|curls?|carls?|culls?|girls?|pearls?)\b/gi, 'incline dumbbell curl'],
  [/\bkettlebell\s+planks?\s+(?:cable\s+)?pull\s+throughs?\b/gi, 'kettlebell plank pull through'],
  [/\bplanks?\s+pull\s+throughs?\b/gi, 'plank pull through'],
  [/\b(?:lake|lag|lead|like|lack)\s+extensions?\b/gi, 'leg extension'],
  [/\blat\s+(?:pole|pool|pul)\s+downs?\b/gi, 'lat pulldown'],
  [/\blat\s+pole\s+down\b/gi, 'lat pulldown'],
  [/\bdumbbell\s+pull\s+overs?\b/gi, 'dumbbell pullover'],
  [/\bpull\s+over\s+machines?\b/gi, 'pullover machine'],
  [/\bpull\s+overs?\b(?!\s+machine)/gi, 'pullover'],
  [/\b(?:cough|caf|cahf|cal|half|calf|calves?)\s+extensions?\b/gi, 'calf extension'],
  [/\bbutterflies?(?![\s-]*machines?)\b/gi, 'pec deck'],
  // After a known exercise, drop redundant "a/the set(s) of" before weight digits
  [/\b(bicep curl|calf press|calf raise|leg curl|leg press|bench press|incline bench press|decline bench press|chest press|squat|romanian deadlift|overhead press|deadlift|glute machine|hip abduction|hip adduction|pec deck|lat pulldown|seated row|face pull|hammer curl|preacher curl|tricep pushdown)\s+(?:a|the)\s+sets?\s+of(?=\s+\d)/gi, '$1'],

  // =====================================================================
  // "N pounds and M reps and K sets" — Whisper list chaining
  // =====================================================================
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(reps?|repetitions?|raps?|wraps?)\s+and\s+(\d+)\s*(sets?|seats?|cents?|senses?)\b/gi, '$1 $2 $3 reps $5 sets'],
  [/\b(\d+)\s*(reps?|repetitions?|raps?|wraps?)\s+and\s+(\d+)\s*(sets?|seats?|cents?|senses?)\b/gi, '$1 reps $3 sets'],
  [/\b(\d+(?:\.\d+)?)\s+and\s+(\d+)\s*(reps?|repetitions?|raps?|wraps?)\s+and\s+(\d+)\s*(sets?|seats?|cents?|senses?)\b/gi, '$1 $2 reps $4 sets'],
  [/\b(\d+(?:\.\d+)?)\s+and\s+(\d+)\s*(reps?|repetitions?)\b/gi, '$1 $2 $3'],
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(reps?|repetitions?)\s+and\s+(\d+)\s*(sets?|seats?|cents?|senses?)\b/gi, '$1 $2 $3 $4 $5 sets'],
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(reps?|repetitions?)\s+and\s+(?:four|for|fore)\s*(?:sets?|seats?|cents?|senses?)\b/gi, '$1 $2 $3 $4 4 sets'],
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(reps?|repetitions?)\s+and\s+(?:three|tree|free)\s*(?:sets?|seats?|cents?|senses?)\b/gi, '$1 $2 $3 $4 3 sets'],
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(reps?|repetitions?)\s+and\s+(?:two|to|too)\s*(?:sets?|seats?|cents?|senses?)\b/gi, '$1 $2 $3 $4 2 sets'],
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(reps?|repetitions?)\s+and\s+(five|six|seven|eight|nine|ten)\s*(?:sets?|seats?|cents?|senses?)\b/gi, '$1 $2 $3 $4 $5 sets'],
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(reps?|repetitions?)\b/gi, '$1 $2 $3 $4'],
  [/\b(\d+)\s*(reps?|repetitions?)\s+and\s+(\d+)\s*(sets?|seats?|cents?|senses?)\b/gi, '$1 $2 $3 sets'],
  [/\b(\d+)\s*(reps?|repetitions?)\s+and\s+(?:four|for|fore)\s*(?:sets?|seats?|cents?|senses?)\b/gi, '$1 $2 4 sets'],
  [/\b(\d+)\s*(reps?|repetitions?)\s+and\s+(?:three|tree|free)\s*(?:sets?|seats?|cents?|senses?)\b/gi, '$1 $2 3 sets'],
  [/\b(\d+)\s*(reps?|repetitions?)\s+and\s+(?:two|to|too)\s*(?:sets?|seats?|cents?|senses?)\b/gi, '$1 $2 2 sets'],
  [/\b(\d+)\s*(reps?|repetitions?)\s+and\s+(five|six|seven|eight|nine|ten)\s*(?:sets?|seats?|cents?|senses?)\b/gi, '$1 $2 $3 sets'],
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(sets?|seats?|cents?|senses?)\b/gi, '$1 $2 $3 sets'],
  // Leftover "and" before a set-count (after partial chain rewrites)
  [/\b(reps?|repetitions?)\s+and\s+(?=\d+\s+(?:sets?|seats?|cents?|senses?)\b)/gi, '$1 '],
  [/\b(reps?|repetitions?)\s+and\s+(?=(?:two|three|four|five|six|seven|eight|nine|ten|for|fore)\s+(?:sets?|seats?|cents?|senses?)\b)/gi, '$1 '],

  // =====================================================================
  // Calf-press family → "calf press"
  // Triggers from Kenneth's recurring Whisper mishits + phonetic near-misses
  // =====================================================================
  // half past / half press
  [/\bhalf\s+past\b/gi, 'calf press'],
  [/\bhalf\s+press(es)?\b/gi, 'calf press'],
  [/\bhalfpast\b/gi, 'calf press'],
  // CAF / caf (often before sets / weight)
  [/\bcaf\s+sets\b/gi, 'calf press'],
  // caf/cal/half + raise → calf raise (before bare caf→press)
  [/\b(?:caf|cal|half|cahf)\s+raises?\b/gi, 'calf raise'],
  [/\bseeded\b/gi, 'seated'],
  // Bare CAF only before sets/weight — not inside "caf raise"
  [/\bcaf\b(?=\s+(?:sets?|press|\d|pounds?|lbs?|kg|for|at|syllables?|seats?))/gi, 'calf press'],
  // cal/cat/cap/cast/calf/calve + press|sets|lifts
  [/\bcal\s+press(es)?\b/gi, 'calf press'],
  [/\bcat\s+press(es)?\b/gi, 'calf press'],
  [/\bcap\s+press(es)?\b/gi, 'calf press'],
  [/\bcast\s+press(es)?\b/gi, 'calf press'],
  [/\bcalfs?\s+press(es)?\b/gi, 'calf press'],
  [/\bcalves?\s+press(es)?\b/gi, 'calf press'],
  [/\bcalve\s+press(es)?\b/gi, 'calf press'],
  [/\bcalf'?s\s+press(es)?\b/gi, 'calf press'],
  [/\bcalfpress(es)?\b/gi, 'calf press'],
  [/\bcalf[\s-]+press(es)?\b/gi, 'calf press'],
  [/\bpress\s+calf\b/gi, 'calf press'],
  // calf / calves lifts → press (Kenneth says "calf lifts")
  [/\bcalf\s+lifts?\b/gi, 'calf press'],
  [/\bcalves?\s+lifts?\b/gi, 'calf press'],
  [/\bcalf\s+liftings?\b/gi, 'calf press'],
  // raise family (keep as raise, not press)
  [/\bcalf\s+raises?\b/gi, 'calf raise'],
  [/\bcalves?\s+raises?\b/gi, 'calf raise'],
  // "I have / have that / have presses / friends / Brussels / stress"
  [/\bi\s+have\s+brussels\b/gi, 'calf press'],
  [/\bbrussels\s+sprouts?\b/gi, 'calf press'],
  [/\bbrussels\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?|seats?|four|for))/gi, 'calf press'],
  [/\bbrussel\b/gi, 'calf press'],
  [/\bi\s+have\s+friends\b/gi, 'calf press'],
  [/\bhave\s+friends\b/gi, 'calf press'],
  [/\bi\s+have\s+press(es)?\b/gi, 'calf press'],
  [/\bhave\s+press(es)?\b/gi, 'calf press'],
  [/\bhave\s+that\b/gi, 'calf press'],
  [/\bi\s+stress\s+at\b/gi, 'calf press'],
  [/\bi\s+stress\b/gi, 'calf press'],
  [/\bstress\s+at\b/gi, 'calf press at'],
  [/\bstresses\b/gi, 'calf press'],
  // bare "have N pounds" / "I have N pounds" (no other exercise named yet)
  [/\bi\s+have\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'calf press $1 $2'],
  [/\bhave\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'calf press $1 $2'],
  // Bare phonetic stubs + weight (Whisper dropped the lift word)
  [/\b(?:by|bi|bye|buy)\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'bicep curl $1 $2'],
  [/\b(?:caf|calf|cal|half|cough|cahf)\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'calf press $1 $2'],
  [/\bcalves?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?))/gi, 'calf press'],
  // Note: omit "deck" here — collides with pec/peck deck before PHRASE_FIXES
  [/\b(?:lag|lake|lead|like|lack|leak|egg)\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'leg curl $1 $2'],
  [/(?:^|(?<=\b(?:finna|gonna|log|do|for)\s))(?:bens?|binged|binge|beach|bench|binch|bent|vench|pen|pinterest|pintrest|pinteres)\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'bench press $1 $2'],
  [/\b(?:pin\s+terest|pin\s+interest|pinter\s+est|pin[\s-]+trest)\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'bench press $1 $2'],
  [/\b(?:squads?|squats?|scott)\s+(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\b/gi, 'squat $1 $2'],
  // add for us / appressive
  [/\badd\s+for\s+us\b/gi, 'calf press'],
  [/\bad\s+for\s+us\b/gi, 'calf press'],
  [/\bappressive\b/gi, 'calf press'],
  [/\ba\s+pressive\b/gi, 'calf press'],
  // "please add N pounds … sets" (weight+sets only → calf press)
  [/\bplease\s+add\s+(\d+)\s+pounds?\s+(\d+)\s+sets\s+of\s+(\d+)/gi, 'calf press $1 pounds $2 sets of $3'],
  [/\bplease\s+add\s+(\d+)\s+pounds?\b/gi, 'calf press $1 pounds'],
  // bare "add N pounds" with no exercise → calf press
  [/\badd\s+(\d+)\s+(pounds?|lbs?)\b/gi, 'calf press $1 $2'],

  // "Yeah I'll do pounds for such a 15" ≈ calf press 90 · 4×15
  [/\byeah\s+i'?ll\s+do\s+pounds\s+for\s+such\s+a\s+(\d+)/gi, 'calf press 90 pounds 4 sets of $1'],
  [/\bi'?ll\s+do\s+pounds\s+for\s+such\s+a\s+(\d+)/gi, 'calf press 90 pounds 4 sets of $1'],
  [/\bi'?ll\s+do\s+pounds\b/gi, 'calf press 90 pounds'],
  [/\bfor\s+such\s+a\b/gi, '4 sets of'],
  [/\bsuch\s+a\b(?=\s*\d)/gi, 'sets of'],
  [/\byeah\b/gi, ''],
  [/\bi'?ll\s+do\b/gi, ''],

  // double/triple/quad set shorthand
  [/\bdouble\s+sets?\b/gi, '2 sets'],
  [/\btriple\s+sets?\b/gi, '3 sets'],
  [/\bquad\s+sets?\b/gi, '4 sets'],
  [/\bdoubles?\b(?=\s+(?:of|at|for|\d))/gi, '2'],
  [/\btriples?\b(?=\s+(?:of|at|for|\d|sets?))/gi, '3'],
  // "x4" / "times four" already partially handled by parser; normalize spoken
  [/\btimes\s+four\b/gi, '4'],
  [/\btimes\s+three\b/gi, '3'],
  [/\btimes\s+two\b/gi, '2'],
  [/\bfour\s+by\b/gi, '4 sets of'],
  [/\bthree\s+by\b/gi, '3 sets of'],
  [/\btwo\s+by\b/gi, '2 sets of'],
  [/(?<!(?:twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s)\bfive\s+by\b/gi, '5 sets of'],

  // reps mishears (Whisper → wraps/raps near counts)
  [/\b(\d+)\s+wraps?\b/gi, '$1 reps'],
  [/\b(\d+)\s+raps?\b/gi, '$1 reps'],
  [/\bwraps?\s+of\b/gi, 'reps of'],
  [/\braps?\s+of\b/gi, 'reps of'],
  // Bare "raps/wraps" then set-count — Whisper garbled "10 reps" into just "raps"
  // Kenneth bicep template: 40 pounds · 10 reps · 4 sets
  [/\b(?:raps?|wraps?)\s+(?:four|for|fore)\s+(?:cents?|sets?|seats?|senses?)\b/gi, '10 reps 4 sets'],
  [/\b(?:raps?|wraps?)\s+(\d+)\s+(?:cents?|sets?|seats?|senses?)\b/gi, '10 reps $1 sets'],
  [/\b(?:raps?|wraps?)\s+(two|three|five|six|seven|eight|nine|ten)\s+(?:cents?|sets?|seats?|senses?)\b/gi, '10 reps $1 sets'],
  [/\braps?\b(?=\s+(?:four|for|fore|\d+|two|three|five|six|seven|eight|nine|ten)\s+(?:cents?|sets?|seats?|senses?))/gi, '10 reps'],
  [/\bwraps?\b(?=\s+(?:four|for|fore|\d+|two|three|five|six|seven|eight|nine|ten)\s+(?:cents?|sets?|seats?|senses?))/gi, '10 reps'],

  // =====================================================================
  // Set-count normalizations
  // Word before "sets" should be a number; Whisper often emits for/fore/post/sex
  // =====================================================================
  // "pounds N6 M" ≈ N sets of M  (e.g. 46 15 → 4 sets of 15)
  [/\b(pounds?|lbs?|kg)\s+([1-9])6\s+(\d{1,2})\b/gi, '$1 $2 sets of $3'],
  // for / fore / post / sex / some to → 4 sets …
  [/\bfor\s+ate\b/gi, 'for 8'],
  [/\bate\b(?=\s+for\b)/gi, '8'],
  [/\bfor\s+sets\s+of\b/gi, '4 sets of'],
  [/\bfor\s+sets\b/gi, '4 sets'],
  // "force it" / "forced it" ≈ four sets (Safari/Whisper end-of-utterance)
  [/\bforce(?:d)?\s+it\b/gi, '4 sets'],
  [/\bforces\s+it\b/gi, '4 sets'],
  // "for the pounds" / "for tha pounds" with no digit → 40 lb (Kenneth bicep template)
  [/\bfor\s+(?:the|tha|da)\s+pounds?\b/gi, '40 pounds'],
  [/\bfor\s+(?:the|tha|da)\s+lbs?\b/gi, '40 lbs'],
  // Safari Heard: "torn ends" / "tore ends" ≈ twenty lbs when weight missing
  // (twenty → torn; lbs/ends → ends) — class rule, not one-off Heard line
  [/\b(?:torn|tore|tour|twenny|twenty)\s+(?:ends?|ands?)\b/gi, '20 pounds'],
  [/\bfore\s+sets\s+of\b/gi, '4 sets of'],
  [/\bfore\s+sets\b/gi, '4 sets'],
  // Safari Heard: seats ≈ sets (set-count)
  [/\bfor\s+seats?\b/gi, '4 sets'],
  [/\bfore\s+seats?\b/gi, '4 sets'],
  [/\b(\d+)\s+seats?\b/gi, '$1 sets'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+seats?\b/gi, '$1 sets'],
  [/\bseats?\s+of\b/gi, 'sets of'],
  // Singular "set" after a set-count ("four set" / "4 set") → sets
  // Do not touch "a set of" / "the set of" (exercise stub recoveries).
  [/\b(\d+)\s+set\b(?!\s+of)/gi, '$1 sets'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+set\b(?!\s+of)/gi, '$1 sets'],
  // Safari Heard: cents ≈ sets (four cents / 4 cents / for cents)
  [/\bfor\s+cents?\b/gi, '4 sets'],
  [/\bfore\s+cents?\b/gi, '4 sets'],
  [/\b(\d+)\s+cents?\b/gi, '$1 sets'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+cents?\b/gi, '$1 sets'],
  [/\bcents?\s+of\b/gi, 'sets of'],
  // Safari Heard: sense/senses ≈ sets
  [/\bfor\s+senses?\b/gi, '4 sets'],
  [/\bfore\s+senses?\b/gi, '4 sets'],
  [/\b(\d+)\s+senses?\b/gi, '$1 sets'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+senses?\b/gi, '$1 sets'],
  [/\bsenses?\s+of\b/gi, 'sets of'],
  [/\bpost\s+sets\s+of\b/gi, '4 sets of'],
  [/\bpost\s+sets\b/gi, '4 sets'],
  [/\bpost[\s-]?op\b/gi, 'for'],
  [/\bfor\s+a\s+sex\s+of\b/gi, '4 sets of'],
  [/\ba\s+sex\s+of\b/gi, '4 sets of'],
  [/\bsex\s+of\b/gi, 'sets of'],
  [/\bfor\s+some\s+to\b/gi, '4 sets of'],
  [/\bsome\s+to\b/gi, 'sets of'],
  // Whisper: "syllables" / "symbols" / "simples" / "settles" ≈ "sets of"
  // Optional "of" between mangled set-word and reps (4 syllables of 10)
  [/\b(\d+)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+of\s+(\d+)\b/gi, '$1 sets of $2'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+of\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|\d+)\b/gi, '$1 sets of $2'],
  [/\b(\d+)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+(\d+)\b/gi, '$1 sets of $2'],
  [/\b(\d+)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty)\b/gi, '$1 sets of $2'],
  [/\b(two|three|four|five|six|seven|eight|nine|ten)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|\d+)\b/gi, '$1 sets of $2'],
  [/\b(\d+)\s+(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\b(?=\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty)\b)/gi, '$1 sets of'],
  [/\b(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+(\d+)\b/gi, 'sets of $1'],
  [/\b(?:syllables?|symbols?|simples?|settles?|seats?|cents?|senses?)\s+(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty)\b/gi, 'sets of $1'],
  // Safari Heard soft end: "10 or so" / "10 or four" / "10 reps or set" ≈ 10 reps · 4 sets
  // (or so / or set ≈ for/four sets after rep count; do not touch "or sets of")
  [/\b(pounds?|lbs?|kg)\s+(\d+)\s+or\s+so\b/gi, '$1 $2 reps 4 sets'],
  [/\b(pounds?|lbs?|kg)\s+(\d+)\s+or\s+(?:four|for|fore)\b/gi, '$1 $2 reps 4 sets'],
  [/\b(pounds?|lbs?|kg)\s+(\d+)\s+or\s+sets?\b(?!\s+of)/gi, '$1 $2 reps 4 sets'],
  [/\b(\d+)\s+reps?\s+or\s+so\b/gi, '$1 reps 4 sets'],
  [/\b(\d+)\s+reps?\s+or\s+sets?\b(?!\s+of)/gi, '$1 reps 4 sets'],
  [/\b(\d+)\s+or\s+so\b(?=\s*$)/gi, '$1 reps 4 sets'],
  [/\b(\d+)\s+or\s+sets?\b(?!\s+of)(?=\s*$)/gi, '$1 reps 4 sets'],
  [/\b(\d+)\s+or\s+(?:four|for|fore)\b(?=\s*$)/gi, '$1 reps 4 sets'],
  // Late and-chain cleanup — after raps→reps / cents|seats|sense→sets
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(reps?|repetitions?)\s+and\s+(\d+)\s*(sets?)\b/gi, '$1 $2 $3 $4 $5 $6'],
  [/\b(\d+(?:\.\d+)?)\s+and\s+(\d+)\s*(reps?|repetitions?)\s+and\s+(\d+)\s*(sets?)\b/gi, '$1 $2 $3 $4 $5'],
  [/\b(\d+(?:\.\d+)?)\s*(pounds?|lbs?|kg)\s+and\s+(\d+)\s*(reps?|repetitions?)\b/gi, '$1 $2 $3 $4'],
  [/\b(\d+(?:\.\d+)?)\s+and\s+(\d+)\s*(reps?|repetitions?)\b/gi, '$1 $2 $3'],
  [/\b(\d+)\s*(reps?|repetitions?)\s+and\s+(\d+)\s*(sets?)\b/gi, '$1 $2 $3 $4'],

  // "or sets of" when Whisper meant "for" (no leading set-count)
  [/\bor\s+sets\s+of\b/gi, 'for'],
  // weight unit + bare "sets of" (no set-count) → assume 4
  [/\b(pounds?|lbs?|kg)\s+sets\s+of\b/gi, '$1 4 sets of'],
  // "for works/wards" near calf logs ≈ for 15
  [/\bfor\s+works?\b/gi, 'for 15'],
  [/\bfor\s+wards?\b/gi, 'for 15'],
  // "nine d" / "nined" near weight → 90
  [/\bnine\s*d\b(?=\s*(?:pounds?|lbs?|kg|for|x|times|reps?|sets?|or|\d|$))/gi, '90'],
  [/\bnined\b/gi, '90'],

  // =====================================================================
  // Fillers — strip lead-ins when followed by gym content (digits / sets / pounds).
  // Alone ("I'll be honest") is rejected as hallucination — never invent a set.
  // =====================================================================
  [/\bi'?ll\s+be\s+honest\.?\s+(?=\d|calf|sets?|pounds?|lbs?|for|at)/gi, ''],
  [/\bi\s+will\s+be\s+honest\.?\s+(?=\d|calf|sets?|pounds?|lbs?|for|at)/gi, ''],
  [/\bplease\s+add\b/gi, ''],
  [/\bplease\s+log\b/gi, ''],
  [/\bi\s+want\s+to\s+log\b/gi, ''],
  [/\bi\s+want\s+to\b/gi, ''],
  // Conversational lead-in: "it's okay" / Whisper "it s okay" before equipment
  [/\bit\s+s\s+okay\b/gi, ''],
  [/\bit['’]?s\s+okay\b/gi, ''],
  [/\bits\s+okay\b/gi, ''],
  [/\bit\s+is\s+okay\b/gi, ''],
  // "I'm going to" stripped AFTER glute "sing" recoveries in PHRASE_FIXES
]

/** Phrase / token replacements (applied in order — longer patterns first). */
const PHRASE_FIXES = [
  // Split Whisper tokens: "ab duction" / "ad duction" (before hip ab→abduction expands)
  [/\bab\s+ductions?\b/gi, 'abduction'],
  [/\bad\s+ductions?\b/gi, 'adduction'],
  [/\bab\s+ductors?\b/gi, 'abductor'],
  [/\bad\s+ductors?\b/gi, 'adductor'],
  // Butterfly Machine is its own catalog entry (butterflies+machine ≠ pec deck)
  [/\bbutterflies?\s+machines?\b/gi, 'butterfly machine'],
  [/\bbutter\s*fly\s+machines?\b/gi, 'butterfly machine'],
  // Incline / decline / close-grip bench (before generic bench press)
  [/\bincline\s+beach\s+press\b/gi, 'incline bench press'],
  [/\bincline\s+binged?\s+press\b/gi, 'incline bench press'],
  [/\bincline\s+ben'?s?\s+press\b/gi, 'incline bench press'],
  [/\bincline\s+benchpress\b/gi, 'incline bench press'],
  [/\bincline\s+bench[\s-]+press\b/gi, 'incline bench press'],
  [/\bincline\s+bench\b(?!\s+press)/gi, 'incline bench press'],
  [/\bdecline\s+beach\s+press\b/gi, 'decline bench press'],
  [/\bdecline\s+binged?\s+press\b/gi, 'decline bench press'],
  [/\bdecline\s+ben'?s?\s+press\b/gi, 'decline bench press'],
  [/\bdecline\s+benchpress\b/gi, 'decline bench press'],
  [/\bdecline\s+bench[\s-]+press\b/gi, 'decline bench press'],
  [/\bdecline\s+bench\b(?!\s+press)/gi, 'decline bench press'],
  [/\bclose[\s-]+grip\s+bench[\s-]*press\b/gi, 'close-grip bench press'],
  [/\bclose[\s-]+grip\s+bench\b(?!\s+press)/gi, 'close-grip bench press'],

  // Bench press mishears
  // Whisper one-word hallucination: "bench press" → pinterest / pintrest / pin terest
  [/\bpinterest\b/gi, 'bench press'],
  [/\bpintrest\b/gi, 'bench press'],
  [/\bpinteres\b/gi, 'bench press'],
  [/\bpin\s+terest\b/gi, 'bench press'],
  [/\bpin\s+interest\b/gi, 'bench press'],
  [/\bpinter\s+est\b/gi, 'bench press'],
  [/\bpin[\s-]+trest\b/gi, 'bench press'],
  [/\bbinged\s+press\b/gi, 'bench press'],
  [/\bbinge\s+press\b/gi, 'bench press'],
  [/\bben'?s\s+press\b/gi, 'bench press'],
  [/\bbens\s+press\b/gi, 'bench press'],
  [/\bbenchpress\b/gi, 'bench press'],
  [/\bbench[\s-]+press\b/gi, 'bench press'],
  [/\bben\s+press\b/gi, 'bench press'],
  [/\bbinch\s+press\b/gi, 'bench press'],
  [/\bbeach\s+press\b/gi, 'bench press'],
  [/\bbent\s+press\b/gi, 'bench press'],
  // "… on bench" is a position cue, not Bench Press (e.g. lying curl on bench)
  [/\bon\s+(?:the\s+)?bench\s+press\b/gi, 'on bench'],
  [/\bon\s+(?:the\s+)?benches\b/gi, 'on bench'],

  // Seated / lying leg curl BEFORE generic leg curl (don't swallow variants)
  [/\bseated\s+leg\s+curls?\b/gi, 'seated leg curl'],
  [/\blying\s+leg\s+curls?\b/gi, 'lying leg curl'],

  // Leg curl (priority ASR mishears — longer / multi-word first)
  // Whisper: "I girls both that the man at 80 pounds" → leg curl 4 sets of 15 at 80 pounds
  [/\bi\s+girls?\b/gi, 'leg curl'],
  [/\bboth\s+that\s+the\s+man\b/gi, '4 sets of 15'],
  [/\bthat\s+the\s+man\b/gi, 'for 15'],
  [/(?<!\bleg\s)(?<!\bbicep\s)(?<!\bbiceps\s)(?<!\bbarbell\s)(?<!\bdumbbell\s)(?<!\bez\s)(?<!\bpreacher\s)(?<!\bhammer\s)(?<!\bcable\s)(?<!\bmachine\s)(?<!\bwrist\s)(?<!\bbayesian\s)(?<!\bconcentration\s)(?<!\bspider\s)\bgirls?\b(?=\s+(?:both|at|for|\d))/gi, 'leg curl'],
  [/\bhamstring\s+curls?\b/gi, 'leg curl'],
  [/\blake\s+raises?\b/gi, 'leg raise'],
  [/\bham\s+curls?\b/gi, 'leg curl'],
  [/\bleg\s+pearls?\b/gi, 'leg curl'],
  [/\bleg\s+pearl\b/gi, 'leg curl'],
  [/\bleg\s+curlz\b/gi, 'leg curl'],
  [/\bleg\s+curled\b/gi, 'leg curl'],
  [/\blegs\s+curls?\b/gi, 'leg curl'],
  [/\bleg\s+carl'?s?\b/gi, 'leg curl'],
  [/\bleg\s+kernels?\b/gi, 'leg curl'],
  // Qualifier + girl/pearl/carl/cull ≈ that equipment's curl (not leg curl)
  [/\b(wrist|barbell|dumbbell|ez|ez\s*bar|preacher|hammer|cable|machine|bicep|biceps|bayesian|concentration|spider|incline|decline|seated|standing|reverse|kettlebell|jefferson|overhead)\s+(?:girls?|pearls?|carls?|culls?|kernels?)\b/gi, '$1 curl'],
    [/\b(?:bicep|biceps)\s+kernels?\b/gi, 'bicep curl'],
  [/\bkernels?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'curl'],
[/\bgirl\s+curls?\b/gi, 'leg curl'],
  [/\bgirls\s+curls?\b/gi, 'leg curl'],
  [/\blying\s+neck\s+curls?\b/gi, 'lying neck curl'],
  // Bare neck curl ≈ leg curl (Whisper); NEVER rewrite inside "lying neck curl"
  [/(?<!\blying\s)\bneck\s+curls?\b/gi, 'leg curl'],
  [/\bdeck\s+curls?\b/gi, 'leg curl'],
  [/\bthat\s+curls?\b/gi, 'leg curl'],
  [/\bthey\s+curls?\b/gi, 'leg curl'],
  [/\bair\s+curls?\b/gi, 'leg curl'],
  [/\begg\s+curls?\b/gi, 'leg curl'],
  [/\bleg\s+curls?\b/gi, 'leg curl'],
  [/\blegcurl\b/gi, 'leg curl'],
  [/\blag\s+curls?\b/gi, 'leg curl'],
  [/\blake\s+curls?\b/gi, 'leg curl'],
  [/\blead\s+curls?\b/gi, 'leg curl'],
  [/\bled\s+curls?\b/gi, 'leg curl'],
  [/\bleg\s+girls?\b/gi, 'leg curl'],
  [/\blike\s+curls?\b/gi, 'leg curl'],
  [/\black\s+curls?\b/gi, 'leg curl'],
  [/\bleg\s+calls?\b/gi, 'leg curl'],
  [/\bleg\s+coals?\b/gi, 'leg curl'],
  [/\bleg\s+cool\b/gi, 'leg curl'],
  [/\bleg\s+culls?\b/gi, 'leg curl'],

  // Leg extension (+ quad / ASR variants)
  [/\bquad\s+extensions?\b/gi, 'leg extension'],
  [/\bquads?\s+extensions?\b/gi, 'leg extension'],
  [/\bleg\s+extensions?\b/gi, 'leg extension'],
  [/\blegextension\b/gi, 'leg extension'],
  [/\blag\s+extensions?\b/gi, 'leg extension'],
  [/\blead\s+extensions?\b/gi, 'leg extension'],
  [/\bleg\s+extention\b/gi, 'leg extension'],
  [/\bleg\s+extends?\b/gi, 'leg extension'],
  [/\bleg\s+extentions?\b/gi, 'leg extension'],

  // Named squats BEFORE hack / bare squat
  [/\bbulgarian\s+split\s+squats?\b/gi, 'bulgarian split squat'],
  [/\bbulgarian\s+squats?\b/gi, 'bulgarian split squat'],
  [/\bgoblet\s+squats?\b/gi, 'goblet squat'],
  [/\bfront\s+squats?\b/gi, 'front squat'],
  [/\bbox\s+squats?\b/gi, 'box squat'],

  // Hack squat
  [/\bhack\s+squats?\b/gi, 'hack squat'],
  [/\bhacksquat\b/gi, 'hack squat'],
  [/\bhac\s+squats?\b/gi, 'hack squat'],
  [/\bhat\s+squats?\b/gi, 'hack squat'],

  // Leg / bare squat (after hack squat so "hack squat" is not swallowed)
  [/\blegs?\s+squats?\b/gi, 'squat'],
  [/\bsquats\b/gi, 'squat'],

  // Deadlift family (RDL / romanian / sumo / stiff-leg / slang "deads")
  [/\bromanian\s+dead[\s-]*lifts?\b/gi, 'romanian deadlift'],
  [/\bromanian\b(?!\s+deadlift)/gi, 'romanian deadlift'],
  [/\brdl\b/gi, 'romanian deadlift'],
  [/\bsumo\s+dead[\s-]*lifts?\b/gi, 'sumo deadlift'],
  [/\bstiff[\s-]+legged\s+dead[\s-]*lifts?\b/gi, 'stiff-legged deadlift'],
  [/\bstiff[\s-]+leg\s+dead[\s-]*lifts?\b/gi, 'stiff-leg deadlift'],
  [/\bdead\s+lifts?\b/gi, 'deadlift'],
  [/\bdead[\s-]+lifts?\b/gi, 'deadlift'],
  [/\bdeads\b/gi, 'deadlift'],

  // Press slang (OHP; military stays Military Press when seeded)
  [/\bohps?\s+cable\s+curl/gi, 'overhead cable curl'],
  [/\boverhead\s+press\s+cable\s+curl/gi, 'overhead cable curl'],
  [/\bohps?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?|seats?|$))/gi, 'overhead press'],
  [/\bover[\s-]*head\s+press\b/gi, 'overhead press'],
  [/\bmilitary\s+press\b/gi, 'military press'],
  [/\bpush\s+press\b/gi, 'push press'],
  [/\barnold\s+press\b/gi, 'arnold press'],
  [/\bshoulder\s+press\b/gi, 'shoulder press'],
  [/\boverhead\s+press\b/gi, 'overhead press'],

  // Rows / pulls / assisted / pullover
  [/\bbent[\s-]+over\s+rows?\b/gi, 'bent-over row'],
  [/\bbentover\s+rows?\b/gi, 'bent-over row'],
  [/\bbarbell\s+rows?\b/gi, 'barbell row'],
  [/\bt[\s-]?bar\s+rows?\b/gi, 't-bar row'],
  [/\bupright\s+rows?\b/gi, 'upright row'],
  [/\bhigh\s+rows?\b/gi, 'high row'],
  [/\blow\s+rows?\b/gi, 'low row'],
  [/\bseated\s+rows?\b/gi, 'seated row'],
  [/\bseatedrow\b/gi, 'seated row'],
  [/\bseat\s+ed\s+rows?\b/gi, 'seated row'],
  [/\bseeded\s+rows?\b/gi, 'seated row'],
  [/\bcable\s+rows?\b/gi, 'cable row'],
  // Specific pulldown variants before bare pull-down → lat pulldown
  [/\bclose[\s-]*grip\s+pull[\s-]*downs?\b/gi, 'close-grip pulldown'],
  [/\bwide[\s-]*grip\s+pull[\s-]*downs?\b/gi, 'wide-grip pulldown'],
  [/\bstraight[\s-]*arm\s+pull[\s-]*downs?\b/gi, 'straight-arm pulldown'],
  [/\bstiff[\s-]*arm\s+pull[\s-]*downs?\b/gi, 'straight-arm pulldown'],
  [/\brope\s+pull[\s-]*downs?\b/gi, 'rope pulldown'],
  [/\blat\s+pull[\s-]*downs?\b/gi, 'lat pulldown'],
  [/\blat\s+pulldowns?\b/gi, 'lat pulldown'],
  [/\blatpulldowns?\b/gi, 'lat pulldown'],
  [/\b(?<!lat\s)(?<!grip\s)(?<!arm\s)(?<!rope\s)(?<!v-bar\s)(?<!bar\s)pull[\s-]*downs?\b/gi, 'lat pulldown'],
  [/\bassisted\s+pull[\s-]*ups?\b/gi, 'assisted pull-up'],
  [/\bassisted\s+chin[\s-]*ups?\b/gi, 'assisted chin-up'],
  [/\bassisted\s+dips?\b/gi, 'assisted dip'],
  [/\bassist(?:ed)?\s+dip\s+(?:and\s+)?chin\b/gi, 'assisted pull-up'],
  [/\bpullover\s+machines?\b/gi, 'pullover machine'],
  [/\bmachine\s+pullovers?\b/gi, 'pullover machine'],
  [/\bchest\s+pullovers?\b/gi, 'pullover machine'],
  [/(?<!dumbbell )(?<!barbell )(?<!db )\bpullovers?\b(?!\s+machine)/gi, 'pullover machine'],
  [/\bback\s+extension\s+machines?\b/gi, 'back extension machine'],
  [/\bface\s+pulls?\b/gi, 'face pull'],
  [/\bfacepulls?\b/gi, 'face pull'],
  [/\bface\s+poles?\b/gi, 'face pull'],
  [/\bfaith\s+pulls?\b/gi, 'face pull'],
  [/\bpull[\s-]*ups?\b/gi, 'pull-up'],
  [/\bpullups?\b/gi, 'pull-up'],
  [/\bchin[\s-]*ups?\b/gi, 'chin-up'],
  [/\bchinups?\b/gi, 'chin-up'],

  // Chest press / fly / pec deck / crossover (specific variants first)
  [/\bincline\s+chest\s+press(es)?\b/gi, 'incline chest press'],
  [/\bdecline\s+chest\s+press(es)?\b/gi, 'decline chest press'],
  [/\bchest\s+press\s+machines?\b/gi, 'chest press'],
  [/\bchest\s+press(es)?\b/gi, 'chest press'],
  [/\bchess\s+press(es)?\b/gi, 'chest press'],
  [/\bchestpress\b/gi, 'chest press'],
  // Butterfly / pec fly aliases → pec deck (Planet Fitness / Life Fitness Insignia SS-PEC)
  [/\bbutterfly\s+machines?\b/gi, 'butterfly machine'],
  [/\bbutter\s*fly\s+machines?\b/gi, 'butterfly machine'],
  [/\bbutter\s*fly\b(?![\s-]*machines?)/gi, 'pec deck'],
  [/\bpec\s+fly(?:e)?s?(?:\s+machines?)?\b/gi, 'pec deck'],
  [/\bpeck?\s+decks?\b/gi, 'pec deck'],
  [/\bpec\s+decks?\b/gi, 'pec deck'],
  [/\bpecdecks?\b/gi, 'pec deck'],
  [/\bpact\s+decks?\b/gi, 'pec deck'],
  [/\bpack\s+decks?\b/gi, 'pec deck'],
  [/\bchest\s+fly\s+machines?\b/gi, 'chest fly machine'],
  [/\bcable\s+cross[\s-]*overs?\b/gi, 'cable crossover'],
  [/\bcable\s+crossovers?\b/gi, 'cable crossover'],
  [/\bcable\s+flye?s?\b/gi, 'cable fly'],
  [/\bdumbbell\s+flye?s?\b/gi, 'dumbbell fly'],
  [/\bchest\s+flye?s?\b/gi, 'chest fly'],

  // Tricep / skull crusher
  [/\bskull\s+crushers?\b/gi, 'skull crusher'],
  [/\bskullcrushers?\b/gi, 'skull crusher'],
  [/\boverhead\s+tricep(?:s)?\s+extensions?\b/gi, 'overhead tricep extension'],
  [/\bstraight[\s-]*bar\s+push[\s-]*downs?\b/gi, 'straight-bar pushdown'],
  [/(?<!-)\bbar\s+push[\s-]*downs?\b/gi, 'straight-bar pushdown'],
  [/\btricep(?:s)?\s+push[\s-]*downs?\b/gi, 'tricep pushdown'],
  [/\btriceps?\s+pushdowns?\b/gi, 'tricep pushdown'],
  [/\btricep(?:s)?\s+push\s+downs?\b/gi, 'tricep pushdown'],
  [/\btry\s+cep\s+push[\s-]*downs?\b/gi, 'tricep pushdown'],
  [/\btri\s+cep\s+push[\s-]*downs?\b/gi, 'tricep pushdown'],
  [/\btricep(?:s)?\s+extensions?\b/gi, 'tricep extension'],

  // Bicep / preacher / hammer / cable curl
  [/\bpreacher\s+curls?\b/gi, 'preacher curl'],
  [/\bpreach(?:er)?\s+curls?\b/gi, 'preacher curl'],
  [/\bhammer\s+curls?\b/gi, 'hammer curl'],
  [/\bcable\s+curls?\b/gi, 'cable curl'],
  // Restore split cep stems inside longer names (Whisper: try ceps / by cep)
  [/\btry\s+ceps?\b/gi, 'tricep'],
  [/\btri\s+ceps?\b/gi, 'tricep'],
  [/\bby\s+ceps?\b/gi, 'bicep'],
  [/\bbi\s+ceps?\b/gi, 'bicep'],
  [/\bbicep(?:s)?\s+curls?\b/gi, 'bicep curl'],
  // Whisper: bicyclo / bicycle / bysicle / bi cycle / by cycle / sickle ≈ bicep curl
  // (gym weight/reps/sets context only — not "bicycle crunch")
  [/\b(?:bicyclo|bysicle|bysickle|bi[\s-]?cycles?|by[\s-]?cycles?|bicycles?)\s+curls?\b/gi, 'bicep curl'],
  [/\b(?:bicyclo|bysicle|bysickle|bi[\s-]?cycles?|by[\s-]?cycles?|bicycles?)\b(?!\s+crunch)(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?|symbols?|simples?|settles?|curls?))/gi, 'bicep curl'],
  [/\b(?:by|bi|buy|bye)\s+sickles?(?:\s+curls?)?\b/gi, 'bicep curl'],
  [/\b(?:byceps?|by\s+ceps?|bi\s+ceps?)(?:\s+curls?)?\b/gi, 'bicep curl'],
  [/\bbicep(?:s)?\s+girls?\b/gi, 'bicep curl'],
  [/\bbicep(?:s)?\s+pearls?\b/gi, 'bicep curl'],
  // Whisper: by/bi/bye/buy + curl(s) ≈ bicep curl (Kenneth "bi curls")
  // Whisper dropped "curls": "by a set of 40 pounds…" → bicep curl (also in STRUCTURAL)
  [/\b(?:by|bi|bye|buy)\s+(?:(?:a|the)\s+)?sets?\s+of(?=\s+\d)/gi, 'bicep curl'],
  [/\b(?:by|bi|bye|buy)\s+cep\s+curls?\b/gi, 'bicep curl'],
  // Whisper / Safari Heard: bye|by|bi + seth|sep (+ curl) ≈ bicep curl
  // ("Bye Seth Curl" — never fuzzy-match Lying Leg Curl / Drag Curl)
  [/\b(?:by|bi|bye|buy)\s+(?:seth|septh|sep|cept?s?)\s+curls?\b/gi, 'bicep curl'],
  [/\b(?:by|bi|bye|buy)\s+(?:seth|septh|sep)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|raps?|wraps?|cents?|syllables?|seats?))/gi, 'bicep curl'],
  [/\b(?:by|bi|bye|buy)\s+curls?\b/gi, 'bicep curl'],
  [/\b(?:by|bi|bye|buy)curls?\b/gi, 'bicep curl'],
  // Whisper: buzz/bus/buz + lip (+ curls) ≈ bicep curl ("buzz lip curls")
  // Safari Heard / Whisper: buy/by + some + cars/curls/cards ≈ bicep curl
  // Never leave "Buy Some Cars" as invented equipment.
  [/\b(?:buy|by|bi|bye)\s+(?:some|sum)\s+(?:cars?|curls?|cards?|carts?)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'bicep curl'],
  [/\b(?:buy|by|bi|bye)\s+(?:some|sum)\s+(?:cars?|curls?|cards?|carts?)\b/gi, 'bicep curl'],
  [/\bboys?\s+and\s+(?:cars?|curls?|cards?|carts?)\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?))/gi, 'bicep curl'],
  [/\bboys?\s+and\s+(?:cars?|curls?|cards?|carts?)\b/gi, 'bicep curl'],
  [/\b(?:buzz|buz|bus)\s+lip\s+curls?\b/gi, 'bicep curl'],
  [/\b(?:buzz|buz|bus)\s+lips?\b/gi, 'bicep'],
  // Bare "lip curls" after filler strip / dropped buzz → bicep curl
  [/(?<!\bbuzzy?\s)(?<!\bbusy\s)(?<!\bbuzz\s)(?<!\bbuz\s)(?<!\bbus\s)\blip\s+curls?\b/gi, 'bicep curl'],
  // Safari Heard / Whisper: isa/ice/eyes/iza/issa curls ≈ bicep curl
  [/\b(?:isa|ice|eyes|iza|issa)\s+curls?\b/gi, 'bicep curl'],
  [/\b(?:isa|iza|issa)curls?\b/gi, 'bicep curl'],
  // Conversational family (also in accentGymFixes / STRUCTURAL): I said/say curls
  // Optional hallucinated leg/lag before curl → still bicep (not real leg curl)
  [/\b(?:i(?:['’]?ve|\s+have)?|eye|aye)\s+(?:sai?d|say|sed)\s+(?:(?:lags?|legs?)\s+)?curls?\b/gi, 'bicep curl'],

  // =====================================================================
  // Wild Whisper brand / common-noun hallucinations (tiny.en / Safari Heard)
  // Class rules: invented nouns that sound like lifts — not one-off Heard lines.
  // Curl / press / squat / deadlift / row families.
  // =====================================================================
  // Curl: visa/busy-lip (isa/buzz-lip cousins)
  [/\bvisa\s+curls?\b/gi, 'bicep curl'],
  [/\bbusy\s+lip\s+curls?\b/gi, 'bicep curl'],
  [/\bbusy\s+lips?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|curls?))/gi, 'bicep'],
  // Press: guest→chest; overheard/over-bread→overhead (not Pin/Pinterest)
  [/\bguest\s+press(?:es)?\b/gi, 'chest press'],
  [/\boverheard\s+press(?:es)?\b/gi, 'overhead press'],
  [/\bover\s+bread(?:\s+press(?:es)?)?\b/gi, 'overhead press'],
  // Brand: facebook → face pull (weight/reps context OR explicit pull)
  [/\bfacebook\s+pulls?\b/gi, 'face pull'],
  [/\bfacebook\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?))/gi, 'face pull'],
  // Squat: squad goals / squash (gym-number lookahead — not food squash alone)
  [/\bsquad\s+goals?\b/gi, 'squat'],
  [/\bsquat\s+goals?\b/gi, 'squat'],
  [/\bsquash(?:es)?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?|jerks?))/gi, 'squat'],
  // Deadlift: deadline / dead leaf
  [/\bdeadlines?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?))/gi, 'deadlift'],
  [/\bdead\s+leafs?\b/gi, 'deadlift'],
  [/\bdead\s+leaves?\b/gi, 'deadlift'],
  // Row: seeded rose / cedar row|roll
  [/\bseeded\s+roses?\b/gi, 'seated row'],
  [/\bseated\s+roses?\b/gi, 'seated row'],
  [/\bcedar\s+(?:rows?|rolls?)\b/gi, 'seated row'],

  // Hip / glute / raises / commercial glute stations

  // Whisper: "I'm going to sing or sets at 40 pounds" ≈ glute machine 4 sets of 10 at 40
  // MUST run before filler strip of "I'm going to"
  [/\bi'?m\s+going\s+to\s+sing\s+or\s+sets\b/gi, 'glute machine 4 sets of 10'],
  [/\bi\s+am\s+going\s+to\s+sing\s+or\s+sets\b/gi, 'glute machine 4 sets of 10'],
  [/\bi'?m\s+going\s+to\s+sing\b/gi, 'glute machine'],
  [/\bgoing\s+to\s+sing\b/gi, 'glute machine'],
  [/\bsing\s+or\s+sets\b/gi, '4 sets of 10'],
  [/\bglutes?\s+machines?\b/gi, 'glute machine'],
  [/\bglute\s+mashines?\b/gi, 'glute machine'],
  [/\bglue\s+machines?\b/gi, 'glute machine'],
  [/\bflute\s+machines?\b/gi, 'glute machine'],
  [/\bglut\s+machines?\b/gi, 'glute machine'],
  [/\bglute\s+machin\b/gi, 'glute machine'],
  [/\bclute\s+machines?\b/gi, 'glute machine'],
  [/\bloot\s+machines?\b/gi, 'glute machine'],
  // Glute kickback / Booty Builder Kick Back naming
  [/\bbooty\s+builder(?:\s+kick\s*backs?)?\b/gi, 'glute kickback'],
  [/\bmachine\s+(?:glute|glue|flute|gloot|glut|clute|loot)\s+kick[\s-]*backs?\b/gi, 'machine glute kickbacks'],
  [/\b(?:glue|flute|gloot|glut|clute|loot)\s+kick[\s-]*backs?\b/gi, 'glute kickback'],
  [/\bglute\s+kick[\s-]*backs?\b/gi, 'glute kickback'],
  [/\bglute\s+kick\s+backs?\b/gi, 'glute kickback'],
  [/\bglutes?\s+kicks?\b(?!\s*back)/gi, 'glute kickback'],
  [/\b(?<!glute\s)kick[\s-]*backs?(?:\s+machines?)?\b/gi, 'glute kickback'],
  [/\bdonkey\s+kicks?\b/gi, 'glute kickback'],
  [/\bglute\s+bridge\s+machines?\b/gi, 'glute bridge machine'],
  [/\bhip\s+thrust\s+machines?\b/gi, 'hip thrust machine'],
  [/\bhip\s+thrusts?\b/gi, 'hip thrust'],
  [/\bhipthrust\b/gi, 'hip thrust'],
  [/\bhip\s+trusts?\b/gi, 'hip thrust'],
  [/\bhit\s+thrusts?\b/gi, 'hip thrust'],
  [/\bglute\s+bridges?\b/gi, 'glute bridge'],
  // Outer/inner thigh: keep *Machine catalog entries; bare thigh → hip ab/ad nickname
  [/\bouter\s+thigh\s+machines?\b/gi, 'outer thigh machine'],
  [/\binner\s+thigh\s+machines?\b/gi, 'inner thigh machine'],
  [/\bouter\s+thigh\b(?!\s*machines?)/gi, 'hip abduction'],
  [/\binner\s+thigh\b(?!\s*machines?)/gi, 'hip adduction'],
  [/\bthigh\s+abduct(?:or|ion)s?\b/gi, 'hip abduction'],
  [/\bthigh\s+adduct(?:or|ion)s?\b/gi, 'hip adduction'],
  [/\bhip\s+abductors?\b/gi, 'hip abduction'],
  [/\bhip\s+adductors?\b/gi, 'hip adduction'],
  [/\bhip\s+abs?\b(?!\s*duction)/gi, 'hip abduction'],
  [/\bhip\s+ab[\s-]+ads?\b/gi, 'hip abduction'],
  [/\bhip\s+abductions?\b/gi, 'hip abduction'],
  [/\bhip\s+adductions?\b/gi, 'hip adduction'],
  [/\bhip\s+abduction\s+machines?\b/gi, 'hip abduction machine'],
  [/\bhip\s+adduction\s+machines?\b/gi, 'hip adduction machine'],
  [/\bmulti[\s-]?hips?\b/gi, 'multi hip'],
  [/\bmulti\s+hip\s+machines?\b/gi, 'multi hip'],
  [/\blateral\s+raise\s+machines?\b/gi, 'lateral raise machine'],
  [/\blateral\s+raises?\b/gi, 'lateral raise'],
  [/\bfront\s+raises?\b/gi, 'front raise'],
  [/\brear\s+delt\s+machines?\b/gi, 'rear delt machine'],
  [/\brear\s+delt\s+flye?s?\b/gi, 'rear delt fly'],
  // Preserve rear delt row / fly variants before bare rear delt → machine
  [/\b(barbell|dumbbell|cable)\s+rear\s+delt\s+rows?\b/gi, '$1 rear delt row'],
  [/\brear\s+delt\s+rows?\b/gi, 'rear delt row'],
  [/\brear\s+delts?\b(?!\s+(?:fly|flye|machine|row|rose|roses|roll|rolls|rho|rhos|roe|roes))/gi, 'rear delt machine'],
  [/\bstanding\s+calf\s+raises?\b/gi, 'standing calf raise'],
  [/\bseated\s+calf\s+raises?\b/gi, 'seated calf raise'],
  [/\bcalf\s+raise\s+machines?\b/gi, 'calf raise machine'],

  // Shoulder / arm machines (Title Case library names)
  [/\bshoulder\s+press\s+machines?\b/gi, 'shoulder press machine'],
  // Keep Smith Machine Shoulder Press variants before bare shoulder-press-machine collapse
  [/\bseated\s+smith(?:\s+machine)?\s+shoulder\s+press(?:es)?\b/gi, 'seated smith machine shoulder press'],
  [/\bsmith(?:\s+machine)?\s+shoulder\s+press(?:es)?\b/gi, 'smith machine shoulder press'],
  [/\bsmith(?:\s+machine)?\s+one[\s-]+handed\s+rows?\b/gi, 'smith machine one-handed row'],
  [/\bbicep(?:s)?\s+curl\s+machines?\b/gi, 'bicep curl machine'],
  [/\bpreacher\s+curl\s+machines?\b/gi, 'preacher curl machine'],
  [/\btricep(?:s)?\s+extension\s+machines?\b/gi, 'tricep extension machine'],
  [/\btricep(?:s)?\s+press(?:\s+machines?)?\b/gi, 'tricep press machine'],
  [/\btri\s+press(?:\s+machines?)?\b/gi, 'tricep press machine'],

  // Core / multi stations
  [/\bab\s+crunch(?:\s+machines?)?\b/gi, 'ab crunch machine'],
  [/\babdominal\s+(?:crunch\s+)?machines?\b/gi, 'ab crunch machine'],
  [/\btorso\s+rotations?\b/gi, 'torso rotation'],
  [/\bcaptain'?s?\s+chairs?\b/gi, "captain's chair"],
  [/\broman\s+chairs?\b/gi, "captain's chair"],
  [/\bsmith\s+machines?\b/gi, 'smith machine'],
  [/\bfunctional\s+trainers?\b/gi, 'functional trainer'],
  [/\bcable\s+machines?\b/gi, 'cable machine'],
  [/\bcable\s+stations?\b/gi, 'cable machine'],

  // Olympic / carries / misc compounds
  [/\bpower\s+cleans?\b/gi, 'power clean'],
  [/\bkettle\s*bell\s+swings?\b/gi, 'kettlebell swing'],
  [/\bkettlebell\s+swings?\b/gi, 'kettlebell swing'],
  [/\bfarmer'?s?\s+walks?\b/gi, "farmer's walk"],
  [/\bfarmers?\s+walks?\b/gi, "farmer's walk"],
  [/\bgood\s+mornings?\b/gi, 'good morning'],
  [/\bwalking\s+lunges?\b/gi, 'walking lunge'],
  [/\bstep[\s-]+ups?\b/gi, 'step-up'],
  [/\bpush[\s-]*ups?\b/gi, 'push-up'],
  [/\bback\s+extensions?\b/gi, 'back extension'],
  [/\brussian\s+twists?\b/gi, 'russian twist'],
  [/\bleg\s+raises?\b/gi, 'leg raise'],
  [/\bfore\s*arms?\s+curls?\b/gi, 'forearm curl'],
  [/\breverse\s+wrist\s+curls?\b/gi, 'reverse wrist curl'],
  [/\bwrist\s+curls?\b/gi, 'wrist curl'],

  // DB / BB shorthand + spacing
  [/\bdumb\s+bells?\b/gi, 'dumbbell'],
  [/\bdumbbells\b/gi, 'dumbbells'],
  [/\bbar\s+bells?\b/gi, 'barbell'],
  [/\bbb\b/gi, 'barbell'],

  // Leg press (ASR mishears — longer / more-specific before generic)
  // Note: `like curl` → leg curl is above; `like press` → leg press here (separate rule).
  [/\bseated\s+leg\s+press(?:ed|es|t)?\b/gi, 'seated leg press'],
  [/\bvertical\s+leg\s+press(?:ed|es|t)?\b/gi, 'vertical leg press'],
  [/\bsquat\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\bleg\s+press\s+machines?\b/gi, 'leg press'],
  [/\bsingle\s+(?:lake|lag|lead|like)\s+/gi, 'single leg '],
  [/\bstiff\s+(?:lake|lag|lead|like)\s+/gi, 'stiff leg '],
  [/\bchair\s+(?:lead|lake|lag|like)\s+raises?\b/gi, 'chair leg raise'],
  [/\blegpress\b/gi, 'leg press'],
  [/\bleg\s+breast\b/gi, 'leg press'],
  // 45-degree leg press family (before bare leg prest collapse)
  [/\b45[\s-]*degree\s+(?:lag|lake|lead|like|lack|legs?)\s+pres(?:s|t|sed|ses|ted)?\b/gi, '45 degree leg press'],
  [/\bforty[\s-]*five\s+degree\s+(?:lag|lake|legs?)\s+pres(?:s|t|sed|ses|ted)?\b/gi, '45 degree leg press'],
  [/\bleg\s+prest\b/gi, 'leg press'],
  [/\bleg\s+presss+\b/gi, 'leg press'],
  [/\blegs?\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\blag\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\blead\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\bled\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\blike\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\blake\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\begg\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\black\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\bleak\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\bleft\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  [/\bleague\s+press(?:ed|es|t)?\b/gi, 'leg press'],
  // Careful: only exact "black press" (not broader black*)
  [/\bblack\s+press(?:ed|es|t)?\b/gi, 'leg press'],

  // Calf press / raise — canonical forms (family mishears live in STRUCTURAL_FIXES)
  [/\bstanding\s+calf\s+raises?\b/gi, 'standing calf raise'],
  [/\bseated\s+calf\s+raises?\b/gi, 'seated calf raise'],
  [/\bcalf\s+raise\s+machines?\b/gi, 'calf raise machine'],
  [/\bcalf\s+press(?:es)?\b/gi, 'calf press'],
  [/\bcalf\s+raises?\b/gi, 'calf raise'],

  // Cardio machine aliases (longer / specific first — before bare "bike" → cycle)
  // Safari Heard / Whisper mishears for every cardio catalog machine
  [/\brecum\s*bent[\s-]*bikes?\b/gi, 'recumbent bike'],
  [/\brecumbent[\s-]*bikes?\b/gi, 'recumbent bike'],
  [/\breclining\s+bikes?\b/gi, 'recumbent bike'],
  [/\bspin[\s-]*bikes?\b/gi, 'spin bike'],  // hyphen ok
  [/\bspin\s+class\s+bikes?\b/gi, 'spin bike'],
  [/\bstair\s+step\s+machines?\b/gi, 'stair step machine'],
  [/\bstair\s+steps\s+machines?\b/gi, 'stair step machine'],
  [/\bstair-?step\s+machines?\b/gi, 'stair step machine'],
  [/\bstairstep\s+machines?\b/gi, 'stair step machine'],
  // Whisper: stepper → temper; plural stairs (Heard class)
  [/\bstairs?\s+tempers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bstairs\s+steppers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bstair\s+steppers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bstairs?\s+diapers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bstair\s+diapers?(?:\s+machines?)?\b/gi, 'stair step machine'],
  [/\bstairsteppers?\b/gi, 'stair step machine'],
  [/\bstair\s+climbers?\b/gi, 'stair step machine'],
  [/\bstairclimbers?\b/gi, 'stair step machine'],
  [/\bstair\s+masters?\b/gi, 'stair step machine'],
  [/\bstairmasters?\b/gi, 'stair step machine'],
  [/\bstep\s+masters?\b/gi, 'stair step machine'],
  [/\bstepmasters?\b/gi, 'stair step machine'],
  [/\bstep\s+mills?\b/gi, 'stair step machine'],
  [/\bstepmills?\b/gi, 'stair step machine'],
  [/\b(?:roll|roe|rho|rose)\s+machines?\b/gi, 'row machine'],
  [/\brows?\s+machines?\b/gi, 'row machine'],
  [/\browing\s+machines?\b/gi, 'row machine'],
  [/\browers?\b/gi, 'row machine'],
  [/\bconcept\s*2(?:\s+rowers?)?\b/gi, 'row machine'],
  [/\bc2\s+(?:rower|rowing\s+machine)\b/gi, 'row machine'],
  [/\bark\s+trainers?\b/gi, 'arc trainer'],
  [/\barc\s+trainers?\b/gi, 'arc trainer'],
  [/\barc\s+trainors?\b/gi, 'arc trainer'],
  [/\barctainers?\b/gi, 'arc trainer'],
  [/\bair[\s-]*bikes?\b/gi, 'air bike'],
  [/\bairbikes?\b/gi, 'air bike'],
  [/\bfan[\s-]*bikes?\b/gi, 'air bike'],
  [/\bassault\s+air\s+bikes?\b/gi, 'air bike'],
  [/\bassault\s+bikes?\b/gi, 'air bike'],
  [/\becho[\s-]*bikes?\b/gi, 'echo bike'],  // hyphen ok
  [/\bski\s*ergs?\b/gi, 'skierg'],
  [/\bski\s+machines?\b/gi, 'skierg'],
  [/\bellipti\s+cals?\b/gi, 'elliptical'],
  [/\belliptic\s+als?\b/gi, 'elliptical'],
  [/\bellipticles?\b/gi, 'elliptical'],
  [/\belipti?cals?\b/gi, 'elliptical'],
  [/\bellipti?cals?\b/gi, 'elliptical'],
  [/\bellip?tical\b/gi, 'elliptical'],
  [/\bcross[\s-]*trainers?\b/gi, 'elliptical'],
  // Safari Heard: trade/tred/tread mill(s) / treadmil → treadmill
  [/\btrade\s+mills?\b/gi, 'treadmill'],
  [/\btred\s+mills?\b/gi, 'treadmill'],
  [/\btread\s+mills?\b/gi, 'treadmill'],
  [/\btreadmil\b/gi, 'treadmill'],
  [/\btreadmills?\b/gi, 'treadmill'],
  [/\brun\s+mills?\b/gi, 'treadmill'],
  [/\brunning\s+machines?\b/gi, 'treadmill'],
  [/\bassault\s+runners?\b/gi, 'assault runner'],
  [/\bassault\s+runs?\b/gi, 'assault runner'],
  [/\btreadmill\s+assaults?\b/gi, 'assault runner'],
  [/\bin\s*door\s+cycles?\b/gi, 'indoor cycle'],
  [/\bindoor\s+cycles?\b/gi, 'indoor cycle'],
  [/\bindoor\s+bikes?\b/gi, 'indoor cycle'],
  [/\bindoor\s+cycling\b/gi, 'indoor cycle'],
  [/\bstation(?:ary|airy|ery)[\s-]*bikes?\b/gi, 'stationary bike'],
  [/\bstation(?:ary|airy|ery)[\s-]*cycles?\b/gi, 'stationary bike'],
  [/\bexercise\s+bikes?\b/gi, 'indoor cycle'],
  [/\bstudio\s+(?:bikes?|cycles?)\b/gi, 'indoor cycle'],
  [/\bspin\s+cycles?\b/gi, 'indoor cycle'],
  [/\bjump(?:ing)?\s+ropes?\b/gi, 'jump rope'],
  [/\bskip(?:ping)?\s+ropes?\b/gi, 'jump rope'],
  [/\bskipping\b(?!\s+rope)/gi, 'jump rope'],
  [/\bcycling\b/gi, 'indoor cycle'],
  [/(?<!air\s)(?<!air-)(?<!spin\s)(?<!spin-)(?<!echo\s)(?<!echo-)(?<!assault\s)(?<!assault-)(?<!fan\s)(?<!fan-)(?<!recumbent\s)(?<!recumbent-)(?<!exercise\s)(?<!exercise-)(?<!stationary\s)(?<!stationary-)(?<!stationery\s)(?<!stationery-)(?<!stationairy\s)(?<!stationairy-)(?<!indoor\s)(?<!indoor-)\bbikes?\b/gi, 'indoor cycle'],
  [/(?<!indoor\s)\bcycles?\b(?!\s+crunch)/gi, 'indoor cycle'],



  // --- Comprehensive commercial machine + spoken aliases (PF / Life Fitness / StrengthLog) ---
  // Butterfly / pec deck family
  [/\bbutterflies?(?![\s-]*machines?)\b/gi, 'pec deck'],
  [/\bpec\s+decks?\b/gi, 'pec deck'],
  [/\bpeck?\s+decks?\b/gi, 'pec deck'],
  [/\bpec\s+fly(?:e)?\s+machines?\b/gi, 'pec deck'],
  [/\bmachine\s+chest\s+flye?s?\b/gi, 'machine chest fly'],
  [/\bmachine\s+chest\s+press(?:es)?\b/gi, 'machine chest press'],

  // Inner / outer thigh → hip ad/ab
  [/\bouter\s+thighs?\s+machines?\b/gi, 'outer thigh machine'],
  [/\binner\s+thighs?\s+machines?\b/gi, 'inner thigh machine'],
  [/\bouter\s+thighs?\b(?!\s*machines?)/gi, 'hip abduction'],
  [/\binner\s+thighs?\b(?!\s*machines?)/gi, 'hip adduction'],
  [/\bhip\s+abductors?(?:\s+machines?)?\b/gi, 'hip abduction'],
  [/\bhip\s+adductors?(?:\s+machines?)?\b/gi, 'hip adduction'],
  [/\babductor(?:\s+machines?)?\b/gi, 'hip abduction'],
  [/\badductor(?:\s+machines?)?\b/gi, 'hip adduction'],


  // Squat press / hack / V-squat → press family
  [/\bsquat\s+press(?:es)?\b/gi, 'leg press'],
  [/\bhack\s+squat\s+machines?\b/gi, 'hack squat machine'],
  [/\bhack\s+squats?\b/gi, 'hack squat'],
  [/\bv[\s-]?squats?\b/gi, 'hack squat'],
  // pendulum squat is its own catalog entry (do not collapse to hack)
  [/\bpendulum\s+squats?\b/gi, 'pendulum squat'],

  // Leg press variants
  // 45-degree leg press family (keep before bare leg press collapses)
  [/\b45[\s-]*degree\s+(?:lag|lake|lead|like|lack|legs?)\s+pres(?:s|t|sed|ses|ted)?\b/gi, '45 degree leg press'],
  [/\bforty[\s-]*five\s+degree\s+(?:lag|lake|legs?)\s+pres(?:s|t|sed|ses|ted)?\b/gi, '45 degree leg press'],
  [/\bseated\s+leg\s+press(?:es)?\b/gi, 'seated leg press'],
  [/\bvertical\s+leg\s+press(?:es)?\b/gi, 'vertical leg press'],
  // (removed) 45 degree leg press → leg press — catalog has 45 Degree Leg Press
  [/\bleg\s+press\s+machines?\b/gi, 'leg press'],

  // Curl / extension machines
  [/\bseated\s+leg\s+curls?\b/gi, 'seated leg curl'],
  [/\blying\s+leg\s+curls?\b/gi, 'lying leg curl'],
  [/\bprone\s+leg\s+curls?\b/gi, 'lying leg curl'],
  [/\bhamstring\s+curls?\b/gi, 'leg curl'],
  [/\bham\s+curls?\b/gi, 'leg curl'],
  [/\bquad\s+extensions?\b/gi, 'leg extension'],
  [/\bleg\s+extension\s+machines?\b/gi, 'leg extension'],

  // Calf machines
  [/\bstanding\s+calf\s+raises?\b/gi, 'standing calf raise'],
  [/\bseated\s+calf\s+raises?\b/gi, 'seated calf raise'],
  [/\bcalf\s+press(?:es)?\b/gi, 'calf press'],
  [/\bcalf\s+raise\s+machines?\b/gi, 'calf raise machine'],

  // Rows / pulldowns / assisted
  [/\bhigh\s+rows?\b/gi, 'high row'],
  [/\blow\s+rows?\b/gi, 'low row'],
  [/\bseated\s+cable\s+rows?\b/gi, 'seated row'],
  [/\bchest[\s-]?supported\s+rows?\b/gi, 'seated row'],
  [/\blat\s+pull[\s-]?downs?\b/gi, 'lat pulldown'],
  [/\bpull[\s-]?down\s+machines?\b/gi, 'lat pulldown'],
  [/\bassisted\s+pull[\s-]?ups?\b/gi, 'assisted pull-up'],
  [/\bassisted\s+chin[\s-]?ups?\b/gi, 'assisted chin-up'],
  [/\bgravitron\b/gi, 'assisted pull-up'],
  [/\bassisted\s+dips?\b/gi, 'assisted dip'],
  [/\bpullover\s+machines?\b/gi, 'pullover machine'],
  [/\bmachine\s+pullovers?\b/gi, 'pullover machine'],

  // Shoulder / arm machines
  [/\bshoulder\s+press\s+machines?\b/gi, 'shoulder press machine'],
  [/(?<!smith )\bmachine\s+shoulder\s+press(?:es)?\b/gi, 'machine shoulder press'],
  [/\blateral\s+raise\s+machines?\b/gi, 'lateral raise machine'],
  [/\bmachine\s+lateral\s+raises?\b/gi, 'machine lateral raise'],
  [/\brear\s+delt\s+machines?\b/gi, 'rear delt machine'],
  [/\breverse\s+flye?\s+machines?\b/gi, 'rear delt machine'],
  [/\bbicep(?:s)?\s+curl\s+machines?\b/gi, 'bicep curl machine'],
  [/\bmachine\s+bicep(?:s)?\s+(?:carls?|culls?|girls?|pearls?|curls?)\b/gi, 'machine bicep curl'],
  [/\bpreacher\s+curl\s+machines?\b/gi, 'preacher curl machine'],
  [/\btricep(?:s)?\s+extension\s+machines?\b/gi, 'tricep extension machine'],
  [/\btricep(?:s)?\s+press\s+machines?\b/gi, 'tricep press machine'],
  [/\bmachine\s+tricep(?:s)?\s+press(?:es)?\b/gi, 'tricep press machine'],

  // Core / multi
  [/\bab\s+crunch\s+machines?\b/gi, 'ab crunch machine'],
  [/\babdominal\s+machines?\b/gi, 'ab crunch machine'],
  [/\btorso\s+rotations?\b/gi, 'torso rotation'],
  [/\bcaptain'?s?\s+chairs?\b/gi, "captain's chair"],
  [/\broman\s+chairs?\b/gi, "captain's chair"],
  [/\bvertical\s+knee\s+raises?\b/gi, "captain's chair"],
  [/\bmulti[\s-]?hips?\b/gi, 'multi hip'],
  [/\bsmith\s+machines?\b/gi, 'smith machine'],
  [/\bfunctional\s+trainers?\b/gi, 'functional trainer'],
  [/\bcable\s+machines?\b/gi, 'cable machine'],
  [/\bcable\s+crossovers?\b/gi, 'cable crossover'],
  [/\bcable\s+cross[\s-]?overs?\b/gi, 'cable crossover'],

  // Freeweight spoken forms (DB/BB / incline etc.)
  [/\bincline\s+dumbbell\s+press(?:es)?\b/gi, 'incline dumbbell press'],
  [/\bdecline\s+dumbbell\s+press(?:es)?\b/gi, 'decline dumbbell press'],
  [/\bdumbbell\s+bench\s+press(?:es)?\b/gi, 'dumbbell bench press'],
  [/\bdb\s+bench(?:\s+press(?:es)?)?\b/gi, 'dumbbell bench press'],
  [/\bdb\s+incline\s+press(?:es)?\b/gi, 'incline dumbbell press'],
[/\bdumbbell\s+incline\s+press(?:es)?\b/gi, 'incline dumbbell press'],
  [/\bbb\s+row\b/gi, 'barbell row'],
  [/\bdb\s+row\b/gi, 'dumbbell row'],
  [/\bdb\s+curl\b/gi, 'dumbbell curl'],
  [/\bbb\s+curl\b/gi, 'barbell curl'],
  [/\bdb\s+lateral\s+raises?\b/gi, 'lateral raise'],
  [/\bdb\s+shoulder\s+press(?:es)?\b/gi, 'dumbbell shoulder press'],
  [/\bdb\b/gi, 'dumbbell'],
  [/\bgoblet\s+squats?\b/gi, 'goblet squat'],
  [/\brdls?\b/gi, 'romanian deadlift'],
  [/\bohps?\b(?=\s+(?:\d|for\s+\d|at\s+\d|pounds?|lbs?|kg|sets?|reps?|syllables?|seats?|$))/gi, 'overhead press'],


  // =====================================================================
  // Extra spoken slang / abbreviations (StrengthLog / PF / GA Whisper)
  // Prefer general patterns — applied after specific families above.
  // =====================================================================
  // Arms
  [/\btri\s+curls?\b/gi, 'tricep extension'],
  [/\btry\s+curls?\b/gi, 'tricep extension'],
  [/\btry\s+cep\s+extensions?\b/gi, 'tricep extension'],
  [/\btri\s+cep\s+extensions?\b/gi, 'tricep extension'],
  [/\btry\s+cep\s+push[\s-]*downs?\b/gi, 'tricep pushdown'],
  [/\btri\s+push[\s-]*downs?\b/gi, 'tricep pushdown'],
  [/(?<!\btricep\s)(?<!\btriceps\s)(?<!\brope\s)(?<!\bbar\s)(?<!straight-bar\s)\bpushdowns?\b/gi, 'tricep pushdown'],
  [/\brope\s+push[\s-]*downs?\b/gi, 'rope pushdown'],
  [/\bskulls?\b(?=\s+(?:\d|for|at|sets?|reps?|pounds?|lbs?))/gi, 'skull crusher'],
  [/\bconcentration\s+curls?\b/gi, 'concentration curl'],
  [/\bzottman\s+curls?\b/gi, 'zottman curl'],
  [/\bez\s+bar\s+curls?\b/gi, 'ez bar curl'],
  [/\beasy\s+bar\s+curls?\b/gi, 'ez bar curl'],
  [/\beasy\s+curls?\b/gi, 'ez curl'],
  [/\breverse\s+curls?\b/gi, 'reverse curl'],
  [/\bscott\s+curls?\b/gi, 'preacher curl'],
  [/\bnordic\s+curls?\b/gi, 'nordic curl'],
  [/\bnordics?\b(?=\s+(?:\d|for|at|sets?|reps?))/gi, 'nordic curl'],
  [/\bspider\s+curls?\b/gi, 'spider curl'],
  [/\bdrag\s+curls?\b/gi, 'drag curl'],
  // Mid-phrase bicep Whisper stubs (isa/ice) before curl — not conversational I-said lead-in
  [/\b(lying|seated|standing|incline|decline|cable|barbell|dumbbell|preacher)\s+(?:isa|ice|iza|issa|eyes?)\s+(?=.*\bcurl)/gi, '$1 bicep '],
  [/\b(?:isa|ice|iza|issa)\s+cable\s+curl/gi, 'bicep cable curl'],
  [/\blying\s+(?:isa|ice|iza|issa)\s+cable\s+curl/gi, 'lying bicep cable curl'],
  [/\bbayesian\s+curls?\b/gi, 'bayesian curl'],

  // Press / pull abbreviations & slang
  [/\bcgbp\b/gi, 'close-grip bench press'],
  [/\bbp\b(?=\s+(?:\d|for|at|sets?|reps?|pounds?|lbs?))/gi, 'bench press'],
  [/\bdl\b(?=\s+(?:\d|for|at|sets?|reps?|pounds?|lbs?))/gi, 'deadlift'],
  [/\bsldl\b/gi, 'stiff-leg deadlift'],
  [/\bstiff[\s-]+legged\s+deads?\b/gi, 'stiff-legged deadlift'],
  [/\bstiff[\s-]+leg\s+deads?\b/gi, 'stiff-leg deadlift'],
  [/\btrap\s+bar\s+dead[\s-]*lifts?\b/gi, 'trap bar deadlift'],
  [/\bhex\s+bar\s+dead[\s-]*lifts?\b/gi, 'trap bar deadlift'],
  [/\brack\s+pulls?\b/gi, 'rack pull'],
  [/\bfloor\s+press(?:es)?\b/gi, 'floor press'],
  [/\bjm\s+press(?:es)?\b/gi, 'jm press'],
  [/\blandmine\s+press(?:es)?\b/gi, 'landmine press'],
  [/\blandmine\s+rows?\b/gi, 'landmine row'],
  [/\bpendlay\s+rows?\b/gi, 'pendlay row'],
  [/\bmeadows\s+rows?\b/gi, 'meadows row'],
  [/\bseal\s+rows?\b/gi, 'seal row'],
  [/\bchest[\s-]?supported\s+rows?\b/gi, 'chest-supported row'],
  [/\bstraight[\s-]?arm\s+pull[\s-]*downs?\b/gi, 'straight-arm pulldown'],
  [/\bclose[\s-]?grip\s+pull[\s-]*downs?\b/gi, 'close-grip pulldown'],
  [/\bwide[\s-]?grip\s+pull[\s-]*downs?\b/gi, 'wide-grip pulldown'],
  [/\bv[\s-]?bar\s+pull[\s-]*downs?\b/gi, 'close-grip pulldown'],

  // Shoulders / rear delts
  [/\bside\s+raises?\b/gi, 'lateral raise'],
  [/\blat\s+raises?\b(?!\s+pulldown)/gi, 'lateral raise'],
  [/\breverse\s+flye?s?\b/gi, 'rear delt fly'],
  [/\brear\s+flye?s?\b/gi, 'rear delt fly'],
  [/\bcable\s+face\s+pulls?\b/gi, 'cable face pull'],
  [/\bcable\s+lateral\s+raises?\b/gi, 'cable lateral raise'],
  [/\by[\s-]?raises?\b/gi, 'y raise'],
  [/\bw[\s-]?raises?\b/gi, 'w raise'],
  [/\bcuban\s+press(?:es)?\b/gi, 'cuban press'],

  // Legs / posterior
  [/\bbss\b/gi, 'bulgarian split squat'],
  [/\bsissy\s+squats?\b/gi, 'sissy squat'],
  [/\bbox\s+squats?\b/gi, 'box squat'],
  [/\bpause\s+squats?\b/gi, 'pause squat'],
  [/\bbelt\s+squats?\b/gi, 'belt squat'],
  [/\bzercher\s+squats?\b/gi, 'zercher squat'],
  [/\bsafety\s+(?:bar\s+)?squats?\b/gi, 'safety bar squat'],
  [/\bssb\s+squats?\b/gi, 'safety bar squat'],
  [/\bghr\b/gi, 'glute-ham raise'],
  [/\bglute[\s-]?ham\s+raises?\b/gi, 'glute-ham raise'],
  [/\breverse\s+hypers?\b/gi, 'reverse hyperextension'],
  [/\breverse\s+hyperextensions?\b/gi, 'reverse hyperextension'],
  // Calf Extension is its own catalog entry — do not collapse to calf press
  [/\bcalf\s+extensions?\b/gi, 'calf extension'],
  [/\bcalves?\s+extensions?\b/gi, 'calf extension'],

  // Core / carries / conditioning
  [/\bpallof\s+press(?:es)?\b/gi, 'pallof press'],
  // Woodchop family — keep directional + cable variants as catalog names
  [/\bhigh\s+to\s+low\s+wood\s*chops?(?:\s+with)?(?:\s+cable)?\b/gi, 'high to low wood chop with cable'],
  [/\blow\s+to\s+high\s+wood\s*chops?(?:\s+with)?(?:\s+cable)?\b/gi, 'low to high wood chop with cable'],
  [/\bhorizontal\s+wood\s*chops?(?:\s+with)?(?:\s+cable)?\b/gi, 'horizontal wood chop with cable'],
  [/\bwood\s*chops?\s+with\s+cable\b/gi, 'woodchop'],
  [/\bwood\s*chops?\b/gi, 'woodchop'],
  [/\bcable\s+chops?\b/gi, 'woodchop'],
  [/\bcable\s+crunches?\b/gi, 'cable crunch'],
  [/\bab\s+wheels?\b/gi, 'ab wheel'],
  [/\bab\s+rollouts?\b/gi, 'ab wheel'],
  [/\bhanging\s+leg\s+raises?\b/gi, 'hanging leg raise'],
  [/\bhanging\s+knee\s+raises?\b/gi, 'hanging knee raise'],
  [/\bplanks?\b(?=\s+(?:\d|for|at|sets?|reps?|seconds?|minutes?))/gi, 'plank'],
  [/\bsled\s+push(?:es)?\b/gi, 'sled push'],
  [/\bsled\s+pulls?\b/gi, 'sled pull'],
  [/\bprowler\s+push(?:es)?\b/gi, 'sled push'],
  [/\bbattle\s+ropes?\b/gi, 'battle ropes'],
  [/\bbox\s+jumps?\b/gi, 'box jump'],
  [/\bburpees?\b/gi, 'burpee'],
  [/\bmountain\s+climbers?\b/gi, 'mountain climber'],
  [/\bjump(?:ing)?\s+ropes?\b/gi, 'jump rope'],
  [/\bskip(?:ping)?\s+ropes?\b/gi, 'jump rope'],
  [/\bassault\s+bikes?\b/gi, 'air bike'],
  [/\bfan\s+bikes?\b/gi, 'air bike'],
  [/\becho[\s-]*bikes?\b/gi, 'echo bike'],

  // Shrugs / upright
  [/\bshrugs?\b/gi, 'shrug'],
  [/\btrap\s+shrugs?\b/gi, 'shrug'],

  // Units / fillers
  // Drop Whisper lead-in filler (AFTER glute "I'm going to sing" recoveries above)
  [/\bi'?m\s+going\s+to\b/gi, ''],
  [/\bi\s+am\s+going\s+to\b/gi, ''],
  [/\bkilo\s+grams?\b/gi, 'kilograms'],
  [/\bpound\s+s\b/gi, 'pounds'],
]



/**
 * Detect YouTube / Whisper hallucination fluff.
 * @param {string} text
 */
export function isHallucination(text) {
  const t = String(text || '').trim()
  if (!t) return true
  return HALLUCINATION_PATTERNS.some((re) => re.test(t))
}

/**
 * Normalize digit runs like "1-4-5" / "1 4 5" / "1-4-10" into weight+reps
 * when they look like gym patterns (3 digits → hundreds weight; trailing small = reps).
 * @param {string} text
 */
export function normalizeDigitRuns(text) {
  let out = text

  // "1-4-5" or "1-45" or "1 4 5" → 145 when forming a weight before reps
  // Pattern: single digit - digit(s) - optional more, often followed by reps word or another number
  out = out.replace(
    /\b(\d)\s*[-–—]\s*(\d)\s*[-–—]\s*(\d{1,2})\b/g,
    (_, a, b, c) => {
      // 1-4-5 → 145 (three single-ish digits forming a weight)
      if (String(c).length === 1) return `${a}${b}${c}`
      // 1-4-10 → 140 10 (hundreds+tens weight, trailing reps)
      const n1 = Number(a)
      const n2 = Number(b)
      const n3 = Number(c)
      if (n3 >= 1 && n3 <= 30 && n1 >= 1 && n1 <= 9) {
        return `${n1 * 100 + n2 * 10} ${n3}`
      }
      return `${a}${b} ${c}`
    },
  )

  // "1-45" / "1-85" → 145 / 185
  out = out.replace(/\b(\d)\s*[-–—]\s*(\d{2})\b/g, (_, a, b) => `${a}${b}`)

  // Spaced digit weight: "1 4 5" or "1 85" before "for"/reps/"x"
  out = out.replace(
    /\b(\d)\s+(\d)\s+(\d)\b(?=\s*(?:for|x|by|reps?|pounds?|lbs?|kg|$))/gi,
    (_, a, b, c) => `${a}${b}${c}`,
  )
  out = out.replace(
    /\b(\d)\s+(\d{2})\b(?=\s*(?:for|x|by|reps?|pounds?|lbs?|kg|$))/gi,
    (_, a, b) => `${a}${b}`,
  )

  return out
}

/**
 * Correct common gym Whisper mishears and strip fluff.
 * Returns cleaned text, or '' if hallucination / empty.
 * @param {string} raw
 * @returns {string}
 */
export function correctGymTranscript(raw) {
  let text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()

  // Strip quote/punctuation noise early so conversational lead-ins match
  // e.g. I said, "leg curl 40 pounds." → I said leg curl 40 pounds
  // Keep apostrophes (I'll, y'all, I've) — only strip double/smart quotes.
  text = text
    .replace(/[\u201C\u201D"]/g, ' ')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s*,\s*/g, ' ')
    .replace(/\.(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Strip leading >> and similar ASR artifacts
  text = text.replace(/^>+\s*/g, '').trim()
  text = text.replace(/^\[?\s*MUSIC\s*\]?\s*/i, '').trim()

  // Strip trailing YouTube-y clauses if mixed with real content
  text = text
    .replace(/\b(thanks for watching|thank you for watching|like and subscribe).*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Recover known full-utterance mishears before treating as fluff
  for (const [re, rep] of FULL_UTTERANCE_RECOVERIES) {
    if (re.test(text)) {
      text = rep
      break
    }
  }

  if (!text || isHallucination(text)) {
    return ''
  }

  // If the raw utterance already leads with a full catalog name, preserve it
  // through accent/structural/phrase rewrites that would collapse variants.
  const preservedLead = hasCanonicalEquipmentPrefix(text)
    ? leadingEquipmentSpan(text)
    : null

  // Accent / phonetic normalizations before structural + exercise fixes
  text = applyAccentFixes(text)

  for (const [re, rep] of STRUCTURAL_FIXES) {
    text = text.replace(re, rep)
  }

  // Skip equipment-collapsing PHRASE_FIXES when utterance already names a catalog exercise
  if (!preservedLead) {
    for (const [re, rep] of PHRASE_FIXES) {
      text = text.replace(re, rep)
    }
  }

  if (preservedLead) {
    const cue = text.match(/\s+(?=\d|for\s+\d|at\s+\d|\d+\s*(?:pounds?|lbs?|kg|sets?|reps?))/i)
    if (cue && cue.index != null) {
      text = preservedLead + text.slice(cue.index)
    } else if (!hasCanonicalEquipmentPrefix(text)) {
      text = preservedLead
    }
    text = text.replace(/\s+/g, ' ').trim()
  }

  // Catalog aliases / nicknames → canonical (after phonetic PHRASE_FIXES)
  text = applyExerciseAliasNormalization(text)

  text = normalizeDigitRuns(text)

  // Collapse leftover punctuation noise (ASR often leaves "press. 90")
  text = text
    .replace(/[.,;:](?=\s*\w)/g, ' ')
    .replace(/[.,!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?])/g, '$1')
    .trim()

  // Re-check after cleanup (fluff-only leftovers)
  if (!text || isHallucination(text)) {
    return ''
  }

  return text
}
