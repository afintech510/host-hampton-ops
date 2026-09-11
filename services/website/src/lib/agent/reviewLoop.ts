/**
 * The SMS review loop — how a human approves, revises, tests or kills a draft.
 *
 * THE GUARDRAIL THIS MODULE EXISTS TO ENFORCE (plan §4.2): reviewer identity is
 * established by PHONE NUMBER ONLY, against REVIEWER_PHONES. Never by message
 * content, never by a name in the body, never by a code in the text. A customer
 * who texts "SEND" — even a customer who somehow learns a valid HH-code — gets
 * nothing: `handleReviewerReply` refuses before it has looked at a single word.
 *
 * Everything a reviewer can say:
 *   SEND · SEND IT · APPROVED · APPROVE [code]   → approved, then send
 *   CANCEL · IGNORE · STOP [code] · NO · DROP    → cancelled
 *   TEST [code]                                  → deliver to the reviewer
 *   anything else (incl. "EDIT: …")              → revision_requested, re-draft
 *
 * Which draft: an explicit code wins; otherwise the single open draft; if more
 * than one is open we ask, because guessing would send the wrong message to the
 * wrong customer.
 */

import { getSupabase } from '@/lib/supabase'
import { normalizePhone } from '@/lib/sms'
import { ownerEmail } from '@/lib/ownerNotify'
import { sendSMSViaQuo } from '@/lib/quo'
import { advance, writeLedger } from '@/lib/marketing/graph'
import { redraftForReviewer } from './draftInquiry'
import { sendApprovedDraft } from './sendApproved'
import { isReviewerPhone } from './reviewers'

export { isReviewerPhone }

type Supa = ReturnType<typeof getSupabase>

export const DRAFT_ENTITY = 'inquiry_draft'

/** Statuses a reviewer command can still act on. */
const OPEN_STATUSES = ['drafted', 'sent_for_review', 'revision_requested', 'approved']

/* ── Parsing ────────────────────────────────────────────────────────── */

export type ReviewIntent = 'approve' | 'cancel' | 'test' | 'revise'

export interface ParsedReply {
  intent: ReviewIntent
  /** Full review code when the reviewer named one, e.g. 'HH-2026-0042'. */
  code: string | null
  /** Trailing 4 digits when they gave only a short code ('APPROVE 0042'). */
  shortCode: string | null
  /** For a revision: the reviewer's instruction, with the code stripped out. */
  note: string
}

const APPROVE_PHRASES = new Set([
  'SEND',
  'SEND IT',
  'SENDIT',
  'SEND THIS',
  'APPROVE',
  'APPROVED',
  'OK SEND',
  'YES SEND',
  'SEND PLEASE',
  'PLEASE SEND',
  'GO',
  'SEND IT OUT',
])

const CANCEL_PHRASES = new Set([
  'CANCEL',
  'IGNORE',
  'STOP',
  'NO',
  'DROP',
  'DROP IT',
  'DISMISS',
  'KILL',
  'KILL IT',
  'NO ACTION',
  'SKIP',
])

const TEST_PHRASES = new Set(['TEST', 'TEST IT', 'TEST SEND', 'PREVIEW'])

/**
 * Read a reviewer's text. Intent is decided by EXACT phrase match on what is
 * left after the draft code is removed — not by "contains SEND".
 *
 * That distinction is the whole safety of the parser. "Don't send this yet",
 * "send it after you fix the date" and "can we send tomorrow?" all contain
 * SEND; none of them are approvals, and all of them fall through to `revise`,
 * where a human sees the result before anything moves.
 */
export function parseReviewerReply(raw: string): ParsedReply {
  const text = (raw || '').trim()

  // Pull out a code in any of the shapes a phone keyboard produces.
  let code: string | null = null
  let shortCode: string | null = null
  const full = text.match(/\bHH[\s-]?(\d{4})[\s-]?(\d{4})\b/i)
  if (full) code = `HH-${full[1]}-${full[2]}`

  let stripped = code ? text.replace(/\bHH[\s-]?\d{4}[\s-]?\d{4}\b/i, ' ') : text

  // 'APPROVE 0042' / 'STOP 0042' — a bare 4-digit tail identifying the draft.
  if (!code) {
    const short = stripped.match(/^([A-Za-z][A-Za-z\s]*?)\s+#?(\d{4})\s*$/)
    if (short) {
      shortCode = short[2]
      stripped = short[1]
    }
  }

  const note = stripped.replace(/\s+/g, ' ').trim()
  // Normalise for phrase matching only: the note keeps the reviewer's own words.
  const key = note
    .toUpperCase()
    .replace(/[.!?,;:]+$/g, '')
    .replace(/^(?:PLS|PLEASE)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (APPROVE_PHRASES.has(key)) return { intent: 'approve', code, shortCode, note }
  if (CANCEL_PHRASES.has(key)) return { intent: 'cancel', code, shortCode, note }
  if (TEST_PHRASES.has(key)) return { intent: 'test', code, shortCode, note }

  // 'EDIT: make it warmer' → the instruction is everything after the colon.
  const edit = note.match(/^(?:EDIT|CHANGE|REVISE|FIX)\s*:?\s*(.+)$/i)
  return { intent: 'revise', code, shortCode, note: edit ? edit[1].trim() : note }
}

/* ── Draft resolution ───────────────────────────────────────────────── */

export interface OpenDraft {
  id: string
  review_code: string
  status: string
  party_type: string
  created_at: string
}

const OPEN_COLUMNS = 'id, review_code, status, party_type, created_at'

export type Resolution =
  | { kind: 'one'; draft: OpenDraft }
  | { kind: 'none' }
  | { kind: 'ambiguous'; drafts: OpenDraft[] }
  | { kind: 'unknown_code'; code: string }

/**
 * Which draft does this reply refer to? Never guesses between two candidates —
 * picking wrong means a stranger's quote goes to the wrong customer.
 */
export async function resolveDraft(supabase: Supa, parsed: ParsedReply): Promise<Resolution> {
  if (parsed.code) {
    const { data } = await supabase
      .from('inquiry_drafts')
      .select(OPEN_COLUMNS)
      .eq('review_code', parsed.code)
      .maybeSingle()
    if (!data) return { kind: 'unknown_code', code: parsed.code }
    return { kind: 'one', draft: data as unknown as OpenDraft }
  }

  const { data } = await supabase
    .from('inquiry_drafts')
    .select(OPEN_COLUMNS)
    .in('status', OPEN_STATUSES)
    .order('created_at', { ascending: false })
    .limit(10)
  const open = (data ?? []) as unknown as OpenDraft[]

  if (parsed.shortCode) {
    const hits = open.filter(d => d.review_code.endsWith(parsed.shortCode as string))
    if (hits.length === 1) return { kind: 'one', draft: hits[0] }
    if (hits.length === 0) return { kind: 'unknown_code', code: parsed.shortCode }
    return { kind: 'ambiguous', drafts: hits }
  }

  if (open.length === 0) return { kind: 'none' }
  if (open.length === 1) return { kind: 'one', draft: open[0] }
  return { kind: 'ambiguous', drafts: open }
}

/* ── The loop ───────────────────────────────────────────────────────── */

export interface ReviewReplyInput {
  supabase: Supa
  /** The sender's number, straight off the Quo webhook. */
  from: string
  text: string
  /** The ingested_messages row this reply arrived as, for the audit trail. */
  eventId?: string | null
}

export interface ReviewReplyResult {
  /** false when the sender is not a reviewer — nothing was read or done. */
  handled: boolean
  intent?: ReviewIntent
  draftId?: string
  reviewCode?: string
  /** What we texted back, if anything. */
  reply?: string
  outcome:
    | 'not_a_reviewer'
    | 'no_open_draft'
    | 'ambiguous'
    | 'unknown_code'
    | 'approved_and_sent'
    | 'approved_send_failed'
    | 'cancelled'
    | 'revised'
    | 'tested'
    | 'error'
  error?: string
}

/** Reply to the reviewer on the same thread. Never throws. */
async function replyToReviewer(to: string, body: string): Promise<void> {
  try {
    await sendSMSViaQuo(to, body)
  } catch (err) {
    console.error('reviewLoop reply failed (non-fatal):', err)
  }
}

/**
 * Handle one inbound SMS that might be a reviewer's reply.
 *
 * The identity check is first and unconditional. Everything after it assumes a
 * verified human, which is what licenses `isAdmin: true` on the GATED
 * `approved` / `sent` transitions.
 */
export async function handleReviewerReply(input: ReviewReplyInput): Promise<ReviewReplyResult> {
  const { supabase, text } = input
  const from = normalizePhone(String(input.from || '').trim())

  // ── GUARDRAIL: identity by phone number, before anything else happens.
  if (!isReviewerPhone(from)) {
    return { handled: false, outcome: 'not_a_reviewer' }
  }

  const parsed = parseReviewerReply(text)
  const resolution = await resolveDraft(supabase, parsed)

  if (resolution.kind === 'none') {
    const reply = 'No drafts are open right now, so there was nothing to apply that to.'
    await replyToReviewer(from, reply)
    return { handled: true, intent: parsed.intent, outcome: 'no_open_draft', reply }
  }

  if (resolution.kind === 'unknown_code') {
    const reply = `I can't find a draft matching ${resolution.code}. Reply with the full code from the text, e.g. HH-2026-0042.`
    await replyToReviewer(from, reply)
    return { handled: true, intent: parsed.intent, outcome: 'unknown_code', reply }
  }

  if (resolution.kind === 'ambiguous') {
    const list = resolution.drafts
      .slice(0, 5)
      .map(d => `${d.review_code} (${d.party_type.replace(/_/g, ' ')})`)
      .join('\n')
    const reply = `There are ${resolution.drafts.length} open drafts — which one?\n${list}\nReply with the code, e.g. "SEND HH-2026-0042".`
    await replyToReviewer(from, reply)
    return { handled: true, intent: parsed.intent, outcome: 'ambiguous', reply }
  }

  const draft = resolution.draft
  const actor = { id: `REVIEWER:${from}`, isAdmin: true }

  // A named code can point at a draft that is already closed out. Say so plainly
  // instead of letting advance() throw a graph error at them.
  if (draft.status === 'cancelled' && parsed.intent !== 'cancel') {
    const reply = `${draft.review_code} was already dropped. Re-open it in Admin → Inbox if you want it back.`
    await replyToReviewer(from, reply)
    return { handled: true, intent: parsed.intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'no_open_draft', reply }
  }

  try {
    switch (parsed.intent) {
      /* ── SEND ────────────────────────────────────────────────────── */
      case 'approve': {
        if (draft.status === 'sent') {
          const reply = `${draft.review_code} already went out — nothing more to send.`
          await replyToReviewer(from, reply)
          return { handled: true, intent: 'approve', draftId: draft.id, reviewCode: draft.review_code, outcome: 'approved_and_sent', reply }
        }

        // GATED transition. `isAdmin` is true only because the number checked out.
        if (draft.status !== 'approved') {
          await advance({
            supabase,
            entity: 'inquiry_draft',
            id: draft.id,
            to: 'approved',
            actor,
            patch: {
              approved_at: new Date().toISOString(),
              // The exact words that satisfied the gate — the audit trail.
              approved_phrase: text.trim().slice(0, 500),
              approved_by: from,
            },
            meta: { job: 'review_loop', via: 'sms', review_code: draft.review_code, event_id: input.eventId ?? null },
          })
        }

        const sent = await sendApprovedDraft({ supabase, draftId: draft.id, actor })
        const where = [sent.emailSent ? 'email' : null, sent.smsSent ? 'text' : null].filter(Boolean).join(' + ')
        const reply = sent.closed
          ? `Sent ${draft.review_code} to ${sent.recipient.name || sent.recipient.email || sent.recipient.phone} (${where}).`
          : `${draft.review_code} is approved but the send did not complete: ${sent.errors.join('; ') || 'unknown error'}. It is still in Admin → Inbox.`
        await replyToReviewer(from, reply)
        return {
          handled: true,
          intent: 'approve',
          draftId: draft.id,
          reviewCode: draft.review_code,
          outcome: sent.closed ? 'approved_and_sent' : 'approved_send_failed',
          reply,
          error: sent.errors.join('; ') || undefined,
        }
      }

      /* ── CANCEL ──────────────────────────────────────────────────── */
      case 'cancel': {
        if (draft.status === 'sent') {
          const reply = `${draft.review_code} already went to the customer — it can't be pulled back.`
          await replyToReviewer(from, reply)
          return { handled: true, intent: 'cancel', draftId: draft.id, reviewCode: draft.review_code, outcome: 'cancelled', reply }
        }
        await advance({
          supabase,
          entity: 'inquiry_draft',
          id: draft.id,
          to: 'cancelled',
          actor,
          patch: { reviewer_note: parsed.note.slice(0, 2000) },
          meta: { job: 'review_loop', via: 'sms', review_code: draft.review_code, event_id: input.eventId ?? null },
        })
        const reply = `Dropped ${draft.review_code}. Nothing was sent.`
        await replyToReviewer(from, reply)
        return { handled: true, intent: 'cancel', draftId: draft.id, reviewCode: draft.review_code, outcome: 'cancelled', reply }
      }

      /* ── TEST ────────────────────────────────────────────────────── */
      case 'test': {
        const res = await sendApprovedDraft({
          supabase,
          draftId: draft.id,
          actor,
          // To the reviewer's own handles, exactly as the customer would see it.
          testTo: { phone: from, email: ownerEmail() },
        })
        await writeLedger(supabase, {
          entityType: DRAFT_ENTITY,
          entityId: draft.id,
          action: 'note',
          actor: actor.id,
          meta: { job: 'review_loop_test', review_code: draft.review_code, email: res.emailSent, sms: res.smsSent },
        })
        const reply = res.ok
          ? `Test copy of ${draft.review_code} sent to you (${[res.emailSent ? ownerEmail() : null, res.smsSent ? 'this number' : null].filter(Boolean).join(' + ')}). The customer still has nothing.`
          : `Couldn't send the test copy: ${res.errors.join('; ') || 'unknown error'}`
        await replyToReviewer(from, reply)
        return { handled: true, intent: 'test', draftId: draft.id, reviewCode: draft.review_code, outcome: 'tested', reply }
      }

      /* ── REVISE (anything else) ──────────────────────────────────── */
      case 'revise': {
        if (!parsed.note) {
          const reply = `Didn't catch that. Reply SEND, CANCEL, TEST, or tell me what to change about ${draft.review_code}.`
          await replyToReviewer(from, reply)
          return { handled: true, intent: 'revise', draftId: draft.id, reviewCode: draft.review_code, outcome: 'error', reply }
        }
        if (draft.status === 'sent') {
          const reply = `${draft.review_code} already went out, so there is nothing left to revise.`
          await replyToReviewer(from, reply)
          return { handled: true, intent: 'revise', draftId: draft.id, reviewCode: draft.review_code, outcome: 'error', reply }
        }

        // Record the request before spending a model call on it, so the note
        // survives even if the re-draft fails.
        await advance({
          supabase,
          entity: 'inquiry_draft',
          id: draft.id,
          to: 'revision_requested',
          actor,
          patch: { reviewer_note: parsed.note.slice(0, 2000) },
          meta: { job: 'review_loop', via: 'sms', review_code: draft.review_code, note: parsed.note },
        }).catch(err => {
          // An already-'revision_requested' draft is a legal no-op; a genuinely
          // illegal transition is worth surfacing but not worth blocking on.
          console.warn('reviewLoop revision transition:', err instanceof Error ? err.message : err)
        })

        const res = await redraftForReviewer({ supabase, draftId: draft.id, note: parsed.note })
        if (!res.ok) {
          const reply = `Couldn't re-draft ${draft.review_code}: ${res.error}. Your note is saved — try Admin → Inbox.`
          await replyToReviewer(from, reply)
          return { handled: true, intent: 'revise', draftId: draft.id, reviewCode: draft.review_code, outcome: 'error', reply, error: res.error }
        }
        // redraftForReviewer texts the revised draft itself; no second reply.
        return { handled: true, intent: 'revise', draftId: draft.id, reviewCode: draft.review_code, outcome: 'revised' }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'review loop failed'
    console.error('handleReviewerReply error:', msg)
    const reply = `Something went wrong handling that (${msg.slice(0, 120)}). Nothing was sent to the customer.`
    await replyToReviewer(from, reply)
    return { handled: true, intent: parsed.intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'error', reply, error: msg }
  }
}
