import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

/**
 * One-shot backfill: insert a `party_thank_you_t1` reminder for any kid-party
 * booking whose deposit landed before the post-party email feature shipped.
 *
 * Idempotent — skips any booking that already has a `party_thank_you_t1`
 * row in scheduled_reminders.
 *
 * Hit with: POST /api/admin/photos/backfill-reminders (Bearer ADMIN_PASSWORD)
 * Returns counts so you can verify what landed.
 */
export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const today = new Date().toISOString().split('T')[0]

  // Eligible bookings: kid-party events with deposit paid + a future or
  // today's party date. Past parties are skipped (the thank-you would fire
  // immediately, which is jarring).
  const { data: bookings, error: bErr } = await supabase
    .from('bookings')
    .select('id, booking_ref, party_date, contact_email')
    .in('event_type', ['kid-party', 'kids-party', 'kids_party'])
    .gte('party_date', today)
    .in('status', ['pending_review', 'approved', 'paid_in_full'])

  if (bErr) {
    return NextResponse.json({ error: bErr.message }, { status: 500 })
  }

  if (!bookings?.length) {
    return NextResponse.json({ ok: true, scanned: 0, enqueued: 0, skipped: 0 })
  }

  let enqueued = 0
  let skipped = 0
  const errors: { booking_ref: string; reason: string }[] = []

  for (const b of bookings) {
    try {
      if (!b.contact_email || !b.party_date) {
        skipped++
        continue
      }

      // Resolve contact for the reminder FK
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('email', b.contact_email)
        .maybeSingle()

      if (!contact) {
        skipped++
        errors.push({ booking_ref: b.booking_ref, reason: 'no contact row for email' })
        continue
      }

      // Skip if already enqueued
      const { data: existing } = await supabase
        .from('scheduled_reminders')
        .select('id')
        .eq('reminder_type', 'party_thank_you_t1')
        .eq('reference_type', 'booking')
        .eq('reference_id', b.booking_ref)
        .limit(1)
        .maybeSingle()

      if (existing) {
        skipped++
        continue
      }

      // Schedule for the morning after the party at 10am local
      const partyDateObj = new Date(b.party_date + 'T12:00:00')
      const dayAfter = new Date(partyDateObj)
      dayAfter.setDate(dayAfter.getDate() + 1)
      dayAfter.setHours(10, 0, 0, 0)

      const { error: insErr } = await supabase.from('scheduled_reminders').insert({
        contact_id: contact.id,
        reminder_type: 'party_thank_you_t1',
        reference_type: 'booking',
        reference_id: b.booking_ref,
        scheduled_for: dayAfter.toISOString(),
        channel: 'email',
      })

      if (insErr) {
        errors.push({ booking_ref: b.booking_ref, reason: insErr.message })
        continue
      }
      enqueued++
    } catch (err) {
      errors.push({
        booking_ref: b.booking_ref,
        reason: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: bookings.length,
    enqueued,
    skipped,
    errors: errors.length ? errors : undefined,
  })
}
