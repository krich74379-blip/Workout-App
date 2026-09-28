/**
 * Catalog-wide recognition test.
 * Run: node scripts/test-catalog-recognition.mjs
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

const runner = `
import { parseSetUtterance } from '../src/lib/parseSetUtterance.ts'
import { correctGymTranscript } from '../shared/gymTranscript.mjs'
import catalog from '../shared/exerciseCatalog.json' with { type: 'json' }

const library = catalog.exercises.map((e: { name: string }) => e.name)
const aliases: Record<string, string> = {}
for (const e of catalog.exercises) {
  aliases[e.name.toLowerCase()] = e.name
  for (const a of e.aliases ?? []) {
    const k = a.toLowerCase()
    if (!aliases[k]) aliases[k] = e.name
  }
}

const TEMPLATE = (spoken: string) => spoken + ' 50 pounds 10 reps 3 sets'

let failed = 0
let passed = 0
const failures: any[] = []

function check(spoken: string, expectName: string, label: string) {
  const raw = TEMPLATE(spoken)
  const cleaned = correctGymTranscript(raw) || raw
  const parsed = parseSetUtterance(cleaned, {
    equipmentNames: library,
    equipmentAliases: aliases,
    preferredUnit: 'lb',
  })
  const ok =
    parsed &&
    parsed.equipmentName === expectName &&
    parsed.weight === 50 &&
    parsed.reps === 10 &&
    parsed.setCount === 3
  if (!ok) {
    failed += 1
    if (failures.length < 40) {
      failures.push({
        label,
        spoken,
        expectName,
        cleaned,
        got: parsed?.equipmentName,
        w: parsed?.weight,
        r: parsed?.reps,
        s: parsed?.setCount,
      })
    }
  } else {
    passed += 1
  }
}

for (const e of catalog.exercises) {
  check(e.name, e.name, 'name')
  check(e.name.toLowerCase(), e.name, 'name-lower')
}

for (const e of catalog.exercises) {
  const als = (e.aliases ?? []).slice().sort((a: string, b: string) => a.length - b.length)
  let n = 0
  for (const a of als) {
    if (n >= 3) break
    if (a.toLowerCase() === e.name.toLowerCase()) continue
    check(a, e.name, 'alias')
    n += 1
  }
}

const spotlight: [string, string][] = [
  ['It S Okay Buzz Lip Curls', 'Bicep Curl'],
  ['buzz lip curls', 'Bicep Curl'],
  ['bi curls', 'Bicep Curl'],
  ['by a set of 40 pounds and 15 reps and 4 sets', 'Bicep Curl'],
  ['caf a set of 90 pounds', 'Calf Press'],
  ['lag a set of 80 pounds', 'Leg Curl'],
  ['rdl', 'Romanian Deadlift'],
  ['bss', 'Bulgarian Split Squat'],
  ['ohp', 'Overhead Press'],
  ['lag press', 'Leg Press'],
  ['half past', 'Calf Press'],
  ['outer thigh', 'Hip Abduction'],
  ['inner thigh', 'Hip Adduction'],
  ['butterfly', 'Pec Deck'],
]
for (const [spoken, expect] of spotlight) {
  const withNums =
    correctGymTranscript(spoken + ' 50 pounds 10 reps 3 sets') ||
    spoken + ' 50 pounds 10 reps 3 sets'
  const parsed = parseSetUtterance(withNums, {
    equipmentNames: library,
    equipmentAliases: aliases,
    preferredUnit: 'lb',
  })
  const ok = parsed && parsed.equipmentName === expect
  if (!ok) {
    failed += 1
    failures.push({ label: 'spotlight', spoken, expectName: expect, cleaned: withNums, got: parsed?.equipmentName })
  } else {
    passed += 1
  }
}

console.log(JSON.stringify({ passed, failed, total: passed + failed, failureSample: failures }, null, 2))
if (failed) process.exit(1)
console.log('\\nAll ' + passed + ' catalog recognition cases passed')
`

const tmp = path.join(root, 'scripts/_catalog_recognition_runner.ts')
fs.writeFileSync(tmp, runner)
const r = spawnSync('npx', ['--yes', 'tsx', tmp], {
  cwd: root,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
})
process.stdout.write(r.stdout || '')
process.stderr.write(r.stderr || '')
try { fs.unlinkSync(tmp) } catch {}
process.exit(r.status ?? 1)
