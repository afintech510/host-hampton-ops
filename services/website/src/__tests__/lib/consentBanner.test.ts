/**
 * The cookie banner and what it gates: the Meta Pixel, Google Analytics/Ads
 * (Consent Mode v2), the server-side Meta events, and the ViewContent pages.
 */
import fs from 'fs'
import path from 'path'
import { decomment } from '../helpers/sourceScan'
import { readConsentChoice, requestHasConsent, CONSENT_INLINE_EXPR } from '@/lib/consent'
import { gaInitScript } from '@/lib/gaInit'
import { viewContentFor } from '@/lib/metaViewContent'
import { screenAttribution } from '@/lib/attribution'

const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))
const headers = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null })

describe('the choice', () => {
  it('reads granted and denied, and treats anything else as not chosen', () => {
    expect(readConsentChoice('a=1; hh_consent=granted; b=2')).toBe('granted')
    expect(readConsentChoice('hh_consent=denied')).toBe('denied')
    expect(readConsentChoice('hh_consent=maybe')).toBeNull()
    expect(readConsentChoice('other=granted')).toBeNull()
    expect(readConsentChoice(null)).toBeNull()
  })

  it('a request counts as consenting only with a granted cookie and no Global Privacy Control', () => {
    expect(requestHasConsent(headers({ cookie: 'hh_consent=granted' }))).toBe(true)
    expect(requestHasConsent(headers({ cookie: 'hh_consent=granted', 'sec-gpc': '1' }))).toBe(false)
    expect(requestHasConsent(headers({ cookie: 'hh_consent=denied' }))).toBe(false)
    expect(requestHasConsent(headers({}))).toBe(false) // not asked is not yes
  })
})

describe('Google: Consent Mode v2 starts denied', () => {
  const s = gaInitScript({ gaId: 'G-TEST123', gadsId: 'AW-1', pathname: '/party-packages' })
  it('sets all four signals from the cookie BEFORE any config', () => {
    const def = s.indexOf("gtag('consent', 'default'")
    expect(def).toBeGreaterThan(-1)
    expect(def).toBeLessThan(s.indexOf("gtag('config'"))
    for (const k of ['ad_storage', 'analytics_storage', 'ad_user_data', 'ad_personalization']) expect(s).toContain(`${k}: hhConsent`)
    expect(s).toContain(CONSENT_INLINE_EXPR)
    expect(s).toContain("? 'granted' : 'denied'")
  })
})

describe('Meta: the Pixel starts revoked unless the visitor already accepted', () => {
  const s = read('components/MetaPixel.tsx')
  it('consent is decided before init, and PageView waits for it', () => {
    const consent = s.indexOf("fbq('consent'")
    const init = s.indexOf("fbq('init'")
    expect(consent).toBeGreaterThan(-1)
    expect(consent).toBeLessThan(init)
    expect(s).toMatch(/if \(hhConsent\) fbq\('track', 'PageView'\)/)
    // The single-page-app PageView is gated the same way.
    expect(s).toMatch(/if \(!browserHasConsent\(\)\) return\s+window\.fbq\?\.\('track', 'PageView'\)/)
  })

  it('the init literal other tests look for is still there', () => {
    expect(s).toContain("fbq('init', '${META_PIXEL_ID}')")
  })
})

describe('the banner', () => {
  const s = read('components/ConsentBanner.tsx')
  it('offers Accept and Decline at the same size, and updates the tags BEFORE it writes the choice', () => {
    expect(s).toMatch(/Decline/)
    expect(s).toMatch(/Accept/)
    const btn = /const btn = '([^']+)'/.exec(s)
    expect(btn).not.toBeNull()
    // both buttons take the one shared class string
    expect((s.match(/\$\{btn\}/g) ?? []).length).toBe(2)
    expect(s.indexOf("window.fbq?.('consent'")).toBeLessThan(s.indexOf('saveConsent(choice)'))
    expect(s.indexOf("window.gtag?.('consent', 'update'")).toBeLessThan(s.indexOf('saveConsent(choice)'))
  })

  it('never asks a Global Privacy Control browser, and can be reopened', () => {
    expect(s).toMatch(/globalPrivacyControl === true/)
    expect(s).toMatch(/CONSENT_OPEN_EVENT/)
    expect(read('components/Footer.tsx')).toMatch(/<CookieSettingsLink \/>/)
  })

  it('is mounted once in the root layout, next to the Pixel', () => {
    const l = read('app/layout.tsx')
    expect(l).toMatch(/<ConsentBanner \/>/)
    expect(l).toMatch(/<MetaViewContent \/>/)
  })
})

describe('ViewContent', () => {
  it('fires on theme and pricing pages, and only there', () => {
    expect(viewContentFor('/glow-party')).toEqual({ content_name: 'glow-party', content_category: 'party_theme' })
    expect(viewContentFor('/party-themes/')).toEqual({ content_name: 'party-themes', content_category: 'party_theme' })
    expect(viewContentFor('/party-packages')).toEqual({ content_name: 'party-packages', content_category: 'pricing' })
    expect(viewContentFor('/kids-party-menu')?.content_category).toBe('pricing')
    for (const p of ['/', '/faq', '/privacy-policy', '/kids-party-menu/summary', '/book', '/admin', '/i/mia-glow', null, undefined]) {
      expect(viewContentFor(p)).toBeNull()
    }
  })

  it('every page it names exists, so a renamed route cannot silently stop firing', () => {
    const root = path.join(process.cwd(), 'src', 'app')
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'lib', 'metaViewContent.ts'), 'utf8')
    const paths = Array.from(src.matchAll(/'\/([a-z0-9-]+)'/g)).map(m => m[1])
    expect(paths.length).toBeGreaterThan(15)
    const missing = paths.filter(p => !fs.existsSync(path.join(root, p, 'page.tsx')) && !fs.existsSync(path.join(root, p, 'page.ts')))
    expect(missing).toEqual([])
  })

  it('the component waits for consent and carries no visitor data', () => {
    const s = read('components/MetaViewContent.tsx')
    expect(s).toMatch(/browserHasConsent\(\)/)
    expect(s).toMatch(/CONSENT_CHANGE_EVENT/)
    expect(s).not.toMatch(/email|phone|contact/i)
  })
})

describe('what a form posts', () => {
  it('keeps ad_consent only when it is exactly "granted", and the Meta ids only in a safe alphabet', () => {
    expect(screenAttribution({ ad_consent: 'granted', fbp: 'fb.1.2.3', fbc: 'fb.1.2.abc' })).toMatchObject({ ad_consent: 'granted', fbp: 'fb.1.2.3' })
    expect(screenAttribution({ ad_consent: 'yes' })).not.toHaveProperty('ad_consent')
    expect(screenAttribution({ fbp: '<script>' })).not.toHaveProperty('fbp')
  })

  it('getAttribution sends the Meta ids only for a visitor who accepted', () => {
    const s = read('lib/utm.ts')
    const gate = s.indexOf('if (!browserHasConsent())')
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(s.indexOf("cookie('_fbp')"))
    expect(gate).toBeLessThan(s.indexOf('mintMetaEventId()', gate))
  })
})
