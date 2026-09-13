import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { findContactsByPhone } from '@/lib/contactLookup'
import { recordSmsOptOut, recordSmsOptIn, smsKeywordIntent } from '@/lib/smsOptOut'
import { verifyTwilioWebhook } from '@/lib/inboundWebhookVerify'
import { guardRate, webhookRule } from '@/lib/rateLimit'
import { PUBLIC_PHONE_DISPLAY } from '@/lib/paymentContacts'

export const dynamic = 'force-dynamic'

/**
 * Twilio inbound SMS + delivery-status webhook. Form-encoded, not JSON.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT VERIFIED NOTHING AT ALL UNTIL 2026-09-13.
 *
 * No `X-Twilio-Signature` check of any kind, no rate limit, on a public URL —
 * while `TWILIO_AUTH_TOKEN` sat in the container the entire time. What that
 * bought anyone who knew the URL:
 *
 *   - `POST From=<a customer's number>&Body=STOP` writes `sms_opt_in = false` to
 *     **every contact row holding that number** and cancels that contact's
 *     pending SMS reminders. We then never text that customer again and nothing
 *     says why.
 *   - It writes a `contact_interactions` row of type `sms_unsubscribed` — a
 *     false statement about a real person, on the record the admin Contacts tab
 *     renders.
 *   - Any other body writes an `sms_received` interaction carrying text of the
 *     caller's choosing, attached to a real contact.
 *
 * Twilio's signature covers the URL **and every POST parameter**, so unlike
 * SignWell's `type@time` it really does vouch for `From` and `Body` — which is
 * what matters here, because `From` decides whose consent we write.
 * `lib/inboundWebhookVerify.ts` has the scheme and the URL trap.
 *
 * Rule 17, both halves: the door was open and, over the ten-day nginx window,
 * it was walked through **once**, by a `curl` (not Twilio's user agent) that
 * sent no STOP. Nobody's consent was forged. `TWILIO_PHONE_NUMBER`'s `SmsUrl`
 * still points at a different Supabase project (needs-Adam, PLAN.md ~line 102),
 * so Twilio has never delivered here either — this route is open and unused,
 * and the fix is worth having before the day it is repointed rather than after.
 */

/** Twilio's own empty TwiML acknowledgement. */
function twiml(message?: string): Response {
  return new Response(
    message ? `<Response><Message>${message}</Message></Response>` : '<Response></Response>',
    { headers: { 'Content-Type': 'text/xml' } },
  )
}

export async function POST(req: NextRequest) {
  const limited = guardRate(req, webhookRule('webhooks/twilio'))
  if (limited) return limited

  let formData: URLSearchParams
  try {
    const text = await req.text()
    formData = new URLSearchParams(text)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  // Verified against the RAW parameters, before a single one of them is read as
  // a fact about a person.
  const verified = verifyTwilioWebhook(req, formData)
  if (!verified.ok) {
    console.error(
      `twilio:webhook signature verification FAILED (${verified.reason}) — rejecting. ` +
        `signature headers present: ${verified.headersSeen.join(', ') || 'NONE'}`,
    )
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  if (verified.scheme === 'skipped') {
    console.warn('twilio:webhook TWILIO_AUTH_TOKEN is unset — verification skipped (non-production only)')
  }

  const supabase = getSupabase()

  const messageSid = formData.get('MessageSid') || ''
  const from = formData.get('From') || ''
  const rawBody = formData.get('Body') || ''
  const messageStatus = formData.get('MessageStatus') || formData.get('SmsStatus') || ''

  // Masked, and the body is not printed — it is a real person's message and a
  // newline in it forges a log line. Only the carrier keyword, a closed set.
  const intent = smsKeywordIntent(rawBody)
  console.log(
    `twilio:webhook from=…${String(from).replace(/\D/g, '').slice(-4)} keyword=${intent ?? 'none'} ` +
      `chars=${rawBody.length} status=${messageStatus} sid=${String(messageSid).slice(0, 40)}`,
  )

  // ── Inbound SMS handling ──
  if (rawBody && from) {
    if (intent === 'stop') {
      // Every contact row holding this number, not the one row a raw `.or()`
      // over three guessed spellings happened to match — and `.single()` on
      // that filter ERRORED whenever two rows shared a number, which 21
      // normalised numbers in the live table do, so the STOP was dropped.
      // See lib/smsOptOut.ts.
      await recordSmsOptOut(supabase, from, 'twilio', { message_sid: messageSid })

      // Twilio handles STOP auto-response automatically. The reply is the same
      // either way — a customer must never be told their opt-out failed — but
      // the outcome is in the log, where a human can find it.
      return twiml()
    }

    if (intent === 'start') {
      // Recorded and said out loud; consent is NOT re-granted here. The carrier
      // resumes delivery by itself, so nothing is blocked by us being careful.
      // See recordSmsOptIn for why writing `sms_opt_in = true` across every row
      // holding a number is a decision and not a webhook's to make.
      await recordSmsOptIn(supabase, from, 'twilio', { message_sid: messageSid })
      return twiml()
    }

    if (intent === 'help') {
      return twiml(
        `Host Hampton: For questions, call ${PUBLIC_PHONE_DISPLAY} or visit hosthampton.com. ` +
          'Reply STOP to unsubscribe from texts.',
      )
    }

    // Log other inbound messages
    const lookup = await findContactsByPhone(supabase, from, 'id, phone')
    if (lookup.kind === 'unavailable') {
      console.error('twilio:webhook contact lookup failed, message not logged:', lookup.error)
    } else if (lookup.kind === 'found') {
      const { error: logErr } = await supabase.from('contact_interactions').insert({
        contact_id: lookup.primary.id,
        type: 'sms_received',
        metadata: { phone: from, body: rawBody, message_sid: messageSid },
      })
      if (logErr) console.error('twilio:webhook interaction log refused:', logErr.message)
    }

    return twiml()
  }

  // ── Delivery status callback ──
  if (messageStatus && messageSid) {
    // We could look up the message SID in contact_interactions to update status
    // For now, just log it
    console.log(`twilio:delivery status=${messageStatus} sid=${String(messageSid).slice(0, 40)}`)
  }

  return NextResponse.json({ received: true })
}
