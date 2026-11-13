import { NextRequest, NextResponse } from 'next/server'
import { isAdminAuthorized, unauthorizedResponse } from '@/lib/adminAuth'
import { loadBookedParties } from '@/lib/bookedParties'

export const dynamic = 'force-dynamic'

export type { BookedParty } from '@/lib/bookedParties'

/**
 * "Which parties are actually BOOKED" — the list Adam asked for on 2026-09-14: the Booked tab.
 * The whole derivation (money landed, not `status`; why payments are read first) lives in
 * `lib/bookedParties.ts`, shared with the crew app's read-only Bookings screen, which strips
 * the money and the contact details. This route is the admin door: it checks the credential.
 */
export async function GET(req: NextRequest) {
  if (!isAdminAuthorized(req)) return unauthorizedResponse()

  const r = await loadBookedParties()
  // An unreadable list is an error, never an empty one: see `loadBookedParties`.
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 503 })
  return NextResponse.json(r.data)
}
