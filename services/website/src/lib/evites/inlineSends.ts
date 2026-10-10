/**
 * The INLINE evite sends: the three hooks P06 and P08 left as no-ops (spec §7.5, §9.1).
 *
 *   sendOnRsvpCreated(ctx)                  after an RSVP POST:  `new_rsvp` -> parent, `rsvp_confirmed` -> guest
 *   sendOnRsvpChanged(ctx)                  after a material PATCH: `rsvp_changed` -> parent
 *   sendPartyCancelledNotices(supabase, id) admin `notify_cancelled`: `party_cancelled` -> each guest
 *
 * They are installed as the DEFAULTS of `rsvpHooks` and `adminHooks`, so the routes did not change.
 *
 * What they promise, and what they refuse to do:
 *   - NOTHING happens while `EVITES_SENDS` is `off`, and in `pilot` only for a pilot booking. The check
 *     is the first thing each does, before any database read in the `off` case.
 *   - They never throw and never change the HTTP answer that triggered them (`fireRsvpHook` does not
 *     await them and catches whatever escapes; each send here is also wrapped, so one failing email
 *     does not stop the next).
 *   - Every send is `claimAndSend`: claim in `evite_sends` first, so a double-clicked Save, a retried
 *     request or the cron racing the hook sends one email. A duplicate is skipped, quietly.
 *   - A send that cannot go right now (suppression unreadable, Resend down, no key) is finished
 *     `failed`, which `reclaimFailed` retries up to four attempts. That is the "claimable trace".
 *   - `rsvp_confirmed` is claimed only when the guest left a reminder email and has not opted out; a guest
 *     with no email leaves no ledger noise. A failed read of that row claims anyway and lets the sender
 *     decide, because "could not read" is not "no email".
 *   - The `ref_version` of a parent notice is the RSVP's `revision` AFTER the write, so the second change
 *     of the same RSVP is a different message from the first.
 *
 * `sendPartyCancelledNotices` stamps `evites.cancelled_notice_at` (only while it is NULL, read back) once
 * every eligible guest has a claim, sent or retriable. It is the "we have told the guests" marker the cron's
 * automatic notice looks at, so the admin button and the cron cannot both announce.
 *
 * Nothing here logs an address or a name.
 */

import { getSupabase } from '@/lib/supabase'
import { eviteSendsMode } from '@/lib/evites/config'
import { claimAndSend, type ClaimAndSendResult } from '@/lib/evites/sendOne'
import { readSendGate } from '@/lib/evites/sendContext'
import type { RsvpHookContext } from '@/lib/evites/rsvpHooks'
import type { NotifyCancelledResult } from '@/lib/evites/adminHooks'
import type { EviteSendType } from '@/lib/evites/types'

type Supa = ReturnType<typeof getSupabase>

function note(type: EviteSendType, r: ClaimAndSendResult): void {
  if (r.kind === 'sent' || r.kind === 'duplicate' || r.kind === 'disabled') return
  const detail = r.kind === 'skipped' ? r.reason : r.kind === 'failed' ? r.error : r.error
  console.warn(`evites/inline: ${type} ${r.kind}: ${detail}`)
}

async function attempt(supabase: Supa, type: EviteSendType, eviteId: string, rsvpId: string, refVersion: number): Promise<void> {
  try {
    note(type, await claimAndSend(supabase, { evite_id: eviteId, rsvp_id: rsvpId, send_type: type, ref_version: refVersion }))
  } catch (e) {
    console.error(`evites/inline: ${type} threw: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export async function sendOnRsvpCreated(ctx: RsvpHookContext): Promise<void> {
  if (eviteSendsMode() === 'off') return
  const supabase = getSupabase()

  await attempt(supabase, 'new_rsvp', ctx.eviteId, ctx.rsvpId, ctx.revision)

  if (ctx.status !== 'yes') return
  const row = await supabase
    .from('evite_rsvps')
    .select('reminder_email, reminder_opt_out_at')
    .eq('id', ctx.rsvpId)
    .eq('evite_id', ctx.eviteId)
    .maybeSingle<{ reminder_email: string | null; reminder_opt_out_at: string | null }>()
  // A good read that says "no address" (or "opted out") means there is nobody to confirm to.
  if (!row.error && (!row.data || !row.data.reminder_email || row.data.reminder_opt_out_at)) return
  await attempt(supabase, 'rsvp_confirmed', ctx.eviteId, ctx.rsvpId, 0)
}

export async function sendOnRsvpChanged(ctx: RsvpHookContext): Promise<void> {
  if (eviteSendsMode() === 'off') return
  await attempt(getSupabase(), 'rsvp_changed', ctx.eviteId, ctx.rsvpId, ctx.revision)
}

/**
 * `opts.budget` (P09b, the cron): stop after this many NEW claims. A duplicate (somebody already owns it)
 * does not spend budget. When the guest list was cut short the party is NOT stamped announced, so the next
 * tick carries on from where this one stopped.
 */
export async function sendPartyCancelledNotices(
  supabase: Supa,
  eviteId: string,
  now: Date = new Date(),
  opts: { budget?: number } = {},
): Promise<NotifyCancelledResult> {
  if (eviteSendsMode() === 'off') return { ok: true, queued: false, reason: 'sends-off' }
  const gate = await readSendGate(supabase, eviteId)
  if (gate.kind === 'unavailable') return { ok: false, queued: false, reason: 'unavailable' }
  if (!gate.allowed) return { ok: true, queued: false, reason: 'not-pilot' }

  const ev = await supabase.from('evites').select('id, booking_id, cal_version, cancelled_notice_at').eq('id', eviteId).maybeSingle<{ id: string; booking_id: string; cal_version: number; cancelled_notice_at: string | null }>()
  if (ev.error) return { ok: false, queued: false, reason: 'unavailable' }
  if (!ev.data) return { ok: false, queued: false, reason: 'not-found' }

  const bk = await supabase.from('bookings').select('id, status').eq('id', ev.data.booking_id).maybeSingle<{ id: string; status: string | null }>()
  if (bk.error) return { ok: false, queued: false, reason: 'unavailable' }
  if (!bk.data) return { ok: false, queued: false, reason: 'not-found' }
  if (bk.data.status !== 'cancelled' && bk.data.status !== 'lost') return { ok: true, queued: false, reason: 'not-cancelled' }

  const guests = await supabase
    .from('evite_rsvps')
    .select('id, reminder_email, reminder_opt_out_at')
    .eq('evite_id', eviteId)
    .eq('status', 'yes')
    .order('created_at', { ascending: true })
  if (guests.error) return { ok: false, queued: false, reason: 'unavailable' }

  const eligible = ((guests.data ?? []) as unknown as Array<{ id: string; reminder_email: string | null; reminder_opt_out_at: string | null }>).filter(
    (g) => !!g.reminder_email && !g.reminder_opt_out_at,
  )

  const counts = { sent: 0, failed: 0, skipped: 0, duplicate: 0, unavailable: 0 }
  let claimed = 0
  let truncated = false
  for (const g of eligible) {
    if (opts.budget !== undefined && claimed >= opts.budget) {
      truncated = true
      break
    }
    let r: ClaimAndSendResult
    try {
      r = await claimAndSend(supabase, { evite_id: eviteId, rsvp_id: g.id, send_type: 'party_cancelled', ref_version: ev.data.cal_version + 1 }, { now })
    } catch (e) {
      console.error(`evites/inline: party_cancelled threw: ${e instanceof Error ? e.message : String(e)}`)
      counts.unavailable += 1
      continue
    }
    note('party_cancelled', r)
    if (r.kind === 'sent' || r.kind === 'failed' || r.kind === 'skipped') claimed += 1
    if (r.kind === 'sent') counts.sent += 1
    else if (r.kind === 'failed') counts.failed += 1
    else if (r.kind === 'skipped' || r.kind === 'disabled') counts.skipped += 1
    else if (r.kind === 'duplicate') counts.duplicate += 1
    else counts.unavailable += 1
  }

  // Every eligible guest now has a claim (sent, or failed and queued for retry): mark the party announced.
  // Only while it is still NULL, and read back, so a second click cannot move the original time.
  let stamped = false
  if (counts.unavailable === 0 && !truncated) {
    const s = await supabase.from('evites').update({ cancelled_notice_at: now.toISOString() }).eq('id', eviteId).is('cancelled_notice_at', null).select('id')
    if (s.error) console.error(`evites/inline: cancelled_notice_at not recorded for ${eviteId}: ${s.error.message}`)
    else stamped = ((s.data ?? []) as unknown[]).length > 0
  }

  const queued = counts.sent + counts.failed > 0
  return {
    ok: counts.unavailable === 0,
    queued,
    ...(eligible.length === 0 ? { reason: 'no-guests' } : counts.unavailable > 0 ? { reason: 'some-unavailable' } : {}),
    count: counts.sent + counts.failed,
    sent: counts.sent,
    failed: counts.failed,
    skipped: counts.skipped,
    duplicate: counts.duplicate,
    stamped,
    claimed,
    ...(truncated ? { truncated: true } : {}),
  }
}
