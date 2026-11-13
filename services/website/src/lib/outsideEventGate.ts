/**
 * One home for "this booking is an invitation we make for a client's event at a
 * venue that is not ours" (`party_type = 'outside_event'`, migration 096) as it
 * matters to OPERATIONS. It is a `confirmed` booking so its invitation is live,
 * and it is not a party we run, so every operational path ignores it:
 * studio calendar, crew roster, deposit and pay buttons, check-in texts, review
 * asks, rebooking nudges, the Booked tab and the dashboard counts.
 *
 *   OUTSIDE_EVENT_TYPE          the party_type value
 *   isOutsideEventType(t)       a party_type says so
 *   takesPayments(partyType)    false for an outside event: nothing is ever owed
 *   OUTSIDE_EVENT_OR_FILTER     null-safe PostgREST `.or()` literal that keeps
 *                               every row that is NOT an outside event
 *
 * The filter is a STRING LITERAL on purpose: a bare `.neq()` drops rows whose
 * party_type is NULL (and most bookings are), and an `.or()` built from a
 * template literal is a banned pattern (AGENTS.md section 11).
 */

export const OUTSIDE_EVENT_TYPE = 'outside_event'

export const OUTSIDE_EVENT_OR_FILTER = 'party_type.is.null,party_type.neq.outside_event'

export function isOutsideEventType(partyType: string | null | undefined): boolean {
  return partyType === OUTSIDE_EVENT_TYPE
}

/** False for an outside event; true for everything else, including a null party_type. */
export function takesPayments(partyType: string | null | undefined): boolean {
  return !isOutsideEventType(partyType)
}
