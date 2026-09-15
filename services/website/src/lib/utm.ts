import type { Attribution } from './attribution'
import { UTM_KEYS } from './attribution'

export type { Attribution }

const STORAGE_KEY = 'hh_attr'
/** The pre-2026-09-15 key. Read once, so a visitor mid-session is not re-zeroed. */
const LEGACY_KEY = 'hh_utm'

/**
 * Record the first touch of this visit, once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS CALLED FROM THE LAYOUT AND NOT FROM THE FORM.
 *
 * It used to be called inside `ContactForm`, `MobilePartyForm`,
 * `RoomRentalLeadForm` and `PartyPackagesContent` — the four components that
 * then POSTed the result. So the tag was only ever read off the URL of the page
 * that HELD the form. A visitor who arrived on the homepage from an Instagram
 * link and then clicked through to /party-packages got here with a clean URL,
 * and the capture recorded nothing.
 *
 * That is not a theoretical hole. Measured on production 2026-09-15: 95 form
 * submissions in six months, **3** carrying any UTM. The three that survived
 * are the three where the tagged URL happened to be the form's own page.
 *
 * `<AttributionCapture />` in the root layout runs this on the first page of
 * the visit, whichever page that is.
 *
 * FIRST TOUCH WINS. If this session already recorded one, it is not replaced.
 * The alternative — last touch — credits the channel that brought someone back
 * to a decision they had already made, and on this business that is almost
 * always "direct", because they already know the name by then.
 */
export function captureAttribution() {
  if (typeof window === 'undefined') return
  try {
    if (sessionStorage.getItem(STORAGE_KEY)) return

    const attribution: Attribution = {}

    const url = new URLSearchParams(window.location.search)
    for (const key of UTM_KEYS) {
      const val = url.get(key)
      if (val) attribution[key] = val
    }

    // A legacy `hh_utm` from earlier in this same session is a real first
    // touch; carry it rather than throwing it away on the deploy boundary.
    if (!attribution.utm_source) {
      const legacy = sessionStorage.getItem(LEGACY_KEY)
      if (legacy) {
        try {
          Object.assign(attribution, JSON.parse(legacy))
        } catch {
          /* a corrupt legacy value is not worth failing over */
        }
      }
    }

    // The referrer is the only signal for untagged traffic — organic Google,
    // a link someone posted, an AI answer engine. The server reduces it to a
    // host; send the raw value and let the one screen decide (rule 11).
    if (document.referrer) {
      try {
        if (new URL(document.referrer).host !== window.location.host) {
          attribution.referrer = document.referrer
        }
      } catch {
        /* unparseable referrer: no signal, not an error */
      }
    }

    attribution.landing_path = window.location.pathname
    attribution.captured_at = new Date().toISOString()

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(attribution))
  } catch {
    // sessionStorage throws in Safari private mode and behind some privacy
    // extensions. Attribution is never worth a broken page.
  }
}

/** The first touch of this visit, for posting with a form. `{}` if unknown. */
export function getAttribution(): Attribution {
  if (typeof window === 'undefined') return {}
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}
