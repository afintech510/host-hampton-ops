import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { recordInboundEvent } from '@/lib/agent/events'
// lib/slack/*, and NOTHING from lib/agent/reviewLoop or lib/agent/sendApproved.
// This route is a public URL that can start an approval; it must not be able to
// reach the customer-send path, even transitively. Same reasoning, and the same
// shape, as /api/webhooks/quo importing lib/agent/reviewers rather than
// lib/agent/reviewLoop. A test asserts the module graph.
import { verifySlackRequest, isSlackReviewer } from '@/lib/slack/signature'
import { openView, respondToInteraction } from '@/lib/slack/client'
import {
  ACTION_APPROVE,
  ACTION_CANCEL,
  ACTION_TEST,
  ACTION_EDIT,
  EDIT_MODAL_CALLBACK,
  EDIT_BLOCK_ID,
  EDIT_INPUT_ID,
  decodeActionValue,
  editModalView,
} from '@/lib/slack/blocks'

export const dynamic = 'force-dynamic'

/**
 * Slack interactivity endpoint (plan §25.8 step 4).
 *
 * Approve / Drop / Test / Change-modal. One URL, set by the app manifest.
 *
 * ── This route does not send anything to a customer ──────────────────────
 *
 * It records an `ingested_messages` row and answers Slack. The dispatcher
 * (/api/cron/agent-dispatch) claims that row and runs the actual transition
 * through `handleSlackAction`, which is where `sendApproved.ts` lives.
 *
 * That indirection is the guardrail from §25.6, and it is exactly what the SMS
 * path already does: /api/webhooks/quo records a reviewer's text and the
 * dispatcher acts on it two minutes later. Slack gets the same latency as SMS
 * and the same blast radius — a defect in a public handler cannot reach a
 * customer, because the handler has no route to one.
 *
 * It also buys idempotency for free. `external_id` is UNIQUE, so Slack's retry
 * of an interaction it thinks failed cannot approve the same draft twice.
 *
 * ── Order of operations, and why ─────────────────────────────────────────
 *
 *   1. `await req.text()` — RAW body, before any parsing. Slack signs the bytes
 *      it sent; re-encoding a parsed form changes them and breaks every
 *      signature. There is a test asserting this file reads the body first.
 *   2. Verify. 'unconfigured' is a REJECTION, never a skip.
 *   3. Parse.
 *   4. Allowlist the VERIFIED `user.id`. §4.2 does not change because the
 *      channel changed.
 *
 * Slack gives a handler 3 seconds and a `trigger_id` 3 seconds, so the modal is
 * opened before any database work rather than after it.
 */

/** Slack posts interactions as `application/x-www-form-urlencoded`. */
function payloadFromForm(rawBody: string): Record<string, unknown> | null {
  try {
    const params = new URLSearchParams(rawBody)
    const raw = params.get('payload')
    if (!raw) return null
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return null
  }
}

/** 200 with no body: Slack treats it as "handled, change nothing". */
function ack(): NextResponse {
  return new NextResponse(null, { status: 200 })
}

export async function POST(req: NextRequest) {
  // ── 1. RAW BODY FIRST. Nothing above this line may parse.
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // ── 2. Verify. Fails closed on an unset secret.
  const verdict = verifySlackRequest({
    signature: req.headers.get('x-slack-signature'),
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody,
  })
  if (verdict !== 'ok') {
    console.error(`[slack:interactions] rejected: ${verdict}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  // ── 3. Parse the body we just hashed.
  const payload = payloadFromForm(rawBody)
  if (!payload) {
    console.error('[slack:interactions] no payload in body')
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const user = (payload.user ?? {}) as { id?: string; username?: string; name?: string }
  const userId = typeof user.id === 'string' ? user.id : ''
  const userName = user.username || user.name || null
  const responseUrl = typeof payload.response_url === 'string' ? payload.response_url : ''

  // ── 4. THE GATE. On the verified user id, never on message content.
  if (!isSlackReviewer(userId)) {
    console.error(`[slack:interactions] user ${userId || '(none)'} is not in SLACK_REVIEWER_USER_IDS — refusing`)
    if (responseUrl) {
      await respondToInteraction(responseUrl, {
        text: "You're not on the reviewer list for Host Hampton, so I can't act on that. Ask Adam to add your Slack member ID.",
        ephemeral: true,
      })
    }
    // 200, not 403: the request was authentic, the person was not authorised.
    // A non-2xx would make Slack retry a decision that will never change.
    return ack()
  }

  const retry = req.headers.get('x-slack-retry-num')
  if (retry) console.warn(`[slack:interactions] Slack retry #${retry} — external_id dedupe applies`)

  const type = typeof payload.type === 'string' ? payload.type : ''

  if (type === 'block_actions') return handleBlockAction(payload, { userId, userName, responseUrl })
  if (type === 'view_submission') return handleViewSubmission(payload, { userId, userName })

  console.log(`[slack:interactions] ignoring type=${type}`)
  return ack()
}

/* ── Buttons ────────────────────────────────────────────────────────────── */

async function handleBlockAction(
  payload: Record<string, unknown>,
  who: { userId: string; userName: string | null; responseUrl: string },
): Promise<NextResponse> {
  const actions = Array.isArray(payload.actions) ? (payload.actions as Record<string, unknown>[]) : []
  const action = actions[0]
  if (!action) return ack()

  const actionId = typeof action.action_id === 'string' ? action.action_id : ''
  const value = decodeActionValue(action.value)
  if (!value) {
    console.error(`[slack:interactions] ${actionId}: unreadable action value`)
    return ack()
  }

  const message = (payload.message ?? {}) as { ts?: string; thread_ts?: string; blocks?: unknown[] }
  const container = (payload.container ?? {}) as { channel_id?: string; message_ts?: string }
  const channelObj = (payload.channel ?? {}) as { id?: string }
  const channel = channelObj.id || container.channel_id || null
  const messageTs = message.ts || container.message_ts || null

  // ── "Change..." opens a modal, and a trigger_id is good for 3 SECONDS.
  // Before any database call, on purpose: a modal opened on the far side of two
  // Supabase round trips fails with expired_trigger_id, and the reviewer sees a
  // button that did nothing.
  if (actionId === ACTION_EDIT) {
    const triggerId = typeof payload.trigger_id === 'string' ? payload.trigger_id : ''
    const opened = triggerId
      ? await openView(
          triggerId,
          editModalView({
            draftId: value.draftId,
            reviewCode: value.reviewCode,
            channel,
            threadTs: message.thread_ts || messageTs,
          }),
        )
      : false
    if (!opened && who.responseUrl) {
      await respondToInteraction(who.responseUrl, {
        text: `Could not open the edit box for ${value.reviewCode}. Reply in this thread with the change instead — that does the same thing.`,
        ephemeral: true,
      })
    }
    return ack()
  }

  const intent =
    actionId === ACTION_APPROVE ? 'approve' : actionId === ACTION_CANCEL ? 'cancel' : actionId === ACTION_TEST ? 'test' : null

  if (!intent) {
    console.log(`[slack:interactions] unknown action_id=${actionId}`)
    return ack()
  }

  const actionTs = typeof action.action_ts === 'string' ? action.action_ts : String(Date.now())
  const queued = await enqueue({
    intent,
    draftId: value.draftId,
    reviewCode: value.reviewCode,
    userId: who.userId,
    userName: who.userName,
    channel,
    threadTs: message.thread_ts || messageTs,
    messageTs,
    // The blocks the reviewer was looking at when they pressed. Carried so that
    // settling the message can strike the BUTTONS off and keep the draft: the
    // settle path used to rebuild from an empty array, which replaced the whole
    // lead — customer, date, guests, the drafted email — with one line of
    // "Sent — Adam". Slack is meant to be the record of what went out; it cannot
    // be that if approving is what deletes it.
    messageBlocks: Array.isArray(message.blocks) ? message.blocks : null,
    responseUrl: who.responseUrl,
    // UNIQUE, and it is what makes a Slack retry safe: the same press produces
    // the same id, the insert is refused with 23505, and nothing runs twice.
    externalId: `slack:${value.draftId}:${intent}:${actionTs}`,
    body: intent,
  })

  if (who.responseUrl) {
    await respondToInteraction(who.responseUrl, {
      text: queued
        ? ackText(intent, value.reviewCode)
        : `I couldn't queue that for ${value.reviewCode}. Nothing has gone to the customer — try the SMS thread or Admin › Inbox.`,
      ephemeral: true,
    })
  }
  return ack()
}

/**
 * What the reviewer is told the instant they press — and this route knows
 * exactly one thing at that moment: the press is IN THE QUEUE. It has not been
 * acted on. The dispatcher does that, on its own schedule, minutes later.
 *
 * So none of these say "Sending". They said "Sending ${code} — I'll confirm in
 * this thread when it's out", which is a statement about a transition that has
 * not happened yet and might not: if the dispatch cron stops — and in this
 * system a cron has silently stopped for a month, two have 401ed daily, and a
 * webhook refused every message for two and a half days — then that sentence is
 * the last thing the reviewer ever hears, and it says the customer was emailed.
 *
 * Rule 10 in both directions: claim only what is true NOW, and say what the
 * ABSENCE of the follow-up means, because silence is otherwise indistinguishable
 * from success. The confirmation in the thread is the real receipt.
 */
function ackText(intent: string, code: string): string {
  const receipt = " I'll confirm in this thread when it's actually done — if nothing appears within a few minutes, it did NOT happen."
  if (intent === 'approve') return `Queued ${code} to send.${receipt}`
  if (intent === 'cancel') return `Queued ${code} to be dropped. Nothing goes to the customer.${receipt}`
  return `Queued a test copy of ${code} to you. The customer still gets nothing.${receipt}`
}

/* ── The edit modal's submission ────────────────────────────────────────── */

async function handleViewSubmission(
  payload: Record<string, unknown>,
  who: { userId: string; userName: string | null },
): Promise<NextResponse> {
  const view = (payload.view ?? {}) as Record<string, unknown>
  if (view.callback_id !== EDIT_MODAL_CALLBACK) return ack()

  let meta: { draftId?: string; reviewCode?: string; channel?: string | null; threadTs?: string | null } = {}
  try {
    meta = JSON.parse(String(view.private_metadata || '{}'))
  } catch {
    /* handled by the !draftId check below */
  }
  if (!meta.draftId) {
    console.error('[slack:interactions] edit modal with no draftId in private_metadata')
    return ack()
  }

  const state = (view.state ?? {}) as { values?: Record<string, Record<string, { value?: string }>> }
  const note = (state.values?.[EDIT_BLOCK_ID]?.[EDIT_INPUT_ID]?.value || '').trim()

  if (!note) {
    // A validation error keeps the modal open with the message attached to the
    // field, which is better than closing it and losing what they typed.
    return NextResponse.json({
      response_action: 'errors',
      errors: { [EDIT_BLOCK_ID]: 'Tell me what to change and I will re-draft it.' },
    })
  }

  const queued = await enqueue({
    intent: 'revise',
    draftId: meta.draftId,
    reviewCode: meta.reviewCode || '',
    userId: who.userId,
    userName: who.userName,
    channel: meta.channel ?? null,
    threadTs: meta.threadTs ?? null,
    messageTs: null,
    responseUrl: '',
    // A modal's view id is unique per opening, so a resubmission of the same
    // view cannot queue two re-drafts.
    externalId: `slack:${meta.draftId}:revise:${String(view.id || Date.now())}`,
    body: note,
  })
  if (!queued) console.error(`[slack:interactions] could not queue the revision for ${meta.reviewCode}`)

  // An empty 200 closes the modal.
  return ack()
}

/* ── The queue ──────────────────────────────────────────────────────────── */

/**
 * Record the reviewer's decision as an inbound event. The dispatcher does the
 * work; this route only ever writes a row.
 *
 * Returns false when nothing was recorded — which the caller SAYS, rather than
 * acking a press that went nowhere. `recordInboundEvent` is non-fatal by
 * design and returns null on a refused insert, and a button that silently did
 * nothing is precisely the reminder-engine failure (rule 17): "queued" and
 * "refused by a CHECK constraint" look identical from outside unless something
 * reads the result.
 */
async function enqueue(opts: {
  intent: string
  draftId: string
  reviewCode: string
  userId: string
  userName: string | null
  channel: string | null
  threadTs: string | null
  messageTs: string | null
  messageBlocks?: unknown[] | null
  responseUrl: string
  externalId: string
  body: string
}): Promise<boolean> {
  const supabase = getSupabase()
  const id = await recordInboundEvent({
    supabase,
    route: 'slack-interactions',
    source: 'slack',
    externalId: opts.externalId,
    fromAddress: opts.userId,
    body: opts.body,
    classification: 'reviewer_reply',
    parsed: {
      provider: 'slack',
      intent: opts.intent,
      draft_id: opts.draftId,
      review_code: opts.reviewCode,
      slack_user_id: opts.userId,
      slack_user_name: opts.userName,
      slack_channel: opts.channel,
      slack_thread_ts: opts.threadTs,
      slack_message_ts: opts.messageTs,
      // Bounded: `parsed` is a jsonb column on a table that already holds every
      // inbound message, and an unbounded copy of a Slack message on every press
      // is how a row size becomes an outage. A draft's blocks are ~5 KB; a
      // payload past the cap is dropped rather than truncated, because HALF a
      // block array would make chat.update fail with invalid_blocks — which the
      // fail-soft client reports as "Slack was down".
      slack_message_blocks: blocksWithinLimit(opts.messageBlocks),
      response_url: opts.responseUrl || null,
    },
  })
  return !!id
}

/** Roughly 24 KB of JSON — comfortably above a real draft, far below a problem. */
const MAX_STORED_BLOCKS_BYTES = 24 * 1024

function blocksWithinLimit(blocks: unknown[] | null | undefined): unknown[] | null {
  if (!Array.isArray(blocks) || blocks.length === 0) return null
  try {
    const json = JSON.stringify(blocks)
    if (json.length > MAX_STORED_BLOCKS_BYTES) {
      console.warn(`[slack:interactions] message blocks are ${json.length} bytes — not storing them`)
      return null
    }
    return blocks
  } catch {
    // Circular or otherwise unserialisable. Not fatal: the settle path falls
    // back to the same one-line message it produced before.
    return null
  }
}
