import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { sendCampaign, sendTransactionalEmail, cancelCampaign } from '@/lib/brevo'
import { sendBulkSMS } from '@/lib/twilio'

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
    // CLAIM FIRST, then read. This used to be a plain SELECT followed by a send,
    // so two clicks on "Send" (or a double-submit) both saw `draft`, both called
    // Brevo, and 944 real people got the same campaign twice. The conditional
    // UPDATE is the lock: only one caller can move a row out of a sendable
    // status, and the row it gets back is the row it owns.
    const { data: claimed, error: claimErr } = await supabase
      .from('scheduled_campaigns')
      .update({ status: 'sending' })
      .eq('id', id)
      .in('status', ['draft', 'scheduled'])
      .select('*')

    if (claimErr) {
      return NextResponse.json({ error: `Could not claim the campaign: ${claimErr.message}` }, { status: 503 })
    }

    const campaign = claimed?.[0]
    if (!campaign) {
      // Either there is no such campaign, or it is not in a sendable state —
      // which, on this route, usually means somebody already pressed Send.
      const { data: existing } = await supabase
        .from('scheduled_campaigns').select('status').eq('id', id).maybeSingle()
      if (!existing) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
      return NextResponse.json(
        { error: `This campaign is "${existing.status}" — it is not waiting to be sent.`, status: existing.status },
        { status: 409 }
      )
    }

    if (campaign.campaign_type === 'email' || campaign.campaign_type === 'event_update') {
      const listId = body.listId ? parseInt(body.listId, 10) : parseInt(process.env.BREVO_DEFAULT_LIST_ID || '0', 10)
      if (!listId) {
        return NextResponse.json({ error: 'BREVO_DEFAULT_LIST_ID not configured' }, { status: 500 })
      }

      const result = await sendCampaign(
        listId,
        campaign.subject,
        campaign.body_html || '<p>No content</p>',
        'Host Hampton',
        campaign.scheduled_for || undefined
      )

      if (result.kind === 'failed') {
        await supabase.from('scheduled_campaigns').update({ status: 'failed' }).eq('id', id)
        return NextResponse.json({ error: `Failed to send via Brevo: ${result.error}` }, { status: 500 })
      }

      if (result.kind === 'created_not_sent') {
        // The campaign EXISTS at Brevo. Recording this as `sent` was the old
        // behaviour and it is a lie in the one direction that matters: Adam
        // would believe 944 people heard from him. It is also not `failed`,
        // because retrying would create a second campaign.
        await supabase
          .from('scheduled_campaigns')
          .update({ status: 'failed', brevo_campaign_id: String(result.id) })
          .eq('id', id)
        console.error(`admin:campaigns Brevo campaign ${result.id} was CREATED but not sent: ${result.error}`)
        return NextResponse.json(
          {
            error:
              `Brevo created campaign ${result.id} but did not send it (${result.error}). ` +
              `It exists in your Brevo dashboard — send or delete it there. Do NOT press Send again, that would make a second campaign.`,
            brevo_campaign_id: result.id,
          },
          { status: 502 }
        )
      }

      await supabase
        .from('scheduled_campaigns')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          brevo_campaign_id: String(result.id),
        })
        .eq('id', id)

      return NextResponse.json({ ok: true, brevo_campaign_id: result.id })
    }

    // SMS campaign send via Twilio
    if (campaign.campaign_type === 'sms') {
      const segmentFilter = campaign.target_segment === 'sms_opted_in' ? 'sms_opt_in' : 'sms_opt_in'

      const { data: contacts, error: contactsErr } = await supabase
        .from('contacts')
        .select('phone')
        .eq(segmentFilter, true)
        .not('phone', 'is', null)

      if (contactsErr || !contacts?.length) {
        await supabase.from('scheduled_campaigns').update({ status: 'failed' }).eq('id', id)
        return NextResponse.json({ error: 'No SMS-opted-in contacts found' }, { status: 400 })
      }

      const seen = new Set<string>()
      const smsContacts = contacts
        .filter(c => c.phone)
        .map(c => {
          const normalized = c.phone!.replace(/[^\d+]/g, '')
          const to = normalized.startsWith('+') ? normalized : `+1${normalized}`
          return { phone: to, body: campaign.body_text || '' }
        })
        .filter(c => {
          if (seen.has(c.phone)) return false
          seen.add(c.phone)
          return true
        })

      const mediaUrls = campaign.media_urls && campaign.media_urls.length > 0
        ? campaign.media_urls
        : undefined

      const results = await sendBulkSMS(smsContacts, 1000, mediaUrls)
      const successCount = results.filter(r => r !== null).length

      await supabase.from('scheduled_campaigns').update({
        status: 'sent',
        sent_at: new Date().toISOString(),
        total_recipients: smsContacts.length,
      }).eq('id', id)

      return NextResponse.json({ ok: true, sent: successCount, total: smsContacts.length })
    }

    return NextResponse.json({ error: 'Unknown campaign type' }, { status: 400 })
  }

  // Update draft fields
  const allowed: Record<string, any> = {}
  if (body.subject !== undefined) allowed.subject = body.subject
  if (body.body_html !== undefined) allowed.body_html = body.body_html
  if (body.body_text !== undefined) allowed.body_text = body.body_text
  if (body.media_urls !== undefined) allowed.media_urls = Array.isArray(body.media_urls) && body.media_urls.length > 0 ? body.media_urls : null
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
