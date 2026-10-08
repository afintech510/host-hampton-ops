/**
 * Update one vendor registration — status and Adam's private notes.
 *
 * The one thing this route will NOT do is set `status` to 'paid'. Marking a
 * vendor paid is a statement that money arrived, and the only writers allowed
 * to make that statement are the Stripe webhook (which has the payment intent)
 * and the explicit `confirm_venmo` action below (which requires a human to have
 * actually looked at the Venmo app, and writes the books in the same act).
 *
 * That distinction is the whole lesson of link 3: the books and the balances
 * disagreed because a status could be typed in one place and money recorded in
 * another. A free-text `status: 'paid'` PATCH would rebuild that hole.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'
import { isAdminAuthorized, unauthorizedResponse, adminActorId } from '@/lib/adminAuth'
import { resolveMarket } from '@/lib/christmasMarket'
import { confirmVendorVenmo } from '@/lib/marketVendorVenmo'

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
  // Its own action, not a status write: it marks the vendor paid AND writes the
  // booth fee to the books, dated by the vendor's own Venmo receipt when the
  // queue holds one. It used to do only the first half, so every Venmo booth was
  // missing from the Financials tab. See `lib/marketVendorVenmo.ts`.
  if (body.action === 'confirm_venmo') {
    const { data: row } = await supabase.from('market_vendors').select('market_slug').eq('id', params.id).maybeSingle()
    const result = await confirmVendorVenmo(supabase, {
      vendorId: params.id,
      actor,
      market: resolveMarket(row?.market_slug),
    })
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
    return NextResponse.json({ vendor: result.vendor, ledger: result.ledger, receipt: result.receipt, notice: result.notice })
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
