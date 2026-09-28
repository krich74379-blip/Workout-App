/**
 * Stress corpus: mangled weight/reps/sets wording (seats/cents/syllables/raps/or-so/and-chains/four-by).
 * Run: npx tsx scripts/stress-sets-reps.mts
 */
import { correctGymTranscript } from '../shared/gymTranscript.mjs'
import { parseSetUtterance } from '../src/lib/parseSetUtterance.ts'
import { EXERCISE_CATALOG } from '../src/data/exerciseCatalog.ts'

const library = EXERCISE_CATALOG.map((e) => e.name)
const equipmentAliases: Record<string, string> = {}
for (const e of EXERCISE_CATALOG) {
  equipmentAliases[e.name.toLowerCase()] = e.name
  for (const a of e.aliases ?? []) {
    const k = a.toLowerCase()
    if (!equipmentAliases[k]) equipmentAliases[k] = e.name
  }
}

type Expect = { equipment: string; weight: number; reps: number; setCount?: number; unit?: 'lb' | 'kg' }

const cases: [string, Expect][] = [
  // seats → sets
  ['bench press 185 pounds 8 reps 4 seats', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 pounds 5 seats of 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 }],
  ['leg press 400 pounds for seats of 10', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4 }],
  ['calf press 90 pounds three seats of fifteen', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 3 }],
  ['deadlift 315 pounds 3 seats', { equipment: 'Deadlift', weight: 315, reps: 0, setCount: 3 }],
  ['bench press 185 seats of 8', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 1 }],
  // cents → sets
  ['bench press 185 pounds 8 reps 4 cents', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 pounds four cents of five', { equipment: 'Squat', weight: 225, reps: 5, setCount: 4 }],
  ['leg press 400 pounds for cents of 10', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4 }],
  ['calf press 90 pounds 4 cents of 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['overhead press 95 pounds three cents', { equipment: 'Overhead Press', weight: 95, reps: 0, setCount: 3 }],
  // syllables/simples/symbols/settles → sets of
  ['bench press 185 pounds 4 syllables 8', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 pounds 5 simples 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 }],
  ['leg press 400 pounds 3 symbols 10', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 3 }],
  ['calf press 90 pounds 4 settles 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['deadlift 315 pounds syllables 5', { equipment: 'Deadlift', weight: 315, reps: 5, setCount: 4 }], // bare sets-of after pounds → assume 4
  ['bench press 185 four syllables eight', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  // raps/wraps → reps
  ['bench press 185 pounds 8 raps 4 sets', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 pounds 5 wraps 5 sets', { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 }],
  ['leg press 400 for 10 wraps', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 1 }],
  ['calf press 90 pounds 15 raps four sets', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['bench press 185 8 wraps 4 seats', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  // or so
  ['bench press 185 pounds 8 or so', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 pounds 5 or so', { equipment: 'Squat', weight: 225, reps: 5, setCount: 4 }],
  ['leg press 400 pounds 10 or four', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4 }],
  ['calf press 90 pounds 15 or for', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['deadlift 315 pounds 3 or fore', { equipment: 'Deadlift', weight: 315, reps: 3, setCount: 4 }],
  ['bench press 185 pounds 8 reps or so', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  // and-chains
  ['bench press 185 pounds and 8 reps and 4 sets', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 pounds and 5 reps and 5 sets', { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 }],
  ['leg press 400 lbs and 10 reps and 4 sets', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4 }],
  ['calf press 90 pounds and 15 reps', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 1 }],
  ['deadlift 315 pounds and 3 sets', { equipment: 'Deadlift', weight: 315, reps: 0, setCount: 3 }],
  ['overhead press 95 kg and 5 reps and 3 sets', { equipment: 'Overhead Press', weight: 95, reps: 5, setCount: 3, unit: 'kg' }],
  // four by / for sets
  ['bench press 185 four by 8', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 three by 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 3 }],
  ['leg press 400 two by 10', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 2 }],
  ['calf press 90 for sets of 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['bench press 185 fore sets of 8', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 for sets of 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 4 }],
  ['leg press 400 five by 10', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 5 }],
  // sex ≈ sets
  ['bench press 185 pounds for a sex of 8', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 pounds a sex of 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 4 }],
  ['calf press 90 pounds sex of 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }], // bare sex/sets-of after pounds → assume 4
  // mixed mangling
  ['bench press 185 pahnds 8 raps 4 seats', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 pounds 5 wraps four cents', { equipment: 'Squat', weight: 225, reps: 5, setCount: 4 }],
  ['leg press 400 pounds 4 syllables of 10', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4 }],
  ['calf press 90 pounds 15 or so', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['bench press 185 and 8 raps and 4 cents', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['deadlift 315 pounds free sets of 3', { equipment: 'Deadlift', weight: 315, reps: 3, setCount: 3 }],
  ['squat 225 tree seats of 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 3 }],
  ['bench press 185 double sets of 8', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 2 }],
  ['leg press 400 triple sets of 10', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 3 }],
  ['calf press 90 quad sets of 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['bench press 185 pounds eight reps four seats', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['bench press 185 pounds post sets of 8', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['calf press 90 pounds for some to 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
  ['squat 225 pounds 3 seat of 5', { equipment: 'Squat', weight: 225, reps: 5, setCount: 3 }],
  ['leg press 400 pounds 4 cent of 10', { equipment: 'Leg Press', weight: 400, reps: 10, setCount: 4 }],
  ['bench press 185 pounds raps of 8 for 4 sets', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 wraps of 5 five sets', { equipment: 'Squat', weight: 225, reps: 5, setCount: 5 }],
  ['bench press 185 pounds and 8 reps and 4 seats', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['squat 225 pounds and 5 reps and four cents', { equipment: 'Squat', weight: 225, reps: 5, setCount: 4 }],
  ['bench press 185 pounds 8 reps 4 sense', { equipment: 'Bench Press', weight: 185, reps: 8, setCount: 4 }],
  ['calf press 90 pounds four sense of 15', { equipment: 'Calf Press', weight: 90, reps: 15, setCount: 4 }],
]

let fail = 0
let pass = 0
const fails: { input: string; cleaned: string; expect: Expect; got: unknown }[] = []
for (const [input, expect] of cases) {
  const cleaned = correctGymTranscript(input) || input
  const got = parseSetUtterance(cleaned, {
    equipmentNames: library,
    equipmentAliases,
    preferredUnit: 'lb',
  })
  const sc = expect.setCount ?? 1
  const ok =
    !!got &&
    got.weight === expect.weight &&
    got.reps === expect.reps &&
    got.setCount === sc &&
    got.equipmentName.toLowerCase() === expect.equipment.toLowerCase() &&
    (expect.unit ? got.unit === expect.unit : true)
  if (ok) {
    pass += 1
  } else {
    fail += 1
    const row = {
      input,
      cleaned,
      expect,
      got: got
        ? { eq: got.equipmentName, w: got.weight, r: got.reps, s: got.setCount, u: got.unit }
        : null,
    }
    fails.push(row)
    console.log('FAIL', JSON.stringify(row))
  }
}
console.log(`\n${pass} passed, ${fail} failed of ${cases.length}`)
process.exit(fail ? 1 : 0)
