/**
 * The side effect of admin `notify_cancelled` that is NOT part of the admin card
 * (spec §7.3, §9.1 `party_cancelled`).
 *
 *   notifyPartyCancelled(supabase, eviteId) -> { ok, queued, reason?, ... }
 *
 * P08 shipped a NO-OP default (`reason: 'not-built'`). P09 installs the real one,
 * `sendPartyCancelledNotices` (`inlineSends.ts`: claim in `evite_sends`, send, stamp
 * `cancelled_notice_at`), without touching the route. With `EVITES_SENDS` off it sends
 * nothing and says so (`reason: 'sends-off'`). Same pattern as `rsvpHooks`: a property
 * of one mutable object so a test can swap it.
 *
 * `notifyPartyCancelled` never throws: the admin gets an `{ok:false}` answer, not
 * a 500, when the hook blows up.
 */

import type { getSupabase } from '@/lib/supabase'
import { sendPartyCancelledNotices } from '@/lib/evites/inlineSends'

type Supa = ReturnType<typeof getSupabase>

export interface NotifyCancelledResult {
  ok: boolean
  /** True only when guests were actually queued / sent a cancellation. */
  queued: boolean
  reason?: string
  /** How many guest emails the real implementation sent or queued for retry (P09). */
  count?: number
  /** P09 detail, counts only: sent now, failed (queued for retry), stopped by a guardrail, already handled. */
  sent?: number
  failed?: number
  skipped?: number
  duplicate?: number
  /** True when this call recorded `evites.cancelled_notice_at`. */
  stamped?: boolean
  /** P09b: new ledger claims this call made (sent + failed + stopped by a guardrail; not duplicates). */
  claimed?: number
  /** P09b: the guest list was cut short by the caller's budget; the party is not yet stamped announced. */
  truncated?: boolean
}

export const adminHooks: {
  notifyPartyCancelled: (supabase: Supa, eviteId: string) => NotifyCancelledResult | Promise<NotifyCancelledResult>
} = {
  notifyPartyCancelled: (supabase, eviteId) => sendPartyCancelledNotices(supabase, eviteId),
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
