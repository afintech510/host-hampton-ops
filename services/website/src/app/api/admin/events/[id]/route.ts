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

  if (body.priceCents !== undefined) update.price_cents = body.priceCents
  if (body.siblingPriceCents !== undefined) update.sibling_price_cents = body.siblingPriceCents
  if (body.hasVariants !== undefined) update.has_variants = body.hasVariants
  if (body.variants !== undefined) update.variants = body.variants

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
