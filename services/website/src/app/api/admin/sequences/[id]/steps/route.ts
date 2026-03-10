import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const { id } = params
  const body = await req.json()

  const { step_number, delay_days, delay_reference, subject, body_html, cta_text, cta_url } = body

  if (!step_number || delay_days === undefined || !subject || !body_html) {
    return NextResponse.json(
      { error: 'step_number, delay_days, subject, and body_html are required' },
      { status: 400 }
    )
  }

  // Insert the new step
  const { data: step, error: stepErr } = await supabase
    .from('email_sequence_steps')
    .insert({
      sequence_id: id,
      step_number,
      delay_days,
      delay_reference: delay_reference || 'enrollment',
      subject,
      body_html,
      cta_text: cta_text || null,
      cta_url: cta_url || null,
    })
    .select()
    .single()

  if (stepErr) {
    return NextResponse.json({ error: stepErr.message }, { status: 500 })
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

  return NextResponse.json({ step })
}
