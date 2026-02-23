import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const body = await req.json()

  const update: Record<string, unknown> = {}
  if (body.label !== undefined) update.label = body.label
  if (body.slug !== undefined) update.slug = body.slug
  if (body.description !== undefined) update.description = body.description
  if (body.allowedDays !== undefined) update.allowed_days = body.allowedDays
  if (body.slotDurationMin !== undefined) update.slot_duration_min = body.slotDurationMin
  if (body.bufferMin !== undefined) update.buffer_min = body.bufferMin
  if (body.openTime !== undefined) update.open_time = body.openTime
  if (body.closeTime !== undefined) update.close_time = body.closeTime
  if (body.requiresDeposit !== undefined) update.requires_deposit = body.requiresDeposit
  if (body.depositCents !== undefined) update.deposit_cents = body.depositCents
  if (body.minAdvanceDays !== undefined) update.min_advance_days = body.minAdvanceDays
  if (body.tags !== undefined) update.tags = body.tags
  if (body.sortOrder !== undefined) update.sort_order = body.sortOrder
  if (body.isActive !== undefined) update.is_active = body.isActive

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('booking_types')
    .update(update)
    .eq('id', params.id)
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

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const { error } = await supabase
    .from('booking_types')
    .update({ is_active: false })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deactivated: true })
}
