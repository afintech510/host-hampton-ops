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
 * The scaling is pure CSS, so a bot and a person get the same HTML and there is
 * no layout jump: the canvas is drawn 1085 x 1530 and scaled to its frame's width
 * (`cqw`). Browsers without container-query units or CSS trig fall back to a fixed
 * 375px-wide card.
 */
const CSS = `
${fontFaceCss()}
.hh-inv-root{margin-top:-5rem;min-height:100vh;min-height:100dvh;background:#1b0630;color:#fff;display:flex;flex-direction:column;align-items:center;padding:1.25rem 1rem 3rem;font-family:'Poppins',system-ui,sans-serif}
.hh-inv-col{width:100%;max-width:30rem}
.hh-inv-frame{position:relative;width:min(100%,30rem);aspect-ratio:1085/1530;margin:0 auto;overflow:hidden;border-radius:14px;container-type:inline-size;box-shadow:0 0 28px rgba(138,61,255,.45)}
.hh-inv-canvas{position:absolute;left:0;top:0;width:1085px;height:1530px;transform-origin:0 0;transform:scale(.3456)}
@supports (width:1cqw) and (transform:scale(tan(atan2(1px,1px)))){.hh-inv-canvas{transform:scale(tan(atan2(100cqw,1085px)))}}
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
