import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const status = req.nextUrl.searchParams.get('status')

  let query = supabase
    .from('scheduled_campaigns')
    .select('*')
    .order('created_at', { ascending: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ campaigns: data || [] })
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const supabase = getSupabase()
  const body = await req.json()

  const { campaign_type, subject, body_html, body_text, target_segment, scheduled_for } = body

  if (!subject) {
    return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  }

  const status = scheduled_for ? 'scheduled' : 'draft'

  const { data, error } = await supabase
    .from('scheduled_campaigns')
    .insert({
      campaign_type: campaign_type || 'email',
      subject,
      body_html: body_html || null,
      body_text: body_text || null,
      target_segment: target_segment || null,
      status,
      scheduled_for: scheduled_for || null,
    })
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ campaign: data })
}
