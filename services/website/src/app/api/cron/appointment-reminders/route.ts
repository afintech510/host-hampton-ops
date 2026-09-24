import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { sendSMSVia, normalizePhone } from '@/lib/sms'
import { hasExplicitSmsOptOut } from '@/lib/checkinLink'
import { findContactsByPhone } from '@/lib/contactLookup'
import {
  eventsOnDate,
  resolveAppointmentEvent,
  slotMinutesSinceMidnight,
  slotIndex,
  type AppointmentEventConfig,
} from '@/lib/appointmentEvents'

export const dynamic = 'force-dynamic'

/**
 * Appointment reminders, for every event in the registry that is happening today.
 *
 * ── WHAT THIS ROUTE WAS, MEASURED 2026-09-13 ────────────────────────────────
 *
 * The predecessor (`summer-hair-reminders`) was hard-coded to a single date,
 * 2026-07-03. The event was over. `summer_hair_bookings` held **16 real rows —
 * 13 `confirmed`, every one of them `reminder_sent = true`** — with real
 * people's names and phone numbers. The route had never been scheduled and
 * appeared zero times in the nginx window. It was, nonetheless, a loaded gun
 * with three separate triggers:
 *
 * 1. **`?force=true` dropped the `reminder_sent = false` filter** as well as the
 *    date and time-window gates. One authenticated GET therefore re-texted all
 *    thirteen customers about an appointment two months in the past. `force`
 *    now overrides the CLOCK only; the already-sent guard is not optional,
 *    because it is the only thing standing between a re-run and a duplicate SMS
 *    and there is no way to un-send one.
 * 2. **It marked rows sent AFTER sending, in one bulk `.in()` whose error was
 *    discarded.** Read → send → mark is the shape link 10 removed from
 *    `send-reminders`: a failed mark means the next tick texts everybody again.
 *    The mark is now a per-row CLAIM taken BEFORE the send, conditional on
 *    `reminder_sent = false` and read back, so a lost race sends nothing. If the
 *    send then fails the claim is released, which is the one ordering that can
 *    neither double-send nor silently drop.
 * 3. **It never checked consent, and it returned the customers' names and raw
 *    phone numbers in the JSON body** — `debug: [{name, phone, normalized}]`
 *    plus an `errors` array carrying both, for every row it looked at, whether
 *    or not it texted them. Behind `CRON_SECRET`, but a cron response is not a
 *    place to put a customer list. Consent is now checked with the same
 *    fail-closed `hasExplicitSmsOptOut` the check-in text uses (an appointment
 *    reminder is transactional, so it is not gated on the marketing
 *    `sms_opt_in` flag — but an explicit STOP is honoured), and the payload
 *    carries counts and masked numbers.
 *
 * All three fixes are carried over UNCHANGED, including the exact text of the
 * claim and the release, because the tripwires in `cronSurface.test.ts` and
 * `outboundSendSurface.test.ts` read them off disk as source.
 *
 * ── WHAT IS NEW ─────────────────────────────────────────────────────────────
 *
 * The date is no longer a literal. This loops over every registry event whose
 * `eventDate` is today in Eastern, and the lead time is `reminderLeadMinutes`
 * per event rather than a hard-coded 75. A day with no event is `{ ok: true }`
 * and nothing sent, which is what makes this schedulable daily.
 *
 * It also sweeps holds left behind by abandoned checkouts, on every run — a
 * `pending_payment` booking that was never paid otherwise blocks its slots
 * forever, and a daily sweep is the backstop for the one the book route does.
 */

/** Never print a customer's number. Last four is enough to tell two rows apart. */
function maskPhone(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '***'
}

/**
 * When this booking starts, in minutes since midnight.
 *
 * `slot_index` is canonical, so this is arithmetic. It used to be an `indexOf`
 * into a copy-pasted 18-element array, which returned -1 for any row whose
 * label did not match the grid exactly. The label is still the fallback, for a
 * row written before the column existed.
 */
function bookingMinutes(
  cfg: AppointmentEventConfig,
  b: { slot_index: number | null; time_slot: string },
): number {
  const idx = typeof b.slot_index === 'number' && b.slot_index >= 0
    ? b.slot_index
    : slotIndex(cfg, b.time_slot)
  if (idx < 0 || idx >= cfg.slotCount) return -1
  return slotMinutesSinceMidnight(cfg, idx)
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // `force` overrides the CLOCK — the event-day check and the lead-time
  // window — and nothing else. It does not override the already-sent guard.
  const force = req.nextUrl.searchParams.get('force') === 'true'
  const forceSlots = req.nextUrl.searchParams.get('slots')?.split(',').filter(Boolean) || []
  // With `force`, an explicit `?event=` says WHICH event to pretend it is today.
  const forceEvent = req.nextUrl.searchParams.get('event')

  const supabase = getSupabase()

  // Today in Eastern. The box runs UTC — `setHours()` on this line is how every
  // reminder in the other sender came to be scheduled 4-5 hours early.
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dateStr = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`
  const currentMinutes = et.getHours() * 60 + et.getMinutes()

  // ── The abandoned-checkout sweep ──────────────────────────────────────────
  // Runs every day regardless of whether anything is on, because a hold from a
  // checkout nobody finished is a slot nobody can book.
  let holdsSwept = 0
  const { data: sweptHolds, error: sweepErr } = await supabase
    .from('appointment_slot_holds')
    .delete()
    .not('expires_at', 'is', null)
    .lt('expires_at', now.toISOString())
    .select('booking_id')

  if (sweepErr) {
    console.error('cron:appointment-reminders hold sweep failed:', sweepErr.message)
  } else {
    holdsSwept = sweptHolds?.length ?? 0
    const abandoned = Array.from(new Set((sweptHolds ?? []).map(h => h.booking_id)))
    if (abandoned.length > 0) {
      // The booking they belonged to never paid. Cancel it, conditionally on it
      // still being `pending_payment` — a row that paid in the meantime has
      // already been confirmed by the webhook and must not be touched.
      const { error: cancelErr } = await supabase
        .from('appointment_bookings')
        .update({ status: 'cancelled' })
        .in('id', abandoned)
        .eq('status', 'pending_payment')
      if (cancelErr) {
        console.error('cron:appointment-reminders could not cancel abandoned bookings:', cancelErr.message)
      }
    }
  }

  // Which events are in scope.
  //
  // Without `force` this is "whatever is happening today", and `?event=` can
  // only ever NARROW that — it cannot conjure a day. Reaching an event that is
  // not today requires `force`, which is the flag that already means "ignore
  // the clock", and it is the only way to rehearse a reminder run in advance.
  const todays = eventsOnDate(dateStr)
  const events: AppointmentEventConfig[] = forceEvent
    ? force
      ? [resolveAppointmentEvent(forceEvent)].filter((c): c is AppointmentEventConfig => !!c)
      : todays.filter(c => c.slug === forceEvent)
    : todays

  if (events.length === 0) {
    return NextResponse.json({
      ok: true,
      message: forceEvent ? 'No such event today' : 'No appointment event today',
      date: dateStr,
      holdsSwept,
      sent: 0,
    })
  }

  let candidates = 0
  let sent = 0
  let notDue = 0
  let optedOut = 0
  let lostClaim = 0
  let failedSend = 0
  let badSlot = 0
  const notes: string[] = []

  for (const cfg of events) {
    let query = supabase
      .from('appointment_bookings')
      .select('id, name, phone, contact_id, slot_index, time_slot, services, party_size')
      .eq('event_slug', cfg.slug)
      .eq('status', 'confirmed')
      // NOT optional, and not skipped by `force`. This is the only cross-run
      // idempotency this table has.
      .eq('reminder_sent', false)

    if (force && forceSlots.length > 0) query = query.in('time_slot', forceSlots)

    const { data: bookings, error } = await query

    if (error) {
      console.error(`cron:appointment-reminders fetch error for ${cfg.slug}:`, error)
      return NextResponse.json({ error: 'Failed to fetch bookings', detail: error.message }, { status: 500 })
    }

    if (!bookings?.length) continue
    candidates += bookings.length

    for (const b of bookings) {
      const slotMinutes = bookingMinutes(cfg, b)
      if (slotMinutes < 0) {
        badSlot++
        notes.push(`${maskPhone(b.phone)}: unrecognised time slot "${b.time_slot}" — cannot work out when to send`)
        continue
      }

      if (!force) {
        const minutesUntil = slotMinutes - currentMinutes
        if (minutesUntil > cfg.reminderLeadMinutes || minutesUntil < 0) { notDue++; continue }
      }

      const normalized = normalizePhone(b.phone)

      // Transactional, so not gated on the marketing sms_opt_in flag — but an
      // explicit STOP is a statement about the NUMBER and is honoured. A phone
      // has five spellings in `contacts`, so it is normalised before it is
      // compared (lib/contactLookup.ts), never matched raw.
      //
      // `contact_id` is the fast path and is new: the public POST now upserts
      // the contact, so most rows know who they are. The phone lookup stays as
      // the fallback for a row booked during a contacts outage.
      let contactIds: string[] = []
      if (b.contact_id) {
        contactIds = [b.contact_id as string]
      } else {
        const lookup = await findContactsByPhone(supabase, b.phone, 'id')
        if (lookup.kind === 'unavailable') {
          // Rule 12: "could not check consent" is not "they consented".
          notes.push(`${maskPhone(b.phone)}: could not read contacts to check for a STOP (${lookup.error}) — not sent`)
          optedOut++
          continue
        }
        contactIds = (lookup.kind === 'found' ? lookup.contacts : []).map(c => (c as { id: string }).id)
      }
      let stopped = false
      for (const cid of contactIds) {
        if (await hasExplicitSmsOptOut(cid)) { stopped = true; break }
      }
      if (stopped) {
        optedOut++
        notes.push(`${maskPhone(b.phone)}: explicit STOP on file — not sent`)
        continue
      }

      // CLAIM before sending. Zero rows back means another tick owns this one.
      const { data: claimed, error: claimErr } = await supabase
        .from('appointment_bookings')
        .update({ reminder_sent: true })
        .eq('id', b.id)
        .eq('reminder_sent', false)
        .select('id')

      if (claimErr) {
        notes.push(`${maskPhone(b.phone)}: could not claim the row (${claimErr.message}) — not sent`)
        lostClaim++
        continue
      }
      if (!claimed || claimed.length === 0) { lostClaim++; continue }

      const firstName = (b.name || 'there').split(' ')[0]
      const serviceList = (b.services || []).join(', ')
      // No emoji. A single non-GSM-03.38 character flips the whole message to
      // UCS-2 at 70 characters a segment instead of 160; the '✨' this line used
      // to end with cost a segment on every reminder.
      const sms = `Hi ${firstName}! Reminder: your ${cfg.name} appointment at Host Hampton is in about 1 hour (${b.time_slot}).\n\nServices: ${serviceList}\nParty size: ${b.party_size}\n\nSee you soon!`

      let sid: string | null = null
      let sendError: string | null = null
      try {
        // Transactional appointment reminder — routed via Quo (see lib/sms.ts).
        sid = await sendSMSVia('quo', normalized, sms)
      } catch (err) {
        sendError = err instanceof Error ? err.message : String(err)
      }

      if (sid) {
        sent++
        continue
      }

      // The send did not happen, so the claim must not stand: release it, and say
      // both what failed and whether the release worked.
      failedSend++
      const { error: releaseErr } = await supabase
        .from('appointment_bookings')
        .update({ reminder_sent: false })
        .eq('id', b.id)
      notes.push(
        `${maskPhone(b.phone)}: send failed (${sendError ?? 'provider returned no id'})` +
          (releaseErr ? ` and the claim could NOT be released (${releaseErr.message}) — this row will not retry` : ' — claim released, will retry')
      )
    }
  }

  console.log(
    `cron:appointment-reminders events=${events.map(e => e.slug).join(',')} candidates=${candidates} sent=${sent} notDue=${notDue} ` +
      `optedOut=${optedOut} lostClaim=${lostClaim} failedSend=${failedSend} badSlot=${badSlot} holdsSwept=${holdsSwept}`
  )
  for (const n of notes) console.warn(`cron:appointment-reminders note — ${n}`)

  return NextResponse.json({
    ok: failedSend === 0,
    date: dateStr,
    events: events.map(e => e.slug),
    candidates,
    sent,
    notDue,
    optedOut,
    lostClaim,
    failedSend,
    badSlot,
    holdsSwept,
    notes,
  })
}
