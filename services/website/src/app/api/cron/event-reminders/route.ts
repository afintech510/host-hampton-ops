import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { findContactsByEmail } from '@/lib/contactLookup'
import { enqueueReminders, type ReminderRow } from '@/lib/reminderQueue'
import { etDateString } from '@/lib/partyTime'

export const dynamic = 'force-dynamic'

/**
 * The night-before sweep for ticketed events.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS USED TO DO, AND WHY IT CHANGED. It read `event_tickets` directly,
 * built a message per ticket holder and texted them with `sendBulkSMS`. Three
 * things were wrong with that, and all three only mattered because it sends to
 * real customers with no human in the loop:
 *
 *   1. IT NEVER LOOKED AT CONSENT. It joined nothing to `contacts`, so
 *      `sms_opt_in` was not read and neither was a STOP. Measured 2026-09-12:
 *      93 confirmed ticket holders have a phone number, 85 of them are opted in
 *      — so 8 real people were in line for a text they had never agreed to.
 *   2. IT WAS NOT IDEMPOTENT. Nothing recorded that a reminder had gone out.
 *      It deduped by phone WITHIN one run and not at all between runs, so a
 *      cron redelivery, a retry, or two overlapping ticks texted everybody
 *      again. There is no way to un-send an SMS.
 *   3. IT DOUBLED THE QUEUE. `enqueueEventReminders` already schedules an
 *      `event_sms_1day` at ticket purchase. Once the queue started working
 *      (migration 044 — before it, every insert was rejected and the table had
 *      never held a row) the same customer would have had two texts the day
 *      before every event, from two different code paths.
 *
 * So this route now ENQUEUES instead of sending. `scheduled_reminders` already
 * has the consent re-check, the claim, the retry budget and the audit trail;
 * the fix for "this sender has none of those" is not to build a second set, it
 * is to use the one that exists (hard-won rule 11). `uniq_scheduled_reminder_once`
 * makes the overlap with the purchase-time enqueue a no-op rather than a
 * duplicate text.
 *
 * It keeps its safety-net role: a ticket bought before the buyer had a contact
 * row, or before they opted in, is picked up here.
 *
 * NOTE: this route now depends on `/api/cron/send-reminders` also being
 * scheduled. Neither is currently scheduled at cron-job.org — see PLAN.md.
 */

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()

  // Tomorrow in EASTERN time, not UTC. `new Date().toISOString()` on a UTC box
  // rolls over at 8pm local, so an evening run used to look a day too far ahead
  // and silently remind nobody for the event that was actually tomorrow.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const tomorrowDate = etDateString(tomorrow)

  const { data: events, error: eventsErr } = await supabase
    .from('events')
    .select('id, title, event_time')
    .eq('is_active', true)
    .eq('event_date', tomorrowDate)

  if (eventsErr) {
    console.error('cron:event-reminders events fetch error:', eventsErr.message)
    return NextResponse.json({ error: 'Failed to fetch events', detail: eventsErr.message }, { status: 500 })
  }

  if (!events?.length) {
    return NextResponse.json({ ok: true, message: 'no active events tomorrow', date: tomorrowDate, events: 0, queued: 0 })
  }

  const { data: tickets, error: ticketsErr } = await supabase
    .from('event_tickets')
    .select('customer_email, customer_phone, event_id')
    .in('event_id', events.map(e => e.id))
    .eq('status', 'confirmed')
    .not('customer_phone', 'is', null)

  if (ticketsErr) {
    console.error('cron:event-reminders tickets fetch error:', ticketsErr.message)
    return NextResponse.json({ error: 'Failed to fetch tickets', detail: ticketsErr.message }, { status: 500 })
  }

  if (!tickets?.length) {
    return NextResponse.json({
      ok: true, message: 'no confirmed ticket holders with a phone number',
      date: tomorrowDate, events: events.length, queued: 0,
    })
  }

  // One row per (event, contact). Two tickets on one email is one reminder.
  const seen = new Set<string>()
  const rows: ReminderRow[] = []
  const nowIso = new Date().toISOString()

  let noContact = 0
  let lookupFailed = 0
  let notOptedIn = 0

  for (const ticket of tickets) {
    const lookup = await findContactsByEmail(supabase, ticket.customer_email, 'id, email, sms_opt_in')
    // Rule 12: a failed read is not "this person does not exist". It is counted
    // separately and reported, so a run that could not check consent for half
    // its ticket holders does not read as a clean run.
    if (lookup.kind === 'unavailable') {
      console.error('cron:event-reminders contact lookup failed:', lookup.error)
      lookupFailed++
      continue
    }
    if (lookup.kind === 'absent') { noContact++; continue }

    const contact = lookup.contacts[0] as { id: string; sms_opt_in?: boolean | null }

    // Consent, which the old sender never asked about. It is re-checked again
    // at send time by /api/cron/send-reminders.
    if (contact.sms_opt_in !== true) { notOptedIn++; continue }

    const key = `${ticket.event_id}:${contact.id}`
    if (seen.has(key)) continue
    seen.add(key)

    rows.push({
      contact_id: contact.id,
      reminder_type: 'event_sms_1day',
      reference_type: 'event',
      reference_id: ticket.event_id,
      scheduled_for: nowIso,
      channel: 'sms',
    })
  }

  const res = rows.length ? await enqueueReminders(supabase, rows) : { inserted: 0, duplicate: 0, refused: [] }

  console.log(
    `cron:event-reminders ${tomorrowDate} — events=${events.length} tickets=${tickets.length} ` +
      `queued=${res.inserted} alreadyQueued=${res.duplicate} refused=${res.refused.length} ` +
      `noContact=${noContact} notOptedIn=${notOptedIn} lookupFailed=${lookupFailed}`
  )

  return NextResponse.json({
    ok: true,
    date: tomorrowDate,
    events: events.length,
    tickets: tickets.length,
    queued: res.inserted,
    alreadyQueued: res.duplicate,
    refused: res.refused,
    noContact,
    notOptedIn,
    lookupFailed,
  })
}
