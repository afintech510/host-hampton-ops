import { inviteState, type InviteStateFlags } from '@/lib/evites/state'

const NOW = new Date('2026-10-10T16:00:00Z')
const ON: InviteStateFlags = { pagesMode: 'on', isPilot: false }

const booking = (over: Record<string, unknown> = {}) => ({
  status: 'awaiting_deposit',
  party_type: 'in_studio_theme',
  party_date: '2026-11-14', // Saturday, 14:00-16:00 EST = 19:00Z-21:00Z
  party_time: '14:00',
  package_type: 'Glow Party',
  party_tags: { location_type: 'host_hampton' },
  quote_snapshot: null,
  ...over,
})

const deposit = { amount_cents: 25000, payment_type: 'deposit' }
const partial = { amount_cents: 25000, payment_type: 'partial' }
const refund = { amount_cents: 25000, payment_type: 'refund' }
const state = (b = booking(), payments: Array<{ amount_cents: number; payment_type: string }> = [], evite = {}, now = NOW, flags = ON) =>
  inviteState(b, payments, evite, now, flags)

describe('evites/state - one case per writer of a deposit', () => {
  it('Payment Element: pending_review + a booking_payments row is live', () => {
    expect(state(booking({ status: 'pending_review' }), [deposit])).toBe('live')
  })

  it('plan pay link: deposit_paid + a payment row is live', () => {
    expect(state(booking({ status: 'deposit_paid' }), [deposit])).toBe('live')
  })

  it('admin cash on awaiting_deposit (typed "partial") is live: money landed', () => {
    expect(state(booking({ status: 'awaiting_deposit' }), [partial])).toBe('live')
  })

  it('admin "confirmed" with no payment row is live (legacy status that only a booked party carries)', () => {
    expect(state(booking({ status: 'confirmed' }), [])).toBe('live')
  })
})

describe('evites/state - not booked', () => {
  it.each([['lead'], ['awaiting_deposit'], ['quoted'], ['approved'], ['pending_review']])('%s with no money is preview', (status) => {
    expect(state(booking({ status }), [])).toBe('preview')
  })

  it('an admin refund row bringing net to 0 on awaiting_deposit leaves the booked stage: preview, not unavailable', () => {
    expect(state(booking({ status: 'awaiting_deposit' }), [deposit, refund])).toBe('preview')
  })

  it('refunding more than was paid is still not booked', () => {
    expect(state(booking({ status: 'awaiting_deposit' }), [deposit, refund, refund])).toBe('preview')
  })

  it('a part-refund that leaves money in hand is still booked', () => {
    expect(state(booking({ status: 'awaiting_deposit' }), [deposit, { amount_cents: 10000, payment_type: 'refund' }])).toBe('live')
  })
})

describe('evites/state - legacy statuses are pinned (Stripe refunds never touch booking_payments)', () => {
  it('deposit_paid with net 0 is STILL live', () => {
    expect(state(booking({ status: 'deposit_paid' }), [deposit, refund])).toBe('live')
    expect(state(booking({ status: 'deposit_paid' }), [])).toBe('live')
  })

  it.each([['confirmed'], ['paid_in_full'], ['modifications_locked']])('%s with no money is live', (status) => {
    expect(state(booking({ status }), [])).toBe('live')
  })
})

describe('evites/state - unavailable', () => {
  it.each([['cancelled'], ['lost']])('status %s is unavailable even with money on it', (status) => {
    expect(state(booking({ status }), [deposit])).toBe('unavailable')
  })

  it('archived_at is unavailable, whatever the booking says', () => {
    expect(state(booking({ status: 'paid_in_full' }), [deposit], { archived_at: '2026-10-01T00:00:00Z' })).toBe('unavailable')
    expect(state(booking({ status: 'lead' }), [], { archived_at: '2026-10-01T00:00:00Z' })).toBe('unavailable')
  })

  it('a null archived_at is not archived', () => {
    expect(state(booking({ status: 'confirmed' }), [], { archived_at: null })).toBe('live')
  })
})

describe('evites/state - closed, live, needs_time', () => {
  it('live up to the end instant, closed after it (end = 21:00Z)', () => {
    expect(state(booking({ status: 'confirmed' }), [], {}, new Date('2026-11-14T20:59:59Z'))).toBe('live')
    expect(state(booking({ status: 'confirmed' }), [], {}, new Date('2026-11-14T21:00:00Z'))).toBe('live') // now > end, not >=
    expect(state(booking({ status: 'confirmed' }), [], {}, new Date('2026-11-14T21:00:01Z'))).toBe('closed')
  })

  it('live from the moment it is booked, long before the date', () => {
    expect(state(booking({ status: 'confirmed' }), [], {}, new Date('2026-10-10T16:00:00Z'))).toBe('live')
  })

  it('a booked party whose time is "Evening" is needs_time', () => {
    expect(state(booking({ status: 'confirmed', party_time: 'Evening' }), [])).toBe('needs_time')
  })

  it.each([['TBD'], ['2:00'], [null], ['23:00']])('a booked party with time %j is needs_time', (t) => {
    expect(state(booking({ status: 'confirmed', party_time: t }), [])).toBe('needs_time')
  })

  it('a booked party with no date at all is needs_time', () => {
    expect(state(booking({ status: 'confirmed', party_date: null }), [])).toBe('needs_time')
  })

  it('an UNbooked party with no time is preview, not needs_time', () => {
    expect(state(booking({ status: 'awaiting_deposit', party_time: 'TBD' }), [])).toBe('preview')
  })

  it('a booked party whose DATE has passed and whose time never parsed is closed (spec gap, see state.ts)', () => {
    expect(state(booking({ status: 'confirmed', party_time: 'TBD', party_date: '2026-09-01' }), [])).toBe('closed')
  })

  it('"closed" uses the Eastern calendar: 23:30 ET on the party day with a 2 PM start is closed, not completed-yet-timeless', () => {
    // 2026-11-15T04:30Z is 23:30 EST on Nov 14
    expect(state(booking({ status: 'confirmed' }), [], {}, new Date('2026-11-15T04:30:00Z'))).toBe('closed')
  })
})

describe('evites/state - flags', () => {
  it('pages off is disabled for everything, including a cancelled and an archived invite', () => {
    const off: InviteStateFlags = { pagesMode: 'off', isPilot: true }
    expect(state(booking({ status: 'confirmed' }), [], {}, NOW, off)).toBe('disabled')
    expect(state(booking({ status: 'cancelled' }), [], {}, NOW, off)).toBe('disabled')
    expect(state(booking({ status: 'confirmed' }), [], { archived_at: '2026-10-01T00:00:00Z' }, NOW, off)).toBe('disabled')
  })

  it('pilot: a non-pilot booking is disabled, a pilot booking follows the normal states', () => {
    expect(state(booking({ status: 'confirmed' }), [], {}, NOW, { pagesMode: 'pilot', isPilot: false })).toBe('disabled')
    expect(state(booking({ status: 'confirmed' }), [], {}, NOW, { pagesMode: 'pilot', isPilot: true })).toBe('live')
    expect(state(booking(), [], {}, NOW, { pagesMode: 'pilot', isPilot: true })).toBe('preview')
  })

  it('on ignores isPilot', () => {
    expect(state(booking({ status: 'confirmed' }), [], {}, NOW, { pagesMode: 'on', isPilot: false })).toBe('live')
  })
})
