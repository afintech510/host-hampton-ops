/**
 * Update one vendor registration — status and Adam's private notes.
 *
 * The one thing this route will NOT do is set `status` to 'paid'. Marking a
 * vendor paid is a statement that money arrived, and the only writers allowed
 * to make that statement are the Stripe webhook (which has the payment intent)
 * and the explicit `confirm_venmo` action below (which requires a human to have
 * actually looked at the Venmo app).
 *
 * That distinction is the whole lesson of link 3: the books and the balances
 * disagreed because a status could be typed in one place and money recorded in
 * another. A free-text `status: 'paid'` PATCH would rebuild that hole.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse, adminActorId } from '@/lib/adminAuth'

export const dynamic = 'force-dynamic'

/** Statuses a human may set directly. Note 'paid' is absent — see the header. */
const SETTABLE_STATUSES = ['pending_payment', 'waitlist', 'cancelled'] as const

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const supabase = getSupabase()
  const actor = adminActorId(req)
  const update: Record<string, unknown> = {}

  // ── Confirming a Venmo payment ────────────────────────────────────────────
  // Its own action, not a status write, because it must set `paid_at` in the
  // same statement — migration 059's CHECK refuses a 'paid' row without one.
  if (body.action === 'confirm_venmo') {
    const { data: row, error: readErr } = await supabase
      .from('market_vendors')
      .select('id, vendor_ref, status, payment_method, paid_at')
      .eq('id', params.id)
      .single()

    if (readErr || !row) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }
    if (row.paid_at) {
      return NextResponse.json({ error: 'That vendor is already marked paid.' }, { status: 409 })
    }
    if (row.payment_method !== 'venmo') {
      return NextResponse.json(
        { error: 'That vendor chose card. A card payment is settled by Stripe, not by hand.' },
        { status: 409 },
      )
    }

    update.status = 'paid'
    update.paid_at = new Date().toISOString()
    update.status_note = `Venmo confirmed by ${actor} on ${new Date().toISOString().split('T')[0]}`
  } else if (typeof body.status === 'string') {
    if (!(SETTABLE_STATUSES as readonly string[]).includes(body.status)) {
      return NextResponse.json(
        { error: `Status must be one of: ${SETTABLE_STATUSES.join(', ')}. Use the Venmo confirm button to mark a vendor paid.` },
        { status: 400 },
      )
    }
    update.status = body.status
    // Moving a row off 'paid' has to clear `paid_at` or the CHECK refuses it.
    update.paid_at = null
    update.status_note = `Set to ${body.status} by ${actor}`
  }

  if (typeof body.notes === 'string') {
    update.notes = body.notes.slice(0, 2000)
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('market_vendors')
    .update(update)
    .eq('id', params.id)
    .select('id, vendor_ref, status, paid_at, notes, status_note')
    .single()

  if (error) {
    console.error('admin market-vendor update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ vendor: data })
}
