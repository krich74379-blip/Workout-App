import { parseSetUtterance } from '../src/lib/parseSetUtterance'
import { correctGymTranscript } from '../shared/gymTranscript.mjs'
import { EXERCISE_CATALOG } from '../src/data/exerciseCatalog'

const library = EXERCISE_CATALOG.map((e) => e.name)
const equipmentAliases: Record<string, string> = {}
for (const e of EXERCISE_CATALOG) {
  equipmentAliases[e.name.toLowerCase()] = e.name
  for (const a of e.aliases ?? []) {
    const k = a.toLowerCase()
    if (!equipmentAliases[k]) equipmentAliases[k] = e.name
  }
}

type Case = {
  input: string
  lockedEquipment?: string
  lockedKind?: 'strength' | 'cardio'
  expect: {
    equipment?: string
    weight?: number
    reps?: number
    setCount?: number
    unit?: 'lb' | 'kg'
    kind?: 'strength' | 'cardio'
    miles?: number
    flights?: number
    calories?: number
    minutes?: number
  }
}

const cases: Case[] = [
  { input: 'bench press 185 for 8', expect: { equipment: 'Bench Press', weight: 185, reps: 8 } },
  { input: 'Bench press, 185 for eight.', expect: { equipment: 'Bench Press', weight: 185, reps: 8 } },
  { input: 'bench press 185 x 8', expect: { equipment: 'Bench Press', weight: 185, reps: 8 } },
  { input: 'bench press 185x8', expect: { equipment: 'Bench Press', weight: 185, reps: 8 } },
  { input: 'bench press 185×8', expect: { equipment: 'Bench Press', weight: 185, reps: 8 } },
  { input: 'bench press 185/8', expect: { equipment: 'Bench Press', weight: 185, reps: 8 } },
  { input: 'bench press 185 8', expect: { equipment: 'Bench Press', weight: 185, reps: 8 } },
  { input: 'squat 225 pounds 5 reps', expect: { equipment: 'Squat', weight: 225, reps: 5, unit: 'lb' } },
  { input: 'squat two twenty five ten', expect: { equipment: 'Squat', weight: 225, reps: 10 } },
  { input: 'leg press one thirty five by ten', expect: { equipment: 'Leg Press', weight: 135, reps: 10 } },
  { input: 'leg press 400 four 10', expect: { equipment: 'Leg Press', weight: 400, reps: 10 } },
  { input: 'leg press 400 for 10', expect: { equipment: 'Leg Press', weight: 400, reps: 10 } },
  { input: 'lag press 400 for 10', expect: { equipment: 'Leg Press', weight: 400, reps: 10 } },
  { input: 'dumbbell curl 30 lbs times 12', expect: { equipment: 'Dumbbell Curl', weight: 30, reps: 12, unit: 'lb' } },
  // Conversational I said/I say curls family → Bicep Curl (accent look-ahead)
  { input: 'I said curls 40 pounds 10 reps four sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  // Safari Heard: I-said + Whisper-hallucinated leg curl + raps/cents → Bicep 40/10/4
  { input: 'I said, "leg curl 40 pounds." Raps four cents', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'I said leg curl 40 pounds raps four cents', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'leg curl 40 pounds 4 sets of 10', expect: { equipment: 'Leg Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'I say curls 40 pounds 10 reps four sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'I said curl 40 pounds 10 reps four sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: "I've said curls 40 pounds 10 reps four sets", expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'eye said curls 40 pounds 10 reps four sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'aye said curls 40 pounds 10 reps 4 seats', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  // Safari Heard: Isa curls + four seats
  { input: 'Isa curls 40 pounds 15 reps four seats', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'isa curls 40 pounds 15 reps four seats', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'ice curls 40 pounds 15 reps 4 seats', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'eyes curls 40 pounds 15 reps for seats', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'iza curls 40 pounds 15 reps four seats', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'issa curls 40 pounds 15 reps 4 seats', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'bicep curl 40 pounds 15 reps four sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'buzz lip curls 40 pounds 15 reps four sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'Bye Seth Curl 40 pounds 15 reps four set', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'bye seth curl 40 pounds 15 reps four set', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'by seth curl 40 pounds 15 reps 4 set', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  // Safari Heard: bicyclo + syllables ≈ bicep curl 40×10×4
  { input: 'Bicyclo 40 pounds 4 syllables 10', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bicyclo 40 pounds 4 syllable 10', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bicycle 40 pounds 4 syllables 10', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bi cycle 40 pounds four syllables ten', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bysicle 40 pounds 4 syllables 10', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'by sickle 40 pounds 4 sets of 10', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bicyclo curls 40 pounds 4 sets of 10', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bi 40 pounds 4 sets of 10', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bicep curl 40 pounds 4 symbols 10', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bicep girl 40 pounds 4 sets of 10', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'calves 90 pounds 4 sets of 15', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'lag 80 pounds 3 sets of 12', expect: { equipment: 'Leg Curl', weight: 80, reps: 12, setCount: 3, unit: 'lb' } },
  { input: 'peck deck 80 pounds 3 sets of 12', expect: { equipment: 'Pec Deck', weight: 80, reps: 12, setCount: 3, unit: 'lb' } },
  { input: 'four syllables ten at 40 pounds bicep curl', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'calf press 90 pounds 4 syllables 15', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'leg press 400 pounds 4 simples 10', expect: { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4, unit: 'lb' } },
  { input: "it s okay buzz lip curls 40 pounds 15 reps four sets", expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  // Whisper dropped curls: stub + a set of + and-chained numbers
  { input: 'by a set of 40 pounds and 15 reps and 4 sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'bi a set of 40 pounds and 15 reps and 4 sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'by a sets of 40 pounds and 15 reps and 4 sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'by the set of 40 pounds 15 reps 4 sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'buy a set of 40 pounds and 15 reps and 4 sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'bicep curl 40 pounds and 15 reps and 4 sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'caf a set of 90 pounds and 15 reps and 4 sets', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'lag a set of 80 pounds and 12 reps and 3 sets', expect: { equipment: 'Leg Curl', weight: 80, reps: 12, setCount: 3, unit: 'lb' } },
  { input: 'lag press a set of 400 pounds and 10 reps and 4 sets', expect: { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bens a set of 185 pounds and 8 reps and 4 sets', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'squad a set of 225 pounds and 5 reps and 5 sets', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 5, unit: 'lb' } },
  { input: 'rdl a set of 135 pounds and 8 reps and 3 sets', expect: { equipment: 'Romanian Deadlift', weight: 135, reps: 8, setCount: 3, unit: 'lb' } },
  { input: 'leg curl 30 12', expect: { equipment: 'Leg Curl', weight: 30, reps: 12 } },
  { input: 'bench press one eighty five for eight', expect: { equipment: 'Bench Press', weight: 185, reps: 8 } },
  { input: 'cable row 120 pounds 10 reps', expect: { equipment: 'Cable Row', weight: 120, reps: 10 } },
  { input: 'deadlift 140 kg for 3', expect: { weight: 140, reps: 3, unit: 'kg' } },
  // partial: equipment + weight only → reps 0
  { input: 'bench press 185', expect: { equipment: 'Bench Press', weight: 185, reps: 0 } },
  // set counts
  { input: 'calf press 90 pounds 3 sets of 15', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 3, unit: 'lb' } },
  { input: 'calf press 90 pounds 4 sets of 15', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'calf press 90 for 15 for 3 sets', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 3 } },
  { input: 'bench press 185 for 8 for 4 sets', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 } },
  // Safari Heard: Pinterest ← Bench Press (not Pin Press)
  { input: 'Pinterest 50 pounds', expect: { equipment: 'Bench Press', weight: 50, reps: 0, setCount: 1, unit: 'lb' } },
  { input: 'Pinterest 50 pounds 6 sets of 10', expect: { equipment: 'Bench Press', weight: 50, reps: 10, setCount: 6, unit: 'lb' } },
  { input: 'pin terest 50 pounds', expect: { equipment: 'Bench Press', weight: 50, reps: 0, setCount: 1, unit: 'lb' } },
  { input: 'pin press 185 for 5', expect: { equipment: 'Pin Press', weight: 185, reps: 5, setCount: 1 } },
  { input: 'squat 225 5 sets of 5', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 } },
  { input: 'squat 4 sets of 15 at 200lbs', expect: { equipment: 'Squat', weight: 200, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'squat 4 sets of 15 at 200 lbs', expect: { equipment: 'Squat', weight: 200, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'leg press 400 sets of 10', expect: { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 1 } },
  { input: 'calf press 90 pounds for 15', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 1 } },
  { input: 'leg curl 90 for 12', expect: { equipment: 'Leg Curl', weight: 90, reps: 12 } },
  // ASR-corrected slang / named lifts
  { input: 'leg squats 4 sets of 15 at 200lbs', expect: { equipment: 'Squat', weight: 200, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'romanian deadlift 135 for 8', expect: { equipment: 'Romanian Deadlift', weight: 135, reps: 8 } },
  { input: 'overhead press 95 for 5', expect: { equipment: 'Overhead Press', weight: 95, reps: 5 } },
  { input: 'bulgarian split squat 40 for 10', expect: { equipment: 'Bulgarian Split Squat', weight: 40, reps: 10 } },
  // Machine stem fuzzy: "glute" → Glute Machine; aliases via transcript
  { input: 'glute machine 40 for 10', expect: { equipment: 'Glute Machine', weight: 40, reps: 10 } },
  { input: 'glute 40 for 10', expect: { equipment: 'Glute Machine', weight: 40, reps: 10 } },
  { input: 'hip abduction 100 for 15', expect: { equipment: 'Hip Abduction', weight: 100, reps: 15 } },
  { input: 'pec deck 80 for 12', expect: { equipment: 'Pec Deck', weight: 80, reps: 12 } },
  { input: 'leg extension 120 for 10', expect: { equipment: 'Leg Extension', weight: 120, reps: 10 } },
  // --- Stress: mangled weight/reps/sets wording (seats/cents/sense/syllables/raps/or-so/and-chains/four-by) ---
  { input: 'bench press 185 pounds 8 reps 4 seats', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'squat 225 pounds 5 seats of 5', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 5, unit: 'lb' } },
  { input: 'leg press 400 pounds for seats of 10', expect: { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 pounds 8 reps 4 cents', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'calf press 90 pounds 4 cents of 15', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 pounds 8 reps 4 sense', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'calf press 90 pounds four sense of 15', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 pounds 4 syllables 8', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 four syllables eight', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'leg press 400 pounds 4 syllables of 10', expect: { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'squat 225 pounds 5 simples 5', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 5, unit: 'lb' } },
  { input: 'calf press 90 pounds 4 settles 15', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 pounds 8 raps 4 sets', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'squat 225 pounds 5 wraps 5 sets', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 5, unit: 'lb' } },
  { input: 'bench press 185 8 wraps 4 seats', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 pounds 8 or so', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  // Safari Heard: forearm curls + torn ends (≈20 lb) + or set (≈4 sets)
  { input: 'forearm curls torn ends 10 reps or set', expect: { equipment: 'Forearm Curl', weight: 20, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'forearm curl tore ends 10 reps or sets', expect: { equipment: 'Forearm Curl', weight: 20, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'wrist curls torn ends 10 reps or so', expect: { equipment: 'Wrist Curl', weight: 20, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'leg press 400 pounds 10 or four', expect: { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'calf press 90 pounds 15 or for', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 pounds and 8 reps and 4 sets', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'squat 225 pounds and 5 reps and four cents', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 pounds and 8 reps and 4 seats', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 and 8 raps and 4 cents', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 four by 8', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'squat 225 three by 5', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 3, unit: 'lb' } },
  { input: 'leg press 400 two by 10', expect: { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 2, unit: 'lb' } },
  { input: 'calf press 90 for sets of 15', expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'bench press 185 fore sets of 8', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  { input: 'squat 225 for sets of 5', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 4, unit: 'lb' } },
  { input: 'squat 225 tree seats of 5', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 3, unit: 'lb' } },
  { input: 'deadlift 315 pounds free sets of 3', expect: { equipment: 'Deadlift', weight: 315, reps: 3, setCount: 3, unit: 'lb' } },
  { input: 'bench press 185 pahnds 8 raps 4 seats', expect: { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4, unit: 'lb' } },
  // Must NOT invent freeform equipment from Whisper garbage
  // Pure filler must not invent a set (cleanup → empty → parse null path via fallback input)
  // Wild brand / nonsense-noun recoveries
  { input: 'buy some carts 40 pounds 10 or so', expect: { equipment: 'Bicep Curl', weight: 40, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'visa curls 40 pounds 15 reps four sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'by said curl for the pounds 15 reps force it', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'busy lip curls 40 pounds 15 reps four sets', expect: { equipment: 'Bicep Curl', weight: 40, reps: 15, setCount: 4, unit: 'lb' } },
  { input: 'guest press 150 pounds 3 sets of 10', expect: { equipment: 'Chest Press', weight: 150, reps: 10, setCount: 3, unit: 'lb' } },
  { input: 'overheard press 95 pounds 5 sets of 5', expect: { equipment: 'Overhead Press', weight: 95, reps: 5, setCount: 5, unit: 'lb' } },
  { input: 'squad goals 225 pounds 5 sets of 5', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 5, unit: 'lb' } },
  { input: 'squash 225 pounds 5 sets of 5', expect: { equipment: 'Squat', weight: 225, reps: 5, setCount: 5, unit: 'lb' } },
  { input: 'deadline 225 pounds 3 sets of 3', expect: { equipment: 'Deadlift', weight: 225, reps: 3, setCount: 3, unit: 'lb' } },
  { input: 'facebook 50 pounds 3 sets of 12', expect: { equipment: 'Face Pull', weight: 50, reps: 12, setCount: 3, unit: 'lb' } },
  { input: 'seeded rose 100 pounds 10 reps four sets', expect: { equipment: 'Seated Row', weight: 100, reps: 10, setCount: 4, unit: 'lb' } },
  { input: 'xyzzy wobble 40 pounds 10 reps', expect: { equipment: '', weight: 40, reps: 10 } },
  // --- Cardio: miles / calories / minutes (Heard) ---
  { input: 'indoor cycle for 4 miles 200 calories and 20 minutes', expect: { equipment: 'Indoor Cycle', kind: 'cardio', miles: 4, calories: 200, minutes: 20, weight: 0, reps: 0, setCount: 1 } },
  { input: 'Indoor cycle for 4 miles 200 calories and 20 minutes', expect: { equipment: 'Indoor Cycle', kind: 'cardio', miles: 4, calories: 200, minutes: 20, weight: 0, reps: 0 } },
  { input: 'treadmill 3 miles 250 calories 30 minutes', expect: { equipment: 'Treadmill', kind: 'cardio', miles: 3, calories: 250, minutes: 30, weight: 0, reps: 0 } },
  { input: 'trade mill for two miles 30 minutes 150 calories', expect: { equipment: 'Treadmill', kind: 'cardio', miles: 2, calories: 150, minutes: 30, weight: 0, reps: 0 } },
  { input: 'treadmill for two miles 30 minutes 150 calories', expect: { equipment: 'Treadmill', kind: 'cardio', miles: 2, calories: 150, minutes: 30, weight: 0, reps: 0 } },
  { input: 'tread mill 150 calories two miles 30 minutes', expect: { equipment: 'Treadmill', kind: 'cardio', miles: 2, calories: 150, minutes: 30, weight: 0, reps: 0 } },
  { input: 'elliptical for 25 minutes 180 calories', expect: { equipment: 'Elliptical', kind: 'cardio', minutes: 25, calories: 180, weight: 0, reps: 0 } },
  { input: 'stepmaster 15 minutes', expect: { equipment: 'Stair Step Machine', kind: 'cardio', minutes: 15, weight: 0, reps: 0 } },
  { input: 'spin bike 5 miles 20 minutes', expect: { equipment: 'Spin Bike', kind: 'cardio', miles: 5, minutes: 20, weight: 0, reps: 0 } },

  // --- Cardio mispronunciations (Apple/Whisper Heard corpus) ---
  { input: 'roll machine for four miles 30 minutes 150 000', expect: { equipment: 'Row Machine', kind: 'cardio', miles: 4, minutes: 30, calories: 150, weight: 0, reps: 0 } },
  { input: 'row machine 4 miles 30 minutes 150 calories', expect: { equipment: 'Row Machine', kind: 'cardio', miles: 4, minutes: 30, calories: 150, weight: 0, reps: 0 } },
  { input: 'rowing machine 4 miles 30 minutes 150 ooo', expect: { equipment: 'Row Machine', kind: 'cardio', miles: 4, minutes: 30, calories: 150, weight: 0, reps: 0 } },
  { input: 'ellipticle 20 minnits 100 caleries', expect: { equipment: 'Elliptical', kind: 'cardio', calories: 100, minutes: 20, weight: 0, reps: 0 } },
  { input: 'ellipti cal for 25 minutes 180 calories', expect: { equipment: 'Elliptical', kind: 'cardio', calories: 180, minutes: 25, weight: 0, reps: 0 } },
  { input: 'eliptical 15 minutes', expect: { equipment: 'Elliptical', kind: 'cardio', minutes: 15, weight: 0, reps: 0 } },
  { input: 'cross trainer 25 minutes 180 calories', expect: { equipment: 'Elliptical', kind: 'cardio', calories: 180, minutes: 25, weight: 0, reps: 0 } },
  { input: 'stair master 20 minnits 200 caloreys', expect: { equipment: 'Stair Step Machine', kind: 'cardio', calories: 200, minutes: 20, weight: 0, reps: 0 } },
  { input: 'Stairs 10 flights 35 minute 100 calories', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 100, minutes: 35, weight: 0, reps: 0 } },
  { input: 'stairs 10 flights 35 minute 100 calories', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 100, minutes: 35, weight: 0, reps: 0 } },
  { input: 'Stairs temper ten flights 35 minutes 250', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 35, weight: 0, reps: 0 } },
  { input: 'stairs temper ten flights 35 minutes 250', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 35, weight: 0, reps: 0 } },
  { input: 'stair temper 10 flights 35 minutes 250', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 35, weight: 0, reps: 0 } },
  { input: 'stairs stepper ten flights 35 minutes 250', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 35, weight: 0, reps: 0 } },
  { input: 'Stairs diaper 10 plots of stairs 200 calories 35 minutes', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 200, minutes: 35, weight: 0, reps: 0 } },
  { input: 'stair diaper 10 plots of stairs 200 calories 35 minutes', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 200, minutes: 35, weight: 0, reps: 0 } },
  { input: 'treadmill 30 minutes 150', expect: { equipment: 'Treadmill', kind: 'cardio', calories: 150, minutes: 30, weight: 0, reps: 0 } },
  { input: 'step master 15 minutes', expect: { equipment: 'Stair Step Machine', kind: 'cardio', minutes: 15, weight: 0, reps: 0 } },
  { input: 'step mill 10 minutes', expect: { equipment: 'Stair Step Machine', kind: 'cardio', minutes: 10, weight: 0, reps: 0 } },
  { input: 'Stair stepper 10 flights of stairs 250 calories 20 minutes', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 20, weight: 0, reps: 0 } },
  { input: 'stair stepper 10 flights 250 calories 20 minutes', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 20, weight: 0, reps: 0 } },
  { input: 'stair step machine 10 flights of stairs 250 calories 20 minutes', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 250, minutes: 20, weight: 0, reps: 0 } },
  { input: 'stair step machine ten thoughts a stay two 100 calories', expect: { equipment: 'Stair Step Machine', kind: 'cardio', flights: 10, calories: 200, minutes: 30, weight: 0, reps: 0 } },
  { input: 'stairstep machine 15 minutes 200 calories', expect: { equipment: 'Stair Step Machine', kind: 'cardio', minutes: 15, calories: 200, weight: 0, reps: 0 } },
  { input: 'stationery bike two miles 30 minutes', expect: { equipment: 'Stationary Bike', kind: 'cardio', miles: 2, minutes: 30, weight: 0, reps: 0 } },
  { input: 'stationairy bike 20 minutes 150 calories', expect: { equipment: 'Stationary Bike', kind: 'cardio', calories: 150, minutes: 20, weight: 0, reps: 0 } },
  { input: 'fan bike 20 minits 250 calory', expect: { equipment: 'Air Bike', kind: 'cardio', calories: 250, minutes: 20, weight: 0, reps: 0 } },
  { input: 'assault bike 10 minutes', expect: { equipment: 'Air Bike', kind: 'cardio', minutes: 10, weight: 0, reps: 0 } },
  { input: 'airbike 15 minutes 200 calories', expect: { equipment: 'Air Bike', kind: 'cardio', calories: 200, minutes: 15, weight: 0, reps: 0 } },
  { input: 'echo bike 15 minutes', expect: { equipment: 'Echo Bike', kind: 'cardio', minutes: 15, weight: 0, reps: 0 } },
  { input: 'ark trainer 20 minutes', expect: { equipment: 'Arc Trainer', kind: 'cardio', minutes: 20, weight: 0, reps: 0 } },
  { input: 'arc trainor 25 minutes 180 calories', expect: { equipment: 'Arc Trainer', kind: 'cardio', calories: 180, minutes: 25, weight: 0, reps: 0 } },
  { input: 'ski erg 10 minutes 100 calories', expect: { equipment: 'SkiErg', kind: 'cardio', calories: 100, minutes: 10, weight: 0, reps: 0 } },
  { input: 'ski machine 12 minutes', expect: { equipment: 'SkiErg', kind: 'cardio', minutes: 12, weight: 0, reps: 0 } },
  { input: 'assault run 1 mile 10 minutes', expect: { equipment: 'Assault Runner', kind: 'cardio', miles: 1, minutes: 10, weight: 0, reps: 0 } },
  { input: 'jumping rope 10 minutes', expect: { equipment: 'Jump Rope', kind: 'cardio', minutes: 10, weight: 0, reps: 0 } },
  { input: 'skipping 5 minutes', expect: { equipment: 'Jump Rope', kind: 'cardio', minutes: 5, weight: 0, reps: 0 } },
  { input: 'recum bent bike 30 minutes 150 calories', expect: { equipment: 'Recumbent Bike', kind: 'cardio', calories: 150, minutes: 30, weight: 0, reps: 0 } },
  { input: 'in door cycle 4 miles 200 calories 20 minutes', expect: { equipment: 'Indoor Cycle', kind: 'cardio', miles: 4, calories: 200, minutes: 20, weight: 0, reps: 0 } },
  { input: 'exercise bike 3 miles 15 minutes', expect: { equipment: 'Indoor Cycle', kind: 'cardio', miles: 3, minutes: 15, weight: 0, reps: 0 } },
  { input: 'run mill two miles 30 minutes 150 calories', expect: { equipment: 'Treadmill', kind: 'cardio', miles: 2, calories: 150, minutes: 30, weight: 0, reps: 0 } },
  { input: 'tred mill 3 miiles 250 calories 30 minuites', expect: { equipment: 'Treadmill', kind: 'cardio', miles: 3, calories: 250, minutes: 30, weight: 0, reps: 0 } },
  { input: 'spin bike 5 miles 20 minutes', expect: { equipment: 'Spin Bike', kind: 'cardio', miles: 5, minutes: 20, weight: 0, reps: 0 } },

  // --- Guided logging (locked equipment; Whisper invents ignored) ---
  {
    input: '10 flights 200 calories 35 minutes',
    lockedEquipment: 'Stair Step Machine',
    lockedKind: 'cardio',
    expect: {
      equipment: 'Stair Step Machine',
      kind: 'cardio',
      flights: 10,
      calories: 200,
      minutes: 35,
      weight: 0,
      reps: 0,
    },
  },
  {
    input: 'stair temper ten flights 200 calories 35 minutes',
    lockedEquipment: 'Stair Step Machine',
    lockedKind: 'cardio',
    expect: {
      equipment: 'Stair Step Machine',
      kind: 'cardio',
      flights: 10,
      calories: 200,
      minutes: 35,
      weight: 0,
      reps: 0,
    },
  },
  {
    input: 'eliptical bike 10 flights 200 calories 35 minutes',
    lockedEquipment: 'Stair Step Machine',
    lockedKind: 'cardio',
    expect: {
      equipment: 'Stair Step Machine',
      kind: 'cardio',
      flights: 10,
      calories: 200,
      minutes: 35,
      weight: 0,
      reps: 0,
    },
  },
  {
    input: '90 for 15 for 3 sets',
    lockedEquipment: 'Calf Press',
    lockedKind: 'strength',
    expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 3 },
  },
  {
    input: 'wrong machine name 90 for 15 for 3 sets',
    lockedEquipment: 'Calf Press',
    lockedKind: 'strength',
    expect: { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 3 },
  },

]


let failed = 0
for (const c of cases) {
  const cleaned = correctGymTranscript(c.input) || c.input
  const got = parseSetUtterance(cleaned, {
    equipmentNames: library,
    equipmentAliases,
    preferredUnit: 'lb',
    lockedEquipment: c.lockedEquipment,
    lockedKind: c.lockedKind,
  })
  const expectedSetCount = c.expect.setCount ?? 1
  const expectWeight = c.expect.weight ?? 0
  const expectReps = c.expect.reps ?? 0
  const ok =
    got &&
    got.weight === expectWeight &&
    got.reps === expectReps &&
    got.setCount === expectedSetCount &&
    (c.expect.unit ? got.unit === c.expect.unit : true) &&
    (c.expect.kind ? got.kind === c.expect.kind : true) &&
    (c.expect.miles !== undefined ? got.miles === c.expect.miles : true) &&
    (c.expect.flights !== undefined ? got.flights === c.expect.flights : true) &&
    (c.expect.calories !== undefined ? got.calories === c.expect.calories : true) &&
    (c.expect.minutes !== undefined ? got.minutes === c.expect.minutes : true) &&
    (c.expect.equipment === undefined
      ? Boolean(got.equipmentName) || expectWeight > 0 || (c.expect.miles ?? 0) > 0
      : got.equipmentName.toLowerCase() === c.expect.equipment.toLowerCase())
  if (!ok) {
    failed += 1
    console.error('FAIL', c.input, 'expected', c.expect, '→', got)
  } else {
    console.log(
      'ok ',
      c.input,
      '→',
      got?.equipmentName,
      got?.kind === 'cardio'
        ? `${got?.miles ?? '-'}mi ${got?.flights ?? '-'}fl ${got?.calories ?? '-'}cal ${got?.minutes ?? '-'}min`
        : `${got?.weight} x ${got?.reps} sets ${got?.setCount}`,
      got?.unit,
    )
  }
}

// null only when nothing usable
const empty = parseSetUtterance(correctGymTranscript('um hello there') || 'um hello there', { equipmentNames: library, equipmentAliases })
if (empty !== null) {
  failed += 1
  console.error('FAIL expected null for non-set speech, got', empty)
} else {
  console.log('ok  non-set speech → null')
}

const fillerClean = correctGymTranscript("I'll be honest")
if (fillerClean !== '') {
  failed += 1
  console.error('FAIL I\'ll be honest should clean to empty, got', JSON.stringify(fillerClean))
} else {
  console.log('ok  I\'ll be honest → empty (no invented set)')
}
const fillerParse = parseSetUtterance(fillerClean || "I'll be honest", { equipmentNames: library, equipmentAliases })
if (fillerParse !== null) {
  failed += 1
  console.error('FAIL I\'ll be honest should not parse to a set, got', fillerParse)
} else {
  console.log('ok  I\'ll be honest → null parse')
}

if (failed) {
  console.error(`\n${failed} case(s) failed`)
  process.exit(1)
}
console.log(`\nAll ${cases.length + 1} cases passed`)
