import fs from 'fs'
import path from 'path'
import { decomment } from '../helpers/sourceScan'
import { PUBLIC_RSVP_SELF_COLUMNS } from '@/lib/evites/views'

/**
 * The EVITE tripwire (spec §15, rules E1-E10).
 *
 * Every rule is a PURE function over `{ relativePath -> comment-stripped source }`, so it can be run against the
 * real tree (the tests below) AND against a deliberately broken fixture (the "fires on" tests), and every rule
 * returns the number of sites it EXAMINED beside its offenders. A rule that examined nothing proved nothing, so
 * each test asserts a floor, and E10 re-asserts them all in one place.
 *
 * Conventions (AGENTS.md, tripwire lessons):
 *   - scoped to the site, never "the file contains X": function bodies are brace-matched from the end of the
 *     PARAMETER LIST (a `= {}` default cannot fool it), and a guard is judged by its ORDER against the write;
 *   - CRLF-tolerant: nothing matches on a bare `\n`;
 *   - `decomment` preserves offsets, so anything measuring distance squashes whitespace first, and ordering rules
 *     compare positions inside one body;
 *   - a rule that fires on correct code is wrong: each rule below was first run against the live tree;
 *   - no static skips in this file (E10 checks every *Surface test, this one included).
 */

/* ── reading the tree ─────────────────────────────────────────── */

const SRC_ROOT = path.join(process.cwd(), 'src')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name === '__tests__') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

type Files = Record<string, string>

let cache: Files | null = null
/** Every non-test source file under src/, comment-stripped (offsets preserved). */
function disk(): Files {
  if (cache) return cache
  const out: Files = {}
  for (const abs of walk(SRC_ROOT)) {
    const rel = path.relative(SRC_ROOT, abs).split(path.sep).join('/')
    out[rel] = decomment(fs.readFileSync(abs, 'utf8'))
  }
  cache = out
  return out
}

const squash = (s: string) => s.replace(/\s+/g, ' ')

/** The `}` that matches the `{` at `open`. */
function matchBrace(code: string, open: number): number {
  let d = 0
  for (let j = open; j < code.length; j++) {
    if (code[j] === '{') d++
    else if (code[j] === '}' && --d === 0) return j
  }
  return -1
}

/** The `)` that matches the `(` at `open`. */
function matchParen(code: string, open: number): number {
  let d = 0
  for (let j = open; j < code.length; j++) {
    if (code[j] === '(') d++
    else if (code[j] === ')' && --d === 0) return j
  }
  return -1
}

interface Fn {
  name: string
  /** Index of the opening `{` of the body. */
  open: number
  close: number
  body: string
}

/**
 * Every `function name(...) { ... }` declaration: the body starts at the first `{` AFTER the parameter list is
 * paren-matched (so `opts: Options = {}` cannot be mistaken for it), skipping a return-type annotation.
 */
function functionsOf(code: string): Fn[] {
  const out: Fn[] = []
  const re = /\bfunction\s+(\w+)\s*(?:<[^>(]*>)?\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    const parenOpen = m.index + m[0].length - 1
    const parenClose = matchParen(code, parenOpen)
    if (parenClose < 0) continue
    // the body brace: the first `{` after the params that is not inside a `{ ... }` return type
    let i = parenClose + 1
    let open = -1
    while (i < code.length) {
      const c = code[i]
      if (c === '{') {
        // `): { a: string } {` - a type literal is followed by another `{`; take the last of the chain
        const end = matchBrace(code, i)
        const after = code.slice(end + 1).match(/^\s*(?:\{|\||&)/)
        if (!after) {
          open = i
          break
        }
        i = end + 1
        continue
      }
      if (c === ';') break
      i++
    }
    if (open < 0) continue
    const close = matchBrace(code, open)
    if (close < 0) continue
    out.push({ name: m[1], open, close, body: code.slice(open, close + 1) })
  }
  return out
}

function fnNamed(code: string, name: string): Fn | null {
  return functionsOf(code).find((f) => f.name === name) ?? null
}

/** Exported HTTP handlers of a route file. */
const HANDLER_NAMES = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const handlersOf = (code: string) => functionsOf(code).filter((f) => HANDLER_NAMES.includes(f.name))

/** Every call `name(...)` outside its own declaration: the index of the name. */
function callSites(code: string, name: string): number[] {
  const out: number[] = []
  const re = new RegExp(`(?<![\\w.$])${name}\\s*\\(`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(code))) {
    if (/\bfunction\s+$/.test(code.slice(Math.max(0, m.index - 12), m.index))) continue
    out.push(m.index)
  }
  return out
}

/** The method chain starting at a `.from(...)`: `[{ method, args }]`, each paren-matched. */
function chainFrom(code: string, fromIndex: number): Array<{ method: string; args: string }> {
  const out: Array<{ method: string; args: string }> = []
  let i = fromIndex
  for (;;) {
    const m = /^\s*\.\s*(\w+)\s*(?:<[^>(]*>)?\s*\(/.exec(code.slice(i))
    if (!m) break
    const open = i + m[0].length - 1
    const close = matchParen(code, open)
    if (close < 0) break
    out.push({ method: m[1], args: code.slice(open + 1, close) })
    i = close + 1
  }
  return out
}

/* ── scopes ───────────────────────────────────────────────────── */

const PUBLIC_RE = /^app\/(?:api\/)?i\//
const EVITE_RE = new RegExp(
  '^(?:' +
    [
      'lib/evites/',
      'lib/email-templates/evites\\.ts$',
      'components/evites/',
      'components/admin/InvitationCard\\.tsx$',
      'app/i/',
      'app/api/i/',
      'app/api/cron/evite-sends/',
      'app/api/admin/parties/\\[id\\]/invitation/',
      'app/api/portal/invitation/',
      'app/my-booking/invitation/',
    ].join('|') +
    ')',
)
const inScope = (files: Files, re: RegExp) => Object.keys(files).filter((rel) => re.test(rel))

interface Verdict {
  examined: number
  offenders: string[]
}

/* ── E1 ───────────────────────────────────────────────────────── */

/**
 * E1: the rate limiter precedes ANY database read in every `/i` page and route and every `app/api/i/**` handler.
 *   - route handlers: `const limited = guardRate(...)` + `if (limited) return limited` come before the first
 *     `await`, `getSupabase(`, `.from(` or `resolveEviteBySlug(`;
 *   - the page: `loadInvite(` (the guarded, request-cached load) is the first thing `generateMetadata` and the
 *     page default do that touches data, and `loadInvite`'s own `load` calls `guardRateHeaders` before the read;
 *   - no other file under `app/i` or `app/api/i` reads the database on its own except the two known helpers.
 */
export function ruleE1(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  const DB = /\bawait\b|\bgetSupabase\s*\(|\.from\s*\(|\bresolveEviteBySlug\s*\(|\breadCurrentClubConsent\s*\(/

  for (const rel of inScope(files, PUBLIC_RE)) {
    const code = files[rel]
    if (/\/route\.ts$/.test(rel)) {
      for (const h of handlersOf(code)) {
        examined++
        const g = h.body.search(/\bguardRate\s*\(/)
        const db = h.body.search(DB)
        if (g < 0) offenders.push(`${rel} ${h.name}: no guardRate`)
        else if (db >= 0 && db < g) offenders.push(`${rel} ${h.name}: a database read precedes guardRate`)
        if (!/const (\w+) = guardRate\([^)]*\);? if \(\1\) return \1/.test(squash(h.body))) {
          offenders.push(`${rel} ${h.name}: guardRate result is not returned`)
        }
      }
    }
  }

  const page = files['app/i/[slug]/page.tsx']
  if (page === undefined) offenders.push('app/i/[slug]/page.tsx is missing')
  else {
    for (const name of ['generateMetadata', 'InvitePage']) {
      examined++
      const f = fnNamed(page, name)
      if (!f) {
        offenders.push(`page.tsx: ${name} not found`)
        continue
      }
      const load = f.body.search(/\bloadInvite\s*\(/)
      const other = f.body.search(/\bgetSupabase\s*\(|\bresolveEviteBySlug\s*\(|\bloadRsvpPanel\s*\(|\bloadOwnRsvp\s*\(|\.from\s*\(/)
      if (load < 0) offenders.push(`page.tsx ${name}: does not go through loadInvite`)
      else if (other >= 0 && other < load) offenders.push(`page.tsx ${name}: reads data before loadInvite`)
    }
  }

  const li = files['app/i/[slug]/loadInvite.ts']
  if (li === undefined) offenders.push('loadInvite.ts is missing')
  else {
    examined++
    const f = fnNamed(li, 'load')
    if (!f) offenders.push('loadInvite.ts: load not found')
    else {
      const g = f.body.search(/\bguardRateHeaders\s*\(/)
      const db = f.body.search(/\bgetSupabase\s*\(|\bresolveEviteBySlug\s*\(/)
      if (g < 0 || (db >= 0 && db < g)) offenders.push('loadInvite.ts load: guardRateHeaders does not precede the read')
      if (!/if \(guardRateHeaders\([^]*?\)\) return \{ kind: 'limited' \}/.test(squash(f.body))) {
        offenders.push('loadInvite.ts load: a throttled request does not return `limited`')
      }
    }
  }

  // Nothing else in the public surface may open a database connection by itself.
  const KNOWN = new Set(['app/i/[slug]/loadInvite.ts', 'app/i/[slug]/loadOwnRsvp.ts'])
  for (const rel of inScope(files, PUBLIC_RE)) {
    examined++
    if (/\/route\.ts$/.test(rel) || KNOWN.has(rel)) continue
    if (/\bgetSupabase\s*\(/.test(files[rel])) offenders.push(`${rel}: reads the database outside the guarded paths`)
  }
  return { examined, offenders }
}

/* ── E2 ───────────────────────────────────────────────────────── */

/**
 * E2: a public response serialises an RSVP only through `ownRsvpView` (built from PUBLIC_RSVP_SELF_COLUMNS).
 *   - every `rsvp:` property in a public route is `ownRsvpView(...)` (or the honeypot's fake body);
 *   - every `evite_rsvps` chain in the public surface selects only OWN_RSVP_SELECT, `id`, or nothing;
 *   - `ownRsvpView` is built from the allow-list, not by spreading the row.
 */
export function ruleE2(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  for (const rel of inScope(files, PUBLIC_RE)) {
    const code = files[rel]
    for (const m of Array.from(code.matchAll(/(?<=[{,]\s*)\brsvp\s*:\s*([A-Za-z_$][\w$]*)/g))) {
      examined++
      if (!['ownRsvpView', 'honeypotRsvp'].includes(m[1])) offenders.push(`${rel}: rsvp: ${m[1]}`)
    }
    for (const m of Array.from(code.matchAll(/\.from\(\s*['"]evite_rsvps['"]\s*\)/g))) {
      examined++
      const sel = chainFrom(code, (m.index as number) + m[0].length).filter((c) => c.method === 'select')
      for (const s of sel) {
        const first = s.args.split(',')[0].trim()
        if (!(first === 'OWN_RSVP_SELECT' || first === "'id'")) offenders.push(`${rel}: evite_rsvps select(${first})`)
      }
    }
  }

  const view = files['lib/evites/rsvpView.ts']
  if (view === undefined) offenders.push('lib/evites/rsvpView.ts is missing')
  else {
    examined++
    const f = fnNamed(view, 'ownRsvpView')
    if (!f) offenders.push('rsvpView.ts: ownRsvpView not found')
    else {
      if (!/for \(const col of PUBLIC_RSVP_SELF_COLUMNS\)/.test(squash(f.body))) offenders.push('ownRsvpView does not iterate PUBLIC_RSVP_SELF_COLUMNS')
      if (/\.\.\.\s*row\b|Object\.assign\(|return row\b/.test(f.body)) offenders.push('ownRsvpView returns or spreads the row')
    }
    if (!/OWN_RSVP_SELECT\s*=\s*\[\s*'id',\s*\.\.\.PUBLIC_RSVP_SELF_COLUMNS\s*\]/.test(squash(view))) offenders.push('OWN_RSVP_SELECT is not built from the allow-list')
  }
  return { examined, offenders }
}

/* ── E3 ───────────────────────────────────────────────────────── */

/**
 * E3: "Booked" comes only from `bookingStage` (lib/bookingStatus). `inviteState` imports and calls it and derives
 * `booked` from its answer; no evite file spells a booking/payment STATUS literal of its own.
 */
const STATUS_LITERAL = /['"](deposit_paid|paid_in_full|partly_paid|modifications_locked|approved|awaiting_deposit|pending_review)['"]/
export function ruleE3(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  const state = files['lib/evites/state.ts']
  if (state === undefined) offenders.push('lib/evites/state.ts is missing')
  else {
    examined++
    if (!/import\s*\{[^}]*\bbookingStage\b[^}]*\}\s*from\s*'@\/lib\/bookingStatus'/.test(state)) offenders.push('state.ts does not import bookingStage from @/lib/bookingStatus')
    const f = fnNamed(state, 'inviteState')
    if (!f) offenders.push('state.ts: inviteState not found')
    else {
      const b = squash(f.body)
      if (!/const stage = bookingStage\(/.test(b)) offenders.push('inviteState does not call bookingStage')
      if (!/const booked = stage === 'booked' \|\| stage === 'completed'/.test(b)) offenders.push('inviteState derives `booked` from something other than the stage')
    }
  }
  for (const rel of inScope(files, EVITE_RE)) {
    examined++
    const m = STATUS_LITERAL.exec(files[rel])
    if (m) offenders.push(`${rel}: spells the booking status '${m[1]}' itself`)
  }
  return { examined, offenders }
}

/* ── E4 ───────────────────────────────────────────────────────── */

/**
 * E4: the Birthday Club never uses `upsertContact` and never writes a contact's consent or name on the FOUND branch.
 *   - no evite file mentions `upsertContact` (as a word) or imports lib/contacts;
 *   - club.ts touches `contacts` through exactly ONE statement, an INSERT, and never an update/upsert/delete;
 *   - everything before that INSERT (the lookup and the found branch) names no consent or name column;
 *   - the INSERT carries both opt-ins as literal `false`.
 */
export function ruleE4(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  for (const rel of inScope(files, EVITE_RE)) {
    examined++
    const code = files[rel]
    if (/\bupsertContact\b/.test(code) || /from\s*'@\/lib\/contacts'/.test(code)) offenders.push(`${rel}: uses upsertContact / lib/contacts`)
  }
  const club = files['lib/evites/club.ts']
  if (club === undefined) return { examined, offenders: [...offenders, 'lib/evites/club.ts is missing'] }

  const froms = Array.from(club.matchAll(/\.from\(\s*['"]contacts['"]\s*\)/g))
  examined++
  if (froms.length !== 1) offenders.push(`club.ts touches contacts ${froms.length} times (expected exactly 1 INSERT)`)
  for (const m of froms) {
    const chain = chainFrom(club, (m.index as number) + m[0].length)
    const methods = chain.map((c) => c.method)
    if (methods[0] !== 'insert') offenders.push(`club.ts: contacts is written with .${methods[0]}(), not .insert()`)
    if (methods.some((x) => ['update', 'upsert', 'delete'].includes(x))) offenders.push('club.ts: contacts chain contains update/upsert/delete')
    const args = squash(chain[0]?.args ?? '')
    if (!/\bemail_opt_in:\s*false\b/.test(args) || !/\bsms_opt_in:\s*false\b/.test(args)) offenders.push('club.ts: the INSERT does not pin both opt-ins to false')
    for (const o of Array.from(args.matchAll(/\b(email_opt_in|sms_opt_in)\s*:\s*(\w+)/g))) {
      if (o[2] !== 'false') offenders.push('club.ts: the INSERT sets ' + o[1] + ' to ' + o[2])
    }
    // the found branch: everything before the INSERT
    const before = club.slice(0, m.index as number)
    const fnStart = before.lastIndexOf('async function resolveContact')
    if (fnStart < 0) offenders.push('club.ts: resolveContact not found')
    else {
      const found = before.slice(fnStart)
      if (!/kind === 'found'\) return/.test(squash(found))) offenders.push('club.ts: the found branch does not return before the INSERT')
      if (/\b(first_name|last_name|email_opt_in|sms_opt_in|email_opt_in_at|sms_opt_in_at|status|source)\b\s*:/.test(found)) offenders.push('club.ts: the found branch writes a contact column')
    }
  }
  return { examined, offenders }
}

/* ── E5 ───────────────────────────────────────────────────────── */

/** E5: no `select('*')` (or an empty `.select()`, which is `*`) anywhere in evite code. */
export function ruleE5(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  for (const rel of inScope(files, EVITE_RE)) {
    const code = files[rel]
    for (const m of Array.from(code.matchAll(/\.select\s*\(/g))) {
      examined++
      const open = (m.index as number) + m[0].length - 1
      const close = matchParen(code, open)
      const arg = close < 0 ? '' : code.slice(open + 1, close).trim()
      if (close < 0) offenders.push(`${rel}: unbalanced select(`)
      else if (arg === '') {
        // a DOM `textarea.select()` has an identifier before the dot; a database chain has a call
        if (/\)\s*$/.test(code.slice(0, m.index as number))) offenders.push(`${rel}: empty .select() returns every column`)
      }
      else {
        const quoted = /^(['"`])([^'"`]*)\1/.exec(arg)
        if (quoted && quoted[2].includes('*')) offenders.push(`${rel}: select(${arg.slice(0, 40)}) names '*'`)
      }
    }
  }
  const views = files['lib/evites/views.ts']
  examined++
  if (views === undefined) offenders.push('lib/evites/views.ts is missing')
  else if (/['"]\*['"]/.test(views)) offenders.push("lib/evites/views.ts: a column list contains '*'")
  return { examined, offenders }
}

/* ── E6 ───────────────────────────────────────────────────────── */

/**
 * E6: `claimSend` precedes `sendEviteEmail` at every send site.
 *   - `sendEviteEmail` is called from exactly one place, `performSend`, which takes a `ClaimedSend` (a value only
 *     `claimSend` / `reclaimFailed` produce);
 *   - `performSend` is called from exactly two places, and each one claims first: `claimAndSend` (claimSend) and
 *     the cron's `stepReclaim` (reclaimFailed).
 */
export function ruleE6(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  const mail: Array<{ rel: string; fn: string | null; idx: number; fns: Fn[] }> = []
  const perform: Array<{ rel: string; fn: Fn | null; idx: number }> = []
  for (const rel of Object.keys(files)) {
    const code = files[rel]
    if (!/sendEviteEmail|performSend/.test(code)) continue
    const fns = functionsOf(code)
    const enclosing = (idx: number) => fns.filter((f) => f.open < idx && idx < f.close).sort((a, b) => b.open - a.open)[0] ?? null
    if (rel !== 'lib/evites/mail.ts') {
      for (const idx of callSites(code, 'sendEviteEmail')) mail.push({ rel, fn: enclosing(idx)?.name ?? null, idx, fns })
    }
    for (const idx of callSites(code, 'performSend')) perform.push({ rel, fn: enclosing(idx), idx })
  }

  for (const s of mail) {
    examined++
    if (!(s.rel === 'lib/evites/sendOne.ts' && s.fn === 'performSend')) offenders.push(`${s.rel}: sendEviteEmail called from ${s.fn ?? 'module scope'}`)
  }
  if (mail.length !== 1) offenders.push(`sendEviteEmail has ${mail.length} call sites (expected exactly 1)`)

  const one = files['lib/evites/sendOne.ts']
  if (one === undefined) offenders.push('sendOne.ts is missing')
  else {
    const pf = fnNamed(one, 'performSend')
    examined++
    if (!pf) offenders.push('sendOne.ts: performSend not found')
    else if (!/performSend\s*\(\s*supabase: Supa,\s*send: ClaimedSend\b/.test(squash(one.slice(one.indexOf('function performSend'), pf.open)))) {
      offenders.push('performSend does not take a ClaimedSend')
    }
  }

  const CLAIMERS: Record<string, { file: string; claim: string }> = {
    claimAndSend: { file: 'lib/evites/sendOne.ts', claim: 'claimSend' },
    stepReclaim: { file: 'lib/evites/cronTick.ts', claim: 'reclaimFailed' },
  }
  for (const s of perform) {
    examined++
    const spec = s.fn ? CLAIMERS[s.fn.name] : undefined
    if (!s.fn || !spec || spec.file !== s.rel) {
      offenders.push(`${s.rel}: performSend called from ${s.fn?.name ?? 'module scope'}, which is not a known claiming site`)
      continue
    }
    const claimAt = callSites(s.fn.body, spec.claim)[0]
    const sendAt = s.idx - s.fn.open
    if (claimAt === undefined || claimAt > sendAt) offenders.push(`${s.rel} ${s.fn.name}: ${spec.claim}( does not precede performSend(`)
  }
  if (perform.length !== 2) offenders.push(`performSend has ${perform.length} call sites (expected exactly 2)`)
  return { examined, offenders }
}

/* ── E7 ───────────────────────────────────────────────────────── */

const CHROME = ['components/Nav.tsx', 'components/Footer.tsx', 'components/BenchworksAttribution.tsx', 'components/MetaPixel.tsx']
const EARLY_INVITE_RETURN = /\bif\s*\(.*\bis(?:Invite|MetaPixelBlocked)\w*\s*\(.*\)\s*return\s+null/
/**
 * E7: the site chrome steps aside on `/i/<slug>`, safely.
 *   - Nav, Footer, the agency credit and the Pixel component return null for an invitation AFTER their last hook
 *     (they live in the root layout and survive a client-side navigation; a conditional hook count crashes React);
 *   - the MetaPixel `useEffect` checks `isMetaPixelBlockedPath` before `fbq` and before the bootstrap bookkeeping;
 *   - AttributionCapture checks before it captures; the two promo banners list `/i/` as a hidden prefix.
 */
export function ruleE7(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  for (const rel of CHROME) {
    const code = files[rel]
    if (code === undefined) {
      offenders.push(`${rel} is missing`)
      continue
    }
    const def = /export default function (\w+)\s*\(/.exec(code)
    const f = def ? fnNamed(code, def[1]) : null
    if (!f) {
      offenders.push(`${rel}: default component not found`)
      continue
    }
    let lastHook = -1
    for (const h of Array.from(f.body.matchAll(/\buse[A-Z]\w*\s*\(/g))) lastHook = Math.max(lastHook, h.index as number)
    let returns = 0
    let offset = 0
    for (const line of f.body.split(/\r?\n/)) {
      if (EARLY_INVITE_RETURN.test(line)) {
        returns++
        if (offset <= lastHook) offenders.push(`${rel}: the /i early return sits before the last hook`)
      }
      offset += line.length + (f.body.slice(offset + line.length).startsWith('\r\n') ? 2 : 1)
    }
    examined++
    if (lastHook < 0) offenders.push(`${rel}: no hook found (the rule would pass vacuously)`)
    if (returns === 0) offenders.push(`${rel}: no early return for an invitation path`)
  }

  const px = files['components/MetaPixel.tsx']
  if (px !== undefined) {
    examined++
    const at = px.search(/\buseEffect\s*\(/)
    const open = at < 0 ? -1 : px.indexOf('(', at)
    const close = open < 0 ? -1 : matchParen(px, open)
    const effect = open < 0 || close < 0 ? '' : px.slice(open, close)
    const gate = effect.search(/\bisMetaPixelBlockedPath\s*\(/)
    const fbq = effect.search(/\bfbq\b/)
    const boot = effect.search(/bootstrapped\.current\s*=\s*true/)
    if (!effect) offenders.push('MetaPixel.tsx: no useEffect')
    else if (gate < 0 || fbq < 0 || boot < 0 || gate > fbq || gate > boot) offenders.push('MetaPixel.tsx: the effect is not gated before fbq / the bootstrap')
  }

  const attr = files['components/AttributionCapture.tsx']
  if (attr !== undefined) {
    examined++
    const g = attr.search(/\bisInvitePath\s*\(/)
    const c = attr.search(/\bcaptureAttribution\s*\(\s*\)/)
    if (g < 0 || c < 0 || g > c) offenders.push('AttributionCapture.tsx: not gated before captureAttribution()')
  }

  for (const rel of ['components/AppointmentBanner.tsx', 'components/ChristmasMarketBanner.tsx']) {
    const code = files[rel]
    examined++
    if (code === undefined || !/HIDDEN_PREFIXES[^=]*=\s*\[[^\]]*['"]\/i\/['"]/.test(code)) offenders.push(`${rel}: '/i/' is not a hidden prefix`)
  }
  return { examined, offenders }
}

/* ── E8 ───────────────────────────────────────────────────────── */

/** E8: no `setHours` and no `new Date(x + 'T...')` in evite code (the box is UTC; both parse as local time). */
export function ruleE8(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  for (const rel of inScope(files, EVITE_RE)) {
    examined++
    const code = files[rel]
    if (/\.setHours\s*\(/.test(code)) offenders.push(`${rel}: setHours`)
    if (/new Date\(\s*[^()]*\+\s*['"`]\s*T/.test(code)) offenders.push(`${rel}: new Date(x + 'T...')`)
    if (/new Date\(\s*`[^`]*\$\{[^}]*\}\s*T/.test(code)) offenders.push(`${rel}: new Date(\`\${x}T...\`)`)
  }
  if (examined === 0) offenders.push('no evite files in scope (the rule would pass vacuously)')
  return { examined, offenders }
}

/* ── E9 ───────────────────────────────────────────────────────── */

/**
 * E9: the 300,000-byte guard sits inside `renderEvite`'s store path, before the first upload; the render code never
 * imports `next/og` and never passes `loadAdditionalAsset`.
 */
export function ruleE9(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  const render = files['lib/evites/render.ts']
  if (render === undefined) return { examined, offenders: ['lib/evites/render.ts is missing'] }

  examined++
  if (!/OG_MAX_BYTES\s*=\s*300_?000\b/.test(render)) offenders.push('OG_MAX_BYTES is not 300000')
  const f = fnNamed(render, 'renderEvite')
  if (!f) offenders.push('renderEvite not found')
  else {
    examined++
    const body = squash(f.body)
    const guard = body.search(/if \(og\.length >= \(opts\.ogMaxBytes \?\? OG_MAX_BYTES\)\) throw new RenderFailure\('og-too-large'\)/)
    const upload = body.search(/\.upload\(/)
    if (guard < 0) offenders.push("renderEvite: the og-too-large guard is missing, neutered or no longer throws")
    if (upload < 0) offenders.push('renderEvite: no upload found (the rule would pass vacuously)')
    if (guard >= 0 && upload >= 0 && guard > upload) offenders.push('renderEvite: the size guard comes AFTER the upload')
    if (!/\bog\s*=\s*await toJpeg\(/.test(body) || body.search(/\bog\s*=\s*await toJpeg\(/) > guard) offenders.push('renderEvite: the guard does not follow the og render')
  }

  const renderFiles = Object.keys(files).filter(
    (rel) => /^lib\/evites\/(?:render|assets|fit|glyphs|layout|fontFaces|hash)\.ts$/.test(rel) || /^lib\/evites\/templates\//.test(rel) || /^components\/evites\/(?:InviteCanvas|OgCard)\.tsx$/.test(rel) || /\bsatori\b/.test(files[rel]),
  )
  for (const rel of renderFiles) {
    examined++
    const code = files[rel]
    if (/(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"](?:next\/og|@vercel\/og)['"]/.test(code)) offenders.push(`${rel}: imports next/og`)
    if (/\bImageResponse\b/.test(code)) offenders.push(`${rel}: uses ImageResponse (next/og)`)
    if (/\bloadAdditionalAsset\b/.test(code)) offenders.push(`${rel}: passes loadAdditionalAsset`)
  }
  return { examined, offenders }
}

/* ── copy (review C15, SOW S18) ───────────────────────────────── */

/** Not one of the spec's ten, but the same kind of rule: the feature's customer-facing name is "Host Hampton EVITE". */
export function ruleCopy(files: Files): Verdict {
  const offenders: string[] = []
  let examined = 0
  for (const rel of Object.keys(files)) {
    examined++
    const m = /digital\s+e-?vite|e-?vite\s+digital\s+invitation/i.exec(files[rel])
    if (m) offenders.push(`${rel}: "${m[0]}"`)
  }
  return { examined, offenders }
}

/* ── the tests ────────────────────────────────────────────────── */

const FLOORS: Record<string, number> = {
  // 5 route handlers + 2 page functions + load + every public file (18 measured)
  E1: 16,
  // the rsvp: properties + the evite_rsvps chains + the view (11 measured)
  E2: 10,
  // every evite file + state.ts (81 measured)
  E3: 70,
  E4: 70,
  // every .select( in evite code (94 measured)
  E5: 85,
  // 1 sendEviteEmail + the performSend signature + 2 performSend sites
  E6: 4,
  E7: 8,
  E8: 70,
  E9: 14,
}
const RULES: Record<string, (f: Files) => Verdict> = { E1: ruleE1, E2: ruleE2, E3: ruleE3, E4: ruleE4, E5: ruleE5, E6: ruleE6, E7: ruleE7, E8: ruleE8, E9: ruleE9 }

describe('the surface is read', () => {
  it('the tree was read, with the files the rules name', () => {
    const files = disk()
    expect(Object.keys(files).length).toBeGreaterThan(300)
    for (const rel of [
      'lib/evites/club.ts',
      'lib/evites/state.ts',
      'lib/evites/render.ts',
      'lib/evites/sendOne.ts',
      'lib/evites/cronTick.ts',
      'lib/evites/rsvpView.ts',
      'app/i/[slug]/page.tsx',
      'app/i/[slug]/loadInvite.ts',
      'app/api/i/[slug]/rsvp/route.ts',
      'components/MetaPixel.tsx',
    ]) {
      expect(files[rel]).toBeDefined()
      expect(files[rel].length).toBeGreaterThan(300)
    }
    expect(inScope(files, EVITE_RE).length).toBeGreaterThanOrEqual(60)
  })
})

describe('E1: the rate limiter precedes every database read on the public surface', () => {
  it('holds on the tree', () => {
    const v = ruleE1(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThanOrEqual(FLOORS.E1)
  })
  it('fires: a handler that reads before it limits, or drops the limit, is an offender', () => {
    const page = disk()['app/i/[slug]/page.tsx']
    const mk = (route: string) => ({ ...disk(), 'app/api/i/[slug]/event/route.ts': route })
    const real = disk()['app/api/i/[slug]/event/route.ts']
    expect(ruleE1(mk(real.replace(/if \(limited\) return limited/, ''))).offenders.length).toBeGreaterThan(0)
    expect(ruleE1(mk(real.replace(/(export async function POST\([^)]*\)[^{]*\{)/, '$1 const s = getSupabase();'))).offenders.length).toBeGreaterThan(0)
    expect(ruleE1({ ...disk(), 'app/i/[slug]/page.tsx': page.replace(/await loadInvite\(params\.slug\)/, 'await getSupabase()') }).offenders.length).toBeGreaterThan(0)
  })
})

describe('E2: a public response serialises an RSVP only through the allow-list', () => {
  it('holds on the tree', () => {
    const v = ruleE2(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThanOrEqual(FLOORS.E2)
  })
  it('the allow-list itself names no private column', () => {
    for (const bad of ['id', 'evite_id', 'edit_nonce', 'consent_ip', 'contact_id', 'opt_in_text_version', 'cal_version_seen', 'allergy_purged_at', 'contacts_purged_at']) {
      expect((PUBLIC_RSVP_SELF_COLUMNS as readonly string[]).includes(bad)).toBe(false)
    }
    expect(PUBLIC_RSVP_SELF_COLUMNS.length).toBeGreaterThanOrEqual(15)
  })
  it('fires: a raw row in a response, or a wider select, is an offender', () => {
    const rel = 'app/api/i/[slug]/rsvp/route.ts'
    const real = disk()[rel]
    expect(ruleE2({ ...disk(), [rel]: real.replace('rsvp: ownRsvpView(row)', 'rsvp: row') }).offenders.length).toBeGreaterThan(0)
    expect(ruleE2({ ...disk(), [rel]: real.replace('.select(OWN_RSVP_SELECT)', ".select('id, edit_nonce, consent_ip')") }).offenders.length).toBeGreaterThan(0)
  })
})

describe('E3: "Booked" comes only from bookingStatus', () => {
  it('holds on the tree', () => {
    const v = ruleE3(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThanOrEqual(FLOORS.E3)
  })
  it('fires: a re-derived booked, or a status literal, is an offender', () => {
    const rel = 'lib/evites/state.ts'
    const real = disk()[rel]
    expect(ruleE3({ ...disk(), [rel]: real.replace("const booked = stage === 'booked' || stage === 'completed'", "const booked = booking.status === 'deposit_paid'") }).offenders.length).toBeGreaterThan(0)
    expect(ruleE3({ ...disk(), 'lib/evites/facts.ts': disk()['lib/evites/facts.ts'] + "\nconst x = 'paid_in_full'" }).offenders.length).toBeGreaterThan(0)
  })
})

describe('E4: the Birthday Club never writes consent or names onto an existing contact', () => {
  it('holds on the tree', () => {
    const v = ruleE4(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThanOrEqual(FLOORS.E4)
  })
  it('fires: upsertContact, an UPDATE of a contact, or a true opt-in is an offender', () => {
    const rel = 'lib/evites/club.ts'
    const real = disk()[rel]
    expect(ruleE4({ ...disk(), [rel]: "import { upsertContact } from '@/lib/contacts'\n" + real }).offenders.length).toBeGreaterThan(0)
    expect(ruleE4({ ...disk(), [rel]: real.replace("email_opt_in: false", 'email_opt_in: true') }).offenders.length).toBeGreaterThan(0)
    expect(ruleE4({ ...disk(), [rel]: real.replace("if (first.kind === 'found') return", "await supabase.from('contacts').update({ first_name: 'x' }).eq('id', 'x')\n  if (first.kind === 'found') return") }).offenders.length).toBeGreaterThan(0)
  })
})

describe('E5: no select(*) in evite code', () => {
  it('holds on the tree', () => {
    const v = ruleE5(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThanOrEqual(FLOORS.E5)
  })
  it('fires: select("*"), select() and a starred list are offenders', () => {
    const rel = 'lib/evites/club.ts'
    const real = disk()[rel]
    expect(ruleE5({ ...disk(), [rel]: real.replace(".select('id')", ".select('*')") }).offenders.length).toBeGreaterThan(0)
    expect(ruleE5({ ...disk(), [rel]: real.replace(".select('id')", '.select()') }).offenders.length).toBeGreaterThan(0)
    expect(ruleE5({ ...disk(), [rel]: real.replace(".select('id')", ".select('id, *')") }).offenders.length).toBeGreaterThan(0)
  })
})

describe('E6: a claim precedes every send', () => {
  it('holds on the tree', () => {
    const v = ruleE6(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThanOrEqual(FLOORS.E6)
  })
  it('fires: a send without its claim, or from a new site, is an offender', () => {
    const one = disk()['lib/evites/sendOne.ts']
    expect(ruleE6({ ...disk(), 'lib/evites/sendOne.ts': one.replace('const claim = await claimSend(supabase, key, opts.now)', 'const claim = { kind: "claimed", send: key as never }') }).offenders.length).toBeGreaterThan(0)
    expect(ruleE6({ ...disk(), 'lib/evites/inlineSends.ts': disk()['lib/evites/inlineSends.ts'] + '\nasync function sneaky(s: never) { await performSend(s, s) }' }).offenders.length).toBeGreaterThan(0)
    const tick = disk()['lib/evites/cronTick.ts']
    expect(ruleE6({ ...disk(), 'lib/evites/cronTick.ts': tick.replace('await reclaimFailed(', 'await reclaimNothing(') }).offenders.length).toBeGreaterThan(0)
  })
})

describe('E7: the chrome steps aside on an invitation, after its hooks', () => {
  it('holds on the tree', () => {
    const v = ruleE7(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThanOrEqual(FLOORS.E7)
  })
  it('fires: an early return above a hook, or an ungated pixel effect, is an offender', () => {
    const nav = disk()['components/Nav.tsx']
    expect(ruleE7({ ...disk(), 'components/Nav.tsx': nav.replace(/(const pathname = usePathname\(\))/, '$1\n  if (isInvitePath(pathname)) return null') }).offenders.length).toBeGreaterThan(0)
    const px = disk()['components/MetaPixel.tsx']
    expect(ruleE7({ ...disk(), 'components/MetaPixel.tsx': px.replace(/if \(isMetaPixelBlockedPath\(pathname\)\) return\s*\n/, '') }).offenders.length).toBeGreaterThan(0)
  })
})

describe('E8: no setHours and no new Date(x + "T...") in evite code', () => {
  it('holds on the tree', () => {
    const v = ruleE8(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThanOrEqual(FLOORS.E8)
  })
  it('fires on both spellings', () => {
    const rel = 'lib/evites/ics.ts'
    const real = disk()[rel]
    expect(ruleE8({ ...disk(), [rel]: real + "\nconst a = new Date(d + 'T10:00:00')" }).offenders.length).toBeGreaterThan(0)
    expect(ruleE8({ ...disk(), [rel]: real + '\nconst b = new Date(`${d}T10:00:00`)' }).offenders.length).toBeGreaterThan(0)
    expect(ruleE8({ ...disk(), [rel]: real + '\nconst c = new Date(); c.setHours(10, 0, 0, 0)' }).offenders.length).toBeGreaterThan(0)
  })
})

describe('E9: the render store path is size-guarded and offline', () => {
  it('holds on the tree', () => {
    const v = ruleE9(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThanOrEqual(FLOORS.E9)
  })
  it('fires: a missing guard, a late guard, next/og, or loadAdditionalAsset is an offender', () => {
    const rel = 'lib/evites/render.ts'
    const real = disk()[rel]
    expect(ruleE9({ ...disk(), [rel]: real.replace("throw new RenderFailure('og-too-large')", 'void 0') }).offenders.length).toBeGreaterThan(0)
    expect(ruleE9({ ...disk(), [rel]: real.replace('300_000', '3_000_000') }).offenders.length).toBeGreaterThan(0)
    expect(ruleE9({ ...disk(), [rel]: "import { ImageResponse } from 'next/og'\n" + real }).offenders.length).toBeGreaterThan(0)
    expect(ruleE9({ ...disk(), [rel]: real + '\nconst o = { loadAdditionalAsset: async () => [] }' }).offenders.length).toBeGreaterThan(0)
  })
})

describe('copy: the feature is called "Host Hampton EVITE" (review C15)', () => {
  it('no "digital EVITE" wording survives anywhere in src', () => {
    const v = ruleCopy(disk())
    expect(v.offenders).toEqual([])
    expect(v.examined).toBeGreaterThan(300)
  })
  it('fires on the old wording', () => {
    expect(ruleCopy({ 'a.tsx': "'Digital EVITE invitation'" }).offenders).toHaveLength(1)
    expect(ruleCopy({ 'a.tsx': 'treat cart, digital EVITE, and' }).offenders).toHaveLength(1)
    expect(ruleCopy({ 'a.tsx': 'Host Hampton EVITE' }).offenders).toHaveLength(0)
  })
})

describe('E10: every rule examined what it claims, and no tripwire is switched off', () => {
  it('each rule examined at least its floor of sites (a rule that examined nothing proved nothing)', () => {
    const counts: Record<string, number> = {}
    for (const [id, rule] of Object.entries(RULES)) {
      const v = rule(disk())
      counts[id] = v.examined
      expect({ id, offenders: v.offenders }).toEqual({ id, offenders: [] })
      expect(v.examined).toBeGreaterThanOrEqual(FLOORS[id])
    }
    expect(Object.keys(counts).sort()).toEqual(['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'E9'])
  })

  it('the bound functions are never given an empty tree (the harness cannot be run on nothing)', () => {
    for (const rule of Object.values(RULES)) expect(rule({}).offenders.length).toBeGreaterThan(0)
  })

  it('no *Surface test, this one included, switches a rule off', () => {
    // Built from pieces: the deploy gate greps the tests for the literal spelling, comments and regexes included.
    const SK = ['\\b(?:describe|it|test)\\.', 'skip', '\\s*\\('].join('')
    const patterns = [new RegExp(SK), new RegExp('\\b' + ['x', 'it'].join('') + '\\s*\\('), new RegExp('\\b' + ['x', 'describe'].join('') + '\\s*\\('), new RegExp('\\.todo\\s*\\(')]
    const dirs = [path.join(SRC_ROOT, '__tests__', 'lib'), path.join(SRC_ROOT, '__tests__', 'lib', 'evites'), path.join(SRC_ROOT, '__tests__', 'app'), path.join(SRC_ROOT, '__tests__', 'api')]
    let examined = 0
    const offenders: string[] = []
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue
      for (const name of fs.readdirSync(dir)) {
        if (!/Surface\.test\.ts$/.test(name)) continue
        examined++
        const code = decomment(fs.readFileSync(path.join(dir, name), 'utf8'))
        for (const p of patterns) if (p.test(code)) offenders.push(`${name}: ${p.source}`)
      }
    }
    expect(examined).toBeGreaterThanOrEqual(10)
    expect(offenders).toEqual([])
    expect(fs.readFileSync(path.join(SRC_ROOT, '__tests__', 'lib', 'eviteSurface.test.ts'), 'utf8')).toContain('E10')
  })
})
