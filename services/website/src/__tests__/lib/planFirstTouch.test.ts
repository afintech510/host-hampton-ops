/**
 * Tests for `linkFirstTouchEvent` in lib/plan.ts.
 *
 * `bookings.first_touch_event_id` was created by migration 035 and written by
 * nobody for a day: `ensureLeadPlan()` runs BEFORE `recordInboundEvent()` — it
 * must, or the dispatcher's booking sweep drafts every lead twice — so there is
 * no event id to insert at plan-creation time. This helper is the second write.
 *
 * The two properties that matter: it records the FIRST touch and therefore must
 * never overwrite, and it is provenance rather than the lead, so it must never
 * fail the route that called it.
 */

import { linkFirstTouchEvent } from '@/lib/plan'

interface Opts {
  /** Rows the guarded UPDATE reports as changed. */
  updated?: { id: string }[]
  error?: { message: string } | null
  throws?: boolean
}

function makeSupabase(opts: Opts = {}) {
  const calls: { patch?: Record<string, unknown>; ops: [string, ...unknown[]][] }[] = []

  const from = jest.fn(() => {
    if (opts.throws) throw new Error('connection reset')
    const ops: [string, ...unknown[]][] = []
    const record: { patch?: Record<string, unknown>; ops: [string, ...unknown[]][] } = { ops }
    calls.push(record)

    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve({
          data: opts.error ? null : (opts.updated ?? [{ id: 'bk-1' }]),
          error: opts.error ?? null,
        }).then(res, rej),
    }
    for (const m of ['eq', 'is', 'select']) {
      chain[m] = (...args: unknown[]) => {
        ops.push([m, ...args])
        return chain
      }
    }
    chain.update = (patch: Record<string, unknown>) => {
      record.patch = patch
      ops.push(['update', patch])
      return chain
    }
    return chain
  })

  return { supabase: { from } as never, calls }
}

describe('linkFirstTouchEvent', () => {
  it('stamps the event id on the plan', async () => {
    const { supabase, calls } = makeSupabase()

    const ok = await linkFirstTouchEvent('bk-1', 'ev-1', supabase)

    expect(ok).toBe(true)
    expect(calls[0].patch).toEqual({ first_touch_event_id: 'ev-1' })
    expect(calls[0].ops).toContainEqual(['eq', 'id', 'bk-1'])
  })

  it('guards the write on the column still being NULL', async () => {
    // This is what makes it fill-once. A returning lead reuses an open plan, and
    // overwriting would replace the first touch with today's — losing exactly
    // the fact the column exists to record. It also makes two concurrent calls
    // a no-op rather than a race.
    const { supabase, calls } = makeSupabase()

    await linkFirstTouchEvent('bk-1', 'ev-2', supabase)

    expect(calls[0].ops).toContainEqual(['is', 'first_touch_event_id', null])
  })

  it('reports false when the plan already had a first touch', async () => {
    // The guarded UPDATE matched no rows: already set, nothing to do.
    const { supabase } = makeSupabase({ updated: [] })

    expect(await linkFirstTouchEvent('bk-1', 'ev-2', supabase)).toBe(false)
  })

  it('does nothing at all without both ids', async () => {
    const { supabase, calls } = makeSupabase()

    // `recordInboundEvent` returns null on a dedupe or a failure, and
    // `ensureLeadPlan` returns a null bookingId when it declined to write.
    expect(await linkFirstTouchEvent(null, 'ev-1', supabase)).toBe(false)
    expect(await linkFirstTouchEvent('bk-1', null, supabase)).toBe(false)
    expect(await linkFirstTouchEvent(undefined, undefined, supabase)).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('swallows a DB error rather than failing the route', async () => {
    const { supabase } = makeSupabase({ error: { message: 'column does not exist' } })

    // Provenance is not the lead. A form submission that succeeded must not
    // fail because a bookkeeping column did not get set.
    await expect(linkFirstTouchEvent('bk-1', 'ev-1', supabase)).resolves.toBe(false)
  })

  it('swallows a thrown client error too', async () => {
    const { supabase } = makeSupabase({ throws: true })

    await expect(linkFirstTouchEvent('bk-1', 'ev-1', supabase)).resolves.toBe(false)
  })
})
