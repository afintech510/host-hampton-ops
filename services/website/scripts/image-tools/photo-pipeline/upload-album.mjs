#!/usr/bin/env node
// Send the pipeline's local-photo export through the site's phone-album importer
// (POST /api/admin/photo-library/album): one plan request, then one photo per request.
//
//   node upload-album.mjs <name>            PLAN: what the server would import / re-tag / skip. Writes nothing.
//   node upload-album.mjs <name> --yes      upload each photo (rows land UNAPPROVED)
//
// <name> is the export name (default "pilot"): <out>/photo-pilot/<name>-album.csv and the WebPs in
// <out>/photo-pilot/<name>-webp/ (made by `pipeline.py export`, which only exports a photo the face check
// found clean and the tagger called `no`). The server re-screens every row and re-encodes every picture
// itself. A row already in the library is only re-tagged, never re-approved.
//
// Auth: HH_ADMIN_PASSWORD (Bearer). Base URL: HH_BASE_URL (default https://www.hosthampton.com).

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { outRoot } from '../lib/env.mjs'

const args = process.argv.slice(2)
const name = args.find((a) => !a.startsWith('--')) || 'pilot'
const yes = args.includes('--yes')
const base = (process.env.HH_BASE_URL || 'https://www.hosthampton.com').replace(/\/$/, '')
const dir = join(outRoot(), 'photo-pilot')
const csvPath = join(dir, `${name}-album.csv`)
if (!existsSync(csvPath)) {
  console.error(`missing ${csvPath}; run pipeline.py export first`)
  process.exit(1)
}
const pw = process.env.HH_ADMIN_PASSWORD
if (!pw) {
  console.error('HH_ADMIN_PASSWORD is not set. Nothing sent.')
  process.exit(1)
}
const url = `${base}/api/admin/photo-library/album`
const auth = { authorization: `Bearer ${pw}` }

const planRes = await fetch(url, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ csv: readFileSync(csvPath, 'utf8') }) })
const plan = await planRes.json().catch(() => ({}))
if (!planRes.ok) {
  console.error(`plan: HTTP ${planRes.status} ${JSON.stringify(plan).slice(0, 300)}`)
  process.exit(1)
}
const fresh = plan.accepted.filter((a) => !a.exists)
console.log(`plan: ${plan.rows} row(s); ${plan.accepted.length} accepted (${fresh.length} new, ${plan.accepted.length - fresh.length} already in the library); skipped ${JSON.stringify(plan.skipped)}`)
for (const a of plan.accepted.filter((x) => x.flag)) console.log(`  look twice: ${a.item} - ${a.flag}`)
if (!yes) {
  console.log('\nDRY RUN - nothing uploaded. Add --yes to upload.')
  process.exit(0)
}

let ok = 0
for (const a of plan.accepted) {
  const file = join(dir, `${name}-webp`, a.item.replace(/^items\//, ''))
  const form = new FormData()
  form.set('row', JSON.stringify(a.row))
  form.set('file', new Blob([readFileSync(file)], { type: 'image/webp' }), a.item.replace(/^items\//, ''))
  const res = await fetch(url, { method: 'POST', headers: auth, body: form })
  const body = await res.json().catch(() => ({}))
  console.log(`  ${a.item}: HTTP ${res.status} ${body.kind || JSON.stringify(body).slice(0, 120)}`)
  if (res.ok) ok++
}
console.log(`done: ${ok}/${plan.accepted.length}`)
