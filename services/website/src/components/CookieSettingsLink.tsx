'use client'

import { CONSENT_OPEN_EVENT } from '@/lib/consent'

/** Footer link that reopens the cookie choice. */
export default function CookieSettingsLink() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(CONSENT_OPEN_EVENT))}
      className="hover:text-hampton-navy transition-colors text-left"
    >
      Cookie settings
    </button>
  )
}
