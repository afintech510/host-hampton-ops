/**
 * The Slack review loop (plan §25.8 steps 4-5) — a reviewer's decision, executed.
 *
 * `handleReviewerReply`'s counterpart. It sits on the same side of the wall:
 * this module imports `sendApproved.ts`, so nothing that imports this module may
 * be a public route. `/api/slack/interactions` records an `ingested_messages`
 * row and stops; the dispatcher claims that row and calls this. Slack therefore
 * gets the identical blast radius, and the identical latency, as the SMS path —
 * which is not a compromise, it is the point: a defect in a public handler
 * cannot reach a customer, because the handler has no route to one.
 *
 * It is a separate file from `reviewLoop.ts` rather than an export of it for the
 * plainest possible reason: two channels, two entry points, one shared send.
 * `lib/agent/reviewers.ts` exists on the same principle.
 *
 * ── The same guardrails, by the same rule, through a different channel ───
 *
 * §25.6: the guardrail SHAPE does not change because the channel changed.
 *
 *   - identity is `isSlackReviewer(verified user.id)`, the exact analogue of
 *     `isReviewerPhone`, and never anything in the message text;
 *   - `approved` and `sent` stay GATED transitions, and `isAdmin: true` is
 *     licensed by the allowlist check below and by nothing else;
 *   - the draft is named by id, so there is no guessing between open drafts —
 *     the ambiguity `resolveDraft` has to handle simply does not arise here.
 *
 * ── Why identity is checked twice ───────────────────────────────────────
 *
 * The route already verified Slack's signature and checked the allowlist. It is
 * checked AGAIN here because what reaches this function is a row in a table, not
 * an HTTP request: by the time the dispatcher reads it, the only evidence of who
 * pressed the button is a string in `parsed`. Anything able to write
 * `ingested_messages` could otherwise approve a customer message — and the admin
 * surface writes `ingested_messages`.
 */

import { getSupabase } from '@/lib/supabase'
import { ownerEmail, reviewerPhones } from '@/lib/ownerNotify'
import { advance, writeLedger } from '@/lib/marketing/graph'
import { isSlackReviewer } from '@/lib/slack/signature'
import { resolveSlackActor } from '@/lib/slack/actor'
import { postMessage, updateMessage } from '@/lib/slack/client'
import { settledBlocks } from '@/lib/slack/blocks'
import { redraftForReviewer } from './draftInquiry'
import { sendApprovedDraft } from './sendApproved'
import type { InboundEvent } from './events'
import { DRAFT_ENTITY, type ReviewIntent, type OpenDraft } from './reviewLoop'

type Supa = ReturnType<typeof getSupabase>

const OPEN_COLUMNS = 'id, review_code, status, party_type, created_at'

export interface SlackActionResult {
  handled: boolean
  intent?: ReviewIntent
  draftId?: string
  reviewCode?: string
  outcome:
    | 'not_a_reviewer'
    | 'no_draft'
    | 'lookup_failed'
    | 'approved_and_sent'
    | 'approved_send_failed'
    | 'cancelled'
    | 'revised'
    | 'tested'
    | 'already_sent'
    | 'error'
  /**
   * "Could not decide", as distinct from "decided no" (rule 3).
   *
   * The dispatcher finalises a Slack event either way, so without this flag a
   * transient Supabase timeout on the draft lookup below CONSUMED the reviewer's
   * button press permanently — and told them the draft no longer existed. The
   * dispatcher re-queues a retryable outcome through `requeueEvent`, bounded by
   * the same `agent_attempts` counter the drafting path uses.
   */
  retryable?: boolean
  error?: string
}

/** What `/api/slack/*` wrote into `ingested_messages.parsed`. */
interface SlackEventMeta {
  intent?: string
  draft_id?: string
  review_code?: string
  slack_user_id?: string
  slack_user_name?: string | null
  slack_channel?: string | null
  slack_thread_ts?: string | null
  slack_message_ts?: string | null
  /** The blocks the reviewer pressed the button on, so settling keeps the draft. */
  slack_message_blocks?: unknown[] | null
}

/** Post into the lead's thread. Never throws — a lost reply is not a lost send. */
async function replyInThread(meta: SlackEventMeta, text: string): Promise<void> {
  if (!meta.slack_channel) return
  await postMessage({
    channel: meta.slack_channel,
    threadTs: meta.slack_thread_ts || meta.slack_message_ts || null,
    text,
  })
}

/**
 * Take the buttons off a message that has been decided — and NOTHING else.
 *
 * Slack has no disabled state for a button, so removing it is the only way to
 * stop a second press. The handler refuses the second press anyway — this is so
 * the reviewer is never offered it, because a button that does nothing is a
 * worse answer than a button that is not there.
 *
 * `settledBlocks` keeps everything that is not an `actions` block, so passing
 * the ORIGINAL blocks is what makes this a strike-through rather than a delete.
 * It was passing `[]`, which replaced the whole lead — the customer, the date,
 * the guest count, the email that was about to go out — with a single line
 * reading "Sent — Adam". The channel is supposed to be the record of what was
 * sent to a customer, and approving cannot be the thing that erases it.
 *
 * A missing `slack_message_blocks` (an old queued row, or a payload over the
 * storage cap) degrades to the previous one-line behaviour rather than failing.
 */
async function settle(meta: SlackEventMeta, outcome: string, by: string): Promise<void> {
  if (!meta.slack_channel || !meta.slack_message_ts) return
  const original = Array.isArray(meta.slack_message_blocks) ? meta.slack_message_blocks : []
  if (original.length === 0) {
    console.warn(
      `[slack-action] settling ${meta.review_code ?? '(unknown)'} with no original blocks — ` +
        'the message will be replaced by a one-line summary rather than struck through',
    )
  }
  const ok = await updateMessage({
    channel: meta.slack_channel,
    ts: meta.slack_message_ts,
    text: `${meta.review_code ?? ''} - ${outcome} (${by})`,
    blocks: settledBlocks({ original, outcome, by }),
  })
  // Rule 19, and it matters here: a failed chat.update leaves a LIVE Approve
  // button under a draft that has already gone to the customer.
  if (!ok) {
    console.error(
      `[slack-action] could not settle ${meta.review_code ?? '(unknown)'} — ` +
        'its buttons are still live in the channel. A second press is refused by the status check.',
    )
  }
}

export async function handleSlackAction(input: { supabase: Supa; event: InboundEvent }): Promise<SlackActionResult> {
  const { supabase, event } = input
  const meta = (event.parsed ?? {}) as SlackEventMeta
  const slackUserId = meta.slack_user_id || event.from_address || ''

  // ── GUARDRAIL: identity, before anything else happens.
  if (!isSlackReviewer(slackUserId)) {
    console.error(`[slack-action] ${slackUserId || '(none)'} is not an allowlisted reviewer - refusing`)
    return { handled: false, outcome: 'not_a_reviewer' }
  }

  const draftId = meta.draft_id
  if (!draftId) return { handled: false, outcome: 'no_draft' }

  // THREE OUTCOMES, not two (rule 12). "The draft is gone" and "I could not ask
  // the database" are different facts and the reviewer is owed the true one:
  // saying "I cannot find that draft any more" over a Supabase timeout is a
  // definite statement about a draft that is, in fact, still sitting there
  // waiting to be sent (rule 10).
  const { data, error: lookupError } = await supabase
    .from('inquiry_drafts')
    .select(OPEN_COLUMNS)
    .eq('id', draftId)
    .maybeSingle()
  if (lookupError) {
    console.error(`[slack-action] draft lookup failed for ${draftId} (retryable):`, lookupError.message)
    // Deliberately NO thread reply: the dispatcher will try again within a
    // couple of minutes, and "something went wrong" followed by a successful
    // send two minutes later is worse than saying nothing at all. If it runs out
    // of attempts the reviewer hears about it from the SMS thread and the Inbox.
    return { handled: false, outcome: 'lookup_failed', retryable: true, error: lookupError.message }
  }
  if (!data) {
    await replyInThread(meta, 'I cannot find that draft any more. Nothing was sent.')
    return { handled: false, outcome: 'no_draft' }
  }
  const draft = data as unknown as OpenDraft

  const actor = await resolveSlackActor(supabase, slackUserId, meta.slack_user_name)
  const intent: ReviewIntent =
    meta.intent === 'approve' || meta.intent === 'cancel' || meta.intent === 'test' ? meta.intent : 'revise'

  // Re-read the status rather than trusting the message the button was on. Two
  // reviewers looking at the same message cannot see each other's press, so the
  // second one arrives at a draft that has already gone out.
  if (draft.status === 'sent' && intent !== 'test') {
    await replyInThread(
      meta,
      `${draft.review_code} already went to the customer - nothing more to do. (Pressed by ${actor.label}.)`,
    )
    return { handled: true, intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'already_sent' }
  }
  if (draft.status === 'cancelled' && intent !== 'cancel') {
    await replyInThread(meta, `${draft.review_code} was already dropped. Re-open it in Admin > Inbox if you want it back.`)
    return { handled: true, intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'no_draft' }
  }

  try {
    switch (intent) {
      /* ── Send it ─────────────────────────────────────────────────── */
      case 'approve': {
        if (draft.status !== 'approved') {
          await advance({
            supabase,
            entity: 'inquiry_draft',
            id: draft.id,
            to: 'approved',
            actor,
            patch: {
              approved_at: new Date().toISOString(),
              // The button, not a phrase. There is no text to quote here, and
              // writing one would be inventing evidence for an audit trail.
              approved_phrase: 'slack:approve',
              // THE CAPABILITY WIN (§11.1): a person, not the anonymous 'ADMIN'.
              approved_by: actor.id,
            },
            meta: {
              job: 'review_loop',
              via: 'slack',
              review_code: draft.review_code,
              event_id: event.id,
              slack_user_id: slackUserId,
              admin_user_id: actor.adminUserId,
              // Recorded rather than hidden: it is the difference between
              // "Adam approved this" and "a verified Slack account we have not
              // named yet approved this", and the ledger should say which.
              actor_unmapped: actor.unmapped,
            },
          })
        }

        const sent = await sendApprovedDraft({ supabase, draftId: draft.id, actor })
        const where = [sent.emailSent ? 'email' : null, sent.smsSent ? 'text' : null].filter(Boolean).join(' + ')
        const who = sent.recipient.name || sent.recipient.email || sent.recipient.phone
        if (sent.closed) {
          await settle(meta, `Sent to ${who} (${where})`, actor.label)
          await replyInThread(meta, `Sent ${draft.review_code} to ${who} (${where}). Approved by ${actor.label}.`)
        } else {
          await replyInThread(
            meta,
            `${draft.review_code} is approved but the send did not complete: ` +
              `${sent.errors.join('; ') || 'unknown error'}. It is still in Admin > Inbox.`,
          )
        }
        return {
          handled: true,
          intent,
          draftId: draft.id,
          reviewCode: draft.review_code,
          outcome: sent.closed ? 'approved_and_sent' : 'approved_send_failed',
          error: sent.errors.join('; ') || undefined,
        }
      }

      /* ── Drop ────────────────────────────────────────────────────── */
      case 'cancel': {
        await advance({
          supabase,
          entity: 'inquiry_draft',
          id: draft.id,
          to: 'cancelled',
          actor,
          patch: { reviewer_note: (event.body || 'slack:cancel').slice(0, 2000) },
          meta: {
            job: 'review_loop',
            via: 'slack',
            review_code: draft.review_code,
            event_id: event.id,
            slack_user_id: slackUserId,
            admin_user_id: actor.adminUserId,
          },
        })
        await settle(meta, 'Dropped', actor.label)
        await replyInThread(meta, `Dropped ${draft.review_code} (${actor.label}). Nothing was sent.`)
        return { handled: true, intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'cancelled' }
      }

      /* ── Test to me ──────────────────────────────────────────────── */
      case 'test': {
        // The REVIEWER's own handles, as the SMS path does. A Slack user id is
        // not something anything can deliver to, and resolving one to a customer
        // address is the mistake this branch must never make: `testTo` is the
        // only thing standing between a test and a real send.
        const res = await sendApprovedDraft({
          supabase,
          draftId: draft.id,
          actor,
          testTo: { phone: reviewerPhones()[0] ?? null, email: ownerEmail() },
        })
        await writeLedger(supabase, {
          entityType: DRAFT_ENTITY,
          entityId: draft.id,
          action: 'note',
          actor: actor.id,
          meta: {
            job: 'review_loop_test',
            via: 'slack',
            review_code: draft.review_code,
            email: res.emailSent,
            sms: res.smsSent,
          },
        })
        await replyInThread(
          meta,
          res.ok
            ? `Test copy of ${draft.review_code} sent to ${ownerEmail()}. The customer still has nothing.`
            : `Could not send the test copy: ${res.errors.join('; ') || 'unknown error'}`,
        )
        return { handled: true, intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'tested' }
      }

      /* ── A thread reply, or the Change... modal ──────────────────── */
      case 'revise': {
        const note = (event.body || '').trim()
        if (!note) {
          await replyInThread(meta, `Did not catch that - tell me what to change about ${draft.review_code}.`)
          return { handled: true, intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'error' }
        }

        // Record the request before spending a model call on it, so the note
        // survives even if the re-draft fails.
        await advance({
          supabase,
          entity: 'inquiry_draft',
          id: draft.id,
          to: 'revision_requested',
          actor,
          patch: { reviewer_note: note.slice(0, 2000) },
          meta: { job: 'review_loop', via: 'slack', review_code: draft.review_code, note, slack_user_id: slackUserId },
        }).catch(err => {
          // An already-'revision_requested' draft is a legal no-op; a genuinely
          // illegal transition is worth surfacing but not worth blocking on.
          console.warn('handleSlackAction revision transition:', err instanceof Error ? err.message : err)
        })

        const res = await redraftForReviewer({ supabase, draftId: draft.id, note })
        if (!res.ok) {
          await replyInThread(
            meta,
            `Could not re-draft ${draft.review_code}: ${res.error}. Your note is saved - try Admin > Inbox.`,
          )
          return { handled: true, intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'error', error: res.error }
        }
        // redraftForReviewer announces the revision itself, into this thread.
        return { handled: true, intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'revised' }
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'slack action failed'
    console.error('handleSlackAction error:', msg)
    await replyInThread(meta, `Something went wrong handling that (${msg.slice(0, 120)}). Nothing was sent to the customer.`)
    return { handled: true, intent, draftId: draft.id, reviewCode: draft.review_code, outcome: 'error', error: msg }
  }
}
