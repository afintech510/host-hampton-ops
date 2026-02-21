import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!)

  const body = await req.text()
  const sig = req.headers.get('stripe-signature')

  if (!sig) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Signature verification failed'
    console.error('Webhook signature error:', message)
    return NextResponse.json({ error: message }, { status: 400 })
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const m = session.metadata || {}

    const partyDate = m.partyDate
    const optionsLockedBy = partyDate
      ? new Date(new Date(partyDate).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
      : null

    let partyTags = {}
    try {
      partyTags = m.partyTags ? JSON.parse(m.partyTags) : {}
    } catch { /* ignore parse errors */ }

    const { error } = await supabase.from('bookings').insert({
      status: 'deposit_paid',
      event_type: m.eventType || 'kid-party',
      party_date: partyDate,
      party_time: m.partyTime,
      package_type: m.packageName || null,
      guest_count_approx: m.guestCount ? parseInt(m.guestCount, 10) : null,
      child_name: m.childName || null,
      child_age: m.childAge ? parseInt(m.childAge, 10) : null,
      contact_name: m.contactName,
      contact_email: m.contactEmail,
      contact_phone: m.contactPhone || null,
      deposit_amount: 250,
      stripe_payment_intent_id: session.payment_intent as string,
      stripe_session_id: session.id,
      party_tags: partyTags,
      notes: m.notes || null,
      options_locked_by: optionsLockedBy,
      booking_ref: `HH-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`,
    })

    if (error) {
      console.error('Supabase insert error:', error)
      // Still return 200 so Stripe doesn't retry — log for manual fix
    } else {
      console.log('Booking created for', m.contactEmail, 'on', partyDate)
    }
  }

  return NextResponse.json({ received: true })
}
