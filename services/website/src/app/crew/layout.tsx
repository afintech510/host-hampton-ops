import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { Bricolage_Grotesque, Plus_Jakarta_Sans } from 'next/font/google'
import { NOINDEX } from '@/lib/seo'
import { crewAppOpen } from '@/lib/crew/settings'
import { THEME_COOKIE, themeCss, themeFromCookie } from '@/lib/crew/themes'

/**
 * The crew app shell (spec §8, prompt 03). A staff tool, not a page of the site:
 *
 *   - noindex (this meta tag, plus `X-Robots-Tag` for `/crew/:path*` in
 *     next.config.js; `seo.test.ts` MUST_NOINDEX holds this file to it);
 *   - its own chrome: Nav, Footer, the agency credit, Crisp, the banners, the
 *     Meta Pixel and attribution capture all stand down on `isCrewPath()`;
 *   - `margin-top:-5rem` takes back the root layout's `pt-20` (room for a Nav
 *     that is not here), and the body background is overridden to the theme's
 *     surface so a short page (or an overscroll) has no white band under it;
 *   - 404 for everything under `/crew` unless CREW_ENABLED or CREW_TEST_LOGIN is
 *     exactly `true`. Read per request (force-dynamic), never baked at build.
 *   - every colour below is a `--c-*` variable set by the person's theme
 *     (`lib/crew/themes.ts`, chosen on Profile → Appearance), read from a cookie
 *     here so the first paint is already the right one.
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
${themeCss()}
.crew-root{margin-top:-5rem;min-height:100vh;min-height:100dvh;background:var(--c-bg);color:var(--c-text);font-family:var(--crew-font-body),system-ui,sans-serif;font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
.crew-root h1,.crew-root h2,.crew-root h3{font-family:var(--crew-font-display),system-ui,sans-serif;color:var(--c-text);line-height:1.15;letter-spacing:-.01em}
.crew-root h1{font-size:1.75rem;font-weight:800;margin:0 0 .35rem}
.crew-root h2{font-size:1.1rem;font-weight:700;margin:1.75rem 0 .65rem}
.crew-root h3{font-size:1.05rem;font-weight:700;margin:0}
.crew-wrap{max-width:40rem;margin:0 auto;padding:1.25rem 1rem 6.5rem}
.crew-top{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:1.1rem}
.crew-brand{font-family:var(--crew-font-display),system-ui,sans-serif;font-weight:800;font-size:1rem;color:var(--c-accent);letter-spacing:.01em}
.crew-muted{color:var(--c-muted)}
.crew-small{font-size:.875rem}
.crew-card{background:var(--c-surface);border:1px solid var(--c-line);border-radius:16px;padding:1rem 1.1rem;margin-bottom:.75rem;box-shadow:var(--c-shadow)}
.crew-rate{background:var(--c-rate);color:var(--c-rate-ink);border-radius:18px;padding:1.1rem 1rem;margin-bottom:1rem}
.crew-rate p{margin:0}
.crew-rate .crew-rate-big{font-family:var(--crew-font-display),system-ui,sans-serif;font-weight:800;font-size:1.25rem;line-height:1.25}
.crew-rate a{color:var(--c-rate-link)}
.crew-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.crew-meta{display:flex;flex-wrap:wrap;gap:.35rem .9rem;color:var(--c-muted);font-size:.9rem;margin:.35rem 0 .7rem}
.crew-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:.55rem 1.1rem;border-radius:12px;border:1px solid transparent;background:var(--c-accent);color:var(--c-on-accent);font-weight:700;font-size:.95rem;cursor:pointer;text-decoration:none;transition:background .15s,border-color .15s}
.crew-btn:hover{background:var(--c-accent-hover)}
.crew-btn:disabled{opacity:.55;cursor:default}
.crew-btn-ghost{background:var(--c-surface);color:var(--c-text);border-color:var(--c-line)}
.crew-btn-ghost:hover{background:var(--c-surface2)}
.crew-btn:focus-visible,.crew-link:focus-visible,.crew-nav a:focus-visible,.crew-input:focus-visible,.crew-modal :focus-visible{outline:3px solid var(--c-accent);outline-offset:2px}
.crew-link{color:var(--c-accent);font-weight:700;text-decoration:none}
.crew-link:hover{text-decoration:underline}
.crew-chip{display:inline-block;border-radius:999px;padding:.15rem .65rem;font-size:.8rem;font-weight:700}
.crew-chip-pick{display:inline-flex;align-items:center;gap:.4rem;min-height:44px;padding:.25rem .9rem;cursor:pointer;background:var(--c-surface2);color:var(--c-text);border:1px solid var(--c-line);font-size:.92rem}
.crew-ok{background:var(--c-ok);color:var(--c-ok-ink)}
.crew-warn{background:var(--c-warn);color:var(--c-warn-ink)}
.crew-alert{background:var(--c-alert);color:var(--c-alert-ink)}
.crew-info{background:var(--c-info);color:var(--c-info-ink)}
.crew-gold{background:var(--c-gold);color:var(--c-gold-ink)}
.crew-note{border-radius:12px;padding:.75rem .9rem;margin:.5rem 0;font-size:.92rem}
.crew-input{width:100%;min-height:44px;border:1px solid var(--c-line);border-radius:12px;padding:.6rem .8rem;font-size:1rem;background:var(--c-surface);color:var(--c-text);color-scheme:light dark}
.crew-label{display:block;font-weight:600;margin:.75rem 0 .35rem}
.crew-nav{position:fixed;left:0;right:0;bottom:0;background:var(--c-surface);border-top:1px solid var(--c-line);display:flex;justify-content:space-around;padding:.35rem .5rem calc(.35rem + env(safe-area-inset-bottom));z-index:40}
.crew-nav a{flex:1;display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;color:var(--c-muted);font-weight:700;text-decoration:none;font-size:.95rem}
.crew-nav a[aria-current="page"]{color:var(--c-accent-ink);background:var(--c-accent-soft)}
.crew-team{list-style:none;padding:0;margin:.25rem 0 0;display:flex;flex-wrap:wrap;gap:.4rem}
.crew-team li{background:var(--c-surface2);border-radius:999px;padding:.25rem .75rem;font-size:.88rem}
.crew-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:.6rem}
.crew-pick{display:block;width:100%;text-align:left;background:var(--c-surface);border:1px solid var(--c-line);border-radius:14px;padding:.75rem;min-height:44px;cursor:pointer;color:var(--c-text);font:inherit}
.crew-pick:hover,.crew-pick[aria-pressed="true"]{border-color:var(--c-accent)}
.crew-pick[aria-pressed="true"]{box-shadow:0 0 0 2px var(--c-accent)}
.crew-swatch{display:flex;height:2.1rem;border-radius:10px;overflow:hidden;border:1px solid var(--c-line);margin-bottom:.5rem}
.crew-swatch span{flex:1}
.crew-table{width:100%;border-collapse:collapse;font-size:.92rem}
.crew-table th,.crew-table td{text-align:left;padding:.45rem .3rem;border-bottom:1px solid var(--c-line)}
.crew-table tr.crew-mine td{background:var(--c-warn);font-weight:700}
dialog.crew-modal{border:0;padding:0;border-radius:20px;width:min(32rem,calc(100vw - 1.5rem));max-height:90dvh;background:var(--c-surface);color:var(--c-text);box-shadow:0 24px 64px rgba(0,0,0,.35);overflow:auto}
dialog.crew-modal::backdrop{background:var(--c-scrim)}
.crew-modal-body{padding:1.25rem}
@media (max-width:640px){dialog.crew-modal{margin:auto auto 0;border-bottom-left-radius:0;border-bottom-right-radius:0;width:100%;max-width:100%}}
`

export default function CrewLayout({ children }: { children: React.ReactNode }) {
  if (!crewAppOpen()) notFound()
  const theme = themeFromCookie(cookies().get(THEME_COOKIE)?.value)
  return (
    <div className={`crew-root ${display.variable} ${body.variable}`} data-theme={theme}>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {children}
    </div>
  )
}
