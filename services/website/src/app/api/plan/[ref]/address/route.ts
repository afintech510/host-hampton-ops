/**
 * `POST /api/plan/[ref]/address` — the customer gives us their party address
 * from the invoice page.
 *
 * Writes `party_tags.location_address` (merged, never replacing the other
 * tags), stamps who gave it and when, leaves an audit row, and tells Adam by
 * email and text — an address that arrives two days before a mobile party is
 * something the team needs to SEE, not something that waits in a column.
 *
 * Access is `planAccess`, the same rule as the page and the pay route: the
 * customer's portal cookie for THIS ref, or an admin session. Bounded by
 * `ownerNotifyRule` because every accepted call emails and texts the owner.
 *
 * It writes only the address. It never touches money, status or the date, and
 * it is refused for a studio booking (that address is ours), a cancelled plan,
 * and a party that has already happened — `acceptsPartyAddress`, the same
 * function the page used to decide whether to draw the field.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { planAccess } from '@/lib/planAccess'
import { adminActorId } from '@/lib/adminAuth'
import { acceptsPartyAddress, screenPartyAddress } from '@/lib/partyAddress'
import { logBookingChange } from '@/lib/bookingAudit'
import { ownerEmail, notifyOwnerSms } from '@/lib/ownerNotify'
import { publicOrigin } from '@/lib/publicOrigin'
import { escapeHtml } from '@/lib/escapeHtml'
import { mailHref } from '@/lib/emailSafety'
import { guardRate, ownerNotifyRule } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ ref: string }> }) {
  const limited = guardRate(req, ownerNotifyRule('plan/address'))
  if (limited) return limited

  const { ref } = await ctx.params

  const access = planAccess(req.headers.get('cookie'), ref)
  if (!access.ok) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { address?: unknown }
  const screened = screenPartyAddress(body.address)
  if (!screened.ok) return NextResponse.json({ error: screened.error }, { status: 400 })
  const address = screened.address

  const supabase = getSupabase()
  const { data: booking, error: readErr } = await supabase
    .from('bookings')
    .select('id, booking_ref, status, party_type, party_date, party_time, package_type, contact_name, contact_email, contact_phone, party_tags')
    .eq('booking_ref', ref)
    .maybeSingle()
  if (readErr) {
    console.error('plan address: booking read failed for', ref, '—', readErr.message)
    return NextResponse.json({ error: 'We could not save that just now — please try again.' }, { status: 503 })
  }
  if (!booking) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!acceptsPartyAddress({ partyType: booking.party_type, status: booking.status, partyDate: booking.party_date })) {
    return NextResponse.json(
      { error: 'This booking cannot take an address here — please call or text (631) 998-9325.' },
      { status: 409 },
    )
  }

  const tags = (booking.party_tags && typeof booking.party_tags === 'object' ? booking.party_tags : {}) as Record<
    string,
    unknown
  >
  const previous = typeof tags.location_address === 'string' ? tags.location_address : null
  const actor = access.isAdmin ? adminActorId(req) : 'customer'
  const nextTags = {
    ...tags,
    location_address: address,
    location_address_set_at: new Date().toISOString(),
    location_address_set_by: actor,
  }

  // Compare-and-swap on the tags we read, so a concurrent admin edit to some
  // other tag is not silently overwritten by this merge.
  const { data: written, error: writeErr } = await supabase
    .from('bookings')
    .update({ party_tags: nextTags })
    .eq('id', booking.id)
    .eq('party_tags', JSON.stringify(tags))
    .select('id')
  if (writeErr) {
    console.error('plan address: write failed for', ref, '—', writeErr.message)
    return NextResponse.json({ error: 'We could not save that just now — please try again.' }, { status: 503 })
  }
  if (!written || written.length === 0) {
    return NextResponse.json({ error: 'This booking was just updated — please refresh and try again.' }, { status: 409 })
  }

  await logBookingChange(supabase, {
    bookingId: booking.id,
    actor,
    summary: `Party address ${previous ? 'updated' : 'added'}: ${address}`,
    newData: { type: 'party_address', location_address: address, previous },
  })

  // Tell Adam. Either channel landing is enough; neither landing is logged
  // loudly but is NOT a failure to the customer — the address is saved, which
  // is the thing they asked us to do.
  const who = booking.contact_name || 'Customer'
  const when = `${booking.party_date || 'date TBD'}${booking.party_time ? ` ${booking.party_time}` : ''}`
  let emailed = false
  if (process.env.RESEND_API_KEY) {
    const adminUrl = `${publicOrigin(req)}/admin?tab=parties&ref=${encodeURIComponent(booking.booking_ref)}`
    const html = `<!DOCTYPE html>
<html><body style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#F6F1EB;padding:20px;">
  <div style="background:white;border-radius:12px;padding:32px;">
    <h1 style="color:#1a2744;margin:0 0 16px;font-size:22px;">Party address from ${escapeHtml(who)}</h1>
    <p style="color:#1a2744;font-size:17px;font-weight:bold;margin:0 0 16px;">${escapeHtml(address)}</p>
    <p style="color:#555;font-size:14px;line-height:1.7;margin:0 0 20px;">
      ${escapeHtml(booking.booking_ref)} &middot; ${escapeHtml(when)} &middot; ${escapeHtml(booking.package_type || 'Party')}
      ${previous ? `<br>Previously: ${escapeHtml(previous)}` : ''}
    </p>
    <a href="${mailHref(adminUrl)}" style="display:inline-block;background:#1a2744;color:#F6F1EB;padding:12px 32px;font-size:14px;text-decoration:none;border-radius:6px;">Open Booking in Admin</a>
  </div>
</body></html>`
    try {
      const { Resend } = await import('resend')
      const resend = new Resend(process.env.RESEND_API_KEY)
      const res = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'noReply@mail.hosthampton.com',
        to: ownerEmail(),
        replyTo: booking.contact_email || undefined,
        subject: `Party address: ${who} — ${booking.booking_ref}`,
        html,
      })
      if (res.error) console.error('plan address: owner email FAILED for', ref, res.error)
      else emailed = true
    } catch (err) {
      console.error('plan address: owner email threw for', ref, err)
    }
  } else {
    console.error('plan address: RESEND_API_KEY unset — owner email NOT sent for', ref)
  }
  const texted = await notifyOwnerSms(`Party address from ${who} (${booking.booking_ref}, ${when}): ${address}`)
  if (!emailed && !texted) console.error('plan address: owner was NOT notified for', ref, '— the address is saved')

  return NextResponse.json({ ok: true, address })
}
