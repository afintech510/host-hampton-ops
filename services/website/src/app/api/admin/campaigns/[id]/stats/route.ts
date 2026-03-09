import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { getCampaignStats } from '@/lib/brevo'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { id } = await params
  const supabase = getSupabase()

  const { data: campaign } = await supabase
    .from('scheduled_campaigns')
    .select('brevo_campaign_id, status')
    .eq('id', id)
    .single()

  if (!campaign?.brevo_campaign_id) {
    return NextResponse.json({ error: 'No Brevo campaign ID' }, { status: 404 })
  }

  const stats = await getCampaignStats(campaign.brevo_campaign_id)
  if (!stats) {
    return NextResponse.json({ error: 'Failed to fetch stats from Brevo' }, { status: 502 })
  }

  const g = stats.statistics?.globalStats
  const result = {
    brevoStatus: stats.status,
    sent: g?.sent ?? 0,
    delivered: g?.delivered ?? 0,
    opened: g?.uniqueViews ?? 0,
    clicked: g?.uniqueClicks ?? 0,
    bounced: (g?.hardBounces ?? 0) + (g?.softBounces ?? 0),
    unsubscribed: g?.unsubscriptions ?? 0,
  }

  // Persist stats to DB (non-blocking)
  supabase
    .from('scheduled_campaigns')
    .update({
      total_recipients: result.sent,
      opened: result.opened,
      clicked: result.clicked,
      bounced: result.bounced,
      unsubscribed: result.unsubscribed,
    })
    .eq('id', id)
    .then(() => {})

  return NextResponse.json(result)
}
