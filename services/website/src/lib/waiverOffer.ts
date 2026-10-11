/**
 * Should the invoice offer the room-rental waiver — and in what state?
 *
 * The waiver is the SignWell Studio Rental Agreement & Liability Waiver, signed
 * inside the pre-arrival check-in flow (`/checkin/<token>` →
 * `POST /api/checkin/[token]/agreement`). It used to reach a customer one way
 * only: an admin pressing "Send check-in link", which TEXTS the link. That module
 * was taken off the admin screen on 2026-10-11 (one booking ever completed it)
 * and the automatic texts are off (`CHECKIN_LINKS_ENABLED`), so nothing in the
 * product put the waiver in front of a customer at all. The invoice is the page
 * a studio customer already has open, so this is where it lives.
 *
 * Pure apart from reading the two env vars, and takes everything else as input so
 * the page (which decides whether to draw the button) and the route (which
 * decides whether to mint a link) ask the SAME question — a page that offered a
 * button the route then refused is the kind of drift `planAccess` exists to stop.
 *
 * ── The five ways to be `none` ──────────────────────────────────────────────
 *
 *   * **Not a studio rental.** `requiresRentalAgreement` is an allowlist, on
 *     purpose: the document is about renting the room, and a signature on the
 *     wrong contract is a dispute waiting to happen (Adam, 2026-09-23).
 *   * **Cancelled or lost.** Same rule the pay buttons keep.
 *   * **The rental is over.** `isExpiredForParty` — a check-in link is dead once
 *     the party day ends, so a button minting one would mint a dead link.
 *   * **SignWell is not configured.** Without `SIGNWELL_CHECKIN_TEMPLATE_ID` the
 *     agreement route answers `{ unavailable: true }` — silently, so the customer
 *     would complete the details step and never be shown a document. A button that
 *     leads there is worse than no button.
 *   * (`signed` is its own state, not `none`: tell the customer to stop looking.)
 */

import { requiresRentalAgreement } from '@/lib/checkinLink'
import { isExpiredForParty } from '@/lib/checkinAuth'
import type { InquiryBooking } from '@/lib/inquiryDrafts'

export type WaiverOffer =
  | { state: 'offer' }
  /** Already signed — say so, and stop asking. */
  | { state: 'signed'; signedAt: string }
  | { state: 'none' }

export interface WaiverInput {
  booking: InquiryBooking & { status?: string | null }
  /**
   * When the waiver was signed, from EITHER column: `checkin_agreement_signed_at`
   * (the check-in flow) or `agreement_signed_at` (the public studio checkout).
   * Both are the same Studio Rental Agreement template, so a customer who signed
   * one is not asked to sign the other.
   */
  signedAt: string | null | undefined
}

/** Mirrors the guard in `POST /api/checkin/[token]/agreement` — same two vars. */
export function waiverIsConfigured(): boolean {
  return !!process.env.SIGNWELL_API_KEY && !!process.env.SIGNWELL_CHECKIN_TEMPLATE_ID
}

const UNOFFERABLE_STATUSES = ['cancelled', 'lost']

export function waiverOffer(input: WaiverInput, configured: boolean = waiverIsConfigured(), now: Date = new Date()): WaiverOffer {
  const { booking, signedAt } = input

  if (!requiresRentalAgreement(booking)) return { state: 'none' }
  if (UNOFFERABLE_STATUSES.includes((booking.status ?? '').trim().toLowerCase())) return { state: 'none' }

  // Before the expiry and configuration checks: a customer who has signed should
  // be told so on a rental that has since passed, and should not be told a
  // template went missing.
  if (signedAt) return { state: 'signed', signedAt }

  if (isExpiredForParty(booking.party_date, now)) return { state: 'none' }
  if (!configured) return { state: 'none' }

  return { state: 'offer' }
}
