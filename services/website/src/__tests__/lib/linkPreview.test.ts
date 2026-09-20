import fs from 'fs'
import path from 'path'
import {
  isLinkPreviewBot,
  previewCardHtml,
  wantsPreviewBypass,
  LINK_PREVIEW_AGENTS,
  PREVIEW_BYPASS_PARAM,
} from '@/lib/linkPreview'

const SRC = path.join(process.cwd(), 'src')
const readRaw = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/**
 * Source-reading rules need the CODE, not the prose around it.
 *
 * Every assertion below failed on its first run for the reason
 * `outboundSendSurface.test.ts` already documents: `indexOf('validatePortalToken')`
 * finds the IMPORT on line 3, not the call on line 120, so an "A comes before B"
 * rule compared two import positions; and `not.toContain('generateMetadata')`
 * matched the COMMENT explaining why there is no `generateMetadata`. Both are
 * the wrong-occurrence family — a rule that passes or fails on text that is not
 * the thing it is about.
 *
 * Offsets are preserved (replacements are same-length blanks) so ordering
 * comparisons stay meaningful.
 */
function blank(src: string, re: RegExp): string {
  return src.replace(re, m => m.replace(/[^\r\n]/g, ' '))
}
const decomment = (s: string) => blank(blank(s, /\/\*[\s\S]*?\*\//g), /\/\/[^\r\n]*/g)

/**
 * Note this is NOT a copy of `outboundSendSurface.test.ts`'s `stripImports`.
 * That one is `^import\s[^\r\n]*(?:\r?\n\s+[^\r\n]*)*?;?\s*$` with a LAZY
 * repeat, so it stops at the end of the first line and leaves the body of a
 * braced multi-line import standing — which is exactly the shape this route
 * uses, and it let `isLinkPreviewBot` be "found" at its import. Anchoring on
 * the closing `from '…'` instead handles both spellings.
 */
const stripImports = (s: string) =>
  blank(
    blank(s, /^import\b[\s\S]*?\bfrom\s*['"][^'"]+['"]\s*;?/gm),
    /^import\s+['"][^'"]+['"]\s*;?/gm,
  )

/** Code only: no comments, no import block. */
const read = (rel: string) => stripImports(decomment(readRaw(rel)))

describe('isLinkPreviewBot', () => {
  it('recognises the fetcher Apple Messages actually uses', () => {
    // This is the whole reason the feature exists. iMessage identifies as
    // Facebook's crawler; there is no "Applebot" in an iMessage preview fetch.
    expect(isLinkPreviewBot('facebookexternalhit/1.1 Facebot Twitterbot/1.0')).toBe(true)
  })

  it('recognises the other card-drawing clients', () => {
    const uas = [
      'WhatsApp/2.23.20.0 A',
      'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
      'TelegramBot (like TwitterBot)',
      'LinkedInBot/1.0 (compatible; Mozilla/5.0; Jakarta Commons-HttpClient/3.1)',
      'Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)',
    ]
    for (const ua of uas) expect(isLinkPreviewBot(ua)).toBe(true)
  })

  it('is case-insensitive — a UA is not a fixed-case string', () => {
    expect(isLinkPreviewBot('FACEBOOKEXTERNALHIT/1.1')).toBe(true)
    expect(isLinkPreviewBot('WhatsApp')).toBe(true)
  })

  it('leaves real browsers alone', () => {
    const humans = [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/129.0',
    ]
    for (const ua of humans) expect(isLinkPreviewBot(ua)).toBe(false)
  })

  it('treats a missing user-agent as a human, not a bot', () => {
    // Failing OPEN is the safe direction: an unrecognised caller gets the
    // redirect this route has always served. Failing closed would hand a real
    // customer a card instead of a login.
    expect(isLinkPreviewBot(null)).toBe(false)
    expect(isLinkPreviewBot(undefined)).toBe(false)
    expect(isLinkPreviewBot('')).toBe(false)
  })

  it('does NOT catch search crawlers — this route must stay unindexed, not indexed differently', () => {
    expect(isLinkPreviewBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(false)
    expect(isLinkPreviewBot('Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)')).toBe(false)
  })

  it('every listed fragment is lowercase, or it can never match', () => {
    for (const frag of LINK_PREVIEW_AGENTS) expect(frag).toBe(frag.toLowerCase())
  })
})

describe('the bypass', () => {
  it('only the exact value opens it', () => {
    expect(wantsPreviewBypass('1')).toBe(true)
    for (const v of ['0', 'true', 'yes', '', null, undefined]) {
      expect(wantsPreviewBypass(v)).toBe(false)
    }
  })
})

describe('previewCardHtml', () => {
  const card = () =>
    previewCardHtml({
      origin: 'https://www.hosthampton.com',
      title: 'Your Host Hampton booking',
      description: 'Open your secure booking portal.',
      continueUrl: 'https://www.hosthampton.com/api/portal/auth?ref=HH-PTY-X&token=abc&go=1',
    })

  it('carries every tag a large preview card needs', () => {
    const html = card()
    for (const tag of [
      'og:type',
      'og:site_name',
      'og:title',
      'og:description',
      'og:image',
      'og:image:width',
      'og:image:height',
      'twitter:card',
      'twitter:image',
    ]) {
      expect(html).toContain(`"${tag}"`)
    }
    // A card without declared dimensions is what makes iMessage fall back to
    // the small chip.
    expect(html).toContain('content="1200"')
    expect(html).toContain('content="630"')
    expect(html).toContain('content="summary_large_image"')
  })

  it('names an ABSOLUTE image url — a relative one renders nowhere', () => {
    expect(card()).toContain('content="https://www.hosthampton.com/images/og-default.png"')
  })

  it('is noindex, because a preview is not a page', () => {
    expect(card()).toContain('noindex, nofollow')
  })

  it('escapes what it interpolates', () => {
    const html = previewCardHtml({
      origin: 'https://www.hosthampton.com',
      title: 'A "quoted" <b>title</b>',
      description: "it's & fine",
      continueUrl: 'https://www.hosthampton.com/x?a=1&b=2',
    })
    expect(html).not.toContain('<b>title</b>')
    expect(html).toContain('&lt;b&gt;title&lt;/b&gt;')
    expect(html).toContain('&amp;b=2')
    expect(html).toContain('&#39;')
  })

  it('offers the escape hatch as a real, visible link', () => {
    const html = card()
    expect(html).toMatch(/<a href="[^"]*go=1"/)
    expect(html).toContain('Open my booking')
  })
})

/* ── The route wiring ─────────────────────────────────────────────────────── */

describe('the portal auth route serves the card before it touches anything', () => {
  const route = () => read('app/api/portal/auth/route.ts')

  it('the harness itself stripped the imports and comments', () => {
    // Without this, every rule below is void — it would be reading the import
    // block and the explanatory prose rather than the handler.
    const src = route()
    expect(src.length).toBe(readRaw('app/api/portal/auth/route.ts').length)
    expect(src).not.toContain("from '@/lib/linkPreview'")
    expect(src).not.toContain('Behind nginx + Docker')
    expect(src).toContain('export async function GET')
  })

  it('answers the preview BEFORE reading the token, setting a cookie or stamping used_at', () => {
    const src = route()
    const preview = src.indexOf('isLinkPreviewBot')
    expect(preview).toBeGreaterThan(-1)

    // A bot that got this far would make `used_at` say a customer opened a
    // link they have not seen, and might be handed a portal cookie.
    for (const later of ['validatePortalToken', 'setPortalCookieHeader', "update({ used_at"]) {
      const at = src.indexOf(later)
      expect(at).toBeGreaterThan(-1)
      expect(preview).toBeLessThan(at)
    }
  })

  it('the card it serves names no customer data', () => {
    const src = route()
    const block = src.slice(src.indexOf('isLinkPreviewBot'), src.indexOf('const ref ='))
    // `ref` and `token` are read AFTER this block; nothing from the booking can
    // be in scope here. Assert it stays that way.
    for (const leak of ['booking.', 'contact_name', 'contact_email', 'total_cents', 'invoice']) {
      expect(block).not.toContain(leak)
    }
  })

  it('it sets no cookie and is not cacheable', () => {
    const src = route()
    const block = src.slice(src.indexOf('isLinkPreviewBot'), src.indexOf('const ref ='))
    expect(block).not.toContain('Set-Cookie')
    expect(block).toContain("'cache-control': 'no-store'")
  })

  it('the continue link is built from the allowlisted origin, not the raw request url', () => {
    const src = route()
    const block = src.slice(src.indexOf('isLinkPreviewBot'), src.indexOf('const ref ='))
    // `publicOrigin(req)` screens the forwarded host; `bypass.toString()` would
    // carry whatever the caller sent. See [forwarded-host is attacker-controlled].
    expect(block).toContain('continueUrl: `${origin}${bypass.pathname}${bypass.search}`')
    expect(block).not.toContain('bypass.toString()')
  })
})

describe('the plan layout previews generically', () => {
  it('has fixed strings and no generateMetadata — a per-plan card would leak', () => {
    const src = read('app/plan/layout.tsx')
    expect(src).toContain('openGraph')
    expect(src).toContain('OG_DEFAULTS')
    expect(src).toContain('NOINDEX')
    // The whole guarantee: nothing dynamic can reach the card.
    expect(src).not.toContain('generateMetadata')
  })
})

describe('the shared OG image', () => {
  const file = path.join(process.cwd(), 'public/images/og-default.png')

  it('exists at the declared 1200x630', () => {
    const buf = fs.readFileSync(file)
    // PNG IHDR: 8-byte signature, 4-byte length, 4-byte 'IHDR', then w/h.
    expect(buf.subarray(12, 16).toString('ascii')).toBe('IHDR')
    expect(buf.readUInt32BE(16)).toBe(1200)
    expect(buf.readUInt32BE(20)).toBe(630)
  })

  it('has NO alpha channel', () => {
    // Colour type 6 (RGBA) is what the file used to be, and a transparent OG
    // PNG composites unpredictably in iMessage and WhatsApp — usually onto
    // black. 2 is truecolour RGB.
    const buf = fs.readFileSync(file)
    const colourType = buf.readUInt8(25)
    expect([0, 2]).toContain(colourType)
  })

  it('is small enough that every unfurler will fetch it', () => {
    // Facebook/Apple cap around 8MB; the practical worry is slow fetches
    // timing out, not the cap.
    expect(fs.statSync(file).size).toBeLessThan(600_000)
  })
})
