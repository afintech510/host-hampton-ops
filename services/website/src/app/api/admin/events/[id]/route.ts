import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { data: event, error } = await supabase
    .from('events')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !event) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let sessions = null
  if (event.has_sessions) {
    const { data } = await supabase
      .from('event_sessions')
      .select('*')
      .eq('event_id', params.id)
      .eq('is_active', true)
      .order('session_date', { ascending: true })
    sessions = data
  }

  return NextResponse.json({ event, sessions })
}

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = await req.json()

  // Build update object from provided fields
  const update: Record<string, any> = {}
  const fields = ['title', 'description', 'short_description', 'category', 'event_date', 'event_time',
    'event_end_time', 'location', 'max_tickets', 'is_active', 'is_featured', 'image_url']

  for (const f of fields) {
    const camel = f.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    if (body[camel] !== undefined) update[f] = body[camel]
    if (body[f] !== undefined) update[f] = body[f]
  }

  if (body.images !== undefined) update.images = body.images
  if (body.priceCents !== undefined) update.price_cents = body.priceCents
  if (body.siblingPriceCents !== undefined) update.sibling_price_cents = body.siblingPriceCents
  // Sale fields: null clears the sale, a value sets it. Send both together from the form.
  if (body.saleDiscountCents !== undefined) update.sale_discount_cents = body.saleDiscountCents
  if (body.saleEndsAt !== undefined) update.sale_ends_at = body.saleEndsAt
  if (body.hasVariants !== undefined) update.has_variants = body.hasVariants
  if (body.variants !== undefined) update.variants = body.variants
  if (body.hasSessions !== undefined) update.has_sessions = body.hasSessions
  if (body.allowMultiSession !== undefined) update.allow_multi_session = body.allowMultiSession
  if (body.bundlePricing !== undefined) update.bundle_pricing = body.bundlePricing

  // Adjust available_tickets if max_tickets changed
  if (update.max_tickets !== undefined) {
    const { data: current } = await supabase.from('events').select('max_tickets, available_tickets').eq('id', params.id).single()
    if (current) {
      const sold = current.max_tickets - current.available_tickets
      update.available_tickets = Math.max(0, update.max_tickets - sold)
    }
  }

  const { data: event, error } = await supabase
    .from('events')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Reconcile sessions if provided
  if (body.sessions !== undefined && body.hasSessions) {
    const incomingSessions = body.sessions as any[]
    const incomingIds = incomingSessions.filter(s => s.id).map(s => s.id)

    // Deactivate sessions removed from the list
    const { data: existing } = await supabase
      .from('event_sessions')
      .select('id')
      .eq('event_id', params.id)
      .eq('is_active', true)

    const existingIds = (existing || []).map(s => s.id)
    const toDeactivate = existingIds.filter(id => !incomingIds.includes(id))
    if (toDeactivate.length > 0) {
      await supabase.from('event_sessions')
        .update({ is_active: false })
        .in('id', toDeactivate)
    }

    // Upsert sessions
    for (const s of incomingSessions) {
      if (s.id && existingIds.includes(s.id)) {
        // Update existing — recalculate available_tickets if max changed
        const sessionUpdate: Record<string, any> = {
          session_date: s.session_date,
          session_time: s.session_time,
          session_end_time: s.session_end_time || null,
          label: s.label || null,
          price_cents: s.price_cents != null ? s.price_cents : null,
          max_tickets: s.max_tickets || 30,
          is_active: true,
        }
        // Adjust available_tickets when max_tickets changes
        const { data: cur } = await supabase
          .from('event_sessions')
          .select('max_tickets, available_tickets')
          .eq('id', s.id)
          .single()
        if (cur) {
          const newMax = s.max_tickets || 30
          const sold = cur.max_tickets - cur.available_tickets
          sessionUpdate.available_tickets = Math.max(0, newMax - sold)
        }
        await supabase.from('event_sessions').update(sessionUpdate).eq('id', s.id)
      } else {
        // Insert new session
        await supabase.from('event_sessions').insert({
          event_id: params.id,
          session_date: s.session_date,
          session_time: s.session_time,
          session_end_time: s.session_end_time || null,
          label: s.label || null,
          price_cents: s.price_cents != null ? s.price_cents : null,
          max_tickets: s.max_tickets || 30,
          available_tickets: s.max_tickets || 30,
          is_active: true,
        })
      }
    }
  }

  // If sessions turned off, deactivate all
  if (body.hasSessions === false) {
    await supabase.from('event_sessions')
      .update({ is_active: false })
      .eq('event_id', params.id)
  }

  return NextResponse.json({ event })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { error } = await supabase
    .from('events')
    .update({ is_active: false })
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ archived: true })
}
