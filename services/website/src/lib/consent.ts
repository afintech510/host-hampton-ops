/**
 * Advertising and analytics consent: the visitor's choice, in one cookie.
 *
 *   hh_consent = granted | denied      (absent = not chosen yet = NOT consented)
 *
 * What it gates: the Meta Pixel, Google Analytics and Google Ads, and the
 * server-side copies of conversions we send to Meta. Absent is treated as "no",
 * because a visitor who has not been asked has not said yes. A browser that
 * sends Global Privacy Control (`Sec-GPC: 1` / `navigator.globalPrivacyControl`)
 * is a standing "no" and is never asked.
 *
 * What it does NOT gate: the site working, the booking forms, and our own
 * first-touch record of where a visitor came from (kept in this tab's
 * sessionStorage and only ever sent to us, with a form the visitor chose to
 * submit).
 *
 * PURE and dependency-free on purpose: the layout's inline scripts and the
 * server routes read the same cookie through the same definitions.
 */

export const CONSENT_COOKIE = 'hh_consent'
export const CONSENT_MAX_AGE_S = 60 * 60 * 24 * 365
/** Fired on `window` after the choice changes; also used to reopen the banner. */
export const CONSENT_CHANGE_EVENT = 'hh-consent-change'
export const CONSENT_OPEN_EVENT = 'hh-consent-open'

export type ConsentChoice = 'granted' | 'denied'

/** The raw choice in a `Cookie:` header / `document.cookie`, or null if there is none. */
export function readConsentChoice(cookieHeader: string | null | undefined): ConsentChoice | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq < 0 || part.slice(0, eq).trim() !== CONSENT_COOKIE) continue
    const v = part.slice(eq + 1).trim()
    return v === 'granted' || v === 'denied' ? v : null
  }
  return null
}

/** Server side: did this request come from a visitor who said yes, and sent no GPC signal? */
export function requestHasConsent(headers: { get(name: string): string | null }): boolean {
  if ((headers.get('sec-gpc') ?? '').trim() === '1') return false
  return readConsentChoice(headers.get('cookie')) === 'granted'
}

/** Browser side: the same question about this visitor, right now. */
export function browserHasConsent(): boolean {
  if (typeof document === 'undefined') return false
  try {
    const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true
    if (gpc) return false
    return readConsentChoice(document.cookie) === 'granted'
  } catch {
    return false
  }
}

/** Browser side: remember a choice and tell everything that listens. */
export function saveConsent(choice: ConsentChoice): void {
  if (typeof document === 'undefined') return
  const secure = typeof location !== 'undefined' && location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax${secure}`
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CONSENT_CHANGE_EVENT, { detail: choice }))
}

/**
 * The same test as `browserHasConsent`, as a JavaScript expression for an inline
 * <script> that runs before React does (the Pixel and GA bootstraps).
 */
export const CONSENT_INLINE_EXPR =
  "(document.cookie.indexOf('hh_consent=granted')>-1&&navigator.globalPrivacyControl!==true)"
