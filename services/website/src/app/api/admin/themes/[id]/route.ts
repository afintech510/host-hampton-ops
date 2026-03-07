import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const body = await req.json()

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) update.name = body.name
  if (body.slug !== undefined) update.slug = body.slug
  if (body.priceCents !== undefined) update.price_cents = body.priceCents
  if (body.tag !== undefined) update.tag = body.tag || null
  if (body.description !== undefined) update.description = body.description
  if (body.extendedDescription !== undefined) update.extended_description = body.extendedDescription
  if (body.images !== undefined) update.images = body.images
  if (body.sortOrder !== undefined) update.sort_order = body.sortOrder
  if (body.isActive !== undefined) update.is_active = body.isActive

  const { data, error } = await supabase
    .from('party_themes')
    .update(update)
    .eq('id', params.id)
    .select()
    .single()

  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return NextResponse.json({ error: 'A theme with this slug already exists' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ theme: data })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()
  const { error } = await supabase
    .from('party_themes')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deactivated: true })
}
