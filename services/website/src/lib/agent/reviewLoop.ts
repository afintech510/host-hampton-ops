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
import { sendApprovedDraft, resolveRecipient, SEND_COLUMNS, type SendableDraft } from './sendApproved'
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
  'APPROVE IT',
  'OK SEND',
  'OK SEND IT',
  'YES SEND',
  'YES SEND IT',
  'SEND PLEASE',
  'PLEASE SEND',
  'GO',
  'SEND IT OUT',
  'SEND NOW',
  'SEND IT NOW',
  'LOOKS GOOD SEND',
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
 * Words that may precede a bare 4-digit draft tail. A trailing number is only a
 * short code when the reviewer was giving a COMMAND.
 *
 * Without this, "make the price 1200" parsed as command "make the price" +
 * short code "1200": the number — the entire point of the instruction — was
 * deleted from the note, and the loop then replied "I can't find a draft
 * matching 1200" instead of revising. Prices, guest counts, times and years all
 * end in digits, so that was a routine way to lose a reviewer's instruction.
 */
const SHORT_CODE_COMMANDS =
  /^(?:SEND(?:\s+IT)?|APPROVE[D]?|OK|YES|GO|CANCEL|IGNORE|STOP|NO|DROP|DISMISS|KILL|SKIP|TEST|PREVIEW|DRAFT)$/i

/**
 * Drop the part of a reply that the phone quoted back rather than the part the
 * human typed.
 *
 * An iPhone inline reply carries the whole original SMS, and the agent's own
 * review text contains "Reply SEND, CANCEL, or say what to change" — several
 * command words. Parsing the quote would at best waste a model call re-drafting
 * against our own boilerplate; a "contains" parser would have approved on it.
 */
function unquoted(text: string): string {
  const kept = text
    .split(/\r?\n/)
    .filter(l => !/^\s*>/.test(l) && !/^\s*On .+ wrote:\s*$/i.test(l))
    .join('\n')
    .trim()
  return kept || text
}

/**
 * Read a reviewer's text. Intent is decided by EXACT phrase match on what is
 * left after the quoted original and the draft code are removed — not by
 * "contains SEND".
 *
 * That distinction is the whole safety of the parser. "Don't send this yet",
 * "send it after you fix the date" and "can we send tomorrow?" all contain
 * SEND; none of them are approvals, and all of them fall through to `revise`,
 * where a human sees the result before anything moves.
 *
 * The draft CODE is still read from the full text including the quote — it is
 * only an identifier, and a quoted code is the reviewer telling us which draft
 * they are looking at. Only the INTENT is restricted to words they typed.
 */
export function parseReviewerReply(raw: string): ParsedReply {
  const text = (raw || '').trim()

  // Pull out a code in any of the shapes a phone keyboard produces.
  let code: string | null = null
  let shortCode: string | null = null
  const full = text.match(/\bHH[\s-]?(\d{4})[\s-]?(\d{4})\b/i)
  if (full) code = `HH-${full[1]}-${full[2]}`

  const typed = unquoted(text)
  let stripped = code ? typed.replace(/\bHH[\s-]?\d{4}[\s-]?\d{4}\b/gi, ' ') : typed

  // 'APPROVE 0042' / 'STOP 0042' — a bare 4-digit tail identifying the draft,
  // but only after an actual command word (see SHORT_CODE_COMMANDS).
  if (!code) {
    const short = stripped.match(/^([A-Za-z][A-Za-z\s']*?)\s+#?(\d{4})\s*$/)
    if (short && SHORT_CODE_COMMANDS.test(short[1].trim())) {
      shortCode = short[2]
      stripped = short[1]
    }
  }

  const note = stripped.replace(/\s+/g, ' ').trim()
  // Normalise for phrase matching only: the note keeps the reviewer's own words.
  // Trailing junk (punctuation, a thumbs-up emoji) is stripped so "Send it 👍"
  // is the approval the reviewer plainly meant, not a wasted re-draft.
  const key = note
    .toUpperCase()
    .replace(/[^A-Z0-9]+$/, '')
    .replace(/^(?:PLS|PLEASE)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (APPROVE_PHRASES.has(key)) return { intent: 'approve', code, shortCode, note }
  if (CANCEL_PHRASES.has(key)) return { intent: 'cancel', code, shortCode, note }
  if (TEST_PHRASES.has(key)) return { intent: 'test', code, shortCode, note }

  // 'EDIT: make it warmer' → the instruction is everything after the colon. The
  // colon is REQUIRED: without it, "change the guest count to 30" had "change"
  // stripped and reached the draft node as the fragment "the guest count to 30".
  const edit = note.match(/^(?:EDIT|CHANGE|REVISE|FIX)\s*:\s*(.+)$/i)
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
  | {
      kind: 'one'
      draft: OpenDraft
      /**
       * The reviewer named a code that is NOT the draft we most recently texted
       * them. A verified reviewer typing a valid code is intent — but a typo
       * ('0913' for '0313') that happens to hit another open draft would send a
       * real quote to the wrong real customer, and there is no undo on that.
       * `approve` asks for one confirmation in this case; nothing else does.
       */
      outOfContext?: boolean
    }
  | { kind: 'none' }
  | { kind: 'ambiguous'; drafts: OpenDraft[] }
  | { kind: 'unknown_code'; code: string }

/** The draft most recently texted to the reviewers — their working context. */
async function mostRecentlyTexted(supabase: Supa): Promise<string | null> {
  const { data } = await supabase
    .from('inquiry_drafts')
    .select('id')
    .in('status', OPEN_STATUSES)
    .not('sent_for_review_at', 'is', null)
    .order('sent_for_review_at', { ascending: false })
    .limit(1)
  return ((data ?? [])[0] as { id: string } | undefined)?.id ?? null
}

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
    const draft = data as unknown as OpenDraft
    const top = await mostRecentlyTexted(supabase)
    return { kind: 'one', draft, outOfContext: !!top && top !== draft.id }
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
    | 'needs_confirmation'
    | 'approved_and_sent'
    | 'approved_send_failed'
    | 'cancelled'
    | 'revised'
    | 'tested'
    | 'error'
  error?: string
}

/** Ledger job name for the out-of-context approval confirmation prompt. */
const CONFIRM_JOB = 'approve_confirm_prompt'
/** How long a confirmation prompt stays good for. */
const CONFIRM_WINDOW_MS = 15 * 60 * 1000

/**
 * Did we already ask this reviewer to confirm this draft, recently?
 *
 * The prompt is remembered as a `marketing_ledger` note rather than a new
 * column: it is audit-worthy in its own right ("we asked, they confirmed") and
 * it needs no migration.
 */
async function hasPendingConfirm(supabase: Supa, draftId: string, from: string): Promise<boolean> {
  const since = new Date(Date.now() - CONFIRM_WINDOW_MS).toISOString()
  const { data } = await supabase
    .from('marketing_ledger')
    .select('id')
    .eq('entity_type', DRAFT_ENTITY)
    .eq('entity_id', draftId)
    .eq('action', 'note')
    .gte('created_at', since)
    .contains('meta', { job: CONFIRM_JOB, reviewer: from })
    .limit(1)
  return (data ?? []).length > 0
}

/** "Jess R (jess@example.com)" — enough for a human to catch a wrong draft. */
async function describeRecipient(supabase: Supa, draftId: string): Promise<string> {
  try {
    const { data } = await supabase.from('inquiry_drafts').select(SEND_COLUMNS).eq('id', draftId).maybeSingle()
    if (!data) return 'an unknown contact'
    const r = await resolveRecipient(supabase, data as unknown as SendableDraft)
    const handle = r.email || r.phone
    return [r.name, handle ? `(${handle})` : null].filter(Boolean).join(' ') || 'an unknown contact'
  } catch {
    return 'an unknown contact'
  }
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

  // ── One confirmation when an approval names a draft that is not the one we
  // last texted. See Resolution.outOfContext. Only `approve` asks: cancel, test
  // and revise are all recoverable, and a send is not.
  if (parsed.intent === 'approve' && resolution.outOfContext && draft.status !== 'sent') {
    if (!(await hasPendingConfirm(supabase, draft.id, from))) {
      const who = await describeRecipient(supabase, draft.id)
      await writeLedger(supabase, {
        entityType: DRAFT_ENTITY,
        entityId: draft.id,
        action: 'note',
        actor: actor.id,
        meta: { job: CONFIRM_JOB, review_code: draft.review_code, reviewer: from },
      })
      const reply =
        `Just checking — ${draft.review_code} is not the draft I last sent you. ` +
        `It goes to ${who}. Reply SEND ${draft.review_code} again to confirm.`
      await replyToReviewer(from, reply)
      return {
        handled: true,
        intent: 'approve',
        draftId: draft.id,
        reviewCode: draft.review_code,
        outcome: 'needs_confirmation',
        reply,
      }
    }
  }

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
