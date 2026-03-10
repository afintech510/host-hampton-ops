import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { id } = params

  // Fetch sequence
  const { data: sequence, error: seqErr } = await supabase
    .from('email_sequences')
    .select('*')
    .eq('id', id)
    .single()

  if (seqErr) {
    return NextResponse.json({ error: seqErr.message }, { status: 404 })
  }

  // Fetch steps ordered by step_number
  const { data: steps, error: stepsErr } = await supabase
    .from('email_sequence_steps')
    .select('*')
    .eq('sequence_id', id)
    .order('step_number', { ascending: true })

  if (stepsErr) {
    return NextResponse.json({ error: stepsErr.message }, { status: 500 })
  }

  // Fetch recent 20 enrollments with contact info
  const { data: enrollments, error: enrollErr } = await supabase
    .from('contact_sequence_enrollments')
    .select('*, contacts(first_name, last_name, email)')
    .eq('sequence_id', id)
    .order('enrolled_at', { ascending: false })
    .limit(20)

  if (enrollErr) {
    return NextResponse.json({ error: enrollErr.message }, { status: 500 })
  }

  return NextResponse.json({
    sequence,
    steps: steps || [],
    enrollments: enrollments || [],
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { id } = params
  const body = await req.json()

  const allowed = ['name', 'trigger_event', 'service_filter', 'is_active']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }

  for (const key of allowed) {
    if (body[key] !== undefined) {
      updates[key] = body[key]
    }
  }

  const { data, error } = await supabase
    .from('email_sequences')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ sequence: data })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { id } = params

  const { error } = await supabase
    .from('email_sequences')
    .delete()
    .eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
