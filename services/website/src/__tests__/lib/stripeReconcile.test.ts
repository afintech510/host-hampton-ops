/**
 * The watchman's arithmetic.
 *
 * The incident this guards is the six months the endpoint was subscribed to one
 * of four handled events while $3,596.50 of card payments reached the books
 * never. Both halves of the check are here: the subscription comparison that
 * would have caught it in a day, and the one-directional total that catches the
 * general case.
 */

import { compareSubscription, compareTotals, byUtcDay, utcDaysAgo } from '@/lib/stripeReconcile'
import { EXPECTED_WEBHOOK_EVENTS, AFTERMATH_EVENT_TYPES, SUCCESS_EVENT_TYPES } from '@/lib/stripeAftermath'

describe('compareSubscription', () => {
  it('reproduces the actual incident: one event subscribed, four handled', () => {
    const drift = compareSubscription(SUCCESS_EVENT_TYPES, ['checkout.session.completed'])
    expect(drift.ok).toBe(false)
    // The one that cost $3,596.50.
    expect(drift.missing).toContain('payment_intent.succeeded')
    expect(drift.missing).toHaveLength(3)
  })

  it('is clean when the endpoint carries exactly what the handler handles', () => {
    const drift = compareSubscription(EXPECTED_WEBHOOK_EVENTS, [...EXPECTED_WEBHOOK_EVENTS])
    expect(drift).toEqual({ ok: true, extra: [], missing: [] })
  })

  it('does not care about order', () => {
    const shuffled = [...EXPECTED_WEBHOOK_EVENTS].reverse()
    expect(compareSubscription(EXPECTED_WEBHOOK_EVENTS, shuffled).ok).toBe(true)
  })

  it('reports an EXTRA subscribed event without failing — it costs a 200, not money', () => {
    const drift = compareSubscription(EXPECTED_WEBHOOK_EVENTS, [...EXPECTED_WEBHOOK_EVENTS, 'invoice.paid'])
    expect(drift.ok).toBe(true)
    expect(drift.extra).toEqual(['invoice.paid'])
  })

  it('treats a wildcard subscription as covering everything, rather than crying wolf', () => {
    const drift = compareSubscription(EXPECTED_WEBHOOK_EVENTS, ['*'])
    expect(drift).toEqual({ ok: true, extra: [], missing: [] })
  })

  it('fails the moment a newly handled event is not subscribed', () => {
    // Exactly the state this surface was in before the refund branches shipped.
    const drift = compareSubscription(EXPECTED_WEBHOOK_EVENTS, [...SUCCESS_EVENT_TYPES])
    expect(drift.ok).toBe(false)
    expect(drift.missing.sort()).toEqual([...AFTERMATH_EVENT_TYPES].sort())
  })
})

describe('compareTotals', () => {
  it('flags the books being SHORT — the direction that means money is missing', () => {
    const v = compareTotals(359_650, 0)
    expect(v.ok).toBe(false)
    expect(v.shortfallCents).toBe(359_650)
  })

  it('is clean when they agree', () => {
    expect(compareTotals(110_027, 110_027).ok).toBe(true)
  })

  it('does NOT fail when the books are ahead — a surplus is a different bug', () => {
    const v = compareTotals(100_000, 105_000)
    expect(v.ok).toBe(true)
    expect(v.shortfallCents).toBe(-5_000)
  })

  it('honours an explicit tolerance and nothing more', () => {
    expect(compareTotals(100_100, 100_000, 100).ok).toBe(true)
    expect(compareTotals(100_101, 100_000, 100).ok).toBe(false)
  })
})

describe('byUtcDay', () => {
  it('groups and sorts by UTC day', () => {
    const jan2 = Date.UTC(2026, 0, 2, 12) / 1000
    const jan1 = Date.UTC(2026, 0, 1, 12) / 1000
    expect(byUtcDay([
      { epochSeconds: jan2, cents: 100 },
      { epochSeconds: jan1, cents: 200 },
      { epochSeconds: jan2, cents: 50 },
    ])).toEqual([
      { day: '2026-01-01', cents: 200 },
      { day: '2026-01-02', cents: 150 },
    ])
  })

  it('puts a 23:59 UTC payment on that day, not the next — the boundary the window widening exists for', () => {
    const lateOnJan1 = Date.UTC(2026, 0, 1, 23, 59, 30) / 1000
    expect(byUtcDay([{ epochSeconds: lateOnJan1, cents: 1 }])[0].day).toBe('2026-01-01')
  })
})

describe('utcDaysAgo', () => {
  const now = new Date('2026-09-21T02:06:54.000Z')

  it('counts back in UTC regardless of the box timezone', () => {
    expect(utcDaysAgo(7, now)).toBe('2026-09-14')
    expect(utcDaysAgo(0, now)).toBe('2026-09-21')
  })

  it('goes forward on a negative, which is how the ledger window reaches tomorrow', () => {
    expect(utcDaysAgo(-1, now)).toBe('2026-09-22')
  })
})
