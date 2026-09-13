import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isLocalRequest } from '@/lib/publicOrigin'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { findBookingsByContactEmail } from '@/lib/contactLookup'
import {
  getEmailFromCookie,
  clearEmailCookieHeader,
  setPortalCookieHeader,
  portalSigningSecret,
} from '@/lib/portalAuth'

/**
 * GET — returns all bookings tied to the email cookie, grouped by status.
 * DELETE — clears the email cookie + the per-booking portal cookie (logout).
 * POST { booking_ref } — switches the per-booking portal cookie to the chosen
 *   plan, so the planner loads it on next request. Verifies the booking
 *   belongs to the email session before switching.
 *
 * ── Two things this route got wrong, both measured in production ──────────
 *
 * 1. **The authorization filter was a LIKE pattern.** `.ilike('contact_email',
 *    email)` with the cookie's own value as the pattern: a session for the
 *    single character `%` returned **34 bookings** — every kids party in the
 *    database, with the children's names on them. The POST handler three
 *    functions below compared the same two addresses EXACTLY, in the same file,
 *    and was right. It now goes through `findBookingsByContactEmail`, which
 *    fetches candidates with `ilike` and then re-compares in JS — the rule
 *    `findContactsByEmail` has stated since link 9.
 *
 * 2. **A hand-written `event_type` allowlist hid 15 live bookings.** It named
 *    `kid-party`, `kids-party` and `kids_party`; the database holds **zero**
 *    rows of the third and 8 kids parties spelled `Kids Birthday Party` /
 *    `kids-birthday-party`, plus 9 room rentals, 4 mobile parties and 2 studio
 *    rentals. A customer with a room rental signed in successfully and was shown
 *    an empty list — a confident false statement (rule 10). The list is gone:
 *    a customer is entitled to every booking under their own address, and the
 *    only filter left is `cancelled`.
 */

/** Columns the customer's own list may see. Not `select('*')` — see the GET in ./booking. */
const LIST_COLUMNS =
  'id, booking_ref, status, event_type, party_date, party_time, package_type, ' +
  'child_name, child_age, total_cents, balance_due_cents, party_tags, paid_in_full_at, ' +
  'created_at, contact_email'

export async function GET(req: NextRequest) {
  const secret = portalSigningSecret()
  const email = getEmailFromCookie(req.headers.get('cookie'), secret)
  if (!email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()
  const lookup = await findBookingsByContactEmail(supabase, email, LIST_COLUMNS, {
    excludeCancelled: true,
  })

  // Rule 12: a failed read is not "you have no parties with us". Saying that to
  // a customer who has paid a deposit is the expensive direction.
  if (lookup.kind === 'unavailable') {
    console.error('portal my-bookings: booking read failed:', lookup.error)
    return NextResponse.json(
      { error: 'We could not load your bookings just now — please try again.' },
      { status: 503 },
    )
  }

  const bookings = (lookup.kind === 'found' ? lookup.bookings : [])
    .slice()
    .sort((a, b) => {
      const ad = String(a.party_date ?? '')
      const bd = String(b.party_date ?? '')
      if (ad !== bd) return ad < bd ? 1 : -1
      return String(b.created_at ?? '') < String(a.created_at ?? '') ? -1 : 1
    })
    .slice(0, 50) as unknown as Array<Record<string, any>>

  const today = new Date().toISOString().split('T')[0]
  const enriched = bookings.map(b => {
    const tags = (b.party_tags as Record<string, unknown> | null) || {}
    const past = b.party_date && b.party_date < today
    const status: 'past' | 'upcoming' | 'draft' =
      past ? 'past' :
      b.status === 'awaiting_deposit' && !tags.date_locked ? 'draft' :
      'upcoming'
    return {
      id: b.id,
      booking_ref: b.booking_ref,
      status_raw: b.status,
      bucket: status,
      party_date: b.party_date,
      party_time: b.party_time,
      package_type: b.package_type,
      child_name: b.child_name,
      catchy_party_name: (tags.catchy_party_name as string | undefined) || null,
      total_cents: b.total_cents,
      balance_due_cents: b.balance_due_cents,
      paid_in_full_at: b.paid_in_full_at,
    }
  })

  return NextResponse.json({ email, bookings: enriched })
}

export async function DELETE() {
  // Sign out — clear both cookies
  const headers = new Headers()
  headers.append('Set-Cookie', clearEmailCookieHeader())
  // Also clear per-booking cookie so the planner doesn't auto-load anything
  headers.append('Set-Cookie', 'hh_portal=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure')
  return new NextResponse(JSON.stringify({ ok: true }), { headers, status: 200 })
}

export async function POST(req: NextRequest) {
  // Switch the per-booking cookie to the booking_ref the user picked.
  // This is a `bookings` read per call keyed on a caller-supplied ref, so it is
  // the one handler here that a script could use to walk the ref space — and
  // unlike `/api/portal/auth` it needs no token, only an email session. It does
  // not leak (the answer is identical for "no such ref" and "not yours"), but a
  // bound on it is cheap. One real request in the ten-day window.
  const limited = guardRate(req, plannerRule('portal/my-bookings'))
  if (limited) return limited

  const secret = portalSigningSecret()
  const email = getEmailFromCookie(req.headers.get('cookie'), secret)
  if (!email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const bookingRef = body.booking_ref as string | undefined
  if (!bookingRef) return NextResponse.json({ error: 'booking_ref required' }, { status: 400 })

  const supabase = getSupabase()
  const { data: booking, error: readErr } = await supabase
    .from('bookings')
    .select('id, contact_email')
    .eq('booking_ref', bookingRef)
    .maybeSingle()

  // Rule 12, again: "could not read" told as "not your booking" sends a
  // customer to look for a plan that is sitting right there.
  if (readErr) {
    console.error('portal my-bookings POST: booking read failed:', readErr.message)
    return NextResponse.json({ error: 'Could not switch plans just now — try again.' }, { status: 503 })
  }

  // The exact, case-insensitive comparison. This was always right here; it was
  // the GET above that trusted a LIKE pattern.
  if (!booking || (booking.contact_email || '').trim().toLowerCase() !== email.trim().toLowerCase()) {
    return NextResponse.json({ error: 'Booking not found for this email' }, { status: 404 })
  }

  // NOTE: this used to mint a `portal_tokens` row here "so admin/manual links
  // keep working", and then discard the raw token (`void rawToken`). A token
  // whose plaintext nobody kept can never be matched by `/api/portal/auth`, so
  // the row was unreachable by construction — it made no link work and it is a
  // large part of why one booking carried 15 live tokens. The cookie is set
  // directly below, which is what actually signs the customer in.

  const isLocal = isLocalRequest(req)

  const response = NextResponse.json({ ok: true, bookingRef })
  response.headers.set('Set-Cookie', setPortalCookieHeader(bookingRef, secret, isLocal))
  return response
}
