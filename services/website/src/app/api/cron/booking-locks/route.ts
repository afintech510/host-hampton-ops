import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { logBookingChange } from '@/lib/bookingAudit'

export const dynamic = 'force-dynamic'

/**
 * Move an `approved` booking to `modifications_locked` once its T-14
 * modification cutoff has passed.
 *
 * ── State, measured 2026-09-13 ──────────────────────────────────────────────
 *
 * This job IS scheduled at cron-job.org — daily at 04:00 UTC — and it has
 * answered **401 on every single run** in the whole ten-day nginx window
 * (`docker logs hampton_nginx`, user-agent `cron-job.org`). Its configured
 * secret no longer matches `CRON_SECRET`. Nothing monitors a cron's status, so
 * a job that has failed every day for months looks exactly like a job that is
 * working. Seven approved bookings are past their cutoff and still say
 * "Approved". Fixing that is a cron-job.org login, not a code change — PLAN.md
 * carries it as a needs-Adam.
 *
 * ── Three things it got wrong, all of which matter on the day it starts ─────
 *
 * 1. **The UPDATE had no `.select()` and no status guard**, so `locked++`
 *    counted rows it had not verified it changed, and two ticks both "locked"
 *    the same booking. The write is now conditional on the row still being
 *    `approved` and reads back the rows it really moved (rule 19, and rule 10's
 *    expensive half — a count is a sentence somebody repeats).
 * 2. **The audit insert discarded its error** — on the table whose entire job is
 *    to say what happened. `lib/bookingAudit.ts` reports and returns.
 * 3. **It locked parties that had already happened.** Three of the seven
 *    candidates today are for parties on 2026-08-21, 2026-09-04 and 2026-09-12.
 *    Moving a finished party backwards into "modifications locked" is noise in
 *    the Parties tab and in the customer's portal, where the label is all this
 *    status does — nothing in the app enforces the lock. Past parties are
 *    counted and named, not touched.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const today = new Date().toISOString().split('T')[0]

  const { data: bookings, error } = await supabase
    .from('bookings')
    .select('id, booking_ref, modification_cutoff, party_date, contact_email, contact_name')
    .eq('status', 'approved')
    .lte('modification_cutoff', today)

  if (error) {
    console.error('cron:booking-locks fetch error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!bookings || bookings.length === 0) {
    return NextResponse.json({ ok: true, checked: 0, locked: 0, skippedPast: 0, failed: 0, notes: [] })
  }

  let locked = 0
  let skippedPast = 0
  let failed = 0
  const notes: string[] = []

  for (const booking of bookings) {
    // A cutoff that has passed for a party that has ALSO passed is not a lock,
    // it is a relabel of history.
    if (booking.party_date && String(booking.party_date) < today) {
      skippedPast++
      notes.push(`${booking.booking_ref}: party was ${booking.party_date} — already over, left as approved`)
      continue
    }

    const { data: moved, error: updateErr } = await supabase
      .from('bookings')
      .update({ status: 'modifications_locked', updated_at: new Date().toISOString() })
      .eq('id', booking.id)
      .eq('status', 'approved') // the claim: another tick or an admin may have moved it
      .select('id')

    if (updateErr) {
      failed++
      notes.push(`${booking.booking_ref}: could not lock — ${updateErr.message}`)
      console.error(`cron:booking-locks failed to lock ${booking.booking_ref}:`, updateErr.message)
      continue
    }
    if (!moved || moved.length === 0) {
      // Not an error and not a lock. Somebody else moved it between the read and
      // the write, and saying "locked" about it would be untrue.
      notes.push(`${booking.booking_ref}: no longer approved when the write ran — not locked`)
      continue
    }

    await logBookingChange(supabase, {
      bookingId: booking.id,
      actor: 'system',
      summary: 'Modifications locked (T-14 cutoff reached)',
    })

    locked++
    console.log(`cron:booking-locks locked ${booking.booking_ref}`)
  }

  console.log(
    `cron:booking-locks checked=${bookings.length} locked=${locked} skippedPast=${skippedPast} failed=${failed}`
  )
  for (const n of notes) console.log(`cron:booking-locks note — ${n}`)

  return NextResponse.json({ ok: failed === 0, checked: bookings.length, locked, skippedPast, failed, notes })
}
