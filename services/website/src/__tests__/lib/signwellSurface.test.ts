/**
 * The e-signature tripwire.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. On 2026-09-12 all THREE SignWell webhook routes accepted an
 * unauthenticated POST and wrote a signature timestamp. Driven against
 * production from a laptop, a body carrying `"hash":"totally-made-up-hash"`
 * marked a liability waiver signed and was answered `{"received":true}`. The
 * suite was 2111/2111 green throughout, because nothing failed when the routes
 * were written — each merely lacked a check, and absence is what no test sees.
 *
 * Three defects compounded into a dead subsystem:
 *   * no signature verification anywhere (this file's R1/R2/R8);
 *   * `fetchSignedPdfUrl` read `files[].pdf_url`, a key SignWell never returns,
 *     so the signed PDF was never captured (R5);
 *   * no webhook was registered at SignWell at all, so none of it ever ran —
 *     which is why two real customers' signed waivers are recorded nowhere.
 *
 * Like `portalAuthSurface.test.ts`, this reads the sources off disk: a DENY-list
 * of shapes, a positive convention check, and a staleness walker, with every
 * exemption carrying its reason in code beside it.
 *
 * ── ATTACKED BEFORE IT WAS TRUSTED ──────────────────────────────────────────
 * Link 14's tripwire let 2 of 14 reintroduced defects through, both in rules
 * that looked obviously correct: one searched only inside `.select(…)` when the
 * real column list lived in a constant, and one carried a FILE-WIDE exemption
 * that excused the single file most worth checking. Both lessons are applied
 * here — the rules below scan whole files rather than one call shape, and every
 * exemption is scoped to a specific file AND a specific reason. Each rule was
 * then re-attacked by reintroducing the exact defect; see
 * `docs/signwell-agreement-review.md` §7 for the count that got through.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(process.cwd(), 'src')

/** The single module allowed to decide whether an event is genuine. */
const VERIFIER = 'lib/signwellWebhook.ts'
/** The single module allowed to write a signature outcome. */
const WRITERS = 'lib/signwellHandlers.ts'

/**
 * Every SignWell webhook route. The staleness walker below asserts this list is
 * exactly what is on disk, so a fourth route cannot appear unreviewed — which is
 * how three routes drifted into three different ideas of "signed".
 */
const WEBHOOK_ROUTES = [
  'app/api/webhooks/signwell/route.ts',
  'app/api/webhooks/signwell-checkin/route.ts',
  'app/api/webhooks/signwell-consent/route.ts',
  'app/api/studio-rental/signwell-webhook/route.ts',
]

/** Non-webhook files that create or read SignWell documents. */
const SUPPORT = [
  'lib/signwell.ts',
  'lib/signwellWebhook.ts',
  'lib/signwellHandlers.ts',
  'lib/marketing/consent.ts',
  'app/api/checkin/[token]/agreement/route.ts',
  'app/api/studio-rental/checkout/route.ts',
]

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}

/** Strip comments so a rule's own explanation cannot trip it, and so a defect
 *  cannot hide by being described in prose. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map(l => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

const rel = (p: string) => path.relative(SRC, p).split(path.sep).join('/')

/* ────────────────────────────────────────────────── staleness walker (R0) ── */

describe('R0 — the surface is what this test thinks it is', () => {
  it('every listed file exists', () => {
    for (const f of [...WEBHOOK_ROUTES, ...SUPPORT]) {
      expect({ file: f, exists: fs.existsSync(path.join(SRC, f)) }).toEqual({ file: f, exists: true })
    }
  })

  // The rule that catches the NEXT route, not the ones that exist today.
  it('no unlisted route handles SignWell events', () => {
    const found = walk(path.join(SRC, 'app', 'api'))
      .filter(p => /route\.tsx?$/.test(p))
      .filter(p => {
        const body = code(fs.readFileSync(p, 'utf8'))
        // A route "handles SignWell events" if it touches the envelope or the
        // signature columns. Deliberately broader than a filename match: the
        // point is to catch a route that does this WITHOUT saying signwell.
        return (
          /signwell/i.test(body) ||
          /agreement_signed_at|checkin_agreement_signed_at/.test(body) ||
          /document_completed|document_signed/.test(body)
        )
      })
      .map(rel)
      .sort()

    // /api/checkin/[token]/agreement CREATES a document (it is in SUPPORT) and
    // /api/portal/booking NAMES the columns in an allow-list; neither consumes
    // a webhook. Scoped to these two paths and no wider.
    const allowed = new Set([
      ...WEBHOOK_ROUTES,
      'app/api/checkin/[token]/agreement/route.ts', // creates documents, consumes no events
      'app/api/checkin/[token]/route.ts',           // reads checkin_agreement_signed_at to render
      'app/api/studio-rental/checkout/route.ts',    // creates the studio document
      'app/api/portal/booking/route.ts',            // names the columns in its output allow-list
      'app/api/admin/marketing/consent/route.ts',   // admin-gated: CREATES a consent release, consumes no events
    ])
    expect(found.filter(f => !allowed.has(f))).toEqual([])
  })
})

/* ──────────────────────────────────────────────────────── verification (R1) ── */

describe('R1 — every SignWell webhook route verifies before it writes', () => {
  it.each(WEBHOOK_ROUTES)('%s routes through the verified pipeline', (route) => {
    const body = code(read(route))
    const viaPipeline = /handleSignwellWebhook\s*\(/.test(body)
    const viaDirect = /verifySignwellEvent\s*\(/.test(body)
    expect({ route, verifies: viaPipeline || viaDirect }).toEqual({ route, verifies: true })
  })

  // A route could import the pipeline and then not use it on the POST path.
  it.each(WEBHOOK_ROUTES)('%s has no POST handler that writes without verifying', (route) => {
    const body = code(read(route))
    if (!/export\s+async\s+function\s+POST/.test(body)) return
    const writesDirectly = /\.from\(\s*['"](bookings|consent_releases)['"]\s*\)/.test(body)
    // If it writes to the DB itself it must ALSO verify in the same file.
    if (writesDirectly) {
      expect({ route, verifies: /verifySignwellEvent\s*\(/.test(body) }).toEqual({ route, verifies: true })
    }
  })
})

/* ──────────────────────────────────── one implementation of the HMAC (R2) ── */

describe('R2 — the signature scheme exists in exactly one place (rule 11)', () => {
  it('no file outside the verifier implements the SignWell HMAC', () => {
    const offenders = walk(SRC)
      .filter(p => !rel(p).startsWith('__tests__/'))
      .filter(p => rel(p) !== VERIFIER)
      .filter(p => {
        const body = code(fs.readFileSync(p, 'utf8'))
        // The SignWell scheme specifically: HMAC over "type@time".
        //
        // `event\s*\??\.` and not `event\.`: the first draft of this rule
        // matched only the plain dot form, and a route written as
        // `body?.event?.hash` walked straight past it during the attack run.
        // Optional chaining is the idiomatic way to read an untrusted payload,
        // so it is exactly the form a real reintroduction would take.
        return (
          /createHmac\s*\([\s\S]{0,200}@\$\{/.test(body) ||
          /event\s*\??\.\s*hash/.test(body)
        )
      })
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('the verifier really does compute HMAC-SHA256 over `type@time`', () => {
    const body = code(read(VERIFIER))
    expect(body).toMatch(/createHmac\(\s*['"]sha256['"]/)
    expect(body).toMatch(/\$\{type\}@\$\{timeStr\}/)
    // Keyed by the webhook id, per SignWell's documented scheme.
    expect(body).toMatch(/SIGNWELL_WEBHOOK_ID/)
  })

  it('the comparison is timing-safe', () => {
    expect(code(read(VERIFIER))).toMatch(/timingSafeEqual/)
  })
})

/* ─────────────────────────────────────── writes are confined + checked (R3) ── */

/** Column names whose presence as an OBJECT KEY means "this code writes a signature". */
const SIGNATURE_COLUMNS = [
  'agreement_signed_at',
  'checkin_agreement_signed_at',
  'agreement_pdf_url',
  'checkin_agreement_pdf_url',
]

describe('R3 — only the writer module records a signature', () => {
  it('no other file writes a signature column', () => {
    const offenders: string[] = []
    for (const p of walk(SRC).filter(f => !rel(f).startsWith('__tests__/'))) {
      if (rel(p) === WRITERS) continue
      const body = code(fs.readFileSync(p, 'utf8'))
      for (const col of SIGNATURE_COLUMNS) {
        // As an object KEY (`col:`) — a WRITE. Distinguished from `booking.col`
        // and `'col'` in an allow-list, which are READS and are fine. Link 14's
        // hole was a rule that could not tell a read from a write.
        if (new RegExp(`(^|[{,\\s])${col}\\s*:`, 'm').test(body)) offenders.push(`${rel(p)} → ${col}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('R4 — every Supabase write in the surface reads its result (rule 19)', () => {
  it.each([...WEBHOOK_ROUTES, ...SUPPORT])('%s has no unchecked insert/update', (file) => {
    const body = code(read(file))
    const unchecked: string[] = []
    // A write whose statement begins with a bare `await supabase` and is never
    // destructured has discarded its SQLSTATE. Matches the whole statement, not
    // a single call shape.
    const re = /(^|\n)\s*await\s+(supabase|this\.supabase)\s*\n?\s*\.from\([\s\S]{0,400}?(?=\n\s*(?:const|let|return|if|await|\}|$))/g
    for (const m of body.match(re) ?? []) {
      if (/\.(insert|update|upsert|delete)\(/.test(m)) unchecked.push(m.trim().slice(0, 80))
    }
    expect({ file, unchecked }).toEqual({ file, unchecked: [] })
  })
})

/* ────────────────────────────────────────────── the PDF is really fetched (R5) ── */

describe('R5 — the signed PDF is fetched from the endpoint that returns one', () => {
  const body = () => code(read('lib/signwell.ts'))

  // The original bug: files[].pdf_url does not exist on any SignWell document,
  // so this returned null 100% of the time and the artifact was never captured.
  it('does not read a pdf_url key off the files array', () => {
    expect(body()).not.toMatch(/files\s*[?.]*\.(find|map|filter)/)
    expect(body()).not.toMatch(/pdf_url/)
  })

  it('uses the documented completed_pdf endpoint and reads file_url', () => {
    expect(body()).toMatch(/completed_pdf/)
    expect(body()).toMatch(/url_only=true/)
    expect(body()).toMatch(/file_url/)
  })
})

/* ──────────────────────────────────────────────── fail-closed posture (R6..R8) ── */

describe('R6 — no raw PostgREST filter interpolation in the surface (rule 16)', () => {
  it.each([...WEBHOOK_ROUTES, ...SUPPORT])('%s builds no `.or()` from a template literal', (file) => {
    const body = code(read(file))
    // `.or()` takes a RAW filter expression; interpolating an attacker-supplied
    // document id into it lets a `,` or `)` rewrite the filter.
    expect({ file, hit: /\.or\(\s*`/.test(body) }).toEqual({ file, hit: false })
  })
})

describe('R7 — the body is never trusted for identity', () => {
  it('the writer module resolves booking_ref/release_id from the SignWell response', () => {
    const body = code(read(WRITERS))
    // Writers receive `truth` (SignWell's own metadata) and must key off it.
    expect(body).toMatch(/truth\.bookingRef/)
    expect(body).toMatch(/truth\.releaseId/)
    // and must NOT reach for the parsed body's copies of the same fields.
    expect(body).not.toMatch(/parsed\.bookingRef/)
    expect(body).not.toMatch(/parsed\.releaseId/)
  })

  it('the orchestrator dispatches on SignWell\'s type, not the payload\'s', () => {
    const body = code(read(WRITERS))
    expect(body).toMatch(/truth\.metadata\.type/)
    expect(body).not.toMatch(/SIGNWELL_WRITERS\[\s*parsed\.docType\s*\]/)
  })
})

describe('R8 — an unconfigured verifier fails CLOSED', () => {
  it('missing SIGNWELL_WEBHOOK_ID is a refusal, never a bypass', () => {
    const body = code(read(VERIFIER))
    // The shape that would be wrong: returning ok/true/null when unconfigured,
    // as /api/webhooks/quo deliberately does for a lower-stakes surface.
    expect(body).toMatch(/if\s*\(!webhookId\)\s*return\s*\{\s*ok:\s*false/)
    expect(body).not.toMatch(/if\s*\(!webhookId\)\s*return\s*(null|true|\{\s*ok:\s*true)/)
  })

  it('routes answer 5xx (retryable) when unconfigured and 401 when forged', () => {
    for (const route of WEBHOOK_ROUTES) {
      const body = code(read(route))
      if (!/verifySignwellEvent/.test(body)) continue
      expect({ route, ok: /unconfigured.*503|503.*unconfigured/s.test(body) }).toEqual({ route, ok: true })
    }
    // The shared pipeline is where the status codes actually live.
    const handlers = code(read(WRITERS))
    expect(handlers).toMatch(/unconfigured'\s*\?\s*503\s*:\s*401/)
  })

  // EVERY branch, checked individually.
  //
  // The first draft of this rule was `expect(handlers).toMatch(/unavailable[\s\S]{0,400}503/)`
  // — one match anywhere in the file satisfied it. During the attack run the
  // orchestrator's 503 was replaced with a silent 200 and the rule stayed green,
  // because two OTHER unavailable→503 branches further down the file still
  // matched. A whole-file regex cannot tell you that every site is correct; it
  // tells you that at least one is.
  it('EVERY upstream-unavailable branch answers a retryable 5xx (rule 12)', () => {
    const lines = code(read(WRITERS)).split('\n')
    const offenders: string[] = []
    lines.forEach((line, i) => {
      if (!/\.kind === 'unavailable'/.test(line)) return
      const window = lines.slice(i, i + 8).join('\n')
      if (!/status:\s*5\d\d/.test(window)) offenders.push(`line ${i + 1}: ${line.trim()}`)
    })
    // and there must actually BE such branches, or the rule is vacuous.
    expect(lines.filter(l => /\.kind === 'unavailable'/.test(l)).length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
