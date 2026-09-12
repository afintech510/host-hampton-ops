/**
 * `lib/unclaimedPayment.ts` — the net under every metadata-keyed branch.
 *
 * Written against the REAL shape of the live session that lost $927: empty
 * metadata, `payment_link` present, `client_reference_id` null,
 * `payment_status: 'paid'`. Fixtures that all carry metadata are why that class
 * of bug survived, so these deliberately do not.
 */

import type Stripe from 'stripe'
import {
  isUnclaimableSession,
  recordUnclaimedStripeSession,
  UNCLAIMED_CATEGORY,
} from '@/lib/unclaimedPayment'
import { makePlanDb, writesTo } from '../mocks/planDb'

jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: () => ({}) }) }))

const sendMock = jest.fn().mockResolvedValue({ id: 'e1' })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: (...a: unknown[]) => sendMock(...a) } })),
}))

const ORPHAN = {
  id: 'cs_live_a19RC3RB68xfe47kovLSde8qWJbKp3N2NfOht5iDbMDg4ORYnrCHyQfsSi',
  object: 'checkout.session',
  amount_total: 92700,
  currency: 'usd',
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  payment_intent: 'pi_live_orphan',
  payment_link: 'plink_1UEd7K02uXWznKaWhBqqbnpC',
  client_reference_id: null,
  customer_details: { email: 'customer@example.com', name: 'A Customer' },
  metadata: {},
  livemode: true,
} as unknown as Stripe.Checkout.Session

const session = (over: Record<string, unknown> = {}) =>
  ({ ...ORPHAN, ...over }) as unknown as Stripe.Checkout.Session

const originalEnv = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv, RESEND_API_KEY: 're_test', OWNER_NOTIFY_EMAIL: 'owner@example.com' }
})

afterAll(() => {
  process.env = originalEnv
})

const db = (error: { message: string; code?: string } | null = null) =>
  makePlanDb({ financial_transactions: [{ data: null, error }] })

describe('isUnclaimableSession', () => {
  it('says yes to the real hand-made-link shape (no metadata at all)', () => {
    expect(isUnclaimableSession({})).toBe(true)
    expect(isUnclaimableSession(null)).toBe(true)
    expect(isUnclaimableSession(undefined)).toBe(true)
  })

  it('says no when the legacy booking flow has a contact to work with', () => {
    // These are exactly the two fields `bookings_contact_reachable_check` needs,
    // which is the constraint that made the fallthrough insert impossible.
    expect(isUnclaimableSession({ contactEmail: 'a@b.com' })).toBe(false)
    expect(isUnclaimableSession({ contactPhone: '+16314008080' })).toBe(false)
  })

  it('says yes to metadata that exists but names no contact', () => {
    // A dashboard link can carry some unrelated metadata and still be
    // unclaimable, which is why this is not an "is the metadata empty" check.
    expect(isUnclaimableSession({ note: 'for the Smiths' })).toBe(true)
  })
})

describe('recordUnclaimedStripeSession', () => {
  it('writes the full amount where Adam already looks', async () => {
    const d = db()
    const res = await recordUnclaimedStripeSession(session(), d as never)
    expect(res).toMatchObject({ recorded: true, duplicate: false })
    const row = writesTo(d, 'financial_transactions', 'insert')[0].payload as Record<string, unknown>
    expect(row.amount_cents).toBe(92700)
    expect(row.category).toBe(UNCLAIMED_CATEGORY)
    expect(row.source).toBe('stripe')
    expect(String(row.description)).toMatch(/UNMATCHED/)
  })

  it('keys the reference on the session id, so a redelivery cannot double it', async () => {
    const d = db()
    await recordUnclaimedStripeSession(session(), d as never)
    const row = writesTo(d, 'financial_transactions', 'insert')[0].payload as Record<string, unknown>
    expect(row.reference).toBe(`stripe-unmatched-${ORPHAN.id}`)
  })

  it('treats the unique-violation redelivery as recorded, and does not re-email', async () => {
    const d = db({ message: 'duplicate key value', code: '23505' })
    const res = await recordUnclaimedStripeSession(session(), d as never)
    expect(res).toMatchObject({ recorded: true, duplicate: true })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('tells Adam the first time, naming the amount and the link', async () => {
    await recordUnclaimedStripeSession(session(), db() as never)
    expect(sendMock).toHaveBeenCalledTimes(1)
    const mail = sendMock.mock.calls[0][0] as { subject: string; html: string; to: string }
    expect(mail.to).toBe('owner@example.com')
    expect(mail.subject).toMatch(/\$927\.00/)
    expect(mail.html).toMatch(/plink_1UEd7K02uXWznKaWhBqqbnpC/)
  })

  it('reports failure loudly rather than claiming success, when it cannot even record it', async () => {
    const d = db({ message: 'connection reset' })
    const res = await recordUnclaimedStripeSession(session(), d as never)
    expect(res).toMatchObject({ recorded: false })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('ignores a session that settled nothing — a $0 row would be noise', async () => {
    const d = db()
    expect(await recordUnclaimedStripeSession(session({ amount_total: 0 }), d as never)).toMatchObject({ recorded: false })
    expect(await recordUnclaimedStripeSession(session({ amount_total: null }), d as never)).toMatchObject({ recorded: false })
    expect(await recordUnclaimedStripeSession(session({ payment_status: 'unpaid' }), d as never)).toMatchObject({ recorded: false })
    expect(writesTo(d, 'financial_transactions', 'insert')).toHaveLength(0)
  })

  it('escapes a customer-supplied name in the notification', async () => {
    await recordUnclaimedStripeSession(
      session({ customer_details: { email: 'x@example.com', name: '<img src=x onerror=alert(1)>' } }),
      db() as never,
    )
    const mail = sendMock.mock.calls[0][0] as { html: string }
    expect(mail.html).not.toMatch(/<img/)
    expect(mail.html).toMatch(/&lt;img/)
  })
})
