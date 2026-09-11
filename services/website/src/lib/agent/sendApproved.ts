/**
 * The customer send. This is the ONLY module in the codebase that delivers an
 * agent-written message to a customer, and it is deliberately dull:
 *
 *   - NO LLM. Not one model call. The text that goes out is byte-for-byte the
 *     text a human approved (`email_draft` / `sms_draft`). Re-generating here
 *     would mean the customer received something nobody read.
 *   - NO Gmail, ever. Resend for email, Quo for SMS. The Gmail grant (Phase 3)
 *     is read + label only.
 *   - Reachable only from an `approved` draft, and `approved → sent` is a GATED
 *     transition in lib/marketing/graph.ts — so cron, the sweep and the draft
 *     node cannot reach it. Callers are lib/agent/reviewLoop.ts (after verifying
 *     the sender's phone against REVIEWER_PHONES) and the admin Inbox tab.
 *   - Idempotent per channel. `customer_email_sent_at` / `customer_sms_sent_at`
 *     are stamped as each channel succeeds and a stamped channel is skipped, so
 *     a half-failed send can be retried without messaging anyone twice.
 */

import { Resend } from 'resend'
import { getSupabase } from '@/lib/supabase'
import { advance, writeLedger, type Actor } from '@/lib/marketing/graph'
import { sendSMSViaQuo } from '@/lib/quo'
import { normalizePhone } from '@/lib/sms'
import { applySignatureRule } from './draftInquiry'
import { siteUrl } from './config'

type Supa = ReturnType<typeof getSupabase>

export const DRAFT_ENTITY = 'inquiry_draft'

/** Columns sendApprovedDraft needs. Exported so callers can select once. */
export const SEND_COLUMNS =
  'id, review_code, status, party_type, contact_path, draft_kind, channel, subject, email_draft, sms_draft, ' +
  'booking_id, contact_id, inbound_event_id, customer_email_sent_at, customer_sms_sent_at, approved_phrase, approved_by'

export interface SendableDraft {
  id: string
  review_code: string
  status: string
  party_type: string
  contact_path: string
  draft_kind: string | null
  channel: string | null
  subject: string | null
  email_draft: string | null
  sms_draft: string | null
  booking_id: string | null
  contact_id: string | null
  inbound_event_id: string | null
  customer_email_sent_at: string | null
  customer_sms_sent_at: string | null
}

export interface Recipient {
  email: string | null
  phone: string | null
  name: string | null
}

export interface SendResult {
  ok: boolean
  draftId: string
  reviewCode: string
  /** 'sent' when at least one channel landed, 'failed' when none did. */
  emailSent: boolean
  smsSent: boolean
  /** true when the draft moved to 'sent'. */
  closed: boolean
  /** Set when this was a TEST send: nothing was written, nobody was billed. */
  test?: boolean
  recipient: Recipient
  errors: string[]
}

/* ── Recipient resolution ───────────────────────────────────────────── */

/**
 * Who this draft is for. Most specific source first: the party plan (a human
 * has usually corrected it), then the contact record, then whatever the inbound
 * form/message carried.
 */
export async function resolveRecipient(supabase: Supa, draft: SendableDraft): Promise<Recipient> {
  let email: string | null = null
  let phone: string | null = null
  let name: string | null = null

  const take = (e?: unknown, p?: unknown, n?: unknown) => {
    if (!email && typeof e === 'string' && e.includes('@')) email = e.trim()
    if (!phone && typeof p === 'string' && p.replace(/\D/g, '').length >= 10) phone = normalizePhone(p.trim())
    if (!name && typeof n === 'string' && n.trim()) name = n.trim()
  }

  if (draft.booking_id) {
    const { data } = await supabase
      .from('bookings')
      .select('contact_email, contact_phone, contact_name')
      .eq('id', draft.booking_id)
      .maybeSingle()
    take(data?.contact_email, data?.contact_phone, data?.contact_name)
  }

  if (draft.contact_id) {
    const { data } = await supabase
      .from('contacts')
      .select('email, phone, first_name, last_name')
      .eq('id', draft.contact_id)
      .maybeSingle()
    const full = [data?.first_name, data?.last_name].filter(Boolean).join(' ') || null
    take(data?.email, data?.phone, full)
  }

  if (draft.inbound_event_id && (!email || !phone)) {
    const { data } = await supabase
      .from('ingested_messages')
      .select('from_address, parsed')
      .eq('id', draft.inbound_event_id)
      .maybeSingle()
    const p = (data?.parsed ?? {}) as Record<string, unknown>
    take(p.email ?? data?.from_address, p.phone, p.name)
  }

  return { email, phone, name }
}

/* ── Delivery ───────────────────────────────────────────────────────── */

/** Escape for interpolation into the email HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Wrap the approved plain-text body in the site's email shell. The body is the
 * approved text with line breaks preserved — no rewriting, no added copy beyond
 * the shell itself.
 */
export function renderEmailHtml(body: string, opts: { name?: string | null } = {}): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(
      p =>
        `<p style="font-size:15px;line-height:1.8;color:#444;margin:0 0 16px;">${esc(p).replace(/\n/g, '<br />')}</p>`,
    )
    .join('\n    ')

  return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#1a2744;">
  <div style="background:linear-gradient(135deg,#E8C7CB,#F6F1EB);padding:28px;text-align:center;border-radius:12px 12px 0 0;">
    <p style="margin:0;font-size:13px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;color:#1a2744;">Host Hampton</p>
  </div>
  <div style="background:#fff;border:1px solid #edd5d8;border-top:none;padding:28px 32px;border-radius:0 0 12px 12px;">
    ${paragraphs}
    <p style="font-size:13px;line-height:1.7;color:#888;margin:24px 0 0;border-top:1px solid #f0e6e7;padding-top:16px;">
      Host Hampton · Speonk, NY · <a href="tel:+16319989325" style="color:#1a2744;">(631) 998-9325</a> ·
      <a href="${siteUrl()}" style="color:#1a2744;">hosthampton.com</a>
    </p>
  </div>
</div>`
}

async function sendEmail(
  to: string,
  subject: string,
  body: string,
  name: string | null,
): Promise<{ id: string | null; error?: string }> {
  if (!process.env.RESEND_API_KEY) return { id: null, error: 'RESEND_API_KEY is not configured' }
  try {
    const resend = new Resend(process.env.RESEND_API_KEY)
    const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
    const res = await resend.emails.send({
      from,
      to,
      subject,
      html: renderEmailHtml(body, { name }),
      text: body,
    })
    if (res.error) return { id: null, error: res.error.message || 'Resend rejected the message' }
    return { id: res.data?.id ?? null }
  } catch (err) {
    return { id: null, error: err instanceof Error ? err.message : 'Resend send failed' }
  }
}

/* ── Per-channel claim ──────────────────────────────────────────────── */

/**
 * Take exclusive ownership of one channel by stamping its `customer_*_sent_at`
 * BEFORE the send, conditional on it still being null.
 *
 * Postgres serialises the two writers, so exactly one concurrent caller gets a
 * row back and the other is told to stand down. Stamping after the send — as
 * this module originally did — left a window the width of a Resend round-trip
 * in which two callers both saw "not sent yet" and both sent.
 *
 * Returns true when THIS caller won the channel.
 */
async function claimChannel(supabase: Supa, draftId: string, column: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('inquiry_drafts')
    .update({ [column]: new Date().toISOString() })
    .eq('id', draftId)
    .is(column, null)
    .select('id')
  if (error) {
    console.error(`sendApproved claim ${column} failed:`, error.message)
    return false
  }
  return (data ?? []).length === 1
}

/**
 * Give a claimed channel back after a failed send, so a retry can have it.
 * If the process dies between claim and release the channel stays claimed and
 * the draft sits visibly unfinished in Admin → Inbox — the safe direction, since
 * the alternative is a customer receiving the same message twice.
 */
async function releaseChannel(supabase: Supa, draftId: string, column: string): Promise<void> {
  const { error } = await supabase.from('inquiry_drafts').update({ [column]: null }).eq('id', draftId)
  if (error) console.error(`sendApproved release ${column} failed:`, error.message)
}

/* ── The node ───────────────────────────────────────────────────────── */

export interface SendApprovedInput {
  supabase: Supa
  draftId: string
  /** Must carry isAdmin — `approved → sent` is GATED. */
  actor: Actor
  /**
   * TEST send: deliver both channels to the REVIEWER's own handles exactly as
   * the customer would see them, and change nothing. Used by the `TEST` review
   * command (docs/inquiry-response-workflow.md's test-send step).
   */
  testTo?: { phone?: string | null; email?: string | null }
}

export async function sendApprovedDraft(input: SendApprovedInput): Promise<SendResult> {
  const { supabase, draftId } = input
  const isTest = !!input.testTo
  const errors: string[] = []

  const { data, error } = await supabase.from('inquiry_drafts').select(SEND_COLUMNS).eq('id', draftId).maybeSingle()
  if (error || !data) {
    return {
      ok: false,
      draftId,
      reviewCode: '',
      emailSent: false,
      smsSent: false,
      closed: false,
      recipient: { email: null, phone: null, name: null },
      errors: [error?.message || 'Draft not found'],
    }
  }
  const draft = data as unknown as SendableDraft

  // A real send happens only from 'approved'. The graph would refuse the
  // transition anyway; failing here keeps us from messaging a customer and only
  // then discovering the draft was cancelled.
  if (!isTest && draft.status !== 'approved') {
    return {
      ok: false,
      draftId,
      reviewCode: draft.review_code,
      emailSent: false,
      smsSent: false,
      closed: false,
      recipient: { email: null, phone: null, name: null },
      errors: [`Draft is "${draft.status}", not "approved" — nothing sent`],
    }
  }

  const real = await resolveRecipient(supabase, draft)
  const recipient: Recipient = isTest
    ? { email: input.testTo?.email ?? null, phone: input.testTo?.phone ?? null, name: real.name }
    : real

  const channel = draft.channel || 'both'
  const wantEmail = channel !== 'sms' && !!draft.email_draft
  const wantSms = channel !== 'email' && !!draft.sms_draft

  // Belt-and-braces on the standing rule that every customer-facing message
  // names Allie. The approved text normally already does; an admin edit might
  // have removed it.
  const emailBody = applySignatureRule(draft.email_draft || '', { isFirstTouch: true, channel: 'email' })
  const smsBody = applySignatureRule(draft.sms_draft || '', { isFirstTouch: true, channel: 'sms' })
  const subject = draft.subject || 'Your Host Hampton party'

  let emailSent = false
  let smsSent = false
  let emailMessageId: string | null = null
  let smsMessageId: string | null = null
  /** Channels that can never complete — no address, not a transient failure. */
  let emailImpossible = false
  let smsImpossible = false

  // ── Email. Skipped when this channel already landed (retry safety).
  if (wantEmail && (isTest || !draft.customer_email_sent_at)) {
    if (!recipient.email) {
      errors.push('no email address for this draft')
      emailImpossible = true
    } else if (!isTest && !(await claimChannel(supabase, draftId, 'customer_email_sent_at'))) {
      // Another caller is mid-send on this channel. Reading the stamp is not
      // enough on its own: it used to be written AFTER the send, so an admin
      // double-click (or a reaped-then-reclaimed reviewer event overlapping the
      // original run) could put two identical emails in a customer's inbox.
      errors.push('email: already being sent by another run')
    } else {
      const res = await sendEmail(recipient.email, isTest ? `[TEST] ${subject}` : subject, emailBody, recipient.name)
      if (res.id || !res.error) {
        emailSent = true
        emailMessageId = res.id
      } else {
        // Hand the channel back so a retry can have it.
        if (!isTest) await releaseChannel(supabase, draftId, 'customer_email_sent_at')
        errors.push(`email: ${res.error}`)
      }
    }
  }

  // ── SMS.
  if (wantSms && (isTest || !draft.customer_sms_sent_at)) {
    if (!recipient.phone) {
      errors.push('no phone number for this draft')
      smsImpossible = true
    } else if (!isTest && !(await claimChannel(supabase, draftId, 'customer_sms_sent_at'))) {
      errors.push('sms: already being sent by another run')
    } else {
      const id = await sendSMSViaQuo(recipient.phone, isTest ? `[TEST] ${smsBody}` : smsBody)
      if (id) {
        smsSent = true
        smsMessageId = id
      } else {
        if (!isTest) await releaseChannel(supabase, draftId, 'customer_sms_sent_at')
        errors.push('sms: Quo rejected the message (see logs)')
      }
    }
  }

  // ── A TEST send writes nothing. That is the whole point of it.
  if (isTest) {
    return {
      ok: emailSent || smsSent,
      draftId,
      reviewCode: draft.review_code,
      emailSent,
      smsSent,
      closed: false,
      test: true,
      recipient,
      errors,
    }
  }

  const now = new Date().toISOString()
  const alreadyEmailed = !!draft.customer_email_sent_at
  const alreadyTexted = !!draft.customer_sms_sent_at
  // `*Impossible` means "this channel has no address, and never will from this
  // draft" — a permanent condition, not a transient one. Without counting it as
  // done, a both-channel draft for a phone-only contact texted the customer and
  // then sat in 'approved' forever: the nudge only watches 'sent_for_review', so
  // nobody was ever told. It now closes as 'sent' with the reason in send_error.
  const emailDone = !wantEmail || alreadyEmailed || emailSent || emailImpossible
  const smsDone = !wantSms || alreadyTexted || smsSent || smsImpossible
  const anythingLanded = emailSent || smsSent || alreadyEmailed || alreadyTexted

  // The sent_at stamps were written by claimChannel before the send; only the
  // provider message ids are left to record.
  const stamp: Record<string, unknown> = {}
  if (emailSent) stamp.customer_email_message_id = emailMessageId
  if (smsSent) stamp.customer_sms_message_id = smsMessageId
  stamp.send_error = errors.length ? errors.join('; ') : null
  await supabase.from('inquiry_drafts').update(stamp).eq('id', draftId)

  // ── Close the draft only when every channel it covers is done. A partial
  // failure stays 'approved' so it is visibly unfinished and can be retried.
  let closed = false
  if (emailDone && smsDone && anythingLanded) {
    try {
      await advance({
        supabase,
        entity: 'inquiry_draft',
        id: draftId,
        to: 'sent',
        from: 'approved',
        actor: input.actor,
        patch: { sent_at: now },
        meta: {
          job: 'send_approved',
          review_code: draft.review_code,
          email: emailSent || alreadyEmailed,
          sms: smsSent || alreadyTexted,
        },
      })
      closed = true
    } catch (err) {
      errors.push(`status: ${err instanceof Error ? err.message : 'transition failed'}`)
    }
  }

  // ── The plan moves to 'quoted' once a quote has actually gone out.
  if (closed && draft.booking_id && (draft.draft_kind === 'quote' || draft.contact_path === 'quote')) {
    const { data: booking } = await supabase
      .from('bookings')
      .select('status')
      .eq('id', draft.booking_id)
      .maybeSingle()
    if (booking?.status === 'lead') {
      const { error: updErr } = await supabase
        .from('bookings')
        .update({ status: 'quoted' })
        .eq('id', draft.booking_id)
        .eq('status', 'lead')
      if (updErr) errors.push(`booking status: ${updErr.message}`)
    }
  }

  await writeLedger(supabase, {
    entityType: DRAFT_ENTITY,
    entityId: draftId,
    action: 'send',
    actor: input.actor.id,
    toStatus: closed ? 'sent' : 'approved',
    meta: {
      job: 'send_approved',
      review_code: draft.review_code,
      channels: { email: emailSent, sms: smsSent },
      to: { email: recipient.email, phone: recipient.phone },
      errors: errors.length ? errors : undefined,
    },
  })

  return {
    ok: closed,
    draftId,
    reviewCode: draft.review_code,
    emailSent,
    smsSent,
    closed,
    recipient,
    errors,
  }
}
