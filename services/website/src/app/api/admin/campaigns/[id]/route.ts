import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { sendCampaign, sendTransactionalEmail, cancelCampaign } from '@/lib/brevo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()

  const { data, error } = await supabase
    .from('scheduled_campaigns')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  return NextResponse.json({ campaign: data })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()
  const body = await req.json()

  // Test email send
  if (body.action === 'test') {
    const { testEmail } = body
    if (!testEmail) return NextResponse.json({ error: 'testEmail required' }, { status: 400 })

    const { data: campaign } = await supabase
      .from('scheduled_campaigns')
      .select('subject, body_html')
      .eq('id', id)
      .single()

    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    const ok = await sendTransactionalEmail(
      testEmail,
      `[TEST] ${campaign.subject}`,
      campaign.body_html || '<p>No content</p>'
    )

    if (!ok) return NextResponse.json({ error: 'Failed to send test email via Brevo' }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  // Cancel campaign (works for draft, scheduled, sending — also suspends in Brevo)
  if (body.action === 'cancel') {
    const { data: campaign } = await supabase
      .from('scheduled_campaigns')
      .select('status, brevo_campaign_id')
      .eq('id', id)
      .single()

    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    if (campaign.brevo_campaign_id) {
      await cancelCampaign(campaign.brevo_campaign_id)
    }

    await supabase.from('scheduled_campaigns').update({ status: 'cancelled' }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  // If sending now
  if (body.status === 'sending') {
    const { data: campaign } = await supabase
      .from('scheduled_campaigns')
      .select('*')
      .eq('id', id)
      .single()

    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
    }

    if (campaign.campaign_type === 'email') {
      const listId = body.listId ? parseInt(body.listId, 10) : parseInt(process.env.BREVO_DEFAULT_LIST_ID || '0', 10)
      if (!listId) {
        return NextResponse.json({ error: 'BREVO_DEFAULT_LIST_ID not configured' }, { status: 500 })
      }

      const brevoCampaignId = await sendCampaign(
        listId,
        campaign.subject,
        campaign.body_html || '<p>No content</p>',
        'Host Hampton',
        campaign.scheduled_for || undefined
      )

      if (!brevoCampaignId) {
        await supabase.from('scheduled_campaigns').update({ status: 'failed' }).eq('id', id)
        return NextResponse.json({ error: 'Failed to send via Brevo' }, { status: 500 })
      }

      await supabase
        .from('scheduled_campaigns')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          brevo_campaign_id: brevoCampaignId,
        })
        .eq('id', id)

      return NextResponse.json({ ok: true, brevo_campaign_id: brevoCampaignId })
    }

    // SMS campaigns would go here when Twilio is configured
    return NextResponse.json({ error: 'SMS campaigns not yet supported' }, { status: 400 })
  }

  // Update draft fields
  const allowed: Record<string, any> = {}
  if (body.subject !== undefined) allowed.subject = body.subject
  if (body.body_html !== undefined) allowed.body_html = body.body_html
  if (body.body_text !== undefined) allowed.body_text = body.body_text
  if (body.target_segment !== undefined) allowed.target_segment = body.target_segment
  if (body.scheduled_for !== undefined) {
    allowed.scheduled_for = body.scheduled_for
    allowed.status = body.scheduled_for ? 'scheduled' : 'draft'
  }
  if (body.status === 'cancelled') allowed.status = 'cancelled'

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  const { error } = await supabase.from('scheduled_campaigns').update(allowed).eq('id', id)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()

  const { error } = await supabase
    .from('scheduled_campaigns')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .in('status', ['draft', 'scheduled'])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
