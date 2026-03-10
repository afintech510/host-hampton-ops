import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; stepId: string } }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { stepId } = params
  const body = await req.json()

  const allowed = ['delay_days', 'delay_reference', 'subject', 'body_html', 'cta_text', 'cta_url']
  const updates: Record<string, unknown> = {}

  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates[key] = body[key]
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('email_sequence_steps')
    .update(updates)
    .eq('id', stepId)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ step: data })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; stepId: string } }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { id, stepId } = params

  // Delete the step
  const { error } = await supabase
    .from('email_sequence_steps')
    .delete()
    .eq('id', stepId)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Update total_emails on the parent sequence
  const { count } = await supabase
    .from('email_sequence_steps')
    .select('*', { count: 'exact', head: true })
    .eq('sequence_id', id)

  await supabase
    .from('email_sequences')
    .update({ total_emails: count || 0, updated_at: new Date().toISOString() })
    .eq('id', id)

  return NextResponse.json({ ok: true })
}
