/**
 * Links that open the Quo APP itself (not my.quo.com): the composer on a new text to a number, or
 * the dialer on a number (https://support.quo.com/core-concepts/integrations/deep-linking).
 *
 * Pure, so the admin buttons can build them in the browser: a link made at the moment of the tap
 * is an ordinary navigation, where one made after a round trip to the server is the kind a phone
 * may refuse. A call opens the dialer and waits for a tap; it never dials by itself. These only
 * open something: nothing is sent. `selectedAsFallback` has Quo use the line already selected in
 * the app (the studio line).
 */

/** `+1…` for a US number, or null when it is not a phone number. */
function e164(raw: string | null | undefined): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export function quoAppLink(kind: 'text' | 'call', phone: string | null | undefined): string | null {
  const to = e164(phone)
  if (!to) return null
  const qs = `number=${encodeURIComponent(to)}&selectedAsFallback=true`
  return `openphone://${kind === 'text' ? 'message' : 'dial'}?${qs}`
}
