import type { Metadata, Viewport } from 'next'
import { notFound } from 'next/navigation'
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from 'next/font/google'
import { NOINDEX } from '@/lib/seo'
import { crewAppOpen } from '@/lib/crew/settings'

/**
 * The crew app shell (spec §8, prompt 03). A staff tool, not a page of the site:
 *
 *   - noindex (this meta tag, plus `X-Robots-Tag` for `/crew/:path*` in
 *     next.config.js; `seo.test.ts` MUST_NOINDEX holds this file to it);
 *   - its own chrome: Nav, Footer, the agency credit, Crisp, the banners, the
 *     Meta Pixel and attribution capture all stand down on `isCrewPath()`;
 *   - `margin-top:-5rem` takes back the root layout's `pt-20` (room for a Nav
 *     that is not here), and the body background is overridden to the crew
 *     surface colour so a short page has no white band under it;
 *   - 404 for everything under `/crew` unless CREW_ENABLED or CREW_TEST_LOGIN is
 *     exactly `true`. Read per request (force-dynamic), never baked at build.
 */

export const dynamic = 'force-dynamic'

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['600', '700', '800'], variable: '--crew-font-display', display: 'swap' })
const body = Plus_Jakarta_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--crew-font-body', display: 'swap' })

export const metadata: Metadata = {
  title: { absolute: 'Host Hampton Crew' },
  robots: NOINDEX,
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
}

export const viewport: Viewport = { themeColor: '#1E1B3A' }

const CSS = `
body{background:#F5F3FA !important}
.crew-root{margin-top:-5rem;min-height:100vh;min-height:100dvh;background:#F5F3FA;color:#1E1B3A;font-family:var(--crew-font-body),system-ui,sans-serif;font-size:16px;line-height:1.45}
.crew-root h1,.crew-root h2,.crew-root h3{font-family:var(--crew-font-display),system-ui,sans-serif;color:#1E1B3A;line-height:1.15}
.crew-root h1{font-size:1.6rem;font-weight:800;margin:0 0 .25rem}
.crew-root h2{font-size:1.15rem;font-weight:700;margin:1.5rem 0 .6rem}
.crew-root h3{font-size:1.05rem;font-weight:700;margin:0}
.crew-wrap{max-width:40rem;margin:0 auto;padding:1.25rem 1rem 6.5rem}
.crew-top{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:1rem}
.crew-brand{font-family:var(--crew-font-display),system-ui,sans-serif;font-weight:800;font-size:1rem;color:#C2185B;letter-spacing:.01em}
.crew-muted{color:#5B5873}
.crew-small{font-size:.875rem}
.crew-card{background:#fff;border:1px solid #E6E3EF;border-radius:16px;padding:1rem;margin-bottom:.75rem}
.crew-rate{background:#1E1B3A;color:#fff;border-radius:18px;padding:1.1rem 1rem;margin-bottom:1rem}
.crew-rate p{margin:0}
.crew-rate .crew-rate-big{font-family:var(--crew-font-display),system-ui,sans-serif;font-weight:800;font-size:1.25rem;line-height:1.25}
.crew-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.crew-meta{display:flex;flex-wrap:wrap;gap:.35rem .9rem;color:#5B5873;font-size:.9rem;margin:.35rem 0 .6rem}
.crew-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:.55rem 1rem;border-radius:12px;border:0;background:#C2185B;color:#fff;font-weight:700;font-size:.95rem;cursor:pointer;text-decoration:none}
.crew-btn:hover{background:#8E1043}
.crew-btn:disabled{opacity:.55;cursor:default}
.crew-btn-ghost{background:#fff;color:#1E1B3A;border:1px solid #E6E3EF}
.crew-btn-ghost:hover{background:#F5F3FA}
.crew-btn:focus-visible,.crew-link:focus-visible,.crew-nav a:focus-visible,.crew-input:focus-visible{outline:3px solid #F4B740;outline-offset:2px}
.crew-link{color:#C2185B;font-weight:700;text-decoration:none}
.crew-link:hover{text-decoration:underline}
.crew-chip{display:inline-block;border-radius:999px;padding:.15rem .6rem;font-size:.8rem;font-weight:700}
.crew-ok{background:#E3F4EA;color:#145236}
.crew-warn{background:#FFF1DB;color:#6E3C00}
.crew-alert{background:#FCE4EE;color:#8E1043}
.crew-info{background:#E8EEFF;color:#1D3F9E}
.crew-gold{background:#F4B740;color:#1E1B3A}
.crew-note{border-radius:12px;padding:.75rem .9rem;margin:.5rem 0;font-size:.92rem}
.crew-input{width:100%;min-height:44px;border:1px solid #E6E3EF;border-radius:12px;padding:.6rem .8rem;font-size:1rem;background:#fff;color:#1E1B3A}
.crew-label{display:block;font-weight:600;margin:.75rem 0 .35rem}
.crew-nav{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid #E6E3EF;display:flex;justify-content:space-around;padding:.35rem .5rem calc(.35rem + env(safe-area-inset-bottom));z-index:40}
.crew-nav a{flex:1;display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;color:#5B5873;font-weight:700;text-decoration:none;font-size:.95rem}
.crew-nav a[aria-current="page"]{color:#C2185B;background:#FCE4EE}
.crew-team{list-style:none;padding:0;margin:.25rem 0 0;display:flex;flex-wrap:wrap;gap:.4rem}
.crew-team li{background:#F5F3FA;border-radius:999px;padding:.25rem .7rem;font-size:.88rem}
.crew-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:.6rem}
.crew-pick{display:block;width:100%;text-align:left;background:#fff;border:1px solid #E6E3EF;border-radius:14px;padding:.75rem;min-height:44px;cursor:pointer;color:#1E1B3A;font:inherit}
.crew-pick:hover{border-color:#C2185B}
.crew-table{width:100%;border-collapse:collapse;font-size:.92rem}
.crew-table th,.crew-table td{text-align:left;padding:.45rem .3rem;border-bottom:1px solid #E6E3EF}
.crew-table tr.crew-mine td{background:#FFF1DB;font-weight:700}
.crew-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:.3rem}
.crew-cal .crew-dow{text-align:center;font-size:.75rem;font-weight:700;color:#5B5873}
.crew-day{min-height:44px;border-radius:10px;border:1px solid #E6E3EF;background:#fff;font:inherit;font-size:.85rem;color:#1E1B3A;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:.15rem}
.crew-day[disabled]{cursor:default;opacity:.45}
.crew-day.crew-day-blocked{background:#FCE4EE;border-color:#C2185B}
.crew-day.crew-day-working{background:#E3F4EA;border-color:#145236;opacity:1}
.crew-day.crew-day-sel{outline:3px solid #F4B740}
`

export default function CrewLayout({ children }: { children: React.ReactNode }) {
  if (!crewAppOpen()) notFound()
  return (
    <div className={`crew-root ${display.variable} ${body.variable}`}>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {children}
    </div>
  )
}
