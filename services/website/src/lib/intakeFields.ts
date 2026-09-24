/**
 * The three field screens every public intake form needs, in one place.
 *
 * `clean`, `looksLikeEmail` and `looksLikePhone` were written inside
 * `app/api/christmas-market/vendor/route.ts` and worked fine there. The
 * appointment book route needs exactly the same three, and a second copy is how
 * two routes come to disagree about what an email looks like — the family of
 * defect this repo keeps finding (the 20-minute slot grid lived in three files;
 * the price table in four).
 *
 * So they are lifted rather than copied, and the vendor route imports them back.
 *
 * ── THEY ARE DELIBERATELY PERMISSIVE ──
 *
 * These screen for "obviously not an address" and "obviously not a phone
 * number", not for RFC compliance. A real customer turned away by a clever
 * regex is a lost booking, and the cost of letting a typo through is a bounced
 * email somebody follows up by phone. Validation that is stricter than the
 * business is a availability bug wearing a correctness costume.
 *
 * What they are NOT is an escaping or authorization boundary. `clean` bounds
 * LENGTH and trims; HTML escaping happens at the template (`lib/emailSafety.ts`)
 * and identity happens at `lib/contactLookup.ts`.
 */

/** Longest we will store for any single free-text field. */
export const MAX_FIELD = 400

/**
 * A trimmed, length-bounded string, or ''.
 *
 * Non-strings become '' rather than `String(v)`: a JSON body can carry an
 * object, an array or a number where a name belongs, and `"[object Object]"`
 * is a worse thing to store than nothing at all — it passes a truthiness check.
 */
export function clean(v: unknown, max = MAX_FIELD): string {
  if (typeof v !== 'string') return ''
  return v.trim().slice(0, max)
}

/** Something, an @, something, a dot, and at least two more characters. */
export function looksLikeEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
}

/** Ten digits somewhere in the string. Formatting is the customer's business. */
export function looksLikePhone(v: string): boolean {
  return (v.match(/\d/g) || []).length >= 10
}
