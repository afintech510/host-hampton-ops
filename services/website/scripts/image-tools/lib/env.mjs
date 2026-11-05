// env.mjs - where the tool finds its key and where it writes.
//
// The key is read from the process environment first, then from the repo-root `.env.local`
// of the PRIMARY checkout (this tool is usually run from a git worktree, and `.env.local` is
// gitignored, so a worktree has none of its own). `services/website/.env.local` is
// deliberately NOT read: it is a different, mostly-stale file (see the two-env-local-files
// note) and holds none of these keys.
//
// A key is never printed, logged or put in the ledger. `describeKey()` says only whether one
// was found and which file it came from.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The primary checkout (the dir holding the real `.git`), even from inside a worktree. */
export function primaryRoot() {
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: HERE,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    return resolve(common, '..')
  } catch {
    return resolve(HERE, '..', '..', '..', '..', '..')
  }
}

/** This worktree's root (may equal primaryRoot()). */
export function worktreeRoot() {
  return resolve(HERE, '..', '..', '..', '..', '..')
}

/** Everything the tool writes lives here. `audit_scratch/` is gitignored (verify:
 *  `git check-ignore -v audit_scratch/image-tools/x`). One folder for every worktree. */
export function outRoot() {
  return process.env.IMAGE_TOOLS_OUT || join(primaryRoot(), 'audit_scratch', 'image-tools')
}

const KEY_NAMES = ['REPLICATE_API_KEY', 'FAL_KEY', 'IMAGE_PROVIDER', 'IMAGE_TOOLS_DAILY_USD_CAP']

let loadedFrom = null

/** Fill process.env from the first `.env.local` that exists. Never overwrites a value that is
 *  already in the environment. Reads only the names above. */
export function loadEnv() {
  if (loadedFrom !== null) return loadedFrom
  const candidates = [
    process.env.HH_ENV_FILE,
    join(worktreeRoot(), '.env.local'),
    join(primaryRoot(), '.env.local'),
  ].filter(Boolean)
  for (const file of candidates) {
    if (!existsSync(file)) continue
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
      if (m && KEY_NAMES.includes(m[1]) && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    }
    loadedFrom = file
    return loadedFrom
  }
  loadedFrom = ''
  return loadedFrom
}

/** For logs: presence only, never the value. */
export function describeKey(name) {
  loadEnv()
  if (!process.env[name]) return `${name}: NOT SET`
  return `${name}: set (${process.env[name].length} chars)`
}
