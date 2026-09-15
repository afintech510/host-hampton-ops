'use client'

import { useEffect } from 'react'
import { captureAttribution } from '@/lib/utm'

/**
 * Records the first touch of the visit, site-wide.
 *
 * Mounted once in the root layout, so it runs on whichever page the visitor
 * actually landed on — which is the whole point, see the long note on
 * `captureAttribution`. It renders nothing and never throws.
 */
export default function AttributionCapture() {
  useEffect(() => {
    captureAttribution()
  }, [])
  return null
}
