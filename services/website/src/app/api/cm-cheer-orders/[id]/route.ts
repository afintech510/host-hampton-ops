import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const CM_PASSWORD = process.env.CM_CHEER_PASSWORD || 'cmcheer2026'

function isAuthorized(req: NextRequest): boolean {
  const auth = req.headers.get('authorization')
  return auth === `Bearer ${CM_PASSWORD}`
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { status, status_note, notes } = body

  // If only updating notes (no status change)
  if (notes !== undefined && !status) {
    const supabase = getSupabase()
    const { data, error } = await supabase
      .from('cm_cheer_orders')
      .update({ notes, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .select('id, order_ref, notes')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, order: data })
  }

  const validStatuses = ['pending_payment', 'paid', 'cancelled']
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const supabase = getSupabase()
  const updatePayload: Record<string, unknown> = { status, status_note: status_note || null, updated_at: new Date().toISOString() }
  if (notes !== undefined) updatePayload.notes = notes
  const { data, error } = await supabase
    .from('cm_cheer_orders')
    .update(updatePayload)
    .eq('id', params.id)
    .select('id, order_ref, status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, order: data })
}
