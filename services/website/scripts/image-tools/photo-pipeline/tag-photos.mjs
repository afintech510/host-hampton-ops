#!/usr/bin/env node
// Tag local studio photos with Claude (Sonnet 5.5) in Muse's vocabulary. LOCAL tooling.
//
//   node tag-photos.mjs <dir-of-jpegs> [--out tags.json] [--model claude-sonnet-5-5] [--yes]
//
// DRY RUN unless --yes: lists what would be sent and the estimated cost. The spend guard is lib/spend.mjs
// (per-run cap --max-usd, default 1.00; daily cap IMAGE_TOOLS_DAILY_USD_CAP, default 5.00), and every call is
// recorded in the ledger. Costs are computed from the response's own usage and the published per-token price.
//
// The model only SUGGESTS tags. It never approves anything: the face check (pipeline.py faces) and a person
// decide what is imported, and a photo is tagged `identifiable_child_face: no` only if the model is sure.
// Pictures are re-sized JPEGs the pipeline made (no EXIF); the model sees nothing else.
//
// Needs @anthropic-ai/sdk. The website's node_modules may predate it, so this also looks in
// <out>/sdk/node_modules (npm install @anthropic-ai/sdk there). Key: ANTHROPIC_API_KEY (env or root .env.local).

import { createRequire } from 'node:module'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnv, outRoot } from '../lib/env.mjs'
import { checkBudget, record } from '../lib/spend.mjs'

// USD per million tokens (first-party API prices, 2026-10-06 cache of the model table).
const PRICES = { 'claude-sonnet-5-5': { in: 2, out: 10 }, 'claude-haiku-5-5': { in: 0.1, out: 0.5 }, 'claude-opus-5-5': { in: 4, out: 20 } }

const args = process.argv.slice(2)
const dir = args.find((a) => !a.startsWith('--'))
const opt = (k, d) => (args.includes(`--${k}`) ? args[args.indexOf(`--${k}`) + 1] : d)
const model = opt('model', 'claude-sonnet-5-5')
const yes = args.includes('--yes')
const maxUsd = Number(opt('max-usd', '1'))
if (!dir || !existsSync(dir)) {
  console.error('usage: node tag-photos.mjs <dir-of-jpegs> [--out tags.json] [--model m] [--max-usd 1] [--yes]')
  process.exit(1)
}
const price = PRICES[model]
if (!price) {
  console.error(`no price known for ${model}; add it to PRICES (an unpriced model is refused, not assumed free)`)
  process.exit(1)
}

const VOCAB = {
  party_type: ['in_studio_theme', 'mobile_party', 'public_event', 'not_a_party'],
  venue: ['studio', 'at_home', 'outside_venue', 'unsure'],
  theme_slug: ['custom', 'trucker-hat-party', 'swiftie-party', 'glow-party', 'kpop-party', 'barbie-party', 'sweets-treats', 'spa-party', 'toddler-party', 'slime-party', 'race-car-party', 'sleep-under-party', 'none'],
}
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['party_type', 'venue', 'theme_slug', 'activities', 'decor_tags', 'description', 'identifiable_child_face', 'people_count', 'quality', 'confidence', 'notes', 'usable_for_site'],
  properties: {
    party_type: { type: 'string', enum: VOCAB.party_type },
    venue: { type: 'string', enum: VOCAB.venue },
    theme_slug: { type: 'string', enum: VOCAB.theme_slug },
    activities: { type: 'array', items: { type: 'string' } },
    decor_tags: { type: 'array', items: { type: 'string' } },
    description: { type: 'string' },
    identifiable_child_face: { type: 'string', enum: ['no', 'unsure', 'yes'] },
    people_count: { type: 'integer' },
    quality: { type: 'integer', enum: [1, 2, 3, 4, 5] },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    notes: { type: 'string' },
    usable_for_site: { type: 'boolean' },
  },
}
const PROMPT = `You tag photos taken inside or around a children's party studio for a public photo library.

Return the tags for ONE photo as JSON matching the schema.
- party_type: in_studio_theme (a themed party set up in the studio), mobile_party (at a client's home or off-site), public_event, or not_a_party (retail stock, notes, screens, boxes, close-ups, anything that is not a party or its decor).
- venue and theme_slug must come from the enums. Use "custom" for a themed setup that matches none of the listed themes, "none" when there is no theme.
- activities: lowercase hyphenated tags such as soft-play, photo-booth, trucker-hat-bar, cake-decorating, hair-tinsel, bracelet-making, slime, dance-party. decor_tags: table-setup, balloon-garland, balloon-tower, balloon-arch, backdrop, treat-table, candy-wall, neon-sign, glow-lights, tents, cake. Empty arrays are fine.
- identifiable_child_face: "no" ONLY if no child's face or head-on or profile view is visible (hands, backs of heads, silhouettes, tiny far-away figures you cannot identify are "no"). If a child's face may be identifiable, or you are not sure, answer "unsure"; if clearly identifiable, "yes". When in doubt, never answer "no".
- people_count: how many people are visible at all.
- quality 1-5 (5 = sharp, well composed, bright). confidence: how sure you are of the tags.
- notes: anything a reviewer should know, including readable names, phone numbers or other personal text in the picture.
- usable_for_site: true only for a clean photo of a party, its decor, setup or an activity that would suit a public gallery. False for retail stock, handwritten notes, screens, boxes, blurry or messy shots, or anything with personal text.
Describe the scene in one plain sentence (description). Do not guess names or identities.`

const files = readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort()
// Rough estimate before spending: ~1,500 image tokens + ~700 prompt tokens in, ~250 out, per photo.
const est = (1500 + 700) * price.in / 1e6 + 250 * price.out / 1e6
const plan = files.map(() => ({ usd: est }))
const verdict = checkBudget(plan, { maxUsd })
console.log(`${files.length} photo(s), model ${model}, estimate $${(est * files.length).toFixed(3)}, spent today $${verdict.today.toFixed(2)} of $${verdict.cap.toFixed(2)}, run cap $${maxUsd.toFixed(2)}`)
if (!verdict.ok) {
  console.error('REFUSED by the spend guard: ' + verdict.reasons.join('; '))
  process.exit(2)
}
if (!yes) {
  console.log('DRY RUN - nothing sent. Add --yes to run.')
  process.exit(0)
}

loadEnv()
if (!process.env.ANTHROPIC_API_KEY) {
  // loadEnv reads only the tool's own key names; read this one from the same file, never printing it.
  for (const f of [process.env.HH_ENV_FILE, join(outRoot(), '..', '..', '.env.local')].filter(Boolean)) {
    if (!existsSync(f)) continue
    const m = readFileSync(f, 'utf8').match(/^ANTHROPIC_API_KEY=(.*)$/m)
    if (m) { process.env.ANTHROPIC_API_KEY = m[1].trim().replace(/^["']|["']$/g, ''); break }
  }
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY not found (env or repo-root .env.local). Nothing sent.')
  process.exit(1)
}
const require = createRequire(import.meta.url)
let sdkPath
for (const paths of [undefined, [join(outRoot(), 'sdk')]]) {
  try { sdkPath = require.resolve('@anthropic-ai/sdk', paths ? { paths } : undefined); break } catch {}
}
if (!sdkPath) {
  console.error('@anthropic-ai/sdk not found; npm install it in <out>/sdk')
  process.exit(1)
}
const Anthropic = (await import(pathToFileURL(sdkPath).href)).default
const client = new Anthropic()

const results = {}
let spent = 0
for (const f of files) {
  const live = checkBudget([{ usd: est }], { maxUsd: Infinity })
  if (!live.ok) { console.error('stopped by the spend guard: ' + live.reasons.join('; ')); break }
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 2000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(join(dir, f)).toString('base64') } },
        { type: 'text', text: PROMPT },
      ] }],
    })
    if (res.stop_reason === 'refusal') throw new Error('refusal: ' + JSON.stringify(res.stop_details))
    const usd = (res.usage.input_tokens * price.in + res.usage.output_tokens * price.out) / 1e6
    spent += usd
    const text = res.content.find((b) => b.type === 'text')?.text ?? ''
    results[f] = { tags: JSON.parse(text), usage: { in: res.usage.input_tokens, out: res.usage.output_tokens }, usd }
    record({ ok: true, kind: 'tag', model, usd, refs: [f] })
    console.log(`  ${f}: ${results[f].tags.party_type}/${results[f].tags.theme_slug} child=${results[f].tags.identifiable_child_face} usable=${results[f].tags.usable_for_site} ($${usd.toFixed(4)})`)
  } catch (err) {
    record({ ok: false, kind: 'tag', model, usd: 0, error: String(err.message).slice(0, 160), refs: [f] })
    console.error(`  ${f}: FAILED ${String(err.message).slice(0, 160)}`)
    results[f] = { error: String(err.message).slice(0, 160) }
  }
}
const out = opt('out', join(outRoot(), 'photo-pilot', `tags-${model}.json`))
writeFileSync(out, JSON.stringify(results, null, 2))
console.log(`\ndone: $${spent.toFixed(4)} actual (priced from usage). Wrote ${out}`)
