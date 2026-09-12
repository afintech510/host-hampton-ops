import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { escapeHtml } from '@/lib/escapeHtml'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { action } = await req.json()

  if (action === 'draft-newsletter') {
    // Fetch upcoming events in the next 14 days
    const now = new Date()
    const twoWeeks = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)

    const { data: events } = await supabase
      .from('events')
      .select('title, event_date, event_time, location, price_cents, status')
      .gte('event_date', now.toISOString().split('T')[0])
      .lte('event_date', twoWeeks.toISOString().split('T')[0])
      .eq('status', 'published')
      .order('event_date', { ascending: true })

    if (!events || events.length === 0) {
      return NextResponse.json({ message: 'No upcoming events in the next 14 days to feature' })
    }

    // Build simple HTML newsletter draft
    const eventRows = events.map(e => {
      const date = new Date(e.event_date + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
      })
      const price = e.price_cents === 0 ? 'Free' : `$${(e.price_cents / 100).toFixed(0)}`
      return `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee"><strong>${escapeHtml(e.title)}</strong><br>${escapeHtml(date)}${e.event_time ? ` at ${escapeHtml(e.event_time)}` : ''}<br>${escapeHtml(price)}</td></tr>`
    }).join('\n')

    const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
<h2 style="color:#1a2744">What's Coming Up at Host Hampton</h2>
<p>Here's what's happening over the next two weeks:</p>
<table style="width:100%;border-collapse:collapse">
${eventRows}
</table>
<p style="margin-top:20px"><a href="https://www.hosthampton.com/events" style="background:#1a2744;color:white;padding:10px 20px;text-decoration:none;border-radius:6px">View All Events</a></p>
<p style="color:#999;font-size:12px;margin-top:30px">Host Hampton | 295 Montauk Hwy, Speonk NY</p>
</div>`

    // Save as draft campaign
    const { data: campaign, error } = await supabase
      .from('scheduled_campaigns')
      .insert({
        campaign_type: 'email',
        subject: `What's Coming Up at Host Hampton`,
        body_html: html,
        target_segment: 'email_opted_in',
        status: 'draft',
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({
      message: `Newsletter draft created with ${events.length} events`,
      campaign,
    })
  }

  if (action === 'process-reminders') {
    // Find pending reminders due now or in the past
    const { data: due } = await supabase
      .from('scheduled_reminders')
      .select('*, contacts(first_name, email, phone, sms_opt_in, email_opt_in)')
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString())

    if (!due || due.length === 0) {
      return NextResponse.json({ message: 'No pending reminders due', processed: 0 })
    }

    // For now, just mark them as sent (actual sending logic is in the cron routes)
    // This gives the admin visibility into what would be processed
    return NextResponse.json({
      message: `${due.length} reminders are due for processing`,
      reminders: due.map(r => ({
        id: r.id,
        channel: r.channel,
        reminder_type: r.reminder_type,
        scheduled_for: r.scheduled_for,
        contact: (r as any).contacts?.first_name || 'Unknown',
      })),
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
