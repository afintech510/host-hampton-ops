'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { captureAttribution } from '@/lib/utm'
import { isInvitePath } from '@/lib/evites/chrome'

/**
 * Records the first touch of the visit, site-wide.
 *
 * Mounted once in the root layout, so it runs on whichever page the visitor
 * actually landed on — which is the whole point, see the long note on
 * `captureAttribution`. It renders nothing and never throws.
 *
 * NOT on `/i/<slug>`: the capture stores `landing_path`, which on an invitation
 * is the slug, and that is later POSTed with a lead form. It is keyed on the
 * pathname so a guest who lands on an invitation and then walks into the site
 * still gets their first touch recorded (the capture is itself first-touch-wins
 * per session, so re-running it on a later page costs one storage read).
 */
export default function AttributionCapture() {
  const pathname = usePathname()
  useEffect(() => {
    if (isInvitePath(pathname)) return
    captureAttribution()
  }, [pathname])
  return null
}
