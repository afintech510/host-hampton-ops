import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSupabase } from '@/lib/supabase'
import { upsertContactByPhone } from '@/lib/contacts'
import { findContactsByPhone } from '@/lib/contactLookup'
import { recordSmsOptOut } from '@/lib/smsOptOut'
import { recordInboundEvent } from '@/lib/agent/events'
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
 * because the only actions here were opt-out and logging. Verification is still
 * skipped entirely when QUO_WEBHOOK_SECRET is unset, which is the documented
 * "not configured yet" state — set the secret and this endpoint is authenticated.
 */

function verifySignature(req: NextRequest, rawBody: string): boolean | null {
  const secret = process.env.QUO_WEBHOOK_SECRET
  if (!secret) return null // verification disabled (secret not configured)

  const id = req.headers.get('webhook-id') || ''
  const timestamp = req.headers.get('webhook-timestamp') || ''
  const sigHeader = req.headers.get('webhook-signature') || ''
  if (!id || !timestamp || !sigHeader) return false

  // Standard Webhooks: base64 secret, optionally prefixed with "whsec_".
  const keyB64 = secret.startsWith('whsec_') ? secret.slice(6) : secret
  let key: Buffer
  try {
    key = Buffer.from(keyB64, 'base64')
  } catch {
    key = Buffer.from(secret)
  }
  const signedContent = `${id}.${timestamp}.${rawBody}`
  const expected = crypto.createHmac('sha256', key).update(signedContent).digest('base64')

  // Header is space-delimited "v1,<sig> v1,<sig2>"; compare against each.
  return sigHeader.split(' ').some(part => {
    const sig = part.includes(',') ? part.split(',')[1] : part
    try {
      return sig.length === expected.length &&
        crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
    } catch {
      return false
    }
  })
}

export async function POST(req: NextRequest) {
  let rawBody: string
  try {
    rawBody = await req.text()
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const verified = verifySignature(req, rawBody)
  if (verified === false) {
    // FAIL CLOSED. A forged inbound SMS could otherwise impersonate a reviewer
    // phone and approve a draft.
    console.error('quo:webhook signature verification FAILED — rejecting')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
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
  const body = text.trim().toUpperCase()
  const messageId: string = msg?.id || ''
  const threadId: string = msg?.conversationId || msg?.threadId || ''

  console.log(`quo:webhook from=${from} body="${body}" id=${messageId}`)

  if (!from) return NextResponse.json({ received: true })

  const supabase = getSupabase()

  const isStop = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(body)

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
  const eventId = await recordInboundEvent({
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
    },
  })

  return NextResponse.json({
    received: true,
    ...(isStop ? { action: 'opt_out' } : {}),
    eventId,
    reviewer,
  })
}
