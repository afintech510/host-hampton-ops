/**
 * The offline ticket writer, against the fake that refuses what Postgres
 * refuses.
 *
 * What is being guarded here is the thing that made this file necessary: a
 * manual ticket writer that does three of the four jobs. Each test below is one
 * half that has gone missing in production at least once — the books row, the
 * inventory decrement, the duplicate guard, the honest report of a step that
 * did not happen.
 */

import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'
import { issueOfflineTickets, seatTotalCents } from '@/lib/offlineTicket'

const EVENT_ID = 'evt-squishy'

function db(available = 20) {
  return makeFakeMoneyDb({
    events: [
      {
        id: EVENT_ID,
        title: 'Make Your Own Squishy',
        event_date: '2026-09-25',
        event_time: '6:00 PM',
        location: '295 Montauk Highway, Suite 7, Speonk, NY 11972',
        available_tickets: available,
        max_tickets: 20,
      },
    ],
  })
}

const SEATS = [
  { variantLabel: 'First Child', unitPriceCents: 4500, quantity: 1 },
  { variantLabel: 'SIbling', unitPriceCents: 3500, quantity: 1 },
]

const input = (over: Record<string, unknown> = {}) => ({
  eventId: EVENT_ID,
  customerName: 'Kait Dwyer',
  customerEmail: 'kait.gula@gmail.com',
  customerPhone: '6313107585',
  seats: SEATS,
  method: 'venmo' as const,
  paidOn: '2026-09-15',
  groupRef: 'VENMO-abc123',
  ...over,
})

beforeEach(() => {
  delete process.env.RESEND_API_KEY
})

describe('issueOfflineTickets', () => {
  it('does all four jobs: roster, books, inventory, and says so', async () => {
    const d = db()
    const res = await issueOfflineTickets(d.client as never, input())

    expect(res.ok).toBe(true)
    expect(res.ticketRefs).toHaveLength(2)
    expect(res.steps.tickets).toBe('written')
    expect(res.steps.books).toBe('written')
    expect(res.steps.inventory).toBe('decremented')
    expect(res.remaining).toBe(18)

    const tickets = d.rows('event_tickets')
    expect(tickets).toHaveLength(2)
    // One row per seat, each with its own price — not two seats on one row at
    // the wrong unit price, which is how $80 became "2 × $45" in the books.
    expect(tickets.map(t => t.total_cents).sort()).toEqual([3500, 4500])
    expect(tickets.every(t => t.group_ref === 'VENMO-abc123')).toBe(true)
    expect(tickets.every(t => t.status === 'confirmed')).toBe(true)

    const books = d.rows('financial_transactions')
    expect(books).toHaveLength(1)
    expect(books[0].amount_cents).toBe(8000)
    expect(books[0].date).toBe('2026-09-15') // the day the money arrived, not today
    expect(books[0].category).toBe('Event Ticket')
    // `source` is a CHECK: hand-entered money is `cash`, and the real method is
    // spelled out rather than silently claimed to be dollar bills.
    expect(books[0].source).toBe('cash')
    expect(String(books[0].description)).toContain('Venmo')
    expect(String(books[0].reference)).toBe('venmo-tk-VENMO-abc123')
  })

  it('is idempotent on the group ref — the same Venmo twice is one set of seats', async () => {
    const d = db()
    const first = await issueOfflineTickets(d.client as never, input())
    const second = await issueOfflineTickets(d.client as never, input())

    expect(second.ok).toBe(true)
    expect(second.steps.tickets).toBe('already_present')
    expect(second.ticketRefs).toEqual(first.ticketRefs)
    expect(d.rows('event_tickets')).toHaveLength(2)
    expect(d.rows('financial_transactions')).toHaveLength(1)
    // And the second call must not take two more seats out of stock.
    expect(d.rows('events')[0].available_tickets).toBe(18)
  })

  it('refuses to guess when the tickets table cannot be read', async () => {
    const d = db()
    d.breakReadsOn('event_tickets')
    const res = await issueOfflineTickets(d.client as never, input())
    // "Could not read" is not "no rows" — proceeding is how one payment becomes
    // two sets of tickets.
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/could not check for existing tickets/i)
    expect(d.rows('event_tickets')).toHaveLength(0)
  })

  it('issues the seats and SAYS OVERSOLD when stock will not cover them', async () => {
    const d = db(1)
    const res = await issueOfflineTickets(d.client as never, input())
    // The customer paid; the seats are real. What must not happen is silence.
    expect(res.ok).toBe(true)
    expect(res.ticketRefs).toHaveLength(2)
    expect(res.steps.inventory).toBe('oversold')
    expect(res.remaining).toBeUndefined()
    expect(d.rows('events')[0].available_tickets).toBe(1)
  })

  it('treats a books row that is already there as a duplicate, not a second payment', async () => {
    const d = db()
    // `idx_fin_txn_source_ref` is UNIQUE on (source, reference), so a ledger row
    // already carrying this payment's reference makes the insert refuse. That is
    // the retry guard doing its job — the money is in the books exactly once —
    // and the caller is told which of the two happened rather than "written".
    d.rows('financial_transactions').push({
      id: 'ft-existing',
      date: '2026-09-15',
      description: 'already here',
      amount_cents: 8000,
      source: 'cash',
      reference: 'venmo-tk-VENMO-abc123',
    })
    const res = await issueOfflineTickets(d.client as never, input())
    expect(res.ok).toBe(true)
    expect(res.steps.tickets).toBe('written')
    expect(res.steps.books).toBe('duplicate')
    expect(d.rows('event_tickets')).toHaveLength(2)
    expect(d.rows('financial_transactions')).toHaveLength(1)
  })

  it('refuses an event that does not exist, before writing anything', async () => {
    const d = db()
    const res = await issueOfflineTickets(d.client as never, input({ eventId: 'evt-nope' }))
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/does not exist/)
    expect(d.rows('event_tickets')).toHaveLength(0)
  })

  it('refuses an empty seat list', async () => {
    const d = db()
    const res = await issueOfflineTickets(d.client as never, input({ seats: [] }))
    expect(res.ok).toBe(false)
    expect(d.rows('event_tickets')).toHaveLength(0)
  })

  it('reports the email as not sent rather than pretending, with no Resend key', async () => {
    const d = db()
    const res = await issueOfflineTickets(d.client as never, input({ sendConfirmation: true }))
    expect(res.steps.email).toBe('unconfigured')
  })
})

describe('seatTotalCents', () => {
  it('is the money the customer actually sent', () => {
    expect(seatTotalCents(SEATS)).toBe(8000)
    expect(seatTotalCents([{ variantLabel: null, unitPriceCents: 2500, quantity: 3 }])).toBe(7500)
    expect(seatTotalCents([])).toBe(0)
  })
})
