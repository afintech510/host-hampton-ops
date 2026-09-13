/**
 * The tripwire for the admin surface — 63 route files, 95 handlers.
 *
 * This is the surface Allie and Adam run the business from, it is where the
 * money is RECORDED (as opposed to charged), and no link had audited it as a
 * whole before link 18. `adminActorId` had been patched into it nine separate
 * times by nine separate sessions, which is the signature of a rule nothing is
 * checking.
 *
 * Written in the shape `portalAuthSurface.test.ts`, `signwellSurface.test.ts`,
 * `stripeWebhookSurface.test.ts` and `contactIdentitySurface.test.ts`
 * established: a deny-list of shapes read off disk, a positive convention
 * check, a staleness walker, and every exemption scoped to a NAMED FILE with a
 * written reason.
 *
 * ── Comments are stripped before every rule ──────────────────────────────
 *
 * Link 16 lost two migration rules to a file's own prose, and link 18 tripped
 * the outbound-mail walker with a header comment quoting the very
 * `resend.emails.send(…)` it had replaced. A well-documented file is a hazard
 * to a rule that greps it, so `decomment()` runs first, every time.
 *
 * ── What this cannot see, stated rather than implied ─────────────────────
 *
 *  - It is a lexer, not a type checker. A supabase client rebound to another
 *    name, or a write built through a helper this file does not know about, is
 *    invisible to it. That is what `adminRecordPayment.test.ts` and
 *    `refund.test.ts` are for: they drive the real routes against
 *    `fakeMoneyDb`, which refuses what Postgres refuses.
 *  - R1 proves a handler MENTIONS the gate, not that the gate runs before every
 *    branch. A behaviour test is the only thing that can prove ordering.
 */

import fs from 'fs'
import path from 'path'

const WEBSITE_SRC = path.join(process.cwd(), 'src')
const ADMIN_ROOT = path.join(WEBSITE_SRC, 'app', 'api', 'admin')

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

function walkRoutes(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkRoutes(p))
    else if (e.name === 'route.ts') out.push(p)
  }
  return out.sort()
}

const ROUTE_FILES = walkRoutes(ADMIN_ROOT)
const rel = (abs: string) => path.relative(ADMIN_ROOT, abs).split(path.sep).join('/')

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

type Handler = { file: string; method: string; body: string }

/** Every exported route handler, with its body sliced to the next handler. */
function handlersOf(abs: string): Handler[] {
  const src = decomment(fs.readFileSync(abs, 'utf8'))
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

describe('the admin surface cannot go stale', () => {
  it('R0: every route file yields at least one recognised handler', () => {
    // A file whose handler this walker cannot see is a file every other rule
    // below silently skips — the quietest kind of hole (link 16's R6b, which
    // matched nothing and therefore passed).
    const blind = ROUTE_FILES.filter(f => handlersOf(f).length === 0).map(rel)
    expect(blind).toEqual([])
  })

  it('R0b: the surface is the size we think it is', () => {
    // Not an exact pin — new admin routes are legitimate — but a floor, so this
    // file cannot quietly end up walking an empty directory after a refactor.
    expect(ROUTE_FILES.length).toBeGreaterThanOrEqual(60)
    expect(ALL_HANDLERS.length).toBeGreaterThanOrEqual(90)
  })
})

/* ── R1: authorization ──────────────────────────────────────────────────── */

/**
 * The only admin routes that may be reached without already being an admin, and
 * why. These are the sign-in surface itself.
 */
const UNAUTHENTICATED_BY_DESIGN: { file: string; method: string; why: string }[] = [
  {
    file: 'auth/login/route.ts',
    method: 'POST',
    why: 'The login itself. It verifies a password (scrypt) or the shared ADMIN_PASSWORD as proof of claim, and mints the hh_admin cookie. Requiring a session to sign in would lock everyone out.',
  },
  {
    file: 'auth/logout/route.ts',
    method: 'POST',
    why: 'Clears the cookie. Refusing to sign out an unauthenticated caller achieves nothing and would strand a session whose cookie is already invalid.',
  },
  {
    file: 'auth/session/route.ts',
    method: 'GET',
    why: 'Answers "who am I, if anyone" so the panel can render a signed-out state. It returns the email from an already-valid cookie and nothing else; an unauthenticated caller gets null.',
  },
]

describe('R1: every admin handler is gated', () => {
  it('calls isAdminAuthorized, or is a named exemption with a reason', () => {
    const offenders: string[] = []
    for (const h of ALL_HANDLERS) {
      if (/isAdminAuthorized\s*\(/.test(h.body)) continue
      const exempt = UNAUTHENTICATED_BY_DESIGN.find(e => e.file === h.file && e.method === h.method)
      if (exempt) continue
      offenders.push(`${h.method} ${h.file}`)
    }
    expect(offenders).toEqual([])
  })

  it('every exemption still exists, and carries a reason', () => {
    // An exemption for a handler that no longer exists is a licence sitting
    // around waiting for a future file of the same name.
    for (const e of UNAUTHENTICATED_BY_DESIGN) {
      const found = ALL_HANDLERS.find(h => h.file === e.file && h.method === e.method)
      expect(found).toBeDefined()
      expect(e.why.length).toBeGreaterThan(60)
    }
    expect(UNAUTHENTICATED_BY_DESIGN).toHaveLength(3)
  })

  it('NEGATIVE: the rule can still tell a gated handler from an ungated one', () => {
    // So the matcher cannot quietly become vacuous.
    const gated = { file: 'x', method: 'POST', body: 'export async function POST(req){ if (!isAdminAuthorized(req)) return unauthorizedResponse() }' }
    const ungated = { file: 'x', method: 'POST', body: 'export async function POST(req){ return NextResponse.json({}) }' }
    expect(/isAdminAuthorized\s*\(/.test(gated.body)).toBe(true)
    expect(/isAdminAuthorized\s*\(/.test(ungated.body)).toBe(false)
  })
})

/* ── R2: no second implementation of "is this an admin" ─────────────────── */

describe('R2: one implementation of the admin credential check', () => {
  it('no file outside lib/adminAuth.ts compares ADMIN_PASSWORD itself', () => {
    // Four routes carried a hand-rolled copy:
    //     const token = req.headers.get('authorization')?.replace('Bearer ', '')
    //     if (token !== process.env.ADMIN_PASSWORD) return 401
    // It is missing the guard `isAdminAuthorized` documents in a comment — an
    // UNSET ADMIN_PASSWORD makes `undefined !== undefined` false, so the check
    // PASSES. It also rejects the hh_admin session cookie outright, so Allie
    // signed in as herself could not use the gift-card tab or the pay-link tool
    // at all. Rule 11's sharpest form: the copy was missing the fail-closed
    // half that the original spells out in prose.
    const offenders: string[] = []
    for (const abs of walkAll(WEBSITE_SRC)) {
      const r = path.relative(WEBSITE_SRC, abs).split(path.sep).join('/')
      if (r === 'lib/adminAuth.ts') continue
      if (r.startsWith('__tests__/')) continue
      const src = decomment(fs.readFileSync(abs, 'utf8'))
      if (!/process\.env\.ADMIN_PASSWORD/.test(src)) continue
      // `auth/login` legitimately reads it: the shared password is the PROOF
      // required to claim a per-user account for the first time.
      if (r === 'app/api/admin/auth/login/route.ts') continue
      offenders.push(r)
    }
    expect(offenders).toEqual([])
  })

  it('NEGATIVE: the rule still sees a hand-rolled comparison', () => {
    const src = decomment("if (token !== process.env.ADMIN_PASSWORD) { return NextResponse.json({}, {status:401}) }")
    expect(/process\.env\.ADMIN_PASSWORD/.test(src)).toBe(true)
  })

  it('isAdminAuthorized fails closed when ADMIN_PASSWORD is unset', () => {
    // The property the four copies were missing, pinned against the source so a
    // future edit cannot drop it.
    const src = decomment(fs.readFileSync(path.join(WEBSITE_SRC, 'lib', 'adminAuth.ts'), 'utf8'))
    expect(src).toMatch(/if\s*\(\s*!expected\s*\)\s*return\s+false/)
  })
})

/* ── R3: the ledger actor ───────────────────────────────────────────────── */

const ACTOR_COLUMNS = [
  'recorded_by', 'modified_by', 'reviewed_by', 'approved_by',
  'activated_by', 'updated_by', 'imported_by', 'sent_by',
]

describe('R3: an admin action names the human who took it', () => {
  it('no literal admin actor anywhere in the surface', () => {
    // Nine sessions had to remove one of these before link 18 wrote the rule
    // down. `adminActorId(req)` returns `admin:<email>` from the signed
    // hh_admin cookie, or the historical anonymous 'ADMIN' on the shared
    // password. Migration 047 relaxed the two CHECKs that refused BOTH.
    const offenders: string[] = []
    const re = new RegExp(`\\b(?:${ACTOR_COLUMNS.join('|')})\\s*:\\s*['"](?:ADMIN|admin)['"]`, 'g')
    for (const abs of ROUTE_FILES) {
      const src = decomment(fs.readFileSync(abs, 'utf8'))
      for (const m of src.matchAll(re)) offenders.push(`${rel(abs)}  ${m[0]}`)
      // `actor:` is the ledger/graph spelling, used by advance() and friends.
      for (const m of src.matchAll(/\bactor\s*:\s*['"](?:ADMIN|admin)['"]/g)) {
        offenders.push(`${rel(abs)}  ${m[0]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('NEGATIVE: the rule still sees a literal, and leaves `system` alone', () => {
    const bad = decomment("await supabase.from('x').insert({ recorded_by: 'admin' })")
    const re = new RegExp(`\\b(?:${ACTOR_COLUMNS.join('|')})\\s*:\\s*['"](?:ADMIN|admin)['"]`)
    expect(re.test(bad)).toBe(true)
    // `created_by: 'system'` on a machine-generated content row is correct and
    // must NOT be caught — the actor is genuinely not a person.
    expect(re.test(decomment("insert({ created_by: 'system' })"))).toBe(false)
  })

  it('migration 047 is what permits the actor spellings, and says so', () => {
    // A constraint asserted in code and declared nowhere is rule 13. This reads
    // the migration off disk, the way experimentsSchema.test.ts reads 045.
    const sql = fs
      .readFileSync(
        path.join(process.cwd(), '..', '..', 'starting_plan', 'migration_047_admin_actor_and_memory_link.sql'),
        'utf8',
      )
      // SQL comments stripped — link 16 lost two rules to a migration's own header.
      .replace(/--[^\n\r]*/g, '')
    // EACH constraint checked individually, against its own ADD CONSTRAINT
    // block. The first version of this rule asked whether the file contains
    // `LIKE 'admin:%'` anywhere — and the attack blanked ONE of the two clauses
    // and the rule stayed green, satisfied by the surviving one. That is link
    // 16's "a whole-file match satisfied by a different occurrence than the one
    // mutated", for the fourth time in this chain; a whole-file regex can tell
    // you at least one site is correct, never that every site is.
    for (const constraint of [
      'booking_payments_recorded_by_check',
      'booking_modifications_modified_by_check',
    ]) {
      // The ADD block, not the DROP IF EXISTS line above it — which names the
      // same constraint and ends at its own semicolon, so slicing from the
      // first occurrence gave an empty CHECK body and the rule read it as a
      // missing clause. (Caught by the attack harness refusing to run on a red
      // tree, which is exactly what that refusal is for.)
      const adds = sql
        .split(/ADD CONSTRAINT/)
        .slice(1)
        .filter(chunk => chunk.trimStart().startsWith(constraint))
      expect(adds).toHaveLength(1)
      const block = adds[0].slice(0, adds[0].indexOf(';'))
      expect(block).toContain(constraint)
      expect(block).toMatch(/'ADMIN'/)
      expect(block).toMatch(/LIKE\s+'admin:%'/)
      // And the clause must not have been neutered into a tautology/no-op.
      expect(block).not.toMatch(/OR\s+FALSE/i)
    }
  })
})

/* ── R4: money reaches the books ────────────────────────────────────────── */

describe('R4: every admin money action records to the ledger', () => {
  const MONEY_ROUTES = [
    'parties/[id]/route.ts',
    'orders/[id]/refund/route.ts',
    'events/[id]/tickets/[ticketId]/refund/route.ts',
  ]

  it('the money routes import the ledger writer', () => {
    // The defect this exists for: `recordFinancialTransaction` was PRIVATE to
    // /api/webhook, so the admin panel had no way to record the cash, Venmo and
    // Zelle money Stripe never sees. $2,256 of real customer money, $1,608 of it
    // non-card, is in booking_payments and in no financial_transactions row.
    for (const r of MONEY_ROUTES) {
      const src = decomment(fs.readFileSync(path.join(ADMIN_ROOT, r), 'utf8'))
      expect(src).toMatch(/from\s+['"]@\/lib\/admin(Money|Refund)['"]/)
      expect(src).toMatch(/record(AdminPayment|AdminRefund)|refundTicket/)
    }
  })

  it('the ledger writer lives in exactly one place', () => {
    const writers: string[] = []
    for (const abs of walkAll(WEBSITE_SRC)) {
      const r = path.relative(WEBSITE_SRC, abs).split(path.sep).join('/')
      if (r.startsWith('__tests__/')) continue
      const src = decomment(fs.readFileSync(abs, 'utf8'))
      if (/from\(\s*['"]financial_transactions['"]\s*\)[\s\S]{0,120}?\.insert\(/.test(src)) writers.push(r)
    }
    // Every direct writer, each with a written reason. The rule is not "one
    // writer" — the Financials tab legitimately lets a human type a row and
    // import a CSV — it is "this list does not grow without somebody saying
    // why", so a new surface cannot quietly start writing the books.
    expect(writers.sort()).toEqual([
      // The shared writer. Everything that records a PAYMENT goes through it.
      'lib/financialLedger.ts',
      // Link 2's rule-14 net: a settled Stripe session no branch claimed,
      // recorded under "Unmatched Stripe Payment" so it is visible rather than
      // lost. Keyed on the session id, so a redelivery cannot double it.
      'lib/unclaimedPayment.ts',
      // The plan pay path. Writes its own `stripe-pl-…` reference inside the
      // same transaction as the booking_payments row; the Phase 5 review built
      // and exercised it, and it reads its error.
      'lib/planPayment.ts',
      // The CSV importer (GoDaddy / Squarespace / HoneyBook). Bulk inserts with
      // a per-source de-duplication pass; not a payment path.
      'app/api/admin/financials/import/route.ts',
      // "Add a transaction" in the Financials tab — a human typing a row that
      // never went through any provider. Reads its error and answers 500.
      'app/api/admin/financials/route.ts',
    ].sort())
  })

  it('a duplicate ledger row is decided by SQLSTATE, not message text', () => {
    const src = decomment(fs.readFileSync(path.join(WEBSITE_SRC, 'lib', 'financialLedger.ts'), 'utf8'))
    expect(src).toMatch(/isUniqueViolation\(/)
    expect(src).not.toMatch(/includes\(\s*['"]duplicate['"]\s*\)/)
  })
})

/* ── R5: a refund claims before it spends ───────────────────────────────── */

describe('R5: a refund is taken once', () => {
  it('the claim precedes the Stripe call in lib/adminRefund.ts', () => {
    // Both refund routes did: guard on ticket.status → stripe.refunds.create →
    // UNCHECKED update. The guard depended on a write whose failure was
    // discarded, so a second click issued a SECOND REAL STRIPE REFUND.
    const src = decomment(fs.readFileSync(path.join(WEBSITE_SRC, 'lib', 'adminRefund.ts'), 'utf8'))
    const claimIdx = src.indexOf(".neq('status', 'refunded')")
    const stripeIdx = src.indexOf('refundViaStripe(')
    expect(claimIdx).toBeGreaterThan(-1)
    expect(stripeIdx).toBeGreaterThan(-1)
    // Asserted BY INDEX, not by presence — link 14's attempt-claim rule learned
    // that "both things appear in the file" is not "in this order".
    expect(claimIdx).toBeLessThan(stripeIdx)
  })

  it('the claim is read back, so a zero-row match is a refusal', () => {
    const src = decomment(fs.readFileSync(path.join(WEBSITE_SRC, 'lib', 'adminRefund.ts'), 'utf8'))
    expect(src).toMatch(/claimed\.length === 0/)
  })

  it('no refund route calls stripe.refunds.create directly any more', () => {
    // One implementation (rule 11). Two near-identical copies is what let the
    // event-scoped one drift into restoring inventory for the URL's event
    // rather than the ticket's own.
    const offenders: string[] = []
    for (const abs of ROUTE_FILES) {
      const src = decomment(fs.readFileSync(abs, 'utf8'))
      if (/refunds\s*\.\s*create\(/.test(src)) offenders.push(rel(abs))
    }
    expect(offenders).toEqual([])
  })

  it('a ticket is only refundable through its own event', () => {
    const src = decomment(
      fs.readFileSync(path.join(ADMIN_ROOT, 'events/[id]/tickets/[ticketId]/refund/route.ts'), 'utf8'),
    )
    expect(src).toMatch(/assertTicketBelongsToEvent\(/)
    // And inventory is restored against the ticket's own event_id.
    const lib = decomment(fs.readFileSync(path.join(WEBSITE_SRC, 'lib', 'adminRefund.ts'), 'utf8'))
    expect(lib).toMatch(/eid:\s*ticket\.event_id/)
  })
})

/* ── R6: a portal link is minted or not mailed ──────────────────────────── */

describe('R6: no admin route mints a portal token by hand', () => {
  it('generatePortalToken is reached through lib/portalLinkMint.ts', () => {
    // Seven copies wrote the token row with the error discarded and then mailed
    // the link regardless — a refused row is a DEAD LINK in a real customer's
    // inbox, and nothing said so.
    const offenders: string[] = []
    for (const abs of ROUTE_FILES) {
      const src = decomment(fs.readFileSync(abs, 'utf8'))
      if (/generatePortalToken\s*\(/.test(src)) offenders.push(rel(abs))
    }
    expect(offenders).toEqual([])
  })

  it('mintPortalLink reports a refused token row rather than returning a URL', () => {
    const src = decomment(fs.readFileSync(path.join(WEBSITE_SRC, 'lib', 'portalLinkMint.ts'), 'utf8'))
    expect(src).toMatch(/ok:\s*false/)
    expect(src).toMatch(/if\s*\(\s*error\s*\)/)
  })
})

/* ── R7: consent has one definition ─────────────────────────────────────── */

describe('R7: "may we market to this person" is optedOutReason', () => {
  it('no admin send filters on an opt-in column without consulting it', () => {
    // The admin SMS campaign read `sms_opt_in` alone — the FIFTH reader of this
    // question, and the two that ignored `status` were the outward mirror and
    // the ad export (link 17). `status = 'unsubscribed'` is a statement about
    // the PERSON, not one channel.
    // Scoped to routes that actually SEND. `/api/admin/contacts` filters on
    // `email_opt_in` too, but to render the Contacts list and its count badges
    // — a display filter is not a consent decision, and making this rule catch
    // it would force an exemption on a file that is doing nothing wrong. What
    // matters is the route that puts a message in front of a person.
    const SENDS = /sendBulkSMS|sendCampaign|sendSMSVia|sendTransactionalEmail|resend\.emails\.send/
    const offenders: string[] = []
    for (const abs of ROUTE_FILES) {
      const src = decomment(fs.readFileSync(abs, 'utf8'))
      if (!SENDS.test(src)) continue
      const filtersOptIn = /\.eq\(\s*(?:segmentFilter|['"](?:sms_opt_in|email_opt_in)['"])\s*,\s*true\s*\)/.test(src)
      if (!filtersOptIn) continue
      if (/optedOutReason\s*\(/.test(src)) continue
      offenders.push(rel(abs))
    }
    expect(offenders).toEqual([])
  })

  it('NEGATIVE: the rule still catches a send that filters opt-in without the screen', () => {
    // So narrowing it to senders above cannot quietly become an escape hatch.
    const SENDS = /sendBulkSMS|sendCampaign|sendSMSVia|sendTransactionalEmail|resend\.emails\.send/
    const bad = decomment(
      "const { data } = await supabase.from('contacts').select('phone').eq('sms_opt_in', true)\nawait sendBulkSMS(data)",
    )
    expect(SENDS.test(bad)).toBe(true)
    expect(/\.eq\(\s*['"]sms_opt_in['"]\s*,\s*true\s*\)/.test(bad)).toBe(true)
    expect(/optedOutReason\s*\(/.test(bad)).toBe(false)
  })

  it('optedOutReason still reads BOTH the channel flag and the status', () => {
    const src = decomment(
      fs.readFileSync(path.join(WEBSITE_SRC, 'lib', 'sequences', 'processor.ts'), 'utf8'),
    )
    const fn = src.slice(src.indexOf('export function optedOutReason'))
    const body = fn.slice(0, fn.indexOf('\n}') + 2)
    expect(body).toMatch(/email_opt_in/)
    expect(body).toMatch(/sms_opt_in/)
    expect(body).toMatch(/unsubscribed/)
  })
})

/* ── R8: writes read their result ───────────────────────────────────────── */

describe('R8: a money or customer-state write reads its result', () => {
  /**
   * Scoped deliberately to the writes whose failure changes what a human or a
   * customer is told. A blanket rule over all 36 remaining unchecked writes
   * would have to be suppressed on day one, and a rule that is suppressed is a
   * rule nobody reads.
   */
  const GUARDED = [
    { file: 'parties/[id]/route.ts', needle: "from('booking_payments')" },
    { file: 'parties/[id]/route.ts', needle: "from('booking_line_items')" },
    { file: 'orders/[id]/refund/route.ts', needle: "from('booking_payments')" },
  ]

  it('the guarded writes destructure an error or select their rows', () => {
    const offenders: string[] = []
    for (const g of GUARDED) {
      const src = decomment(fs.readFileSync(path.join(ADMIN_ROOT, g.file), 'utf8'))
      let from = 0
      for (;;) {
        const i = src.indexOf(g.needle, from)
        if (i === -1) break
        from = i + g.needle.length
        const stmt = src.slice(Math.max(0, i - 220), i + 420)
        if (!/\.insert\(|\.update\(|\.delete\(/.test(src.slice(i, i + 420))) continue
        const checked = /(const|let)\s*\{[^}]*\berror\b[^}]*\}\s*=/.test(stmt) || /\.select\(/.test(src.slice(i, i + 420))
        if (!checked) offenders.push(`${g.file} @${g.needle}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('recalcTotals never writes a total it could not read', () => {
    // The sharpest one on this surface: a failed booking_line_items read left
    // `items` null, the loop added nothing, and it WROTE total_cents: 0 over a
    // real customer's invoice — then answered {ok:true}.
    const src = decomment(fs.readFileSync(path.join(ADMIN_ROOT, 'parties/[id]/route.ts'), 'utf8'))
    const fn = src.slice(src.indexOf('async function recalcTotals'))
    const updateIdx = fn.indexOf("from('bookings').update(")
    expect(updateIdx).toBeGreaterThan(-1)

    // EACH read guarded individually, and each guard proved to sit before the
    // update. Asking only "is there a `return { ok: false` before the update"
    // was satisfied by whichever guard survived: the attack deleted the line
    // items one and the PAYMENTS one kept the rule green, over a function that
    // would once again write `total_cents: 0` over a real invoice. Same family
    // as the migration rule above, and the reason both are now per-site.
    for (const errVar of ['itemsErr', 'payErr']) {
      const declIdx = fn.indexOf(`error: ${errVar}`)
      expect(declIdx).toBeGreaterThan(-1)
      const guardIdx = fn.indexOf(`if (${errVar})`, declIdx)
      expect(guardIdx).toBeGreaterThan(-1)
      // The bail-out must be INSIDE THIS guard's own block. Searching forward
      // from the guard found the OTHER guard's `return { ok: false` and passed
      // — the third time in this session that a rule was satisfied by a
      // different occurrence than the one mutated, and the reason the block is
      // now brace-matched rather than scanned.
      expect(guardBody(fn, guardIdx)).toMatch(/return \{ ok: false/)
      expect(fn.indexOf('return { ok: false', guardIdx)).toBeLessThan(updateIdx)
    }
  })

  it('NEGATIVE: the checked/unchecked distinction is still real', () => {
    const unchecked = decomment("await supabase.from('booking_payments').insert({ a: 1 })")
    const checked = decomment("const { error } = await supabase.from('booking_payments').insert({ a: 1 })")
    const re = /(const|let)\s*\{[^}]*\berror\b[^}]*\}\s*=/
    expect(re.test(unchecked)).toBe(false)
    expect(re.test(checked)).toBe(true)
  })
})

/* ── R9: the balance has one definition ─────────────────────────────────── */

describe('R9: one answer to what a booking owes', () => {
  it('no admin route computes a balance from `total_cents || 0`', () => {
    // The pre-link-16 shape. `(null || 0) - paid` clamps to 0, and
    // `newBalance === 0` wrote status paid_in_full — so recording a deposit
    // against an UNQUOTED LEAD marked it paid in full.
    const offenders: string[] = []
    for (const abs of ROUTE_FILES) {
      const src = decomment(fs.readFileSync(abs, 'utf8'))
      if (/total_cents\s*\|\|\s*0/.test(src)) offenders.push(rel(abs))
    }
    expect(offenders).toEqual([])
  })

  it('computeBalance refuses to call an unpriced booking paid in full', () => {
    const src = decomment(fs.readFileSync(path.join(WEBSITE_SRC, 'lib', 'bookingBalance.ts'), 'utf8'))
    const fn = src.slice(src.indexOf('export function computeBalance'))
    expect(fn).toMatch(/total === null \|\| total <= 0/)
    expect(fn).toMatch(/paidInFull:\s*false/)
  })

  it('the webhook and the admin panel share it', () => {
    for (const f of [
      path.join(WEBSITE_SRC, 'app', 'api', 'webhook', 'route.ts'),
      path.join(ADMIN_ROOT, 'parties/[id]/route.ts'),
    ]) {
      expect(decomment(fs.readFileSync(f, 'utf8'))).toMatch(/from\s+['"]@\/lib\/bookingBalance['"]/)
    }
  })
})

/* ── R10: template literals into .or() ──────────────────────────────────── */

describe('R10: no admin route builds a PostgREST filter by interpolation', () => {
  it('nothing passes a template literal to .or()', () => {
    // Absolute, no exemptions — link 17 made it so after an exemption excused a
    // whole file twice. `.or()` takes a RAW filter expression: a comma starts a
    // new disjunct and `%`/`_` are LIKE wildcards inside an ilike value.
    const offenders: string[] = []
    for (const abs of ROUTE_FILES) {
      const src = decomment(fs.readFileSync(abs, 'utf8'))
      for (const m of src.matchAll(/\.or\(\s*`/g)) offenders.push(`${rel(abs)} ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })
})

/**
 * The body of the `{ … }` block that follows `from`, by brace matching.
 *
 * Used so a per-guard rule cannot be satisfied by a sibling guard further down
 * the function — the failure mode that got through the attack twice.
 */
function guardBody(src: string, from: number): string {
  const open = src.indexOf('{', from)
  if (open === -1) return ''
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') {
      depth--
      if (depth === 0) return src.slice(open + 1, i)
    }
  }
  return ''
}

/** Every .ts/.tsx under src, for the whole-tree rules. */
function walkAll(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walkAll(p))
    else if (/\.tsx?$/.test(e.name)) out.push(p)
  }
  return out
}
