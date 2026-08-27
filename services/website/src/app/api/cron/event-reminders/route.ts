import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { sendBulkSMS } from '@/lib/sms'
import { smsEventReminder1Day } from '@/lib/sms-templates'

export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()

  // Calculate tomorrow's date
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const tomorrowDate = tomorrow.toISOString().split('T')[0]

  // Find active events happening tomorrow
  const { data: events, error: eventsErr } = await supabase
    .from('events')
    .select('id, title, event_time')
    .eq('is_active', true)
    .eq('event_date', tomorrowDate)

  if (eventsErr) {
    console.error('cron:event-reminders events fetch error:', eventsErr)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }

  if (!events?.length) {
    return NextResponse.json({ message: 'No events tomorrow', sent: 0, events: 0 })
  }

  const eventIds = events.map(e => e.id)

  // Fetch confirmed tickets for those events with a phone number
  const { data: tickets, error: ticketsErr } = await supabase
    .from('event_tickets')
    .select('customer_name, customer_phone, event_id')
    .in('event_id', eventIds)
    .eq('status', 'confirmed')
    .not('customer_phone', 'is', null)

  if (ticketsErr) {
    console.error('cron:event-reminders tickets fetch error:', ticketsErr)
    return NextResponse.json({ error: 'Failed to fetch tickets' }, { status: 500 })
  }

  if (!tickets?.length) {
    return NextResponse.json({ message: 'No confirmed ticket holders with phone', sent: 0, events: events.length })
  }

  // Build event lookup map
  const eventMap = Object.fromEntries(events.map(e => [e.id, e]))

  // Dedupe by phone per event (one SMS per person per event)
  const seen = new Set<string>()
  const messages: { phone: string; body: string }[] = []

  for (const ticket of tickets) {
    const key = `${ticket.event_id}:${ticket.customer_phone}`
    if (seen.has(key)) continue
    seen.add(key)

    const evt = eventMap[ticket.event_id]
    if (!evt) continue

    const firstName = (ticket.customer_name || 'there').split(' ')[0]

    messages.push({
      phone: ticket.customer_phone,
      body: smsEventReminder1Day({
        firstName,
        eventName: evt.title,
        time: evt.event_time || '',
      }),
    })
  }

  if (!messages.length) {
    return NextResponse.json({ message: 'No messages to send', sent: 0, events: events.length })
  }

  // Transactional event reminders send via Quo.
  const results = await sendBulkSMS(messages, 1000, undefined, 'quo')
  const sent = results.filter(r => r !== null).length
  const failed = results.filter(r => r === null).length

  console.log(`cron:event-reminders sent ${sent} SMS for ${events.length} event(s) tomorrow (${tomorrowDate}), ${failed} failed`)

  return NextResponse.json({
    sent,
    failed,
    events: events.length,
    date: tomorrowDate,
  })
}
