import { getSupabase } from '@/lib/supabase'
import { loadPricingCatalog } from '@/lib/pricingCatalog'
import { sumPayments } from '@/lib/bookingBalance'
import { billedTotalCents } from '@/lib/planBalance'

// Shared by the admin booking routes and the customer portal, so a guest-count
// change reprices the same way wherever it is made.

/**
 * Keep an in-studio theme party's flat "Additional Guests" line equal to
 * `guest_count_approx - includedGuests`, the line the planner and the quote
 * engine write themselves (category `theme`, no pricing_item_id, flat, quantity
 * = the extra heads). `recalcTotals` only scales PER-HEAD lines, so changing the
 * guest count here used to leave this flat line stale; the manager's assistant
 * then typed its own "Additional guest" custom line to make the invoice right,
 * and the planner (which derives the extras from the count AND loads any
 * pricing_item_id-less non-theme line as a custom) charged both: Denise, 2026-11-09,
 * $315 twice. Only a booking that carries a catalogue theme line is touched, so a
 * mobile party or a rental is never given one. A hand-typed duplicate under
 * another category is removed, and the change is logged.
 */
export const EXTRA_GUESTS_NAME = /^(additional|extra) (guests?|kids?|children)$/i

export async function syncExtraGuestsLine(
  supabase: ReturnType<typeof getSupabase>,
  bookingId: string,
  guestCount: unknown,
): Promise<string | null> {
  const guests = Math.floor(Number(guestCount))
  if (!(guests >= 1)) return null
  const fail = (what: string, message: string) => {
    console.error(`syncExtraGuestsLine: ${bookingId} - ${what}:`, message)
    return `the Additional Guests line could not be updated (${what}: ${message})`
  }
  try {
    const { data, error } = await supabase
      .from('booking_line_items')
      .select('id, name, category, pricing_item_id, sort_order')
      .eq('booking_id', bookingId)
    if (error || !data) return fail('line items unreadable', error?.message ?? 'no data')
    const rows = data as { id: string; name: string; category: string; pricing_item_id: string | null; sort_order: number | null }[]
    if (!rows.some(r => r.category === 'theme' && r.pricing_item_id)) return null

    const catalog = await loadPricingCatalog(supabase)
    // A mini party bills at most `miniPartyMaxGuests` heads (effectiveGuests in the quote engine).
    const { data: snapRow } = await supabase.from('bookings').select('quote_snapshot').eq('id', bookingId).single()
    const isMini = (snapRow?.quote_snapshot as { isMiniParty?: boolean } | null)?.isMiniParty === true
    const billable = isMini ? Math.min(guests, catalog.guestRules.miniPartyMaxGuests) : guests
    const wanted = Math.max(0, billable - catalog.guestRules.includedGuests)
    const matches = rows.filter(r => !r.pricing_item_id && EXTRA_GUESTS_NAME.test(r.name.trim()))
    const keep = matches.find(r => r.category === 'theme')
    const strays = matches.filter(r => r !== keep)

    if (strays.length) {
      const { error: delErr } = await supabase.from('booking_line_items').delete().in('id', strays.map(r => r.id)).eq('booking_id', bookingId)
      if (delErr) return fail('duplicate extra-guest line not removed', delErr.message)
    }
    if (keep && wanted === 0) {
      const { error: delErr } = await supabase.from('booking_line_items').delete().eq('id', keep.id).eq('booking_id', bookingId)
      if (delErr) return fail('line not removed', delErr.message)
    } else if (keep) {
      const { error: updErr } = await supabase.from('booking_line_items').update({
        quantity: wanted, unit_price_cents: catalog.guestRules.extraGuestCents, price_type: 'flat', guest_multiplied: false,
      }).eq('id', keep.id).eq('booking_id', bookingId)
      if (updErr) return fail('line not updated', updErr.message)
    } else if (wanted > 0) {
      const maxSort = Math.max(0, ...rows.map(r => r.sort_order ?? 0))
      const { error: insErr } = await supabase.from('booking_line_items').insert({
        booking_id: bookingId, name: 'Additional Guests', category: 'theme', quantity: wanted,
        unit_price_cents: catalog.guestRules.extraGuestCents, price_type: 'flat', guest_multiplied: false, sort_order: maxSort + 1,
      })
      if (insErr) return fail('line not added', insErr.message)
    }
    return null
  } catch (e) {
    return fail('unexpected error', e instanceof Error ? e.message : String(e))
  }
}

/**
 * Re-derive `total_cents` and `balance_due_cents` from the line items.
 *
 * The version this replaces discarded BOTH read errors, and that is worse here
 * than anywhere else on the surface: a failed `booking_line_items` read left
 * `items` null, the loop added nothing, and the function then **wrote
 * `total_cents: 0` and `balance_due_cents: 0` over the booking**. So a Supabase
 * blip while an admin added a decoration line item did not merely mis-read the
 * invoice — it ZEROED a real customer's invoice, and answered `{ok: true}`.
 *
 * Link 16 found the read-becomes-a-balance shape on four webhook branches; this
 * is the same rule 12 defect with an overwrite behind it. Three outcomes now,
 * and a failed read writes nothing at all.
 */
export async function recalcTotals(
  supabase: ReturnType<typeof getSupabase>,
  bookingId: string,
  booking: Record<string, unknown>,
): Promise<{ ok: true; totalCents: number; balanceCents: number } | { ok: false; message: string }> {
  const { data: items, error: itemsErr } = await supabase
    .from('booking_line_items')
    .select('unit_price_cents, quantity, guest_multiplied, is_optional')
    .eq('booking_id', bookingId)
  if (itemsErr) {
    console.error(`recalcTotals: line items unreadable for ${bookingId} — totals NOT rewritten:`, itemsErr.message)
    return { ok: false, message: `line items unreadable: ${itemsErr.message}` }
  }

  // `billedTotalCents` is the same function `loadPlanInvoice` totals the
  // document with. This loop used to be its own copy and it did not select
  // `is_optional`, let alone honour it — so an admin saving a booking that
  // carried a quoted-but-not-charged add-on rewrote `total_cents` to INCLUDE it,
  // and the stored total then disagreed with the invoice the customer holds.
  // Only the cancelled HH-TEST-PAY1/PAY2 rows carry optional items today, so no
  // real booking has been inflated — but every writer on this surface could.
  const total = billedTotalCents(
    (items || []) as { unit_price_cents: number; quantity: number; guest_multiplied: boolean; is_optional?: boolean }[],
    booking.guest_count_approx as number | null,
  )

  const { data: payments, error: payErr } = await supabase
    .from('booking_payments')
    .select('amount_cents, payment_type')
    .eq('booking_id', bookingId)
  if (payErr) {
    console.error(`recalcTotals: payments unreadable for ${bookingId} — totals NOT rewritten:`, payErr.message)
    return { ok: false, message: `payments unreadable: ${payErr.message}` }
  }

  const balance = Math.max(0, total - sumPayments(payments))
  const { data: updated, error: updErr } = await supabase.from('bookings').update({
    total_cents: total,
    balance_due_cents: balance,
    updated_at: new Date().toISOString(),
  }).eq('id', bookingId).select('id')
  if (updErr || !updated?.length) {
    console.error(`recalcTotals: totals NOT saved for ${bookingId}:`, updErr?.message || 'no row matched')
    return { ok: false, message: updErr?.message || 'no booking row matched' }
  }

  return { ok: true, totalCents: total, balanceCents: balance }
}
