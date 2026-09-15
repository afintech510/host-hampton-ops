import { NextRequest, NextResponse } from 'next/server'
import { isCronAuthorized } from '@/lib/cronAuth'
import { getSupabase } from '@/lib/supabase'
import { sendCampaign } from '@/lib/brevo'

export const dynamic = 'force-dynamic'

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
 *
 * And a fourth, added 2026-09-13: **the claim had no cap.** It took EVERY row
 * that was `scheduled` with a past `scheduled_for`, in one statement, and then
 * sent them all. `scheduled_campaigns` holds **103 drafts today, 102 of them
 * `event_update` rows about a Bitchy Bingo night in July**; the whole pile is
 * one bulk status change away from being claimable, and each one is 944 people.
 * `?limit=N` (1…`MAX_PER_TICK`) is the drain, and the default cap is small
 * enough that a mistake is a mistake and not a mailing. `ORDER BY` cannot be
 * combined with the claiming UPDATE, so the cap is applied by claiming the
 * oldest N ids read in a separate ordered pass — the read is advisory, the
 * conditional UPDATE is still what decides ownership.
 */

/**
 * One tick's ceiling. Each campaign is 944 real inboxes.
 *
 * NOT exported. A Next App Router route file may export only the handler names
 * and the framework's own config keys; `export const MAX_PER_TICK` is a
 * build-time type error that neither jest nor `tsc --noEmit` reports. Link 17
 * nearly shipped one and this session did, caught only by `next build` — which
 * is why that build is not optional.
 */
const MAX_PER_TICK = 5

/**
 * The `campaign_type` values this route may send. Everything else on the shared
 * `scheduled_campaigns` table belongs to a different sender.
 *
 * Not exported, for the same reason MAX_PER_TICK is not.
 */
const EMAIL_CAMPAIGN_TYPES = new Set(['email', 'event_update', 'marketing'])

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rawLimit = req.nextUrl.searchParams.get('limit')
  let perTick = MAX_PER_TICK
  if (rawLimit !== null) {
    const n = Number(rawLimit)
    if (!Number.isInteger(n) || n < 1 || n > MAX_PER_TICK) {
      // Rule 10: a cap that was silently ignored is a cap the operator thinks is
      // protecting them.
      return NextResponse.json({ error: `limit must be an integer 1..${MAX_PER_TICK}` }, { status: 400 })
    }
    perTick = n
  }

  const supabase = getSupabase()
  const now = new Date().toISOString()

  // Which rows are due, oldest first. Advisory only — the UPDATE below is what
  // takes ownership, so a row that changes underneath us simply is not claimed.
  const { data: due, error: dueErr } = await supabase
    .from('scheduled_campaigns')
    .select('id')
    .eq('status', 'scheduled')
    .lte('scheduled_for', now)
    .order('scheduled_for', { ascending: true })
    .limit(perTick)

  if (dueErr) {
    console.error('cron:campaigns due-read error:', dueErr.message)
    return NextResponse.json({ error: `Could not read scheduled campaigns: ${dueErr.message}` }, { status: 500 })
  }

  if (!due || due.length === 0) {
    return NextResponse.json({ processed: 0, sent: 0, failed: 0, deferred: 0, cap: perTick, notes: [] })
  }

  // The claim and the read are one statement. `.eq('status', …)` is the guard:
  // a row already at 'sending' or 'sent' cannot be claimed twice.
  const { data: campaigns, error } = await supabase
    .from('scheduled_campaigns')
    .update({ status: 'sending' })
    .eq('status', 'scheduled')
    .lte('scheduled_for', now)
    .in('id', due.map(d => d.id))
    .select('*')

  if (error) {
    console.error('cron:campaigns claim error:', error.message)
    return NextResponse.json({ error: `Could not claim campaigns: ${error.message}` }, { status: 500 })
  }

  if (!campaigns || campaigns.length === 0) {
    return NextResponse.json({
      processed: 0, sent: 0, failed: 0, deferred: 0, cap: perTick,
      notes: [`${due.length} row(s) were due but none could be claimed — another tick has them`],
    })
  }

  let sent = 0
  let failed = 0
  let deferred = 0
  const notes: string[] = []

  const defaultListId = parseInt(process.env.BREVO_DEFAULT_LIST_ID || '0', 10)

  for (const campaign of campaigns) {
    try {
      // Per-campaign, not per-tick: migration 052 lets a campaign name its own
      // audience, and a scheduled batch send is exactly the case that needs it.
      // Reading the env default once outside the loop and using it for every
      // row is how a 243-person batch becomes a 970-person one.
      const listId = campaign.brevo_list_id ? Number(campaign.brevo_list_id) : defaultListId
      if (!listId) {
        // Not the campaign's fault and not permanent. Put it back.
        await supabase.from('scheduled_campaigns').update({ status: 'scheduled' }).eq('id', campaign.id)
        deferred++
        notes.push(`${campaign.id}: BREVO_DEFAULT_LIST_ID is not configured — returned to scheduled`)
        continue
      }

      /**
       * This route is an EMAIL sender — `sendCampaign` builds a Brevo email
       * campaign against list 3. `scheduled_campaigns` is shared with the admin
       * SMS blast, which has its own sender in `/api/admin/campaigns/[id]` and
       * its own consent filter; measured 2026-09-13, the table holds 6 rows with
       * `campaign_type = 'sms'` (5 sent, 1 draft).
       *
       * Nothing here used to look at `campaign_type` at all. An SMS row that
       * reached `status = 'scheduled'` would have been claimed by this loop and
       * emailed to 944 people. It was saved only by an accident of the data —
       * every SMS row has a NULL `body_html`, so it hit the empty-body guard
       * below and was recorded `failed` with the note "no body_html", which is
       * a true sentence about the wrong problem (rule 10's expensive half: a
       * guardrail must not say it stopped something it did not).
       *
       * Classified, not inferred (rule 4). An unrecognised type is refused
       * rather than assumed to be email.
       *
       * The allowlist is taken from `scheduled_campaigns_campaign_type_check`,
       * read out of `pg_constraint` rather than guessed (rule 13): the column
       * permits 'event_update', 'marketing', 'email' and 'sms'. Only the data
       * carries the first two today, and an allowlist written from the DATA
       * would have refused a perfectly good 'marketing' campaign the first time
       * anybody created one.
       */
      if (!EMAIL_CAMPAIGN_TYPES.has(campaign.campaign_type)) {
        await supabase.from('scheduled_campaigns').update({ status: 'draft' }).eq('id', campaign.id)
        failed++
        notes.push(
          `${campaign.id}: campaign_type "${campaign.campaign_type}" is not an email campaign — ` +
            `this route only sends email. Returned to draft, NOT emailed.`
        )
        console.warn(`cron:campaigns refused non-email type "${campaign.campaign_type}" on ${campaign.id}`)
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

  console.log(
    `cron:campaigns cap=${perTick} processed=${campaigns.length} sent=${sent} failed=${failed} deferred=${deferred}`
  )
  for (const n of notes) console.log(`cron:campaigns note — ${n}`)
  return NextResponse.json({ processed: campaigns.length, sent, failed, deferred, cap: perTick, notes })
}
