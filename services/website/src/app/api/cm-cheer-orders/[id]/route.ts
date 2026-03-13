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
  const { status, status_note } = body

  const validStatuses = ['pending_payment', 'paid', 'cancelled']
  if (!status || !validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('cm_cheer_orders')
    .update({ status, status_note: status_note || null, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .select('id, order_ref, status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true, order: data })
}
