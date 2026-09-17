/**
 * `POST /api/admin/plan/[ref]/send` — "Send to client" (Phase 5 item 4).
 *
 * A deliberate human action, and built so that it cannot be anything else:
 *
 *   * `isAdminAuthorized(req)` — fails closed. No cron, LLM, webhook or sweep
 *     holds an admin credential, so none of them can reach this.
 *   * `confirm: true` must be in the body. A stray or replayed call without it
 *     does nothing. This is cheap, and the thing on the other side of it is
 *     "message a customer".
 *   * `adminActorId(req)` names who did it — `admin:<email>` from the signed
 *     cookie, and the historical anonymous `'ADMIN'` on the shared password.
 *     Both admins have claimed accounts, so this is a real name in the ledger.
 *
 * It does NOT touch `inquiry_drafts`, so `approved` and `sent` stay the gated
 * edges in lib/marketing/graph.ts. This sends a link to the plan document, which
 * an admin has been looking at, to the address on that plan. It is not a route
 * around draft review, and per-user login makes it attributable — never easier
 * to reach.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadPlanInvoice } from '@/lib/planInvoice'
import { writeLedger } from '@/lib/marketing/graph'
import { buildPlanSummaryLink, sendPlanSummaryEmail, planSummarySms } from '@/lib/planShare'
import { isPlausibleEmailAddress } from '@/lib/contactLookup'
import { sendSMSVia } from '@/lib/sms'

type Channel = 'email' | 'sms' | 'both'

function isChannel(v: unknown): v is Channel {
  return v === 'email' || v === 'sms' || v === 'both'
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ ref: string }> }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const { ref: rawRef } = await params
  const ref = decodeURIComponent(rawRef || '')
  if (!ref) return NextResponse.json({ error: 'Missing plan reference' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as {
    channel?: unknown
    confirm?: unknown
    note?: unknown
    cc?: unknown
  }

  if (body.confirm !== true) {
    return NextResponse.json({ error: 'Sending to a client must be confirmed' }, { status: 400 })
  }
  const channel: Channel = isChannel(body.channel) ? body.channel : 'email'
  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim().slice(0, 2000) : null

  /**
   * Colleagues to copy. A corporate booking is usually two people — Gusto's NYC
   * activation is Rhiannon plus Camden — and they should read one thread, not
   * two.
   *
   * REFUSED, not filtered: a bad address here means the admin mistyped the one
   * they meant, and silently dropping it would send the quote to one person
   * while reporting that both had it (rule 10). Capped at four so this cannot
   * become a mailing list, and de-duplicated against `to` inside
   * `sendPlanSummaryEmail`.
   */
  const ccRaw = Array.isArray(body.cc) ? body.cc : body.cc === undefined ? [] : [body.cc]
  if (ccRaw.length > 4) {
    return NextResponse.json({ error: 'At most 4 cc addresses' }, { status: 400 })
  }
  const bad = ccRaw.filter(a => !isPlausibleEmailAddress(a))
  if (bad.length) {
    return NextResponse.json(
      { error: `Not a valid email address: ${bad.map(String).join(', ')} — nothing was sent.` },
      { status: 400 },
    )
  }
  const cc = (ccRaw as string[]).map(a => a.trim())

  const supabase = getSupabase()

  const loaded = await loadPlanInvoice(ref, supabase)
  if (!loaded.ok) {
    if (!loaded.notFound) {
      console.error('admin plan send: invoice load failed:', loaded.error)
      return NextResponse.json({ error: 'Could not read this plan — try again.' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
  }
  const invoice = loaded.invoice

  // A cancelled plan is not a quote. Sending one tells a customer their
  // cancelled party is on, which is worse than the admin having to un-cancel it
  // first. Rule 10 — the refusal says so, in the ledger as well as the response.
  if (invoice.booking.status === 'cancelled') {
    await writeLedger(supabase, {
      entityType: 'booking',
      entityId: invoice.booking.id,
      action: 'note',
      actor: adminActorId(req),
      meta: { job: 'plan_send_refused', reason: 'plan_cancelled', channel },
    })
    return NextResponse.json(
      { error: 'This plan is cancelled — un-cancel it before sending it to the client.' },
      { status: 409 },
    )
  }

  const wantsEmail = channel === 'email' || channel === 'both'
  const wantsSms = channel === 'sms' || channel === 'both'
  const to = invoice.booking.contact_email
  const phone = invoice.booking.contact_phone
  if (wantsEmail && !to) {
    return NextResponse.json({ error: 'This plan has no email address' }, { status: 409 })
  }
  if (wantsSms && !phone) {
    return NextResponse.json({ error: 'This plan has no phone number' }, { status: 409 })
  }

  const link = await buildPlanSummaryLink(invoice.booking.id, ref, supabase)
  if (!link.ok) {
    return NextResponse.json({ error: link.reason }, { status: link.retryable ? 503 : 500 })
  }

  const actor = adminActorId(req)
  const results: string[] = []
  const failures: string[] = []

  if (wantsEmail && to) {
    const sent = await sendPlanSummaryEmail({ to, cc, invoice, url: link.url, note })
    if (sent.ok) {
      results.push(cc.length ? `Email sent to ${to} (cc ${cc.join(', ')})` : `Email sent to ${to}`)
      await writeLedger(supabase, {
        entityType: 'booking',
        entityId: invoice.booking.id,
        action: 'send',
        actor,
        meta: {
          job: 'plan_summary_email', via: 'admin_send', channel: 'email', to,
          // Who else received it is part of "who was told what", so it belongs
          // in the ledger rather than only in the admin's memory.
          ...(cc.length ? { cc } : {}),
          had_note: note !== null,
        },
      })
    } else {
      failures.push(sent.reason)
    }
  }

  if (wantsSms && phone) {
    const sid = await sendSMSVia('quo', phone, planSummarySms(invoice, link.url))
    if (sid) {
      results.push(`Text sent to ${phone}`)
      await writeLedger(supabase, {
        entityType: 'booking',
        entityId: invoice.booking.id,
        action: 'send',
        actor,
        meta: { job: 'plan_summary_sms', via: 'admin_send', channel: 'sms', to: phone, message_id: sid },
      })
    } else {
      failures.push('Text failed to send')
    }
  }

  // Partial success is reported as such rather than rounded to "sent": an admin
  // who thinks the client has the quote when only the text went out will not
  // follow up.
  if (results.length === 0) {
    return NextResponse.json({ error: failures.join('; ') || 'Nothing was sent' }, { status: 502 })
  }
  return NextResponse.json({ ok: true, results, failures })
}
