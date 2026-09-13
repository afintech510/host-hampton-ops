import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { recordInboundEvent } from '@/lib/agent/events'
// As in the interactions route: lib/slack/* only. Never reviewLoop, never
// sendApproved. A test asserts it.
import { verifySlackRequest, isSlackReviewer } from '@/lib/slack/signature'
import { slackLeadsChannel, postMessage } from '@/lib/slack/client'

export const dynamic = 'force-dynamic'

/**
 * Slack Events API (plan §25.8 step 5): **a thread reply is a free-text
 * revision.**
 *
 * This is the Slack form of the SMS loop's `revise` intent, and it is the
 * ergonomic heart of the phase — "make it warmer and drop the price to 850"
 * typed under the draft it refers to, with no code to quote, because the thread
 * already says which draft is meant.
 *
 * ── Three ways this could eat itself, and the guards for each ────────────
 *
 * 1. **Our own messages.** The agent posts the revised draft back into the
 *    same thread. Without a bot check that post is a new thread reply, which
 *    is a new revision, which posts again — an unbounded loop of Sonnet calls
 *    billed to Adam until the daily cap stops it. `bot_id` / `bot_message` is
 *    checked before anything else.
 *
 * 2. **Retries.** Slack redelivers an event it thinks failed, for three days.
 *    `event_id` is UNIQUE in `external_id`, so a redelivery is refused by the
 *    database rather than re-drafted.
 *
 * 3. **Top-level messages.** Someone chatting in `#hh-leads` is not revising
 *    anything. Only replies inside a thread whose `thread_ts` matches a draft's
 *    `slack_ts` are acted on; everything else is ignored, silently.
 *
 * ── url_verification and the chicken-and-egg ─────────────────────────────
 *
 * Slack signs the `url_verification` handshake like everything else, so it goes
 * through the same verification and gets no exemption. 'unconfigured' is a
 * rejection here too. The practical consequence is an ORDER, documented in
 * docs/slack-app-setup.md: put `SLACK_SIGNING_SECRET` on the box and deploy
 * BEFORE enabling event subscriptions, or the handshake fails and the failure
 * looks like a bug in this file. Weakening the check to make setup smoother
 * would trade a five-minute ordering constraint for a permanently open door.
 */

export async function POST(req: NextRequest) {
  // RAW BODY FIRST. Slack signs the bytes.
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const verdict = verifySlackRequest({
    signature: req.headers.get('x-slack-signature'),
    timestamp: req.headers.get('x-slack-request-timestamp'),
    rawBody,
  })
  if (verdict !== 'ok') {
    console.error(`[slack:events] rejected: ${verdict}`)
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // The handshake, after verification and not before it.
  if (body.type === 'url_verification') {
    return NextResponse.json({ challenge: String(body.challenge ?? '') })
  }

  const retry = req.headers.get('x-slack-retry-num')
  if (retry) console.warn(`[slack:events] Slack retry #${retry} (${req.headers.get('x-slack-retry-reason')})`)

  const event = (body.event ?? {}) as Record<string, unknown>
  const eventId = typeof body.event_id === 'string' ? body.event_id : ''

  // ── Guard 1: never react to a bot, least of all ourselves.
  //
  // `bot_id` and `app_id` are each present only on a bot's message, and either
  // alone is enough. This deliberately does NOT compare `body.api_app_id` with
  // `event.app_id`: both are absent on a human message, so `undefined ===
  // undefined` made that comparison true for EVERY reviewer — the guard against
  // an infinite loop was instead ignoring all real input, which is the same
  // silence as being switched off. Found by a test, not by reading.
  if (event.bot_id || event.subtype === 'bot_message' || event.app_id) {
    return NextResponse.json({ ok: true, ignored: 'bot' })
  }
  // Edits, deletions, joins, file shares: not a revision.
  if (event.type !== 'message' || (event.subtype && event.subtype !== 'thread_broadcast')) {
    return NextResponse.json({ ok: true, ignored: `type=${String(event.type)}/${String(event.subtype ?? '')}` })
  }

  const channel = typeof event.channel === 'string' ? event.channel : ''
  const threadTs = typeof event.thread_ts === 'string' ? event.thread_ts : ''
  const ts = typeof event.ts === 'string' ? event.ts : ''
  const userId = typeof event.user === 'string' ? event.user : ''
  const text = typeof event.text === 'string' ? event.text.trim() : ''

  // ── Guard 3: a thread reply, not a new message. `thread_ts === ts` is the
  // thread's own parent, which is the draft we posted, not a reply to it.
  if (!threadTs || threadTs === ts) {
    return NextResponse.json({ ok: true, ignored: 'not a thread reply' })
  }

  const leads = slackLeadsChannel()
  if (leads && channel && channel !== leads) {
    return NextResponse.json({ ok: true, ignored: 'other channel' })
  }

  // THE GATE, on the verified user id. A non-reviewer in the channel can talk
  // about a lead all they like; they cannot re-draft what goes to a customer.
  if (!isSlackReviewer(userId)) {
    console.log(`[slack:events] thread reply from non-reviewer ${userId} — ignored`)
    return NextResponse.json({ ok: true, ignored: 'not a reviewer' })
  }

  if (!text) return NextResponse.json({ ok: true, ignored: 'empty' })

  // ── Which draft? The thread says so. No code to quote, no guessing between
  // open drafts — the ambiguity the SMS path has to handle does not exist here,
  // and that is the whole ergonomic win of a thread per lead.
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('inquiry_drafts')
    .select('id, review_code, status')
    .eq('slack_ts', threadTs)
    .maybeSingle()

  if (error) {
    // Answer non-2xx so Slack redelivers: a reviewer's instruction must not be
    // lost to a transient Supabase timeout. Rule 12.
    console.error('[slack:events] draft lookup failed:', error.message)
    return NextResponse.json({ error: 'lookup failed' }, { status: 503 })
  }
  if (!data) {
    return NextResponse.json({ ok: true, ignored: 'no draft for this thread' })
  }

  const draft = data as { id: string; review_code: string; status: string }

  if (draft.status === 'sent') {
    await postMessage({
      channel,
      threadTs,
      text: `${draft.review_code} already went to the customer, so there is nothing left to revise.`,
    })
    return NextResponse.json({ ok: true, ignored: 'already sent' })
  }

  const recorded = await recordInboundEvent({
    supabase,
    route: 'slack-events',
    source: 'slack',
    // Guard 2: Slack's own event id, UNIQUE, so a redelivery is a no-op.
    externalId: eventId ? `slack:${eventId}` : `slack:${draft.id}:revise:${ts}`,
    fromAddress: userId,
    body: text,
    threadId: threadTs,
    classification: 'reviewer_reply',
    parsed: {
      provider: 'slack',
      intent: 'revise',
      draft_id: draft.id,
      review_code: draft.review_code,
      slack_user_id: userId,
      slack_channel: channel,
      slack_thread_ts: threadTs,
      slack_message_ts: ts,
    },
  })

  if (!recorded) {
    // Either a duplicate (fine, and the common case on a retry) or a refused
    // insert (not fine). Say which is indistinguishable from here, so say
    // nothing confident — but do not tell the reviewer it worked.
    console.warn(`[slack:events] no event recorded for ${draft.review_code} (duplicate or refused)`)
    return NextResponse.json({ ok: true, queued: false })
  }

  // What is true at this instant is that the note is QUEUED — the re-draft
  // itself happens in the dispatcher, minutes later. Saying "Re-drafting" would
  // describe work that has not started, and if the dispatcher is not running
  // that sentence is the last word the reviewer gets. Same rule as the
  // interactions route's ack.
  await postMessage({
    channel,
    threadTs,
    text:
      `Got it — queued a re-draft of ${draft.review_code}. Nothing has gone to the customer. ` +
      `The new version appears in this thread; if it does not turn up in a few minutes, it did not run.`,
  })

  return NextResponse.json({ ok: true, queued: true, draftId: draft.id })
}
