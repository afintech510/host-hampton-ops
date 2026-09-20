/**
 * THE OUTBOUND SEND PATH, held as one surface.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS GUARDS. Everything that answers "we decided to message a customer —
 * did the message actually go, to the right person, once, at a lawful hour?"
 * Four independent silent failures have now been found in this system's
 * scheduled jobs (the reminder queue that refused every insert for five months,
 * `process-sequences` stopping unnoticed for a month, two crons 401ing daily,
 * and an inbound webhook refusing every delivery for 2.5 days). Nothing watches
 * anything here, so the guard has to be the source itself.
 *
 * The specific defect that prompted this file: `lib/reminders.ts` scheduled all
 * ten reminder types with `setHours()` on a UTC container, firing them four to
 * five hours early — `event_sms_1day` at 6am Eastern, outside the hours the TCPA
 * permits texting in. The suite was 3048 tests green with that bug in it and
 * stayed 3048 green after the fix, because NO TEST ASSERTED A SCHEDULED TIME.
 * `reminderScheduling.test.ts` now does; this file stops the PATTERN coming
 * back anywhere on the surface.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW THE RULES ARE WRITTEN, and why each precaution is here.
 *
 *   • The module list is held EXACT IN BOTH DIRECTIONS (R0). A file that
 *     disappears fails, and a new send-path file that nobody added fails. A
 *     module the walker cannot see is a module every rule below silently skips.
 *   • Every rule COUNTS WHAT IT EXAMINED. Link 24's R8 anchored on `)\n`, which
 *     matches nothing in this CRLF repo, so it examined zero sites and passed
 *     over a `console.log` printing a customer's SMS. Every rule here asserts a
 *     non-zero examination count.
 *   • Every pattern tolerates CRLF (`\r?\n`, never a bare `\n`).
 *   • Comments are BLANKED, not deleted, by `decomment` — offsets are preserved
 *     so a proximity window measures real code and not blanked prose. Several
 *     rules below would otherwise fire on the very comments that document them.
 *   • Exclusions are CLASSIFIED by name, never regex'd away.
 */

import * as fs from 'fs'
import * as path from 'path'

const SRC = path.join(process.cwd(), 'src')
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/* ───────────────────────────────────────────────────────────────────────────
 * The surface.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Modules that COMPOSE or SCHEDULE an outbound customer message. */
const SEND_LIBS = [
  'lib/reminders.ts',
  'lib/reminderQueue.ts',
  'lib/checkinReminders.ts',
  'lib/quietHours.ts',
  'lib/partyTime.ts',
  'lib/scheduleFreshness.ts',
  'lib/sequences/processor.ts',
  'lib/sequences/render.ts',
  'lib/sms.ts',
  'lib/smsSegments.ts',
  'lib/ownerNotify.ts',
  'lib/marketing/budget.ts',
] as const

/** Cron routes that send, or that fill a queue something else sends from. */
const SEND_ROUTES = [
  'app/api/cron/send-reminders/route.ts',
  'app/api/cron/event-reminders/route.ts',
  'app/api/cron/birthday-rebooking/route.ts',
  'app/api/cron/summer-hair-reminders/route.ts',
  'app/api/cron/process-sequences/route.ts',
  'app/api/cron/send-campaigns/route.ts',
  'app/api/cron/draft-newsletter/route.ts',
  'app/api/cron/booking-locks/route.ts',
  // Added 2026-09-20. Migration 056's staff follow-up digest. It hands text to
  // Brevo (`sendTransactionalEmail`) and to `notifyOwnerSms`, so it IS a
  // sender — `NOT_A_SENDER` would have been a false statement, and the rules
  // below are the ones that would notice if it ever started messaging a
  // customer. Its audience is Adam, which is why the quiet-hours rule does not
  // reach it: that rule is scoped to the customer-facing SMS types.
  'app/api/cron/staff-reminders/route.ts',
] as const

const ALL = [...SEND_LIBS, ...SEND_ROUTES]

/**
 * Blank out comments and string/template literals' comment-lookalikes, keeping
 * every byte's offset. A rule that reads prose is a rule that fires on its own
 * documentation.
 */
function decomment(src: string): string {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const two = src.slice(i, i + 2)
    if (two === '//') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') { out += ' '; i++ }
    } else if (two === '/*') {
      while (i < n && src.slice(i, i + 2) !== '*/') { out += src[i] === '\n' || src[i] === '\r' ? src[i] : ' '; i++ }
      out += '  '; i += 2
    } else {
      out += src[i]; i++
    }
  }
  return out
}

/**
 * Blank the import block as well, offsets preserved.
 *
 * Three of this file's own rules failed on their first run for the same reason:
 * `indexOf('checkFreshness')` finds the IMPORT on line 47, not the call on line
 * 569, so an "A must come before B" rule compared two import positions and drew
 * a confident conclusion about nothing. That is link 21's wrong-occurrence
 * family in a new spelling, and it is why ORDERING rules read `bodyOf` while
 * PRESENCE rules read `code`.
 */
function stripImports(src: string): string {
  return src.replace(/^import\s[^\r\n]*(?:\r?\n\s+[^\r\n]*)*?;?\s*$/gm, m => ' '.repeat(m.length))
}

const code = new Map<string, string>()
const bodyOf = new Map<string, string>()
beforeAll(() => {
  for (const rel of ALL) {
    const d = decomment(read(rel))
    code.set(rel, d)
    bodyOf.set(rel, stripImports(d))
  }
})

/** Assert the import block really was removed, or every ordering rule is void. */
describe('the harness itself', () => {
  it('stripImports removes import lines and preserves offsets', () => {
    let examined = 0
    for (const rel of ALL) {
      const d = code.get(rel)!
      const b = bodyOf.get(rel)!
      expect(b.length).toBe(d.length)
      examined++
    }
    expect(examined).toBe(ALL.length)
    // A file that plainly has imports must lose them.
    const r = bodyOf.get('app/api/cron/send-reminders/route.ts')!
    expect(/import\s*\{/.test(r)).toBe(false)
    expect(r).toContain('export async function GET')
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R0. The walker sees the whole surface, and only the surface.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R0 — the surface is enumerated exactly', () => {
  it('every listed module exists on disk', () => {
    const missing = ALL.filter(rel => !fs.existsSync(path.join(SRC, rel)))
    expect(missing).toEqual([])
    expect(ALL.length).toBe(21)
  })

  it('every cron route that sends or enqueues is in SEND_ROUTES', () => {
    const cronDir = path.join(SRC, 'app/api/cron')
    const found = fs
      .readdirSync(cronDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => `app/api/cron/${d.name}/route.ts`)
      .filter(rel => fs.existsSync(path.join(SRC, rel)))

    expect(found.length).toBeGreaterThan(0)

    /**
     * Classified, not regex'd away. Each of these is a cron route that provably
     * hands nothing to a mail or SMS provider; if one of them GAINS a send, it
     * has to be moved into SEND_ROUTES deliberately — which is what R1 below
     * then checks for.
     */
    const NOT_A_SENDER: Record<string, string> = {
      'app/api/cron/agent-dispatch/route.ts': 'drafts for human review; the reviewer channel is its own surface',
      'app/api/cron/agent-distill/route.ts': 'writes agent_learnings proposals, inactive by default',
      'app/api/cron/gmail-sync/route.ts': 'INBOUND — reads mail, never sends',
      'app/api/cron/experiment-report/route.ts': 'writes a report row, sends nothing',
      'app/api/cron/social-calendar/route.ts': 'creates social_posts drafts',
      'app/api/cron/weekly-town-drafts/route.ts': 'creates website_content drafts',
    }

    const unaccounted = found.filter(
      rel => !(SEND_ROUTES as readonly string[]).includes(rel) && !(rel in NOT_A_SENDER)
    )
    expect(unaccounted).toEqual([])

    // Both directions: a classification for a route that no longer exists is a
    // stale exclusion, and stale exclusions are how a real route gets skipped.
    const staleExclusions = Object.keys(NOT_A_SENDER).filter(rel => !found.includes(rel))
    expect(staleExclusions).toEqual([])
  })

  it('every module is non-empty and was actually read', () => {
    let examined = 0
    for (const rel of ALL) {
      expect(code.get(rel)!.length).toBeGreaterThan(200)
      examined++
    }
    expect(examined).toBe(ALL.length)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R1. Local time. THE headline defect.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R1 — nothing on the send path schedules with setHours on a UTC box', () => {
  /**
   * `lib/partyTime.ts` is the ONE module permitted to do wall-clock arithmetic,
   * because it is the module that converts. Everything else asks it.
   */
  const TIME_AUTHORITY = 'lib/partyTime.ts'

  it('no send-path module outside partyTime.ts sets a WALL-CLOCK field', () => {
    /**
     * `setHours`/`setMinutes` are the dangerous ones: they interpret their
     * argument in the process timezone, which on this container is UTC.
     *
     * `setDate` is deliberately NOT banned. It is calendar arithmetic and is
     * offset-neutral for the span queries that use it — `draft-newsletter` does
     * `futureDate.setDate(getDate() + 30)` on `new Date()` to build a range, and
     * failing that would be a false positive teaching the next person to
     * disable the rule. The dangerous combination is a wall-clock PARSE feeding
     * date arithmetic, and that is what the next rule catches.
     */
    let examined = 0
    const offenders: string[] = []
    for (const rel of ALL) {
      if (rel === TIME_AUTHORITY) continue
      examined++
      const src = code.get(rel)!
      for (const m of src.matchAll(/\.(setHours|setMinutes)\s*\(/g)) {
        offenders.push(`${rel}: .${m[1]}()`)
      }
    }
    expect(examined).toBe(ALL.length - 1)
    expect(offenders).toEqual([])
  })

  it('partyTime.ts itself uses the UTC setters, which are offset-free', () => {
    const src = code.get(TIME_AUTHORITY)!
    // `setUTCDate` is calendar arithmetic on an explicit UTC anchor and carries
    // no local-timezone assumption. A bare `setDate` here would.
    expect(/\.setUTCDate\s*\(/.test(src)).toBe(true)
    expect(/(?<!UTC)\.setDate\s*\(/.test(src)).toBe(false)
    expect(/(?<!UTC)\.setHours\s*\(/.test(src)).toBe(false)
  })

  it('no module turns a bare `new Date(x + "T..:..:..")` into a SCHEDULED time', () => {
    /**
     * `new Date('2026-10-10T12:00:00')` is parsed as LOCAL time; the same string
     * with a `Z` or an offset is not. That expression is what put ten reminder
     * types four to five hours early.
     *
     * It is NOT banned outright, because the same shape at noon is the correct
     * idiom for rendering a date-only value: noon is twelve hours from either
     * boundary, so `.toLocaleDateString()` on it prints the right calendar day
     * in any timezone. `send-reminders` and `draft-newsletter` both use it that
     * way, for the date printed in the email body. Banning it there would be a
     * false positive on correct code — and a rule that cries wolf is a rule
     * somebody deletes.
     *
     * What is banned is the parse being kept: assigned, arithmetic'd, or
     * `.toISOString()`'d into a `scheduled_for`. The discriminator is whether
     * the very next thing done with it is formatting.
     */
    let examined = 0
    const offenders: string[] = []
    for (const rel of ALL) {
      examined++
      const src = code.get(rel)!
      for (const m of src.matchAll(/new Date\(\s*[^)]*?T\d{2}:\d{2}:\d{2}(?!Z|[+-]\d{2}:\d{2})[^)]*\)/g)) {
        const after = src.slice(m.index! + m[0].length, m.index! + m[0].length + 40)
        const isDisplayOnly = /^\s*\.\s*toLocale(Date|Time)?String/.test(after)
        if (!isDisplayOnly) offenders.push(`${rel}: ${m[0].slice(0, 60).replace(/\s+/g, ' ')}`)
      }
    }
    expect(examined).toBe(ALL.length)
    expect(offenders).toEqual([])
  })

  it('lib/reminders.ts schedules through etToUtc — the helper it re-exports', () => {
    const src = code.get('lib/reminders.ts')!
    expect(/import\s*\{[^}]*etToUtc[^}]*\}\s*from\s*'@\/lib\/partyTime'/.test(src)).toBe(true)
    expect(/shiftEtDate\s*\(/.test(src)).toBe(true)
    // It must not merely re-export it while computing times some other way —
    // that is precisely the state this file was in for five months.
    expect(/etToUtc\s*\(/.test(src)).toBe(true)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R2. Quiet hours. An SMS may not leave outside the legal window.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R2 — the SMS senders consult the quiet-hours window', () => {
  /** Routes that hand an SMS body to a provider on a schedule, with no human. */
  const UNATTENDED_SMS_SENDERS = ['app/api/cron/send-reminders/route.ts'] as const

  it('send-reminders checks quiet hours before dispatching any SMS', () => {
    let examined = 0
    for (const rel of UNATTENDED_SMS_SENDERS) {
      examined++
      const src = code.get(rel)!
      expect(src).toContain('checkSmsQuietHours')
      expect(/import\s*\{[^}]*checkSmsQuietHours[^}]*\}\s*from\s*'@\/lib\/quietHours'/.test(src)).toBe(true)
    }
    expect(examined).toBe(UNATTENDED_SMS_SENDERS.length)
  })

  it('the quiet-hours branch DEFERS and never cancels — a held text is not a dropped one', () => {
    const src = bodyOf.get('app/api/cron/send-reminders/route.ts')!
    const idx = src.indexOf('checkSmsQuietHours')
    expect(idx).toBeGreaterThan(-1)
    const window = src.slice(idx, idx + 600)
    expect(/kind:\s*'deferred'/.test(window)).toBe(true)
    expect(/kind:\s*'skipped'/.test(window)).toBe(false)
  })

  it('an unreadable hour is NOT treated as open (rule 12)', () => {
    const src = code.get('lib/quietHours.ts')!
    expect(/'unreadable'/.test(src)).toBe(true)
    const route = code.get('app/api/cron/send-reminders/route.ts')!
    const i = route.indexOf("window.kind === 'unreadable'")
    expect(i).toBeGreaterThan(-1)
    // Whatever it does, it must not fall through to a send.
    expect(/kind:\s*'(retry|skipped|failed|deferred)'/.test(route.slice(i, i + 300))).toBe(true)
  })

  it('the window is declared once and exported, not restated per caller (rule 11)', () => {
    const qh = code.get('lib/quietHours.ts')!
    expect(/export const SMS_WINDOW_OPEN_HOUR/.test(qh)).toBe(true)
    expect(/export const SMS_WINDOW_CLOSE_HOUR/.test(qh)).toBe(true)

    let examined = 0
    const offenders: string[] = []
    for (const rel of ALL) {
      if (rel === 'lib/quietHours.ts') continue
      examined++
      // A second module hard-coding 8 or 21 as an hour boundary is the rule-11
      // shape: a constant declared twice is a constant nothing is checking.
      const src = code.get(rel)!
      if (/getHours\(\)\s*[<>]=?\s*(8|21)\b/.test(src)) offenders.push(rel)
    }
    expect(examined).toBe(ALL.length - 1)
    expect(offenders).toEqual([])
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R3. Consent, read at SEND time, through ONE definition.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R3 — "may we message this person" has one implementation', () => {
  it('optedOutReason is exported from exactly one module', () => {
    let definitions = 0
    for (const rel of ALL) {
      if (/export function optedOutReason/.test(code.get(rel)!)) definitions++
    }
    expect(definitions).toBe(1)
    expect(/export function optedOutReason/.test(code.get('lib/sequences/processor.ts')!)).toBe(true)
  })

  it('optedOutReason reads BOTH the channel flag and contacts.status', () => {
    const src = code.get('lib/sequences/processor.ts')!
    const i = src.indexOf('export function optedOutReason')
    const body = src.slice(i, i + 1200)
    expect(body).toContain('sms_opt_in')
    expect(body).toContain('email_opt_in')
    expect(body).toContain("'unsubscribed'")
  })

  it('send-reminders imports it rather than restating it', () => {
    const src = code.get('app/api/cron/send-reminders/route.ts')!
    expect(/import\s*\{[^}]*optedOutReason[^}]*\}/.test(src)).toBe(true)
  })

  it('the SMS branch still fails closed on a NULL opt-in, which optedOutReason alone does not', () => {
    /**
     * `optedOutReason` tests `sms_opt_in === false`, so a NULL passes through it
     * as consent. `contacts.sms_opt_in` is nullable. Replacing the `!== true`
     * check WITH the shared helper — rather than adding it — would have turned
     * a missing answer into a yes, which is how this fix could have made the
     * surface worse than it found it.
     */
    const src = code.get('app/api/cron/send-reminders/route.ts')!
    expect(/sms_opt_in\s*!==\s*true/.test(src)).toBe(true)
  })

  it('every unattended sender re-reads consent at send time, not at enqueue time', () => {
    let examined = 0
    for (const rel of ['app/api/cron/send-reminders/route.ts', 'lib/sequences/processor.ts']) {
      examined++
      const src = code.get(rel)!
      expect(/opt_in|optedOutReason|hasExplicitSmsOptOut/.test(src)).toBe(true)
    }
    expect(examined).toBe(2)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R4. Claim before send. There is no way to un-send an SMS.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R4 — nothing sends before it owns the row', () => {
  it('the reminder claim is a conditional UPDATE read back with .select()', () => {
    const src = code.get('lib/reminderQueue.ts')!
    const i = src.indexOf('export async function claimReminder')
    expect(i).toBeGreaterThan(-1)
    const body = src.slice(i, i + 900)
    expect(/\.eq\(\s*'status'\s*,\s*'pending'\s*\)/.test(body)).toBe(true)
    expect(/\.select\(/.test(body)).toBe(true)
  })

  it('the sequence claim is an INSERT whose 23505 is matched by CODE, not message text', () => {
    const src = code.get('lib/sequences/processor.ts')!
    expect(src).toContain("'23505'")
    expect(/error\.message.*duplicate key|duplicate key.*error\.message/.test(src)).toBe(false)
  })

  it('summer-hair claims per row before texting, and releases on failure', () => {
    // `bodyOf`, not `code`: `indexOf('sendSMSVia')` on the raw source finds the
    // IMPORT at offset 163 and concludes the send happens before the claim.
    const src = bodyOf.get('app/api/cron/summer-hair-reminders/route.ts')!
    const claim = src.indexOf("update({ reminder_sent: true })")
    const send = src.indexOf('sendSMSVia')
    expect(claim).toBeGreaterThan(-1)
    expect(send).toBeGreaterThan(-1)
    expect(claim).toBeLessThan(send)
    expect(src).toContain('update({ reminder_sent: false })')
  })

  it('the campaign claim caps how many rows one tick may take — each is 944 inboxes', () => {
    const src = code.get('app/api/cron/send-campaigns/route.ts')!
    expect(/MAX_PER_TICK/.test(src)).toBe(true)
    expect(/\.limit\(\s*perTick\s*\)/.test(src)).toBe(true)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R5. Rule 10 — a run that sent nothing must not look like a run that sent.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R5 — outcomes are named, and a non-send is never recorded as a send', () => {
  it('finishReminder is the only writer of scheduled_reminders.status on the send path', () => {
    let offenders: string[] = []
    let examined = 0
    for (const rel of SEND_ROUTES) {
      examined++
      const src = code.get(rel)!
      // A route writing status:'sent' directly is the defect link 10 removed.
      if (/from\('scheduled_reminders'\)[\s\S]{0,200}?status:\s*'sent'/.test(src)) offenders.push(rel)
    }
    expect(examined).toBe(SEND_ROUTES.length)
    expect(offenders).toEqual([])
  })

  it('every SendOutcome kind carries a reason except the delivered one', () => {
    const src = code.get('lib/reminderQueue.ts')!
    const i = src.indexOf('export type SendOutcome')
    const body = src.slice(i, i + 900)
    for (const kind of ['skipped', 'retry', 'failed', 'deferred']) {
      expect(new RegExp(`kind:\\s*'${kind}';\\s*reason:\\s*string`).test(body)).toBe(true)
    }
  })

  it('the reminder tally counts deferred separately from skipped', () => {
    const src = code.get('app/api/cron/send-reminders/route.ts')!
    expect(/deferred:\s*0/.test(src)).toBe(true)
  })

  it('send-campaigns distinguishes created-not-sent from sent', () => {
    const src = code.get('app/api/cron/send-campaigns/route.ts')!
    expect(src).toContain('created_not_sent')
  })

  it('send-campaigns classifies campaign_type instead of relying on an empty body', () => {
    /**
     * Every `campaign_type='sms'` row happens to have a NULL body_html, so the
     * empty-body guard stopped them — with the note "no body_html", a true
     * sentence about the wrong problem. One SMS row with a body would have been
     * emailed to 944 people.
     */
    const src = code.get('app/api/cron/send-campaigns/route.ts')!
    expect(src).toContain('EMAIL_CAMPAIGN_TYPES')
    const i = src.indexOf('EMAIL_CAMPAIGN_TYPES.has')
    const j = src.indexOf('sendCampaign(')
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(-1)
    expect(i).toBeLessThan(j)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R6. Rule 19 — an error you do not read is an error that did not happen.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R6 — writes on the send path read their own errors', () => {
  it('every enqueue goes through enqueueReminders, which destructures .error', () => {
    const q = code.get('lib/reminderQueue.ts')!
    const i = q.indexOf('export async function enqueueReminders')
    expect(/const \{ error \} = await supabase/.test(q.slice(i, i + 600))).toBe(true)

    let examined = 0
    const offenders: string[] = []
    for (const rel of ALL) {
      if (rel === 'lib/reminderQueue.ts') continue
      examined++
      const src = code.get(rel)!
      // A direct insert into scheduled_reminders bypasses the one reader.
      if (/from\('scheduled_reminders'\)\s*\.insert/.test(src)) offenders.push(rel)
    }
    expect(examined).toBe(ALL.length - 1)
    expect(offenders).toEqual([])
  })

  it('claim/takeover UPDATEs read back with .select() — an UPDATE without one cannot report zero rows', () => {
    let examined = 0
    for (const [rel, marker] of [
      ['lib/reminderQueue.ts', 'claimReminder'],
      ['lib/sequences/processor.ts', 'claimStep'],
    ] as const) {
      examined++
      const src = code.get(rel)!
      const i = src.indexOf(marker)
      expect(i).toBeGreaterThan(-1)
      expect(/\.select\(/.test(src.slice(i, i + 2500))).toBe(true)
    }
    expect(examined).toBe(2)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R7. Nothing on this surface logs a customer's message body or raw number.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R7 — logs carry counts and masked identifiers, never content', () => {
  it('no console call interpolates an SMS body or an email html variable', () => {
    let examined = 0
    const offenders: string[] = []
    const BODYISH = /\$\{\s*(body|html|text|sms|rendered\.html|rendered\.text|message)\s*\}/
    for (const rel of ALL) {
      const src = code.get(rel)!
      // Match a console call and everything up to the end of that line, CRLF-safe.
      for (const m of src.matchAll(/console\.(log|warn|error|info)\([^\r\n]*/g)) {
        examined++
        if (BODYISH.test(m[0])) offenders.push(`${rel}: ${m[0].slice(0, 80)}`)
      }
    }
    // Count SITES, not files (link 24's R8 counted files and examined nothing).
    expect(examined).toBeGreaterThan(30)
    expect(offenders).toEqual([])
  })

  it('summer-hair masks the phone number in every note it returns', () => {
    const src = code.get('app/api/cron/summer-hair-reminders/route.ts')!
    expect(/function maskPhone/.test(src)).toBe(true)
    // The JSON body must not carry a raw number or a customer name.
    const i = src.indexOf('return NextResponse.json({')
    const tail = src.slice(i)
    expect(/\bphone\b\s*:/.test(tail)).toBe(false)
    expect(/\bname\b\s*:/.test(tail)).toBe(false)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R8. Cron auth, one definition, fail-closed.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R8 — every send route is behind the one cron check', () => {
  it('each route imports isCronAuthorized and none declares its own', () => {
    let examined = 0
    for (const rel of SEND_ROUTES) {
      examined++
      const src = code.get(rel)!
      expect(/import\s*\{[^}]*isCronAuthorized[^}]*\}\s*from\s*'@\/lib\/cronAuth'/.test(src)).toBe(true)
      expect(/function isCronAuthorized/.test(src)).toBe(false)
    }
    expect(examined).toBe(SEND_ROUTES.length)
  })

  it('the auth check is the first thing in every handler', () => {
    let examined = 0
    for (const rel of SEND_ROUTES) {
      examined++
      const src = code.get(rel)!
      const handler = src.indexOf('export async function GET')
      expect(handler).toBeGreaterThan(-1)
      const head = src.slice(handler, handler + 300)
      expect(/isCronAuthorized\(req\)/.test(head)).toBe(true)
    }
    expect(examined).toBe(SEND_ROUTES.length)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R9. Freshness — a late date-anchored message is wrong, not late.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R9 — the backlog guards are still wired', () => {
  it('send-reminders bounds lateness before dispatching', () => {
    const src = code.get('app/api/cron/send-reminders/route.ts')!
    const check = src.indexOf('checkFreshness')
    const dispatch = src.indexOf('await dispatch(')
    expect(check).toBeGreaterThan(-1)
    expect(dispatch).toBeGreaterThan(-1)
    expect(check).toBeLessThan(dispatch)
  })

  it('process-sequences pauses a stale step rather than sending it', () => {
    const src = bodyOf.get('lib/sequences/processor.ts')!
    const i = src.indexOf('checkFreshness')
    expect(i).toBeGreaterThan(-1)
    const body = src.slice(i, i + 700)
    expect(/'paused'/.test(body)).toBe(true)
  })

  it('the two bounds are declared once, in scheduleFreshness', () => {
    const src = code.get('lib/scheduleFreshness.ts')!
    expect(/REMINDER_MAX_LATENESS_HOURS_DEFAULT/.test(src)).toBe(true)
    expect(/SEQUENCE_MAX_LATENESS_DAYS_DEFAULT/.test(src)).toBe(true)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * R10. No static skips anywhere on the surface suite (inherited house rule).
 * ─────────────────────────────────────────────────────────────────────────── */

describe('R10 — this suite cannot be quietly disabled', () => {
  it('no *Surface.test.ts contains a static skip', () => {
    const dir = path.join(SRC, '__tests__')
    const files: string[] = []
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name)
        if (e.isDirectory()) walk(p)
        else if (e.name.endsWith('Surface.test.ts')) files.push(p)
      }
    }
    walk(dir)
    expect(files.length).toBeGreaterThan(5)

    const offenders: string[] = []
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8')
      // Built from fragments so this line is not itself a match — the CI gate
      // greps the tree for the literal (link 24's §8).
      const skip = new RegExp(['(?:it|test|describe)', '\\s*\\.\\s*', '(?:skip|todo)\\s*\\('].join(''))
      const xit = /(?:^|[^A-Za-z0-9_])(?:xit|xdescribe)\s*\(/
      if (skip.test(src) || xit.test(src)) offenders.push(path.basename(f))
    }
    expect(offenders).toEqual([])
  })
})
