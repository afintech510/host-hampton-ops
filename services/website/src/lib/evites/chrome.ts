/**
 * Which paths are an EVITE surface, for the site-wide chrome (spec §7.1).
 *
 * Imported by client components (Nav, Footer, BenchworksAttribution,
 * AttributionCapture, MetaPixel, GoogleAnalytics, CrispChat, the banners), so it
 * imports nothing and runs anywhere.
 *
 *   /i/<slug>                  the public invitation. A guest's page: no site nav,
 *                              no footer, no third-party tracking, no attribution
 *                              capture (`landing_path` would store the slug).
 *   /my-booking/invitation*    the host page. Carries no slug, so it keeps normal
 *                              GA and the site chrome, but not the Meta Pixel.
 *
 * `usePathname()` can be null (outside the router); null is not an invite path.
 */

/** `/i/<anything>`. There is no `/i` page, so the bare `/i` is not matched. */
export function isInvitePath(pathname: string | null | undefined): boolean {
  return typeof pathname === 'string' && pathname.startsWith('/i/')
}

/** `/my-booking/invitation` and anything beneath it. */
export function isHostInvitationPath(pathname: string | null | undefined): boolean {
  return typeof pathname === 'string' && (pathname === '/my-booking/invitation' || pathname.startsWith('/my-booking/invitation/'))
}

/** Where the Meta Pixel must not load and must not fire PageView. */
export function isMetaPixelBlockedPath(pathname: string | null | undefined): boolean {
  return isInvitePath(pathname) || isHostInvitationPath(pathname)
}
