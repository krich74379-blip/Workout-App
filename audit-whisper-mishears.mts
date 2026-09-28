/**
 * Full-catalog INTENTIONAL mispronunciation audit.
 * Deliberately mangles every exercise name (Whisper / Safari Heard / Southern US style),
 * plus gym words (sets→seats/sex/syllables, pounds→pahnds, etc.), then checks
 * correctGymTranscript + parseSetUtterance recover the right exercise.
 *
 * Run: npx tsx scripts/audit-whisper-mishears.mts
 */
import fs from 'fs'
import { correctGymTranscript } from '../shared/gymTranscript.mjs'
import { parseSetUtterance } from '../src/lib/parseSetUtterance.ts'
import catalog from '../shared/exerciseCatalog.json' with { type: 'json' }

const library = catalog.exercises.map((e: { name: string }) => e.name)
const equipmentAliases: Record<string, string> = {}
for (const e of catalog.exercises) {
  equipmentAliases[e.name.toLowerCase()] = e.name
  for (const a of e.aliases ?? []) {
    const k = a.toLowerCase()
    if (!equipmentAliases[k]) equipmentAliases[k] = e.name
  }
}

type Expect = {
  equipment: string
  weight?: number
  reps?: number
  setCount?: number
  kind?: 'strength' | 'cardio'
  miles?: number
  flights?: number
  calories?: number
  minutes?: number
}

function check(raw: string, expect: Expect) {
  const cleaned = correctGymTranscript(raw) || raw
  const got = parseSetUtterance(cleaned, {
    equipmentNames: library,
    equipmentAliases,
    preferredUnit: 'lb' as const,
  })
  const setCount = expect.setCount ?? 1
  const cardio = expect.kind === 'cardio'
  const ok = cardio
    ? !!got &&
      got.equipmentName.toLowerCase() === expect.equipment.toLowerCase() &&
      got.kind === 'cardio' &&
      (expect.miles === undefined || got.miles === expect.miles) &&
      (expect.flights === undefined || got.flights === expect.flights) &&
      (expect.calories === undefined || got.calories === expect.calories) &&
      (expect.minutes === undefined || got.minutes === expect.minutes)
    : !!got &&
      got.equipmentName.toLowerCase() === expect.equipment.toLowerCase() &&
      got.weight === (expect.weight ?? 0) &&
      got.reps === (expect.reps ?? 0) &&
      got.setCount === setCount
  return { ok, raw, cleaned, got, expect: { ...expect, setCount } }
}

/** Word-level intentional Whisper / Southern US + GA / Safari mangling (look-ahead). */
const WORD_MANGLES: Record<string, string[]> = {
  bicep: ['isa', 'ice', 'iza', 'issa', 'i said', 'i say', 'eye said', "i've said", 'by cep', 'by', 'bi', 'buzz lip', 'bicyclo', 'bysicle', 'bye sep', 'bye seth', 'by seth', 'bi seth', 'visa', 'busy lip'],
  biceps: ['by ceps', 'byceps', 'isa', 'ice', 'i said'],
  curl: ['curls', 'carl', 'cull', 'girl', 'pearl', 'kernel'],
  curls: ['curl', 'carls', 'girls'],
  calf: ['caf', 'half', 'cough', 'calves', 'cahf', 'brussels'],
  press: ['prest', 'pressed', 'breast', 'presses'],  // guest/overheard via phraseHallucinations
  leg: ['lag', 'lake', 'lead', 'like'],
  bench: ['bens', 'beach', 'binged', 'vench', 'pen', 'binch', 'bent', 'vench'],
  squat: ['squad', 'scott', 'squats', 'squash', 'squad goals'],
  deadlift: ['dead lift', 'deads', 'deadline', 'dead leaf'],
  romanian: ['romania', 'rdl'],
  tricep: ['try cep', 'tri cep', 'tryceps'],
  triceps: ['try ceps', 'tri ceps'],
  glute: ['glue', 'flute', 'gloot', 'glut'],
  kickback: ['kick back', 'kickbacks'],
  pulldown: ['pull down', 'pull-down', 'pulldowns'],
  pull: ['pole', 'pool', 'pul'],
  row: ['roll', 'rho', 'roe', 'rows', 'rose'],
  raise: ['race', 'rays', 'raises'],
  extension: ['extention', 'extensions', 'extends'],
  machine: ['machines', 'mashine'],
  dumbbell: ['dumb bell', 'db'],
  barbell: ['bar bell', 'bb'],
  overhead: ['over head'],
  lateral: ['laterals'],
  seated: ['seat ed', 'seeded'],
  incline: ['in cline'],
  decline: ['de cline'],
  butterfly: ['butter fly', 'butterflies'],
  abduction: ['abduction', 'abductions'],
  adduction: ['adduction', 'adductions'],
  shrug: ['shrugs', 'shrug'],
  lunge: ['lunch', 'lunges', 'lounge'],
  bike: ['bikes'],
  chin: ['shin', 'chin up'],
  skull: ['school', 'scull', 'skulls'],
  dip: ['dips'],
  crunch: ['crunches'],
  plank: ['planks'],
  bridge: ['bridges'],
  thrust: ['trust', 'thrusts'],
  fly: ['flye', 'flyes', 'flies'],
  flye: ['fly', 'flyes'],
  pullover: ['pull over'],
  pushdown: ['push down', 'pushdowns'],
  'push-up': ['push up', 'pushups'],
  'pull-up': ['pull up', 'pullups', 'pole up'],
  'chin-up': ['chin up', 'chinups', 'shin up'],
  woodchop: ['wood chop', 'wood chops', 'chop'],
  captain: ['captains', "captain's"],
  crusher: ['crushers'],
  face: ['faith'],
  neck: ['neck'],
  chop: ['shop'],
  treadmill: ['trade mill', 'tred mill', 'tread mill', 'treadmil', 'run mill'],
  elliptical: ['ellipticle', 'ellipti cal', 'eliptical', 'cross trainer'],
  stepmaster: ['step master', 'stair master', 'stairmaster', 'step mill', 'stepmill'],
  cycle: ['cycles', 'cycling', 'bike'],
  indoor: ['in door'],
  stationary: ['stationery', 'stationairy'],
  recumbent: ['recum bent'],
  skierg: ['ski erg', 'ski machine'],
  spin: ['spin'],
  rope: ['ropes'],
  stair: ['stairs'],
}

/** Intentional Apple/Whisper mishears per cardio catalog name (full phrases). */
const CARDIO_PHRASE_MISHEARS: Record<string, string[]> = {
  Treadmill: [
    'trade mill', 'trade mills', 'tred mill', 'tread mill', 'treadmil', 'run mill', 'running machine', 'tread',
  ],
  Elliptical: [
    'ellipticle', 'ellipti cal', 'eliptical', 'elliptic al', 'cross trainer', 'elliptical machine',
  ],
  'Stair Step Machine': [
    'step master', 'stair master', 'stairmaster', 'step mill', 'stepmill',
    'stair stepper', 'stairs stepper', 'stair temper', 'stairs temper',
    'stairs tempers', 'stair tempers', 'stairstepper', 'stair climber',
    'stairs diaper', 'stair diaper', 'stairs diapers', 'stair diapers',
    'stairs diaper machine', 'stair diaper machine',
  ],
  'Spin Bike': ['spin bike', 'spin bikes', 'spin-bike', 'spin class bike'],
  'Stationary Bike': ['stationary bike', 'stationery bike', 'stationairy bike', 'stationary cycle'],
  'Indoor Cycle': [
    'indoor cycle', 'in door cycle', 'indoor bike', 'exercise bike', 'cycling', 'studio bike',
  ],
  'Air Bike': ['air bike', 'airbike', 'fan bike', 'assault bike', 'assault air bike'],
  'Echo Bike': ['echo bike', 'echo-bike', 'echo bikes'],
  'Arc Trainer': ['arc trainer', 'ark trainer', 'arc trainor', 'arctainer'],
  SkiErg: ['skierg', 'ski erg', 'ski machine', 'skiergs'],
  'Assault Runner': ['assault runner', 'assault run', 'treadmill assault'],
  'Jump Rope': ['jump rope', 'jumping rope', 'skip rope', 'skipping rope', 'skipping'],
  'Recumbent Bike': ['recumbent bike', 'recum bent bike', 'recumbent', 'reclining bike'],
  'Row Machine': [
    'row machine', 'roll machine', 'rowing machine', 'rower', 'rowing', 'concept2', 'concept 2', 'concept2 rower',
  ],
}

/** Cardio metric templates with intentional unit mangling + word numbers. */
function cardioMetricTemplates(spoken: string): {
  raw: string
  miles?: number
  flights?: number
  calories?: number
  minutes?: number
}[] {
  const isStair = /stair|step\s*master|stepmaster|step\s*mill|stepmill|climber|diaper|temper|stepper/i.test(
    spoken,
  )
  if (isStair) {
    return [
      { raw: `${spoken} 10 flights 200 calories 35 minutes`, flights: 10, calories: 200, minutes: 35 },
      { raw: `${spoken} 10 plots of stairs 200 calories 35 minutes`, flights: 10, calories: 200, minutes: 35 },
      { raw: `${spoken} ten flights 35 minutes 250`, flights: 10, calories: 250, minutes: 35 },
      { raw: `${spoken} 10 flights of stairs 250 calories 20 minutes`, flights: 10, calories: 250, minutes: 20 },
      { raw: `${spoken} ten thoughts a stay two 100 calories`, flights: 10, calories: 200, minutes: 30 },
      { raw: `${spoken} 20 minnits 200 caloreys`, calories: 200, minutes: 20 },
      { raw: `${spoken} 15 minutes`, minutes: 15 },
      { raw: `${spoken} 35 minutes 250`, calories: 250, minutes: 35 },
    ]
  }
  return [
    { raw: `${spoken} for two miles 30 minutes 150 calories`, miles: 2, calories: 150, minutes: 30 },
    { raw: `${spoken} 3 miles 250 calories 30 minutes`, miles: 3, calories: 250, minutes: 30 },
    { raw: `${spoken} 20 minnits 100 caleries`, calories: 100, minutes: 20 },
    { raw: `${spoken} 15 minits 200 calory`, calories: 200, minutes: 15 },
    { raw: `${spoken} 4 miles 30 minutes 150 000`, miles: 4, calories: 150, minutes: 30 },
    { raw: `${spoken} 4 miles 30 minutes 150 ooo`, miles: 4, calories: 150, minutes: 30 },
    { raw: `${spoken} two miles 20 minutes`, miles: 2, minutes: 20 },
    { raw: `${spoken} 25 minutes 180 caloreys`, calories: 180, minutes: 25 },
    { raw: `${spoken} 4 miiles 20 minuites 200 calories`, miles: 4, calories: 200, minutes: 20 },
    { raw: `${spoken} 10 minutes`, minutes: 10 },
    { raw: `${spoken} 35 minutes 250`, calories: 250, minutes: 35 },
  ]
}


/** Reverse map: spoken alias → canonical catalog name (first wins from sync). */
const aliasOwner = new Map<string, string>()
for (const e of catalog.exercises) {
  aliasOwner.set(e.name.toLowerCase(), e.name)
  for (const a of e.aliases ?? []) {
    const k = a.toLowerCase()
    if (!aliasOwner.has(k)) aliasOwner.set(k, e.name)
  }
}
// Look-ahead Whisper forms that must only audit under Bicep Curl
for (const form of [
  'buy some cars', 'buy some curls', 'by some cars', 'buy sum cars',
  'boys and cars', 'buy some cards', 'by some cards', 'buy some car',
  'by some curls', 'buy sum curls', 'boys and curls', 'boys and cards',
  'buy some carts', 'by some carts', 'buy sum carts', 'boys and carts',
  'buy sum cards', 'by sum cards', 'visa curls', 'busy lip curls', 'busy lip',
]) {
  if (!aliasOwner.has(form)) aliasOwner.set(form, 'Bicep Curl')
}
for (const form of ['squad goals', 'squash']) {
  if (!aliasOwner.has(form)) aliasOwner.set(form, 'Squat')
}
for (const form of ['deadline', 'dead leaf', 'dead leaves']) {
  if (!aliasOwner.has(form)) aliasOwner.set(form, 'Deadlift')
}
for (const form of ['seeded rose', 'cedar row', 'cedar roll']) {
  if (!aliasOwner.has(form)) aliasOwner.set(form, 'Seated Row')
}
for (const form of ['guest press']) {
  if (!aliasOwner.has(form)) aliasOwner.set(form, 'Chest Press')
}
for (const form of ['overheard press', 'over bread', 'over bread press']) {
  if (!aliasOwner.has(form)) aliasOwner.set(form, 'Overhead Press')
}
for (const form of ['facebook', 'facebook pull']) {
  if (!aliasOwner.has(form)) aliasOwner.set(form, 'Face Pull')
}

function mangleName(name: string): string[] {
  const lower = name.toLowerCase()
  const out = new Set<string>([lower])
  const tokens = lower.split(/[\s-]+/).filter(Boolean)

  // Token swaps (Southern/GA Whisper). Skip wild multi-word stubs mid-phrase.
  const WILD_STUBS = new Set(['isa','ice','iza','issa','i said','i say','eye said',"i've said",'by','bi','buzz lip','bicyclo','bysicle','bye sep','bye seth','by seth','bi seth','visa','busy lip','ohp','deep','crush','lat','outer thigh','inner thigh','squad goals','facebook','overheard','deadline','guest press','seeded rose'])
  for (let i = 0; i < tokens.length; i++) {
    const alts = WORD_MANGLES[tokens[i]]
    if (!alts) continue
    for (const alt of alts.slice(0, 6)) {
      if (tokens.length > 2 && WILD_STUBS.has(alt)) continue
      if (alt.includes(' ') && tokens.length > 2) continue
      const copy = [...tokens]
      copy[i] = alt
      out.add(copy.join(' '))
    }
  }

  // Conversational stub look-ahead for bicep-class — ONLY short names (avoid
  // "lying isa cable curl on bench" style mid-phrase corruption on long lifts)
  // Conversational I-said stubs: short curl/bicep names only
  if (tokens.length <= 2 && (tokens.includes('bicep') || tokens.includes('biceps') || tokens.some((t) => t.startsWith('curl')))) {
    out.add('i said curls')
    out.add('i said leg curls')
    out.add('i said lag curl')
    out.add('i say curls')
    out.add('eye said curls')
    out.add("i've said curls")
    out.add('isa curls')
  }
  // Safari Heard buy/cars/seth family is bare bicep curl only (not Cable Crossover Bicep Curl)
  if (tokens.length <= 2 && (lower === 'bicep curl' || lower === 'biceps curl' || lower === 'bicep curls' || lower === 'biceps curls')) {
    out.add('buy some cars')
    out.add('bye seth curl')
    out.add('by seth curl')
    out.add('bi seth curls')
    out.add('bye sep curl')
    out.add('buy some curls')
    out.add('by some cars')
    out.add('buy sum cars')
    out.add('boys and cars')
    out.add('buy some cards')
    out.add('by some cards')
    out.add('buy some car')
    out.add('buy some carts')
    out.add('by some carts')
    out.add('buy sum cards')
    out.add('visa curls')
    out.add('busy lip curls')
  }

  // Whole-phrase Whisper hallucinations (not recoverable by token swaps alone)
  const phraseHallucinations: Record<string, string[]> = {
    'bench press': ['pinterest', 'pintrest', 'pin terest', 'pin interest', 'pinter est', 'bens press', 'binged press', 'beach press', 'pen press'],
    'incline bench press': ['incline pinterest', 'incline bens press', 'in cline bench press', 'incline beach press'],
    'decline bench press': ['decline pinterest', 'decline bens press', 'de cline bench press'],
    'bicep curl': ['isa curls', 'i said curls', 'ice curls', 'bicyclo', 'by curls', 'buzz lip curls', 'buy some cars', 'buy some curls', 'by some cars', 'buy sum cars', 'boys and cars', 'buy some cards', 'by some cards', 'buy some car', 'buy some carts', 'by some carts', 'buy sum cards', 'visa curls', 'busy lip curls', 'bye seth curl', 'by seth curl', 'bi seth curls', 'bye sep curl'],
    // buy/cars/cards/carts/or-so family (Safari Heard look-ahead)
    'calf press': ['caf press', 'half press', 'cough press', 'cahf press', 'half past'],
    'calf raise': ['caf raise', 'half raise', 'cough raise', 'cahf raise'],
    'leg curl': ['lag curl', 'lake curl', 'leg girl', 'leg pearl', 'i girls'],
    'leg press': ['lag press', 'lake press', 'leg prest'],
    'skull crusher': ['school crushers', 'school crusher', 'scull crusher'],
    'hip abduction': ['outer thigh', 'ab duction'],
    'hip adduction': ['inner thigh', 'ad duction'],
    'pec deck': ['butterflies', 'peck deck', 'pec decks'],
    'romanian deadlift': ['romania deadlift', 'rdl', 'romanian dead lift'],
    'overhead press': ['over head press', 'ohp', 'overhead prest', 'overheard press', 'over bread', 'over bread press'],
    'chest press': ['chess press', 'guest press', 'chest prest'],
    'lat pulldown': ['lat pull down', 'lat pole down', 'lat pulldowns'],
    'face pull': ['face pole', 'face pool', 'face pulls', 'facebook', 'facebook pull'],
    'glute machine': ['glue machine', 'flute machine', 'gloot machine'],
    'deadlift': ['dead lift', 'deads', 'dead lifts', 'deadline', 'dead leaf', 'dead leaves'],
    'squat': ['squad', 'scott', 'squats', 'squad goals', 'squash'],
    'seated row': ['seeded row', 'seated roll', 'seat ed row', 'seeded rose', 'cedar row', 'cedar roll'],
    'tricep pushdown': ['try cep pushdown', 'tri cep push down', 'tricep push down'],
    'hammer curl': ['hammer carl', 'hammer cull', 'hammer curls'],
    'preacher curl': ['preacher carl', 'preacher cull', 'preacher curls'],
    'bulgarian split squat': ['bulgarian split squad', 'bulgarian split scott'],
    'pin press': ['pin prest', 'pin breast', 'pin presses'],
    'pin squat': ['pin scott', 'pin squad', 'pin squats'],
    'pin bench press': ['pin bens press', 'pin binge press', 'pin bench prest'],
    'treadmill': ['trade mill', 'tred mill', 'tread mill', 'treadmil', 'run mill'],
    'elliptical': ['ellipticle', 'ellipti cal', 'eliptical', 'cross trainer'],
    'stepmaster': ['step master', 'stair master', 'step mill', 'stairmaster'],
    'stair step machine': ['stairs temper', 'stair temper', 'stairs stepper', 'stair stepper', 'stairs diaper', 'stair diaper', 'step master', 'stair master', 'stairmaster', 'step mill', 'stepmill', 'stair climber'],
    'spin bike': ['spin bikes', 'spin-bike'],
    'stationary bike': ['stationery bike', 'stationairy bike'],
    'indoor cycle': ['in door cycle', 'exercise bike', 'indoor bike'],
    'air bike': ['fan bike', 'airbike', 'assault bike'],
    'arc trainer': ['ark trainer', 'arc trainor'],
    'skierg': ['ski erg', 'ski machine'],
    'jump rope': ['jumping rope', 'skipping', 'skip rope'],
    'recumbent bike': ['recum bent bike', 'reclining bike'],
    'assault runner': ['assault run', 'treadmill assault'],
  }
  const hall = phraseHallucinations[lower]
  if (hall) for (const h of hall) out.add(h)

  // Drop middle qualifiers ONLY when shortened form still resolves to SAME exercise.
  // Never emit unowned shortenings (e.g. dropping "cable" from wood-chop-with-cable).
  for (const drop of ['machine', 'dumbbell', 'barbell', 'seated', 'standing', 'cable']) {
    if (tokens.includes(drop) && tokens.length >= 3) {
      const shortened = tokens.filter((t) => t !== drop).join(' ')
      const owner = aliasOwner.get(shortened)
      if (owner === name) out.add(shortened)
    }
  }

  if (name.includes('-')) {
    out.add(lower.replace(/-/g, ' '))
    out.add(lower.replace(/-/g, ''))
  }

  const last = tokens[tokens.length - 1]
  if (last && !last.endsWith('s') && last.length > 2) {
    out.add([...tokens.slice(0, -1), last + 's'].join(' '))
  }

  return [...out].filter((s) => s.length >= 2).slice(0, 24)
}

/** Southern US + GA metric mangling (seats/sex/syllables/pahnds/drawled counts). */
function metricTemplates(spoken: string): { raw: string; weight: number; reps: number; setCount: number }[] {
  const w = 50
  const r = 10
  const s = 3
  const lower = spoken.toLowerCase()
  const curlish =
    /\b(bicep|curl|buy some|by some|buy sum|boys and|isa|buzz lip|visa|busy lip|seth)\b/.test(lower) ||
    /^(buy|by)\s+(some|sum)\s+(cars?|curls?|cards?|carts?)$/.test(lower) ||
    /^boys?\s+and\s+(cars?|curls?|cards?|carts?)$/.test(lower)
  const out: { raw: string; weight: number; reps: number; setCount: number }[] = [
    { raw: `${spoken} ${w} pounds ${r} reps ${s} sets`, weight: w, reps: r, setCount: s },
  ]
  // Soft-end or-so / or-four early so generator slice keeps them (Safari Heard class)
  if (curlish) {
    out.push(
      { raw: `${spoken} 40 pounds 10 or so`, weight: 40, reps: 10, setCount: 4 },
      { raw: `${spoken} 40 pounds 10 or four`, weight: 40, reps: 10, setCount: 4 },
    )
  }
  out.push(
    { raw: `${spoken} ${w} pounds ${s} syllables ${r}`, weight: w, reps: r, setCount: s },
    { raw: `${spoken} ${w} pounds ${r} reps ${s} seats`, weight: w, reps: r, setCount: s },
    { raw: `${spoken} ${w} pounds ${s} sex of ${r}`, weight: w, reps: r, setCount: s },
    { raw: `${spoken} ${w} pahnds ${r} wraps three seats`, weight: w, reps: r, setCount: s },
    { raw: `finna do ${spoken} fiddy pahnds tree seats of ten`, weight: w, reps: r, setCount: s },
    // Compound Southern drawls (fife-teen / faw hunnert / thriddy / too-fiddy)
    { raw: `${spoken} fife-teen pahnds for fife`, weight: 15, reps: 5, setCount: 1 },
    { raw: `${spoken} fife teen for fife`, weight: 15, reps: 5, setCount: 1 },
    { raw: `${spoken} faw hunnert pahnds tree seats of ten`, weight: 400, reps: 10, setCount: 3 },
    { raw: `${spoken} thriddy pahnds for ate`, weight: 30, reps: 8, setCount: 1 },
    { raw: `${spoken} too-fiddy pahnds for tree`, weight: 250, reps: 3, setCount: 1 },
    { raw: `${spoken} two fiddy for tree`, weight: 250, reps: 3, setCount: 1 },
  )
  return out
}

// ---- Curated Kenneth / Safari regressions ----
const curated: [string, Expect][] = [
  // Conversational I said/I say family (Safari Heard look-ahead — general pattern)
  ['I said curls 40 pounds 10 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  // I-said + hallucinated leg + raps/cents (Safari Heard look-ahead class)
  ['I said, "leg curl 40 pounds." Raps four cents', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['I said leg curl 40 pounds raps four cents', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['leg curl 40 pounds 4 sets of 10', { equipment: 'Leg Curl', weight: 40, reps: 10, setCount: 4 }],
  ['I say curls 40 pounds 10 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['I said curl 40 pounds 10 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ["I've said curls 40 pounds 10 reps four sets", { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['eye said curls 40 pounds 10 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['aye said curls 40 pounds 10 reps 4 seats', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['I sed curls 40 pounds 10 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['I said calves 90 pounds 4 seats of 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['I say squad 225 pounds 5 syllables 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 }],
  ['Isa curls 40 pounds 15 reps four seats', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['isa curls 40 pounds 15 reps four seats', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['ice curls 40 pounds 15 reps 4 seats', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['eyes curls 40 pounds 15 reps for seats', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['iza curls 40 pounds 15 reps four seats', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['issa curls 40 pounds 15 reps 4 seats', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['Bicyclo 40 pounds 4 syllables 10', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['by curls 40 pounds 15 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  // Safari Heard: buy some cars ← bicep curls; 10 or so ← 10 reps · 4 sets
  ['Buy some cars 40 pounds 10 or so', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['buy some cars 40 pounds 10 or so', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['buy some curls 40 pounds 10 or so', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['by some cars 40 pounds 10 or so', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['buy sum cars 40 pounds 10 or so', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['boys and cars 40 pounds 10 or so', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['buy some cards 40 pounds 10 or so', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['Buy some cars 40 pounds 10 or four', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['bicep curl 40 pounds 10 or so', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['buzz lip curls 40 pounds 15 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  // Live Heard: Bye Seth Curl ← bicep; four set → 4 sets
  ['Bye Seth Curl 40 pounds 15 reps four set', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['bye seth curl 40 pounds 15 reps four set', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['by seth curl 40 pounds 15 reps 4 set', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['bi seth curls 40 pounds 15 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['by a set of 40 pounds and 15 reps and 4 sets', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['half past 90 pounds 4 syllables 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['caf 90 pounds 4 seats of 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['lag curl 80 pounds 3 syllables 12', { equipment: 'Leg Curl', weight: 80, reps: 12, setCount: 3 }],
  ['I girls both that the man at 80 pounds', { equipment: 'Leg Curl', weight: 80, reps: 15, setCount: 4 }],
  ['lag press 400 pounds 4 syllables 10', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4 }],
  ['binged press 185 pounds 4 syllables 8', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  // Compound Southern drawls
  ['squat fife-teen pahnds for fife', { equipment: 'Squat', weight: 15, reps: 5, setCount: 1 }],
  ['leg press faw hunnert pahnds tree seats of ten', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 3 }],
  ['bench press thriddy pahnds for ate', { equipment: 'Bench Press', weight: 30, reps: 8, setCount: 1 }],
  ['deadlift too-fiddy pahnds for tree', { equipment: 'Deadlift', weight: 250, reps: 3, setCount: 1 }],
  ['deadlift two fiddy for tree', { equipment: 'Deadlift', weight: 250, reps: 3, setCount: 1 }],
  // Safari Heard: Pinterest ← bench press (NOT Pin Press)
  ['Pinterest 50 pounds', { equipment: 'Bench Press', weight: 50, reps: 0, setCount: 1 }],
  ['Pinterest 50 pounds 6 sets of 10', { equipment: 'Bench Press', weight: 50, reps: 10, setCount: 6 }],
  ['pin terest 50 pounds', { equipment: 'Bench Press', weight: 50, reps: 0, setCount: 1 }],
  ['pintrest 50 pounds 6 sets of 10', { equipment: 'Bench Press', weight: 50, reps: 10, setCount: 6 }],
  ['pin interest 50 pounds', { equipment: 'Bench Press', weight: 50, reps: 0, setCount: 1 }],
  // Real Pin Press must still resolve (not collapsed to Bench)
  ['pin press 185 for 5', { equipment: 'Pin Press', weight: 185, reps: 5, setCount: 1 }],

  ['squad 225 pounds 5 syllables 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 }],
  ['school crushers 60 pounds 3 sets of 10', { equipment: 'Skull Crusher', weight: 60, reps: 10, setCount: 3 }],
  ['outer thigh 100 pounds 3 seats of 15', { equipment: 'Hip Abduction', weight: 100, reps: 15, setCount: 3 }],
  ['inner thigh 100 pounds 3 sex of 15', { equipment: 'Hip Adduction', weight: 100, reps: 15, setCount: 3 }],
  ['butterflies 80 pounds 3 sets of 12', { equipment: 'Pec Deck', weight: 80, reps: 12, setCount: 3 }],
  ['bicep curl 40 pounds 15 reps for seats', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['seated row 100 pounds 10 reps four seats', { equipment: 'Seated Row', weight: 100, reps: 10, setCount: 4 }],
  ['air bikes 50 pounds 10 reps three seats', { equipment: 'Air Bike', weight: 50, reps: 10, setCount: 3 }],
  ['smith machine one-handed row 50 pounds 10 reps 3 seats', { equipment: 'Smith Machine One-Handed Row', weight: 50, reps: 10, setCount: 3 }],
  // Wild brand / nonsense-noun hallucinations (curl/press/squat/dead/row)
  ['buy some carts 40 pounds 10 or so', { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4 }],
  ['visa curls 40 pounds 15 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['busy lip curls 40 pounds 15 reps four sets', { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4 }],
  ['guest press 150 pounds 3 sets of 10', { equipment: 'Chest Press', weight: 150, reps: 10, setCount: 3 }],
  ['overheard press 95 pounds 5 sets of 5', { equipment: 'Overhead Press', weight: 95, reps: 5, setCount: 5 }],
  ['over bread 95 pounds 5 sets of 5', { equipment: 'Overhead Press', weight: 95, reps: 5, setCount: 5 }],
  ['facebook 50 pounds 3 sets of 12', { equipment: 'Face Pull', weight: 50, reps: 12, setCount: 3 }],
  ['facebook pull 50 pounds 3 sets of 12', { equipment: 'Face Pull', weight: 50, reps: 12, setCount: 3 }],
  ['squad goals 225 pounds 5 sets of 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 }],
  ['squash 225 pounds 5 sets of 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 }],
  ['deadline 225 pounds 3 sets of 3', { equipment: 'Deadlift', weight: 225, reps: 3, setCount: 3 }],
  ['dead leaf 225 pounds 3 sets of 3', { equipment: 'Deadlift', weight: 225, reps: 3, setCount: 3 }],
  ['seeded rose 100 pounds 10 reps four sets', { equipment: 'Seated Row', weight: 100, reps: 10, setCount: 4 }],
  ['cedar row 100 pounds 10 reps 3 sets', { equipment: 'Seated Row', weight: 100, reps: 10, setCount: 3 }],
  // Cardio Apple/Whisper mispronunciations (Heard)
  ['roll machine for four miles 30 minutes 150 000', { equipment: 'Row Machine', kind: 'cardio', miles: 4, calories: 150, minutes: 30 }],
  ['trade mill for two miles 30 minutes 150 calories', { equipment: 'Treadmill', kind: 'cardio', miles: 2, calories: 150, minutes: 30 }],
  ['ellipticle 20 minnits 100 caleries', { equipment: 'Elliptical', kind: 'cardio', calories: 100, minutes: 20 }],
  ['stair master 20 minnits 200 caloreys', { equipment: 'Stair Step Machine', kind: 'cardio', calories: 200, minutes: 20 }],
  ['Stairs diaper 10 plots of stairs 200 calories 35 minutes', { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 200, minutes: 35 }],
  ['stair diaper 10 plots of stairs 200 calories 35 minutes', { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 200, minutes: 35 }],
  ['stairs diaper ten flights 200 calories 35 minutes', { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 200, minutes: 35 }],
  ['Stairs temper ten flights 35 minutes 250', { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 35 }],
  ['stairs temper ten flights 35 minutes 250', { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 35 }],
  ['stair temper 10 flights 35 minutes 250', { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 35 }],
  ['stairs stepper 10 flights 35 minutes 250', { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 35 }],
  ['fan bike 20 minits 250 calory', { equipment: 'Air Bike', kind: 'cardio', calories: 250, minutes: 20 }],
  ['stationery bike two miles 30 minutes', { equipment: 'Stationary Bike', kind: 'cardio', miles: 2, minutes: 30 }],
  ['in door cycle 4 miles 200 calories 20 minutes', { equipment: 'Indoor Cycle', kind: 'cardio', miles: 4, calories: 200, minutes: 20 }],
  ['ark trainer 20 minutes', { equipment: 'Arc Trainer', kind: 'cardio', minutes: 20 }],
  ['ski machine 12 minutes 100 calories', { equipment: 'SkiErg', kind: 'cardio', calories: 100, minutes: 12 }],
  ['assault run 1 mile 10 minutes', { equipment: 'Assault Runner', kind: 'cardio', miles: 1, minutes: 10 }],
  ['skipping 5 minutes', { equipment: 'Jump Rope', kind: 'cardio', minutes: 5 }],
  ['recum bent bike 30 minutes 150 calories', { equipment: 'Recumbent Bike', kind: 'cardio', calories: 150, minutes: 30 }],
  ['echo bike 15 minutes', { equipment: 'Echo Bike', kind: 'cardio', minutes: 15 }],
  ['spin bike 5 miles 20 minutes', { equipment: 'Spin Bike', kind: 'cardio', miles: 5, minutes: 20 }],

]

type Row = ReturnType<typeof check> & { exercise: string; kind: string }

const curatedFails: Row[] = []
const curatedPass: Row[] = []
for (const [raw, expect] of curated) {
  const r = { ...check(raw, expect), exercise: expect.equipment, kind: 'curated' }
  ;(r.ok ? curatedPass : curatedFails).push(r)
}

const genFails: Row[] = []
const genPass: Row[] = []
const perExercise = new Map<string, { pass: number; fail: number; samples: Row[] }>()

const cardioPass: Row[] = []
const cardioFails: Row[] = []
const cardioPer = new Map<string, { pass: number; fail: number; samples: Row[] }>()

for (const e of catalog.exercises) {
  const isCardio = (e as { kind?: string }).kind === 'cardio'
  const spokenForms = new Set<string>()
  spokenForms.add(e.name.toLowerCase())
  for (const a of (e.aliases ?? []).slice(0, 6)) spokenForms.add(a.toLowerCase())
  for (const v of mangleName(e.name)) spokenForms.add(v)
  if (isCardio) {
    for (const m of CARDIO_PHRASE_MISHEARS[e.name] ?? []) spokenForms.add(m.toLowerCase())
  }

  let pass = 0
  let fail = 0
  const samples: Row[] = []

  for (const spoken of spokenForms) {
    const owner = aliasOwner.get(spoken.toLowerCase())
    // Cardio phrase mishears may not be in aliasOwner — allow CARDIO_PHRASE_MISHEARS forms
    const cardioOwned = isCardio && (CARDIO_PHRASE_MISHEARS[e.name] ?? []).some((m) => m.toLowerCase() === spoken.toLowerCase())
    if (owner && owner !== e.name && !cardioOwned) continue
    if (isCardio) {
      for (const t of cardioMetricTemplates(spoken).slice(0, 8)) {
        const r = {
          ...check(t.raw, {
            equipment: e.name,
            kind: 'cardio',
            miles: t.miles,
            flights: t.flights,
            calories: t.calories,
            minutes: t.minutes,
          }),
          exercise: e.name,
          kind: 'cardio-generated',
        }
        if (r.ok) {
          pass++
          genPass.push(r)
          cardioPass.push(r)
        } else {
          fail++
          genFails.push(r)
          cardioFails.push(r)
          if (samples.length < 3) samples.push(r)
        }
      }
    } else {
      for (const t of metricTemplates(spoken).slice(0, 5)) {
        const r = {
          ...check(t.raw, {
            equipment: e.name,
            weight: t.weight,
            reps: t.reps,
            setCount: t.setCount,
          }),
          exercise: e.name,
          kind: 'generated',
        }
        if (r.ok) {
          pass++
          genPass.push(r)
        } else {
          fail++
          genFails.push(r)
          if (samples.length < 3) samples.push(r)
        }
      }
    }
  }
  perExercise.set(e.name, { pass, fail, samples })
  if (isCardio) cardioPer.set(e.name, { pass, fail, samples })
}

const exercisesWithFail = [...perExercise.entries()].filter(([, v]) => v.fail > 0)
const exercisesAllPass = [...perExercise.entries()].filter(([, v]) => v.fail === 0)
const totalGen = genPass.length + genFails.length
const passRate = totalGen ? ((genPass.length / totalGen) * 100).toFixed(1) : '0'

console.log('=== CURATED (Kenneth / Safari intentional) ===')
console.log(`PASS ${curatedPass.length}  FAIL ${curatedFails.length}  TOTAL ${curated.length}`)
for (const f of curatedFails) {
  const g = f.got ? `${f.got.equipmentName} ${f.got.weight}x${f.got.reps}x${f.got.setCount}` : 'null'
  console.log(`FAIL raw=${JSON.stringify(f.raw)}`)
  console.log(`     cleaned=${JSON.stringify(f.cleaned)} got=${g}`)
}

console.log('\n=== FULL CATALOG INTENTIONAL MISPRONUNCIATIONS ===')
console.log(`exercises=${catalog.exercises.length}  allPass=${exercisesAllPass.length}  withFail=${exercisesWithFail.length}`)
console.log(`cases PASS ${genPass.length}  FAIL ${genFails.length}  TOTAL ${totalGen}  passRate=${passRate}%`)

const modes = new Map<string, number>()
for (const f of genFails) {
  let mode = 'other'
  if (!f.got) mode = 'parse-null'
  else if (f.got.equipmentName.toLowerCase() !== f.expect.equipment.toLowerCase()) mode = `equip→${f.got.equipmentName}`
  else if (f.got.setCount !== f.expect.setCount) mode = 'setCount'
  else if (f.got.reps !== f.expect.reps) mode = 'reps'
  else if (f.got.weight !== f.expect.weight) mode = 'weight'
  modes.set(mode, (modes.get(mode) || 0) + 1)
}
const topModes = [...modes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)
console.log('\nTop failure modes:')
for (const [m, n] of topModes) console.log(`  ${n}\t${m}`)

const worst = exercisesWithFail
  .map(([name, v]) => ({ name, ...v, rate: v.pass / Math.max(1, v.pass + v.fail) }))
  .sort((a, b) => a.rate - b.rate || b.fail - a.fail)
  .slice(0, 35)
console.log('\nWorst exercises:')
for (const w of worst) console.log(`  ${(w.rate * 100).toFixed(0)}%  fail=${w.fail}  ${w.name}`)

const maxPrint = Number(process.env.AUDIT_MAX_FAIL_PRINT || 40)
console.log(`\nSample equipment mismatches (max ${maxPrint}):`)
let printed = 0
for (const f of genFails) {
  if (printed >= maxPrint) break
  if (f.got && f.got.equipmentName.toLowerCase() === f.expect.equipment.toLowerCase()) continue
  const g = f.got ? `${f.got.equipmentName} ${f.got.weight}x${f.got.reps}x${f.got.setCount}` : 'null'
  console.log(`FAIL [${f.exercise}] raw=${JSON.stringify(f.raw)}`)
  console.log(`     cleaned=${JSON.stringify(f.cleaned)} got=${g}`)
  printed++
}

const summary = {
  curated: { pass: curatedPass.length, fail: curatedFails.length, total: curated.length },
  generated: {
    exercises: catalog.exercises.length,
    allPass: exercisesAllPass.length,
    withFail: exercisesWithFail.length,
    pass: genPass.length,
    fail: genFails.length,
    passRate: Number(passRate),
  },
  topModes,
  worst: worst.slice(0, 50).map((w) => ({
    name: w.name,
    pass: w.pass,
    fail: w.fail,
    rate: Number(w.rate.toFixed(3)),
    samples: w.samples.map((s) => ({
      raw: s.raw,
      cleaned: s.cleaned,
      got: s.got
        ? { equipment: s.got.equipmentName, weight: s.got.weight, reps: s.got.reps, setCount: s.got.setCount }
        : null,
    })),
  })),
  curatedFailures: curatedFails.map((f) => ({ raw: f.raw, cleaned: f.cleaned, got: f.got?.equipmentName ?? null })),
}
const cardioExercises = catalog.exercises.filter((e: { kind?: string }) => e.kind === 'cardio')
const cardioAllPass = [...cardioPer.entries()].filter(([, v]) => v.fail === 0)
const cardioWithFail = [...cardioPer.entries()].filter(([, v]) => v.fail > 0)
const cardioTotal = cardioPass.length + cardioFails.length
const cardioRate = cardioTotal ? ((cardioPass.length / cardioTotal) * 100).toFixed(1) : '0'
console.log('\n=== CARDIO MISPRONUNCIATION CORPUS (Apple/Whisper) ===')
console.log(`machines=${cardioExercises.length}  allPass=${cardioAllPass.length}  withFail=${cardioWithFail.length}`)
console.log(`cases PASS ${cardioPass.length}  FAIL ${cardioFails.length}  TOTAL ${cardioTotal}  passRate=${cardioRate}%`)
for (const [name, v] of cardioWithFail) {
  console.log(`  FAIL ${name}: pass=${v.pass} fail=${v.fail}`)
  for (const s of v.samples) {
    console.log(`    raw=${JSON.stringify(s.raw)} cleaned=${JSON.stringify(s.cleaned)} got=${s.got?.equipmentName ?? 'null'} ${s.got?.miles ?? '-'}mi ${s.got?.flights ?? '-'}fl ${s.got?.calories ?? '-'}cal ${s.got?.minutes ?? '-'}min`)
  }
}
;(summary as Record<string, unknown>).cardio = {
  machines: cardioExercises.map((e: { name: string }) => e.name),
  allPass: cardioAllPass.length,
  withFail: cardioWithFail.length,
  pass: cardioPass.length,
  fail: cardioFails.length,
  passRate: Number(cardioRate),
}
fs.writeFileSync('/tmp/whisper-audit-summary.json', JSON.stringify(summary, null, 2))
console.log('\nWrote /tmp/whisper-audit-summary.json')
if (cardioFails.length > 0 || curatedFails.some((f) => f.expect.kind === 'cardio')) {
  console.error('\nCARDIO CORPUS NOT 100% — failing audit')
  process.exit(1)
}
console.log('\nCardio mispronunciation corpus: 100%')
