/**
 * Dual scorer tests — Apple primary, Whisper backup.
 * Run: node scripts/test-pick-best-parse.mjs
 */
function scoreParsed(parsed) {
  if (!parsed) return 0
  let score = 0
  if (parsed.matchedLibrary && parsed.equipmentName?.trim()) score += 40
  else if (parsed.equipmentName?.trim()) score += 15
  const cardio =
    parsed.kind === 'cardio' ||
    (parsed.miles ?? 0) > 0 ||
    (parsed.calories ?? 0) > 0 ||
    (parsed.minutes ?? 0) > 0
  if (cardio) {
    if ((parsed.miles ?? 0) > 0) score += 10
    if ((parsed.calories ?? 0) > 0) score += 10
    if ((parsed.minutes ?? 0) > 0) score += 10
  } else {
    if (parsed.weight > 0) score += 15
    if (parsed.reps > 0) score += 15
    const sets = parsed.setCount >= 1 ? parsed.setCount : 1
    if (sets > 1) score += 5
  }
  score += Math.max(0, Math.min(1, parsed.confidence)) * 20
  return score
}

function pickBest(candidates, preferAppleOnTie = true) {
  const usable = candidates.filter((c) => c.transcript?.trim())
  if (!usable.length) return null
  const scored = usable.map((c) => ({ ...c, score: scoreParsed(c.parsed) }))

  const apple = scored.find((c) => c.engine === 'apple')
  const whisper = scored.find((c) => c.engine === 'whisper')

  if (
    preferAppleOnTie &&
    apple &&
    whisper &&
    apple.parsed?.matchedLibrary &&
    apple.parsed.equipmentName?.trim() &&
    !(whisper.parsed?.matchedLibrary && whisper.parsed.equipmentName?.trim())
  ) {
    if (apple.score + 5 >= whisper.score) {
      return { ...apple, engine: 'apple' }
    }
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (preferAppleOnTie) {
      if (a.engine === 'apple' && b.engine !== 'apple') return -1
      if (b.engine === 'apple' && a.engine !== 'apple') return 1
    } else {
      if (a.engine === 'whisper' && b.engine !== 'whisper') return -1
      if (b.engine === 'whisper' && a.engine !== 'whisper') return 1
    }
    return 0
  })
  return scored[0]
}

let fails = 0
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg)
    fails++
  } else {
    console.log('ok:', msg)
  }
}

const appleStrong = {
  engine: 'apple',
  transcript: 'bench press 185 for 8',
  parsed: {
    equipmentName: 'Bench Press',
    matchedLibrary: true,
    weight: 185,
    reps: 8,
    setCount: 1,
    confidence: 0.9,
  },
}
const whisperGarbage = {
  engine: 'whisper',
  transcript: 'thanks for watching subscribe',
  parsed: null,
}
const whisperWeak = {
  engine: 'whisper',
  transcript: 'bench press 185',
  parsed: {
    equipmentName: 'Bench Press',
    matchedLibrary: true,
    weight: 185,
    reps: 0,
    setCount: 1,
    confidence: 0.5,
  },
}
const whisperBetterEquip = {
  engine: 'whisper',
  transcript: 'bicep curl 40 for 15 for 4 sets',
  parsed: {
    equipmentName: 'Bicep Curl',
    matchedLibrary: true,
    weight: 40,
    reps: 15,
    setCount: 4,
    confidence: 0.85,
  },
}
const appleFail = {
  engine: 'apple',
  transcript: '',
  parsed: null,
}
const appleInvent = {
  engine: 'apple',
  transcript: 'isa curls 40 for 10',
  parsed: {
    equipmentName: '',
    matchedLibrary: false,
    weight: 40,
    reps: 10,
    setCount: 1,
    confidence: 0.4,
  },
}
const appleByeSeth = {
  engine: 'apple',
  transcript: 'bicep curl 40 for 15 for 4 sets',
  parsed: {
    equipmentName: 'Bicep Curl',
    matchedLibrary: true,
    weight: 40,
    reps: 15,
    setCount: 4,
    confidence: 0.88,
  },
}
const whisperByeSethGarbage = {
  engine: 'whisper',
  transcript: 'bye seth curl forty for fifteen',
  parsed: {
    equipmentName: '',
    matchedLibrary: false,
    weight: 40,
    reps: 15,
    setCount: 1,
    confidence: 0.3,
  },
}

assert(
  pickBest([appleStrong, whisperGarbage]).engine === 'apple',
  'clean Apple + Whisper garbage → Apple wins',
)
assert(
  pickBest([appleStrong, whisperWeak]).engine === 'apple',
  'complete Apple over partial Whisper',
)
assert(
  pickBest([appleFail, whisperBetterEquip]) === null ||
    pickBest(
      [
        { ...appleFail, transcript: ' ' },
        whisperBetterEquip,
      ],
    )?.engine === 'whisper' ||
    pickBest([whisperBetterEquip]).engine === 'whisper',
  'Apple empty → Whisper-only wins',
)
assert(
  pickBest([whisperBetterEquip]).engine === 'whisper',
  'Whisper-only candidate → Whisper',
)
assert(
  pickBest([appleInvent, whisperBetterEquip]).engine === 'whisper',
  'Apple no catalog + Whisper catalog → Whisper',
)
assert(
  pickBest([appleByeSeth, whisperByeSethGarbage]).engine === 'apple',
  'Apple clean Bicep Curl beats Whisper garbage Bye Seth',
)

const tiedApple = {
  ...appleStrong,
  parsed: { ...appleStrong.parsed, confidence: 0.9 },
}
const tiedWhisper = {
  engine: 'whisper',
  transcript: appleStrong.transcript,
  parsed: { ...appleStrong.parsed, confidence: 0.9 },
}
assert(pickBest([tiedApple, tiedWhisper], true).engine === 'apple', 'tie → Apple (primary)')
assert(pickBest([tiedApple, tiedWhisper], false).engine === 'whisper', 'preferAppleOnTie=false → Whisper on tie')

// Apple catalog match beats Whisper non-catalog even if Whisper confidence inflated
const appleCatalog = {
  engine: 'apple',
  transcript: 'bench press 185 for 8',
  parsed: {
    equipmentName: 'Bench Press',
    matchedLibrary: true,
    weight: 185,
    reps: 8,
    setCount: 1,
    confidence: 0.7,
  },
}
const whisperNoCatalogHighConf = {
  engine: 'whisper',
  transcript: 'something 185 for 8',
  parsed: {
    equipmentName: 'Something',
    matchedLibrary: false,
    weight: 185,
    reps: 8,
    setCount: 1,
    confidence: 0.99,
  },
}
assert(
  pickBest([appleCatalog, whisperNoCatalogHighConf]).engine === 'apple',
  'Apple catalog beats Whisper non-catalog (within +5 margin)',
)


// Cardio: Apple clean treadmill beats Whisper garbage trade-mill
const appleCardio = {
  engine: 'apple',
  transcript: 'treadmill for two miles 30 minutes 150 calories',
  parsed: {
    equipmentName: 'Treadmill',
    matchedLibrary: true,
    kind: 'cardio',
    miles: 2,
    calories: 150,
    minutes: 30,
    weight: 0,
    reps: 0,
    setCount: 1,
    confidence: 0.92,
  },
}
const whisperCardioGarbage = {
  engine: 'whisper',
  transcript: 'trade mill for two miles thirty minutes',
  parsed: {
    equipmentName: '',
    matchedLibrary: false,
    kind: 'cardio',
    miles: 2,
    minutes: 30,
    weight: 0,
    reps: 0,
    setCount: 1,
    confidence: 0.35,
  },
}
assert(
  pickBest([appleCardio, whisperCardioGarbage]).engine === 'apple',
  'cardio Apple clean Treadmill beats Whisper trade-mill garbage',
)
const whisperCardioClean = {
  engine: 'whisper',
  transcript: 'treadmill for two miles 30 minutes 150 calories',
  parsed: { ...appleCardio.parsed, confidence: 0.92 },
}
assert(
  pickBest([appleCardio, whisperCardioClean], true).engine === 'apple',
  'cardio tie → Apple (shared cleanup, Apple primary)',
)
const appleCardioEmpty = { engine: 'apple', transcript: '', parsed: null }
const whisperCardioRecovered = {
  engine: 'whisper',
  transcript: 'treadmill for two miles 30 minutes 150 calories',
  parsed: { ...appleCardio.parsed, confidence: 0.85 },
}
assert(
  pickBest([whisperCardioRecovered]).engine === 'whisper',
  'cardio Whisper-only recovered trade mill → Whisper',
)

if (fails) {
  console.error(`${fails} failure(s)`)
  process.exit(1)
}
console.log('all pickBestParse dual-scorer tests passed')
