/**
 * Where a customer actually sends money, written down once.
 *
 * Host Hampton has TWO phone numbers and they are not interchangeable:
 *
 *   * **(631) 998-9325** — the public business line (Quo). Calls, texts,
 *     footers, schema.org `telephone`, "contact us" copy.
 *   * **631-599-2469** — the number the **Venmo** (`@HostHampton`) and
 *     **Zelle** accounts are registered to. **Looking up 998-9325 in Venmo
 *     finds nothing.** Confirmed by Adam on 2026-09-08, after the party
 *     planner's Venmo option was found handing out the wrong one.
 *
 * So a customer-facing payment instruction must carry 599-2469, and everything
 * else must carry 998-9325. Before this module the correct number existed as a
 * bare literal in two `lib/emailTemplates.ts` strings and nowhere else, and
 * `/api/portal/pay` told the customer to *"contact Allie at (631) 998-9325 for
 * the handle"* — the public line, for a fact we already hold in
 * `VENMO_HANDLE` / `ZELLE_PHONE` in the container. Rule 11: a value spelled
 * twice as a literal is a value nothing is checking.
 *
 * The env vars win when set, so Adam can change an account without a deploy;
 * the defaults are the live values so nothing breaks if one is unset.
 */

/** The Venmo/Zelle registration number, in the form a customer types. */
export const PAYMENT_PHONE_DISPLAY = '631-599-2469'

/** The public business line. Never a payment destination. */
export const PUBLIC_PHONE_DISPLAY = '(631) 998-9325'

/** Venmo handle, `@`-prefixed. */
export function venmoHandle(): string {
  const raw = (process.env.VENMO_HANDLE || 'HostHampton').trim().replace(/^@/, '')
  return `@${raw}`
}

/** Zelle destination — a phone number, and it is NOT the public line. */
export function zellePhone(): string {
  return (process.env.ZELLE_PHONE || PAYMENT_PHONE_DISPLAY).trim()
}
