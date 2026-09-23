/**
 * Who is asked to sign the rental agreement.
 *
 * Adam's ruling, 2026-09-23: the check-in flow reuses the **Studio Rental
 * Agreement** template (it already contains the liability waiver), and the
 * button is for **studio rentals only**.
 *
 * That reversed a default. `requiresRentalAgreement` used to return TRUE for
 * anything it could not classify, on the argument that a missing waiver is a
 * liability gap. With the document now decided, the opposite is true: the
 * Studio Rental Agreement is written about renting the room, and putting it in
 * front of a kids' theme party asks for a signature on terms that customer
 * never bought.
 *
 * These are the tests for the REVERSAL specifically — the old behaviour passed
 * every existing check-in test, so nothing already in the suite would have
 * noticed the default flip in either direction.
 */

import { requiresRentalAgreement } from '@/lib/checkinLink'
import type { InquiryBooking } from '@/lib/inquiryDrafts'

const booking = (over: InquiryBooking = {}): InquiryBooking => ({
  event_type: null,
  package_type: null,
  notes: null,
  party_tags: null,
  contact_name: 'Test Person',
  party_date: '2026-09-27',
  party_time: '13:30',
  ...over,
})

describe('requiresRentalAgreement — studio rentals only', () => {
  it('asks a studio rental, by either slug the booking routes write', () => {
    expect(requiresRentalAgreement(booking({ event_type: 'studio-rental' }))).toBe(true)
    expect(requiresRentalAgreement(booking({ event_type: 'room-rental' }))).toBe(true)
  })

  it('is case- and whitespace-insensitive on the slug', () => {
    expect(requiresRentalAgreement(booking({ event_type: '  Studio-Rental  ' }))).toBe(true)
  })

  it('never asks a theme party or a mobile party', () => {
    for (const et of ['kid-party', 'kids-party', 'mobile']) {
      expect(requiresRentalAgreement(booking({ event_type: et }))).toBe(false)
    }
  })

  /**
   * THE REVERSAL. Each of these used to answer `true` and now answers `false`.
   * An unclassifiable booking is not a studio rental until something says it
   * is — a signature on the wrong contract is not a safety net.
   */
  it('does NOT ask a booking it cannot classify', () => {
    expect(requiresRentalAgreement(booking())).toBe(false)
    expect(requiresRentalAgreement(booking({ event_type: '' }))).toBe(false)
    expect(requiresRentalAgreement(booking({ event_type: 'something nobody wrote a branch for' }))).toBe(false)
    expect(requiresRentalAgreement(booking({ event_type: 'fundraiser' }))).toBe(false)
  })

  it('does NOT ask a free-text kids party that the classifier reads as in-studio', () => {
    expect(requiresRentalAgreement(booking({ event_type: 'Kids Birthday Party' }))).toBe(false)
  })

  /**
   * The free-text path still works in the TRUE direction — this is what stops
   * the allowlist from being satisfied only by the two exact slugs, which
   * would quietly drop legacy rows whose `event_type` is a whole sentence.
   */
  it('still asks a legacy row whose free text reads as a studio rental', () => {
    const b = booking({ event_type: 'Studio Rental', notes: 'renting the party room for a christening' })
    expect(requiresRentalAgreement(b)).toBe(true)
  })
})
