/**
 * Where the studio is, and the number to call — as ONE set of strings.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * "295 Montauk Hwy" is written out in dozens of files, in at least four
 * different spellings: `295 Montauk Hwy, Suite 7, Speonk NY` (christmasMarket),
 * `295 Montauk Hwy, Suite 7` + a separate locality (eventSchema),
 * `295 Montauk Highway, Suite 7 · Speonk, NY 11972` (emailTemplates) and
 * `295 Montauk Highway, Suite 7, Speonk, NY 11972` (offlineTicket). They all
 * mean the same building, and none of them is derived from any other.
 *
 * This is the seed of the single home, introduced when the plan invoice needed
 * the address in a SECOND place on the same page (Event Details, alongside the
 * locked footer). A fifth hand-typed spelling on a document a customer drives
 * to would have been the worst of the available options.
 *
 * It is deliberately NOT a refactor of the other callers — those are 85 files
 * of live copy, including structured data and email templates whose exact
 * wording has its own reasons. New code should import from here; an existing
 * spelling should move when something else is already changing it.
 *
 * ── The phone number ───────────────────────────────────────────────────────
 *
 * `(631) 998-9325` is the PUBLIC line and the only number that belongs on a
 * customer document. There is a second number on file — 631-599-2469 — which
 * is the Venmo/Zelle handle's number and must never be printed as "call us".
 */

/** Street + suite, as it should be READ on a document. */
export const STUDIO_STREET = '295 Montauk Hwy, Suite 7'

/** Town, state and ZIP. */
export const STUDIO_LOCALITY = 'Speonk, NY 11972'

/** The one-line form for a document: "295 Montauk Hwy, Suite 7, Speonk, NY 11972". */
export const STUDIO_ADDRESS_LINE = `${STUDIO_STREET}, ${STUDIO_LOCALITY}`

/**
 * A directions link rather than a map pin — a customer opening this on the day
 * wants routing, not a location card. `dir/?api=1&destination=` is Google's
 * documented universal URL and opens the native app on both phone platforms.
 */
export const STUDIO_MAPS_URL =
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(STUDIO_ADDRESS_LINE)}`

/** The public line, formatted for reading. */
export const STUDIO_PHONE_DISPLAY = '(631) 998-9325'

/** The same number as a `tel:`/`sms:` URI body. */
export const STUDIO_PHONE_E164 = '+16319989325'
