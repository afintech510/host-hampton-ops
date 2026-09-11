import { ownerEmail, notifyOwnerSms, leadSmsLine } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enqueueBookingReminders } from '@/lib/reminders'
import { enrollInSequence } from '@/lib/sequences'
import { formatMoney } from '@/lib/partyPricing'
import { partyRequestReceivedHtml, partyAdminNewBookingHtml } from '@/lib/emailTemplates'

export async function POST(req: NextRequest) {
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
      utm,
      marketingConsent,
    } = body

    if (!partyDate || !partyTime || !contactName || !contactEmail || !contactPhone) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Look up booking type for deposit configuration
    let depositCents = 9900 // default $99
    let requiresDeposit = true

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
      const contactId = await upsertContact({
        name: contactName,
        email: contactEmail,
        phone: contactPhone,
        sourceDetail: `Booking — ${eventType || 'other'}`,
        serviceInterests: [bookingTypeSlug || 'general'],
        marketingConsent: !!marketingConsent,
      })

      // Enroll in post-booking sequence (non-fatal)
      if (contactId) {
        await enrollInSequence({
          contactId,
          contactEmail: contactEmail,
          triggerEvent: 'booking_confirmed',
          serviceType: bookingTypeSlug || eventType || 'general',
          eventDate: partyDate,
          bookingRef,
        }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
      }

      // Enqueue booking reminders (non-fatal)
      if (partyDate) {
        await enqueueBookingReminders({
          contactEmail,
          bookingRef,
          partyDate,
        }).catch(err => console.error('Booking reminder enqueue error:', err))
      }

      return NextResponse.json({ url: `https://${host}/book/success?ref=${bookingRef}` })
    }

    // Deposit-required bookings (parties, room rentals) are now REQUESTS — we
    // never charge or lock a date here. The team reviews availability and
    // approves; the customer pays the deposit afterward via their booking
    // portal. This prevents a customer from paying to reserve a slot that isn't
    // actually available (which previously forced refunds).
    const supabaseReq = getSupabase()
    const bookingRef = `HH-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`

    let reqPartyTags = {}
    try { reqPartyTags = partyTags || {} } catch { /* ignore */ }

    const { error: reqErr } = await supabaseReq.from('bookings').insert({
      status: 'pending_review',
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
      deposit_amount: depositCents,
      party_tags: reqPartyTags,
      notes: notes || null,
      booking_ref: bookingRef,
    })

    if (reqErr) {
      console.error('Party request insert error:', reqErr)
      return NextResponse.json({ error: 'Request failed' }, { status: 500 })
    }

    console.log('Party request created:', bookingRef, 'for', contactEmail, 'on', partyDate)

    // Upsert contact (non-fatal)
    await upsertContact({
      name: contactName,
      email: contactEmail,
      phone: contactPhone,
      sourceDetail: `Party request — ${eventType || 'party'}`,
      serviceInterests: [bookingTypeSlug || eventType || 'general'],
      marketingConsent: !!marketingConsent,
    })

    // Notify the customer (request received — no payment, nothing booked yet)
    // and the team (new request to review for availability).
    if (process.env.RESEND_API_KEY) {
      const partyDateFormatted = new Date(partyDate + 'T12:00:00').toLocaleDateString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
      })
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'

      await Promise.allSettled([
        resend.emails.send({
          from,
          to: contactEmail,
          subject: `We got your party request — ${bookingRef}`,
          html: partyRequestReceivedHtml({
            customerName: contactName,
            bookingRef,
            partyDate: partyDateFormatted,
            partyTime,
            depositFormatted: formatMoney(depositCents),
          }),
        }),
        resend.emails.send({
          from,
          to: ownerEmail(),
          subject: `New party REQUEST: ${contactName} — ${bookingRef}`,
          html: partyAdminNewBookingHtml({
            bookingRef,
            customerName: contactName,
            customerEmail: contactEmail,
            customerPhone: contactPhone,
            partyDate,
            partyTime,
            guestCount: guestCount ? parseInt(guestCount, 10) : 0,
            packageType: packageName || eventType || 'Party',
            depositFormatted: formatMoney(depositCents),
            totalFormatted: 'TBD',
            paymentMethod: 'request',
            lineItems: [],
            notes,
            adminUrl: `https://${host}/admin?tab=parties&ref=${bookingRef}`,
          }),
        }),
      ])
      console.log('Party request emails sent for', bookingRef)
    }
    await notifyOwnerSms(leadSmsLine({
      kind: `party REQUEST ${bookingRef} (${packageName || eventType || 'party'})`, name: contactName,
      phone: contactPhone, email: contactEmail, date: `${partyDate} ${partyTime || ''}`.trim(), guests: guestCount,
    }))

    void utm
    return NextResponse.json({ url: `https://${host}/book/success?request=1&ref=${bookingRef}` })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    console.error('Stripe checkout error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
