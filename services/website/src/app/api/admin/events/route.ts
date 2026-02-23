import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { data: events, error } = await supabase
    .from('events')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get ticket counts per event
  const eventsWithCounts = await Promise.all(
    (events || []).map(async (event) => {
      const { count } = await supabase
        .from('event_tickets')
        .select('*', { count: 'exact', head: true })
        .eq('event_id', event.id)
        .eq('status', 'confirmed')
      return { ...event, tickets_sold: (event.max_tickets - event.available_tickets), confirmed_tickets: count || 0 }
    })
  )

  return NextResponse.json({ events: eventsWithCounts })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = await req.json()

  const slug = body.slug || body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const { data: event, error } = await supabase
    .from('events')
    .insert({
      slug,
      title: body.title,
      description: body.description || null,
      short_description: body.shortDescription || null,
      category: body.category || 'workshop',
      price_cents: body.priceCents || 0,
      sibling_price_cents: body.siblingPriceCents || null,
      has_variants: body.hasVariants || false,
      variants: body.variants || [],
      has_sessions: body.hasSessions || false,
      allow_multi_session: body.allowMultiSession || false,
      bundle_pricing: body.bundlePricing || [],
      event_date: body.eventDate || null,
      event_time: body.eventTime || null,
      event_end_time: body.eventEndTime || null,
      location: body.location || 'Host Hampton, 295 Montauk Hwy Suite 7, Speonk NY',
      max_tickets: body.maxTickets || 30,
      available_tickets: body.maxTickets || 30,
      is_active: body.isActive !== false,
      is_featured: body.isFeatured || false,
      image_url: body.imageUrl || null,
      images: body.images || [],
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Create Google Calendar event if configured
  if (body.eventDate && process.env.GOOGLE_REFRESH_TOKEN && process.env.GOOGLE_CALENDAR_ID) {
    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN!,
          grant_type: 'refresh_token',
        }),
      })
      const { access_token } = await tokenRes.json()

      const calRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(process.env.GOOGLE_CALENDAR_ID!)}/events`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            summary: event.title,
            description: event.short_description || event.description,
            start: { date: body.eventDate },
            end: { date: body.eventDate },
            location: event.location,
          }),
        }
      )
      const calEvent = await calRes.json()
      if (calEvent.id) {
        await supabase.from('events').update({ google_calendar_event_id: calEvent.id }).eq('id', event.id)
      }
    } catch (err) {
      console.error('Google Calendar sync error:', err)
    }
  }

  // Create sessions if provided
  if (body.hasSessions && body.sessions?.length > 0) {
    const sessionRows = body.sessions.map((s: any) => ({
      event_id: event.id,
      session_date: s.session_date,
      session_time: s.session_time,
      session_end_time: s.session_end_time || null,
      label: s.label || null,
      price_cents: s.price_cents != null ? s.price_cents : null,
      max_tickets: s.max_tickets || 30,
      available_tickets: s.max_tickets || 30,
      is_active: true,
    }))
    const { error: sessErr } = await supabase.from('event_sessions').insert(sessionRows)
    if (sessErr) console.error('Session insert error:', sessErr)
  }

  return NextResponse.json({ event })
}
