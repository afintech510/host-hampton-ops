import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { adminActorId, isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { draftForInquiry, redraftForReviewer, planStatusOf, DRAFT_ENTITY } from '@/lib/agent/draftInquiry'
import { tonePresetNote } from '@/lib/agent/tonePresets'
import { finishEvent, type InboundEvent } from '@/lib/agent/events'
import { agentEnabled, draftModel, reviewLinkSecret } from '@/lib/agent/config'
import { generateReviewToken } from '@/lib/agent/reviewLink'
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
  'id, review_code, status, party_type, contact_path, draft_kind, channel, missing_fields, subject, email_draft, sms_draft, error, reviewer_phone, booking_id, contact_id, inbound_event_id, approved_at, sent_at, sent_for_review_at, created_at, updated_at'

const EVENT_COLUMNS =
  'id, source, external_id, direction, from_address, subject, body, parsed, status, classification, contact_id, booking_id, draft_id, error, sent_at, created_at, handled_at'

/**
 * Everything the Inbox needs to answer "what is this party?" without leaving the
 * page. Deliberately the same column set the lead workspace reads — a reviewer
 * comparing the two surfaces should never see different facts.
 */
const PLAN_DETAIL_COLUMNS =
  'id, booking_ref, status, contact_name, contact_email, contact_phone, party_date, party_time, ' +
  'guest_count_approx, child_name, child_age, event_type, package_type, party_tags, notes, admin_notes, ' +
  'total_cents, deposit_amount, balance_due_cents, source'

/**
 * The original message is shown verbatim, so it is capped here rather than in
 * the browser: a Gmail thread with a quoted history underneath can run to tens
 * of kilobytes, and fifty of them is the whole page's payload.
 */
const MAX_INQUIRY_BODY_CHARS = 4000

/** Unique, non-null ids from a column of draft rows. Empty means "skip the query". */
function idsFrom(rows: Record<string, unknown>[], key: string): string[] {
  // `Array.from`, not a spread: this tsconfig targets below es2015.
  return Array.from(new Set(rows.map(r => r[key]).filter(Boolean))) as string[]
}

/**
 * A message older than this is history, not an inquiry. "Draft now" needs
 * ?force=1 past it.
 */
const STALE_DRAFT_MS = 30 * 24 * 60 * 60 * 1000

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

  // Who each draft is FOR, and what party it is about. The Inbox showed a review
  // code and a party type but never the inquiry itself, so deciding whether a
  // draft was right meant opening the lead page for every row. Three extra
  // queries for the whole page, not three per row.
  const draftRows = (drafts.data || []) as unknown as Record<string, unknown>[]
  const bookingIds = idsFrom(draftRows, 'booking_id')
  const contactIds = idsFrom(draftRows, 'contact_id')
  const inboundIds = idsFrom(draftRows, 'inbound_event_id')

  type PlanRow = Record<string, unknown> & { id: string }
  type ContactRow = {
    id: string
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
  }
  type InquiryRow = Record<string, unknown> & { id: string }

  const [planRes, contactRes, inboundRes] = await Promise.all([
    bookingIds.length
      ? supabase.from('bookings').select(PLAN_DETAIL_COLUMNS).in('id', bookingIds)
      : Promise.resolve({ data: [], error: null }),
    contactIds.length
      ? supabase.from('contacts').select('id, first_name, last_name, email, phone').in('id', contactIds)
      : Promise.resolve({ data: [], error: null }),
    inboundIds.length
      ? supabase
          .from('ingested_messages')
          .select('id, source, from_address, subject, body, parsed, sent_at, created_at')
          .in('id', inboundIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  const plans: Record<string, PlanRow> = Object.fromEntries(
    (((planRes.data || []) as unknown) as PlanRow[]).map(p => [p.id, p]),
  )
  const contacts: Record<string, ContactRow> = Object.fromEntries(
    (((contactRes.data || []) as unknown) as ContactRow[]).map(c => [c.id, c]),
  )
  const inquiries: Record<string, InquiryRow> = Object.fromEntries(
    (((inboundRes.data || []) as unknown) as InquiryRow[]).map(m => [m.id, m]),
  )

  /**
   * What we know about the party behind one draft, from all three sources.
   *
   * A plan column wins when it holds something, because that is the row the
   * quote is built from; the contact row and the inbound message fill the gaps
   * for a draft that has no plan yet (the info-gather case, which is exactly the
   * case where a reviewer most needs to see what the customer actually said).
   *
   * A read FAILURE is reported as such and never as an absent field — showing an
   * empty "Email —" for a booking that has one is how a reviewer concludes a
   * customer is unreachable and dismisses a live lead.
   */
  function detailsFor(d: Record<string, unknown>) {
    const plan = d.booking_id ? (plans[d.booking_id as string] ?? null) : null
    const contact = d.contact_id ? (contacts[d.contact_id as string] ?? null) : null
    const inbound = d.inbound_event_id ? (inquiries[d.inbound_event_id as string] ?? null) : null
    const contactName = [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || null

    const pick = <T,>(...vals: (T | null | undefined)[]): T | null => {
      for (const v of vals) {
        if (v !== null && v !== undefined && v !== '') return v
      }
      return null
    }

    const body = typeof inbound?.body === 'string' ? inbound.body : null
    const tags = (plan?.party_tags as Record<string, unknown> | null) ?? null

    return {
      // Could not be answered, as distinct from answered "nothing".
      unavailable: [
        d.booking_id && planRes.error ? 'plan' : null,
        d.contact_id && contactRes.error ? 'contact' : null,
        d.inbound_event_id && inboundRes.error ? 'inquiry' : null,
      ].filter(Boolean) as string[],
      name: pick(plan?.contact_name as string | null, contactName),
      email: pick(
        plan?.contact_email as string | null,
        contact?.email ?? null,
        // Only an email-sourced event's `from_address` is an email address.
        inbound?.source === 'email' ? ((inbound?.from_address as string | null) ?? null) : null,
      ),
      phone: pick(
        plan?.contact_phone as string | null,
        contact?.phone ?? null,
        inbound?.source === 'sms' ? ((inbound?.from_address as string | null) ?? null) : null,
      ),
      party_date: (plan?.party_date as string | null) ?? null,
      party_time: (plan?.party_time as string | null) ?? null,
      guest_count: (plan?.guest_count_approx as number | null) ?? null,
      child_name: (plan?.child_name as string | null) ?? null,
      child_age: (plan?.child_age as number | null) ?? null,
      event_type: (plan?.event_type as string | null) ?? null,
      package_type: (plan?.package_type as string | null) ?? null,
      notes: (plan?.notes as string | null) ?? null,
      admin_notes: (plan?.admin_notes as string | null) ?? null,
      source: (plan?.source as string | null) ?? null,
      total_cents: (plan?.total_cents as number | null) ?? null,
      deposit_amount: (plan?.deposit_amount as number | null) ?? null,
      balance_due_cents: (plan?.balance_due_cents as number | null) ?? null,
      // Theme, location address and any un-parseable requested date the intake
      // form kept verbatim all live here — see lib/plan.ts.
      tags: tags && Object.keys(tags).length ? tags : null,
      /** The message that started this, in the customer's own words. */
      inquiry: inbound
        ? {
            source: (inbound.source as string | null) ?? null,
            from: (inbound.from_address as string | null) ?? null,
            subject: (inbound.subject as string | null) ?? null,
            body: body ? body.slice(0, MAX_INQUIRY_BODY_CHARS) : null,
            truncated: !!body && body.length > MAX_INQUIRY_BODY_CHARS,
            parsed: (inbound.parsed as Record<string, unknown> | null) ?? null,
            received_at: (inbound.sent_at as string | null) || ((inbound.created_at as string | null) ?? null),
          }
        : null,
    }
  }

  return NextResponse.json({
    enabled: agentEnabled(),
    model: draftModel(),
    reviewerPhoneCount: reviewerPhones().length,
    events: events.data || [],
    drafts: draftRows.map(d => ({
      ...d,
      // Absent when the draft has no plan row, or when the plan could not be
      // read — the Inbox shows nothing rather than an empty name.
      booking_ref: d.booking_id ? ((plans[d.booking_id as string]?.booking_ref as string | null) ?? null) : null,
      contact_name: d.booking_id ? ((plans[d.booking_id as string]?.contact_name as string | null) ?? null) : null,
      // An OPEN draft whose plan has been cancelled is a live hazard, not a
      // curiosity: approving it sends a customer a quote for a party that was
      // called off. Production had two of these the day this was written —
      // duplicate plans got cancelled, and the drafts hanging off them did not.
      booking_status: d.booking_id ? ((plans[d.booking_id as string]?.status as string | null) ?? null) : null,
      // The inquiry itself — dates, guests, theme, notes and the customer's own
      // words — so the draft can be judged against it without leaving the page.
      details: detailsFor(d),
    })),
    ledger: ledger.data || [],
    // Surfaced so a missing migration reads as a clear message, not an empty tab.
    errors: [
      events.error?.message,
      drafts.error?.message,
      // A detail lookup that failed is said out loud too: the panel below would
      // otherwise render a read failure as a party with no date and no guests.
      planRes.error ? `plan details: ${planRes.error.message}` : null,
      contactRes.error ? `contact details: ${contactRes.error.message}` : null,
      inboundRes.error ? `original inquiries: ${inboundRes.error.message}` : null,
    ].filter(Boolean),
  })
}

interface ActionBody {
  action: 'approve' | 'dismiss' | 'edit' | 'draft' | 'send' | 'test' | 'revise'
  id?: string
  emailDraft?: string
  smsDraft?: string
  subject?: string
  note?: string
  /** Tone chip ids (lib/agent/tonePresets.ts), for `revise`. */
  toneIds?: string[]
}

/**
 * The reviewer's instruction is capped before it reaches the prompt. The model
 * call slices to 600 anyway; this is the cap on what gets STORED in
 * `reviewer_note` and echoed back into `revisions[]`.
 */
const MAX_NOTE_CHARS = 2000

/**
 * Turn a chat-composer submission into the single `note` string that
 * `redraftForReviewer()` takes — the same parameter an SMS instruction lands in.
 *
 * ── The fencing question this function exists to answer ──────────────────
 *
 * `reviewer_note` is interpolated into the draft prompt as a TRUSTED owner
 * instruction ("the owner reviewed your draft and asked for this change"). The
 * composer is a BRAND-NEW writer of that field, and the rule is that a field is
 * hostile because of who can WRITE it, not which block it prints in. So: who
 * can write it here? Only a request that passed `isAdminAuthorized` — the
 * shared password or a session cookie this server signed. That is the same
 * trust level as `REVIEWER_PHONES` on the SMS path, which is what licenses the
 * field staying trusted. Nothing a CUSTOMER types can reach it: the chips are
 * authored constants (an unknown id is dropped, never echoed as free text), and
 * the free-text box is behind the admin gate.
 *
 * If that ever changes — if a customer-visible surface gains a "ask for a
 * change" box — this is the function that has to grow a fence, and the prompt
 * in draftInquiry.ts has to stop calling the note trusted.
 */
function composeReviseNote(body: ActionBody): string {
  const chips = (Array.isArray(body.toneIds) ? body.toneIds : [])
    .map(id => tonePresetNote(String(id)))
    .filter((n): n is string => !!n)
  const typed = (body.note ?? '').trim()
  return [...chips, typed].filter(Boolean).join(' ').slice(0, MAX_NOTE_CHARS)
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

    // The cron path refuses events older than 24h. This one had no age check at
    // all, and the 12-month Gmail backfill put 270 historical messages into the
    // Inbox tab — every one of them with a "Draft now" button and, until the
    // sent_at fix, a created_at of today. Clicking one would have written a
    // fresh reply to a question from 2024. The admin is a human and may
    // override, but not by accident: it takes ?force=1.
    const sentAt = (event as { sent_at?: string | null; created_at?: string }).sent_at
    const age = Date.now() - new Date(sentAt || (event as { created_at: string }).created_at).getTime()
    const forced = req.nextUrl.searchParams.get('force') === '1'
    if (age > STALE_DRAFT_MS && !forced) {
      const days = Math.round(age / 86_400_000)
      return NextResponse.json(
        {
          error: `This message is ${days} days old — drafting a reply to it now would surprise the recipient. Re-send with ?force=1 if you mean it.`,
          stale: true,
          ageDays: days,
        },
        { status: 409 },
      )
    }

    const outcome = await draftForInquiry({ supabase, event: event as unknown as InboundEvent, actor: adminActorId(req) })
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status })

    await finishEvent(supabase, body.id, 'handled', { draftId: outcome.draftId, classification: 'lead' })
    return NextResponse.json({ ok: true, draftId: outcome.draftId, reviewCode: outcome.reviewCode })
  }

  // ── Draft actions.
  const { data: draft, error: readErr } = await supabase
    .from('inquiry_drafts')
    .select('id, status, review_code, email_draft, sms_draft, revisions, error, booking_id')
    .eq('id', body.id)
    .maybeSingle()

  // Three outcomes, not two (rule 12).
  if (readErr) return NextResponse.json({ error: `Could not read the draft: ${readErr.message}` }, { status: 503 })
  if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

  // ── A cancelled PARTY does not get a reply approved or sent about it.
  //
  // This route's own GET already says it: "an OPEN draft whose plan has been
  // cancelled is a live hazard, not a curiosity: approving it sends a customer a
  // quote for a party that was called off. Production had two of these the day
  // this was written." It surfaced `booking_status` for the UI and then refused
  // nothing — so the hazard was displayed to a human and left executable by the
  // same request. Plan §4.6's stand-down now binds this surface too.
  //
  // `edit`, `dismiss` and `revise` are deliberately still allowed: dropping such
  // a draft or tidying it up is exactly what somebody should be able to do.
  if (body.action === 'approve' || body.action === 'send' || body.action === 'test') {
    const plan = await planStatusOf(supabase, draft.booking_id as string | null)
    if (plan.standDown) {
      return NextResponse.json(
        {
          error: `This draft is for a ${plan.status} party (${plan.ref ?? 'no ref'}). Dismiss the draft, or re-open the plan first.`,
          planStatus: plan.status,
          bookingRef: plan.ref,
        },
        { status: 409 },
      )
    }
  }

  const from = draft.status as string
  const revisions = Array.isArray(draft.revisions) ? draft.revisions : []
  // An authenticated admin request IS the human gate for this surface.
  // `isAdmin` is unchanged and unconditional — this route is already behind
  // isAdminAuthorized. What migration 038 adds is the NAME: a signed session
  // names the person (`admin:allie@…`), and the shared password still falls
  // back to the historical anonymous 'ADMIN'. Plan §11.1: the ledger has to be
  // able to say who approved a message to a customer.
  const actor = { id: adminActorId(req), isAdmin: true }
  let patch: Record<string, unknown>
  let to: string
  /** Set by `edit`, which rotates the preview token — see below. */
  let mintedPreviewPath: string | null = null

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
                approved_by: adminActorId(req),
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

  // ── REVISE: the chat composer. Plan §11.3.
  //
  // This calls the SAME `redraftForReviewer()` the SMS loop calls, with the
  // same "record the note before spending a model call on it" ordering. One
  // re-draft path, two surfaces — an instruction typed here and one texted in
  // land in the same `revisions[]` and pass the same guardrails. A parallel
  // implementation here is how the two would drift until only one of them was
  // still checking for fabricated terms.
  if (body.action === 'revise') {
    if (!agentEnabled()) {
      return NextResponse.json({ error: 'AGENT_ENABLED is off — turn it on to re-draft' }, { status: 409 })
    }
    const note = composeReviseNote(body)
    if (!note) {
      return NextResponse.json({ error: 'Say what to change, or tap a tone chip' }, { status: 400 })
    }
    if (from === 'sent' || from === 'cancelled') {
      return NextResponse.json({ error: `Cannot revise a draft that is "${from}"` }, { status: 409 })
    }

    await advance({
      supabase,
      entity: 'inquiry_draft',
      id: body.id,
      to: 'revision_requested',
      from,
      actor,
      patch: { reviewer_note: note },
      meta: { via: 'admin_lead', job: 'review_loop', note, tone_ids: body.toneIds ?? [] },
    }).catch(err => {
      // Already 'revision_requested' is a legal no-op. An illegal transition is
      // worth seeing in the log but is not worth losing the note over.
      console.warn('admin revise transition:', err instanceof Error ? err.message : err)
    })

    const res = await redraftForReviewer({ supabase, draftId: body.id, note, actor: actor.id })
    if (!res.ok) {
      return NextResponse.json(
        // The note is already saved above, so say so — a failure that looks
        // like it lost the instruction is what sends someone off to retype it.
        { error: `${res.error}. Your note is saved on the draft.`, noteSaved: true },
        { status: res.status },
      )
    }
    return NextResponse.json({
      ok: true,
      id: body.id,
      status: 'sent_for_review',
      reviewCode: res.reviewCode,
      reviewersTexted: res.reviewersTexted,
      costUsd: res.costUsd,
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
      // Rotate the preview token, for the same two reasons a re-draft does:
      // the old link now shows superseded text, and — since the TTL is measured
      // from `sent_for_review_at` — reusing the old token here would silently
      // grant it another seven days every time someone fixed a typo.
      const secret = reviewLinkSecret()
      const minted = secret ? generateReviewToken(draft.review_code as string, secret) : null
      // The old link is now dead, so the caller is HANDED the replacement
      // rather than left to discover a 404 later. A guardrail that retires
      // something has to say that it retired it.
      mintedPreviewPath = minted ? `/review/${encodeURIComponent(minted.token)}` : null
      // The guardrail hold is cleared by a human taking ownership of the TEXT —
      // and that means the text has to have actually changed.
      //
      // It used to be cleared unconditionally, which made `{action:'edit', id}`
      // with no fields at all — or with only a new `subject` — launder a parked
      // draft: `error` went null, the status went to `sent_for_review`, and the
      // flagged bytes were never touched. The one class of draft that exists
      // because a human must read it first could be released without reading it,
      // by a request that edited nothing. Rule 10 in miniature: the guardrail
      // stopped saying it had stopped anything, over a change that changed
      // nothing.
      const textChanged = emailDraft !== draft.email_draft || smsDraft !== draft.sms_draft
      const heldBack = typeof draft.error === 'string' && draft.error.trim() !== ''
      if (heldBack && !textChanged) {
        return NextResponse.json(
          {
            error: `This draft is held back (${String(draft.error).slice(0, 160)}). Change the email or SMS text to release it — editing the subject alone does not clear the hold.`,
            heldBack: true,
          },
          { status: 409 },
        )
      }
      patch = {
        status: to,
        ...(minted ? { preview_token_hash: minted.hash } : {}),
        email_draft: emailDraft,
        sms_draft: smsDraft,
        reviewer_note: body.note ?? null,
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
            actor: adminActorId(req),
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
    actor: actor.id,
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
    ...(mintedPreviewPath ? { previewPath: mintedPreviewPath } : {}),
  })
}
