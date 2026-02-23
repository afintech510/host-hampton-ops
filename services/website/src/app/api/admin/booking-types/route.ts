import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('booking_types')
    .select('*')
    .order('sort_order')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ types: data || [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const body = await req.json()

  if (!body.label) {
    return NextResponse.json({ error: 'Label is required' }, { status: 400 })
  }

  const slug = (body.slug || body.label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const { data, error } = await supabase
    .from('booking_types')
    .insert({
      slug,
      label: body.label,
      description: body.description || null,
      allowed_days: body.allowedDays || [0, 1, 2, 3, 4, 5, 6],
      slot_duration_min: body.slotDurationMin || 60,
      buffer_min: body.bufferMin || 0,
      open_time: body.openTime || null,
      close_time: body.closeTime || null,
      requires_deposit: body.requiresDeposit ?? false,
      deposit_cents: body.depositCents || 0,
      min_advance_days: body.minAdvanceDays || 1,
      tags: body.tags || [],
      sort_order: body.sortOrder || 0,
      is_active: body.isActive !== false,
    })
    .select()
    .single()

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return NextResponse.json({ error: 'A booking type with this slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ type: data })
}
