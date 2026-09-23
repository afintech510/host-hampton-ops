import { NextRequest, NextResponse } from 'next/server'
import { guardRate, plannerRule } from '@/lib/rateLimit'
import { getSupabase } from '@/lib/supabase'
import { createEmbeddedDocument } from '@/lib/signwell'
import { resolveCheckinToken, requiresRentalAgreement, CHECKIN_DOC_TYPE } from '@/lib/checkinLink'
import { loadPlanInvoice, money } from '@/lib/planInvoice'
import { formatClockTime } from '@/lib/planInvoice'

export const dynamic = 'force-dynamic'

/**
 * Create the embedded SignWell rental agreement + liability waiver for a
 * check-in, and hand back the signing URL for the client to open.
 *
 * Uses its own template (SIGNWELL_CHECKIN_TEMPLATE_ID) rather than the studio
 * rental one: createEmbeddedAgreement hard-codes the document name and
 * metadata.type to studio_rental, and the studio webhook writes to a different
 * set of columns. Sharing it would cross-wire the two flows.
 */

export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const limited = guardRate(req, plannerRule('checkin/agreement'))
  if (limited) return limited

  const { token } = await params
  const result = await resolveCheckinToken(token)

  if (!result.ok) {
    return NextResponse.json({ error: result.reason }, { status: result.reason === 'expired' ? 410 : 404 })
  }

  const booking = result.booking
  const bookingId = booking.id as string
  const bookingRef = booking.booking_ref as string

  if (booking.checkin_agreement_signed_at) {
    return NextResponse.json({ alreadySigned: true, signingUrl: null })
  }

  // Theme/mobile parties don't carry a rental agreement at all — the UI
  // shouldn't even show this step, but guard server-side too.
  if (!requiresRentalAgreement(booking)) {
    return NextResponse.json({ notRequired: true, signingUrl: null })
  }

  const templateId = process.env.SIGNWELL_CHECKIN_TEMPLATE_ID
  // isSignwellConfigured() checks SIGNWELL_TEMPLATE_ID, which is the studio
  // rental template — not the right guard here.
  if (!process.env.SIGNWELL_API_KEY || !templateId) {
    // Not configured (dev/preview). Best effort: the rest of check-in still works.
    return NextResponse.json({ unavailable: true, signingUrl: null })
  }

  const supabase = getSupabase()

  /**
   * The money the agreement is ABOUT.
   *
   * The check-in flow was written against a generic waiver template that had no
   * financial fields. It now reuses the **Studio Rental Agreement** (Adam,
   * 2026-09-23), which has eight of them — `rental_fee`, `addons`,
   * `security_deposit`, `deposit_due`, `balance_due`, `total_due`, `event_type`,
   * `end_time` — and the original six-field prefill populated NONE of them.
   * `createEmbeddedDocument` silently drops api_ids a template does not define,
   * which is the right safety in that direction and gives no warning in this
   * one: the customer would have signed a rental contract with every number on
   * it blank.
   *
   * Measured rather than assumed — the template's real api_ids were read back
   * from SignWell before this list was written.
   *
   * Every figure comes from `loadPlanInvoice`, the same object the customer's
   * invoice is rendered from, so the contract and the invoice cannot disagree.
   * An unreadable plan REFUSES rather than falling back to blanks: a blank
   * contract is the defect this block exists to remove, and handing one over
   * because a read failed would be the same bug wearing a different hat.
   */
  const loaded = await loadPlanInvoice(bookingRef, supabase)
  if (!loaded.ok) {
    console.error(`checkin:signwell could not read the plan for ${bookingRef}:`, loaded.error)
    return NextResponse.json(
      { error: 'Could not load your booking details. Please try again in a moment.' },
      { status: 503 },
    )
  }
  const invoice = loaded.invoice

  // The rental line vs the extras, split exactly rather than guessed: the
  // featured item is the rental itself, everything else billed is an add-on.
  const billed = invoice.lineItems.filter(i => !i.isOptional)
  const featured = billed.filter(i => i.isFeatured)
  const rentalCents = featured.length
    ? featured.reduce((s, i) => s + i.amountCents, 0)
    : invoice.totalCents
  const addOnCents = Math.max(0, invoice.totalCents - rentalCents)

  const tags = (booking.party_tags ?? {}) as Record<string, unknown>
  const endTimeRaw = typeof tags.rental_end_time === 'string' ? tags.rental_end_time : ''

  try {
    const { documentId, embeddedSigningUrl } = await createEmbeddedDocument({
      templateId,
      documentName: `Party Rental Agreement & Liability Waiver — ${bookingRef}`,
      signerName: String(booking.contact_name ?? ''),
      signerEmail: String(booking.contact_email ?? ''),
      metadata: {
        booking_ref: bookingRef,
        booking_id: bookingId,
        type: CHECKIN_DOC_TYPE,
      },
      fields: {
        client_name: String(booking.contact_name ?? ''),
        email: String(booking.contact_email ?? ''),
        phone: String(booking.contact_phone ?? ''),
        // SignWell date fields reject a bare date — full ISO-8601 required.
        event_date: booking.party_date ? `${booking.party_date}T00:00:00Z` : '',
        // "1:30 PM", not "13:30" — this is a document a customer reads, and
        // `formatClockTime` is what the invoice already prints.
        start_time: formatClockTime(String(booking.party_time ?? '')) || String(booking.party_time ?? ''),
        end_time: endTimeRaw ? formatClockTime(endTimeRaw) || endTimeRaw : '',
        event_type: invoice.docTitle.replace(/ (Quotation|Invoice)$/, ''),
        rental_fee: money(rentalCents),
        addons: money(addOnCents),
        security_deposit: money(invoice.securityHoldCents ?? 0),
        deposit_due: money(invoice.depositCents),
        // What is actually still owed, not the quote-time figure — she has paid
        // her deposit, and a contract that demands it twice is the bug
        // `planBalance` exists to prevent.
        balance_due: money(invoice.outstandingCents),
        total_due: money(invoice.totalCents),
        package_type: String(booking.package_type ?? ''),
        headcount: String(booking.guest_count_approx ?? ''),
        address: [
          booking.checkin_address_line1,
          booking.checkin_address_line2,
          booking.checkin_city,
          booking.checkin_state,
          booking.checkin_postal_code,
        ].filter(Boolean).join(', '),
      },
    })

    // Persist the document id BEFORE the customer can finish signing, or the
    // webhook arrives with nothing to match.
    //
    // Rule 8 + rule 19: that sentence was already here, sitting above an
    // `await` whose error was discarded. The comment explained exactly why the
    // write mattered while the code could not tell whether it had happened.
    // The check-in handler matches ONLY on checkin_signwell_document_id, so
    // unlike the studio flow there is no booking_ref fallback — if this write
    // is lost, the customer's signed waiver has nowhere to go. Fail the request
    // rather than hand out a signing URL we cannot honour.
    const { data: linked, error: linkErr } = await supabase
      .from('bookings')
      .update({ checkin_signwell_document_id: documentId })
      .eq('id', bookingId)
      .select('id')

    if (linkErr || (linked?.length ?? 0) === 0) {
      console.error(
        'checkin:signwell FAILED to store document id', documentId, 'for', bookingRef,
        '—', linkErr?.message ?? 'update matched no rows'
      )
      return NextResponse.json(
        { error: 'Could not open the agreement' },
        { status: 500 }
      )
    }

    return NextResponse.json({ signingUrl: embeddedSigningUrl })
  } catch (err) {
    console.error('checkin:signwell create error:', err)
    return NextResponse.json({ error: 'Could not open the agreement' }, { status: 502 })
  }
}
