/**
 * The side effect of admin `notify_cancelled` that is NOT part of the admin card
 * (spec §7.3, §9.1 `party_cancelled`).
 *
 *   notifyPartyCancelled(supabase, eviteId) -> { ok, queued, reason?, ... }
 *
 * P08 ships a NO-OP default: it sends nothing and says so (`queued: false`,
 * `reason: 'not-built'`). P09 replaces `adminHooks.notifyPartyCancelled` with the
 * real claim-in-`evite_sends`-then-send, without touching the route. Same pattern
 * as `rsvpHooks`: a property of one mutable object so a test (or P09) can swap it.
 *
 * `notifyPartyCancelled` never throws: the admin gets an `{ok:false}` answer, not
 * a 500, when the hook blows up.
 */

import type { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

export interface NotifyCancelledResult {
  ok: boolean
  /** True only when guests were actually queued / sent a cancellation. */
  queued: boolean
  reason?: string
  /** How many guest emails the real implementation handled (P09). */
  count?: number
}

export const adminHooks: {
  notifyPartyCancelled: (supabase: Supa, eviteId: string) => NotifyCancelledResult | Promise<NotifyCancelledResult>
} = {
  notifyPartyCancelled: () => ({ ok: true, queued: false, reason: 'not-built' }),
}

export async function notifyPartyCancelled(supabase: Supa, eviteId: string): Promise<NotifyCancelledResult> {
  try {
    return await adminHooks.notifyPartyCancelled(supabase, eviteId)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`evites/adminHooks: notifyPartyCancelled failed for ${eviteId}: ${msg}`)
    return { ok: false, queued: false, reason: 'hook-failed' }
  }
}
