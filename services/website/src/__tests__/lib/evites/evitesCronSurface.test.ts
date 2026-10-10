import { readSrc } from '../../helpers/sourceScan'
import { BACKFILL_PER_TICK, RENDERS_PER_TICK, STEP7_SENDS_PER_TICK, LEAD_PREVIEW_PER_TICK, RECLAIM_PER_TICK } from '@/lib/evites/cronTick'
import { CANCEL_GRACE_MS, ORPHAN_LOOKBACK_MS, ORPHAN_MIN_AGE_MS, LEAD_PREVIEW_MIN_AGE_MS, LEAD_PREVIEW_MAX_EVITE_LAG_MS } from '@/lib/evites/cronDue'
import { IN_CHUNK } from '@/lib/evites/retention'

/**
 * Source rules for the evite scheduler (P09b): `app/api/cron/evite-sends/route.ts`, `cronTick.ts`, `cronDue.ts`,
 * `retention.ts`, `ensureNonFatal.ts`. Each rule is scoped to the site that matters (a body, a statement), counts
 * what it examined, tolerates CRLF and fails when the guard is neutered, not only when a string is deleted.
 */

const FILES = ['app/api/cron/evite-sends/route.ts', 'lib/evites/cronTick.ts', 'lib/evites/cronDue.ts', 'lib/evites/retention.ts', 'lib/evites/ensureNonFatal.ts', 'lib/evites/intakeChildName.ts']
const src = (rel: string) => readSrc(...rel.split('/'))
const squash = (s: string) => s.replace(/\s+/g, ' ')

/** From the `{` after a function's parameter list (paren-matched) to its matching `}`. */
function bodyOf(code: string, header: RegExp): string {
  const m = header.exec(code)
  expect(m).not.toBeNull()
  let i = (m as RegExpExecArray).index + (m as RegExpExecArray)[0].length
  let depth = 1
  while (i < code.length && depth > 0) {
    const c = code[i++]
    if (c === '(') depth++
    else if (c === ')') depth--
  }
  const open = code.indexOf('{', i)
  let d = 0
  for (let j = open; j < code.length; j++) {
    if (code[j] === '{') d++
    else if (code[j] === '}' && --d === 0) return code.slice(open, j + 1)
  }
  throw new Error('unbalanced')
}

describe('the surface is read', () => {
  it('every file exists and is non-trivial', () => {
    for (const rel of FILES) expect(src(rel).length).toBeGreaterThan(300)
  })
})

describe('time: the box is UTC', () => {
  it('no scheduler module uses a local-time Date setter, or builds a Date from a date string plus a time suffix', () => {
    let examined = 0
    for (const rel of FILES) {
      const code = src(rel)
      examined++
      expect(code).not.toMatch(/\.set(Hours|Minutes|Date|Month|FullYear)\s*\(/)
      expect(code).not.toMatch(/new Date\([^)]*\+\s*['"`]T/)
      expect(code).not.toMatch(/new Date\(`[^`]*T\d/)
    }
    expect(examined).toBe(FILES.length)
  })

  it('every due time goes through etToUtc / shiftEtDate', () => {
    const due = src('lib/evites/cronDue.ts')
    const at = bodyOf(due, /function atEt\(/)
    expect(at).toMatch(/shiftEtDate\(/)
    expect(at).toMatch(/etToUtc\(/)
    for (const name of ['weekBeforeDue', 'dayBeforeDue', 'finalHeadcountDue']) {
      expect(due).toMatch(new RegExp(`export const ${name} = \\(partyDate: string\\): Date \\| null => atEt\\(`))
    }
  })
})

describe('what the scheduler may reach', () => {
  it('never writes a send status, never calls Resend, never claims by hand: every send goes through sendOne', () => {
    const tick = src('lib/evites/cronTick.ts')
    expect(tick).not.toMatch(/\bfinishSend\b|\bclaimSend\b|\bsendEviteEmail\b|new Resend/)
    expect(tick).not.toMatch(/from\('evite_sends'\)\s*\.\s*(insert|update|delete|upsert)/)
    expect(tick).toMatch(/\bclaimAndSend\(/)
    expect(tick).toMatch(/\bperformSend\(/)
    const route = src('app/api/cron/evite-sends/route.ts')
    expect(route).not.toMatch(/\.from\(/)
  })

  it('no template literal is passed to .or(), and no .or( at all in the scheduler', () => {
    let examined = 0
    for (const rel of FILES) {
      examined++
      expect(src(rel)).not.toMatch(/\.or\s*\(/)
    }
    expect(examined).toBe(FILES.length)
  })

  it('every .in() list is chunked (PostgREST refuses ~390 ids)', () => {
    let seen = 0
    for (const rel of ['lib/evites/cronTick.ts', 'lib/evites/retention.ts']) {
      const code = src(rel)
      for (const m of Array.from(code.matchAll(/\.in\(\s*'[a-z_]+'\s*,\s*([^)]+)\)/g))) {
        seen++
        expect(m[1].trim()).toBe('part')
      }
    }
    expect(seen).toBeGreaterThanOrEqual(6)
    expect(IN_CHUNK).toBeLessThanOrEqual(200)
  })

  it('no console line interpolates a name, an address, a slug or a booking ref', () => {
    let lines = 0
    for (const rel of FILES) {
      for (const stmt of src(rel).match(/console\.(error|warn|log)\([^;]*\)/g) ?? []) {
        lines++
        for (const m of Array.from(stmt.matchAll(/\$\{([^}]*)\}/g))) {
          expect(m[1].replace(/\be\.name\b/g, '')).not.toMatch(/email|name|slug|phone|ref\b|booking_ref|contact/i)
        }
      }
    }
    expect(lines).toBeGreaterThanOrEqual(10)
  })
})

describe('the order of the steps (spec 9.3) and the gates', () => {
  const tick = () => bodyOf(src('lib/evites/cronTick.ts'), /export async function runEviteSendsTick\(/)

  it('runs backfill, scan, stamp, calendar, renders, reclaim, lead_preview, invite_ready, cancelled, guests, orphans, retention in that order', () => {
    const body = squash(tick())
    const order = ['backfill', 'scan', 'liveStamp', 'calChange', 'renders', 'reclaim', 'leadPreview', 'inviteReady', 'partyCancelled', 'step7', 'orphans', 'retention']
    let last = -1
    for (const step of order) {
      const at = body.indexOf(`guarded(run, '${step}'`)
      expect(at).toBeGreaterThan(last)
      last = at
    }
  })

  it('the sends are gated by the sends flag AND pages, and steps 1-3 and retention by the pages flag', () => {
    const body = squash(tick())
    expect(body).toMatch(/sendsActive: sends !== 'off' && pages !== 'off'/)
    expect(body).toMatch(/if \(pages !== 'off'\) \{ await guarded\(run, 'backfill'/)
    expect(body).toMatch(/if \(run\.sendsActive\) \{ await guarded\(run, 'reclaim'/)
    // both flags off costs nothing: the early return is before the Run is built (no database read)
    expect(body.indexOf("if (pages === 'off' && sends === 'off')")).toBeGreaterThan(-1)
    expect(body.indexOf("if (pages === 'off' && sends === 'off')")).toBeLessThan(body.indexOf('const run: Run'))
  })

  it('a scan that could not be read stops every send step', () => {
    const body = squash(tick())
    expect(body).toMatch(/if \(rep\.failedSteps\.includes\('scan'\)\) rep\.scan\.unavailable = true/)
    const sends = body.slice(body.indexOf('if (run.sendsActive)'))
    expect(sends).toMatch(/if \(!rep\.scan\.unavailable\) \{ await guarded\(run, 'leadPreview'/)
  })

  it('lead_preview and invite_ready read suppression BEFORE claiming, and an unreadable list defers without a claim', () => {
    const body = squash(bodyOf(src('lib/evites/cronTick.ts'), /async function stepParent\(/))
    const sup = body.indexOf('emailSuppressed(')
    const claim = body.indexOf('claimAndSend(')
    expect(sup).toBeGreaterThan(-1)
    expect(claim).toBeGreaterThan(sup)
    const between = body.slice(sup, claim)
    expect(between).toMatch(/if \(sup === 'unavailable'\) \{ bucket\.deferred \+= 1 continue \}/)
  })

  it('final_headcount is gated on its day_befores (a `wait` plan never reaches the sender)', () => {
    const body = squash(bodyOf(src('lib/evites/cronTick.ts'), /async function stepGuests\(/))
    expect(body).toMatch(/if \(plan\.kind === 'wait'\) \{ rep\.step7\.finalHeadcount\.waiting \+= 1 continue \}/)
    expect(body).toMatch(/if \(plan\.kind !== 'send'\) continue/)
    // day_before runs before final_headcount in the same tick
    expect(body.indexOf("'dayBefore'")).toBeLessThan(body.indexOf('planFinalHeadcount('))
  })

  it('the day_before selection does NOT consult the unworded studio arrival note', () => {
    expect(src('lib/evites/cronDue.ts')).not.toMatch(/STUDIO_ARRIVAL_NOTE/)
    expect(src('lib/evites/cronTick.ts')).not.toMatch(/STUDIO_ARRIVAL_NOTE/)
  })

  it('the step-7 budget is spent only by claims that were made, and checked before each claim', () => {
    const run = squash(bodyOf(src('lib/evites/cronTick.ts'), /async function runKeys\(/))
    expect(run.indexOf('budgetLeft(run) <= 0')).toBeGreaterThan(-1)
    expect(run.indexOf('budgetLeft(run) <= 0')).toBeLessThan(run.indexOf('claimAndSend('))
    expect(run).toMatch(/spend\(run, r\)/)
    const spend = squash(bodyOf(src('lib/evites/cronTick.ts'), /function spend\(/))
    expect(spend).toMatch(/r\.kind === 'sent' \|\| r\.kind === 'skipped' \|\| r\.kind === 'failed'/)
    expect(spend).not.toMatch(/duplicate|unavailable/)
  })
})

describe('the bounds are the spec\'s', () => {
  it('25 backfills, 2 renders, 50 step-7 sends', () => {
    expect(BACKFILL_PER_TICK).toBe(25)
    expect(RENDERS_PER_TICK).toBe(2)
    expect(STEP7_SENDS_PER_TICK).toBe(50)
    expect(LEAD_PREVIEW_PER_TICK).toBeLessThanOrEqual(25)
    expect(RECLAIM_PER_TICK).toBeLessThanOrEqual(50)
  })

  it('30-minute cancellation grace; 10-minute and 1-hour lead preview bounds; 48 h / 5 min orphan window', () => {
    expect(CANCEL_GRACE_MS).toBe(30 * 60_000)
    expect(LEAD_PREVIEW_MIN_AGE_MS).toBe(10 * 60_000)
    expect(LEAD_PREVIEW_MAX_EVITE_LAG_MS).toBe(60 * 60_000)
    expect(ORPHAN_LOOKBACK_MS).toBe(48 * 3_600_000)
    expect(ORPHAN_MIN_AGE_MS).toBe(5 * 60_000)
  })
})

describe('retention writes', () => {
  it('every UPDATE in retention is conditional, reads back, and reads its error', () => {
    const code = src('lib/evites/retention.ts')
    const updates = Array.from(code.matchAll(/\.update\(/g)).length
    expect(updates).toBeGreaterThanOrEqual(4)
    // each is followed by a `.select('id')` read-back and an error check on the result
    expect(Array.from(code.matchAll(/\.select\('id'\)/g)).length).toBeGreaterThanOrEqual(updates)
    expect(Array.from(code.matchAll(/if \((done|found|list|r)\.error\)/g)).length).toBeGreaterThanOrEqual(updates)
    // the three conditional guards that make a re-run harmless
    expect(code).toMatch(/\.is\('allergy_purged_at', null\)/)
    expect(code).toMatch(/\.is\('contacts_purged_at', null\)/)
    expect(code).toMatch(/\.is\('archived_at', null\)/)
  })

  it('the club rule: the non-club purge re-states that the guest is not a club member in the WRITE', () => {
    const body = squash(bodyOf(src('lib/evites/retention.ts'), /async function purgeContacts\(/))
    expect(body).toMatch(/consent_ip: null, contacts_purged_at: c\.nowIso \}\) \.in\('id', part\) \.is\('contacts_purged_at', null\) .*?\.is\('club_opt_in_at', null\)/)
  })

  it('dates are Eastern calendar days', () => {
    const code = src('lib/evites/retention.ts')
    expect(code).toMatch(/etDateString\(now\)/)
    expect(code).toMatch(/shiftEtDate\(/)
  })
})
