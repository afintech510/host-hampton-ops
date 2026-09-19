import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { etDateString } from '@/lib/partyTime'
import { notifyOwnerSms, ownerEmail } from '@/lib/ownerNotify'
import { sendTransactionalEmail } from '@/lib/brevo'
import { escapeHtml } from '@/lib/escapeHtml'

export const dynamic = 'force-dynamic'

/**
 * The daily sweep for `staff_reminders` (migration 056) — internal
 * "follow up with this lead" nudges, never sent to a customer.
 *
 * Runs once a day (not every 3 minutes like gmail-sync): a follow-up date is a
 * day, not a moment, and a digest once a day is what a human actually wants —
 * not one text per reminder. `etDateString` reads the date in Eastern time,
 * the same trap `event-reminders` already paid for: a UTC box rolls the
 * calendar over at 8pm local, so `new Date().toISOString()` would fire a
 * reminder up to 4 hours before its actual due date.
 *
 * One row can ask for `email`, `sms`, or `both`. A `both` row is only marked
 * `sent` once BOTH channels succeeded — a row that only half-sent stays
 * `pending` and is retried (and re-digested) on the next run rather than
 * silently losing the channel that failed. That can double a text if the
 * email leg keeps failing, which is an acceptable cost for a reminder aimed
 * at Adam, not a customer.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const today = etDateString(new Date())

  const { data: due, error } = await supabase
    .from('staff_reminders')
    .select('id, contact_name, message, due_date, channel')
    .eq('status', 'pending')
    .lte('due_date', today)
    .order('due_date', { ascending: true })

  if (error) {
    console.error('cron:staff-reminders fetch error:', error.message)
    return NextResponse.json({ error: 'Failed to fetch reminders', detail: error.message }, { status: 500 })
  }

  if (!due?.length) {
    return NextResponse.json({ ok: true, date: today, due: 0, smsDelivered: 0, emailSent: false })
  }

  const smsRows = due.filter(r => r.channel === 'sms' || r.channel === 'both')
  const emailRows = due.filter(r => r.channel === 'email' || r.channel === 'both')

  let smsDelivered = 0
  if (smsRows.length) {
    const lines = smsRows.map(r => `${r.contact_name}: ${r.message}`)
    smsDelivered = await notifyOwnerSms(`Follow-up reminder(s) due:\n${lines.join('\n')}`)
  }

  let emailOk = false
  if (emailRows.length) {
    const itemsHtml = emailRows
      .map(
        r =>
          `<li><strong>${escapeHtml(r.contact_name)}</strong> (due ${escapeHtml(r.due_date)}): ${escapeHtml(r.message)}</li>`,
      )
      .join('')
    emailOk = await sendTransactionalEmail(
      ownerEmail(),
      `${emailRows.length} follow-up reminder${emailRows.length === 1 ? '' : 's'} due`,
      `<p>Due today or earlier:</p><ul>${itemsHtml}</ul>`,
    )
  }

  // Rule 12: only claim a row is handled if the channel(s) IT ASKED FOR
  // actually went out. `smsRows`/`emailRows` are already filtered by channel,
  // so a 'both' row appears in both and needs a true in both to clear.
  const smsOk = smsRows.length > 0 && smsDelivered > 0
  const resolved = due.filter(r => {
    if (r.channel === 'sms') return smsOk
    if (r.channel === 'email') return emailOk
    return smsOk && emailOk
  })

  if (resolved.length) {
    const { error: updateErr } = await supabase
      .from('staff_reminders')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .in(
        'id',
        resolved.map(r => r.id),
      )
    if (updateErr) console.error('cron:staff-reminders status update failed:', updateErr.message)
  }

  const body = {
    ok: true,
    date: today,
    due: due.length,
    smsRows: smsRows.length,
    emailRows: emailRows.length,
    smsDelivered,
    emailOk,
    resolved: resolved.length,
    stillPending: due.length - resolved.length,
  }
  console.log('cron:staff-reminders', body)
  return NextResponse.json(body)
}
