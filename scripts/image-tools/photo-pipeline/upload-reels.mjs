#!/usr/bin/env node
// Send Muse's per-reel tags (reel_aggregate.py's reel_tags.csv) to the photo library.
//
//   node upload-reels.mjs                 PLAN: asks the server what it WOULD do (dryRun), writes nothing
//   node upload-reels.mjs --yes           the real import (12 reels per request)
//
// Reads <out>/reel_tags.csv and, if present, <out>/reel-posters/<shortcode>.webp (stills made by
// ig_export_reels.py --posters, from a frame in which no face was found). A still is used ONLY for a reel that
// is new to the library AND whose verdict is "no"; the server ignores it otherwise. Nothing is ever approved:
// a reel Muse saw a child in is marked not face-free, and any approval it had is withdrawn.
//
// Auth: HH_ADMIN_PASSWORD (Bearer). Base URL: HH_BASE_URL (default https://www.hosthampton.com). The password is
// never printed.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { outRoot } from '../lib/env.mjs'

const yes = process.argv.includes('--yes')
const base = (process.env.HH_BASE_URL || 'https://www.hosthampton.com').replace(/\/$/, '')
const out = outRoot()
const csvPath = join(out, 'reel_tags.csv')
if (!existsSync(csvPath)) {
  console.error(`missing ${csvPath}; run reel_aggregate.py first`)
  process.exit(1)
}
const pw = process.env.HH_ADMIN_PASSWORD
if (!pw) {
  console.error('HH_ADMIN_PASSWORD is not set. Nothing sent (the plan needs it too: the server holds the library).')
  process.exit(1)
}

// Split into records without breaking quoted newlines; the server parses the CSV again.
function records(text) {
  const recs = []
  let cur = ''
  let q = false
  for (const ch of text.replace(/^﻿/, '')) {
    if (ch === '"') q = !q
    if (ch === '\n' && !q) {
      if (cur.trim()) recs.push(cur.replace(/\r$/, ''))
      cur = ''
    } else cur += ch
  }
  if (cur.trim()) recs.push(cur.replace(/\r$/, ''))
  return recs
}

const [header, ...rows] = records(readFileSync(csvPath, 'utf8'))
const code = (row) => /\/(?:reel|p|tv)\/([A-Za-z0-9_-]{5,20})/.exec(row)?.[1]
const totals = { rows: 0, imported: 0, updated: 0, withdrawn: 0, placeholders: 0, skipped: {}, failed: [], unknownTags: new Set() }

for (let i = 0; i < rows.length; i += 12) {
  const batch = rows.slice(i, i + 12)
  const posters = {}
  for (const r of batch) {
    const c = code(r)
    const f = c && join(out, 'reel-posters', `${c}.webp`)
    if (f && existsSync(f)) posters[c] = readFileSync(f).toString('base64')
  }
  const res = await fetch(`${base}/api/admin/photo-library/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${pw}` },
    body: JSON.stringify({ source: 'reels', csv: [header, ...batch].join('\n'), posters, dryRun: !yes }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    console.error(`batch ${i / 12 + 1}: HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`)
    process.exit(1)
  }
  totals.rows += body.rows
  totals.imported += body.imported
  totals.updated += body.updated
  totals.withdrawn += body.withdrawn.length
  totals.placeholders += body.placeholders
  for (const s of body.skipped) totals.skipped[s.reason] = (totals.skipped[s.reason] || 0) + s.count
  totals.failed.push(...body.failed)
  for (const t of body.unknownTags || []) totals.unknownTags.add(t)
}
console.log(yes ? 'DONE' : 'PLAN (dry run: nothing was written)')
console.log(`  reels in file:                ${totals.rows}`)
console.log(`  already in library, re-tagged: ${totals.updated}`)
console.log(`    of which withdrawn (child):  ${totals.withdrawn}`)
console.log(`  new to the library:            ${totals.imported}  (${totals.placeholders} with the placeholder picture)`)
console.log(`  skipped:                       ${JSON.stringify(totals.skipped)}`)
console.log(`  failed:                        ${totals.failed.length}${totals.failed.length ? '\n    ' + totals.failed.join('\n    ') : ''}`)
if (totals.unknownTags.size) console.log(`  tags in no vocabulary:         ${[...totals.unknownTags].join(', ')}`)
if (!yes) console.log('\nAdd --yes to import.')
