/**
 * Invoice numbers — assigned on FIRST RENDER, not at insert (Phase 5 item 5).
 *
 * Migration 035 parked `invoice_number_seq` so the first number it issues is
 * `444124-000116`; the hand-built files in `invoices/` run up to `...000115`, so
 * the DB-rendered invoices continue the same run rather than starting a second,
 * confusing series.
 *
 * ── Why assignment happens here and not at insert ───────────────────────────
 *
 * Every lead is now a `bookings` row (Phase 4 item 1), and most leads never get
 * quoted. Stamping a number at insert would burn one per "do you do mobile
 * parties?" email and leave the sequence full of holes that look, to anyone
 * reading `invoices/`, like missing paperwork. A number is issued the first time
 * somebody actually looks at the invoice.
 *
 * ── Idempotency, which is the whole difficulty ──────────────────────────────
 *
 * A page refresh must not issue a second number, and two tabs opened at once
 * must not leave the row with two. Three things in order:
 *
 *   1. If the row already has a number, return it and touch nothing. This is
 *      the refresh case, and it is the common one.
 *   2. Otherwise call `next_invoice_number()` and write it back GUARDED on
 *      `invoice_number IS NULL`, the same fill-once shape `linkFirstTouchEvent`
 *      uses. The guard is what makes the concurrent case safe.
 *   3. If that guarded write matched no row, somebody else won: re-read and
 *      return THEIR number, so both tabs show the same one.
 *
 * A lost race does burn a sequence value, because `nextval` is not transactional
 * and cannot be given back. That is the correct trade and worth stating plainly:
 * the failure is a gap in the numbering, which is cosmetic, versus one booking
 * carrying two different invoice numbers, which is the thing a client notices
 * and an accountant cannot reconcile.
 */

import { getSupabase } from '@/lib/supabase'

type Supa = ReturnType<typeof getSupabase>

export type InvoiceNumberResult =
  | { ok: true; invoiceNumber: string; issued: boolean }
  /** Could not decide. NOT "this plan has no number" — the page shows none. */
  | { ok: false; error: string }

/**
 * Return this booking's invoice number, issuing one if it has never had one.
 *
 * NEVER throws: an invoice that renders without a number is worth far more than
 * a 500, and the number can be issued on the next view.
 */
export async function ensureInvoiceNumber(
  bookingId: string,
  supabase?: Supa,
): Promise<InvoiceNumberResult> {
  try {
    const db = supabase ?? getSupabase()

    const { data: row, error: readErr } = await db
      .from('bookings')
      .select('invoice_number')
      .eq('id', bookingId)
      .maybeSingle()
    if (readErr || !row) {
      return { ok: false, error: readErr?.message ?? 'plan not found' }
    }

    // 1. Already issued — the refresh case.
    const existing = (row as { invoice_number: string | null }).invoice_number
    if (existing) return { ok: true, invoiceNumber: existing, issued: false }

    // 2. Draw the next one. The sequence lives in Postgres, so this is the only
    //    place a number is minted and two app instances cannot collide.
    const { data: minted, error: rpcErr } = await db.rpc('next_invoice_number')
    const candidate = typeof minted === 'string' ? minted : null
    if (rpcErr || !candidate) {
      return { ok: false, error: rpcErr?.message ?? 'next_invoice_number returned nothing' }
    }

    const { data: written, error: updErr } = await db
      .from('bookings')
      .update({ invoice_number: candidate })
      .eq('id', bookingId)
      .is('invoice_number', null)
      .select('invoice_number')
    if (updErr) {
      return { ok: false, error: updErr.message }
    }
    if ((written ?? []).length === 1) {
      return { ok: true, invoiceNumber: candidate, issued: true }
    }

    // 3. Somebody else got there first. Their number is the row's number — ours
    //    is discarded, and the gap it leaves is the acceptable half of the trade.
    const { data: reread } = await db
      .from('bookings')
      .select('invoice_number')
      .eq('id', bookingId)
      .maybeSingle()
    const theirs = (reread as { invoice_number: string | null } | null)?.invoice_number
    if (theirs) return { ok: true, invoiceNumber: theirs, issued: false }

    return { ok: false, error: 'invoice number was not written' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invoice number failed'
    console.error('ensureInvoiceNumber (non-fatal):', msg)
    return { ok: false, error: msg }
  }
}
