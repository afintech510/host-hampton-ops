/**
 * The tripwire for the scheduled-job surface — 14 route files.
 *
 * Every job this business has was written, tested and NOT RUNNING, and the
 * moment somebody switches them on they all fire at real people at once. Nobody
 * had ever exercised them as a SET, which is how "is this caller the scheduler?"
 * came to be answered fourteen separate times in two different ways, and how
 * two surfaces that both mail customers came to have no idea what "too late"
 * means.
 *
 * Written in the shape `portalAuthSurface.test.ts`, `signwellSurface.test.ts`,
 * `stripeWebhookSurface.test.ts`, `contactIdentitySurface.test.ts` and
 * `adminSurface.test.ts` established: shapes read off disk, a positive
 * convention check, a staleness walker, and every exemption scoped to a NAMED
 * FILE with a written reason.
 *
 * ── Comments are stripped before every rule ──────────────────────────────
 *
 * These route files are heavily commented, several of them quoting the exact
 * defect they removed. Link 16 lost two rules to a migration's own prose and
 * link 18 tripped a walker on a header comment. `decomment()` runs first.
 *
 * ── Rules are scoped to a SITE, never to a file ──────────────────────────
 *
 * A rule that greps a file can be satisfied by a different occurrence than the
 * one that broke — link 16 named the family, and it cost three of link 18's
 * twenty-six attack mutations. So R2 slices the exported function's own body
 * and R5 brace-matches the loop it cares about, rather than asking "does this
 * file contain X".
 *
 * ── What this cannot see, stated rather than implied ─────────────────────
 *
 *  - It is a lexer. A guard reached through a helper it does not know about is
 *    invisible. `sequenceBacklog.test.ts` and `sendReminders.test.ts` are the
 *    behaviour half, driven against fakes that refuse what Postgres refuses.
 *  - R1 proves a handler MENTIONS the gate, not that the gate runs first.
 */

import fs from 'fs'
import path from 'path'

const WEBSITE_SRC = path.join(process.cwd(), 'src')
const CRON_ROOT = path.join(WEBSITE_SRC, 'app', 'api', 'cron')
const LIB = path.join(WEBSITE_SRC, 'lib')

function decomment(s: string): string {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n\r]/g, ' '))
    .replace(/(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
}

function walkRoutes(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkRoutes(p))
    else if (e.name === 'route.ts') out.push(p)
  }
  return out.sort()
}

const ROUTE_FILES = walkRoutes(CRON_ROOT)
const rel = (abs: string) => path.relative(CRON_ROOT, abs).split(path.sep).join('/')
const readClean = (abs: string) => decomment(fs.readFileSync(abs, 'utf8'))

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

type Handler = { file: string; method: string; body: string }

function handlersOf(abs: string): Handler[] {
  const src = readClean(abs)
  const marks: { method: string; idx: number }[] = []
  for (const m of HTTP_METHODS) {
    const re = new RegExp(
      `export\\s+(?:async\\s+)?function\\s+${m}\\s*\\(|export\\s+const\\s+${m}\\s*[:=]`,
      'g',
    )
    let mt: RegExpExecArray | null
    while ((mt = re.exec(src))) marks.push({ method: m, idx: mt.index })
  }
  marks.sort((a, b) => a.idx - b.idx)
  return marks.map((mk, i) => ({
    file: rel(abs),
    method: mk.method,
    body: src.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : src.length),
  }))
}

const ALL_HANDLERS: Handler[] = ROUTE_FILES.flatMap(handlersOf)

/**
 * The body of `name`'s declaration in `src`, brace-matched. '' if absent.
 *
 * The parameter list is paren-matched FIRST. Taking the next `{` after the name
 * finds the default value in `processSequences(opts: ProcessOptions = {})` and
 * returns a two-character "body" that no rule can ever match — which is a rule
 * that passes for the wrong reason in the one direction this file exists to
 * prevent. Caught by my own harness before it shipped; see rule 8's list.
 */
function functionBody(src: string, name: string): string {
  const re = new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\(`)
  const m = src.match(re)
  if (!m || m.index === undefined) return ''

  let i = m.index + m[0].length - 1 // on the '('
  let parens = 0
  for (; i < src.length; i++) {
    if (src[i] === '(') parens++
    else if (src[i] === ')') { parens--; if (parens === 0) { i++; break } }
  }
  const open = src.indexOf('{', i)
  if (open < 0) return ''

  let depth = 0
  for (let j = open; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') {
      depth--
      if (depth === 0) return src.slice(m.index, j + 1)
    }
  }
  return ''
}

/** Read + decomment a LIB file by path. Kept distinct from `readClean` so a
 *  caller cannot accidentally hand it file CONTENT and get a silent ''. */
function readLib(...parts: string[]): string {
  return decomment(fs.readFileSync(path.join(LIB, ...parts), 'utf8'))
}

/* ── R0: the walker cannot go blind ─────────────────────────────────────── */

describe('R0: the cron surface cannot go stale', () => {
  it('every route file yields at least one recognised handler', () => {
    // A file whose handler this walker cannot see is a file every rule below
    // silently skips — link 16's R6b, which matched nothing and so passed.
    const blind = ROUTE_FILES.filter(f => handlersOf(f).length === 0).map(rel)
    expect(blind).toEqual([])
  })

  it('the surface is the size we think it is', () => {
    // A floor, not a pin: new jobs are legitimate. It stops this file quietly
    // walking an empty directory after a refactor.
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(14)
    expect(ALL_HANDLERS.length).toBeGreaterThanOrEqual(14)
  })

  it('the fourteen jobs we know about are all still here', () => {
    // Named, because AGENTS.md §8 documents each one's schedule and blast radius
    // and a job that disappears from the code but not from cron-job.org is a
    // 404 nobody sees.
    const names = ROUTE_FILES.map(f => rel(f).replace('/route.ts', '')).sort()
    for (const known of [
      'agent-dispatch', 'agent-distill', 'birthday-rebooking', 'booking-locks',
      'draft-newsletter', 'event-reminders', 'experiment-report', 'gmail-sync',
      'process-sequences', 'send-campaigns', 'send-reminders', 'social-calendar',
      'summer-hair-reminders', 'weekly-town-drafts',
    ]) {
      expect(names).toContain(known)
    }
  })
})

/* ── R1 / R2: one credential check, and it fails closed ─────────────────── */

describe('R1: every cron handler is gated', () => {
  it('calls isCronAuthorized', () => {
    // There are no exemptions here and there is no reason for one: a cron route
    // is called by a scheduler, never by a browser.
    const offenders = ALL_HANDLERS
      .filter(h => !/isCronAuthorized\s*\(/.test(h.body))
      .map(h => `${h.file} ${h.method}`)
    expect(offenders).toEqual([])
  })

  it('imports it from lib/cronAuth rather than declaring its own', () => {
    const offenders = ROUTE_FILES
      .filter(f => !/from\s+'@\/lib\/cronAuth'/.test(readClean(f)))
      .map(rel)
    expect(offenders).toEqual([])
  })
})

describe('R2: there is exactly ONE implementation, and it fails closed', () => {
  it('no cron route declares its own isCronAuthorized', () => {
    // The defect this rule exists for: fourteen copies, SEVEN of them missing
    // the unset-secret guard that the other seven have and that
    // agent-distill's own comment explained, four files away.
    const offenders = ROUTE_FILES.filter(f => /function\s+isCronAuthorized/.test(readClean(f))).map(rel)
    expect(offenders).toEqual([])
  })

  it('no file outside lib/cronAuth.ts compares against process.env.CRON_SECRET', () => {
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!e.name.endsWith('.ts') && !e.name.endsWith('.tsx')) continue
        if (p === path.join(LIB, 'cronAuth.ts')) continue
        if (/===\s*process\.env\.CRON_SECRET|process\.env\.CRON_SECRET\s*===/.test(decomment(fs.readFileSync(p, 'utf8')))) {
          offenders.push(path.relative(WEBSITE_SRC, p).split(path.sep).join('/'))
        }
      }
    }
    walk(WEBSITE_SRC)
    expect(offenders).toEqual([])
  })

  it('the guard is in the function itself, not merely somewhere in the file', () => {
    // Scoped to the SITE. The whole-file form of this rule is satisfied by the
    // explanatory comment above it, or by any other early return in the file.
    const src = readLib('cronAuth.ts')
    const body = functionBody(src, 'isCronAuthorized')
    expect(body).not.toBe('')
    // Reads the expected value first, refuses when it is missing, and only then
    // compares. Deleting any one of the three fails this.
    expect(body).toMatch(/const\s+expected\s*=\s*process\.env\.CRON_SECRET/)
    expect(body).toMatch(/if\s*\(!expected\)\s*return\s+false/)
    expect(body).toMatch(/secret\s*===\s*expected/)
    // And the refusal must come BEFORE the comparison, or it is decoration.
    expect(body.indexOf('if (!expected) return false')).toBeLessThan(body.indexOf('secret === expected'))
  })
})

/* ── R3: the freshness bound ────────────────────────────────────────────── */

describe('R3: both customer-facing senders bound how LATE they will send', () => {
  const SENDERS = [
    { file: 'send-reminders/route.ts', fn: 'reminderMaxLatenessMs' },
    // The sequence bound lives in the processor, not the route.
    { file: null as string | null, fn: 'sequenceMaxLatenessMs' },
  ]

  it('send-reminders checks freshness after the claim and before dispatch', () => {
    const body = ALL_HANDLERS.find(h => h.file === 'send-reminders/route.ts' && h.method === 'GET')!.body
    expect(body).toMatch(/checkFreshness\s*\(/)
    expect(body).toMatch(/reminderMaxLatenessMs\s*\(\)/)
    const claimAt = body.indexOf('claimReminder(')
    const freshAt = body.indexOf('checkFreshness(')
    const dispatchAt = body.indexOf('dispatch(reminder')
    expect(claimAt).toBeGreaterThan(-1)
    expect(freshAt).toBeGreaterThan(claimAt)
    expect(dispatchAt).toBeGreaterThan(freshAt)
  })

  it('the sequence processor checks freshness before it claims a step', () => {
    const src = readLib('sequences', 'processor.ts')
    const body = functionBody(src, 'processOne')
    expect(body).not.toBe('')
    expect(body).toMatch(/checkFreshness\s*\(/)
    expect(body).toMatch(/sequenceMaxLatenessMs\s*\(\)/)
    const freshAt = body.indexOf('checkFreshness(')
    const claimAt = body.indexOf('claimStep(')
    expect(claimAt).toBeGreaterThan(freshAt)
  })

  it('the bounds live in exactly one file', () => {
    expect(SENDERS.length).toBe(2)
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { walk(p); continue }
        if (!e.name.endsWith('.ts')) continue
        if (p === path.join(LIB, 'scheduleFreshness.ts')) continue
        // Tests are allowed to pin a bound; they are not a second definition.
        if (p.includes(`${path.sep}__tests__${path.sep}`)) continue
        const src = decomment(fs.readFileSync(p, 'utf8'))
        if (/process\.env\.(REMINDER_MAX_LATENESS_HOURS|SEQUENCE_MAX_LATENESS_DAYS)/.test(src)) {
          offenders.push(path.relative(WEBSITE_SRC, p).split(path.sep).join('/'))
        }
      }
    }
    walk(WEBSITE_SRC)
    expect(offenders).toEqual([])
  })

  it('an unusable override falls back to the default rather than to no bound', () => {
    const src = readLib('scheduleFreshness.ts')
    const body = functionBody(src, 'readPositive')
    expect(body).not.toBe('')
    expect(body).toMatch(/!Number\.isFinite\(n\)\s*\|\|\s*n\s*<=\s*0/)
    expect(body).toMatch(/return\s+fallback/)
  })
})

/* ── R4: a job that sends to many people has a per-tick cap ─────────────── */

describe('R4: the high-blast-radius jobs are capped, and the cap means sends', () => {
  it('process-sequences passes a SEND cap, not a row cap', () => {
    const body = ALL_HANDLERS.find(h => h.file === 'process-sequences/route.ts' && h.method === 'GET')!.body
    expect(body).toMatch(/sendCap/)
    // The defect: `?limit=` used to set batchSize, and the two oldest rows on
    // the live table are on an inactive sequence, so it drained nobody. `limit`
    // must reach `sendCap` and `scan` must reach `batchSize`, never the reverse.
    expect(body).toMatch(/sendCap = Math\.min\(Math\.floor\(n\), BATCH_SIZE\)/)
    expect(body).toMatch(/\.\.\.\(sendCap \? \{ sendCap \} : \{\}\)/)
    expect(body).toMatch(/\.\.\.\(scanSize \? \{ batchSize: scanSize \} : \{\}\)/)
    expect(body).not.toMatch(/batchSize: sendCap/)
  })

  it('the processor enforces the send cap against `sent`, not against the scan', () => {
    const src = readLib('sequences', 'processor.ts')
    const body = functionBody(src, 'processSequences')
    expect(body).not.toBe('')
    expect(body).toMatch(/summary\.sent\s*>=\s*sendCap/)
  })

  it('send-campaigns caps how many 944-person campaigns one tick may claim', () => {
    const body = ALL_HANDLERS.find(h => h.file === 'send-campaigns/route.ts' && h.method === 'GET')!.body
    expect(body).toMatch(/MAX_PER_TICK/)
    expect(body).toMatch(/\.limit\(perTick\)/)
    expect(body).toMatch(/\.in\('id',/)
  })

  it('send-reminders keeps its 1..BATCH_SIZE bound and refuses anything else', () => {
    const body = ALL_HANDLERS.find(h => h.file === 'send-reminders/route.ts' && h.method === 'GET')!.body
    expect(body).toMatch(/Number\.isInteger\(n\)/)
    expect(body).toMatch(/status:\s*400/)
  })
})

/* ── R5: a job that mutates claims first and reads the result ───────────── */

describe('R5: the mutating jobs claim before they act', () => {
  it('booking-locks writes conditionally on the status it read, and reads it back', () => {
    const body = ALL_HANDLERS.find(h => h.file === 'booking-locks/route.ts' && h.method === 'GET')!.body
    // Slice the loop, so the rule cannot be satisfied by the SELECT above it.
    const loopAt = body.indexOf('for (const booking of bookings)')
    expect(loopAt).toBeGreaterThan(-1)
    const loop = body.slice(loopAt)
    expect(loop).toMatch(/\.update\(\{ status: 'modifications_locked'/)
    expect(loop).toMatch(/\.eq\('status', 'approved'\)/)
    expect(loop).toMatch(/\.select\('id'\)/)
    expect(loop).toMatch(/moved\.length === 0/)

    /**
     * And it must not lock a party that already happened.
     *
     * The first version of this line was `expect(loop).toMatch(/party_date/)`,
     * and the attack harness walked straight through it: neutering the guard to
     * `if (false)` left `booking.party_date` in the NOTE string two lines below,
     * which satisfied the rule. That is link 16's family — a match satisfied by
     * a different occurrence than the one that broke — for the third session
     * running, this time in my own tripwire. The guard's own condition is
     * sliced and checked, and it must come before the write.
     */
    const guardAt = loop.search(/if \(booking\.party_date/)
    expect(guardAt).toBeGreaterThan(-1)
    const guard = loop.slice(guardAt, loop.indexOf('{', guardAt))
    expect(guard).toMatch(/booking\.party_date\s*&&/)
    expect(guard).toMatch(/String\(booking\.party_date\)\s*<\s*today/)
    expect(guardAt).toBeLessThan(loop.indexOf(".update({ status: 'modifications_locked'"))
  })

  it('summer-hair-reminders claims the row BEFORE it texts, and releases on failure', () => {
    const body = ALL_HANDLERS.find(h => h.file === 'summer-hair-reminders/route.ts' && h.method === 'GET')!.body
    const claimAt = body.indexOf(".eq('reminder_sent', false)\n      .select('id')")
    const sendAt = body.indexOf('sendSMSVia(')
    expect(claimAt).toBeGreaterThan(-1)
    expect(sendAt).toBeGreaterThan(claimAt)
    expect(body).toMatch(/reminder_sent: false \}\)\s*\r?\n\s*\.eq\('id', b\.id\)/) // the release
  })

  it('summer-hair-reminders `force` cannot drop the already-sent guard', () => {
    const body = ALL_HANDLERS.find(h => h.file === 'summer-hair-reminders/route.ts' && h.method === 'GET')!.body
    // The filter is applied unconditionally as part of the query, not inside an
    // `if (!force)`. Slice from the query builder to the await.
    const qAt = body.indexOf("from('summer_hair_bookings')")
    const awaitAt = body.indexOf('await query')
    expect(qAt).toBeGreaterThan(-1)
    expect(awaitAt).toBeGreaterThan(qAt)
    const q = body.slice(qAt, awaitAt)
    expect(q).toMatch(/\.eq\('reminder_sent', false\)/)
    expect(q).not.toMatch(/if\s*\(!force\)[\s\S]*reminder_sent/)
  })

  it('summer-hair-reminders never puts a customer name or a raw phone in the response', () => {
    const body = ALL_HANDLERS.find(h => h.file === 'summer-hair-reminders/route.ts' && h.method === 'GET')!.body
    const retAt = body.lastIndexOf('return NextResponse.json({')
    expect(retAt).toBeGreaterThan(-1)
    const payload = body.slice(retAt)
    expect(payload).not.toMatch(/\bdebug\b/)
    expect(payload).not.toMatch(/\bphone\b/)
    expect(payload).not.toMatch(/\bname\b/)
  })
})

/* ── R6: a write whose failure changes what a human is told is read ─────── */

describe('R6: the cron writes that decide a sentence read their errors', () => {
  it('draft-newsletter reads the archive UPDATE error', () => {
    const body = ALL_HANDLERS.find(h => h.file === 'draft-newsletter/route.ts' && h.method === 'GET')!.body
    const at = body.indexOf("update({ is_active: false })")
    expect(at).toBeGreaterThan(-1)
    // The destructure is on the statement itself, not merely somewhere nearby.
    expect(body.slice(Math.max(0, at - 200), at)).toMatch(/error:\s*archiveErr/)
  })

  it('booking-locks uses the one audit writer rather than a bare insert', () => {
    const src = readClean(path.join(CRON_ROOT, 'booking-locks', 'route.ts'))
    expect(src).toMatch(/logBookingChange/)
    expect(src).not.toMatch(/from\('booking_modifications'\)\s*\.insert/)
  })

  it('no cron route writes a literal admin actor', () => {
    // Ten sessions have had to remove one. `system` is correct for a cron job
    // and is what the CHECK permits; `admin`/`ADMIN` would be a lie about who
    // did it.
    //
    // `actor:` is in the list because that is `logBookingChange`'s parameter
    // name, and a rule that only knew the COLUMN names missed a mutation that
    // wrote `actor: 'admin'` straight into `modified_by`. The value reaches the
    // same column either way.
    const offenders: string[] = []
    for (const f of ROUTE_FILES) {
      const src = readClean(f)
      if (/(modified_by|recorded_by|actor)\s*:\s*'(admin|ADMIN)'/.test(src)) offenders.push(rel(f))
    }
    expect(offenders).toEqual([])
  })
})

/* ── R7: the shared rules the rest of the codebase already enforces ─────── */

describe('R7: the cron surface obeys the standing rules', () => {
  it('no interpolated .or() anywhere under app/api/cron', () => {
    const offenders: string[] = []
    for (const f of ROUTE_FILES) {
      if (/\.or\(\s*`/.test(readClean(f))) offenders.push(rel(f))
    }
    expect(offenders).toEqual([])
  })

  it('no cron route filters an email column directly', () => {
    // `lib/contactLookup.ts` is the only place that may, because `contacts.email`
    // is raw text and `.eq()` is case-sensitive against 21 real addresses.
    const offenders: string[] = []
    for (const f of ROUTE_FILES) {
      const src = readClean(f)
      if (/\.(eq|ilike)\(\s*'(email|contact_email|customer_email)'/.test(src)) offenders.push(rel(f))
    }
    expect(offenders).toEqual([])
  })

  it('no cron route reads x-forwarded-host', () => {
    const offenders = ROUTE_FILES.filter(f => /x-forwarded-host/i.test(readClean(f))).map(rel)
    expect(offenders).toEqual([])
  })
})
