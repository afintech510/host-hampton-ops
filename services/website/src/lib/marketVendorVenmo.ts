/**
 * "I see the Venmo — mark paid" for a market vendor, done the way the Stripe
 * branch already does it: the vendor is paid AND the money is in the books.
 *
 * Before 2026-10-07 the `confirm_venmo` action flipped `market_vendors.status`
 * to 'paid' and wrote nothing else. So the vendor book said $150 had arrived
 * and the Financials tab — the table that decides what this business believes
 * about its own revenue — had never heard of it. The card path writes a
 * `Vendor Fee` ledger row in the webhook; Venmo, the path most vendors take
 * because it carries no fee, wrote none. It also stamped `paid_at` with the
 * moment of the click, so a booth paid in September read as paid in October.
 *
 * What happens now, in this order:
 *
 *  1. Look for the vendor's own Venmo receipt in `venmo_payments` (the agent
 *     parses every receipt out of the mailbox). The vendor form tells them to
 *     send exactly `venmoBoothNote()`, so a pending receipt for the right amount
 *     with that note — or from that person — is theirs. EXACTLY ONE such receipt
 *     dates the payment; zero or several dates it today and leaves the queue
 *     alone, because picking one of two $50 receipts is a guess.
 *  2. Write the ledger row, keyed `venmo-vendor-<ref>`. A retry, or a second
 *     click racing the first, is a `duplicate` — which is success. The books go
 *     FIRST because that write is idempotent and the status flip is not
 *     reversible by a retry: if the ledger write fails nothing has changed and
 *     the button can simply be pressed again.
 *  3. Flip the vendor to paid, conditional on `paid_at IS NULL`.
 *  4. Close the matched receipt as `recorded`, so nobody later records the same
 *     $50 again from the Venmo queue. Failing that is reported, not fatal: the
 *     money is in the books once and the vendor is paid.
 */

import { recordLedgerEntry, type FinancialWrite } from '@/lib/financialLedger'
import { etDateString } from '@/lib/partyTime'
import { normalizeForMatch } from '@/lib/venmoReceipt'
import type { MarketConfig } from '@/lib/christmasMarket'

type Client = { from: (table: string) => any }

/** The note the vendor form tells a Venmo payer to send. One definition. */
export function venmoBoothNote(market: Pick<MarketConfig, 'shortName'>, businessName: string): string {
  return `${market.shortName} booth — ${businessName}`
}

export interface VendorForMatch {
  business_name: string
  contact_name: string
  total_cents: number
}

export interface ReceiptCandidate {
  id: string
  paid_at: string
  payer_name: string
  note: string | null
  amount_cents: number
  transaction_id: string | null
}

/**
 * The one pending receipt that is this vendor's, or null.
 *
 * Amount must match exactly. Then either the note is the one we told them to
 * send, or the payer is the person who registered. More than one hit is null —
 * two vendors from one household, or a vendor who paid twice, is a human call.
 */
export function pickVendorReceipt(
  vendor: VendorForMatch,
  market: Pick<MarketConfig, 'shortName'>,
  candidates: ReceiptCandidate[],
): ReceiptCandidate | null {
  const wantNote = normalizeForMatch(venmoBoothNote(market, vendor.business_name))
  const wantPayer = normalizeForMatch(vendor.contact_name)
  const hits = candidates.filter(
    c =>
      Number(c.amount_cents) === Number(vendor.total_cents) &&
      ((!!c.note && normalizeForMatch(c.note) === wantNote) ||
        (!!wantPayer && normalizeForMatch(c.payer_name) === wantPayer)),
  )
  return hits.length === 1 ? hits[0] : null
}

export type ConfirmVenmoResult =
  | {
      ok: true
      vendor: Record<string, unknown>
      ledger: Exclude<FinancialWrite, 'failed'>
      receipt: { id: string; paidAt: string } | null
      notice: string | null
    }
  | { ok: false; status: number; error: string }

export async function confirmVendorVenmo(
  supabase: Client,
  input: { vendorId: string; actor: string; market: MarketConfig | null; now?: Date },
): Promise<ConfirmVenmoResult> {
  const now = input.now ?? new Date()

  const { data: vendor, error: readErr } = await supabase
    .from('market_vendors')
    .select('id, vendor_ref, market_slug, business_name, contact_name, email, status, payment_method, total_cents, paid_at')
    .eq('id', input.vendorId)
    .maybeSingle()
  if (readErr) return { ok: false, status: 503, error: `Could not read the vendor (${readErr.message}). Nothing was changed.` }
  if (!vendor) return { ok: false, status: 404, error: 'Vendor not found' }
  if (vendor.paid_at) return { ok: false, status: 409, error: 'That vendor is already marked paid.' }
  if (vendor.payment_method !== 'venmo') {
    return { ok: false, status: 409, error: 'That vendor chose card. A card payment is settled by Stripe, not by hand.' }
  }
  if (vendor.status === 'cancelled' || vendor.status === 'refunded') {
    return { ok: false, status: 409, error: `That vendor is ${vendor.status}. Reopen it before marking it paid.` }
  }

  // Rule 12: "could not read the queue" is not "no receipt". Refuse rather than
  // date it today and leave their receipt pending to be recorded a second time.
  const { data: candidates, error: queueErr } = await supabase
    .from('venmo_payments')
    .select('id, paid_at, payer_name, note, amount_cents, transaction_id')
    .eq('status', 'pending')
    .eq('amount_cents', vendor.total_cents)
  if (queueErr) {
    return { ok: false, status: 503, error: `Could not read the Venmo queue (${queueErr.message}). Nothing was changed — try again.` }
  }

  const shortName = input.market?.shortName ?? 'Market'
  const receipt = pickVendorReceipt(vendor, { shortName }, (candidates ?? []) as ReceiptCandidate[])
  const paidAt = receipt ? String(receipt.paid_at) : now.toISOString()
  const paidOn = etDateString(new Date(paidAt))

  const ledger = await recordLedgerEntry(supabase, {
    date: paidOn,
    description: `${shortName} vendor booth — ${vendor.business_name} (${vendor.vendor_ref})`,
    amountCents: Number(vendor.total_cents),
    source: 'cash',
    category: 'Vendor Fee',
    customerName: vendor.contact_name,
    reference: `venmo-vendor-${vendor.vendor_ref}`,
    notes:
      `Venmo booth fee, confirmed by ${input.actor} on ${etDateString(now)}. ` +
      (receipt
        ? `Receipt from ${receipt.payer_name}${receipt.transaction_id ? `, txn ${receipt.transaction_id}` : ''}` +
          `${receipt.note ? ` (note: ${receipt.note})` : ''}.`
        : 'No matching receipt in the Venmo queue; dated the day it was confirmed.'),
  })
  if (ledger === 'failed') {
    return { ok: false, status: 500, error: 'Could not write the booth fee to the books. The vendor was NOT marked paid — try again.' }
  }

  const { data: updated, error: payErr } = await supabase
    .from('market_vendors')
    .update({
      status: 'paid',
      paid_at: paidAt,
      updated_at: now.toISOString(),
      status_note:
        `Venmo confirmed by ${input.actor} on ${etDateString(now)}` +
        (receipt ? `; received ${paidOn}.` : '; no matching receipt in the Venmo queue, dated today.'),
    })
    .eq('id', vendor.id)
    .is('paid_at', null)
    .select('id, vendor_ref, status, paid_at, notes, status_note')
  if (payErr) {
    return { ok: false, status: 500, error: `The booth fee is in the books but the vendor could not be marked paid (${payErr.message}). Press the button again.` }
  }
  if (!updated?.length) return { ok: false, status: 409, error: 'That vendor is already marked paid.' }

  let notice: string | null = receipt
    ? null
    : 'No matching Venmo receipt was found in the queue, so this is dated today. If the receipt shows up later, dismiss it in the Venmo queue — the books already have it.'

  if (receipt) {
    const { error: closeErr } = await supabase
      .from('venmo_payments')
      .update({
        status: 'recorded',
        resolved_at: now.toISOString(),
        resolved_by: input.actor,
        resolution_note: `Christmas Market booth for ${vendor.vendor_ref}, not a ticket. Books: venmo-vendor-${vendor.vendor_ref}.`,
      })
      .eq('id', receipt.id)
      .eq('status', 'pending')
    if (closeErr) {
      console.error(`market vendor ${vendor.vendor_ref}: paid, but Venmo receipt ${receipt.id} stayed pending —`, closeErr.message)
      notice = 'Marked paid and in the books, but its Venmo receipt is still pending in the queue — dismiss it there so it is not recorded twice.'
    }
  }

  return { ok: true, vendor: updated[0], ledger, receipt: receipt ? { id: receipt.id, paidAt } : null, notice }
}
