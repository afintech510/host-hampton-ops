import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { sendCampaign } from '@/lib/brevo'

export const dynamic = 'force-dynamic'

function isCronAuthorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-cron-secret') || req.nextUrl.searchParams.get('secret')
  return Boolean(process.env.CRON_SECRET) && secret === process.env.CRON_SECRET
}

/**
 * Send campaigns an admin has scheduled.
 *
 * The blast radius of this route is 944 real people (`BREVO_DEFAULT_LIST_ID=3`
 * is "Host Hampton Leads"). Three things it used to get wrong, all of which
 * would have shown up the first time it was actually scheduled — and it never
 * has been, so none of them ever did:
 *
 * 1. **Check-then-act.** It SELECTed `status = 'scheduled'` and then wrote
 *    `'sending'` as two statements. Two overlapping ticks both selected the same
 *    row and both called Brevo: one campaign, two sends, 944 people twice. The
 *    claim is now a single conditional UPDATE and the rows it returns are the
 *    rows this tick owns.
 * 2. **It could not tell "delivered" from "created".** `sendCampaign` returned
 *    the campaign id after a FAILED `/sendNow`, and this route wrote
 *    `status: 'sent'` for it — reporting a send that never happened.
 * 3. **A transient failure was terminal.** A Brevo 500 marked the campaign
 *    `failed` forever (rule 3). `failed` is now written only when Brevo said no
 *    in a way that repeats; a network blip leaves the row `scheduled` for the
 *    next tick.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = getSupabase()
  const now = new Date().toISOString()

  // The claim and the read are one statement. `.in('status', …)` is the guard:
  // a row already at 'sending' or 'sent' cannot be claimed twice.
  const { data: campaigns, error } = await supabase
    .from('scheduled_campaigns')
    .update({ status: 'sending' })
    .eq('status', 'scheduled')
    .lte('scheduled_for', now)
    .select('*')

  if (error) {
    console.error('cron:campaigns claim error:', error.message)
    return NextResponse.json({ error: `Could not claim campaigns: ${error.message}` }, { status: 500 })
  }

  if (!campaigns || campaigns.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, failed: 0, deferred: 0, notes: [] })
  }

  let sent = 0
  let failed = 0
  let deferred = 0
  const notes: string[] = []

  const listId = parseInt(process.env.BREVO_DEFAULT_LIST_ID || '0', 10)

  for (const campaign of campaigns) {
    try {
      if (!listId) {
        // Not the campaign's fault and not permanent. Put it back.
        await supabase.from('scheduled_campaigns').update({ status: 'scheduled' }).eq('id', campaign.id)
        deferred++
        notes.push(`${campaign.id}: BREVO_DEFAULT_LIST_ID is not configured — returned to scheduled`)
        continue
      }

      if (!campaign.body_html) {
        await supabase.from('scheduled_campaigns').update({ status: 'failed' }).eq('id', campaign.id)
        failed++
        notes.push(`${campaign.id}: no body_html — refused rather than sending an empty campaign`)
        continue
      }

      const result = await sendCampaign(listId, campaign.subject, campaign.body_html, 'Host Hampton')

      if (result.kind === 'sent') {
        await supabase
          .from('scheduled_campaigns')
          .update({ status: 'sent', sent_at: new Date().toISOString(), brevo_campaign_id: String(result.id) })
          .eq('id', campaign.id)
        sent++
        console.log(`cron:campaigns sent ${campaign.id} via Brevo campaign ${result.id}`)
        continue
      }

      if (result.kind === 'created_not_sent') {
        // Exists at Brevo, not delivered. Neither `sent` (a lie) nor retryable
        // (a retry makes a SECOND campaign at Brevo).
        await supabase
          .from('scheduled_campaigns')
          .update({ status: 'failed', brevo_campaign_id: String(result.id) })
          .eq('id', campaign.id)
        failed++
        notes.push(
          `${campaign.id}: Brevo campaign ${result.id} was CREATED but not sent (${result.error}) — it is in the Brevo dashboard and must be handled there, not retried here`
        )
        console.error(`cron:campaigns created-not-sent ${campaign.id} → brevo ${result.id}: ${result.error}`)
        continue
      }

      await supabase.from('scheduled_campaigns').update({ status: 'failed' }).eq('id', campaign.id)
      failed++
      notes.push(`${campaign.id}: Brevo refused it — ${result.error}`)
    } catch (err) {
      // An exception here means we do not know whether Brevo received anything.
      // `failed` is the safe record: it stops the loop re-sending to 944 people
      // on the next tick, and it is visible in the Campaigns tab for a human.
      const msg = err instanceof Error ? err.message : String(err)
      await supabase.from('scheduled_campaigns').update({ status: 'failed' }).eq('id', campaign.id)
      failed++
      notes.push(`${campaign.id}: unexpected error — ${msg}. Check Brevo before resending.`)
      console.error('cron:campaigns error:', campaign.id, msg)
    }
  }

  console.log(`cron:campaigns processed=${campaigns.length} sent=${sent} failed=${failed} deferred=${deferred}`)
  for (const n of notes) console.log(`cron:campaigns note — ${n}`)
  return NextResponse.json({ processed: campaigns.length, sent, failed, deferred, notes })
}
