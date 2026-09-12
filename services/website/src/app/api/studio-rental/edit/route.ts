import { ownerEmail } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef } from '@/lib/portalAuth'
import { calculateLineItemTotal, formatMoney } from '@/lib/partyPricing'
import { studioRentalRateWith, hoursBetween, STUDIO_STANDING_CAPACITY } from '@/lib/studioRental'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { updateCalendarEvent, createCalendarEvent } from '@/lib/googleCalendar'
import type { BookingLineItem } from '@/types/booking-flow'
import { escapeHtml } from '@/lib/escapeHtml'

interface IncomingLineItem {
  pricing_item_id?: string | null
  name: string
  category: string
  quantity: number
  unit_price_cents: number
  price_type: string
  guest_multiplied: boolean
}

function to12hr(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

/**
 * Customer self-serve edit of a studio rental after the deposit.
 * Re-prices the rental from the (possibly new) time window, rebuilds line items,
 * recomputes balance (or account credit) from actual payments, updates the
 * Google Calendar block when the window changes, and notifies the owner.
 * Auth: portal cookie (getPortalBookingRef). Open until the event (no hard lock).
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
    const bookingRef = getPortalBookingRef(req.headers.get('cookie'), secret)
    if (!bookingRef) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json()
    const startTime = body.startTime as string
    const endTime = body.endTime as string
    const guestCount = Number(body.guestCount)
    const seatingNeeded = body.seatingNeeded != null ? Number(body.seatingNeeded) : null
    const addOns = (body.lineItems as IncomingLineItem[]) || []

    if (!startTime || !endTime || !guestCount) {
      return NextResponse.json({ error: 'Missing time or guest count' }, { status: 400 })
    }
    if (guestCount > STUDIO_STANDING_CAPACITY) {
      return NextResponse.json({ error: `Our studio holds up to ${STUDIO_STANDING_CAPACITY} guests — please call us.` }, { status: 400 })
    }

    const supabase = getSupabase()
    const { data: booking } = await supabase
      .from('bookings')
      .select('id, booking_ref, event_type, party_date, party_time, contact_name, contact_email, contact_phone, status, party_tags, quote_snapshot, google_calendar_event_id')
      .eq('booking_ref', bookingRef)
      .single()

    if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    if (booking.event_type !== 'studio-rental') {
      return NextResponse.json({ error: 'Not a studio rental booking' }, { status: 400 })
    }

    const partyDate = booking.party_date as string
    const hours = hoursBetween(startTime, endTime)
    const { studioRates } = await loadPricingCatalog()
    if (hours < studioRates.minHours) {
      return NextResponse.json({ error: `Minimum rental is ${studioRates.minHours} hours.` }, { status: 400 })
    }
    const rate = studioRentalRateWith(studioRates, partyDate, hours)

    // Rebuild full line-item set: rental first, then add-ons.
    const rentalLine: IncomingLineItem = {
      pricing_item_id: null,
      name: rate.lineItemLabel,
      category: 'rental',
      quantity: 1,
      unit_price_cents: rate.rentalCents,
      price_type: 'flat',
      guest_multiplied: false,
    }
    const allLineItems = [rentalLine, ...addOns]
    const totalCents = calculateLineItemTotal(allLineItems as unknown as BookingLineItem[], guestCount)

    // Balance from actual payments (allow credit when overpaid).
    const { data: payRows } = await supabase
      .from('booking_payments').select('amount_cents, payment_type').eq('booking_id', booking.id)
    let paidCents = 0
    for (const p of payRows || []) {
      if (p.payment_type === 'refund') paidCents -= p.amount_cents
      else paidCents += p.amount_cents
    }
    const balanceCents = Math.max(0, totalCents - paidCents)
    const creditCents = Math.max(0, paidCents - totalCents)

    // Replace line items
    await supabase.from('booking_line_items').delete().eq('booking_id', booking.id)
    await supabase.from('booking_line_items').insert(allLineItems.map((item, idx) => ({
      booking_id: booking.id,
      pricing_item_id: item.pricing_item_id || null,
      name: item.name,
      category: item.category,
      quantity: item.quantity,
      unit_price_cents: item.unit_price_cents,
      price_type: item.price_type,
      guest_multiplied: item.guest_multiplied,
      sort_order: idx,
    })))

    const oldTags = (booking.party_tags as Record<string, unknown> | null) || {}
    const timeChanged = oldTags.rental_start_time !== startTime || oldTags.rental_end_time !== endTime
    const newTags = {
      ...oldTags,
      rental_start_time: startTime,
      rental_end_time: endTime,
      rental_hours: rate.hours,
      is_weekend: rate.isWeekend,
      seating_needed: seatingNeeded,
    }
    const newSnapshot = {
      ...((booking.quote_snapshot as Record<string, unknown> | null) || {}),
      lineItems: allLineItems, guestCount, totalCents, rate, startTime, endTime,
    }

    // Status: re-open if a new balance appeared; mark paid when settled.
    const updateFields: Record<string, unknown> = {
      total_cents: totalCents,
      balance_due_cents: balanceCents,
      guest_count_approx: guestCount,
      party_time: startTime,
      party_tags: newTags,
      quote_snapshot: newSnapshot,
      updated_at: new Date().toISOString(),
    }
    if (balanceCents === 0) {
      updateFields.status = 'paid_in_full'
      updateFields.paid_in_full_at = new Date().toISOString()
    } else if (booking.status === 'paid_in_full') {
      updateFields.status = 'pending_review'
      updateFields.paid_in_full_at = null
    }
    await supabase.from('bookings').update(updateFields).eq('id', booking.id)

    // Audit log
    await supabase.from('booking_modifications').insert({
      booking_id: booking.id,
      modified_by: 'customer',
      change_summary: `Updated rental: ${to12hr(startTime)}–${to12hr(endTime)} (${rate.hours} hrs), ${addOns.length} add-on(s). Total ${formatMoney(totalCents)}, balance ${formatMoney(balanceCents)}.`,
    }).then(({ error }) => { if (error) console.error('Studio edit audit error (non-fatal):', error) })

    // Google Calendar: update the existing block (or create + store id) when the window changed.
    if (timeChanged) {
      const summary = `[STUDIO RENTAL] ${booking.contact_name || 'Rental'} — ${(oldTags.event_label as string) || 'Event'}`
      const description = `Ref: ${bookingRef}\nContact: ${booking.contact_name || ''} (${booking.contact_email || ''})\nGuests: ~${guestCount}\nUpdated by customer`
      const existingId = booking.google_calendar_event_id as string | null
      if (existingId) {
        await updateCalendarEvent(existingId, { startDate: partyDate, startTime, endTime, summary, description })
          .catch(err => console.error('Studio GCal update error (non-fatal):', err))
      } else {
        const newId = await createCalendarEvent({ summary, startDate: partyDate, startTime, endTime, description })
          .catch(() => null)
        if (newId) await supabase.from('bookings').update({ google_calendar_event_id: newId }).eq('id', booking.id)
      }

      // Notify the owner of the time change.
      if (process.env.RESEND_API_KEY) {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const from = process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com'
        await resend.emails.send({
          from, to: ownerEmail(),
          subject: `⏱ Studio time changed: ${booking.contact_name} — ${bookingRef}`,
          html: `<p><strong>${escapeHtml(booking.contact_name)}</strong> (${escapeHtml(bookingRef)}) changed their studio time to <strong>${to12hr(startTime)}–${to12hr(endTime)}</strong> on ${escapeHtml(partyDate)} (${rate.hours} hrs).</p><p>New total ${formatMoney(totalCents)}, balance ${formatMoney(balanceCents)}. The calendar block was updated — please confirm there's no overlap.</p>`,
        }).catch(err => console.error('Studio time-change email error (non-fatal):', err))
      }
    }

    return NextResponse.json({
      ok: true,
      totalCents,
      balanceCents,
      creditCents,
      startTime,
      endTime,
      hours: rate.hours,
      rate,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Edit failed'
    console.error('Studio rental edit error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
