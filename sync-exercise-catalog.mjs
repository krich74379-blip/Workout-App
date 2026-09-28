/**
 * Sync src/data/exerciseCatalog.ts and shared/exerciseAliasMap.mjs
 * from shared/exerciseCatalog.json
 */
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalog = JSON.parse(
  fs.readFileSync(path.join(root, 'shared/exerciseCatalog.json'), 'utf8'),
)

/** Southern US / GenAm / Whisper token mangling for look-ahead alias generation. */
const WORD_MANGLES = {
  bench: ['bens', 'beach', 'binged', 'vench', 'binch', 'bent'],
  press: ['prest', 'pressed', 'breast', 'presses'],
  curl: ['curls', 'carl', 'cull', 'pearl'],
  curls: ['curl', 'carls'],
  squat: ['squad', 'scott', 'squats'],
  raise: ['race', 'rays', 'raises'],
  row: ['roll', 'roe', 'rows'],
  pull: ['pole', 'pool'],
  deadlift: ['dead lift', 'deads'],
  pulldown: ['pull down', 'pull-down'],
  kickback: ['kick back'],
  shrug: ['shrugs'],
  lunge: ['lunch', 'lunges'],
  skull: ['school', 'scull'],
  calf: ['caf', 'cahf', 'cal'],
  glute: ['glue', 'flute', 'gloot'],
  seated: ['seeded'],
  incline: ['in cline'],
  decline: ['de cline'],
  overhead: ['over head'],
  lateral: ['laterals'],
  tricep: ['tri cep', 'try cep'],
  triceps: ['tri ceps', 'try ceps'],
  bicep: ['by cep'],
  biceps: ['by ceps'],
  extension: ['extention', 'extensions'],
  machine: ['machines'],
  fly: ['flye', 'flyes'],
  flyes: ['fly', 'flye'],
}

const aliasToCanon = {}
function claim(alias, name) {
  const k = String(alias || '').toLowerCase().replace(/\s+/g, ' ').trim()
  if (!k || k.length < 2) return
  if (!aliasToCanon[k]) aliasToCanon[k] = name
  const k2 = k.replace(/[’']/g, '')
  if (!aliasToCanon[k2]) aliasToCanon[k2] = name
  const k3 = k.replace(/-/g, ' ')
  if (!aliasToCanon[k3]) aliasToCanon[k3] = name
  const k4 = k.replace(/ /g, '-')
  if (!aliasToCanon[k4]) aliasToCanon[k4] = name
}

// Pass 1: exact names + explicit aliases own their keys first
for (const e of catalog.exercises) {
  claim(e.name, e.name)
  claim(e.name.toLowerCase().replace(/[’']/g, ''), e.name)
  claim(e.name.toLowerCase().replace(/-/g, ' '), e.name)
  claim(e.name.toLowerCase().replace(/ /g, '-'), e.name)
}
for (const e of catalog.exercises) {
  for (const a of e.aliases || []) claim(a, e.name)
}

// Pass 2: safe phonetic / plural expansions — never steal another exercise's key
let generated = 0
for (const e of catalog.exercises) {
  const lower = e.name.toLowerCase()
  const tokens = lower.split(/[\s-]+/).filter(Boolean)
  const forms = new Set([lower])

  // pluralize last token
  const last = tokens[tokens.length - 1]
  if (last && !last.endsWith('s') && last.length > 2) {
    forms.add([...tokens.slice(0, -1), last + 's'].join(' '))
  }

  // one-token mangles (first matching alt only per token to limit size)
  for (let i = 0; i < tokens.length; i++) {
    const alts = WORD_MANGLES[tokens[i]]
    if (!alts) continue
    for (const alt of alts.slice(0, 3)) {
      const copy = [...tokens]
      copy[i] = alt
      forms.add(copy.join(' '))
    }
  }

  for (const f of forms) {
    const k = f.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!k) continue
    if (aliasToCanon[k] && aliasToCanon[k] !== e.name) continue
    if (!aliasToCanon[k]) {
      aliasToCanon[k] = e.name
      generated++
    }
  }
}

fs.writeFileSync(
  path.join(root, 'src/data/exerciseCatalog.ts'),
  `/** Auto-generated from shared/exerciseCatalog.json — do not edit by hand. */
export type ExerciseKind = 'machine' | 'freeweight' | 'bodyweight' | 'cardio'

export type ExerciseCatalogEntry = {
  name: string
  kind: ExerciseKind | string
  aliases?: string[]
}

export const EXERCISE_CATALOG: ExerciseCatalogEntry[] = ${JSON.stringify(catalog.exercises, null, 2)}

export const STARTER_EQUIPMENT_NAMES: string[] = EXERCISE_CATALOG.map((e) => e.name)
`,
)

fs.writeFileSync(
  path.join(root, 'shared/exerciseAliasMap.mjs'),
  `/**
 * Auto-generated alias → canonical exercise name map.
 */
export const ALIAS_TO_CANONICAL = ${JSON.stringify(aliasToCanon, null, 2)}

export function resolveExerciseAlias(spoken) {
  const k = String(spoken || '').toLowerCase().replace(/\\s+/g, ' ').trim()
  if (!k) return null
  return ALIAS_TO_CANONICAL[k] || ALIAS_TO_CANONICAL[k.replace(/[’']/g, '')] || null
}
`,
)

console.log(
  JSON.stringify({
    exercises: catalog.exercises.length,
    aliasKeys: Object.keys(aliasToCanon).length,
    generatedPhonetic: generated,
  }),
)
