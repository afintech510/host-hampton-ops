import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { getSupabase } from '@/lib/supabase'
import { upsertContact } from '@/lib/contacts'
import { enqueueBookingReminders, enqueueReviewRequest } from '@/lib/reminders'
import { enrollInSequence } from '@/lib/sequences'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  try {
    const body = await req.json()
    const {
      contactName,
      contactEmail,
      contactPhone,
      partyDate,
      partyTime,
      eventType,
      packageName,
      childName,
      childAge,
      guestCount,
      notes,
      depositAmount,
      source,
    } = body

    if (!contactName || !contactEmail || !partyDate || !partyTime || !eventType) {
      return NextResponse.json({ error: 'Missing required fields (name, email, date, time, type)' }, { status: 400 })
    }

    const supabase = getSupabase()
    const bookingRef = `HH-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`
    const depositCents = Math.round((parseFloat(depositAmount) || 0) * 100)

    // Combine source info into notes
    const fullNotes = source && source !== 'Other'
      ? `[Source: ${source}]${notes ? ` ${notes}` : ''}`
      : notes || null

    const { data: booking, error: dbError } = await supabase.from('bookings').insert({
      status: 'confirmed',
      event_type: eventType,
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
      notes: fullNotes,
      booking_ref: bookingRef,
    }).select('id').single()

    if (dbError) {
      console.error('Manual booking insert error:', dbError)
      return NextResponse.json({ error: 'Booking creation failed' }, { status: 500 })
    }

    console.log('Manual booking created:', bookingRef, 'for', contactEmail, 'source:', source)

    // Upsert contact
    const contactId = await upsertContact({
      name: contactName,
      email: contactEmail,
      phone: contactPhone,
      sourceDetail: `Manual booking — ${source || 'Admin'}`,
      serviceInterests: [eventType],
      marketingConsent: true,
    })

    // Enqueue reminders if event is in the future
    const eventDateObj = new Date(partyDate + 'T12:00:00')
    if (eventDateObj > new Date()) {
      await enqueueBookingReminders({
        contactEmail,
        bookingRef,
        partyDate,
      }).catch(err => console.error('Booking reminder enqueue error:', err))

      await enqueueReviewRequest({
        contactEmail,
        referenceType: 'booking',
        referenceId: booking?.id || bookingRef,
        eventDate: partyDate,
      }).catch(err => console.error('Review request enqueue error:', err))
    }

    // Enroll in post-booking sequence
    if (contactId) {
      await enrollInSequence({
        contactId,
        contactEmail,
        triggerEvent: 'booking_confirmed',
        serviceType: eventType,
        eventDate: partyDate,
        bookingRef,
      }).catch(err => console.error('Sequence enrollment error (non-fatal):', err))
    }

    return NextResponse.json({ booking: { id: booking?.id, booking_ref: bookingRef }, success: true })
  } catch (err) {
    console.error('Manual booking error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
