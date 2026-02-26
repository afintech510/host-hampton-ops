import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'

export async function POST(req: NextRequest) {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' })

  try {
    const body = await req.json()
    const {
      packageName,
      partyDate,
      partyTime,
      eventType,
      contactName,
      contactEmail,
      contactPhone,
      childName,
      childAge,
      guestCount,
      notes,
      partyTags,
      bookingTypeSlug,
    } = body

    if (!partyDate || !partyTime || !contactName || !contactEmail || !contactPhone) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Look up booking type for deposit configuration
    let depositCents = 9900 // default $99
    let requiresDeposit = true
    let slotDurationMin = 120

    if (bookingTypeSlug) {
      const supabase = getSupabase()
      const { data: bt } = await supabase
        .from('booking_types')
        .select('deposit_cents, requires_deposit, slot_duration_min')
        .eq('slug', bookingTypeSlug)
        .eq('is_active', true)
        .single()

      if (bt) {
        depositCents = bt.deposit_cents
        requiresDeposit = bt.requires_deposit
        slotDurationMin = bt.slot_duration_min
      }
    }

    const host = req.headers.get('x-forwarded-host') || req.headers.get('host')

    // Free bookings — skip Stripe, insert directly
    if (!requiresDeposit || depositCents === 0) {
      const supabase = getSupabase()
      const bookingRef = `HH-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`

      let bookingPartyTags = {}
      try { bookingPartyTags = partyTags || {} } catch { /* ignore */ }

      const { error: dbError } = await supabase.from('bookings').insert({
        status: 'confirmed',
        event_type: eventType || 'other',
        party_date: partyDate,
        party_time: partyTime,
        package_type: packageName || null,
        guest_count_approx: guestCount ? parseInt(guestCount, 10) : null,
        child_name: childName || null,
        child_age: childAge ? parseInt(childAge, 10) : null,
        contact_name: contactName,
        contact_email: contactEmail,
        contact_phone: contactPhone || null,
        deposit_amount: 0,
        party_tags: bookingPartyTags,
        notes: notes || null,
        booking_ref: bookingRef,
      })

      if (dbError) {
        console.error('Free booking insert error:', dbError)
        return NextResponse.json({ error: 'Booking failed' }, { status: 500 })
      }

      console.log('Free booking created:', bookingRef, 'for', contactEmail, 'on', partyDate)

      // Upsert contact (non-fatal)
      await upsertContact({
        name: contactName,
        email: contactEmail,
        phone: contactPhone,
        sourceDetail: `Booking — ${eventType || 'other'}`,
        serviceInterests: [bookingTypeSlug || 'general'],
      })

      return NextResponse.json({ url: `https://${host}/book/success?ref=${bookingRef}` })
    }

    // Paid bookings — create Stripe session
    const depositLabel = `$${(depositCents / 100).toFixed(0)}`

    // Build rich description for Stripe checkout
    const descParts = []
    if (childName) descParts.push(`Celebrating: ${childName}${childAge ? ` (age ${childAge})` : ''}`)
    descParts.push(`Date: ${partyDate} at ${partyTime}`)
    if (packageName) descParts.push(`Theme: ${packageName}`)
    if (guestCount) descParts.push(`Guests: ${guestCount}`)
    descParts.push(`${depositLabel} deposit — applied toward your party balance.`)

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: childName
                ? `${childName}'s ${packageName || 'Birthday'} Party — Deposit`
                : `Host Hampton — ${packageName || eventType || 'Booking'} Deposit`,
              description: descParts.join(' | '),
            },
            unit_amount: depositCents,
          },
          quantity: 1,
        },
      ],
      customer_email: contactEmail,
      custom_text: {
        submit: {
          message: 'Your deposit is fully applied toward your party balance. All details (theme, date, guest count) can be modified up to 1 week before your event.',
        },
      },
      metadata: {
        packageName: packageName || '',
        partyDate,
        partyTime,
        eventType: eventType || 'other',
        contactName,
        contactEmail,
        contactPhone: contactPhone || '',
        childName: childName || '',
        childAge: childAge || '',
        guestCount: guestCount || '',
        notes: notes || '',
        partyTags: JSON.stringify(partyTags || {}),
        bookingTypeSlug: bookingTypeSlug || '',
        slotDurationMin: String(slotDurationMin),
        depositCents: String(depositCents),
      },
      // Use forwarded host from nginx (req.nextUrl.origin is the internal Docker hostname)
      success_url: `https://${host}/book/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://${host}/party-packages?cancelled=true`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    console.error('Stripe checkout error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
