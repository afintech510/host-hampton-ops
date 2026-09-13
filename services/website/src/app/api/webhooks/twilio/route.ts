import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { findContactsByPhone } from '@/lib/contactLookup'
import { recordSmsOptOut } from '@/lib/smsOptOut'

export const dynamic = 'force-dynamic'

// Twilio sends webhook as application/x-www-form-urlencoded
export async function POST(req: NextRequest) {
  const supabase = getSupabase()

  let formData: URLSearchParams
  try {
    const text = await req.text()
    formData = new URLSearchParams(text)
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  }

  const messageSid = formData.get('MessageSid') || ''
  const from = formData.get('From') || ''
  const body = (formData.get('Body') || '').trim().toUpperCase()
  const messageStatus = formData.get('MessageStatus') || formData.get('SmsStatus') || ''

  console.log(`twilio:webhook from=${from} body="${body}" status=${messageStatus} sid=${messageSid}`)

  // ── Inbound SMS handling ──
  if (body && from) {
    if (['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(body)) {
      // Every contact row holding this number, not the one row a raw `.or()`
      // over three guessed spellings happened to match — and `.single()` on
      // that filter ERRORED whenever two rows shared a number, which 21
      // normalised numbers in the live table do, so the STOP was dropped.
      // See lib/smsOptOut.ts.
      await recordSmsOptOut(supabase, from, 'twilio', { message_sid: messageSid })

      // Twilio handles STOP auto-response automatically. The reply is the same
      // either way — a customer must never be told their opt-out failed — but
      // the outcome is in the log, where a human can find it.
      return new Response('<Response></Response>', {
        headers: { 'Content-Type': 'text/xml' },
      })
    }

    if (['HELP', 'INFO'].includes(body)) {
      // Respond with help text via TwiML
      return new Response(
        '<Response><Message>Host Hampton: For questions, call (631) 998-9325 or visit hosthampton.com. Reply STOP to unsubscribe from texts.</Message></Response>',
        { headers: { 'Content-Type': 'text/xml' } },
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
        metadata: { phone: from, body: formData.get('Body'), message_sid: messageSid },
      })
      if (logErr) console.error('twilio:webhook interaction log refused:', logErr.message)
    }

    return new Response('<Response></Response>', {
      headers: { 'Content-Type': 'text/xml' },
    })
  }

  // ── Delivery status callback ──
  if (messageStatus && messageSid) {
    // We could look up the message SID in contact_interactions to update status
    // For now, just log it
    console.log(`twilio:delivery status=${messageStatus} sid=${messageSid}`)
  }

  return NextResponse.json({ received: true })
}
