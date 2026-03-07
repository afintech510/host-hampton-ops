import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()

  const [contactRes, interactionsRes, remindersRes] = await Promise.all([
    supabase.from('contacts').select('*').eq('id', id).single(),
    supabase
      .from('contact_interactions')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('scheduled_reminders')
      .select('*')
      .eq('contact_id', id)
      .eq('status', 'pending')
      .order('scheduled_for', { ascending: true }),
  ])

  if (!contactRes.data) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
  }

  return NextResponse.json({
    contact: contactRes.data,
    interactions: interactionsRes.data || [],
    reminders: remindersRes.data || [],
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()
  const body = await req.json()

  const allowed: Record<string, any> = {}
  if (body.status !== undefined) allowed.status = body.status
  if (body.notes !== undefined) allowed.notes = body.notes
  if (body.email_opt_in !== undefined) allowed.email_opt_in = body.email_opt_in
  if (body.sms_opt_in !== undefined) allowed.sms_opt_in = body.sms_opt_in

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await supabase.from('contacts').update(allowed).eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
