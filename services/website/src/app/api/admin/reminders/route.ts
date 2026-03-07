import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('scheduled_reminders')
    .select('*, contacts(first_name, last_name, email, phone)')
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ reminders: data || [] })
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = await req.json()
  const { ids } = body as { ids: string[] }

  if (!ids || ids.length === 0) {
    return NextResponse.json({ error: 'No reminder IDs provided' }, { status: 400 })
  }

  const { error } = await supabase
    .from('scheduled_reminders')
    .update({ status: 'cancelled' })
    .in('id', ids)
    .eq('status', 'pending')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, cancelled: ids.length })
}
