/**
 * THE PLAN MONEY PATH, read off disk (link 23).
 *
 * "What does this party cost, and what has been paid" is the one question this
 * business cannot afford to answer twice, and before this file it was answered
 * in at least nine places that did not agree. What was live when it was written,
 * every item measured in production first:
 *
 *   - **`/plan/[ref]/summary` printed a "Balance Due" that no payment ever
 *     moved.** `loadPlanInvoice().balanceDueCents` was `total - the NOTIONAL
 *     deposit`, fixed at quote time. Across the 35 live priced bookings it
 *     disagreed with what was actually outstanding on **27**, overstating by
 *     $3,569.50 on five and understating by $4,071.00 on twenty-two. Two real
 *     customers who had paid IN FULL were shown **"Balance Due: $1,475.00"** and
 *     **"$1,560.00"**. The same figure goes out in the emailed and texted
 *     summary (`lib/planShare.ts`), so it is a sentence a customer repeats —
 *     hard-won rule 10. And the `?paid=1` banner said *"the balance below
 *     updates once Stripe confirms it"* over a number that structurally could
 *     not: rule 8, a comment that is the exact opposite of its code.
 *   - **A live $257.50 charge on a plan that owed nothing.** `quoteFor('deposit')`
 *     was bounded only by "has a `payment_type = 'deposit'` row been recorded",
 *     and only 2 of the 18 real payments in production carry that type — every
 *     hand-entered one is `partial`. Proven on a throwaway paid $600.00 of
 *     $600.00: the page rendered "Pay $250.00 deposit" and
 *     `POST /api/plan/<ref>/pay-link {"purpose":"deposit"}` answered **200 with
 *     a real, chargeable Stripe Payment Link** (deactivated immediately).
 *   - **`bookings.balance_due_cents` holds two different concepts**: `total -
 *     deposit_amount` on a plan nobody has paid, `total - paid` on one somebody
 *     has. It disagrees with the invoice on 21 of 62 rows, ALWAYS undercharging,
 *     $3,168.00 across 13 real bookings. On both live studio rentals it is
 *     exactly $250 lower, and `/api/portal/pay` clamps its charge to it —
 *     measured: asked for the full $475.00 studio invoice, it answered
 *     **"Send $225 via Venmo"**. Which of the two is right is needs-Adam 41 and
 *     is NOT a technical decision; see `STUDIO_DEPOSIT_IS_SEPARATE`.
 *   - **`is_optional` was honoured by one of five totals.** An optional line item
 *     is quoted and not charged. `loadPlanInvoice` excluded it; `recalcTotals`
 *     did not even SELECT the column, and `calculateLineItemTotal` — behind
 *     `buildPlanSnapshot`, the studio checkout, the studio edit route and the
 *     kids-menu summary — looped every row.
 *   - **`/api/plan/[ref]/pay-link` had no rate limit at all**, while its
 *     neighbour `/api/plan/[ref]/email-me` does (13 real 429s in the current
 *     nginx window). Each accepted call mints three to five Stripe objects.
 *   - The route and the page each read `booking_payments` SEPARATELY from the
 *     invoice they priced against, so the button and the document were two
 *     reads that could disagree.
 *
 * Shape follows `agentSurface` / `portalWriteSurface` / `publicIntakeSurface`:
 * comments are STRIPPED before any rule runs (link 16 lost two rules to a file's
 * own prose, and this header names every defect it tests for); bodies are sliced
 * to the NEXT declaration rather than by a fixed width (link 20's 400-byte
 * window spilled into the next branch, and link 22's 200-byte "fix" for that
 * reproduced the same bug); every anchor tolerates CRLF because this repo is
 * `core.autocrlf=true`; and **every rule asserts how many sites it examined**,
 * because link 22's R9 examined 7 of 23 writes and found its one real offender
 * by luck — counting is the only thing that surfaces a rule which has quietly
 * stopped looking.
 *
 * There is no `.skip` rule here: `publicIntakeSurface`'s R10 walks every
 * `*Surface.test.ts` in this directory and fails on `.skip` / `xit` / `.todo`,
 * and this file matches that glob. Rule 11 — one definition, and it has one.
 */

import fs from 'fs'
import path from 'path'
import { planMoney } from '@/lib/planBalance'
import { BOOKING_DEPOSIT_CENTS } from '@/lib/partyPricing'

const SRC = path.join(process.cwd(), 'src')
const API_ROOT = path.join(SRC, 'app', 'api')

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

const relSrc = (abs: string) => path.relative(SRC, abs).split(path.sep).join('/')
const read = (relPath: string) => decomment(fs.readFileSync(path.join(SRC, relPath), 'utf8'))
const raw = (relPath: string) => fs.readFileSync(path.join(SRC, relPath), 'utf8')

/* ── R0 · the walker ────────────────────────────────────────────────────── */

/**
 * The arithmetic modules. Held exact in BOTH directions: a module that vanishes
 * fails here rather than silently exempting itself from every rule below, and a
 * new one has to be classified by a human.
 */
const MONEY_MODULES = [
  'lib/planBalance.ts', // the one answer
  'lib/planInvoice.ts', // the document
  'lib/planPayLinks.ts', // what a link charges
  'lib/planPayment.ts', // what the webhook records
  'lib/planShare.ts', // what the email says
  'lib/plan.ts', // the snapshot a save writes
  'lib/partyPricing.ts', // the deposit and the card fee
  'lib/bookingBalance.ts', // the admin/webhook answer
].sort()

/** Every file that WRITES a `bookings` money column, walked rather than listed. */
const MONEY_COLUMN = /(^|[^\w])(total_cents|balance_due_cents|deposit_amount)\s*:/m

const WRITERS = walk(path.join(SRC, 'app'), n => n === 'route.ts')
  .filter(f => MONEY_COLUMN.test(decomment(fs.readFileSync(f, 'utf8'))))
  .map(relSrc)

/**
 * Writers that touch `bookings` money. The ticket/order routes match the same
 * column names on `event_tickets` and `cm_cheer_orders`, which are a different
 * ledger; they are named here so the distinction is a decision on the record
 * rather than a regex accident.
 */
const NOT_BOOKINGS = [
  'app/api/cart-checkout/route.ts',
  'app/api/events/checkout/route.ts',
]

const BOOKING_WRITERS = WRITERS.filter(f => !NOT_BOOKINGS.includes(f))

describe('R0 · the surface is walked, and every module in it is accounted for', () => {
  it('every named arithmetic module exists on disk', () => {
    const missing = MONEY_MODULES.filter(m => !fs.existsSync(path.join(SRC, m)))
    expect(missing).toEqual([])
    expect(MONEY_MODULES.length).toBe(8)
  })

  it('no arithmetic module has appeared that the list does not name', () => {
    // Anything in `lib/` that derives a plan balance or a booking total is part
    // of this surface. A new `lib/quoteTotals.ts` must be classified, not
    // silently skipped by every rule below.
    const candidates = walk(path.join(SRC, 'lib'), n => n.endsWith('.ts'))
      .map(relSrc)
      .filter(f => {
        const s = read(f)
        return /balance_due_cents|balanceDueCents|outstandingCents|paidTowardTotalCents|billedTotalCents|computeBalance|getDepositCents/.test(
          s,
        )
      })
    expect(candidates.sort()).toEqual(MONEY_MODULES)
  })

  it('every writer of a bookings money column is classified, in both directions', () => {
    expect(NOT_BOOKINGS.every(f => WRITERS.includes(f))).toBe(true)
    expect(BOOKING_WRITERS.length).toBeGreaterThanOrEqual(8)
    // …and each one is a real file we can read, so no rule below scans nothing.
    for (const f of BOOKING_WRITERS) expect(read(f).length).toBeGreaterThan(0)
  })
})

/* ── R1 · one answer to "what does this plan owe" ───────────────────────── */

describe('R1 · the balance arithmetic has exactly one home', () => {
  /**
   * The shapes that ARE the defect: subtracting what has been paid, or the
   * deposit, from a total, spelled out by hand. Link 20 counted seven of these;
   * link 21 found a third copy of one the rule was aimed at two of.
   */
  const HAND_ROLLED = [
    /total_cents\s*\|\|\s*0\s*\)?\s*-/, // `(total_cents || 0) - paidSum`
    /Math\.max\(\s*0\s*,\s*totalCents\s*-\s*(paid|depositCents)/,
    /Math\.max\(\s*0\s*,\s*total\s*-\s*(paid|deposit)/,
  ]

  /**
   * Where the arithmetic is allowed to live. `bookingBalance.ts` is link 18's
   * extraction for the admin and webhook paths and is deliberately still its own
   * module — it answers about `bookings.total_cents`, not about the invoice.
   * This list may SHRINK. It must never grow without a human deciding to.
   */
  const ALLOWED = ['lib/planBalance.ts', 'lib/bookingBalance.ts', 'lib/partyPricing.ts']

  it('nowhere outside the allowed modules subtracts payments from a total by hand', () => {
    const offenders: string[] = []
    let examined = 0
    const files = [
      ...walk(path.join(SRC, 'lib'), n => n.endsWith('.ts')).map(relSrc),
      ...walk(path.join(SRC, 'app'), n => n === 'route.ts').map(relSrc),
    ]
    for (const f of files) {
      if (ALLOWED.includes(f)) continue
      examined++
      const src = read(f)
      for (const re of HAND_ROLLED) {
        const m = re.exec(src)
        if (m) offenders.push(`${f}: ${m[0].trim()}`)
      }
    }
    // Count what was examined. A rule that walks nothing passes silently.
    expect(examined).toBeGreaterThan(150)
    expect(offenders).toEqual([])
  })

  it('`planMoney` is the only thing that produces a balance for the plan surface', () => {
    // planInvoice must not re-derive it; it must call the shared function.
    const inv = read('lib/planInvoice.ts')
    expect(inv).toMatch(/planMoney\(\{/)
    expect(inv).not.toMatch(/depositIsSeparate\s*\?\s*totalCents\s*:/)
  })
})

/* ── R2 · optional line items are quoted, never charged ─────────────────── */

describe('R2 · an optional line item never reaches a total', () => {
  it('`billedTotalCents` is the only loop that sums line items into money', () => {
    const balance = read('lib/planBalance.ts')
    expect(balance).toMatch(/if\s*\(\s*item\.is_optional\s*===\s*true\s*\)\s*continue/)
  })

  it('nothing else multiplies unit_price by quantity into a running total', () => {
    const offenders: string[] = []
    let examined = 0
    const files = [
      ...walk(path.join(SRC, 'lib'), n => n.endsWith('.ts')).map(relSrc),
      ...walk(path.join(SRC, 'app'), n => n === 'route.ts').map(relSrc),
    ]
    for (const f of files) {
      if (f === 'lib/planBalance.ts') continue
      examined++
      const src = read(f)
      // `total += … unit_price_cents * … quantity …` — the shape recalcTotals had.
      if (/\+=\s*[^\n\r;]*unit_price_cents\s*\*/.test(src)) offenders.push(f)
    }
    expect(examined).toBeGreaterThan(150)
    expect(offenders).toEqual([])
  })

  it('`calculateLineItemTotal` delegates rather than keeping its own loop', () => {
    const pricing = read('lib/partyPricing.ts')
    const fn = sliceDecl(pricing, 'export function calculateLineItemTotal')
    expect(fn).toMatch(/return\s+billedTotalCents\(/)
    expect(fn).not.toMatch(/for\s*\(/)
  })

  it('`recalcTotals` selects the column it has to honour', () => {
    const admin = read('app/api/admin/parties/[id]/route.ts')
    const fn = sliceDecl(admin, 'async function recalcTotals')
    expect(fn).toMatch(/billedTotalCents\(/)
    // It used to select only three columns and could not have honoured it.
    expect(admin).toMatch(/unit_price_cents,\s*quantity,\s*guest_multiplied,\s*is_optional/)
  })
})

/**
 * Source from a declaration to the NEXT top-level declaration, or EOF.
 *
 * Not a fixed window: link 20's 400-byte slice spilled into the next function
 * and link 22's 200-byte replacement for it reproduced the same bug. Anchored on
 * a line-start declaration so a nested arrow function cannot end the slice.
 */
function sliceDecl(src: string, decl: string): string {
  const i = src.indexOf(decl)
  if (i < 0) throw new Error(`sliceDecl: ${decl} not found — the rule is scanning nothing`)
  const after = src.slice(i + decl.length)
  const next = /\r?\n(?:export\s+)?(?:async\s+)?(?:function|const|class|interface|type)\s/.exec(after)
  return decl + (next ? after.slice(0, next.index) : after)
}

/* ── R3 · the studio rule is one boolean, and it is Adam's ──────────────── */

describe('R3 · `party_type === studio_rental` is spelled exactly once', () => {
  it('the switch lives in planBalance and nowhere else decides it', () => {
    expect(read('lib/planBalance.ts')).toMatch(/export const STUDIO_DEPOSIT_IS_SEPARATE/)
  })

  it('no other module re-derives `depositIsSeparate` from the party type', () => {
    const offenders: string[] = []
    let examined = 0
    for (const f of [
      ...walk(path.join(SRC, 'lib'), n => n.endsWith('.ts')).map(relSrc),
      ...walk(path.join(SRC, 'app'), n => n === 'route.ts').map(relSrc),
    ]) {
      if (f === 'lib/planBalance.ts') continue
      examined++
      const src = read(f)
      // The exact shape planInvoice.ts used to carry.
      if (/depositIsSeparate\s*=\s*[^\n\r;]*===\s*['"]studio_rental['"]/.test(src)) offenders.push(f)
    }
    expect(examined).toBeGreaterThan(150)
    expect(offenders).toEqual([])
  })

  it('the ruling is documented, with the date, the numbers and the rows', () => {
    /**
     * The comment IS the deliverable here — the next person to touch this must
     * find out, without leaving the file, that this boolean is a settled owner
     * ruling and what flipping it back would do to four live bookings. So the
     * rule asserts the SUBSTANCE, not one phrase: an earlier version checked
     * only a single sentence, and a mutation that gutted the surrounding
     * explanation went straight through. A tripwire on prose has to name what
     * the prose has to say.
     *
     * It was a needs-Adam tripwire before 2026-09-16 and is a ruled-decision
     * tripwire now. The ticket number stays in the required list precisely so
     * the history remains findable from the file.
     */
    const flat = raw('lib/planBalance.ts').replace(/\s+\*?\s*/g, ' ')
    for (const required of [
      /needs-Adam 41/, // the ticket
      /RULED 2026-09-16/, // that it is settled, and when
      /HH-STU-ZVM4U/, // the rows it moved
      /HH-PTY-FSQU9/,
      /HH-STU-2CTJ3/,
      /HH-PTY-73LGZ/,
      /\$250/, // what it is worth
      /reservation payment/, // what the ruling says the deposit IS
      /authorisation/i, // …as distinct from the damage hold, which is not it
      /studio_security_hold/, // and where that other number lives
    ]) {
      expect(flat).toMatch(required)
    }
  })

  it('the second half of the same ruling is documented too', () => {
    const flat = raw('lib/planBalance.ts').replace(/\s+\*?\s*/g, ' ')
    expect(flat).toMatch(/COLUMN_FOLLOWS_INVOICE/)
    // The column and the document are now the same arithmetic. The comment has
    // to say WHY that is true rather than leaving it as a coincidence.
    expect(flat).toMatch(/no-op on every row/i)
    // …and the writer that actually puts the number in the column says so too.
    const checkout = raw('app/api/studio-rental/checkout/route.ts').replace(/\s+\*?\s*/g, ' ')
    expect(checkout).toMatch(/COLUMN_FOLLOWS_INVOICE/)
  })
})

/* ── R4 · the document and the charge come from ONE read ────────────────── */

describe('R4 · the invoice carries its own payments', () => {
  it('`loadPlanInvoice` reads booking_payments itself', () => {
    const inv = read('lib/planInvoice.ts')
    expect(inv).toMatch(/from\('booking_payments'\)/)
    expect(inv).toMatch(/payments:\s*PaymentRow\[\]/)
  })

  it('it FAILS CLOSED on a payments read error, like it already did for line items', () => {
    // Rule 12: a failed read is not "nothing has been paid". Discarding it would
    // reproduce the exact $1,475.00 statement, on a blip instead of by design.
    const inv = read('lib/planInvoice.ts')
    expect(inv).toMatch(/if\s*\(payErr\)\s*return\s*\{\s*ok:\s*false,\s*notFound:\s*false/)
  })

  it('`quoteFor` takes no payments array — it cannot be priced from a second read', () => {
    const links = read('lib/planPayLinks.ts')
    const fn = sliceDecl(links, 'export function quoteFor')
    expect(fn).not.toMatch(/payments\s*:\s*PaymentRow\[\]/)
    expect(fn).toMatch(/invoice\.outstandingCents/)
  })

  it('neither the page nor the pay route keeps its own copy of the payment rows', () => {
    const examined = ['app/plan/[ref]/summary/page.tsx', 'app/api/plan/[ref]/pay-link/route.ts']
    for (const f of examined) {
      expect(read(f)).not.toMatch(/from\('booking_payments'\)/)
    }
    expect(examined.length).toBe(2)
  })
})

/* ── R5 · a deposit can never exceed what is left ───────────────────────── */

describe('R5 · the deposit quote is capped by what the plan actually owes', () => {
  it('planMoney caps it, and does NOT cap a separate security deposit', () => {
    const fn = sliceDecl(read('lib/planBalance.ts'), 'export function planMoney')
    // `|| unpriced` was added with the reservation deposit (2026-09-16): a plan
    // with no priced items owes 0 for want of a QUOTE, not for want of a debt,
    // so the cap has nothing meaningful to cap against. The exemption is exactly
    // that one word — the behavioural tests below are what actually hold the
    // line, because this regex can only prove the guard is still spelled out.
    expect(fn).toMatch(
      /depositIsSeparate \|\| unpriced\s*\?\s*rawDepositOwed\s*:\s*Math\.min\(\s*rawDepositOwed,\s*outstandingCents\s*\)/,
    )
  })

  it('a PRICED plan that owes nothing still quotes no deposit — even offered a reservation', () => {
    // The regression this whole rule exists for: a $600 plan paid $600 rendered
    // a live "Pay $250.00 deposit". Passing `reservationDepositCents` must not
    // reopen it, which is the one way the 2026-09-16 change could have gone
    // wrong. `payment_type: 'partial'` because 16 of the 18 real payments are.
    const m = planMoney({
      totalCents: 60000,
      depositCents: 25000,
      depositIsSeparate: false,
      payments: [{ amount_cents: 60000, payment_type: 'partial' }],
      reservationDepositCents: BOOKING_DEPOSIT_CENTS,
    })
    expect(m.outstandingCents).toBe(0)
    expect(m.depositOwedCents).toBe(0)
  })

  it('a PARTLY paid priced plan owes the REST of the deposit, then nothing', () => {
    // $290 of a $300 party. The $250 deposit is long since covered, so the $10
    // left is balance, not deposit — the customer is asked for the same $10
    // either way, but the document must not call a settled deposit outstanding.
    const nearlyPaid = planMoney({
      totalCents: 30000,
      depositCents: 25000,
      depositIsSeparate: false,
      payments: [{ amount_cents: 29000, payment_type: 'partial' }],
      reservationDepositCents: BOOKING_DEPOSIT_CENTS,
    })
    expect(nearlyPaid.depositOwedCents).toBe(0)
    expect(nearlyPaid.balanceDueCents).toBe(1000)

    // Under the deposit, the remainder of it is still what books the date, and
    // it is still capped by the plan's own total.
    const part = planMoney({
      totalCents: 30000,
      depositCents: 25000,
      depositIsSeparate: false,
      payments: [{ amount_cents: 10000, payment_type: 'partial' }],
      reservationDepositCents: BOOKING_DEPOSIT_CENTS,
    })
    expect(part.depositOwedCents).toBe(15000)
    expect(part.depositOwedCents + part.balanceDueCents).toBe(part.outstandingCents)
  })

  it('an UNPRICED plan owes the flat reservation deposit, and not twice', () => {
    const unpaid = planMoney({
      totalCents: 0,
      depositCents: 0,
      depositIsSeparate: false,
      payments: [],
      reservationDepositCents: BOOKING_DEPOSIT_CENTS,
    })
    expect(unpaid.depositOwedCents).toBe(BOOKING_DEPOSIT_CENTS)
    // Nothing is "outstanding" and nothing is OVERPAID — a reservation on a plan
    // with no price must not render "a refund may be due" on the summary page.
    expect(unpaid.outstandingCents).toBe(0)
    expect(unpaid.overpaidCents).toBe(0)

    const paid = planMoney({
      totalCents: 0,
      depositCents: 0,
      depositIsSeparate: false,
      payments: [{ amount_cents: BOOKING_DEPOSIT_CENTS, payment_type: 'deposit' }],
      reservationDepositCents: BOOKING_DEPOSIT_CENTS,
    })
    expect(paid.depositOwedCents).toBe(0)
    expect(paid.overpaidCents).toBe(0)
  })

  it('no reservation deposit is offered when none is passed', () => {
    const m = planMoney({ totalCents: 0, depositCents: 0, depositIsSeparate: false, payments: [] })
    expect(m.depositOwedCents).toBe(0)
  })

  it('the page never invites a payment on a plan with nothing outstanding', () => {
    const page = read('app/plan/[ref]/summary/page.tsx')
    // The Venmo prompt and the "Reserve Your Date" block are both gated on
    // there being something to ask for. They used to be gated on `depositCents`,
    // which is a constant for the life of the plan.
    expect(page).toMatch(/const settled\s*=/)
    expect(page).toMatch(/\{!settled && askCents > 0 &&/)
    expect(page).not.toMatch(/Send \{money\(invoice\.depositCents\)\}/)
  })

  it('the balance the document prints is the one that accounts for payments', () => {
    const page = read('app/plan/[ref]/summary/page.tsx')
    expect(page).toMatch(/money\(invoice\.balanceDueCents\)/)
    const balance = read('lib/planBalance.ts')
    // balanceDueCents is derived from outstandingCents, not from the total alone.
    expect(balance).toMatch(/balanceDueCents\s*=\s*depositIsSeparate\s*\?\s*outstandingCents/)
  })
})

/* ── R5b · the Event Details card says each thing once ──────────────────── */

describe('R5b · the document does not repeat itself', () => {
  const page = () => read('app/plan/[ref]/summary/page.tsx')

  it('the package line is suppressed when it only repeats the heading', () => {
    // Measured on a real quote (HH-PTY-KMXWM, 2026-09-20): the Event Details
    // card printed "Mobile Party" in bold and "Mobile Party" again underneath,
    // because `docTitle` minus its suffix and `bookings.package_type` were the
    // same words from two different sources. Compared loosely — one is a label
    // from a map, the other is free text somebody typed.
    const src = page()
    expect(src).toMatch(/normalise\(booking\.package_type\) !== normalise\(docLabel\)/)
    expect(src).toMatch(/\{packageLine && \(/)
    // And the raw column is no longer rendered unconditionally.
    expect(src).not.toMatch(/\{booking\.package_type && \(/)
  })

  it('the party address is labelled, so it is not a loose line of text', () => {
    const src = page()
    expect(src).toMatch(/Party address:<\/span> \{invoice\.venueAddress\}/)
    // Still gated: a plan with no address prints no empty label.
    expect(src).toMatch(/\{invoice\.venueAddress && \(/)
  })

  it('the recommended tip is stated in the printed document, not only in the widget', () => {
    const src = page()
    // A customer paying by Venmo, or reading a PDF, never sees the tip jar.
    expect(src).toMatch(/RECOMMENDED_TIP_RATE/)
    expect(src).toMatch(/tip-prose/)
    // The prose and the jar share one condition. They did not for one deploy,
    // and the live page printed tip buttons with no sentence explaining them.
    expect(src).toMatch(/const tipOffered = payOptions\.some\(o => o\.tip\)/)
    expect(src).toMatch(/\{tipOffered && \(/)
    const css = read('app/plan/[ref]/summary/invoice.css')
    expect(css).toMatch(/\.tip-prose/)
  })
})

/* ── R6 · no amount ever comes from the client ──────────────────────────── */

describe('R6 · the charge is derived server-side', () => {
  /**
   * `tipCents` joined this list on 2026-09-20 and is the one body field that is
   * allowed to reach money without an admin gate. The rule it does not break:
   * **a tip can only ever RAISE the charge.** The attack R6 exists to stop is a
   * request that lowers what is collected, and there is no version of that in
   * this direction. Every other property below is what keeps it honest.
   */
  const ALLOWED_BODY_FIELDS = ['amountDollars', 'purpose', 'tipCents']

  it('the pay-link route reads only a purpose, an admin-gated amount, and a tip', () => {
    const route = read('app/api/plan/[ref]/pay-link/route.ts')
    expect(route).toMatch(/if\s*\(purpose === 'custom' && !isAdmin\)/)
    const bodyReads = [...route.matchAll(/body\.(\w+)/g)].map(m => m[1])
    expect([...new Set(bodyReads)].sort()).toEqual([...ALLOWED_BODY_FIELDS].sort())
  })

  it('the route does not clamp the tip itself — there is exactly one screen', () => {
    const route = read('app/api/plan/[ref]/pay-link/route.ts')
    // A second clamp here would be a second answer to "how big may a tip be",
    // and the pair would drift. The route hands the raw value to `quoteFor`,
    // which owns both the ceiling and the which-purposes rule.
    expect(route).not.toMatch(/MAX_TIP_CENTS|screenTipCents/)
    expect(route).toMatch(/tipCents:\s*body\.tipCents/)
  })

  it('the tip is clamped and purpose-gated in one place, on the server', () => {
    const links = read('lib/planPayLinks.ts')
    expect(links).toMatch(/purposeAcceptsTip\(purpose\)\s*\?\s*screenTipCents\(rawTipCents\)\s*:\s*0/)
    // Only the final payment. A gratuity on a reservation deposit tips a party
    // that has not happened.
    expect(links).toMatch(/export function purposeAcceptsTip[\s\S]*?return purpose === 'balance'/)
    // And it is charged, never credited: the fee is taken on amount + tip, and
    // the collection is amount + tip + fee.
    expect(links).toMatch(/calculateCardFee\(amountCents \+ tipCents\)/)
    expect(links).toMatch(/chargeCents = amountCents \+ tipCents \+ feeCents/)
  })

  it('a tip never pays the plan down — the webhook subtracts it before crediting', () => {
    const pay = read('lib/planPayment.ts')
    // This is the whole reason migration 057 added a column rather than
    // trusting Stripe metadata alone: a tip the webhook cannot see is credited
    // as party fees, and the customer's balance falls by the size of their own
    // gratuity.
    expect(pay).toMatch(/creditCents = Math\.max\(0, chargedCents - feeCents - tipCents\)/)
    expect(pay).toMatch(/tipCents: Math\.max\(0, row\.tip_cents \?\? 0\)/)
    expect(pay).toMatch(/tip_cents/)
  })

  it('the client sends a purpose and a tip, and never an amount', () => {
    const panel = read('app/plan/[ref]/summary/PayPanel.tsx')
    // The direct form of what "no arithmetic" was a proxy for: whatever the
    // panel computes for DISPLAY, the only things it may put on the wire are a
    // purpose and a tip. Both are re-derived or re-clamped server-side.
    const posted = [...panel.matchAll(/pay-link`,\s*\{([\s\S]*?)\}\)/g)].map(m => m[1])
    expect(posted.length).toBeGreaterThan(0)
    // Anchored on `{` or `,` so this reads KEYS and not the identifiers used as
    // values — `amountDollars: amount` has one key, not two.
    for (const body of posted) {
      const keys = [...body.matchAll(/[{,]\s*(\w+)\s*[:,]/g)].map(m => m[1])
      expect(keys.length).toBeGreaterThan(0)
      for (const k of keys) expect(ALLOWED_BODY_FIELDS).toContain(k)
    }
  })

  it('the client never sees the plan\'s own money fields', () => {
    const panel = read('app/plan/[ref]/summary/PayPanel.tsx')
    // `amountCents` is now permitted — it rides on `TipConfig` purely so the
    // charge line can be recomputed as the tip moves, and the server re-prices
    // at mint time regardless. These three are not: they are the figures that
    // decide what is owed, and the panel has no business knowing them.
    expect(panel).not.toMatch(/totalCents|balanceDueCents|outstandingCents|depositOwedCents/)
  })
})

/* ── R7 · the routes that mint Stripe objects are bounded ───────────────── */

describe('R7 · every plan route that costs money to call is rate limited', () => {
  const PLAN_ROUTES = walk(path.join(API_ROOT, 'plan'), n => n === 'route.ts').map(relSrc)

  it('found the plan routes at all', () => {
    expect(PLAN_ROUTES.length).toBeGreaterThanOrEqual(2)
  })

  /**
   * Two acceptable mechanisms, and a route must carry one of them.
   *
   * `guardRate` is the shared per-caller/per-route bucket. `claimSendSlot` is
   * `/api/plan/[ref]/email-me`'s stronger, per-booking, atomically-claimed
   * cooldown — a DB row rather than a process-local Map, which is why it
   * survives the container recreate that resets the rate limiter's buckets.
   * Naming both is the honest rule; requiring `guardRate` alone would have said
   * "unbounded" about the better-bounded of the two.
   */
  const MECHANISMS: [string, RegExp][] = [
    ['guardRate', /guardRate\(req,/],
    ['claimSendSlot', /claimSendSlot\(/],
  ]

  it('each one is bounded by a mechanism we can name', () => {
    const unguarded: string[] = []
    const found: Record<string, string> = {}
    for (const f of PLAN_ROUTES) {
      const src = read(f)
      const hit = MECHANISMS.find(([, re]) => re.test(src))
      if (hit) found[f] = hit[0]
      else unguarded.push(f)
    }
    expect(unguarded).toEqual([])
    // Both are in use today. If either disappears, a human decides whether that
    // route is now unbounded or has simply moved to the other mechanism.
    expect(new Set(Object.values(found))).toEqual(new Set(['guardRate', 'claimSendSlot']))
    expect(PLAN_ROUTES.length).toBeGreaterThanOrEqual(2)
  })
})

/* ── R8 · the portal ceiling cannot exceed the invoice ──────────────────── */

describe('R8 · /api/portal/pay cannot charge more than the invoice says', () => {
  const src = read('app/api/portal/pay/route.ts')

  it('the ceiling is the LOWER of the column and the derived figure', () => {
    expect(src).toMatch(/Math\.min\(columnCeiling,\s*derived\)/)
    // The reservation deposit (2026-09-16) is the ONE thing allowed above that
    // ceiling, and only by being a separate debt taken as the higher of the two
    // — never by loosening the min above. Both halves are asserted so that
    // collapsing them back into one figure fails here.
    expect(src).toMatch(/Math\.max\(pricedCeiling,\s*reservationOwedCents\)/)
  })

  it('the reservation deposit is bounded by the server, the plan and the ledger', () => {
    const decl = /const reservationOwedCents\s*=[\s\S]{0,300}?\r?\n\r?\n/.exec(src)
    expect(decl).not.toBeNull()
    // It may only exist on an UNPRICED plan…
    expect(decl![0]).toMatch(/isUnpricedPlan\(/)
    // …its figure comes from `planMoney` (which nets off `booking_payments`),
    // never from the request body.
    expect(decl![0]).toMatch(/depositOwedCents/)
    expect(decl![0]).not.toMatch(/amountCents|body/)
  })

  it('a reservation payment is recorded AS a deposit, or it can be charged twice', () => {
    // `paidAsDepositCents` only nets off rows typed `deposit`. Recording a
    // reservation as `final`/`partial` leaves `depositOwedCents` at $250 and
    // invites the customer to pay it again — and `/my-booking/pay` sends no
    // type at all, so the fallback is what would have done it.
    expect(src).toMatch(/const isReservationPayment\s*=/)
    expect(src).toMatch(/isReservationPayment\s*\r?\n?\s*\?\s*'deposit'/)
    // It must also never be called the FINAL payment on a plan nobody priced.
    expect(src).toMatch(/const isFinalPayment = !isReservationPayment &&/)
  })

  it('a divergence is reported rather than absorbed silently', () => {
    // Rule 10: a guardrail that stops something must say that it stopped it.
    expect(src).toMatch(/balance disagreement/)
    expect(src).toMatch(/needs-Adam 41/)
  })

  it('an unreadable invoice falls back to the column rather than to zero or to nothing', () => {
    /**
     * Three outcomes (rule 12). Returning 0 refuses a real customer's payment;
     * dropping the guard silently is worse. `null` is the third.
     *
     * Anchored on the FAILURE BRANCH, not on the function. The first version of
     * this rule asserted only that the function contained `return null`
     * somewhere — and it does, in the "no line items" branch below — so a
     * mutation that turned the read-failure branch into `return 0` went
     * straight through. That is link 22's wrong-occurrence family, found the
     * only way it ever is: by reintroducing the defect and watching the rule
     * stay green.
     */
    const fn = sliceDecl(src, 'async function derivedPlanMoney')
    const failBranch = /if \(itemErr \|\| payErr\) \{[\s\S]{0,400}?\r?\n  \}/.exec(fn)
    expect(failBranch).not.toBeNull()
    expect(failBranch![0]).toMatch(/console\.error\(/)
    expect(failBranch![0]).toMatch(/return null/)
    expect(failBranch![0]).not.toMatch(/return 0/)
    // …and the separate "there is no invoice to compare against" outcome still
    // falls back to the column rather than to a ceiling of zero. It is no longer
    // an early `return null` — the helper computes the money either way, because
    // the reservation deposit needs the payment rows on exactly these rows — so
    // the invariant now lives at the call site and is asserted THERE.
    expect(fn).toMatch(/priced: rows\.length > 0/)
    expect(src).toMatch(/derivedMoney && derivedMoney\.priced \? derivedMoney\.money\.outstandingCents : null/)
  })
})

/* ── R9 · every write reads its error (rule 19) ─────────────────────────── */

describe('R9 · no write on this surface discards its error', () => {
  /**
   * Counting is the point. Link 22's version of this rule split statements on
   * `\n`, which meant it examined 7 of 23 multi-line supabase chains and found
   * its one offender by luck. This one finds each `.from(...)` occurrence and
   * takes the text up to the next one, so a chain that spans eight lines is one
   * site — and it asserts the number of sites so a regex that stops matching
   * fails loudly instead of passing.
   */
  const WRITE_VERB = /\.(insert|update|upsert|delete)\(/

  /**
   * A write site, WITH the text that precedes it.
   *
   * The first version of this rule split on `(?=\.from\()`, which put the
   * `const { error: insErr } = await supabase` prefix in the PREVIOUS chunk and
   * reported three correctly-handled writes as offenders. That is hard-won rule
   * 8 aimed at this file — link 20's 400-byte window, link 21's three
   * wrong-occurrence rules and link 22's fix-that-reproduced-the-bug are all the
   * same mistake — and it is only visible because the rule was run against code
   * known to be correct before being trusted against code that is not.
   */
  function writeSites(src: string): string[] {
    const out: string[] = []
    for (const m of src.matchAll(/\.from\(/g)) {
      const i = m.index ?? 0
      const tail = src.slice(i, i + 600)
      if (!WRITE_VERB.test(tail.slice(0, 400))) continue
      out.push(src.slice(Math.max(0, i - 200), i + 600))
    }
    return out
  }

  it('examines every write on the arithmetic modules and finds none unread', () => {
    const offenders: string[] = []
    let sites = 0
    for (const f of MONEY_MODULES.concat(['app/api/plan/[ref]/pay-link/route.ts'])) {
      for (const site of writeSites(read(f))) {
        sites++
        const reads =
          /error\s*:\s*\w+\s*\}/.test(site) || // `const { error: insErr } =`
          /\{\s*error\s*\}/.test(site) || // `.then(({ error }) =>`
          /\.select\(/.test(site) // `…update().select()` then the rows are checked
        if (!reads) offenders.push(`${f}: ${site.slice(200, 280).replace(/\s+/g, ' ')}`)
      }
    }
    // The number of write sites on this surface today. If a module is added or
    // the regex stops matching, this moves and a human looks.
    expect(sites).toBeGreaterThanOrEqual(6)
    expect(offenders).toEqual([])
  })
})

/* ── R10 · idempotency is decided by SQLSTATE, never by prose ───────────── */

describe('R10 · a duplicate is recognised by code, not by message text', () => {
  it('isUniqueViolation checks 23505', () => {
    const fn = sliceDecl(read('lib/planPayment.ts'), 'export function isUniqueViolation')
    expect(fn).toMatch(/'23505'/)
  })

  it('nothing on the surface decides duplication by reading a message alone', () => {
    const offenders: string[] = []
    let examined = 0
    for (const f of MONEY_MODULES) {
      examined++
      const src = read(f)
      for (const m of src.matchAll(/message[^\n\r]{0,40}includes\(\s*['"]duplicate['"]/g)) {
        // Allowed only inside isUniqueViolation, which checks the code first.
        const before = src.slice(Math.max(0, m.index - 400), m.index)
        if (!/'23505'/.test(before)) offenders.push(`${f}: ${m[0]}`)
      }
    }
    expect(examined).toBe(8)
    expect(offenders).toEqual([])
  })
})

/* ── R11 · a zero is refused, never recorded ────────────────────────────── */

describe('R11 · a $0 payment row is refused rather than taking the unique key', () => {
  it('recordPlanPayment refuses a session that collected nothing', () => {
    const src = read('lib/planPayment.ts')
    expect(src).toMatch(/!session\.amount_total \|\| session\.amount_total <= 0/)
    expect(src).toMatch(/session collected no money/)
  })

  it('and refuses one that has not settled', () => {
    expect(read('lib/planPayment.ts')).toMatch(/payment_status === 'unpaid'/)
  })
})
