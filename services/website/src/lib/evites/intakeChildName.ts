/**
 * The birthday child's first name, as an intake route accepts it (spec §2.1 "two small intake fixes").
 *
 * `/api/lead`, `/api/mobile-party-inquiry` and `/api/quote/save` take an OPTIONAL name from a public,
 * unauthenticated form and write it to `bookings.child_name`, which the invitation prints on a public
 * image and a public page. So it is screened on the server (the form's `maxLength` is a courtesy, not a
 * control): `boundedIntakeText` caps and trims it, `screenName` removes control, zero-width and bidi
 * characters and collapses whitespace. Anything that is not a string, or that leaves nothing, is `null`
 * and the booking is written with no name - the invitation then reads "BIRTHDAY STAR", which is correct.
 *
 * An over-long value is cut rather than refused: this is an optional field on a lead form, and refusing
 * the whole enquiry over it would lose the lead (AGENTS.md: a public intake route answers 200 only if
 * something landed; it must not answer 400 over a nicety).
 */

import { boundedIntakeText } from '@/lib/publicIntake'
import { CHILD_NAME_MAX, screenName } from '@/lib/evites/screens'

export function screenIntakeChildName(raw: unknown): string | null {
  return screenName(boundedIntakeText(raw, CHILD_NAME_MAX), CHILD_NAME_MAX)
}
