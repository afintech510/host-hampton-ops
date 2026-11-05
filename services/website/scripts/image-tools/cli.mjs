#!/usr/bin/env node
// Host Hampton image tool belt - LOCAL tooling, not a production route.
//
//   node services/website/scripts/image-tools/cli.mjs <command> [options]
//
//   generate   text and/or reference images -> a new image   (default model: nano-banana-pro)
//   upscale    enlarge and sharpen one image                  (default: recraft-upscale)
//   cutout     remove a background                            (default: bg-remove)
//   models     list the models, what each is for, what it costs
//   spend      today's ledger total and the caps
//   selftest   offline checks (guards, dispatch); spends nothing
//
// EVERY command that would spend money is a DRY RUN until you add --yes. The dry run prints the
// plan, the estimated cost and whether the guard would allow it.
//
// HARD RULE: never use this to alter, swap or synthesise the faces or hair of real children.
// See README.md and lib/safety.mjs.

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { describeKey, loadEnv, outRoot } from './lib/env.mjs'
import { DEFAULT_MODEL, MODELS, estimate, getModel } from './lib/models.mjs'
import { screenPrompt, screenReference } from './lib/safety.mjs'
import { checkBudget, dailyCap, DEFAULT_MAX_USD, ledgerPath, readLedger, record, spentToday } from './lib/spend.mjs'
import { pickProvider } from './providers/index.mjs'

const MAX_REF_BYTES = 9 * 1024 * 1024

function parseArgs(argv) {
  const a = { _: [], ref: [] }
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i]
    if (!t.startsWith('--')) {
      a._.push(t)
      continue
    }
    const [k, inline] = t.slice(2).split(/=(.*)/s)
    const bool = ['yes', 'face-free', 'help'].includes(k)
    const v = bool ? true : inline ?? argv[++i]
    if (k === 'ref') a.ref.push(v)
    else a[k] = v
  }
  return a
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image'
const money = (n) => `$${n.toFixed(2)}`

function toRef(ref) {
  if (/^https?:\/\//i.test(ref)) return ref
  const p = resolve(ref)
  if (!existsSync(p)) throw new Error(`reference not found: ${ref}`)
  const ext = extname(p).toLowerCase()
  if (['.heic', '.heif'].includes(ext)) {
    throw new Error(`${basename(p)}: HEIC is not accepted by the models. Convert first (the photo pipeline writes WebP/JPEG).`)
  }
  const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.png': 'image/png' }[ext]
  if (!mime) throw new Error(`${basename(p)}: unsupported type ${ext} (use png, jpg or webp)`)
  if (statSync(p).size > MAX_REF_BYTES) {
    throw new Error(`${basename(p)} is over ${MAX_REF_BYTES / 1024 / 1024} MB; downscale it first (the reference is also billed by some models)`)
  }
  return `data:${mime};base64,${readFileSync(p).toString('base64')}`
}

function loadPrompt(args) {
  if (args['prompt-file']) return readFileSync(resolve(args['prompt-file']), 'utf8').trim()
  if (args.prompt) return String(args.prompt).trim()
  throw new Error('--prompt "..." or --prompt-file <path> is required')
}

function outPath(kind, name, i) {
  const dir = join(outRoot(), kind)
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '').replace('T', '-')
  return join(dir, `${stamp}_${slug(name)}_${i + 1}.png`)
}

/** Execute a plan: guard -> (dry-run stops here) -> call -> download -> sidecar -> ledger. */
async function execute({ kind, modelName, calls, args, describe }) {
  const model = getModel(modelName, kind)
  const maxUsd = args['max-usd'] === undefined ? DEFAULT_MAX_USD : Number(args['max-usd'])
  const verdict = checkBudget(calls.map((c) => ({ usd: c.usd })), { maxUsd })

  console.log(`\n${kind.toUpperCase()}  model=${modelName} (${model.slug}, ${model.provider}, price ${model.verified})`)
  for (const line of describe) console.log('  ' + line)
  console.log(`  calls: ${calls.length}   estimate: ${money(verdict.total)}   spent today: ${money(verdict.today)} / cap ${money(verdict.cap)}   per-run max: ${money(maxUsd)}`)

  if (!verdict.ok) {
    console.error('\nREFUSED by the spend guard:')
    for (const r of verdict.reasons) console.error('  - ' + r)
    process.exitCode = 2
    return
  }
  if (!args.yes) {
    console.log('\nDRY RUN - nothing sent, nothing spent. Add --yes to run it.')
    return
  }

  loadEnv()
  const provider = pickProvider(model.provider)
  console.log('  ' + describeKey(provider.keyName))
  if (!process.env[provider.keyName]) {
    console.error(`\nNo ${provider.keyName}. Nothing sent. See README "Setup" - set it in the environment or the repo-root .env.local.`)
    process.exitCode = 1
    return
  }
  let spent = 0
  for (const [i, call] of calls.entries()) {
    // Re-check before EVERY call so a long batch cannot walk past the daily cap.
    const live = checkBudget([{ usd: call.usd }], { maxUsd: Infinity })
    if (!live.ok) {
      console.error(`  call ${i + 1}: stopped by the spend guard - ${live.reasons.join('; ')}`)
      process.exitCode = 2
      break
    }
    const t0 = Date.now()
    try {
      const r = await provider.run({ slug: model.slug, input: call.input })
      const saved = await provider.download(r.imageUrl, call.out)
      spent += call.usd
      writeFileSync(
        saved + '.json',
        JSON.stringify(
          {
            ai_generated: true,
            kind,
            model: model.slug,
            provider: model.provider,
            prediction_id: r.predictionId,
            prompt: call.meta.prompt ?? null,
            refs: call.meta.refs ?? [],
            estimated_usd: call.usd,
            created: new Date().toISOString(),
            note: 'Generated locally. Not approved for the site; a human must review before it becomes a media_assets row.',
          },
          null,
          2,
        ),
      )
      record({ ok: true, kind, model: modelName, usd: call.usd, prediction_id: r.predictionId, out: basename(saved), prompt_preview: (call.meta.prompt ?? '').slice(0, 80), refs: call.meta.refs ?? [] })
      console.log(`  ${i + 1}/${calls.length} ok  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${saved}`)
    } catch (err) {
      record({ ok: false, kind, model: modelName, usd: 0, error: String(err.message).slice(0, 200), refs: call.meta.refs ?? [] })
      console.error(`  ${i + 1}/${calls.length} FAILED: ${err.message}`)
      process.exitCode = 1
    }
  }
  console.log(`\ndone. ~${money(spent)} this run (estimate; reconcile with the Replicate billing page). Output: ${join(outRoot(), kind)}`)
}

async function cmdGenerate(args) {
  const modelName = args.model || DEFAULT_MODEL.generate
  const model = getModel(modelName, 'generate')
  const prompt = loadPrompt(args)
  screenPrompt(prompt)
  const refPaths = args.ref
  for (const r of refPaths) screenReference(r, { faceFree: !!args['face-free'] })
  const refs = refPaths.map(toRef)
  const res = args.res || '2K'
  if (!['1K', '2K', '4K'].includes(res)) throw new Error('--res must be 1K, 2K or 4K')
  const n = Math.max(1, Math.min(8, Number(args.n || 1)))
  const usd = estimate(model, res)
  const input = model.input({ prompt, refs, resolution: res, aspectRatio: args.aspect })
  const name = args.name || modelName
  const calls = Array.from({ length: n }, (_, i) => ({ usd, input, out: outPath('generate', name, i), meta: { prompt, refs: refPaths.map((p) => basename(p)) } }))
  await execute({
    kind: 'generate', modelName, calls, args,
    describe: [`prompt: ${prompt.slice(0, 110).replace(/\s+/g, ' ')}${prompt.length > 110 ? '...' : ''}`, `refs: ${refPaths.length ? refPaths.map((p) => basename(p)).join(', ') : 'none'}   res: ${res}   aspect: ${args.aspect || 'default'}   n: ${n}`],
  })
}

async function cmdImageOp(kind, args) {
  const src = args._[1] || args.image
  if (!src) throw new Error(`usage: ${kind} <image> [--model m] [--yes]`)
  const modelName = args.model || DEFAULT_MODEL[kind]
  const model = getModel(modelName, kind)
  screenReference(src, { faceFree: !!args['face-free'] })
  const image = toRef(src)
  const calls = [{ usd: estimate(model), input: model.input({ image }), out: outPath(kind, `${basename(src, extname(src))}`, 0), meta: { refs: [basename(src)] } }]
  await execute({ kind, modelName, calls, args, describe: [`source: ${basename(src)}   (requires --face-free: ${args['face-free'] ? 'given' : 'MISSING'})`] })
}

function cmdModels() {
  for (const [name, m] of Object.entries(MODELS)) {
    const price = Object.entries(m.costUsd).map(([k, v]) => `${k}=${money(v)}`).join(' ')
    console.log(`${name.padEnd(16)} ${m.kind.padEnd(8)} ${m.provider.padEnd(9)} ${price}  [${m.verified}]`)
    console.log(`  ${m.slug}`)
    console.log(`  ${m.verdict}\n`)
  }
}

function cmdSpend() {
  const rows = readLedger()
  console.log(`ledger: ${ledgerPath()}  (${rows.length} rows)`)
  console.log(`spent today (UTC, estimates): ${money(spentToday(rows))} of ${money(dailyCap())} cap`)
  const byModel = {}
  for (const r of rows) if (r.ok !== false) byModel[r.model] = (byModel[r.model] || 0) + (r.usd || 0)
  for (const [m, v] of Object.entries(byModel)) console.log(`  all time  ${m.padEnd(16)} ${money(v)}`)
}

function selftest() {
  let fail = 0
  const check = (label, cond) => {
    console.log(`${cond ? 'ok  ' : 'FAIL'} ${label}`)
    if (!cond) fail++
  }
  const refuses = (p) => { try { screenPrompt(p); return false } catch { return true } }
  const allows = (p) => !refuses(p)

  // The guard must refuse the forbidden edit...
  for (const p of [
    'swap the face of the birthday girl with a happier one',
    'face swap the kids in this photo',
    'change her hair to a braid in the party photo',
    'make the children smile more, fix their faces',
    'restyle the little girl\'s hair',
    'photo of a young girl blowing out candles',
    'two kids playing in a ball pit',
    'de-age the mom',
  ]) check(`refuses: ${p}`, refuses(p))
  // ...and pass the decor and merch prompts the tool exists for.
  for (const p of [
    'Place this exact balloon arch in a bright party studio with a pink backdrop, no people',
    'Spa party table setup with robes, a hair salon sign and a bar of cucumber water, editorial photo',
    'Embroidered patch lying flat on grey, shot from above, the letters RSE legible',
    'A kids birthday party table with cupcakes, a banner and pastel balloons, no people',
    'Mockup of the studio backdrop with a birthday girl banner and glitter confetti on the floor',
    'Change the wall colour to sage green and add hair bows on the shelf',
  ]) check(`allows: ${p}`, allows(p))

  // Reference images need the attestation.
  let r = false; try { screenReference('x.png', { faceFree: false }) } catch { r = true }
  check('refuses a reference without --face-free', r)

  // Spend guard arithmetic (uses a throwaway out dir so the real ledger is untouched).
  const tmp = join(process.env.TEMP || process.env.TMPDIR || '.', 'hh-image-tools-selftest-' + process.pid)
  process.env.IMAGE_TOOLS_OUT = tmp
  const a = checkBudget([{ usd: 0.15 }, { usd: 0.15 }], { maxUsd: 1 })
  check('budget allows $0.30 under a $1 run cap', a.ok)
  const b = checkBudget([{ usd: 0.3 }], { maxUsd: 0.2 })
  check('budget refuses $0.30 over a $0.20 run cap', !b.ok)
  record({ ok: true, usd: 4.9, model: 'x', kind: 'generate' })
  const c = checkBudget([{ usd: 0.3 }], { maxUsd: 1 })
  check('budget refuses when today already holds $4.90 of the $5 cap', !c.ok && c.reasons.some((s) => /daily cap/.test(s)))
  writeFileSync(ledgerPath(), '{"day":\n')
  const d = checkBudget([{ usd: 0.01 }], { maxUsd: 1 })
  check('budget refuses on an unreadable ledger (not "nothing spent")', !d.ok && d.reasons.some((s) => /not valid JSON/.test(s)))

  // Provider dispatch + missing-key errors, no network.
  const savedKeys = { r: process.env.REPLICATE_API_KEY, f: process.env.FAL_KEY }
  delete process.env.REPLICATE_API_KEY; delete process.env.FAL_KEY
  const miss = async (p) => { try { await pickProvider(p).run({ slug: 'x/y', input: {} }); return '' } catch (e) { return e.message } }
  Promise.all([miss('replicate'), miss('fal')]).then(([rm, fm]) => {
    check('replicate without a key says REPLICATE_API_KEY', /REPLICATE_API_KEY/.test(rm))
    check('fal without a key says FAL_KEY', /FAL_KEY/.test(fm))
    if (savedKeys.r) process.env.REPLICATE_API_KEY = savedKeys.r
    if (savedKeys.f) process.env.FAL_KEY = savedKeys.f
    for (const [n, m] of Object.entries(MODELS)) check(`model ${n} has a positive price`, estimate(m) > 0)
    console.log(fail ? `\n${fail} FAILED` : '\nall passed')
    process.exit(fail ? 1 : 0)
  })
}

const args = parseArgs(process.argv.slice(2))
const cmd = args._[0]
try {
  if (!cmd || args.help) {
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'))
  } else if (cmd === 'generate') await cmdGenerate(args)
  else if (cmd === 'upscale' || cmd === 'cutout') await cmdImageOp(cmd, args)
  else if (cmd === 'models') cmdModels()
  else if (cmd === 'spend') cmdSpend()
  else if (cmd === 'selftest') selftest()
  else throw new Error(`unknown command "${cmd}"`)
} catch (err) {
  console.error(err.message)
  process.exitCode = 1
}
