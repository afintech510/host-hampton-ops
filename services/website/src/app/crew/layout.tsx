import type { Metadata, Viewport } from 'next'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import {
  Archivo, Archivo_Black, Fraunces, Graduate, Inter, Manrope, Outfit, Space_Grotesk, Space_Mono, Unbounded,
} from 'next/font/google'
import { NOINDEX } from '@/lib/seo'
import { TENANT } from '@/tenant'
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
 *   - every colour, face and radius below is a `--c-*` / `--f-*` / `--r-*`
 *     variable set by the person's theme (`lib/crew/themes.ts`, chosen on
 *     Profile → Appearance), read from a cookie here so the first paint is
 *     already the right one.
 *
 * Fonts: a look names a face, so every face is declared, but only the default
 * look's pair is preloaded; the others are fetched the moment a look that uses
 * them is on screen (the browser loads a declared face only when text uses it).
 */

export const dynamic = 'force-dynamic'

// The default look (Pop): preloaded.
const unbounded = Unbounded({ subsets: ['latin'], variable: '--crew-f-unbounded', display: 'swap' })
const outfit = Outfit({ subsets: ['latin'], variable: '--crew-f-outfit', display: 'swap' })
// The other looks: declared, fetched on use.
const archivoBlack = Archivo_Black({ subsets: ['latin'], weight: '400', variable: '--crew-f-archivoblack', display: 'swap', preload: false })
const archivo = Archivo({ subsets: ['latin'], variable: '--crew-f-archivo', display: 'swap', preload: false })
const manrope = Manrope({ subsets: ['latin'], variable: '--crew-f-manrope', display: 'swap', preload: false })
const inter = Inter({ subsets: ['latin'], variable: '--crew-f-inter', display: 'swap', preload: false })
const space = Space_Grotesk({ subsets: ['latin'], variable: '--crew-f-space', display: 'swap', preload: false })
const spaceMono = Space_Mono({ subsets: ['latin'], weight: ['400', '700'], variable: '--crew-f-spacemono', display: 'swap', preload: false })
const fraunces = Fraunces({ subsets: ['latin'], variable: '--crew-f-fraunces', display: 'swap', preload: false })
// The CREW wordmark: a collegiate slab, on every theme.
const varsity = Graduate({ subsets: ['latin'], weight: '400', variable: '--crew-font-varsity', display: 'swap' })

const FONT_VARS = [archivoBlack, archivo, manrope, inter, unbounded, outfit, space, spaceMono, fraunces, varsity].map(f => f.variable).join(' ')

export const metadata: Metadata = {
  title: { absolute: 'Party Crew' },
  robots: NOINDEX,
  alternates: { canonical: null },
  openGraph: null,
  twitter: null,
}

export const viewport: Viewport = { themeColor: '#1E1B3A' }

/** The ring of dusty blue around the wordmark: 16 offsets of 2px, no blur, so it reads as a clean border on any background. */
const RING = [
  [2, 0], [-2, 0], [0, 2], [0, -2], [1.7, 1.7], [-1.7, 1.7], [1.7, -1.7], [-1.7, -1.7],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [-1, 2], [1, -2], [-1, -2],
].map(([x, y]) => `${x}px ${y}px 0 var(--c-brand-blue)`).join(',')

const CSS = `
${themeCss()}
.crew-root{margin-top:-5rem;min-height:100vh;min-height:100dvh;background:var(--c-bg);color:var(--c-text);font-family:var(--f-body);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
.crew-root h1,.crew-root h2,.crew-root h3{font-family:var(--f-display);color:var(--c-text);line-height:1.15;letter-spacing:var(--h2-spacing)}
.crew-root h1{font-size:var(--h1-size);font-weight:var(--h1-weight);margin:0 0 .35rem;letter-spacing:-.01em}
.crew-root h2{font-size:var(--h2-size);font-weight:700;margin:1.75rem 0 .65rem;text-transform:var(--h2-transform)}
.crew-root h3{font-size:1.05rem;font-weight:700;margin:0}
.crew-wrap{max-width:40rem;margin:0 auto;padding:1.25rem 1rem 7rem}
.crew-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:.75rem;margin-bottom:1.1rem}
.crew-brandmark{grid-column:2;justify-self:center;display:inline-flex;align-items:center;text-decoration:none;min-width:0;white-space:nowrap}
.crew-top > .crew-who{grid-column:3;justify-self:end}
.crew-wordmark{font-family:var(--crew-font-varsity),Impact,'Arial Black',sans-serif;font-size:1.7rem;line-height:1;letter-spacing:.07em;text-transform:uppercase;color:var(--c-brand-navy);text-shadow:${RING};padding:.1rem .2rem .05rem}
.crew-top{flex-wrap:nowrap}
.crew-who{display:flex;align-items:center;flex-wrap:nowrap;gap:.5rem;min-width:0;flex-shrink:0}
.crew-top .crew-btn{min-height:36px;padding:.3rem .8rem;font-size:.85rem}
.crew-who-name{white-space:nowrap}
@media (max-width:480px){.crew-who-name{display:none}}
.crew-muted{color:var(--c-muted)}
.crew-small{font-size:.875rem}
.crew-card{background:var(--c-surface);border:var(--card-border);border-radius:var(--r-card);padding:var(--pad-card);margin-bottom:var(--gap-card);box-shadow:var(--c-shadow)}
.crew-rate{background:var(--c-rate);color:var(--c-rate-ink);border-radius:var(--r-card);padding:1.1rem 1rem;margin-bottom:1rem}
.crew-rate p{margin:0}
.crew-rate .crew-rate-big{font-family:var(--f-display);font-weight:800;font-size:1.25rem;line-height:1.25}
.crew-rate a{color:var(--c-rate-link)}
.crew-row{display:flex;flex-wrap:wrap;gap:.5rem;align-items:center}
.crew-meta{display:flex;flex-wrap:wrap;gap:.35rem .9rem;color:var(--c-muted);font-size:.9rem;margin:.35rem 0 .7rem}
.crew-party{position:relative;display:flex;gap:.9rem;align-items:flex-start}
.crew-party-click{cursor:pointer}
.crew-resp{display:flex;flex-direction:column;gap:.5rem;width:100%;margin-top:.25rem}
.crew-resp .crew-btn{justify-content:flex-start;text-align:left}
.crew-resp-note{margin:.1rem 0 0;font-size:.85rem;color:var(--c-muted)}
.crew-party-link{text-decoration:none}
.crew-party-link::after{content:'';position:absolute;inset:0;z-index:0;border-radius:inherit}
.crew-party-click:hover .crew-party-link{text-decoration:underline}
.crew-party-click:active{opacity:.93}
.crew-party-link:focus-visible{outline:none}
.crew-party-click:has(.crew-party-link:focus-visible){outline:3px solid var(--c-accent);outline-offset:3px}
.crew-party-click .crew-btn,.crew-party-click button{position:relative;z-index:1}
.crew-party-main{flex:1;min-width:0}
.crew-date{flex:0 0 auto;display:var(--date-tile);flex-direction:column;align-items:center;justify-content:center;text-align:center;line-height:1;gap:.2rem;min-width:3.4rem}
.crew-date-mon{font-size:.7rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.crew-date-day{font-family:var(--f-display);font-size:1.8rem;font-weight:800;line-height:1}
.crew-date-dow{font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--c-muted)}
.crew-m{display:inline-flex;align-items:center;gap:.3rem}
.crew-m-day{display:none}
.crew-mi{flex:none;opacity:.85}
.crew-nav-emoji{display:var(--nav-emoji)}
.crew-nav-line{display:var(--nav-line)}
.crew-kind{display:inline-flex;align-items:center;gap:.35rem;font-size:.8rem;font-weight:700;color:var(--c-accent-ink);background:var(--c-accent-soft);border-radius:var(--r-chip);padding:.15rem .6rem;margin:0 0 .45rem}
.crew-btn{display:inline-flex;align-items:center;justify-content:center;min-height:var(--btn-h);padding:var(--btn-pad);border-radius:var(--r-btn);border:1px solid transparent;background:var(--c-accent);color:var(--c-on-accent);font-weight:700;font-size:.95rem;cursor:pointer;text-decoration:none;transition:background .15s,border-color .15s}
.crew-btn:hover{background:var(--c-accent-hover)}
.crew-btn:disabled{opacity:.55;cursor:default}
.crew-btn-ghost{background:var(--c-surface);color:var(--c-text);border-color:var(--c-line)}
.crew-btn-ghost:hover{background:var(--c-surface2)}
.crew-btn:focus-visible,.crew-link:focus-visible,.crew-nav a:focus-visible,.crew-input:focus-visible,.crew-modal :focus-visible{outline:3px solid var(--c-accent);outline-offset:2px}
.crew-link{color:var(--c-accent);font-weight:700;text-decoration:none}
.crew-link:hover{text-decoration:underline}
.crew-chip{display:inline-block;border-radius:var(--r-chip);padding:.15rem .65rem;font-size:.8rem;font-weight:700}
.crew-chip-pick{display:inline-flex;align-items:center;gap:.4rem;min-height:44px;padding:.25rem .9rem;cursor:pointer;background:var(--c-surface2);color:var(--c-text);border:1px solid var(--c-line);font-size:.92rem}
.crew-ok{background:var(--c-ok);color:var(--c-ok-ink)}
.crew-warn{background:var(--c-warn);color:var(--c-warn-ink)}
.crew-alert{background:var(--c-alert);color:var(--c-alert-ink)}
.crew-info{background:var(--c-info);color:var(--c-info-ink)}
.crew-gold{background:var(--c-gold);color:var(--c-gold-ink)}
.crew-note{border-radius:var(--r-input);padding:.75rem .9rem;margin:.5rem 0;font-size:.92rem}
.crew-input{width:100%;min-height:44px;border:1px solid var(--c-line);border-radius:var(--r-input);padding:.6rem .8rem;font-size:1rem;background:var(--c-surface);color:var(--c-text);color-scheme:light dark;font-family:inherit}
.crew-label{display:block;font-weight:600;margin:.75rem 0 .35rem}
.crew-nav{position:fixed;left:0;right:0;bottom:0;background:var(--c-surface);border-top:1px solid var(--c-line);display:flex;justify-content:space-around;gap:.25rem;padding:.35rem .5rem calc(.35rem + env(safe-area-inset-bottom));z-index:40}
.crew-nav a{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.1rem;min-height:56px;border-radius:var(--r-nav);color:var(--c-muted);font-weight:700;text-decoration:none;font-size:.78rem}
.crew-nav a .crew-nav-emoji{font-size:1.35rem;line-height:1}
.crew-nav a[aria-current="page"]{color:var(--c-accent-ink);background:var(--c-accent-soft)}
.crew-team{list-style:none;padding:0;margin:.25rem 0 0;display:flex;flex-wrap:wrap;gap:.4rem}
.crew-team li{background:var(--c-surface2);border-radius:var(--r-chip);padding:.25rem .75rem;font-size:.88rem}
.crew-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr));gap:.6rem}
.crew-pick{display:block;width:100%;text-align:left;background:var(--c-surface);border:1px solid var(--c-line);border-radius:var(--r-card);padding:.75rem;min-height:44px;cursor:pointer;color:var(--c-text);font:inherit}
.crew-pick:hover,.crew-pick[aria-pressed="true"]{border-color:var(--c-accent)}
.crew-pick[aria-pressed="true"]{box-shadow:0 0 0 2px var(--c-accent)}
.crew-swatch{display:flex;height:2.1rem;border-radius:var(--r-input);overflow:hidden;border:1px solid var(--c-line);margin-bottom:.5rem}
.crew-swatch span{flex:1}
.crew-table{width:100%;border-collapse:collapse;font-size:.92rem}
.crew-table th,.crew-table td{text-align:left;padding:.45rem .3rem;border-bottom:1px solid var(--c-line)}
.crew-table tr.crew-mine td{background:var(--c-warn);font-weight:700}
dialog.crew-modal{border:0;padding:0;border-radius:var(--r-modal);width:min(32rem,calc(100vw - 1.5rem));max-height:90dvh;background:var(--c-surface);color:var(--c-text);box-shadow:0 24px 64px rgba(0,0,0,.35);overflow:auto}
dialog.crew-modal::backdrop{background:var(--c-scrim)}
.crew-modal-body{padding:1.25rem}
@media (max-width:640px){dialog.crew-modal{margin:auto auto 0;border-bottom-left-radius:0;border-bottom-right-radius:0;width:100%;max-width:100%}}
@media (max-width:380px){.crew-wordmark{font-size:1.45rem}.crew-logo{height:30px}}
`

export default function CrewLayout({ children }: { children: React.ReactNode }) {
  if (!crewAppOpen()) notFound()
  const theme = themeFromCookie(cookies().get(THEME_COOKIE)?.value)
  // The brand's own two colours, for the wordmark: the same on every theme.
  const brand = { '--c-brand-navy': TENANT.brand.colors.navy, '--c-brand-blue': TENANT.brand.colors.blue } as React.CSSProperties
  return (
    <div className={`crew-root ${FONT_VARS}`} data-theme={theme} style={brand}>
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {children}
    </div>
  )
}
