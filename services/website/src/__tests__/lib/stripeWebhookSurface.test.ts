/**
 * The Stripe money surface, read off disk.
 *
 * Shape borrowed from `portalAuthSurface.test.ts` and `signwellSurface.test.ts`:
 * a deny-list of shapes, a positive convention check, a staleness walker, and
 * every exemption scoped to a named file with a written reason.
 *
 * Each rule exists because the shape it forbids was live in production on
 * 2026-09-12, on branches that have really run — 77 ticket payments, 11 carts,
 * 10 multi-session bundles, 2 vendor registrations, 1 gift card, and 6 planner
 * payments worth $3,596.50 whose money never reached the Financials tab.
 */

import fs from 'fs'
import path from 'path'

const SRC = path.join(__dirname, '..', '..')
const rel = (p: string) => path.relative(SRC, p).replace(/\\/g, '/')
const read = (r: string) => fs.readFileSync(path.join(SRC, r), 'utf8')

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}

/** Strip comments so a rule cannot be satisfied — or tripped — by prose. */
function code(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const WEBHOOK = 'app/api/webhook/route.ts'
const GUARDS = 'lib/stripeSettlement.ts'
const AFTERMATH = 'lib/stripeAftermath.ts'

/** Every file that creates a Stripe money object or acts on a Stripe event. */
const SURFACE = [
  WEBHOOK,
  GUARDS,
  AFTERMATH,
  'lib/stripeReconcile.ts',
  'app/api/cron/stripe-reconcile/route.ts',
  'lib/unclaimedPayment.ts',
  // Issues real Stripe refunds (`stripe.refunds.create`). It predates link 21
  // and was never on this list — the widened R0 detector found it, which is the
  // staleness walker doing its job on a file that had been moving money out of
  // this business without being under the review that covers money coming in.
  'lib/adminRefund.ts',
  'lib/planPayment.ts',
  'lib/planPayLinks.ts',
  'app/api/cart-checkout/route.ts',
  'app/api/events/checkout/route.ts',
  'app/api/gift-cards/checkout/route.ts',
  'app/api/vendor-registration/route.ts',
  'app/api/christmas-market/vendor/route.ts',
  // Appointment bookings on a `deposit` or `prepay` event. Same shape as the
  // vendor route above and reviewed for the same reason: the row is written
  // BEFORE Stripe, so `paid_at` — not "does a row exist" — is what the webhook
  // treats as already-settled.
  'app/api/appointments/[slug]/book/route.ts',
  'app/api/portal/pay/route.ts',
  'app/api/studio-rental/checkout/route.ts',
  'app/api/admin/pay-link/route.ts',
  'app/api/party-builder/confirm-session/route.ts',
  'app/api/studio-rental/confirm-session/route.ts',
  // The studio damage hold. The only route here that creates a Stripe object it
  // never intends to capture — `capture_method: 'manual'`, authorized and left
  // to expire. It belongs on this list precisely because it is the exception:
  // anything that later treats its PaymentIntent as revenue is a bug, and this
  // is where that gets reviewed. See lib/securityHold.ts.
  'app/api/plan/[ref]/security-hold/route.ts',
]

/* ───────────────────────────────────────────── R0 — the staleness walker ── */

describe('R0 — nothing joins this surface unaudited', () => {
  it('every file that creates a Stripe object or reads a Stripe event is listed', () => {
    const unlisted: string[] = []
    for (const p of walk(SRC).filter(f => !rel(f).startsWith('__tests__/'))) {
      const body = code(fs.readFileSync(p, 'utf8'))
      const touchesStripe =
        /stripe\.(checkout\.sessions|paymentIntents|paymentLinks)\.create\(/.test(body) ||
        /constructEvent\(/.test(body) ||
        /checkout\.session\.(completed|async_payment)/.test(body) ||
        // Link 21. The original three clauses all describe money coming IN, so a
        // file that only refunds, reads a dispute or reconciles against the
        // Stripe API could join this surface unaudited — `stripe-reconcile`'s
        // route did, on the first run of this rule. The refund and dispute
        // branches are money LEAVING and belong under the same review.
        /stripe\.(refunds|disputes|charges|webhookEndpoints)\./.test(body) ||
        /charge\.(refunded|dispute\.)|payment_intent\.payment_failed/.test(body)
      if (touchesStripe && !SURFACE.includes(rel(p))) unlisted.push(rel(p))
    }
    expect(unlisted).toEqual([])
  })
})

/* ─────────────────────────────────── R1 — `completed` does not mean paid ── */

describe('R1 — a settled-only gate, in one place', () => {
  it('the webhook gates every Checkout branch on sessionSettlement', () => {
    const body = code(read(WEBHOOK))
    expect(body).toMatch(/sessionSettlement\(session\)/)
    // The gate must come BEFORE any branch that issues something.
    const gate = body.indexOf('sessionSettlement(session)')
    const firstBranch = body.indexOf(`m.type === 'event_ticket'`)
    expect(gate).toBeGreaterThan(-1)
    expect(firstBranch).toBeGreaterThan(gate)
  })

  it('the late-settlement event runs the same branches, not a different answer', () => {
    // The old handler dumped a non-plan `async_payment_succeeded` into the
    // unclaimed net, so a customer whose Klarna payment settled late paid in
    // full and got no ticket.
    expect(code(read(WEBHOOK))).toMatch(
      /event\.type === 'checkout\.session\.completed' \|\| event\.type === 'checkout\.session\.async_payment_succeeded'/,
    )
  })

  it('a failed delayed payment is reported, not silently 200d', () => {
    const body = code(read(WEBHOOK))
    expect(body).toMatch(/checkout\.session\.async_payment_failed/)
    expect(body).toMatch(/DELAYED STRIPE PAYMENT FAILED/)
  })

  it('the settlement predicate exists in exactly one file', () => {
    const offenders = walk(SRC)
      .filter(f => !rel(f).startsWith('__tests__/') && rel(f) !== GUARDS)
      .filter(f => /payment_status\s*===\s*['"]paid['"]/.test(code(fs.readFileSync(f, 'utf8'))))
      .map(rel)
    // Exemptions, each with its reason:
    //  - the two confirm-session routes ask Stripe directly whether a session or
    //    PaymentIntent succeeded before writing the payment row from the browser.
    //    They issue nothing and send nothing, so they are not a second gate.
    //  - `MyBookingContent.tsx` is a CLIENT component rendering a status string
    //    to the customer. It decides nothing and writes nothing.
    const allowed = [
      'app/api/party-builder/confirm-session/route.ts',
      'app/api/studio-rental/confirm-session/route.ts',
      'app/my-booking/MyBookingContent.tsx',
    ]
    expect(offenders.filter(o => !allowed.includes(o))).toEqual([])
  })
})

/* ──────────────────────────────────────── R2 — references from the clock ── */

describe('R2 — a ticket reference cannot come from the clock', () => {
  it('nothing builds HH-EVT- from Date.now()', () => {
    const offenders: string[] = []
    for (const p of walk(SRC).filter(f => !rel(f).startsWith('__tests__/'))) {
      const body = code(fs.readFileSync(p, 'utf8'))
      // `HH-EVT-${Date.now()...}` in any spelling, on one line or spread over a
      // template. The ref column is UNIQUE and `.slice(-4)` repeats every ten
      // seconds, so the loser of a collision was refused — and emailed anyway.
      if (/HH-EVT-\$\{[^}]*Date\.now\(\)/.test(body)) offenders.push(rel(p))
    }
    expect(offenders).toEqual([])
  })

  it('the allocator is the only caller of the sequence RPC', () => {
    const offenders = walk(SRC)
      .filter(f => !rel(f).startsWith('__tests__/') && rel(f) !== GUARDS)
      .filter(f => /nextval_event_ticket_seq/.test(code(fs.readFileSync(f, 'utf8'))))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('the allocator reads the RPC error instead of falling back silently', () => {
    const body = code(read(GUARDS))
    expect(body).toMatch(/const \{ data, error \} = await supabase\.rpc\('nextval_event_ticket_seq'\)/)
    expect(body).toMatch(/if \(error\) return \{ ok: false/)
    // …and no `?? Date.now()` fallback, which is what hid the missing function
    // for as long as it was missing.
    expect(body).not.toMatch(/\?\?\s*Date\.now\(\)/)
  })
})

/* ──────────────────────────────── R3 — inventory and gift cards, once each ── */

describe('R3 — one implementation of each money concept (rule 11)', () => {
  it('the decrement RPCs are called only through decrementInventory', () => {
    const offenders = walk(SRC)
      .filter(f => !rel(f).startsWith('__tests__/') && rel(f) !== GUARDS)
      .filter(f => /rpc\(\s*['"]decrement_(event|session)_tickets['"]/.test(code(fs.readFileSync(f, 'utf8'))))
      .map(rel)
    // The two free-ticket paths hand out no money and take none; they are listed
    // rather than converted so that a change there is a deliberate edit to this
    // rule, not a silent drift.
    const allowed = ['app/api/cart-checkout/route.ts', 'app/api/events/checkout/route.ts']
    expect(offenders.filter(o => !allowed.includes(o))).toEqual([])
  })

  it('nobody writes a gift-card balance by hand', () => {
    // Read-modify-write on `balance_cents` is how the same card got spent twice,
    // and `redeemed_at: newBal === 0 ? now : null` is how a spent card's
    // timestamp got cleared. Redemption goes through `redeem_gift_card`.
    const offenders: string[] = []
    for (const p of walk(SRC).filter(f => !rel(f).startsWith('__tests__/'))) {
      const body = code(fs.readFileSync(p, 'utf8'))
      if (!/from\(\s*['"]gift_cards['"]\s*\)/.test(body)) continue
      if (/\.update\(\s*\{[^}]*balance_cents/s.test(body)) offenders.push(`${rel(p)} → balance_cents`)
      if (/redeemed_at\s*:\s*[^,}]*\bnull\b/.test(body)) offenders.push(`${rel(p)} → redeemed_at cleared`)
    }
    // The admin gift-card screen may adjust a balance deliberately; nothing else may.
    expect(offenders.filter(o => !o.startsWith('app/api/admin/'))).toEqual([])
  })

  it('an oversell is reported rather than silently absorbed', () => {
    const body = code(read(WEBHOOK))
    expect(body).toMatch(/OVERSOLD/)
    expect(code(read(GUARDS))).toMatch(/outcome: 'oversold'/)
  })
})

/* ─────────────────────────────── R4 — a duplicate is detected by SQLSTATE ── */

describe('R4 — a duplicate is 23505, not the word "duplicate"', () => {
  it('no branch decides idempotency from the error MESSAGE', () => {
    const offenders: string[] = []
    for (const r of SURFACE) {
      const body = code(read(r))
      if (/message[^\n]*\.includes\(\s*['"]duplicate['"]/.test(body)) offenders.push(r)
    }
    // `isUniqueViolation` itself checks the code first and falls back to the
    // message — one fallback, in one place, is the point.
    expect(offenders.filter(o => o !== 'lib/planPayment.ts')).toEqual([])
  })

  it('the webhook uses isUniqueViolation', () => {
    expect(code(read(WEBHOOK))).toMatch(/isUniqueViolation/)
  })
})

/* ────────────────────────── R5 — every write reads its result (rule 19) ── */

describe('R5 — no write discards its SQLSTATE', () => {
  /**
   * Statement-wise, not regex-wise.
   *
   * The first version of this rule was one multi-line regex and it MISSED writes
   * that really were checked — a false positive, which is the failure mode that
   * gets a rule weakened. It now finds each `await supabase` and looks at the
   * window up to the NEXT one, which is the whole statement whatever its shape.
   */
  function uncheckedWrites(body: string): string[] {
    const out: string[] = []
    const starts: number[] = []
    for (const m of body.matchAll(/await supabase\b/g)) starts.push(m.index!)
    for (let i = 0; i < starts.length; i++) {
      const from = starts[i]
      const to = i + 1 < starts.length ? starts[i + 1] : body.length
      const stmt = body.slice(from, to)
      if (!/\.(insert|update|upsert)\s*\(/.test(stmt)) continue
      // Destructured on the same statement (`const { error } = await supabase…`)
      const lineStart = body.lastIndexOf('\n', from) + 1
      const prefix = body.slice(lineStart, from)
      if (/(const|let)\s*\{/.test(prefix)) continue
      if (/\.then\s*\(/.test(stmt)) continue           // inspected inline
      if (/^\s*return\b/.test(prefix)) continue        // handed to the caller
      out.push(stmt.slice(0, 80).replace(/\s+/g, ' '))
    }
    return out
  }

  it.each(SURFACE)('%s has no unchecked insert/update', (file) => {
    expect(uncheckedWrites(code(read(file)))).toEqual([])
  })

  it('the rule can tell a checked write from an unchecked one', () => {
    // The negative case, so a later "fix" cannot quietly make this vacuous.
    expect(uncheckedWrites(`await supabase.from('x').insert({ a: 1 })`)).toHaveLength(1)
    expect(uncheckedWrites(`const { error } = await supabase.from('x').insert({ a: 1 })`)).toHaveLength(0)
    expect(uncheckedWrites(`await supabase.from('x').insert({ a: 1 }).then(({ error }) => { if (error) log(error) })`)).toHaveLength(0)
    expect(uncheckedWrites(`const { data } = await supabase.from('x').select('*')`)).toHaveLength(0)
  })
})

/* ───────────────────────── R6 — one list of the types the handler knows ── */

/** The union of both declared lists, read out of the guards module. */
function declaredTypes(): Set<string> {
  const g = code(read(GUARDS))
  const block = (name: string) => {
    const i = g.indexOf(`export const ${name} = [`)
    if (i === -1) return ''
    return g.slice(i, g.indexOf(']', i))
  }
  return new Set([
    ...[...block('HANDLED_SESSION_TYPES').matchAll(/'([a-z_]+)'/g)].map(m => m[1]),
    ...[...block('HANDLED_PAYMENT_INTENT_TYPES').matchAll(/'([a-z_]+)'/g)].map(m => m[1]),
  ])
}

describe('R6 — the handled-type list is the list the handler branches on', () => {
  it('every `m.type ===` comparison in the webhook is declared', () => {
    const declared = declaredTypes()
    const branched = new Set(
      [...code(read(WEBHOOK)).matchAll(/m\.type === '([a-z_]+)'/g)].map(m => m[1]),
    )
    expect(branched.size).toBeGreaterThan(4)
    const missing = [...branched].filter(t => !declared.has(t))
    expect(missing).toEqual([])
  })

  it('every type the app WRITES into Stripe metadata is handled', () => {
    // The other direction, and the one that matters: a new checkout route with a
    // new `type` must not silently fall into the legacy party-booking tail.
    const declared = declaredTypes()
    const written = new Set<string>()
    for (const r of SURFACE) {
      const body = code(read(r))
      // `[a-z0-9_]`, not `[a-z_]`: the attack script added `cart_checkout_v2`
      // and the narrower class failed to extract it at all, so there was nothing
      // to compare and the rule passed. A rule that silently matches NOTHING is
      // the quietest kind of hole.
      for (const m of body.matchAll(/metadata:\s*\{\s*type:\s*'([a-z0-9_]+)'/g)) written.add(m[1])
    }
    expect(written.size).toBeGreaterThan(3)
    expect([...written].filter(t => !declared.has(t))).toEqual([])
  })

  it('an unhandled type is routed to the net, not to the legacy tail', () => {
    const body = code(read(WEBHOOK))
    expect(body).toMatch(/!isHandledSessionType\(m\.type\) && !isLegacyBookingSession\(m\)/)

    // …and that check comes BEFORE the legacy tail's booking insert, which is
    // the whole point: the legacy tail is what turns an unrecognised payment
    // into a phantom `deposit_paid` kids party with a "You're booked!" email.
    const gate = body.indexOf('!isHandledSessionType(m.type)')
    const legacyInsert = body.indexOf("status: 'deposit_paid'")
    expect(gate).toBeGreaterThan(-1)
    expect(legacyInsert).toBeGreaterThan(gate)
  })
})

/* ────────────────────────────── R7 — metadata is parsed, never trusted ── */

describe('R7 — no bare JSON.parse on Stripe metadata', () => {
  it('the webhook parses metadata defensively', () => {
    const body = code(read(WEBHOOK))
    const bare = [...body.matchAll(/JSON\.parse\(\s*m\./g)].map(m => m[0])
    expect(bare).toEqual([])
    expect(body).toMatch(/parseJsonMetadata</)
  })

  it('the cart respects Stripe’s 500-character metadata ceiling', () => {
    const body = code(read('app/api/cart-checkout/route.ts'))
    // The COMPARISON, not a mention. The first version of this rule only asked
    // whether the file named the constant — and the import line names it, so
    // replacing the ceiling with 99999 sailed through. That is link 15's
    // whole-file-regex hole: a mention satisfied by a different occurrence than
    // the one that matters.
    expect(body).toMatch(/cartJson\.length\s*>\s*STRIPE_METADATA_VALUE_LIMIT/)
    // …and creating the session is inside a try/catch, so a Stripe rejection is
    // not an unhandled 500 on the checkout button.
    expect(body).toMatch(/try\s*\{[\s\S]*checkout\.sessions\.create[\s\S]*\}\s*catch/)
  })
})

/* ──────────────────────────── R8 — a redelivery claim before any issuing ── */

describe('R8 — Stripe redelivers, and the handler knows it', () => {
  it('the webhook claims the session before any issuing branch', () => {
    const body = code(read(WEBHOOK))
    const claim = body.indexOf('claimBySessionId')
    expect(claim).toBeGreaterThan(-1)
    expect(body.indexOf(`m.type === 'event_ticket'`)).toBeGreaterThan(claim)
    expect(body.indexOf(`m.type === 'gift_card'`)).toBeGreaterThan(claim)
  })

  it('an unreadable table is not treated as "fresh"', () => {
    const body = code(read(WEBHOOK))
    expect(body).toMatch(/claim\.outcome === 'unavailable'[\s\S]{0,400}status: 500/)
  })

  it('no guard on this surface has been switched off with a constant', () => {
    // `if (false && claim.outcome === 'unavailable')` leaves every text rule
    // above perfectly satisfied while the branch is dead. The behaviour test in
    // `webhookMoneyBranches` now catches it too, but a shape rule that can be
    // defeated by two characters is worth closing directly.
    const offenders: string[] = []
    for (const f of SURFACE) {
      for (const m of code(read(f)).matchAll(/if\s*\(\s*(?:false\s*&&|true\s*\|\|)/g)) offenders.push(`${f} → ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('the claim has three outcomes, not two', () => {
    // Scoped to the `Claim` union. The first version asked whether the WHOLE
    // FILE contained `'unavailable'` — and `decrementInventory` and
    // `redeemGiftCard` each have one, so renaming the Claim's outcome passed.
    // Link 15's hole, in a rule written after reading about link 15's hole.
    const g = code(read(GUARDS))
    const start = g.indexOf('export type Claim =')
    expect(start).toBeGreaterThan(-1)
    const union = g.slice(start, g.indexOf('\n\n', start))
    for (const o of ["'fresh'", "'already'", "'unavailable'"]) expect(union).toContain(o)
  })
})

/* ────────────────────────────── R9 — the schema agrees with the migration ── */

describe('R9 — migration 046 says what the code assumes', () => {
  const raw = fs.readFileSync(
    path.join(SRC, '..', '..', '..', 'starting_plan', 'migration_046_webhook_money_idempotency.sql'),
    'utf8',
  )
  // Strip `--` comments. This migration's header EXPLAINS what each index and
  // function is for, quoting the very clauses these assertions look for — so
  // without this, deleting `NULLS NOT DISTINCT` from the actual index left the
  // rule green, satisfied by the prose describing it. Two of the six holes the
  // attack found were this.
  const sql = raw.replace(/^\s*--.*$/gm, '')

  it('declares the ticket-line unique index the claim relies on', () => {
    expect(sql).toMatch(/uniq_event_ticket_per_session_line/)
    expect(sql).toMatch(/NULLS NOT DISTINCT/)
    expect(sql).toMatch(/stripe_session_id, event_id, session_id, variant_label/)
  })

  it('declares the bookings session index the vendor and legacy branches rely on', () => {
    expect(sql).toMatch(/uniq_bookings_stripe_session/)
  })

  it('creates every RPC the app calls', () => {
    for (const fn of ['nextval_event_ticket_seq', 'decrement_event_tickets', 'decrement_session_tickets', 'redeem_gift_card']) {
      expect(sql).toContain(fn)
    }
  })

  it('the redemption function preserves redeemed_at and clamps the deduction', () => {
    expect(sql).toMatch(/COALESCE\(redeemed_at, now\(\)\)/)
    expect(sql).toMatch(/LEAST\(GREATEST\(/)
    expect(sql).toMatch(/FOR UPDATE/)
  })

  it('starts the sequence past the legacy four-digit ref space', () => {
    expect(sql).toMatch(/setval\('public\.event_ticket_seq', 10000, false\)/)
  })
})

/* ───────────── R10 — the subscription and the branches are one fact (link 21) ── */

describe('R10 — every event the handler branches on is an event we expect Stripe to send', () => {
  /**
   * THE rule on this surface.
   *
   * The endpoint was created subscribed to `checkout.session.completed` alone
   * while the handler's first branch was `payment_intent.succeeded`, and the two
   * disagreed for six months at a cost of $3,596.50. Nothing compared them and
   * nothing could: the subscription lives at Stripe, the branches live here.
   *
   * `EXPECTED_WEBHOOK_EVENTS` is the git half of that comparison and
   * `/api/cron/stripe-reconcile` checks it against the live endpoint on every
   * run. This rule guards the git half: add a branch without adding the event to
   * the list and the monitor would never ask Stripe for it.
   */
  const branched = () => {
    const body = code(read(WEBHOOK))
    const found = new Set<string>()
    // `[a-z_.]+` deliberately, NOT `[a-z_]+`: R6b was defeated by a metadata
    // type containing a digit, the regex matched nothing, and the comparison
    // ran over an empty set — the quietest kind of hole, because a rule that
    // silently matches nothing does not even look wrong. Hence the floor below.
    const re = /event\.type === '([a-z_.0-9]+)'/g
    let m: RegExpExecArray | null
    while ((m = re.exec(body))) found.add(m[1])
    return [...Array.from(found)].sort()
  }

  it('finds the branches at all — a rule matching nothing must fail, not pass', () => {
    // Eight branches as of link 21. A floor, not an equality, so adding one is
    // not a chore; dropping below it means the extractor stopped working.
    expect(branched().length).toBeGreaterThanOrEqual(8)
  })

  it('every branch is in EXPECTED_WEBHOOK_EVENTS', () => {
    const expected = code(read(AFTERMATH))
    const unlisted = branched().filter(t => !expected.includes(`'${t}'`))
    expect(unlisted).toEqual([])
  })

  it('and every expected event has a branch — the list may not promise what nothing handles', () => {
    const { EXPECTED_WEBHOOK_EVENTS } = jest.requireActual('@/lib/stripeAftermath')
    const handled = new Set(branched())
    const unhandled = (EXPECTED_WEBHOOK_EVENTS as string[]).filter(e => !handled.has(e))
    expect(unhandled).toEqual([])
  })
})

/* ──────────────────────── R11 — money out is negative, and recorded once ── */

describe('R11 — a reversal subtracts, and only one writer owns its reference', () => {
  it('the refund and dispute rows are written NEGATIVE', () => {
    const body = code(read(AFTERMATH))
    // Scoped to the LEDGER WRITES, not to every `amountCents:` in the file.
    // The first draft of this rule matched the type annotations and the
    // `summarizeDispute` object literal — both legitimately positive — and so
    // failed on correct code. A rule that fires on the wrong occurrence is the
    // same family as one satisfied by the wrong occurrence (§7).
    const writes = body.split('recordLedgerEntry(').slice(1)
    expect(writes).toHaveLength(2)
    for (const w of writes) {
      expect(w.slice(0, 400)).toMatch(/amountCents: -/)
    }
  })

  it('the Stripe refund reference has exactly one definition', () => {
    // Two writers produce this row — the admin panel and the webhook — and they
    // must agree or one refund becomes two negative ledger rows. The template
    // literal may appear only in the function that defines it.
    const files = walk(SRC)
      .filter(f => !rel(f).startsWith('__tests__/'))
      .filter(f => /stripe-refund-\$\{/.test(code(fs.readFileSync(f, 'utf8'))))
      .map(rel)
    expect(files).toEqual([AFTERMATH])
  })

  it('the admin refund path passes the Stripe refund id through to the books', () => {
    // Dropping this is silent: the ledger row still appears, under the old
    // `admin-refund-…` reference, and the webhook then writes a second one.
    expect(code(read('lib/adminRefund.ts'))).toMatch(/stripeRefundId/)
    expect(code(read('app/api/admin/orders/[id]/refund/route.ts'))).toMatch(/stripeRefundId/)
    expect(code(read('lib/adminMoney.ts'))).toMatch(/stripeRefundReference\(/)
  })
})
