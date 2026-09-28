/**
 * Lightweight parser checks. Run: node scripts/test-parse-utterance.mjs
 * Uses a tiny inline reimplementation of digit/spoken parsing via dynamic import
 * of the compiled dist is awkward — instead we spawn vite-node if present,
 * else duplicate the critical cases by importing TS via experimental strip.
 */
import { createRequire } from 'module'
import { pathToFileURL } from 'url'
import { spawnSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

// Prefer tsx / vite-node; fall back to building a one-off transpile with esbuild from vite
function runWithTsx() {
  const r = spawnSync(
    'npx',
    ['--yes', 'tsx', path.join(root, 'scripts/parse-utterance-cases.ts')],
    { cwd: root, encoding: 'utf8' },
  )
  process.stdout.write(r.stdout || '')
  process.stderr.write(r.stderr || '')
  return r.status ?? 1
}

const status = runWithTsx()
process.exit(status)
