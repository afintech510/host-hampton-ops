import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

/**
 * Quo (OpenPhone) inbound webhook.
 *
 * Subscribe this URL to the `message.received` event in Quo (Settings → API/
 * Webhooks, or POST /v1/webhooks). Its job is to keep our SMS opt-in state in
 * sync when a customer replies — Quo handles the carrier-level STOP compliance
 * reply itself, exactly like Twilio did.
 *
 * Payload (Quo/OpenPhone event envelope):
 *   { type: 'message.received', data: { object: { from, to, text|body, direction, id } } }
 *
 * Signature: if QUO_WEBHOOK_SECRET is set we verify the Standard-Webhooks
 * signature. On mismatch we log and STILL process opt-outs — a dropped STOP
 * would leave a customer marked opted-in (a compliance problem) and the only
 * actions here are opt-out + logging, both low-risk. Configure the secret to
 * turn on verification logging.
 */

function verifySignature(req: NextRequest, rawBody: string): boolean | null {
  const secret = process.env.QUO_WEBHOOK_SECRET
  if (!secret) return null // verification disabled

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
    // Fail-open for compliance (see file header) — log and continue.
    console.warn('quo:webhook signature verification FAILED — processing anyway')
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

  // Only inbound messages matter for opt-in sync.
  if (type !== 'message.received' && direction !== 'incoming') {
    console.log(`quo:webhook ignored type=${type} direction=${direction}`)
    return NextResponse.json({ received: true })
  }

  const from: string = msg?.from || ''
  const text: string = (msg?.text ?? msg?.body ?? '').toString()
  const body = text.trim().toUpperCase()
  const messageId: string = msg?.id || ''

  console.log(`quo:webhook from=${from} body="${body}" id=${messageId}`)

  if (!from) return NextResponse.json({ received: true })

  const supabase = getSupabase()
  const normalizedPhone = from.replace(/^\+1/, '').replace(/\D/g, '')
  const contactMatch = `phone.eq.${normalizedPhone},phone.eq.+1${normalizedPhone},phone.eq.${from}`

  if (['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(body)) {
    const { data: contact } = await supabase
      .from('contacts')
      .select('id')
      .or(contactMatch)
      .single()

    if (contact) {
      await supabase.from('contacts').update({ sms_opt_in: false }).eq('id', contact.id)
      await supabase
        .from('scheduled_reminders')
        .update({ status: 'cancelled' })
        .eq('contact_id', contact.id)
        .eq('channel', 'sms')
        .eq('status', 'pending')
      await supabase.from('contact_interactions').insert({
        contact_id: contact.id,
        type: 'sms_unsubscribed',
        metadata: { phone: from, message_id: messageId, provider: 'quo' },
      })
      console.log(`quo:webhook SMS opt-out for ${from}`)
    }
    return NextResponse.json({ received: true, action: 'opt_out' })
  }

  // Log other inbound messages against a known contact.
  const { data: contact } = await supabase
    .from('contacts')
    .select('id')
    .or(contactMatch)
    .single()

  if (contact) {
    await supabase.from('contact_interactions').insert({
      contact_id: contact.id,
      type: 'sms_received',
      metadata: { phone: from, body: text, message_id: messageId, provider: 'quo' },
    })
  }

  return NextResponse.json({ received: true })
}
