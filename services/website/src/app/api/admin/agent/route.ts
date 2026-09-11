import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { draftForInquiry, DRAFT_ENTITY } from '@/lib/agent/draftInquiry'
import { finishEvent, type InboundEvent } from '@/lib/agent/events'
import { agentEnabled, draftModel } from '@/lib/agent/config'
import { ownerEmail, reviewerPhones } from '@/lib/ownerNotify'
import { advance, writeLedger } from '@/lib/marketing/graph'
import { sendApprovedDraft } from '@/lib/agent/sendApproved'

export const dynamic = 'force-dynamic'

/**
 * Admin Inbox — the fallback surface for when the phone is inconvenient.
 *
 * GET  → inbound events + drafts + recent agent activity.
 * POST → approve / dismiss / edit a draft, or draft an event by hand.
 *
 * Approving and sending are deliberately TWO actions, here as over SMS:
 * "approve" marks the draft approved and stops; "send" runs the deterministic
 * send (lib/agent/sendApproved.ts), which is the only code that can move a draft
 * to 'sent'. Both go through advance() in lib/marketing/graph.ts, where
 * 'approved' and 'sent' are GATED and therefore require the authenticated admin
 * actor this route has already established.
 */

const DRAFT_COLUMNS =
  'id, review_code, status, party_type, contact_path, draft_kind, channel, missing_fields, subject, email_draft, sms_draft, error, reviewer_phone, booking_id, contact_id, inbound_event_id, approved_at, sent_at, created_at, updated_at'

const EVENT_COLUMNS =
  'id, source, external_id, direction, from_address, subject, body, parsed, status, classification, contact_id, booking_id, draft_id, error, created_at, handled_at'

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()
  const supabase = getSupabase()

  const [events, drafts, ledger] = await Promise.all([
    supabase
      .from('ingested_messages')
      .select(EVENT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('inquiry_drafts')
      .select(DRAFT_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('marketing_ledger')
      .select('id, entity_type, entity_id, action, actor, from_status, to_status, cost_usd, tokens, meta, created_at')
      .eq('entity_type', DRAFT_ENTITY)
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  return NextResponse.json({
    enabled: agentEnabled(),
    model: draftModel(),
    reviewerPhoneCount: reviewerPhones().length,
    events: events.data || [],
    drafts: drafts.data || [],
    ledger: ledger.data || [],
    // Surfaced so a missing migration reads as a clear message, not an empty tab.
    errors: [events.error?.message, drafts.error?.message].filter(Boolean),
  })
}

interface ActionBody {
  action: 'approve' | 'dismiss' | 'edit' | 'draft' | 'send' | 'test'
  id?: string
  emailDraft?: string
  smsDraft?: string
  subject?: string
  note?: string
}

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const body = (await req.json()) as ActionBody
  const supabase = getSupabase()

  if (!body.action) return NextResponse.json({ error: 'action is required' }, { status: 400 })
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // ── Draft an event by hand (covers phone leads and re-running a failure).
  if (body.action === 'draft') {
    if (!agentEnabled()) {
      return NextResponse.json({ error: 'AGENT_ENABLED is off — turn it on to draft' }, { status: 409 })
    }
    const { data: event, error } = await supabase
      .from('ingested_messages')
      .select(EVENT_COLUMNS)
      .eq('id', body.id)
      .maybeSingle()
    if (error || !event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    const outcome = await draftForInquiry({ supabase, event: event as unknown as InboundEvent, actor: 'ADMIN' })
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })

    await finishEvent(supabase, body.id, 'handled', { draftId: outcome.draftId, classification: 'lead' })
    return NextResponse.json({ ok: true, draftId: outcome.draftId, reviewCode: outcome.reviewCode })
  }

  // ── Draft actions.
  const { data: draft, error: readErr } = await supabase
    .from('inquiry_drafts')
    .select('id, status, review_code, email_draft, sms_draft, revisions')
    .eq('id', body.id)
    .maybeSingle()

  if (readErr || !draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  const from = draft.status as string
  const revisions = Array.isArray(draft.revisions) ? draft.revisions : []
  // An authenticated admin request IS the human gate for this surface.
  const actor = { id: 'ADMIN', isAdmin: true }
  let patch: Record<string, unknown>
  let to: string

  // ── Transitions that go through the graph (approve / dismiss / send).
  if (body.action === 'approve' || body.action === 'dismiss') {
    const target = body.action === 'approve' ? 'approved' : 'cancelled'
    try {
      await advance({
        supabase,
        entity: 'inquiry_draft',
        id: body.id,
        to: target,
        from,
        actor,
        patch:
          target === 'approved'
            ? {
                approved_at: new Date().toISOString(),
                approved_phrase: 'admin-ui:approve',
                approved_by: 'admin:ui',
              }
            : { reviewer_note: body.note ?? null },
        meta: { review_code: draft.review_code, via: 'admin_inbox', action: body.action },
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'transition failed'
      return NextResponse.json({ error: msg }, { status: 409 })
    }
    return NextResponse.json({
      ok: true,
      id: body.id,
      status: target,
      // Approving still sends nothing. "send" is a separate, explicit action.
      sentToCustomer: false,
    })
  }

  if (body.action === 'send' || body.action === 'test') {
    const isTest = body.action === 'test'
    if (!isTest && from !== 'approved') {
      return NextResponse.json(
        { error: `Approve the draft before sending it (it is "${from}")` },
        { status: 409 },
      )
    }
    const result = await sendApprovedDraft({
      supabase,
      draftId: body.id,
      actor,
      ...(isTest ? { testTo: { email: ownerEmail(), phone: reviewerPhones()[0] ?? null } } : {}),
    })
    return NextResponse.json(
      {
        ok: result.ok,
        id: body.id,
        status: result.closed ? 'sent' : from,
        test: isTest,
        emailSent: result.emailSent,
        smsSent: result.smsSent,
        sentToCustomer: !isTest && (result.emailSent || result.smsSent),
        recipient: result.recipient,
        errors: result.errors,
      },
      { status: result.ok ? 200 : 502 },
    )
  }

  switch (body.action) {
    case 'edit': {
      if (from === 'sent' || from === 'cancelled') {
        return NextResponse.json({ error: `Cannot edit a draft that is "${from}"` }, { status: 409 })
      }
      const emailDraft = body.emailDraft ?? draft.email_draft
      const smsDraft = body.smsDraft ?? draft.sms_draft
      to = 'sent_for_review'
      patch = {
        status: to,
        email_draft: emailDraft,
        sms_draft: smsDraft,
        reviewer_note: body.note ?? null,
        // The guardrail hold is cleared by a human taking ownership of the text.
        error: null,
        // Editing an already-approved draft un-approves it: the approval was for
        // the old words. And the edited text gets a fresh 2-hour nudge clock.
        approved_at: null,
        approved_by: null,
        approved_phrase: null,
        sent_for_review_at: new Date().toISOString(),
        nudged_at: null,
        ...(body.subject ? { subject: body.subject } : {}),
        revisions: [
          ...revisions,
          {
            at: new Date().toISOString(),
            actor: 'admin',
            note: body.note ?? 'edited in admin',
            email_draft: emailDraft,
            sms_draft: smsDraft,
          },
        ],
      }
      break
    }
    default:
      return NextResponse.json({ error: `Unknown action "${body.action}"` }, { status: 400 })
  }

  const { error: updErr } = await supabase.from('inquiry_drafts').update(patch).eq('id', body.id)
  if (updErr) {
    console.error('admin/agent update error:', updErr.message)
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  await writeLedger(supabase, {
    entityType: DRAFT_ENTITY,
    entityId: body.id,
    action: 'transition',
    actor: 'ADMIN',
    fromStatus: from,
    toStatus: to,
    meta: { review_code: draft.review_code, via: 'admin_inbox', action: body.action },
  })

  return NextResponse.json({
    ok: true,
    id: body.id,
    status: to,
    // Explicit so nobody reads an edit as a send.
    sentToCustomer: false,
  })
}
