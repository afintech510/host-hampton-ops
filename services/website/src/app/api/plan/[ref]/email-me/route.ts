/**
 * `POST /api/plan/[ref]/email-me` — the customer mails themselves their plan.
 *
 * Self-serve half of Phase 5 item 4. Authorized by the portal cookie for THIS
 * ref, and it sends only to the address stored on the booking — see the header of
 * lib/planShare.ts for why an address is never taken from the request.
 *
 * Rate-limited to one send a minute per plan. The blast radius is already small
 * (the only possible recipient is the plan's own contact), so this is about not
 * letting a double-click, or an impatient customer, put five identical emails in
 * their inbox and five rows in the ledger.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { planAccess } from '@/lib/planAccess'
import { isAdminAuthorized } from '@/lib/adminAuth'
import { loadPlanInvoice } from '@/lib/planInvoice'
import { writeLedger } from '@/lib/marketing/graph'
import { buildPlanSummaryLink, sendPlanSummaryEmail } from '@/lib/planShare'

/** One send a minute per plan. */
const COOLDOWN_MS = 60_000

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  const { ref: rawRef } = await params
  const ref = decodeURIComponent(rawRef || '')
  if (!ref) return NextResponse.json({ error: 'Missing plan reference' }, { status: 400 })

  const access = planAccess(req.headers.get('cookie'), ref)
  if (!access.ok && !isAdminAuthorized(req)) {
    return NextResponse.json({ error: 'Not authorized for this plan' }, { status: 403 })
  }

  const supabase = getSupabase()

  const loaded = await loadPlanInvoice(ref, supabase)
  if (!loaded.ok) {
    if (!loaded.notFound) {
      console.error('plan email-me: invoice load failed:', loaded.error)
      return NextResponse.json({ error: 'Could not read this plan — try again.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }
  const invoice = loaded.invoice
  const to = invoice.booking.contact_email
  if (!to) {
    return NextResponse.json(
      { error: 'We don’t have an email address on this plan yet — please call or text us.' },
      { status: 409 },
    )
  }

  // Cooldown, read off the ledger we are about to write to. A read failure is
  // NOT treated as "no recent send": that would make a blip the way to bypass
  // the limit. It is treated as "cannot tell", and cannot-tell declines.
  const since = new Date(Date.now() - COOLDOWN_MS).toISOString()
  const { data: recent, error: recentErr } = await supabase
    .from('marketing_ledger')
    .select('id')
    .eq('entity_type', 'booking')
    .eq('entity_id', invoice.booking.id)
    .eq('action', 'send')
    .gte('created_at', since)
    .limit(1)
  if (recentErr) {
    console.error('plan email-me: cooldown check failed:', recentErr.message)
    return NextResponse.json({ error: 'Could not send just now — try again.' }, { status: 503 })
  }
  if ((recent ?? []).length > 0) {
    return NextResponse.json(
      { error: 'We just sent that — check your inbox, and try again in a minute.' },
      { status: 429 },
    )
  }

  const link = await buildPlanSummaryLink(invoice.booking.id, ref, supabase)
  if (!link.ok) {
    return NextResponse.json({ error: link.reason }, { status: link.retryable ? 503 : 500 })
  }

  const sent = await sendPlanSummaryEmail({ to, invoice, url: link.url, note: null })
  if (!sent.ok) return NextResponse.json({ error: sent.reason }, { status: 502 })

  await writeLedger(supabase, {
    entityType: 'booking',
    entityId: invoice.booking.id,
    action: 'send',
    actor: `portal:${ref}`,
    meta: { job: 'plan_summary_email', via: 'email_me', channel: 'email', to },
  })

  return NextResponse.json({ ok: true, sentTo: to })
}
