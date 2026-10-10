import { isInvitePath } from '@/lib/evites/chrome'

/**
 * The inline GA4 / Google Ads bootstrap, as a pure function so a test can read
 * exactly what a given path would ship (spec §7.1, A17).
 *
 * On `/i/<slug>` the page URL IS the capability to see a child's party, and it
 * would otherwise travel to Google in `page_location`, `page_referrer` and the
 * Ads config's own hit. So on an invitation:
 *
 *   - `gtag('set', { page_location, page_title, page_referrer })` runs BEFORE any
 *     config, so every hit carries `<origin>/i/invite`, a fixed title and no
 *     referrer instead of the slug;
 *   - the Google Ads (`GADS_ID`) config is SKIPPED entirely: that tag exists to
 *     build remarketing audiences and has no business on a guest's page.
 *
 * Everywhere else the output is byte-for-byte what `GoogleAnalytics` always
 * emitted, so no other page's tracking moves.
 */
export function gaInitScript(opts: { gaId: string; gadsId: string; pathname: string | null | undefined }): string {
  const { gaId, gadsId, pathname } = opts
  const invite = isInvitePath(pathname)
  const cleaned = invite
    ? `gtag('set', { page_location: window.location.origin + '/i/invite', page_title: 'Party invitation', page_referrer: '' });`
    : ''
  const ads = !invite && gadsId ? `gtag('config', '${gadsId}');` : ''
  return `
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          ${cleaned}
          gtag('config', '${gaId}', { send_page_view: true });
          ${ads}
        `
}
