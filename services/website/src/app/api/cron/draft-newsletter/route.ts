import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { eventNewsletterHtml } from '@/lib/email-templates/event-newsletter'

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
  const today = new Date().toISOString().split('T')[0]

  // Get events in the next 21 days
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + 21)
  const endDate = futureDate.toISOString().split('T')[0]

  const { data: events, error } = await supabase
    .from('events')
    .select('title, slug, event_date, event_time, price_cents, images, image_url')
    .eq('is_active', true)
    .gte('event_date', today)
    .lte('event_date', endDate)
    .order('event_date')
    .limit(8)

  if (error) {
    console.error('cron:newsletter fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch events' }, { status: 500 })
  }

  if (!events?.length) {
    return NextResponse.json({ message: 'No upcoming events to feature', drafted: false })
  }

  // Format events for the template
  const templateEvents = events.map(e => {
    const imgs = (e.images as any[]) || []
    const primary = imgs.find((i: any) => i.is_primary) || imgs[0]
    const imageUrl = primary?.url || e.image_url || undefined

    const dateDisplay = e.event_date
      ? new Date(e.event_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : 'TBD'

    const price = e.price_cents === 0
      ? 'Free'
      : `$${(e.price_cents / 100).toFixed(e.price_cents % 100 === 0 ? 0 : 2)}`

    return {
      title: e.title,
      date: dateDisplay,
      time: e.event_time || '',
      price,
      imageUrl,
      ticketUrl: `https://www.hosthampton.com/events/${e.slug}`,
    }
  })

  const html = eventNewsletterHtml({ events: templateEvents })
  const subject = `What's Coming Up at Host Hampton | ${templateEvents[0].date}`

  // Save as draft campaign
  const { data: campaign, error: insertErr } = await supabase
    .from('scheduled_campaigns')
    .insert({
      campaign_type: 'event_update',
      subject,
      body_html: html,
      target_segment: 'email_opted_in',
      status: 'draft',
    })
    .select('id')
    .single()

  if (insertErr) {
    console.error('cron:newsletter insert error:', insertErr)
    return NextResponse.json({ error: 'Failed to save draft' }, { status: 500 })
  }

  console.log('Newsletter draft created:', campaign?.id, 'with', templateEvents.length, 'events')
  return NextResponse.json({
    drafted: true,
    campaignId: campaign?.id,
    eventsCount: templateEvents.length,
  })
}
