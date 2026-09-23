/**
 * The studio damage hold — when it is offered, and the two ways it must never
 * be mistaken for revenue.
 */

import {
  securityHoldOffer,
  formatHoldDate,
  SECURITY_HOLD_WINDOW_DAYS,
  HOLD_AUTHORIZED,
  HOLD_SESSION_TYPE,
} from '@/lib/securityHold'
import { HANDLED_SESSION_TYPES } from '@/lib/stripeSettlement'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

/** A studio rental on 2026-09-27 with nothing held yet. */
const rental = (over: Partial<Parameters<typeof securityHoldOffer>[0]> = {}) => ({
  partyType: 'studio_rental',
  partyDate: '2026-09-27',
  status: 'deposit_paid',
  securityDepositStatus: 'none',
  amountCents: 25000,
  ...over,
})

describe('securityHoldOffer — the five-day window', () => {
  it('opens exactly five days before the rental, not four and not six', () => {
    // 2026-09-27 minus 5 = 2026-09-22.
    expect(securityHoldOffer(rental(), '2026-09-21').state).toBe('too_early')
    expect(securityHoldOffer(rental(), '2026-09-22').state).toBe('offer')
    expect(SECURITY_HOLD_WINDOW_DAYS).toBe(5)
  })

  it('stays open on the day of the rental — they can do it on arrival', () => {
    expect(securityHoldOffer(rental(), '2026-09-27').state).toBe('offer')
  })

  it('closes the day after, so a past rental cannot take a card', () => {
    expect(securityHoldOffer(rental(), '2026-09-28').state).toBe('not_applicable')
  })

  it('tells a customer the date rather than hiding, before the window', () => {
    const o = securityHoldOffer(rental(), '2026-08-01')
    expect(o.state).toBe('too_early')
    if (o.state !== 'too_early') throw new Error('expected too_early')
    expect(o.opensOn).toBe('2026-09-22')
    expect(formatHoldDate(o.opensOn)).toBe('September 22, 2026')
  })

  /**
   * The month boundary is where a naive `date - 5` breaks, and `shiftEtDate`
   * is what stops it. A rental on the 3rd opens in the previous month.
   */
  it('counts back across a month boundary', () => {
    const o = securityHoldOffer(rental({ partyDate: '2026-10-03' }), '2026-09-28')
    expect(o.state).toBe('offer')
    const early = securityHoldOffer(rental({ partyDate: '2026-10-03' }), '2026-09-27')
    expect(early.state).toBe('too_early')
    if (early.state !== 'too_early') throw new Error('expected too_early')
    expect(early.opensOn).toBe('2026-09-28')
  })
})

describe('securityHoldOffer — who is asked at all', () => {
  it('is only ever offered on a studio rental', () => {
    for (const t of ['in_studio_theme', 'mobile_party', 'unknown', null, undefined]) {
      expect(securityHoldOffer(rental({ partyType: t }), '2026-09-22').state).toBe('not_applicable')
    }
  })

  it('never asks a cancelled rental for a card', () => {
    expect(securityHoldOffer(rental({ status: 'cancelled' }), '2026-09-22').state).toBe('not_applicable')
  })

  it('stops asking once the hold is authorized — even inside the window', () => {
    const o = securityHoldOffer(rental({ securityDepositStatus: HOLD_AUTHORIZED }), '2026-09-22')
    expect(o.state).toBe('done')
  })

  /**
   * `done` is checked BEFORE the date window on purpose: a customer who
   * authorized early must not be asked a second time on the day, which would
   * put a second $250 authorization on the same card.
   */
  it('reports done even outside the window, rather than falling back to too_early', () => {
    expect(securityHoldOffer(rental({ securityDepositStatus: HOLD_AUTHORIZED }), '2026-01-01').state).toBe('done')
    expect(securityHoldOffer(rental({ securityDepositStatus: HOLD_AUTHORIZED }), '2026-12-31').state).toBe('done')
  })

  it('is silent on an undated rental — there is nothing to count back from', () => {
    expect(securityHoldOffer(rental({ partyDate: null }), '2026-09-22').state).toBe('not_applicable')
  })

  it('is silent when the catalog gives no hold amount, rather than offering $0', () => {
    for (const cents of [0, null, undefined]) {
      expect(securityHoldOffer(rental({ amountCents: cents }), '2026-09-22').state).toBe('not_applicable')
    }
  })
})

/* ── The money rules, as source guards ──────────────────────────────────── */

describe('a hold is never revenue', () => {
  /**
   * The single most expensive way this feature could be wrong: a $250
   * authorization recorded as a payment pays the invoice down by $250, and the
   * customer is told she owes $100 on a $350 balance. The webhook branch must
   * touch neither table.
   */
  it('the webhook branch writes no booking_payments and no financial row', () => {
    const src = read('app/api/webhook/route.ts')
    const start = src.indexOf(`if (m.type === HOLD_SESSION_TYPE)`)
    expect(start).toBeGreaterThan(-1)
    // Slice the BRANCH, not the file — the file is full of legitimate payment
    // writers and a whole-file assertion would pass or fail for the wrong
    // reason. End at the settlement check that follows it.
    const end = src.indexOf('const settlement = sessionSettlement(session)', start)
    expect(end).toBeGreaterThan(start)
    const branch = src.slice(start, end)
    expect(branch).not.toMatch(/booking_payments/)
    expect(branch).not.toMatch(/financial_transactions|recordLedgerEntry|recordAdminPayment/)
    expect(branch).not.toMatch(/balance_due_cents/)
    // What it DOES write.
    expect(branch).toMatch(/security_deposit_pi_id/)
    expect(branch).toMatch(/security_deposit_status: HOLD_AUTHORIZED/)
  })

  /**
   * Ordering, which is the other half of the correctness. A manual-capture
   * authorization arrives `payment_status: 'unpaid'`, so if the settlement
   * check ran first this branch would never execute and the hold would be
   * recorded nowhere.
   */
  it('the branch runs BEFORE the settlement check, because a hold is never settled', () => {
    const src = read('app/api/webhook/route.ts')
    const branch = src.indexOf(`if (m.type === HOLD_SESSION_TYPE)`)
    const settlement = src.indexOf('const settlement = sessionSettlement(session)')
    expect(branch).toBeGreaterThan(-1)
    expect(settlement).toBeGreaterThan(-1)
    expect(branch).toBeLessThan(settlement)
  })

  it('the session type is registered, so a hold never lands in the unclaimed net', () => {
    expect(HANDLED_SESSION_TYPES as readonly string[]).toContain(HOLD_SESSION_TYPE)
    expect(HOLD_SESSION_TYPE).toBe('security_hold')
  })

  it('the route authorizes rather than charges, and takes no amount from the caller', () => {
    const src = read('app/api/plan/[ref]/security-hold/route.ts')
    expect(src).toMatch(/capture_method: 'manual'/)
    // The amount comes from the offer, which comes from the catalog.
    expect(src).toMatch(/unit_amount: offer\.amountCents/)
    // Never from the request body.
    expect(src).not.toMatch(/body\.\w*[Aa]mount|amountCents.*await req\.json/)
    // And the window is re-checked server-side rather than trusted from the page.
    expect(src).toMatch(/securityHoldOffer\(/)
    expect(src).toMatch(/offer\.state !== 'offer'/)
  })

  it('the route is access-gated like every other plan money route', () => {
    const src = read('app/api/plan/[ref]/security-hold/route.ts')
    expect(src).toMatch(/planAccess\(/)
    // A plan that cannot be READ is a 503, never a 404.
    expect(src).toMatch(/status: 503/)
  })
})
