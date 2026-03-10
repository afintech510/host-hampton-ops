import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()

  // Use raw SQL for accurate counts with status filters
  const { data, error } = await supabase.rpc('exec_sql', {
    query: `
      SELECT es.*,
        (SELECT count(*) FROM email_sequence_steps WHERE sequence_id = es.id) as step_count,
        (SELECT count(*) FROM contact_sequence_enrollments WHERE sequence_id = es.id AND status = 'active') as active_enrollments,
        (SELECT count(*) FROM contact_sequence_enrollments WHERE sequence_id = es.id AND status = 'completed') as completed_enrollments
      FROM email_sequences es ORDER BY es.created_at
    `,
  })

  // Fall back to supabase-js query if RPC is not available
  if (error) {
    const { data: sequences, error: seqErr } = await supabase
      .from('email_sequences')
      .select('*')
      .order('created_at', { ascending: true })

    if (seqErr) {
      return NextResponse.json({ error: seqErr.message }, { status: 500 })
    }

    return NextResponse.json({ sequences: sequences || [] })
  }

  return NextResponse.json({ sequences: data || [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = await req.json()

  const { name, trigger_event, service_filter, is_active } = body

  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (!trigger_event) {
    return NextResponse.json({ error: 'trigger_event is required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('email_sequences')
    .insert({
      name,
      trigger_event,
      service_filter: service_filter || null,
      is_active: is_active !== undefined ? is_active : true,
      total_emails: 0,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ sequence: data })
}
