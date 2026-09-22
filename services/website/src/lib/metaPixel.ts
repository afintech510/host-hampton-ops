export const META_PIXEL_ID = process.env.NEXT_PUBLIC_META_PIXEL_ID || ''

declare global {
  interface Window {
    fbq?: ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue?: unknown[] }
    _fbq?: unknown
  }
}

/**
 * Fire a Meta standard event. No-ops when the pixel is not configured, which is
 * the normal state in dev and in any environment where NEXT_PUBLIC_META_PIXEL_ID
 * is unset — same gating pattern `GADS_ID` uses in `lib/gtag.ts`.
 *
 * Advanced Matching is deliberately NOT used: we never pass em/ph/fn here, and
 * `MetaPixel.tsx` inits without user data. See the note there — the code half of
 * that decision is not sufficient on its own.
 */
export function metaTrack(name: string, params?: Record<string, unknown>) {
  if (!META_PIXEL_ID) return
  if (typeof window === 'undefined' || !window.fbq) return
  window.fbq('track', name, params)
}
