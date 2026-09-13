import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { upsertContactByPhone } from '@/lib/contacts'
import { findContactsByPhone } from '@/lib/contactLookup'
import { recordSmsOptOut, recordSmsOptIn, smsKeywordIntent } from '@/lib/smsOptOut'
import { recordInboundEventResult } from '@/lib/agent/events'
import { verifyQuoWebhook } from '@/lib/inboundWebhookVerify'
import { guardRate, webhookRule } from '@/lib/rateLimit'
// Deliberately lib/agent/reviewers, NOT lib/agent/reviewLoop: this route must
// not be able to reach the customer-send path, even transitively.
import { isReviewerPhone } from '@/lib/agent/reviewers'

export const dynamic = 'force-dynamic'

/**
 * Quo (OpenPhone) inbound webhook.
 *
 * Subscribe this URL to the `message.received` event in Quo (Settings → API/
 * Webhooks, or POST /v1/webhooks).
 *
 * Payload (Quo/OpenPhone event envelope):
 *   { type: 'message.received', data: { object: { from, to, text|body, direction, id } } }
 *
 * Two jobs:
 *   1. Keep SMS opt-in state in sync when a customer texts STOP (carrier
 *      compliance; Quo sends the carrier-level reply itself, as Twilio did).
 *   2. Put every inbound message into `ingested_messages` so the booking agent
 *      can see it — reviewer approvals on one side, customer inquiries on the
 *      other. The dispatcher (/api/cron/agent-dispatch) does the routing.
 *
 * FAIL CLOSED (plan §4.1, changed in Phase 2): an inbound SMS can now trigger an
 * LLM call and a customer-facing send, so an unsigned or wrongly-signed request
 * is REJECTED with 401 rather than logged-and-processed. It used to fail open
 * because the only actions here were opt-out and logging. UNCONFIGURED is closed
 * too, in production — see `unsignedRequestsAllowed` in lib/inboundWebhookVerify.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AND IT WAS CLOSED AGAINST QUO ITSELF FOR 2.5 DAYS.
 *
 * The verifier implemented Standard Webhooks (`webhook-id` / `webhook-timestamp`
 * / `webhook-signature`). Quo signs `openphone-signature: hmac;1;<ms>;<b64>`
 * over `<ms>.<rawBody>`. So every real delivery arrived with none of the headers
 * being looked for and was refused: **every POST here answered 401 from
 * 2026-09-11 12:00 UTC until 2026-09-13**, 38 of them, and 200 on every delivery
 * before that. The SMS review loop was dead, inbound customer texts reached
 * nothing, and a customer STOP could not be recorded. Nothing watched the 401s.
 * `lib/inboundWebhookVerify.ts` has the full account and now accepts both
 * schemes; the log line below names WHY a request was refused and which
 * signature headers it carried, because "verification FAILED" cannot tell a
 * wrong key from a wrong scheme and that is what cost the 2.5 days.
 */

export async function POST(req: NextRequest) {
  // A webhook is a public write door. The signature is the real gate; this is
  // the bound on how much work an unsigned flood can make us do, and it is
  // sized far above any real delivery rate (see webhookRule).
  const limited = guardRate(req, webhookRule('webhooks/quo'))
  if (limited) return limited

  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const verified = verifyQuoWebhook(req.headers, rawBody)
  if (!verified.ok) {
    // FAIL CLOSED. A forged inbound SMS could otherwise impersonate a reviewer
    // phone and approve a draft.
    console.error(
      `quo:webhook signature verification FAILED (${verified.reason}) — rejecting. ` +
        `signature headers present: ${verified.headersSeen.join(', ') || 'NONE'}` +
        (verified.detail ? ` | ${verified.detail}` : ''),
    )
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  if (verified.scheme === 'skipped') {
    console.warn('quo:webhook QUO_WEBHOOK_SECRET is unset — verification skipped (non-production only)')
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const type: string = event?.type || ''
  const msg = event?.data?.object || {}
  const direction: string = msg?.direction || ''

  // Only inbound messages matter.
  if (type !== 'message.received' && direction !== 'incoming') {
    console.log(`quo:webhook ignored type=${type} direction=${direction}`)
    return NextResponse.json({ received: true })
  }

  const from: string = msg?.from || ''
  const to: string = Array.isArray(msg?.to) ? msg.to[0] || '' : msg?.to || ''
  const text: string = (msg?.text ?? msg?.body ?? '').toString()
  const messageId: string = msg?.id || ''
  const threadId: string = msg?.conversationId || msg?.threadId || ''

  // The number is masked and the body is NOT logged. Both are a real person's
  // data, this log is read by humans and shipped nowhere, and the body is a
  // string a stranger wrote — a newline in it forges a log line. Only the
  // carrier keyword, which is a closed set, is printed.
  const intent = smsKeywordIntent(text)
  console.log(
    `quo:webhook from=…${String(from).replace(/\D/g, '').slice(-4)} id=${String(messageId).slice(0, 40)} ` +
      `keyword=${intent ?? 'none'} chars=${text.length} sig=${verified.scheme} rawLen=${rawBody.length}`,
  )

  if (!from) return NextResponse.json({ received: true })

  const supabase = getSupabase()

  const isStop = intent === 'stop'

  // ── Find the contact, creating one for an unknown texter.
  // Unknown numbers used to be dropped on the floor: no contact, no record, no
  // notification. Now they become a real contact (mirrored to Brevo and Quo by
  // contactSync) so the agent can answer them.
  //
  // THIS USED TO BE `.or(\`phone.eq.${normalizedPhone},…\`).maybeSingle()`, and
  // both halves were wrong. `.or()` takes a RAW PostgREST filter expression
  // built here out of the provider's own `From` field (AGENTS.md §11), and
  // `.maybeSingle()` ERRORS when more than one row matches — which 21
  // normalised numbers in the live table do — so the error was discarded, the
  // contact read as absent, and a texter we already knew got a THIRD row.
  let contactId: string | null = null
  const byPhone = await findContactsByPhone(supabase, from, 'id, phone, sms_opt_in')
  if (byPhone.kind === 'unavailable') {
    // Do not manufacture a contact, and do not silently swallow a STOP,
    // because we could not read the table. Quo retries a non-2xx.
    console.error('quo:webhook contact lookup failed:', byPhone.error)
    return NextResponse.json({ error: 'contact lookup failed' }, { status: 503 })
  }
  const phoneRows = byPhone.kind === 'found' ? byPhone.contacts : []
  contactId = byPhone.kind === 'found' ? byPhone.primary.id : null

  if (!contactId && !isStop) {
    // Don't manufacture a contact just to record an opt-out from a number we
    // have never heard of — there is nothing to opt out of.
    contactId = await upsertContactByPhone({
      phone: from,
      sourceDetail: 'quo-inbound-sms',
      serviceInterests: ['general'],
    })
  }

  // ── Opt-out handling (carrier compliance). Every row holding this number,
  // not just the one the lookup happened to return — see lib/smsOptOut.ts.
  if (isStop) {
    if (phoneRows.length > 0) {
      const res = await recordSmsOptOut(supabase, from, 'quo', { message_id: messageId })
      if (res.kind === 'unavailable') {
        // Answer non-2xx so Quo redelivers. A 200 over an unrecorded STOP means
        // it never comes back and the opt-out is gone (rule 10).
        return NextResponse.json({ error: 'could not record opt-out' }, { status: 503 })
      }
    }
    // A reviewer texting a bare STOP/CANCEL is also a review command ("drop that
    // draft"), so the message is still recorded below and the dispatcher acts on
    // it. The opt-out above is harmless for reviewers: reviewer SMS goes out
    // through sendSMSViaQuo directly and does not consult sms_opt_in.
  } else if (intent === 'start') {
    // Recorded, said out loud, and NOT written as consent. See recordSmsOptIn.
    const res = await recordSmsOptIn(supabase, from, 'quo', { message_id: messageId })
    if (res.kind === 'unavailable') {
      return NextResponse.json({ error: 'could not record opt-in' }, { status: 503 })
    }
  } else if (contactId) {
    const { error: logErr } = await supabase.from('contact_interactions').insert({
      contact_id: contactId,
      type: 'sms_received',
      metadata: { phone: from, body: text, message_id: messageId, provider: 'quo' },
    })
    if (logErr) console.error('quo:webhook interaction log refused:', logErr.message)
  }

  // ── Record the event for the agent. `external_id = 'quo:<id>'` against the
  // UNIQUE column is the dedupe: Quo retries a webhook it thinks failed, and a
  // redelivered approval must not send the customer a second message.
  const reviewer = isReviewerPhone(from)
  const recorded = await recordInboundEventResult({
    supabase,
    route: 'quo-webhook',
    source: 'quo',
    externalId: messageId ? `quo:${messageId}` : undefined,
    contactId,
    fromAddress: from,
    toAddress: to || null,
    body: text,
    subject: null,
    threadId: threadId || null,
    classification: reviewer ? 'reviewer_reply' : 'sms_inbound',
    parsed: {
      provider: 'quo',
      message_id: messageId || null,
      thread_id: threadId || null,
      reviewer,
      stop: isStop,
      carrier_keyword: intent,
    },
  })

  // A REFUSED insert is not a duplicate, and answering 200 to one means Quo
  // never redelivers — so a reviewer's approval, or a customer asking to book,
  // simply stops existing. `duplicate` is the idempotency guarantee working and
  // really is a 200. Rules 10 and 12.
  if (recorded.kind === 'failed') {
    console.error(`quo:webhook could not record the message — asking Quo to retry: ${recorded.error}`)
    return NextResponse.json({ error: 'could not record message' }, { status: 503 })
  }

  return NextResponse.json({
    received: true,
    ...(isStop ? { action: 'opt_out' } : {}),
    ...(intent === 'start' ? { action: 'start_recorded_consent_unchanged' } : {}),
    eventId: recorded.kind === 'recorded' ? recorded.id : null,
    duplicate: recorded.kind === 'duplicate',
    reviewer,
  })
}
