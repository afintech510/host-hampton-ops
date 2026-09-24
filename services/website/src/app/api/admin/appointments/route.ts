/**
 * Admin read and edit for appointment bookings.
 *
 * ── EVERY ACTION MAINTAINS THE HOLDS ──
 *
 * This is the half of the double-booking fix that is easy to forget. The old
 * admin route flipped `status` and nothing else, and because availability was
 * computed by reading confirmed rows, that happened to work. It does not work
 * now and it should not: `appointment_slot_holds` is what availability is read
 * from, so a cancellation that leaves its holds behind is a slot nobody can
 * ever rebook — an empty chair that reads as full, which is the more expensive
 * direction of this bug.
 *
 * So:
 *   cancel          → status, AND delete its holds
 *   restore         → re-claim the holds FIRST; 23505 means they went to
 *                     somebody else while this was cancelled, so 409
 *   adjust_duration → grow inserts only the ADDED indices; shrink deletes only
 *                     the tail. Never delete-then-reinsert: that opens a window
 *                     in which the booking's own slots are free.
 *
 * `isAdminAuthorized(req)` is the first statement of every exported handler.
 * Four admin routes in this repo once failed OPEN when `ADMIN_PASSWORD` was
 * unset; the check is not optional and not conditional.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { isUniqueViolation } from '@/lib/planPayment'
import {
  APPOINTMENT_EVENTS,
  resolveAppointmentEvent,
  occupiedSlotIndices,
  estimateCents,
  durationRange,
  type AppointmentEventConfig,
} from '@/lib/appointmentEvents'

export const dynamic = 'force-dynamic'

/** Every event the picker offers, newest-closing last. Config only, no rows. */
function eventSummaries() {
  return Object.values(APPOINTMENT_EVENTS)
    .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
    .map(cfg => ({
      slug: cfg.slug,
      name: cfg.name,
      dateLabel: cfg.dateLabel,
      eventDate: cfg.eventDate,
      slotCount: cfg.slotCount,
      slotMinutes: cfg.slotMinutes,
      firstSlotMinutes: cfg.firstSlotMinutes,
      accentHex: cfg.accentHex,
      paymentMode: cfg.payment.mode,
    }))
}

export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const events = eventSummaries()
  const requested = req.nextUrl.searchParams.get('event')

  // No `?event=` yet — hand back the picker so the tab can render before it has
  // chosen. Defaulting to "the first one" would silently show last year's day.
  const cfg = resolveAppointmentEvent(requested) ?? null
  if (requested && !cfg) {
    return NextResponse.json({ error: 'Unknown event', events }, { status: 400 })
  }
  if (!cfg) {
    return NextResponse.json({ events, event: null, bookings: [], summary: null })
  }

  const supabase = getSupabase()

  // Columns named, never `select('*')`: this table is customer PII and R9 of
  // publicIntakeSurface is the standing rule.
  const { data: bookings, error } = await supabase
    .from('appointment_bookings')
    // ONE string literal, not a concatenation: supabase-js infers the row type
    // from the literal, and `'a, ' + 'b'` widens it to `string` — every field
    // below then types as an error object.
    .select('id, event_slug, name, email, phone, contact_id, slot_index, time_slot, slots_needed, services, party_size, notes, status, estimated_total_cents, amount_paid_cents, paid_at, reminder_sent, created_at')
    .eq('event_slug', cfg.slug)
    .order('slot_index', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) {
    console.error('admin appointments fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch bookings' }, { status: 500 })
  }

  const rows = bookings ?? []
  const confirmed = rows.filter(b => b.status === 'confirmed')
  const pending = rows.filter(b => b.status === 'pending_payment')
  const cancelled = rows.filter(b => b.status === 'cancelled')

  return NextResponse.json({
    events,
    event: events.find(e => e.slug === cfg.slug) ?? null,
    bookings: rows,
    summary: {
      total: rows.length,
      confirmed: confirmed.length,
      pending: pending.length,
      cancelled: cancelled.length,
      totalPeople: confirmed.reduce((sum, b) => sum + (b.party_size || 0), 0),
      totalSlots: confirmed.reduce((sum, b) => sum + (b.slots_needed || 1), 0),
      slotCount: cfg.slotCount,
      // `?? 0`, not `|| 0`. A null estimate means "not priced"; a zero means
      // "free". `||` collapses them, which is the exact shape adminSurface's R9
      // bans on `total_cents` — one admin screen once read an unpriced booking
      // as paid in full off that collapse.
      estimatedCents: confirmed.reduce((sum, b) => sum + (b.estimated_total_cents ?? 0), 0),
      paidCents: rows.reduce((sum, b) => sum + (b.amount_paid_cents ?? 0), 0),
    },
  })
}

/** Claim `indices` for `bookingId`. Returns the failure, or null on success. */
async function claimHolds(
  supabase: ReturnType<typeof getSupabase>,
  cfg: AppointmentEventConfig,
  bookingId: string,
  indices: number[],
): Promise<{ status: number; error: string } | null> {
  if (indices.length === 0) return null
  const { error } = await supabase
    .from('appointment_slot_holds')
    .insert(indices.map(slot_index => ({
      event_slug: cfg.slug,
      slot_index,
      booking_id: bookingId,
      // An admin-made hold never expires — only an unpaid checkout's does.
      expires_at: null,
    })))

  if (!error) return null

  // By CODE, never by reading the message for 'duplicate key'.
  if (isUniqueViolation(error)) {
    return {
      status: 409,
      error: `Those times are already taken — slot${indices.length > 1 ? 's' : ''} ${indices.join(', ')}.`,
    }
  }
  console.error(`admin appointments: could not claim holds for ${bookingId} —`, error.message)
  return { status: 500, error: 'Could not hold those times.' }
}

export async function PATCH(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  const action = typeof body.action === 'string' ? body.action : ''
  if (!id) return NextResponse.json({ error: 'Booking ID is required' }, { status: 400 })

  const supabase = getSupabase()

  const { data: booking, error: readErr } = await supabase
    .from('appointment_bookings')
    .select('id, event_slug, slot_index, slots_needed, services, party_size, status')
    .eq('id', id)
    .maybeSingle()

  if (readErr) {
    console.error('admin appointments read error:', readErr)
    return NextResponse.json({ error: 'Could not read that booking' }, { status: 500 })
  }
  if (!booking) return NextResponse.json({ error: 'No such booking' }, { status: 404 })

  const cfg = resolveAppointmentEvent(booking.event_slug)
  if (!cfg) {
    // A row whose event has been deleted from the registry. Say so rather than
    // guessing a grid — every number below depends on the config.
    return NextResponse.json(
      { error: `This booking belongs to '${booking.event_slug}', which is no longer in the event registry.` },
      { status: 409 },
    )
  }

  const current = booking.slots_needed || 1

  /* ── cancel ─────────────────────────────────────────────────────────────── */
  if (action === 'cancel') {
    const { error } = await supabase
      .from('appointment_bookings')
      .update({ status: 'cancelled' })
      .eq('id', id)

    if (error) return NextResponse.json({ error: 'Failed to cancel booking' }, { status: 500 })

    // The slots go back on the page. A status flip that leaves holds behind is
    // an empty chair nobody can book.
    const { error: holdErr } = await supabase
      .from('appointment_slot_holds')
      .delete()
      .eq('booking_id', id)

    if (holdErr) {
      // The booking IS cancelled and the customer has been told; the residue is
      // a blocked slot, which is recoverable by hand. Loud, and honest about it.
      console.error(`admin appointments: cancelled ${id} but could not free its slots —`, holdErr.message)
      return NextResponse.json({
        success: true,
        warning: 'Cancelled, but the time slots could not be freed. Cancel again to retry.',
      })
    }
    return NextResponse.json({ success: true })
  }

  /* ── restore ────────────────────────────────────────────────────────────── */
  if (action === 'restore') {
    // Holds FIRST. If somebody else took the time while this was cancelled, the
    // right answer is to say so — not to restore a booking onto an occupied slot.
    const indices = occupiedSlotIndices(booking.slot_index, current)
    if (indices[indices.length - 1] >= cfg.slotCount) {
      return NextResponse.json(
        { error: 'This booking runs past the end of the day and cannot be restored as it is. Shorten it first.' },
        { status: 400 },
      )
    }

    const failed = await claimHolds(supabase, cfg, id, indices)
    if (failed) {
      return NextResponse.json(
        {
          error: failed.status === 409
            ? 'Those slots were taken while this was cancelled. Free them or move the booking first.'
            : failed.error,
        },
        { status: failed.status },
      )
    }

    const { error } = await supabase
      .from('appointment_bookings')
      .update({ status: 'confirmed' })
      .eq('id', id)

    if (error) {
      // Undo the claim, or the slots are held by a booking that is still
      // cancelled — blocked and invisible on every screen.
      await supabase.from('appointment_slot_holds').delete().eq('booking_id', id)
      return NextResponse.json({ error: 'Failed to restore booking' }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  /* ── adjust_duration ────────────────────────────────────────────────────── */
  if (action === 'adjust_duration') {
    const next = Number(body.slotsNeeded)
    if (!Number.isInteger(next) || next < 1 || next > cfg.slotCount) {
      return NextResponse.json({ error: `Slots must be 1-${cfg.slotCount}` }, { status: 400 })
    }
    if (booking.slot_index + next > cfg.slotCount) {
      return NextResponse.json(
        { error: `That would run past ${cfg.name}'s last slot.` },
        { status: 400 },
      )
    }
    if (next === current) return NextResponse.json({ success: true })

    if (next > current) {
      // Grow: insert ONLY the added indices. The booking already owns the ones
      // below, and re-inserting them would collide with itself.
      const added = occupiedSlotIndices(booking.slot_index, next).slice(current)
      const failed = await claimHolds(supabase, cfg, id, added)
      if (failed) return NextResponse.json({ error: failed.error }, { status: failed.status })
    } else {
      // Shrink: delete only the tail. `.in()` is safe here — it is at most
      // `slotCount` integers, far under the ~390-uuid URL ceiling.
      const removed = occupiedSlotIndices(booking.slot_index, current).slice(next)
      const { error: delErr } = await supabase
        .from('appointment_slot_holds')
        .delete()
        .eq('booking_id', id)
        .in('slot_index', removed)

      if (delErr) {
        console.error(`admin appointments: could not release slots for ${id} —`, delErr.message)
        return NextResponse.json({ error: 'Could not free the released time.' }, { status: 500 })
      }
    }

    const { error } = await supabase
      .from('appointment_bookings')
      .update({ slots_needed: next })
      .eq('id', id)

    if (error) return NextResponse.json({ error: 'Failed to adjust duration' }, { status: 500 })

    return NextResponse.json({
      success: true,
      slotsNeeded: next,
      duration: durationRange(cfg, booking.slot_index, next),
      estimatedCents: estimateCents(cfg, (booking.services as string[]) || [], booking.party_size || 1),
    })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
