/**
 * Escape a value before it is interpolated into an HTML email body.
 *
 * Its own module, with no imports, because two copies of an escaper is one
 * escaper nothing is checking (hard-won rule 11) and both the plan-summary email
 * and the payment receipt need it.
 *
 * Why it is needed at all: `contact_name` is CUSTOMER-written — it arrives from
 * the public intake forms and from the agent's field extraction — and the plan
 * emails interpolate it straight into markup. A field is hostile because of who
 * can WRITE it, not which template it prints in (hard-won rule 5). The blast
 * radius is small (these emails only ever go to the plan's own address and to
 * Adam) but "small" is not a reason to ship raw interpolation on a path that now
 * also carries money figures a reader is meant to trust.
 */
export function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
