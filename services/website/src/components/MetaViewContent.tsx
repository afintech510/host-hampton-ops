'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { metaTrack } from '@/lib/metaPixel'
import { viewContentFor } from '@/lib/metaViewContent'
import { browserHasConsent, CONSENT_CHANGE_EVENT } from '@/lib/consent'
import { isMetaPixelBlockedPath } from '@/lib/evites/chrome'

/**
 * Fires Meta `ViewContent` on theme and pricing pages (lib/metaViewContent.ts).
 *
 * Once per page view, and only for a visitor who has said yes to cookies: a
 * visitor who accepts while ON a theme page is counted at that moment, so the
 * click that grants consent does not lose the page they are reading. Renders
 * nothing. Keyed on the pathname only, like MetaPixel, so it does not opt the
 * whole app out of static rendering.
 */
export default function MetaViewContent() {
  const pathname = usePathname()
  const last = useRef<string | null>(null)

  useEffect(() => {
    const fire = () => {
      if (isMetaPixelBlockedPath(pathname)) return
      const params = viewContentFor(pathname)
      if (!params || last.current === pathname || !browserHasConsent()) return
      last.current = pathname
      metaTrack('ViewContent', { ...params })
    }
    fire()
    window.addEventListener(CONSENT_CHANGE_EVENT, fire)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, fire)
  }, [pathname])

  return null
}
