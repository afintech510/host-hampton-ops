import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { sendCampaign } from '@/lib/brevo'

export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return secret === process.env.CRON_SECRET
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const now = new Date().toISOString()

  // Fetch campaigns that are scheduled and due
  const { data: campaigns, error } = await supabase
    .from('scheduled_campaigns')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_for', now)
    .order('scheduled_for')
    .limit(5)

  if (error || !campaigns) {
    console.error('cron:campaigns fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch campaigns' }, { status: 500 })
  }

  if (campaigns.length === 0) {
    return NextResponse.json({ processed: 0 })
  }

  let sent = 0
  let failed = 0

  for (const campaign of campaigns) {
    try {
      // Mark as sending
      await supabase.from('scheduled_campaigns')
        .update({ status: 'sending' })
        .eq('id', campaign.id)

      // Get opted-in contacts
      const { data: contacts, error: contactsErr } = await supabase
        .from('contacts')
        .select('email')
        .eq('email_opt_in', true)
        .not('email', 'is', null)

      if (contactsErr || !contacts?.length) {
        await supabase.from('scheduled_campaigns')
          .update({ status: 'failed' })
          .eq('id', campaign.id)
        failed++
        continue
      }

      // Send via Brevo
      // Brevo sends to a list — we need to ensure contacts are synced to a list
      // For now, use list ID from campaign's target_segment or default list
      const listId = parseInt(process.env.BREVO_DEFAULT_LIST_ID || '1', 10)

      const result = await sendCampaign(
        listId,
        campaign.subject,
        campaign.body_html,
        'Host Hampton',
      )

      if (result) {
        await supabase.from('scheduled_campaigns').update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          brevo_campaign_id: String(result),
        }).eq('id', campaign.id)
        sent++
      } else {
        await supabase.from('scheduled_campaigns')
          .update({ status: 'failed' })
          .eq('id', campaign.id)
        failed++
      }

      console.log(`cron:campaign sent campaign ${campaign.id} via Brevo (id=${result})`)
    } catch (err) {
      console.error('cron:campaign error:', campaign.id, err)
      await supabase.from('scheduled_campaigns')
        .update({ status: 'failed' })
        .eq('id', campaign.id)
      failed++
    }
  }

  console.log(`cron:campaigns processed ${sent} sent, ${failed} failed`)
  return NextResponse.json({ processed: campaigns.length, sent, failed })
}
