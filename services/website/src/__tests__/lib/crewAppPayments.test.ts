/**
 * The $ Payments screen's data, the Text-in-Quo / Email-in-Gmail links, and the roster
 * hiding Allie unless removed members are shown.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { decomment } from '../helpers/sourceScan'

const mockFindQuo = jest.fn()
const mockBooking = jest.fn()
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.maybeSingle = async () => mockBooking()
      return q
    },
  }),
}))

import { methodOfBookingPayment, methodOfTicket, loadPayments } from '@/lib/crewAppPayments'
import { gmailComposeUrl } from '@/lib/gmailCompose'
import { findQuoLink } from '@/lib/quo'
import { GET as contactGet } from '@/app/api/admin/crew-app/contact-link/route'
import { GET as paymentsGet } from '@/app/api/admin/crew-app/payments/route'
import { sectionOf } from '@/app/admin/crew/_components/CrewAdminBar'

jest.mock('@/lib/quo', () => ({ ...jest.requireActual('@/lib/quo'), findQuoLink: (...a: unknown[]) => mockFindQuo(...a) }))

const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

describe('payment methods', () => {
  it('maps what is stored to the five the screen shows', () => {
    expect(['card', 'stripe', 'venmo', 'zelle', 'cash', 'other', 'check', null, 'VENMO'].map(m => methodOfBookingPayment(m as never))).toEqual(['card', 'card', 'venmo', 'zelle', 'cash', 'other', 'other', 'other', 'venmo'])
  })

  it('a ticket is card if Stripe took it, else the method written in its note', () => {
    expect(methodOfTicket(true, 'Venmo 5.00')).toBe('card')
    expect(methodOfTicket(false, 'Venmo 115.00 from Someone on 2026-09-17')).toBe('venmo')
    expect(methodOfTicket(false, 'Zelle 40')).toBe('zelle')
    expect(methodOfTicket(false, 'Cash at the door')).toBe('cash')
    expect(methodOfTicket(false, null)).toBe('other')
    expect(methodOfTicket(false, 'Added by hand 2026-09-13')).toBe('other')
  })
})

type Rows = Record<string, Array<Record<string, unknown>>>
function fakeDb(tables: Rows, failOn?: string) {
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {}
      for (const m of ['select', 'in', 'order', 'limit']) q[m] = () => q
      q.then = (res: (v: unknown) => unknown) => Promise.resolve(failOn === t ? { data: null, error: { message: 'down' } } : { data: tables[t] ?? [], error: null }).then(res)
      return q
    },
  } as never
}

describe('loadPayments', () => {
  const tables: Rows = {
    booking_payments: [
      { id: 'p3', booking_id: 'b1', payment_type: 'final', payment_method: 'venmo', amount_cents: 50_000, tip_cents: null, paid_at: '2026-11-05T15:00:00Z', created_at: '2026-11-05T15:00:00Z' },
      { id: 'p2', booking_id: 'b1', payment_type: 'deposit', payment_method: 'card', amount_cents: 25_000, tip_cents: 1_000, paid_at: '2026-10-01T15:00:00Z', created_at: '2026-10-01T15:00:00Z' },
      { id: 'p1', booking_id: 'b2', payment_type: 'refund', payment_method: 'card', amount_cents: 25_000, tip_cents: 0, paid_at: '2026-09-01T15:00:00Z', created_at: '2026-09-01T15:00:00Z' },
    ],
    bookings: [
      { id: 'b1', booking_ref: 'HH-PTY-AAA11', contact_name: 'Sample Client', child_name: 'Sam', party_date: '2026-12-12', party_type: 'in_studio_theme', status: 'approved', total_cents: 100_000 },
      { id: 'b2', booking_ref: 'HH-PTY-BBB22', contact_name: 'Other Client', child_name: null, party_date: '2026-09-20', party_type: 'mobile_party', status: 'cancelled', total_cents: 40_000 },
    ],
    event_tickets: [
      { id: 't1', event_id: 'e1', customer_name: 'Ticket Buyer', total_cents: 5_000, refund_amount_cents: 0, status: 'confirmed', notes: 'Venmo 50.00 from Ticket Buyer', stripe_payment_intent_id: null, stripe_session_id: null, created_at: '2026-11-02T12:00:00Z' },
      { id: 't2', event_id: 'e1', customer_name: 'Card Buyer', total_cents: 2_500, refund_amount_cents: 2_500, status: 'refunded', notes: null, stripe_payment_intent_id: 'pi_x', stripe_session_id: null, created_at: '2026-11-03T12:00:00Z' },
    ],
    events: [{ id: 'e1', title: 'Bitchy Bingo', event_date: '2026-11-20' }],
  }
  // The same table is read twice (the listed rows, then every payment of those bookings), so both answer from `booking_payments`.
  const db = fakeDb(tables)

  it('lists newest first with signed amounts, person, what for and the booking\'s own balance', async () => {
    const r = await loadPayments(db)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.rows.map(x => x.id)).toEqual(['bp-p3', 'et-t2', 'et-t2-refund', 'et-t1', 'bp-p2', 'bp-p1'])
    const final = r.rows.find(x => x.id === 'bp-p3')!
    expect(final).toMatchObject({ method: 'venmo', type: 'final', amountCents: 50_000, person: 'Sample Client', what: "Sam's Party", bookingRef: 'HH-PTY-AAA11', totalCents: 100_000 })
    // 25,000 + 50,000 paid against 100,000: 25,000 still owed, whichever row you are looking at.
    expect(final.balanceCents).toBe(25_000)
    expect(final.paidInFull).toBe(false)
    expect(r.rows.find(x => x.id === 'bp-p2')).toMatchObject({ method: 'card', tipCents: 1_000, balanceCents: 25_000 })
    // A refund is negative, and it raises what is owed.
    const refund = r.rows.find(x => x.id === 'bp-p1')!
    expect(refund).toMatchObject({ amountCents: -25_000, what: 'HH-PTY-BBB22', bookingStatus: 'cancelled' })
  })

  it('events: method from the note or Stripe, no booking balance, a refund as its own negative row', async () => {
    const r = await loadPayments(db)
    if (!r.ok) throw new Error('expected ok')
    expect(r.rows.find(x => x.id === 'et-t1')).toMatchObject({ kind: 'event', method: 'venmo', what: 'Bitchy Bingo', bookingId: null, balanceCents: null })
    expect(r.rows.find(x => x.id === 'et-t2')).toMatchObject({ method: 'card', refunded: true, amountCents: 2_500 })
    expect(r.rows.find(x => x.id === 'et-t2-refund')).toMatchObject({ type: 'refund', amountCents: -2_500 })
    // The ticket's note (which can name a person) never leaves the server.
    expect(JSON.stringify(r.rows)).not.toContain('from Ticket Buyer')
  })

  it('a failed read is an error, never an empty list', async () => {
    for (const t of ['booking_payments', 'bookings', 'event_tickets', 'events']) {
      expect((await loadPayments(fakeDb(tables, t))).ok).toBe(false)
    }
  })
})

describe('the Gmail link', () => {
  it('opens a compose window to one plain address from the studio mailbox', () => {
    const u = new URL(gmailComposeUrl('client@example.com', 'studio@example.com')!)
    expect(u.origin + u.pathname).toBe('https://mail.google.com/mail/')
    expect(u.searchParams.get('to')).toBe('client@example.com')
    expect(u.searchParams.get('view')).toBe('cm')
    expect(u.searchParams.get('authuser')).toBe('studio@example.com')
  })

  it('refuses anything that is not one address, so no second recipient or parameter can ride along', () => {
    for (const bad of ['a@b.co,c@d.co', 'a@b.co&bcc=x@y.zz', 'a b@c.co', 'x@y', '', 'a@b.co;c@d.co', '<a@b.co>', 'a@b.co\nbcc:x@y.zz']) {
      expect(gmailComposeUrl(bad, 'studio@example.com')).toBeNull()
    }
  })
})

describe('the contact-link route', () => {
  const ID = 'aaaaaaaa-0000-4000-8000-000000000001'
  const asAdmin = (q: string) => new NextRequest(`http://localhost/api/admin/crew-app/contact-link?${q}`, { headers: { authorization: 'Bearer pw-for-tests' } })
  beforeAll(() => {
    process.env.ADMIN_PASSWORD = 'pw-for-tests'
  })
  beforeEach(() => {
    mockFindQuo.mockReset()
    mockBooking.mockReset().mockResolvedValue({ data: { contact_phone: '6315550100', contact_email: 'client@example.com' }, error: null })
  })

  it('refuses a stranger, a bad id and a bad kind', async () => {
    expect((await contactGet(new NextRequest(`http://localhost/x?booking=${ID}&kind=quo`))).status).toBe(401)
    expect((await contactGet(asAdmin(`booking=nope&kind=quo`))).status).toBe(400)
    expect((await contactGet(asAdmin(`booking=${ID}&kind=sms`))).status).toBe(400)
  })

  it('quo: the number comes from the booking, never the request; a thread, the inbox, or a plain reason', async () => {
    mockFindQuo.mockResolvedValue({ kind: 'thread', url: 'https://my.quo.com/inbox/PN1/c/CN1' })
    const r = await contactGet(asAdmin(`booking=${ID}&kind=quo&phone=9999999999`))
    expect(await r.json()).toMatchObject({ url: 'https://my.quo.com/inbox/PN1/c/CN1' })
    expect(mockFindQuo).toHaveBeenCalledWith('6315550100')
    mockFindQuo.mockResolvedValue({ kind: 'inbox', url: 'https://my.quo.com/inbox/PN1' })
    expect(((await (await contactGet(asAdmin(`booking=${ID}&kind=quo`))).json()) as { note: string }).note).toMatch(/No conversation/)
    mockFindQuo.mockResolvedValue({ kind: 'unavailable', reason: 'Quo answered 500.' })
    expect((await contactGet(asAdmin(`booking=${ID}&kind=quo`))).status).toBe(502)
    mockFindQuo.mockResolvedValue({ kind: 'unconfigured' })
    expect((await contactGet(asAdmin(`booking=${ID}&kind=quo`))).status).toBe(503)
    mockBooking.mockResolvedValue({ data: { contact_phone: null, contact_email: null }, error: null })
    expect((await contactGet(asAdmin(`booking=${ID}&kind=quo`))).status).toBe(422)
    expect((await contactGet(asAdmin(`booking=${ID}&kind=gmail`))).status).toBe(422)
  })

  it('gmail: a compose link to the booking\'s address', async () => {
    const j = (await (await contactGet(asAdmin(`booking=${ID}&kind=gmail&email=evil@example.com`))).json()) as { url: string }
    expect(new URL(j.url).searchParams.get('to')).toBe('client@example.com')
  })

  it('opens something; it never sends', () => {
    const src = read('app/api/admin/crew-app/contact-link/route.ts') + read('lib/gmailCompose.ts') + read('app/admin/crew/_components/ContactButtons.tsx')
    expect(src).not.toMatch(/sendSms|sendEmail|sendQuo|\/messages['"`]/)
    expect(src.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
    expect(read('app/api/admin/crew-app/contact-link/route.ts')).toMatch(/export async function GET\([^)]*\) \{\s*if \(!isAdminAuthorized\(req\)\) return unauthorizedResponse\(\)/)
  })

  it('the payments route is admin only', async () => {
    expect((await paymentsGet(new NextRequest('http://localhost/api/admin/crew-app/payments'))).status).toBe(401)
  })
})

describe('findQuoLink', () => {
  const real = jest.requireActual('@/lib/quo') as typeof import('@/lib/quo')
  const pages: Array<{ data: Array<Record<string, unknown>>; nextCursor?: string }> = []
  let calls: string[] = []
  beforeEach(() => {
    process.env.QUO_API_KEY = 'k'
    process.env.QUO_PHONE_NUMBER = 'PNstudio'
    calls = []
    pages.length = 0
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async (u: string) => {
      calls.push(String(u))
      const after = new URL(String(u)).searchParams.get('after')
      const page = pages[after ? Number(after) : 0]
      return { status: 200, ok: true, json: async () => page }
    })
  })

  it('finds the thread by re-comparing participants (the API ignores the filter), across pages, skipping deleted ones', async () => {
    pages.push(
      { data: [{ id: 'CN1', participants: ['+16315559999'] }], nextCursor: '1' },
      { data: [{ id: 'CNgone', participants: ['+16315550100'], deletedAt: '2026-01-01' }, { id: 'CN2', participants: ['+16315550100'] }] },
    )
    expect(await real.findQuoLink('(631) 555-0100')).toEqual({ kind: 'thread', url: 'https://my.quo.com/inbox/PNstudio/c/CN2' })
    expect(calls).toHaveLength(2)
    expect(calls.every(c => c.startsWith('https://api.quo.com/conversations?'))).toBe(true)
  })

  it('no conversation yet falls back to the inbox; no key is "unconfigured"; a bad number is refused', async () => {
    pages.push({ data: [{ id: 'CN1', participants: ['+16315559999'] }] })
    expect(await real.findQuoLink('6315550100')).toEqual({ kind: 'inbox', url: 'https://my.quo.com/inbox/PNstudio' })
    expect(await real.findQuoLink('abc')).toMatchObject({ kind: 'unavailable' })
    delete process.env.QUO_API_KEY
    expect(await real.findQuoLink('6315550100')).toEqual({ kind: 'unconfigured' })
  })

  it('an unreadable page is "unavailable", never "no conversation"', async () => {
    ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ status: 500, ok: false, json: async () => ({}) }))
    expect(await real.findQuoLink('6315550100')).toMatchObject({ kind: 'unavailable' })
  })
})

describe('the screens', () => {
  it('the $ is in the top bar, before the hamburger, and Payments is its own section', () => {
    expect(sectionOf('/admin/crew/payments')).toBe('payments')
    const bar = read('app/admin/crew/_components/CrewAdminBar.tsx')
    expect(bar).toMatch(/href="\/admin\/crew\/payments"[\s\S]{0,200}aria-label="Payments"/)
    expect(bar.indexOf('aria-label="Payments"')).toBeLessThan(bar.indexOf('aria-label="Menu"'))
  })

  it('Text in Quo and Email in Gmail are on the open Lead and Booking tiles', () => {
    expect(read('app/admin/crew/leads/page.tsx')).toMatch(/<ContactButtons bookingId=\{lead\.id\} phone=\{lead\.phone\} email=\{lead\.email\} \/>/)
    expect(read('app/admin/crew/_components/BookingTile.tsx')).toMatch(/<ContactButtons bookingId=\{tile\.id\}/)
    const c = read('app/admin/crew/_components/ContactButtons.tsx')
    expect(c).toContain('Text in Quo')
    expect(c).toContain('Email in Gmail')
  })

  it('each payment links to its booking, which opens even when it is outside the three months', () => {
    expect(read('app/admin/crew/payments/page.tsx')).toMatch(/href=\{`\/admin\/crew\/bookings\?party=\$\{p\.bookingId\}`\}/)
    const page = read('app/admin/crew/bookings/page.tsx')
    expect(page).toMatch(/crew-app\/bookings\?include=/)
    expect(page).toContain('Opened from a link')
  })

  it('the roster shows Allie only with the removed members', () => {
    expect(read('app/admin/crew/members/page.tsx')).toMatch(/showRemoved \|\| \(m\.status !== 'removed' && !m\.isOwner\)/)
  })
})
