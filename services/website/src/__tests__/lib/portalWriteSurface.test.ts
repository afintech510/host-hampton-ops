/**
 * The portal WRITE surface, read off disk.
 *
 * `/api/portal/*` is the customer side of this business with its hands on its
 * own booking, its own money and its own consent. Link 14 audited what these
 * routes AUTHENTICATE — and found an `ilike()` authorization filter that handed
 * a `%` session **34 real bookings with the children's names on them** — and said
 * in its own write-up that it had not audited what they WRITE. Link 20 put them
 * inside its walker and deliberately outside its behavioural rules, named in the
 * source, so the gap would be visible rather than quietly skipped. This file is
 * that gap closed. What was live before it existed:
 *
 *   - **`/my-booking`'s "Pay Deposit" button charged the card and recorded $0.**
 *     `/api/portal/pay` copies a body-supplied `paymentType` into
 *     `metadata.payment_type`; the webhook's PaymentIntent branch reads the
 *     credited figure as `paymentType === 'deposit' ? depositCents : amountCents`
 *     and this route set `amountCents` and never `depositCents`. The UI defaults
 *     to `'deposit'` on any `awaiting_deposit` booking (8 of those carry a live
 *     balance), so the DEFAULT path wrote `amount_cents: 0` against a real charge,
 *     left the balance untouched, forced the status back to `pending_review` and
 *     emailed the customer *"Deposit Received — $0.00"*.
 *   - `paymentType` was not validated at all. `"x"` charges the card and then
 *     fails `booking_payments_payment_type_check` → 500 → Stripe retries forever
 *     → money collected and recorded nowhere. `"refund"` is a spelling the CHECK
 *     ACCEPTS and `sumPayments()` SUBTRACTS.
 *   - `status` was in `/api/portal/pay`'s select list and nothing read it. Four
 *     real `cancelled` bookings carry a positive `balance_due_cents`, $47,470
 *     between them.
 *   - `guest_count_approx` was bounded `0…10_000` on the customer's own PATCH.
 *     `loadPlanInvoice()` multiplies per-head line items by it and
 *     `/api/plan/[ref]/pay-link` — which accepts a PORTAL COOKIE — derives the
 *     Stripe charge from that invoice. Link 20 screened `unit_price_cents`
 *     because the browser chose it; the MULTIPLIER still came from the browser.
 *   - `isModificationAllowed(booking.party_date as string, …)` ran
 *     `partyDateStr.split('-')` on a nullable column, so a plan with no date yet
 *     answered **500** from its own portal.
 *   - `/api/portal/send-message` and `/api/portal/notify-payment` each sent Adam
 *     an email AND a billed SMS on a cookie alone, with nothing counting.
 *   - `/api/portal/resend-link` carried a private `Map` throttle that never
 *     evicted a key — an unbounded memory leak keyed by caller-chosen strings,
 *     inside a rate limiter.
 *   - `/api/checkin/[token]` wrote `bookings.contact_email` from its form, and
 *     that column is exactly what `/api/portal/email-auth` authorizes on: a link
 *     in a text message could move a real booking onto an attacker's address.
 *   - `booking_modifications.old_data` was the literal `null` on every customer
 *     edit, so the audit trail recorded that something changed and never what it
 *     changed from.
 *
 * Shape follows `publicIntakeSurface` / `cronSurface` / `adminSurface`: comments
 * are STRIPPED before any rule runs (link 16 lost two rules to a file's own
 * prose — and this file's header names every defect it tests for, so an
 * un-stripped scan would match its own paragraphs), handler bodies are sliced to
 * the NEXT handler rather than by a fixed width (link 20's 400-byte window spilled
 * into the next email and hid the wrong index), and every anchor tolerates CRLF
 * because this repository is `core.autocrlf=true` and a fresh worktree gets CRLF
 * while the main checkout may hold LF — which is exactly how link 19's
 * `summer-hair-reminders` rule silently stopped checking anything.
 *
 * Note there is no `.skip` rule here: `publicIntakeSurface`'s R10 walks every
 * `*Surface.test.ts` in the directory and fails on `.skip` / `xit` / `.todo`, and
 * this file matches that glob. Rule 11 — one definition, and it already has one.
 */

import fs from 'fs'
import path from 'path'

const API_ROOT = path.join(process.cwd(), 'src', 'app', 'api')
const SRC_ROOT = path.join(process.cwd(), 'src')

/** Blank out comments while preserving offsets and line structure. */
function decomment(s: string): string {
  // ONE left-to-right pass. Two passes with block comments FIRST corrupts any
  // file whose LINE comment contains an open-block marker: three files under
  // src/ do (the two /api/slack routes and agent-dispatch, all saying
  // "lib/slack/*"), and there the block match ran on to the next close marker
  // and blanked real code — including import statements a module-graph rule
  // then could not see. Leftmost-match makes the line-comment branch win.
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}

function walk(dir: string, match: (name: string) => boolean): string[] {
  const out: string[] = []
  if (!fs.existsSync(dir)) return out
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p, match))
    else if (match(e.name)) out.push(p)
  }
  return out.sort()
}

const rel = (abs: string) => path.relative(API_ROOT, abs).split(path.sep).join('/')

/**
 * The surface: the customer's own portal, plus the two token-gated check-in
 * routes, which write the SAME booking rows for the same audience through a
 * different credential. Excluding them would have missed the `contact_email`
 * move entirely.
 *
 * Walked, not listed. The brief for this session named eleven portal routes; the
 * directory is the answer, and it has been wrong in both directions for the last
 * three links running.
 */
const SURFACE_DIRS = ['portal', 'checkin']
const SURFACE_FILES = walk(API_ROOT, n => n === 'route.ts')
  .map(rel)
  .filter(f => SURFACE_DIRS.some(d => f === `${d}/route.ts` || f.startsWith(`${d}/`)))

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

interface Handler {
  route: string
  method: string
  /** Comment-stripped source from this handler's export to the next, or EOF. */
  body: string
  /** Comment-stripped source of the whole file. */
  file: string
}

function handlersOf(routeFile: string): Handler[] {
  const src = decomment(fs.readFileSync(path.join(API_ROOT, routeFile), 'utf8'))
  const route = routeFile.replace(/\/route\.ts$/, '')
  const marks: { method: string; idx: number }[] = []
  for (const m of HTTP_METHODS) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${m}\\s*\\(|export\\s+const\\s+${m}\\s*[:=]`, 'g')
    let mt: RegExpExecArray | null
    while ((mt = re.exec(src))) marks.push({ method: m, idx: mt.index })
  }
  marks.sort((a, b) => a.idx - b.idx)
  return marks.map((mk, i) => ({
    route,
    method: mk.method,
    body: src.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : src.length),
    file: src,
  }))
}

const HANDLERS: Handler[] = SURFACE_FILES.flatMap(handlersOf)
const id = (h: Handler) => `${h.method} ${h.route}`
const find = (entry: string): Handler => {
  const h = HANDLERS.find(x => id(x) === entry)
  if (!h) throw new Error(`no handler ${entry} — the surface moved and this rule is now checking nothing`)
  return h
}

const readSrc = (p: string) => decomment(fs.readFileSync(path.join(SRC_ROOT, p), 'utf8'))

/* ── R0: the walker, and what each handler REFUSES ────────────────────────── */

/**
 * How this handler decides whether the caller may proceed.
 *
 * A GATE REFUSES. Reading a session is not a gate — link 20's classifier missed
 * `getPortalBookingRef` entirely in one direction while calling
 * `/api/party-builder/save` "gated" in the other, and the second error is the one
 * that talks an audit out of looking at the route that needed it most.
 */
type Gate = 'portal-cookie' | 'email-cookie' | 'checkin-token' | 'open'

function gateOf(h: Handler): Gate {
  const refuses401 = (fn: string) =>
    new RegExp(
      `const\\s+\\w+\\s*=\\s*${fn}\\s*\\([\\s\\S]{0,200}?if\\s*\\(\\s*!\\s*\\w+\\s*\\)\\s*(?:\\{[\\s\\S]{0,120}?)?return[\\s\\S]{0,160}?401`,
    ).test(h.body)
  if (refuses401('getPortalBookingRef')) return 'portal-cookie'
  if (refuses401('getEmailFromCookie')) return 'email-cookie'
  // The token IS the credential: resolve it, and return 404/410 when it fails.
  if (/resolveCheckinToken\s*\([\s\S]{0,300}?if\s*\(\s*!\s*\w+\.ok\s*\)[\s\S]{0,200}?(?:404|410)/.test(h.body)) {
    return 'checkin-token'
  }
  return 'open'
}

/**
 * Every handler on this surface reachable with no credential at all, as of
 * 2026-09-13, with the reason. A new one fails until somebody adds it here.
 */
const DELIBERATELY_OPEN: Record<string, string> = {
  // Handing out a session is what it does; the URL token is the credential and
  // it is checked against `portal_tokens` before anything is written.
  'GET portal/auth': 'the front door — audited by link 14',
  // Clears a cookie. Reads and writes nothing.
  'POST portal/clear': 'clears the caller\'s own cookie; touches no row',
  // Anti-enumeration by design: always `{ok:true}`.
  'POST portal/email-auth/request': 'login — always answers ok, never says who exists',
  'POST portal/email-auth/verify': 'login — the code is the credential',
  'POST portal/resend-link': 'login — always answers ok',
  // Clearing cookies needs no session to clear.
  'DELETE portal/my-bookings': 'sign-out; touches no row',
}

describe('R0: every handler on this surface is seen and classified', () => {
  it('walks the directory rather than a remembered list of it', () => {
    // The brief named eleven portal routes plus two check-in ones. Count what is
    // on disk: if a route is added and this number does not move, the rules below
    // are silently skipping it.
    expect(SURFACE_FILES.length).toBeGreaterThanOrEqual(13)
    expect(HANDLERS.length).toBeGreaterThanOrEqual(17)
  })

  it('every route file yields at least one recognised handler', () => {
    // link 16's R6b matched nothing and therefore passed. A file the walker
    // cannot parse is a file every rule below skips without saying so.
    expect(SURFACE_FILES.filter(f => handlersOf(f).length === 0)).toEqual([])
  })

  it('every handler either refuses an anonymous caller or is listed as open', () => {
    const unaccounted = HANDLERS.filter(h => gateOf(h) === 'open' && !(id(h) in DELIBERATELY_OPEN))
    expect(unaccounted.map(id)).toEqual([])
  })

  it('nothing on the open list has quietly grown a gate', () => {
    // The negative direction. A stale entry means every rule below is reasoning
    // about a route nobody can reach — a rule passing for the wrong reason.
    const stale = Object.keys(DELIBERATELY_OPEN).filter(e => {
      const h = HANDLERS.find(x => id(x) === e)
      return h && gateOf(h) !== 'open'
    })
    expect(stale).toEqual([])
  })

  it('the open list names no handler that has disappeared', () => {
    expect(Object.keys(DELIBERATELY_OPEN).filter(e => !HANDLERS.some(h => id(h) === e))).toEqual([])
  })

  it('the handlers that move money or interrupt Adam are all cookie-gated', () => {
    for (const entry of [
      'POST portal/pay',
      'POST portal/notify-payment',
      'POST portal/send-message',
      'PATCH portal/booking',
    ]) {
      expect(gateOf(find(entry))).toBe('portal-cookie')
    }
    for (const entry of ['GET portal/my-bookings', 'POST portal/my-bookings']) {
      expect(gateOf(find(entry))).toBe('email-cookie')
    }
  })
})

/* ── R1: the payment type is the constraint's vocabulary, once ────────────── */

describe('R1: a customer may not name a payment type Postgres will refuse', () => {
  it('portal/pay screens it, and rejects an unknown value rather than passing it on', () => {
    const body = find('POST portal/pay').body
    expect(body).toMatch(/screenPortalPaymentType\s*\(/)
    // Ordering, not presence: a screen whose result is computed and then ignored
    // is the family link 16 named. The rejection must come before Stripe is
    // touched at all.
    const screenAt = body.search(/screenPortalPaymentType\s*\(/)
    const stripeAt = body.search(/paymentIntents\.create\s*\(/)
    expect(screenAt).toBeGreaterThan(-1)
    expect(stripeAt).toBeGreaterThan(screenAt)
    // And the refusal is a refusal.
    expect(body.slice(screenAt, stripeAt)).toMatch(/===\s*null[\s\S]{0,200}?status:\s*400/)
  })

  it('the vocabulary is defined once, and matches the CHECK it exists for', () => {
    const lib = readSrc(path.join('lib', 'portalWrite.ts'))
    // Read from pg_constraint 2026-09-13:
    //   CHECK (payment_type = ANY (ARRAY['deposit','partial','final','refund']))
    for (const v of ['deposit', 'partial', 'final', 'refund']) {
      expect(lib).toMatch(new RegExp(`BOOKING_PAYMENT_TYPES[\\s\\S]{0,200}?'${v}'`))
    }
  })

  it('a customer cannot name `refund`, which the CHECK accepts and sumPayments SUBTRACTS', () => {
    const lib = readSrc(path.join('lib', 'portalWrite.ts'))
    const at = lib.search(/export const PORTAL_PAYMENT_TYPES/)
    expect(at).toBeGreaterThan(-1)
    const decl = lib.slice(at, lib.indexOf('\n', lib.indexOf('as const', at)))
    expect(decl).toMatch(/'deposit'/)
    expect(decl).toMatch(/'final'/)
    expect(decl).not.toMatch(/refund/)
  })

  it('no portal route spells the payment-type list out for itself', () => {
    // Rule 11. A second copy is a copy nothing is checking, and this one decides
    // whether a real charge gets a ledger row at all.
    const offenders = HANDLERS.filter(h =>
      /\[\s*'deposit'\s*,\s*'partial'/.test(h.body) || /'partial'\s*,\s*'final'/.test(h.body),
    )
    expect(offenders.map(id)).toEqual([])
  })
})

/* ── R2: one figure, and every reader of it agrees ────────────────────────── */

describe('R2: the credited amount cannot come out as zero', () => {
  const READERS = [
    'app/api/webhook/route.ts',
    'app/api/party-builder/confirm-session/route.ts',
  ]

  it('portal/pay names the amount under BOTH metadata keys its readers use', () => {
    const body = find('POST portal/pay').body
    const meta = body.slice(body.search(/metadata:\s*\{/))
    expect(meta).toMatch(/amountCents:\s*String\(/)
    // The key whose absence made the deposit branch credit nothing.
    expect(meta).toMatch(/depositCents:\s*String\(/)
    // …and they must be the SAME figure. Two keys naming two numbers is the
    // original bug with an extra step.
    const amount = /amountCents:\s*String\((\w+)\)/.exec(meta)?.[1]
    const deposit = /depositCents:\s*String\((\w+)\)/.exec(meta)?.[1]
    expect(amount).toBeTruthy()
    expect(deposit).toBe(amount)
  })

  it('every reader falls back to the other key rather than crediting zero', () => {
    for (const f of READERS) {
      const src = readSrc(f)
      const at = src.search(/paymentType\s*===\s*'deposit'\s*\r?\n?\s*\?/)
      expect(at).toBeGreaterThan(-1)
      // Slice to the end of the statement, not a fixed width — link 20's
      // 400-byte window spilled into the next block and matched the wrong thing.
      const stmt = src.slice(at, src.indexOf('\n\n', at) === -1 ? at + 600 : src.indexOf('\n\n', at))
      expect(stmt).toMatch(/depositCents/)
      expect(stmt).toMatch(/m\.amountCents/)
      // Both arms mention both keys: that is what "falls back" means here.
      const arms = stmt.split('?')[1] ?? ''
      expect(arms.split(':').filter(a => /depositCents|amountCents/.test(a)).length).toBeGreaterThanOrEqual(2)
    }
  })

  it('a payment that names NO amount is refused, not written as $0', () => {
    // The unique `stripe_payment_intent_id` means a $0 row PERMANENTLY swallows
    // the corrected redelivery. Rule 14: an invisible record is a loss.
    for (const f of READERS) {
      const src = readSrc(f)
      expect(src).toMatch(/namedAmount\s*>\s*0/)
      const at = src.search(/!\s*\(\s*namedAmount\s*>\s*0\s*\)/)
      expect(at).toBeGreaterThan(-1)
      // It must REFUSE — and say so — before the insert.
      const insertAt = src.indexOf("from('booking_payments')", at)
      expect(insertAt).toBeGreaterThan(at)
      expect(src.slice(at, insertAt)).toMatch(/console\.error/)
      expect(src.slice(at, insertAt)).toMatch(/status:\s*500/)
    }
  })

  it('no branch of the webhook derives a balance from `total_cents || 0`', () => {
    /**
     * `(null || 0) - anything` clamps to zero, which every one of these branches
     * then reads as `paid_in_full`. `computeBalance` is the one definition and it
     * can tell an unpriced lead from a settled booking.
     *
     * This rule was written as "neither party_builder branch" and scanned the
     * whole file anyway — and found a THIRD copy, in the studio-rental
     * PaymentIntent branch, that I was not looking for. Kept deliberately
     * file-wide: the narrower rule I meant to write would have passed.
     *
     * It counts the surviving `computeBalance` calls as well as banning the old
     * shape, because a rule that only forbids a spelling is satisfied by deleting
     * the code rather than fixing it (link 20's sixth hole: count what the rule
     * actually examined).
     */
    const src = readSrc('app/api/webhook/route.ts')
    expect(src.match(/total_cents\s*\|\|\s*0\s*\)\s*-\s*paidSum/g) ?? []).toEqual([])
    expect((src.match(/computeBalance\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

/* ── R3: a party that is not happening does not take money ────────────────── */

describe('R3: cancelled bookings are refused on every money path', () => {
  const MONEY_PATHS = ['POST portal/pay', 'POST portal/notify-payment']

  it('each one reads `status` and consults the one definition of payable', () => {
    for (const entry of MONEY_PATHS) {
      const h = find(entry)
      // It must SELECT the column — link 20's finding was a guard reading a
      // field the query never fetched, which is `undefined` and therefore falsy.
      expect(h.body).toMatch(/\.select\([^)]*\bstatus\b/)
      expect(h.body).toMatch(/isPayableStatus\s*\(/)
    }
  })

  it('the refusal comes before Stripe and before the notification', () => {
    const pay = find('POST portal/pay').body
    expect(pay.search(/isPayableStatus\s*\(/)).toBeLessThan(pay.search(/paymentIntents\.create\s*\(/))
    const notify = find('POST portal/notify-payment').body
    expect(notify.search(/isPayableStatus\s*\(/)).toBeLessThan(notify.search(/emails\.send\s*\(/))
  })

  it('the customer edit refuses a cancelled booking too, and the GET agrees', () => {
    // Rule 10: if the PATCH will refuse it, the GET must not offer an editor.
    // The date cutoff does not catch this — a booking cancelled six months out
    // is inside every modification window.
    const patch = find('PATCH portal/booking').body
    expect(patch).toMatch(/isEditableStatus\s*\(/)
    const get = find('GET portal/booking').body
    expect(get).toMatch(/isEditableStatus\s*\(/)
    expect(get).toMatch(/canEditFull:\s*editable\s*&&/)
    expect(get).toMatch(/canEditGuestCount:\s*editable\s*&&/)
  })
})

/* ── R4: the guest count is a money input ─────────────────────────────────── */

describe('R4: the per-head multiplier goes through the one screen', () => {
  it('the customer PATCH uses screenPublicGuestCount and no private bound', () => {
    const body = find('PATCH portal/booking').body
    /**
     * Anchor on the `if (…)` that OPENS THE ASSIGNMENT BLOCK, not on the first
     * mention of the field.
     *
     * The first version of this rule searched for `body.guest_count_approx !==
     * undefined` and found the CUTOFF check forty lines earlier — the same
     * expression, a different occurrence, in a block that has nothing to do with
     * the screen. It failed here for the right reason and would have passed for
     * the wrong one the moment the cutoff check moved. Every hole link 20's
     * attack harness found was this family: the rule matched, but not the
     * occurrence that broke.
     */
    const at = body.search(/if\s*\(\s*body\.guest_count_approx\s*!==\s*undefined\s*\)/)
    expect(at).toBeGreaterThan(-1)
    // Slice to the closing brace of that `if`, not a fixed width.
    const block = body.slice(at, body.indexOf('\n  }', at))
    expect(block).toMatch(/allowed\.guest_count_approx\s*=/)
    expect(block).toMatch(/screenPublicGuestCount\s*\(/)
    // The old bound, and anything like it, is gone: a private numeric range on
    // this field is a second definition of what a party size is.
    expect(block).not.toMatch(/10_?000/)
    expect(block).not.toMatch(/asInt\s*\(\s*body\.guest_count_approx/)
  })

  it('the screen refuses zero — which removes every per-head charge', () => {
    const lib = readSrc(path.join('lib', 'publicIntake.ts'))
    const at = lib.search(/export function screenPublicGuestCount/)
    expect(at).toBeGreaterThan(-1)
    const fn = lib.slice(at, lib.indexOf('\n}', at))
    expect(fn).toMatch(/n\s*<\s*1/)
    expect(fn).toMatch(/MAX_PUBLIC_GUEST_COUNT/)
  })

  it('the edit is recorded with the OLD value, not a literal null', () => {
    // `old_data: null` made `booking_modifications` a log that something changed
    // and never what it changed from — the half a human needs when a customer
    // rings up about their headcount.
    const body = find('PATCH portal/booking').body
    expect(body).not.toMatch(/old_data:\s*null/)
    expect(body).toMatch(/old_data:\s*oldData/)
    // And the guest-count move is NAMED in the summary a human reads, because it
    // is the field that moves what the plan costs.
    expect(body).toMatch(/guest count \$\{[\s\S]{0,80}?\}\s*→/)
  })
})

/* ── R5: a nullable column is not a string ────────────────────────────────── */

describe('R5: party_date is nullable and this surface knows it', () => {
  it('no handler casts it into isModificationAllowed', () => {
    // `isModificationAllowed(partyDate as string, …)` ran `partyDateStr.split`
    // on `null` and answered 500 from the customer's own portal. A type CAST
    // defeats a tight anchor (link 20), so this bans the cast as well as the
    // call.
    const offenders = HANDLERS.filter(h =>
      /isModificationAllowed\s*\([^)]*\bas\s+string\b/.test(h.body) ||
      /isModificationAllowed\s*\(\s*booking\.party_date/.test(h.body),
    )
    expect(offenders.map(id)).toEqual([])
  })

  it('the wrapper exists, guards the shape, and is what the route calls', () => {
    const src = readSrc(path.join('app', 'api', 'portal', 'booking', 'route.ts'))
    expect(src).toMatch(/function modificationPermission\s*\(/)
    expect(src).toMatch(/partyDateIsSet\s*\(/)
    // Both handlers go through it — a guard on one of two paths is a guard on
    // nothing (link 20's rule, one surface over).
    expect(find('GET portal/booking').body).toMatch(/modificationPermission\s*\(/)
    expect(find('PATCH portal/booking').body).toMatch(/modificationPermission\s*\(/)
  })
})

/* ── R6: the address on the booking is an authorization key ───────────────── */

describe('R6: a token-gated route cannot move contact_email', () => {
  it('the check-in save only ever SETS an absent address, never changes one', () => {
    const body = find('POST checkin/[token]').body
    // The unconditional write is gone…
    expect(body).not.toMatch(/updates\s*=\s*\{[\s\S]{0,400}?contact_email:\s*email/)
    // …and the only assignment is guarded on there being nothing there already.
    expect(body).toMatch(/if\s*\(\s*!existingEmail\s*\)\s*updates\.contact_email\s*=\s*email/)
  })

  it('a refused change is recorded where a human reads it (rule 10)', () => {
    const body = find('POST checkin/[token]').body
    expect(body).toMatch(/emailChangeRequested/)
    const at = body.search(/if\s*\(\s*emailChangeRequested\s*\)/)
    expect(at).toBeGreaterThan(-1)
    const block = body.slice(at, body.indexOf('\n  }', at))
    expect(block).toMatch(/console\.warn/)
    expect(block).toMatch(/from\('booking_modifications'\)/)
    // …and the write's own error is read (rule 19).
    expect(block).toMatch(/error:\s*\w+\s*\}\s*=\s*await/)
  })

  it('consent is recorded against the address we hold, not the one submitted', () => {
    // Otherwise a rejected change becomes a brand-new `contacts` row claiming a
    // marketing opt-in that person never gave — a false statement about a real
    // human, which is the one thing this chain deletes rather than cancels.
    const body = find('POST checkin/[token]').body
    const at = body.search(/recordCheckinConsent\s*\(/)
    expect(at).toBeGreaterThan(-1)
    expect(body.slice(at, body.indexOf('\n  })', at))).toMatch(/existingEmail\s*\?/)
  })

  it('no portal or check-in handler writes contact_email from its request body', () => {
    const offenders = HANDLERS.filter(h => {
      const at = h.body.search(/contact_email:\s*(?!'|")/)
      if (at < 0) return false
      const assigned = /contact_email:\s*([\w.]+)/.exec(h.body.slice(at))?.[1] ?? ''
      // `existingEmail`-derived values are fine; a bare `email` from the form is not.
      return assigned === 'email' || assigned.startsWith('body.')
    })
    expect(offenders.map(id)).toEqual([])
  })
})

/* ── R7: one limiter, and both of its axes ────────────────────────────────── */

describe('R7: nothing on this surface re-implements a throttle', () => {
  it('no route file keeps its own bucket map', () => {
    // `resend-link` held a private `Map<string, number[]>` with its own window
    // constants and no eviction: an unbounded memory leak keyed by
    // caller-chosen strings, inside a rate limiter.
    const offenders = SURFACE_FILES.filter(f => {
      const src = decomment(fs.readFileSync(path.join(API_ROOT, f), 'utf8'))
      return /new Map\s*<[^>]*number\s*\[\s*\]\s*>|new Map\s*\(\s*\)\s*[\s\S]{0,80}?Date\.now\(\)/.test(src)
    })
    expect(offenders).toEqual([])
  })

  it('the recipient bucket lives in lib/rateLimit.ts and shares its store', () => {
    const lib = readSrc(path.join('lib', 'rateLimit.ts'))
    expect(lib).toMatch(/export function guardRecipient/)
    const at = lib.search(/export function guardRecipient/)
    const fn = lib.slice(at, lib.indexOf('\n}', at))
    // It must use the swept, capped store — not a map of its own.
    expect(fn).toMatch(/store\s*\(\s*\)/)
    expect(fn).toMatch(/sweep\s*\(/)
    // Rule 10: a refusal says it refused…
    expect(fn).toMatch(/console\.warn/)
    /**
     * …without naming the recipient, who is a real person's address or phone.
     *
     * Scoped to the LOG CALL. The first version scanned the whole function and
     * matched `${identifier}` in the bucket KEY, which is exactly where it has to
     * appear — a rule that forbids a substring rather than a use is satisfied by
     * the wrong occurrence, and this one was failing over the only correct line
     * in the function.
     */
    const warnAt = fn.search(/console\.warn\s*\(/)
    const warnCall = fn.slice(warnAt, fn.indexOf(')', fn.indexOf('`', warnAt) + 1) + 1)
    expect(warnCall).toMatch(/opts\.label/)
    expect(warnCall).not.toMatch(/\$\{identifier\}/)
  })

  it('resend-link bounds the RECIPIENT and the CALLER, which are different questions', () => {
    const body = find('POST portal/resend-link').body
    expect(body).toMatch(/guardRate\s*\(/)
    expect(find('POST portal/resend-link').file).toMatch(/guardRecipient\s*\(/)
  })

  it('the two owner-notification routes are bounded by the costed rule', () => {
    // Each sends an email AND a billed SMS to Adam on every call.
    for (const entry of ['POST portal/send-message', 'POST portal/notify-payment']) {
      expect(find(entry).body).toMatch(/guardRate\s*\(\s*req,\s*ownerNotifyRule\s*\(/)
    }
  })
})

/* ── R8: a pledge is a claim about money ──────────────────────────────────── */

describe('R8: the self-reported payment amount is bounded', () => {
  it('notify-payment screens it rather than casting it', () => {
    const body = find('POST portal/notify-payment').body
    expect(body).toMatch(/screenPledgeCents\s*\(/)
    // The cast that was the whole check.
    expect(body).not.toMatch(/body\.amount_cents\s+as\s+number/)
  })

  it('the screen demands a whole number of cents inside a ceiling', () => {
    const lib = readSrc(path.join('lib', 'portalWrite.ts'))
    const at = lib.search(/export function screenPledgeCents/)
    expect(at).toBeGreaterThan(-1)
    const fn = lib.slice(at, lib.indexOf('\n}', at))
    expect(fn).toMatch(/Number\.isInteger/)
    expect(fn).toMatch(/n\s*<=\s*0/)
    expect(fn).toMatch(/MAX_PLEDGE_CENTS/)
  })
})

/* ── R9: the screens have exactly one home ────────────────────────────────── */

describe('R9: no second copy of anything in lib/portalWrite.ts', () => {
  const EXPORTS = [
    'screenPortalPaymentType',
    'isPayableStatus',
    'isEditableStatus',
    'partyDateIsSet',
    'screenPledgeCents',
  ]

  it('each screen is declared once in src, outside the tests', () => {
    const files = walk(SRC_ROOT, n => /\.tsx?$/.test(n)).filter(f => !f.includes('__tests__'))
    for (const name of EXPORTS) {
      const decl = new RegExp(`(?:export\\s+)?(?:function|const)\\s+${name}\\b`)
      const owners = files.filter(f => decl.test(decomment(fs.readFileSync(f, 'utf8'))))
      expect(owners.map(f => path.relative(SRC_ROOT, f).split(path.sep).join('/')))
        .toEqual([path.join('lib', 'portalWrite.ts').split(path.sep).join('/')])
    }
  })

  it('every export is actually used by a route, so none of this is dead', () => {
    // A screen nothing imports is a screen nothing is applying. Counting what the
    // rule examined is link 20's sixth hole: one rule skipped the only mutated
    // handler and passed by not looking.
    const allBodies = HANDLERS.map(h => h.file).join('\n')
    const unused = EXPORTS.filter(n => !new RegExp(`\\b${n}\\b`).test(allBodies))
    expect(unused).toEqual([])
  })
})
