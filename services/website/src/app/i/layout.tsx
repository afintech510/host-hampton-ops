import type { Metadata } from 'next'
import { NOINDEX } from '@/lib/seo'
import { fontFaceCss } from '@/lib/evites/fontFaces'

/**
 * Everything under `/i/` is a guest's page (spec §7.1, §13).
 *
 * `robots: NOINDEX` as a meta tag rather than a robots.txt Disallow: a
 * disallowed URL is never FETCHED, so the directive is never read and the bare
 * URL can still be listed from an inbound link. The page has to be crawlable and
 * say no. `next.config.js` sends the same as `X-Robots-Tag`.
 *
 * `referrer: 'no-referrer'` (a `<meta name="referrer">`): the URL of this page is
 * the capability to see a child's party, so it must not travel in a `Referer`
 * header to any third party the page, or a link on it, reaches. The
 * `Referrer-Policy` header says the same.
 */
export const metadata: Metadata = {
  robots: NOINDEX,
  referrer: 'no-referrer',
}

/**
 * The root layout wraps every page in `<main className="pt-20">` (room for the
 * fixed Nav). Nav, Footer and the rest of the chrome return null on `/i/`, so
 * `-mt-20` takes the padding back and the invitation owns the whole viewport.
 *
 * The invitation is the stored portrait JPEG (`InviteImage`, plain CSS: width 100%,
 * max-width 540px, a reserved aspect-ratio box). Only before the first render lands is the
 * 1085 x 1530 web canvas drawn instead, and `ScaledCanvas` scales it from the frame's MEASURED
 * width. It used to be `scale(tan(atan2(100cqw, 1085px)))`, which a phone could accept in
 * `@supports` and then fail to resolve, leaving the canvas unscaled and the frame blank.
 */
const CSS = `
${fontFaceCss()}
.hh-inv-root{margin-top:-5rem;min-height:100vh;min-height:100dvh;background:#1b0630;color:#fff;display:flex;flex-direction:column;align-items:center;padding:1.25rem 1rem 3rem;font-family:'Poppins',system-ui,sans-serif}
.hh-inv-col{width:100%;max-width:33.75rem}
.hh-inv-frame{position:relative;width:100%;max-width:33.75rem;aspect-ratio:1085/1530;margin:0 auto;overflow:hidden;border-radius:14px;box-shadow:0 0 28px rgba(138,61,255,.45)}
.hh-inv-canvas{position:absolute;left:0;top:0;transform-origin:0 0}
.hh-inv-img{border-radius:14px;box-shadow:0 0 28px rgba(138,61,255,.45)}
`

export default function InviteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="hh-inv-root">
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {children}
    </div>
  )
}
