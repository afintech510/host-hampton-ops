import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

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
    // Normalize phone: strip +1, keep digits only
    const normalizedPhone = from.replace(/^\+1/, '').replace(/\D/g, '')

    if (['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(body)) {
      // Opt out of SMS
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .or(`phone.eq.${normalizedPhone},phone.eq.+1${normalizedPhone},phone.eq.${from}`)
        .single()

      if (contact) {
        await supabase
          .from('contacts')
          .update({ sms_opt_in: false })
          .eq('id', contact.id)

        // Cancel any pending SMS reminders
        await supabase
          .from('scheduled_reminders')
          .update({ status: 'cancelled' })
          .eq('contact_id', contact.id)
          .eq('channel', 'sms')
          .eq('status', 'pending')

        await supabase.from('contact_interactions').insert({
          contact_id: contact.id,
          type: 'sms_unsubscribed',
          metadata: { phone: from, message_sid: messageSid },
        })

        console.log(`twilio:webhook SMS opt-out for ${from}`)
      }

      // Twilio handles STOP auto-response automatically
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
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .or(`phone.eq.${normalizedPhone},phone.eq.+1${normalizedPhone},phone.eq.${from}`)
      .single()

    if (contact) {
      await supabase.from('contact_interactions').insert({
        contact_id: contact.id,
        type: 'sms_received',
        metadata: { phone: from, body: formData.get('Body'), message_sid: messageSid },
      })
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
