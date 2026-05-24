import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import {
  getEmailFromCookie,
  clearEmailCookieHeader,
  generatePortalToken,
  buildPortalCookieValue,
  setPortalCookieHeader,
} from '@/lib/portalAuth'

/**
 * GET — returns all bookings tied to the email cookie, grouped by status.
 * DELETE — clears the email cookie + the per-booking portal cookie (logout).
 * POST { booking_ref } — switches the per-booking portal cookie to the chosen
 *   plan, so the planner loads it on next request. Verifies the booking
 *   belongs to the email session before switching.
 */

export async function GET(req: NextRequest) {
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const email = getEmailFromCookie(req.headers.get('cookie'), secret)
  if (!email) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const supabase = getSupabase()
  const { data: bookings } = await supabase
    .from('bookings')
    .select('id, booking_ref, status, event_type, party_date, party_time, package_type, child_name, child_age, total_cents, balance_due_cents, party_tags, paid_in_full_at, created_at')
    .ilike('contact_email', email)
    .in('event_type', ['kid-party', 'kids-party', 'kids_party'])
    .order('party_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(50)

  const today = new Date().toISOString().split('T')[0]
  const enriched = (bookings || []).map(b => {
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
  // Switch the per-booking cookie to the booking_ref the user picked
  const secret = process.env.PORTAL_LINK_SIGNING_SECRET || 'dev-secret'
  const email = getEmailFromCookie(req.headers.get('cookie'), secret)
  if (!email) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const bookingRef = body.booking_ref as string | undefined
  if (!bookingRef) return NextResponse.json({ error: 'booking_ref required' }, { status: 400 })

  const supabase = getSupabase()
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, contact_email')
    .eq('booking_ref', bookingRef)
    .maybeSingle()

  if (!booking || (booking.contact_email || '').toLowerCase() !== email.toLowerCase()) {
    return NextResponse.json({ error: 'Booking not found for this email' }, { status: 404 })
  }

  // Also create a fresh portal token so admin/manual links keep working
  const { token: rawToken, hash, expiresAt } = generatePortalToken(bookingRef, secret)
  await supabase.from('portal_tokens').insert({
    booking_id: booking.id,
    token_hash: hash,
    expires_at: expiresAt.toISOString(),
  }).then(({ error }) => { if (error) console.error('Portal token insert (non-fatal):', error) })

  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'localhost:3002'
  const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1')

  const response = NextResponse.json({ ok: true, bookingRef })
  response.headers.set('Set-Cookie', setPortalCookieHeader(bookingRef, secret, isLocal))
  // Silence unused warnings: we generated the token to keep parity with the
  // magic-link flow even though we set the cookie directly
  void rawToken
  void buildPortalCookieValue
  return response
}
