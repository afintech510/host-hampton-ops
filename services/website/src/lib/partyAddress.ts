/**
 * The customer's party address, collected on the invoice itself.
 *
 * A mobile party is often quoted before anyone knows the street — Blair's
 * Westhampton party (HH-PTY-G7ZDL) sat at "Westhampton, NY (address TBC)" until
 * two days before the date. The address lives in `party_tags.location_address`
 * (what `loadPlanInvoice` already prints as "Party address:"), so this module
 * only decides two things: whether the invoice should ASK for it, and whether
 * what the customer typed is usable.
 *
 * Shared by the summary page (draws the field) and `/api/plan/[ref]/address`
 * (writes it), so the page cannot offer a field the route would then refuse.
 */

import { isHeldAtStudio } from '@/lib/planInvoice'
import { etDateString } from '@/lib/partyTime'

export const PARTY_ADDRESS_MIN = 8
export const PARTY_ADDRESS_MAX = 200

/**
 * Is the address on file a placeholder rather than somewhere a team can drive
 * to? Missing, marked TBC/TBD, or carrying no digit at all — a town name
 * ("Westhampton, NY") has no house number, and a street address almost always
 * does. A false positive only means the field shows with the address pre-filled.
 */
export function isProvisionalAddress(address: unknown): boolean {
  if (typeof address !== 'string' || !address.trim()) return true
  if (/\b(tbc|tbd|to be confirmed|to be determined)\b/i.test(address)) return true
  return !/\d/.test(address)
}

/**
 * Whether this plan can take an address from the invoice at all. Not at the
 * studio (that address is ours), not cancelled, and not for a party that has
 * already happened.
 */
export function acceptsPartyAddress(opts: {
  partyType: string | null | undefined
  status: string | null | undefined
  partyDate: string | null | undefined
  today?: string
}): boolean {
  if (isHeldAtStudio(opts.partyType)) return false
  if (opts.status === 'cancelled') return false
  const today = opts.today ?? etDateString()
  if (opts.partyDate && opts.partyDate < today) return false
  return true
}

/** Whether the page should draw the field: allowed here, and still a placeholder. */
export function shouldAskForPartyAddress(opts: {
  partyType: string | null | undefined
  status: string | null | undefined
  partyDate: string | null | undefined
  partyTags: Record<string, unknown> | null | undefined
  today?: string
}): boolean {
  return acceptsPartyAddress(opts) && isProvisionalAddress(opts.partyTags?.location_address)
}

export type ScreenedAddress = { ok: true; address: string } | { ok: false; error: string }

/**
 * A customer-typed street address. Control characters and runs of whitespace
 * are flattened to single spaces (a pasted multi-line address becomes one line,
 * which is how every surface prints it), then bounded.
 */
export function screenPartyAddress(raw: unknown): ScreenedAddress {
  if (typeof raw !== 'string') return { ok: false, error: 'Please enter the party address.' }
  // eslint-disable-next-line no-control-regex
  const address = raw.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (address.length < PARTY_ADDRESS_MIN) {
    return { ok: false, error: 'Please enter the full street address, including the house number and town.' }
  }
  if (address.length > PARTY_ADDRESS_MAX) {
    return { ok: false, error: `Please keep the address under ${PARTY_ADDRESS_MAX} characters.` }
  }
  return { ok: true, address }
}
