/**
 * `ensureEviteNonFatal` - the ONE call every intake route makes to give a booking an invitation
 * (spec §2.1).
 *
 *   await ensureEviteNonFatal(supabase, bookingId)
 *
 * It calls `ensureEviteForBooking`, fires `queueRender` when a row was CREATED, and swallows
 * everything else. It returns nothing on purpose: an intake route has no business branching on the
 * result, and a function that returns an outcome invites the one branch that must never exist
 * ("the evite failed, so answer differently"). The IntakeRecord rule (AGENTS.md §11) is that an
 * invitation problem never changes an intake's HTTP answer, and this is where that is made true:
 *
 *   - ensure throws                 -> logged, swallowed
 *   - ensure returns `unavailable`  -> logged, swallowed
 *   - queueRender throws            -> logged, swallowed
 *   - Supabase hangs                -> the caller waits at most `ENSURE_TIMEOUT_MS`, then carries on
 *                                      (the work keeps running in the background; the cron backfill is
 *                                      the safety net for anything that never finished)
 *   - the flag is off               -> `ensureEviteForBooking` answers `disabled` before any read
 *
 * WHERE TO CALL IT. After the booking write AND after `recordInboundEvent` (lib/plan.ts L16-26: the
 * dispatcher's sweep must see the draft before anything else touches the plan), and with the booking
 * id the route already holds. A null/empty id (the plan could not be created) is a quiet no-op.
 *
 * Nothing here logs an address, a name or a ref: only the outcome kind and a generic reason.
 */

import type { getSupabase } from '@/lib/supabase'
import { ensureEviteForBooking } from '@/lib/evites/ensure'

type Supa = ReturnType<typeof getSupabase>

/** The longest an intake response waits for the invitation to be set up. */
export const ENSURE_TIMEOUT_MS = 4000

async function work(supabase: Supa, bookingId: string): Promise<void> {
  const out = await ensureEviteForBooking(supabase, bookingId)
  if (out.kind === 'created') {
    // Loaded on demand: render.ts pulls in satori, sharp and the canvas, and an intake route that
    // never creates an invitation (the flag is off, the booking is a studio rental) must not pay
    // for that at module load.
    const { queueRender } = await import('@/lib/evites/render')
    queueRender(out.eviteId)
    return
  }
  if (out.kind === 'unavailable') {
    console.warn(`evites/intake: ensure unavailable: ${out.reason}`)
  }
}

export async function ensureEviteNonFatal(supabase: Supa, bookingId: string | null | undefined): Promise<void> {
  if (typeof bookingId !== 'string' || bookingId === '') return
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const running = work(supabase, bookingId).catch((e: unknown) => {
      console.error(`evites/intake: ensure threw: ${e instanceof Error ? e.message : String(e)}`)
    })
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, ENSURE_TIMEOUT_MS)
      // Never keep the process alive for this.
      ;(timer as { unref?: () => void }).unref?.()
    })
    await Promise.race([running, timeout])
  } catch (e) {
    console.error(`evites/intake: ensure failed: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
