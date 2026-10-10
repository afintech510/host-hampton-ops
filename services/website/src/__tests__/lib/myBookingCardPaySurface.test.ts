/**
 * `/my-booking`'s card payment, P00 of the evite build.
 *
 * What was broken: `/api/portal/pay`'s card branch creates a **PaymentIntent**
 * and answers `{ clientSecret: 'pi_…_secret_…', paymentIntentId, method: 'card' }`
 * — no `url`. Both customer pages then treated that as something else:
 *
 *   - `MyBookingContent.tsx` handed it to `stripe.initEmbeddedCheckout`, which
 *     wants a **Checkout Session** secret (`cs_…_secret_…`). Stripe rejects a
 *     PaymentIntent secret there, so "Pay Deposit" on `/my-booking` threw before
 *     any card field rendered.
 *   - `/my-booking/pay/page.tsx` only read `data.url`, which the card branch
 *     never sets, so it fell through to `setInstructions(data.instructions || '')`
 *     — an empty "Payment Instructions" panel and no card form at all.
 *
 * Both now mount a Payment Element (`PortalCardPayment`), the same pattern as the
 * party-builder's "Make a Payment" panel, which posts to the very same route and
 * works.
 *
 * Part 1 drives the route and pins the SHAPE the clients must cope with. It is
 * green before and after the fix on purpose: the route's money logic is not what
 * changed, and this is the evidence it did not. Part 2 reads the clients off disk
 * and is the part that is red before the fix.
 *
 * Conventions (AGENTS.md §11): comments are stripped before any rule runs (this
 * header names the defective calls), every anchor tolerates CRLF, no `.skip`, and
 * every rule counts what it examined.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }),
  },
}))

// A realistic secret. `initEmbeddedCheckout` / Elements both key off the PREFIX,
// so a stub that says 'cs_secret' would hide the very thing this file is about.
const PI_SECRET = 'pi_3PxYz02uXWznKaWM1abcdEfG_secret_Zk9QqRmV8nL2sT4uW6xY0aBcD'
const created: any[] = []
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(async (args: any) => {
        created.push(args)
        return { id: 'pi_3PxYz02uXWznKaWM1abcdEfG', client_secret: PI_SECRET, amount: args.amount }
      }),
    },
  }))
})

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))
jest.mock('@/lib/portalAuth', () => ({
  ...jest.requireActual('@/lib/portalAuth'),
  getPortalBookingRef: () => 'HH-PTY-TEST1',
  portalSigningSecret: () => 'test-secret',
}))

import fs from 'fs'
import path from 'path'
import { POST } from '@/app/api/portal/pay/route'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

const SRC = path.join(__dirname, '..', '..')
const read = (r: string) => fs.readFileSync(path.join(SRC, r), 'utf8')

function decomment(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\/|(^|[^:'"`\\])\/\/[^\n\r]*/g, (m, p) => {
    const keep = p ?? ''
    return keep + m.slice(keep.length).replace(/[^\n\r]/g, ' ')
  })
}
const code = (r: string) => decomment(read(r))

const CLIENT = 'app/my-booking/MyBookingContent.tsx'
const PAY_PAGE = 'app/my-booking/pay/page.tsx'
const SHARED = 'app/my-booking/PortalCardPayment.tsx'
const CLIENTS = [CLIENT, PAY_PAGE]

const BOOKING = {
  id: 'bk-1',
  booking_ref: 'HH-PTY-TEST1',
  status: 'awaiting_deposit',
  total_cents: 110_000,
  balance_due_cents: 85_000,
  contact_name: 'Adam Test',
  contact_email: 'adam@easternbuilding.supply',
  package_type: 'Studio Rental',
}
const req = (body: any): any => ({
  headers: { get: (n: string) => (n === 'cookie' ? 'hh_portal=x' : null) },
  json: async () => body,
})

beforeEach(() => {
  jest.clearAllMocks()
  created.length = 0
  __resetRateLimitForTests()
  process.env.STRIPE_SECRET_KEY = 'sk_test_not_a_real_key'
  mockGetSupabase.mockReturnValue(makeFakeMoneyDb({ bookings: [{ ...BOOKING }] }).client as any)
})

/* ───────────────────────── Part 1 — the response the clients receive ─────── */

describe('P00 — what /api/portal/pay answers for a card', () => {
  it('is a PaymentIntent client secret with NO url — not a Checkout Session secret', async () => {
    const res: any = await POST(req({ amountCents: 25_000, paymentMethod: 'card', paymentType: 'deposit', embedded: true }))
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.method).toBe('card')
    expect(body.url).toBeUndefined()
    expect(body.clientSecret).toMatch(/^pi_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/)
    // The shape `initEmbeddedCheckout` requires, and which this is NOT.
    expect(body.clientSecret).not.toMatch(/^cs_/)
    expect(body.paymentIntentId).toMatch(/^pi_/)
    expect(body.clientSecret.startsWith(body.paymentIntentId + '_secret_')).toBe(true)
  })

  it('creates the intent with redirects disabled, so a confirm needs no return trip', async () => {
    await POST(req({ amountCents: 25_000, paymentMethod: 'card', paymentType: 'deposit' }))
    expect(created).toHaveLength(1)
    expect(created[0].automatic_payment_methods).toEqual({ enabled: true, allow_redirects: 'never' })
  })

  it('sends the same metadata keys it always did (this change touches no money)', async () => {
    await POST(req({ amountCents: 25_000, paymentMethod: 'card', paymentType: 'deposit' }))
    expect(Object.keys(created[0].metadata).sort()).toEqual(
      [
        'amountCents', 'booking_id', 'booking_ref', 'cardFeeCents', 'contactEmail',
        'contactName', 'depositCents', 'payment_type', 'tipCents', 'type',
      ].sort(),
    )
  })
})

/* ───────────────────────────────────────── Part 2 — the two clients ──────── */

describe('P00 — neither client feeds a PaymentIntent secret to embedded Checkout', () => {
  it('examines both clients and the shared component', () => {
    for (const f of [...CLIENTS, SHARED]) expect(code(f).length).toBeGreaterThan(500)
  })

  it.each([...CLIENTS, SHARED])('%s never calls initEmbeddedCheckout', f => {
    expect(code(f)).not.toMatch(/initEmbeddedCheckout/)
  })

  it.each([...CLIENTS, SHARED])('%s never reads an embedded-checkout handle', f => {
    expect(code(f)).not.toMatch(/embeddedCheckoutRef|EmbeddedCheckout/)
  })
})

describe('P00 — the shared component is a Payment Element, not a third pattern', () => {
  it("mounts elements.create('payment') from the intent's clientSecret", () => {
    const src = code(SHARED)
    expect(src).toMatch(/loadStripe\(/)
    expect(src).toMatch(/stripe\.elements\(\{\s*clientSecret/)
    expect(src).toMatch(/elements\.create\('payment'/)
  })

  it('confirms with return_url = /my-booking?paid=1 and does not demand a redirect', () => {
    const src = code(SHARED)
    expect(src).toMatch(/\.confirmPayment\(\{/)
    expect(src).toMatch(/return_url:\s*`\$\{window\.location\.origin\}\/my-booking\?paid=1`/)
    expect(src).toMatch(/redirect:\s*'if_required'/)
  })

  it('reconciles through confirm-session by payment_intent, like the party-builder', () => {
    const src = code(SHARED)
    expect(src).toMatch(/\/api\/party-builder\/confirm-session/)
    expect(src).toMatch(/payment_intent:\s*paymentIntentId/)
  })

  it('a declined card is reported and does NOT call onSuccess', () => {
    const src = code(SHARED)
    // The `if (error)` branch must return before onSuccess is reached.
    const errBranch = /if \(confirmError\) \{(?:(?!\bif\s*\()[\s\S])*?return\b/
    expect(src).toMatch(errBranch)
    const confirmAt = src.search(/\.confirmPayment\(/)
    const successAt = src.search(/onSuccess\(\)/)
    expect(confirmAt).toBeGreaterThan(-1)
    expect(successAt).toBeGreaterThan(confirmAt)
  })

  it('unmounts the element on teardown', () => {
    expect(code(SHARED)).toMatch(/\.unmount\(\)/)
  })

  it('reads only the public key in the browser', () => {
    const src = code(SHARED)
    expect(src).toMatch(/NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY/)
    expect(src).not.toMatch(/STRIPE_SECRET/)
  })
})

describe('P00 — both clients hand the intent to that component', () => {
  it.each(CLIENTS)('%s reads clientSecret and renders PortalCardPayment', f => {
    const src = code(f)
    expect(src).toMatch(/from '\.\/PortalCardPayment'|from '\.\.\/PortalCardPayment'/)
    expect(src).toMatch(/<PortalCardPayment\b/)
    expect(src).toMatch(/\.clientSecret\b/)
    expect(src).toMatch(/\.paymentIntentId\b/)
  })

  it('/my-booking/pay no longer treats the card response as a redirect-or-instructions reply', () => {
    const src = code(PAY_PAGE)
    // The old fall-through: anything without `url` became (empty) instructions.
    // The card branch must be decided BEFORE that fall-through.
    const cardAt = src.search(/\.clientSecret/)
    const fallAt = src.search(/setInstructions\(data\.instructions/)
    expect(cardAt).toBeGreaterThan(-1)
    expect(fallAt).toBeGreaterThan(-1)
    expect(cardAt).toBeLessThan(fallAt)
  })

  it('/my-booking/pay returns to /my-booking?paid=1 on success', () => {
    expect(code(PAY_PAGE)).toMatch(/\/my-booking\?paid=1/)
  })

  it('/my-booking shows its payment notice for ?paid=1 as well as the legacy params', () => {
    const src = code(CLIENT)
    expect(src).toMatch(/params\.get\('paid'\)\s*===\s*'1'/)
  })

  it('neither client changes what is sent to /api/portal/pay (amount and type keys)', () => {
    const c = code(CLIENT)
    expect(c).toMatch(/amountCents,\s*\r?\n\s*paymentMethod,\s*\r?\n\s*paymentType: paymentType === 'full' \? 'final' : paymentType/)
    expect(code(PAY_PAGE)).toMatch(/JSON\.stringify\(\{ amountCents, paymentMethod \}\)/)
  })
})
