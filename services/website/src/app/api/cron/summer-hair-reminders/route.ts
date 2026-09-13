import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { sendSMSVia, normalizePhone } from '@/lib/sms'
import { hasExplicitSmsOptOut } from '@/lib/checkinLink'
import { findContactsByPhone } from '@/lib/contactLookup'

export const dynamic = 'force-dynamic'

/**
 * Appointment reminders for the Summer Hair pop-up (a one-day event, 2026-07-03).
 *
 * ── What this route was, measured 2026-09-13 ────────────────────────────────
 *
 * The event is over. `summer_hair_bookings` holds **16 real rows — 13
 * `confirmed`, every one of them `reminder_sent = true`** — with real people's
 * names and phone numbers. The route has never been scheduled and appears zero
 * times in the nginx window. It was, nonetheless, a loaded gun with three
 * separate triggers:
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
 */

const TIME_SLOTS = Array.from({ length: 18 }, (_, i) => {
  const totalMin = 9 * 60 + i * 20
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h > 12 ? h - 12 : h
  return `${h12}:${m.toString().padStart(2, '0')} ${ampm}`
})

function slotToMinutesSinceMidnight(slot: string): number {
  const idx = TIME_SLOTS.indexOf(slot)
  if (idx < 0) return -1
  return 9 * 60 + idx * 20
}

/** Never print a customer's number. Last four is enough to tell two rows apart. */
function maskPhone(raw: string | null | undefined): string {
  const digits = String(raw ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '***'
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // `force` overrides the CLOCK — the event-day check and the 60–75 minute
  // window — and nothing else. It does not override the already-sent guard.
  const force = req.nextUrl.searchParams.get('force') === 'true'
  const forceSlots = req.nextUrl.searchParams.get('slots')?.split(',').filter(Boolean) || []

  const supabase = getSupabase()

  // Only run on July 3, 2026 (ET) — unless force mode
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const dateStr = `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`

  if (!force && dateStr !== '2026-07-03') {
    return NextResponse.json({ ok: true, message: 'Not event day', date: dateStr, sent: 0 })
  }

  const currentMinutes = et.getHours() * 60 + et.getMinutes()

  let query = supabase
    .from('summer_hair_bookings')
    .select('id, name, phone, time_slot, services, party_size')
    .eq('status', 'confirmed')
    // NOT optional, and not skipped by `force`. This is the only cross-run
    // idempotency this table has.
    .eq('reminder_sent', false)

  if (force && forceSlots.length > 0) query = query.in('time_slot', forceSlots)

  const { data: bookings, error } = await query

  if (error) {
    console.error('cron:summer-hair-reminders fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch bookings', detail: error.message }, { status: 500 })
  }

  if (!bookings?.length) {
    return NextResponse.json({ ok: true, message: 'No reminders to send', candidates: 0, sent: 0 })
  }

  let sent = 0
  let notDue = 0
  let optedOut = 0
  let lostClaim = 0
  let failedSend = 0
  let badSlot = 0
  const notes: string[] = []

  for (const b of bookings) {
    const slotMinutes = slotToMinutesSinceMidnight(b.time_slot)
    if (slotMinutes < 0) {
      badSlot++
      notes.push(`${maskPhone(b.phone)}: unrecognised time slot "${b.time_slot}" — cannot work out when to send`)
      continue
    }

    if (!force) {
      const minutesUntil = slotMinutes - currentMinutes
      if (minutesUntil > 75 || minutesUntil < 0) { notDue++; continue }
    }

    const normalized = normalizePhone(b.phone)

    // Transactional, so not gated on the marketing sms_opt_in flag — but an
    // explicit STOP is a statement about the NUMBER and is honoured. A phone
    // has five spellings in `contacts`, so it is normalised before it is
    // compared (lib/contactLookup.ts), never matched raw.
    const lookup = await findContactsByPhone(supabase, b.phone, 'id')
    if (lookup.kind === 'unavailable') {
      // Rule 12: "could not check consent" is not "they consented".
      notes.push(`${maskPhone(b.phone)}: could not read contacts to check for a STOP (${lookup.error}) — not sent`)
      optedOut++
      continue
    }
    let stopped = false
    for (const c of lookup.kind === 'found' ? lookup.contacts : []) {
      if (await hasExplicitSmsOptOut((c as { id: string }).id)) { stopped = true; break }
    }
    if (stopped) {
      optedOut++
      notes.push(`${maskPhone(b.phone)}: explicit STOP on file — not sent`)
      continue
    }

    // CLAIM before sending. Zero rows back means another tick owns this one.
    const { data: claimed, error: claimErr } = await supabase
      .from('summer_hair_bookings')
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
    const sms = `Hi ${firstName}! Reminder: your Summer Hair appointment at Host Hampton is in about 1 hour (${b.time_slot}).\n\nServices: ${serviceList}\nParty size: ${b.party_size}\n\nSee you soon! ✨`

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
      .from('summer_hair_bookings')
      .update({ reminder_sent: false })
      .eq('id', b.id)
    notes.push(
      `${maskPhone(b.phone)}: send failed (${sendError ?? 'provider returned no id'})` +
        (releaseErr ? ` and the claim could NOT be released (${releaseErr.message}) — this row will not retry` : ' — claim released, will retry')
    )
  }

  console.log(
    `cron:summer-hair-reminders candidates=${bookings.length} sent=${sent} notDue=${notDue} ` +
      `optedOut=${optedOut} lostClaim=${lostClaim} failedSend=${failedSend} badSlot=${badSlot}`
  )
  for (const n of notes) console.warn(`cron:summer-hair-reminders note — ${n}`)

  return NextResponse.json({
    ok: failedSend === 0,
    candidates: bookings.length,
    sent,
    notDue,
    optedOut,
    lostClaim,
    failedSend,
    badSlot,
    notes,
  })
}
