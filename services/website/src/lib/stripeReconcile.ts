/**
 * Does Stripe agree with the books?
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The webhook was subscribed to one of the four events it had branches for from
 * 2026-03-05 until 2026-09-12. In that window **$3,596.50** of real card
 * payments were taken, recorded in `booking_payments` by the browser coming
 * back, and written to `financial_transactions` — the table the admin Financials
 * tab reads, and therefore what this business believes about its own revenue —
 * never. Five customers got no receipt from us, no deposit blocked the calendar,
 * and no reminder was enqueued.
 *
 * It was found by a human auditing the surface six months later. Nothing was
 * watching, and hard-won rule 17 is exactly this: *"never ran" and "could not
 * have run" look identical from outside* unless something counts and says.
 *
 * ── The two questions it asks ───────────────────────────────────────────────
 *
 * **1. Is the endpoint still subscribed to everything the handler handles?**
 * This is the cheap one and it is the one that would have caught the incident.
 * The subscription lives at Stripe; the branches live in git; nothing compared
 * them, and nothing could have. `EXPECTED_WEBHOOK_EVENTS` is the git half.
 *
 * **2. Is there money at Stripe that is not in the books?**
 *
 * Deliberately a TOTAL comparison, not a per-payment one. Measured on the live
 * ledger, a Stripe reference is one of at least four shapes —
 * `stripe-pb-<ref>-final-<pi>`, `stripe-cs_live_…`, `stripe-tk-HH-EVT-10017`,
 * `stripe-tk-CART-1789949196313` — and only some carry a Stripe object id at
 * all. Matching per-object would report every ticket row as missing.
 *
 * Matching on amount + date instead was considered and rejected: link 18
 * measured that heuristic against the four re-typed admin deposits and it
 * matched TWO rows for two of them, because $99 is the default deposit and
 * several land in the same week. **A heuristic that is right by coincidence is
 * not a reconciliation.**
 *
 * So the check is one-directional and blunt, which is what makes it trustworthy:
 * sum what Stripe says succeeded, sum what the books recorded, and alert when
 * the books are SHORT. A surplus is reported but not alerted on — it is a
 * different bug (a double-count, or a payment recorded on a boundary day) and it
 * does not mean money is missing.
 */

/** A day's worth of either side, for the per-day breakdown in the report. */
export type DailyTotal = { day: string; cents: number }

export type SubscriptionDrift = {
  ok: boolean
  /** Subscribed at Stripe but the handler has no branch — noise, and a hint someone edited by hand. */
  extra: string[]
  /** The handler has a branch and Stripe is NOT sending it. This is the $3,596.50 shape. */
  missing: string[]
}

/**
 * Compare the live endpoint's `enabled_events` against the events the handler
 * has branches for.
 *
 * `missing` is the dangerous direction and the only one that fails `ok`. An
 * `extra` event costs nothing but a 200 — the handler falls through to its final
 * `{received: true}` — so it is reported for a human, not alerted on.
 */
export function compareSubscription(
  expected: readonly string[],
  enabledEvents: readonly string[],
): SubscriptionDrift {
  // A wildcard subscription genuinely covers everything; treating it as
  // "missing all 8" would cry wolf forever.
  if (enabledEvents.includes('*')) return { ok: true, extra: [], missing: [] }

  const live = new Set(enabledEvents)
  const want = new Set(expected)
  const missing = expected.filter(e => !live.has(e))
  const extra = enabledEvents.filter(e => !want.has(e))
  return { ok: missing.length === 0, extra, missing }
}

export type TotalsVerdict = {
  ok: boolean
  stripeCents: number
  booksCents: number
  /** Positive = the books are SHORT by this much. Negative = surplus. */
  shortfallCents: number
}

/**
 * Sum both sides and say whether the books are short.
 *
 * `toleranceCents` exists for the boundary case, not for sloppiness: a payment
 * that succeeds at 23:59 UTC can be written to the ledger with the next day's
 * date if the webhook is redelivered, so a window's edges can legitimately
 * disagree by one payment. It defaults to 0 — the caller widens the ledger
 * window instead, which is the honest fix — and is here so a future caller with
 * a real reason can say so out loud.
 */
export function compareTotals(stripeCents: number, booksCents: number, toleranceCents = 0): TotalsVerdict {
  const shortfallCents = stripeCents - booksCents
  return {
    ok: shortfallCents <= toleranceCents,
    stripeCents,
    booksCents,
    shortfallCents,
  }
}

/** Group amounts by UTC day, for the report body. */
export function byUtcDay(items: Array<{ epochSeconds: number; cents: number }>): DailyTotal[] {
  const acc = new Map<string, number>()
  for (const it of items) {
    const day = new Date(it.epochSeconds * 1000).toISOString().split('T')[0]
    acc.set(day, (acc.get(day) ?? 0) + it.cents)
  }
  const out: DailyTotal[] = []
  acc.forEach((cents, day) => out.push({ day, cents }))
  return out.sort((a, b) => a.day.localeCompare(b.day))
}

/**
 * `YYYY-MM-DD`, `days` before `now`, in UTC.
 *
 * UTC on both sides deliberately: the box runs UTC, `financial_transactions.date`
 * is written from `toISOString()`, and Stripe's timestamps are epoch. Link 20
 * found `setHours()` scheduling every reminder 4–5 hours early for precisely the
 * mismatch this avoids.
 */
export function utcDaysAgo(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().split('T')[0]
}
