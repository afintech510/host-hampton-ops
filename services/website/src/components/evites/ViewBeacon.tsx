'use client'

import { useEffect } from 'react'

/**
 * Records ONE `invite_viewed` for this page load (spec §7.1, §11).
 *
 * The page itself has no side effects, so a link-preview bot, a prefetch or a
 * scraper that fetches the HTML counts as nothing: only a client that RUNS
 * JavaScript reaches this. The server dedupes by cookie (24 h), so a reload is
 * not a second view, and sends the Meta Conversions API event (never the
 * browser: no Pixel loads on `/i/`).
 *
 * `keepalive` so the request survives a fast navigation away. Failure is
 * swallowed on purpose: a guest must never see an analytics error.
 *
 * Renders nothing.
 */
export default function ViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    try {
      void fetch(`/api/i/${encodeURIComponent(slug)}/event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event: 'invite_viewed' }),
        keepalive: true,
        credentials: 'same-origin',
      }).catch(() => undefined)
    } catch {
      /* analytics only */
    }
  }, [slug])
  return null
}
