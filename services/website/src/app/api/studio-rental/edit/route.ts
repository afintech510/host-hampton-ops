import { ownerEmail } from '@/lib/ownerNotify'
import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { getPortalBookingRef, portalSigningSecret } from '@/lib/portalAuth'
import { calculateLineItemTotal, formatMoney } from '@/lib/partyPricing'
import { studioRentalRateWith, hoursBetween, STUDIO_STANDING_CAPACITY } from '@/lib/studioRental'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { updateCalendarEvent, createCalendarEvent } from '@/lib/googleCalendar'
import type { BookingLineItem } from '@/types/booking-flow'
import { escapeHtml } from '@/lib/escapeHtml'
import { screenPublicLineItems, screenPublicGuestCount, screenPublicCount } from '@/lib/publicIntake'
import { readBalanceInputs, computeBalance } from '@/lib/bookingBalance'
import { writeLineItemsResult } from '@/lib/plan'
import { guardRate, plannerRule } from '@/lib/rateLimit'

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
 *
 * ── THE ADD-ON PRICES WERE THE CUSTOMER'S TO CHOOSE ──
 *
 * `body.lineItems` went into `calculateLineItemTotal` and then into
 * `booking_line_items` verbatim. The rental line itself is derived server-side
 * from the time window (`studioRentalRateWith`) and always was — but the add-ons
 * beside it were not, and they are part of the same sum. One add-on priced
 * `-1000000` made `totalCents` negative, `Math.max(0, total - paid)` zero, and
 * the block below then wrote `status = 'paid_in_full'` and `paid_in_full_at`:
 * a customer holding nothing but their own portal cookie could mark their studio
 * rental settled. `screenPublicLineItems` is why they cannot; negative prices are
 * the admin discount facility and stay admin-only.
 *
 * Two more things were wrong in the same twenty lines. The line items were
 * replaced by a bare `delete()` followed by an `insert()` with BOTH errors
 * discarded — a successful delete plus a failed insert wipes the customer's
 * invoice, which is exactly why `writeLineItems` bails rather than inserting on
 * top of rows it could not clear. And the balance came from two discarded reads
 * with `(total || 0)`, so a Supabase blip settled the booking. Rules 11, 12, 19.
 */
export async function POST(req: NextRequest) {
  try {
    const limited = guardRate(req, plannerRule('studio-rental/edit'))
    if (limited) return limited

    const secret = portalSigningSecret()
    const bookingRef = getPortalBookingRef(req.headers.get('cookie'), secret)
    if (!bookingRef) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json()
    const startTime = body.startTime as string
    const endTime = body.endTime as string
    const guestCount = screenPublicGuestCount(body.guestCount)
    const seatingNeeded = body.seatingNeeded != null ? screenPublicCount(body.seatingNeeded, STUDIO_STANDING_CAPACITY) : null

    if (!startTime || !endTime || !guestCount) {
      return NextResponse.json({ error: 'Missing time or guest count' }, { status: 400 })
    }
    if (guestCount > STUDIO_STANDING_CAPACITY) {
      return NextResponse.json({ error: `Our studio holds up to ${STUDIO_STANDING_CAPACITY} guests — please call us.` }, { status: 400 })
    }

    const screened = screenPublicLineItems(body.lineItems, guestCount)
    if (!screened.ok) {
      console.warn(`studio-rental/edit: refused line items for ${bookingRef} — ${screened.reason}`)
      return NextResponse.json({ error: `We could not accept those add-ons: ${screened.reason}` }, { status: 400 })
    }
    const addOns = screened.lineItems

    const supabase = getSupabase()
    const { data: booking, error: bookingErr } = await supabase
      .from('bookings')
      .select('id, booking_ref, event_type, party_date, party_time, contact_name, contact_email, contact_phone, status, party_tags, quote_snapshot, google_calendar_event_id')
      .eq('booking_ref', bookingRef)
      .maybeSingle()

    // Three outcomes, not two (rule 12): a failed read is not "no such booking",
    // and answering 404 tells a customer their rental is gone.
    if (bookingErr) {
      console.error('studio-rental/edit: booking read failed —', bookingErr.message)
      return NextResponse.json({ error: 'Could not load your booking. Please try again.' }, { status: 503 })
    }
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

    // Rebuild full line-item set: rental first, then the screened add-ons.
    const rentalLine = {
      pricing_item_id: null,
      name: rate.lineItemLabel,
      category: 'rental',
      quantity: 1,
      unit_price_cents: rate.rentalCents,
      price_type: 'flat',
      guest_multiplied: false,
      sort_order: 0,
    } as unknown as BookingLineItem
    const allLineItems: BookingLineItem[] = [rentalLine, ...addOns]
    const totalCents = calculateLineItemTotal(allLineItems, guestCount)

    // Balance from actual payments, through the one definition. An unreadable
    // `booking_payments` used to mean `paidCents = 0`, which asks a customer who
    // has already paid a deposit for the whole total again.
    const inputs = await readBalanceInputs(supabase, booking.id, 'id')
    if (!inputs.ok) {
      console.error('studio-rental/edit: balance inputs unreadable —', inputs.message)
      return NextResponse.json({ error: 'Could not read your payments. Please try again.' }, { status: 503 })
    }
    const paidCents = inputs.paidSum
    const { balanceCents, paidInFull, overpaidCents: creditCents } = computeBalance(totalCents, paidCents)

    // Replace line items through the canonical writer, which refuses to insert
    // on top of rows it failed to clear — doubling an invoice is worse than
    // leaving the old plan in place, and losing it entirely is worse than both.
    const write = await writeLineItemsResult(supabase, booking.id, allLineItems, { replace: true })
    if (!write.ok) {
      // Two different situations, and the customer is owed a different sentence
      // for each: `delete-failed` left the old plan intact, `insert-failed` did
      // not. Either way the total is NOT written on top of items that disagree
      // with it — which is what produced an invoice whose rows do not add up.
      console.error(`studio-rental/edit: ${write.outcome} for ${bookingRef} — ${write.message}`)
      return NextResponse.json(
        {
          error:
            write.outcome === 'delete-failed'
              ? 'We could not save those changes. Nothing was altered — please try again.'
              : 'Something went wrong saving your add-ons. Please call us on (631) 998-9325 so we can fix your booking.',
        },
        { status: 503 },
      )
    }

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
    // `paidInFull` rather than `balanceCents === 0`: an unpriced or zero-total
    // booking clamps the balance to 0 without being settled, and stamping
    // `paid_in_full_at` on one is a false statement about a customer's money.
    if (paidInFull) {
      updateFields.status = 'paid_in_full'
      updateFields.paid_in_full_at = new Date().toISOString()
    } else if (booking.status === 'paid_in_full') {
      updateFields.status = 'pending_review'
      updateFields.paid_in_full_at = null
    }
    // The line items are already replaced; if this write is refused the booking
    // carries a total that disagrees with its own rows, so the customer must be
    // told rather than shown a figure nothing stored (rules 10 and 19).
    const { data: updatedRows, error: updateErr } = await supabase
      .from('bookings')
      .update(updateFields)
      .eq('id', booking.id)
      .select('id')
    if (updateErr || (updatedRows ?? []).length !== 1) {
      console.error(
        `studio-rental/edit: booking update wrote ${(updatedRows ?? []).length} rows for ${bookingRef} —`,
        updateErr?.message ?? 'no error reported',
      )
      return NextResponse.json(
        { error: 'Your add-ons were saved but the total did not update. Please call us on (631) 998-9325.' },
        { status: 503 },
      )
    }

    // Audit log. Destructured rather than `.then(({ error }) => …)` on an awaited
    // chain: the surface rule that forbids a bare `await …insert(…)` is looking at
    // the statement, and a promise callback hanging off an await is the shape that
    // makes "did anybody read this error?" a question you have to squint at.
    const { error: auditErr } = await supabase.from('booking_modifications').insert({
      booking_id: booking.id,
      modified_by: 'customer',
      change_summary: `Updated rental: ${to12hr(startTime)}–${to12hr(endTime)} (${rate.hours} hrs), ${addOns.length} add-on(s). Total ${formatMoney(totalCents)}, balance ${formatMoney(balanceCents)}.`,
    })
    if (auditErr) console.error('Studio edit audit error (non-fatal):', auditErr.message)

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
        if (newId) {
          // Unchecked, this silently loses the id and the NEXT edit creates a
          // second calendar block for the same rental (rule 19).
          const { error: gcalErr } = await supabase
            .from('bookings').update({ google_calendar_event_id: newId }).eq('id', booking.id)
          if (gcalErr) {
            console.error(
              `studio-rental/edit: calendar event ${newId} created for ${bookingRef} but its id was not stored —`,
              gcalErr.message,
            )
          }
        }
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
