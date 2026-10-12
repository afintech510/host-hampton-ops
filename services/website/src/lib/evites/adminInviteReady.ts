/**
 * Admin "Send invitation email to parent" (`send_invite_ready` on the admin invitation route).
 *
 * Adam's ruling, 2026-10-11: booked clients are not mailed their invitation automatically; "allow it to be created but
 * not emailed unless we request". This is the request. It goes through the SAME `claimAndSend` the cron uses, so the
 * ledger's unique key still makes it once-per-invitation, and it bypasses ONE rule - the launch cutoff
 * `EVITES_AUTOSEND_SINCE` - and nothing else: the `EVITES_SENDS` flag, the pilot list, the live state, a fresh render,
 * the sendable-until window, the suppression list and a missing parent email all still apply (the verdict is the cron's
 * own, called with `ignoreCutoff`, and `claimAndSend` / `prepare` re-check the rest).
 */

import type { getSupabase } from '@/lib/supabase'
import { eviteSendsMode } from '@/lib/evites/config'
import { inviteReadyVerdict } from '@/lib/evites/cronDue'
import { claimAndSend } from '@/lib/evites/sendOne'
import { loadSendContext } from '@/lib/evites/sendContext'
import type { SendKey } from '@/lib/evites/sends'

type Supa = ReturnType<typeof getSupabase>

export type RequestedInviteReady =
  | { kind: 'sent' }
  /** A ledger row for this message already exists: nothing was sent now. `status` is that row's. */
  | { kind: 'already'; status: string }
  /** Refused before anything was claimed (HTTP 409). */
  | { kind: 'refused'; reason: string; message: string }
  /** The sender stopped it for a rule that holds (suppressed, no address ...). The row is a terminal skip. */
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; error: string }
  | { kind: 'absent' }
  | { kind: 'unavailable'; error: string }

const REFUSALS: Record<string, string> = {
  state: 'The invitation is not live yet (the booking needs its time and a deposit), so there is nothing to send.',
  'not-stamped': 'The invitation has not been marked live yet. The scheduled job does that within about 15 minutes; try again then.',
  'no-email': 'The booking has no usable parent email address.',
  'no-deadline': 'The party has no usable start time, so the send window cannot be worked out.',
  'too-late': 'The party is less than two days away, so the invitation email is no longer sent.',
  'render-stale': 'The invitation image is not up to date yet. Use Re-render, then try again.',
  'sends-off': 'Evite emails are switched off (EVITES_SENDS).',
  'not-pilot': 'Evite emails are in pilot mode and this booking is not a pilot booking.',
}

const refuse = (reason: string): RequestedInviteReady => ({ kind: 'refused', reason, message: REFUSALS[reason] ?? `Not sent: ${reason}` })

export async function sendInviteReadyOnRequest(supabase: Supa, eviteId: string, now: Date = new Date()): Promise<RequestedInviteReady> {
  const read = await loadSendContext(supabase, eviteId, null, now)
  if (read.kind === 'unavailable') return { kind: 'unavailable', error: read.error }
  if (read.kind === 'absent') return { kind: 'absent' }

  const verdict = inviteReadyVerdict(read.ctx, now, { ignoreCutoff: true })
  if (!verdict.ok) return refuse(verdict.reason)
  if (eviteSendsMode() === 'off') return refuse('sends-off')

  const key: SendKey = { evite_id: eviteId, rsvp_id: null, send_type: 'invite_ready', ref_version: 0 }
  const r = await claimAndSend(supabase, key, { now })
  switch (r.kind) {
    case 'sent':
      return { kind: 'sent' }
    case 'skipped':
      return { kind: 'skipped', reason: r.reason }
    case 'failed':
      return { kind: 'failed', error: r.error }
    case 'unavailable':
      return { kind: 'unavailable', error: r.error }
    case 'disabled':
      return refuse(r.reason)
    case 'duplicate': {
      const row = await supabase
        .from('evite_sends')
        .select('status')
        .eq('evite_id', eviteId)
        .eq('channel', 'email')
        .eq('send_type', 'invite_ready')
        .is('rsvp_id', null)
        .eq('ref_version', 0)
        .maybeSingle<{ status: string }>()
      return { kind: 'already', status: row.error || !row.data ? 'unknown' : row.data.status }
    }
  }
}
