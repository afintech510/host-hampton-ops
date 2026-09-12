/**
 * Publishing a website_content row CREATES A URL. These tests cover the three
 * ways that URL can be worthless, and the tripwire that keeps the checker
 * honest as the app grows.
 */

import fs from 'fs'
import path from 'path'
import {
  checkSlug,
  contentPath,
  isShadowedByStaticRoute,
  STATIC_ROUTE_PATTERNS,
  MAX_SLUG_CHARS,
  MAX_SLUG_SEGMENTS,
} from '@/lib/content/slugSafety'
import { RESERVED_PREFIXES, parseLocaleSlug } from '@/lib/content/slug'

describe('contentPath', () => {
  it('English keeps the bare slug, Spanish lives under /es/', () => {
    expect(contentPath('party-room-rental', 'en')).toBe('/party-room-rental')
    expect(contentPath('party-room-rental', 'es')).toBe('/es/party-room-rental')
  })
})

describe('the four English drafts in the live table are shadowed', () => {
  // These are the real rows: all four have a hand-built app/<slug>/page.tsx,
  // so publishing one would change nothing a visitor sees.
  it.each(['first-birthday-parties', 'communion-party', 'fundraiser', 'cm-cheer'])(
    '%s cannot be published in English',
    slug => {
      const r = checkSlug(slug, 'en')
      expect(r.ok).toBe(false)
      expect(r.code).toBe('shadowed')
      expect(r.message).toMatch(/hand-built page/)
    },
  )

  it('the one PUBLISHED row is Spanish, which is why it renders', () => {
    // /es/party-room-rental is reached by the catch-all because no static route
    // begins with an `es` segment — while /party-room-rental is a real page.
    expect(checkSlug('party-room-rental', 'en').ok).toBe(false)
    expect(checkSlug('party-room-rental', 'es').ok).toBe(true)
  })
})

describe('the slugs the weekly cron actually generates are publishable', () => {
  it.each([
    'permanent-jewelry-southampton',
    'permanent-jewelry-east-hampton',
    'permanent-jewelry-sag-harbor',
    'permanent-jewelry-water-mill',
  ])('%s is fine', slug => {
    expect(checkSlug(slug, 'en')).toEqual({ ok: true, path: `/${slug}` })
  })
})

describe('reserved prefixes match the renderer exactly', () => {
  it('every reserved prefix is refused, with the reserved code', () => {
    for (const prefix of RESERVED_PREFIXES) {
      // Some reserved words (`book`) are ALSO static routes; either refusal is
      // correct, but it must be a refusal.
      const r = checkSlug(prefix, 'en')
      expect(r.ok).toBe(false)
    }
  })

  it('a reserved first segment is refused even with a child segment', () => {
    const r = checkSlug('api/leads', 'en')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('reserved')
  })

  it('agrees with parseLocaleSlug, which is what actually 404s', () => {
    // Rule 11: the blocklist is imported, not restated. If they ever diverge,
    // the checker would call a slug safe that the renderer refuses to read.
    for (const prefix of RESERVED_PREFIXES) {
      expect(parseLocaleSlug(prefix).reserved).toBe(true)
      expect(parseLocaleSlug(`es/${prefix}`).reserved).toBe(true)
    }
  })
})

describe('slug format', () => {
  it.each([
    ['', 'empty'],
    ['Permanent Jewelry', 'format'],
    ['permanent_jewelry', 'format'],
    ['-leading', 'format'],
    ['trailing-', 'format'],
    ['double--hyphen', 'format'],
    ['../etc/passwd', 'format'],
    ['has space', 'format'],
    ['UPPER', 'format'],
    ['a//b', 'format'],
    ['emoji-🎉', 'format'],
  ])('refuses %j', (slug, code) => {
    const r = checkSlug(slug, 'en')
    expect(r.ok).toBe(false)
    expect(r.code).toBe(code)
  })

  it('refuses an over-long slug', () => {
    const r = checkSlug('a'.repeat(MAX_SLUG_CHARS + 1), 'en')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('too_long')
  })

  it('refuses too many path segments', () => {
    const deep = Array.from({ length: MAX_SLUG_SEGMENTS + 1 }, (_, i) => `seg${i}`).join('/')
    const r = checkSlug(deep, 'en')
    expect(r.ok).toBe(false)
    expect(r.code).toBe('too_deep')
  })

  it('accepts a two-segment slug under a non-reserved, non-static prefix', () => {
    expect(checkSlug('jewelry/southampton', 'en').ok).toBe(true)
  })
})

describe('dynamic route segments shadow too', () => {
  it('a slug under /events/ is owned by events/[slug]', () => {
    expect(isShadowedByStaticRoute('/events/summer-market')).toBe(true)
  })
  it('a slug under /mobile-craft-party/ is owned by [location]', () => {
    expect(isShadowedByStaticRoute('/mobile-craft-party/southampton')).toBe(true)
  })
  it('but a deeper path under one is not', () => {
    expect(isShadowedByStaticRoute('/events/summer-market/tickets')).toBe(false)
  })
  it('and an unrelated path is not', () => {
    expect(isShadowedByStaticRoute('/permanent-jewelry-southampton')).toBe(false)
  })
})

/**
 * THE TRIPWIRE.
 *
 * `STATIC_ROUTE_PATTERNS` is hand-maintained because a `next start` standalone
 * bundle cannot read `src/app`. A MISSING entry is the dangerous direction: the
 * checker would call a shadowed slug safe, an admin would publish it, and the
 * page would render nowhere while every surface said it was live. Extra entries
 * only make the checker more cautious, so this asserts one direction only.
 */
describe('STATIC_ROUTE_PATTERNS covers every real page route', () => {
  const APP_DIR = path.join(process.cwd(), 'src', 'app')

  function walk(dir: string, segs: string[], out: string[]): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name.startsWith('_')) continue
        const next =
          entry.name.startsWith('(') && entry.name.endsWith(')') ? segs : [...segs, entry.name]
        walk(path.join(dir, entry.name), next, out)
      } else if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) {
        out.push('/' + segs.join('/'))
      }
    }
    return out
  }

  it('no page route is missing from the list', () => {
    const onDisk = walk(APP_DIR, [], [])
      // The catch-all is the renderer itself; it never shadows anything.
      .filter(r => !r.includes('[...slug]'))
    const declared = new Set(STATIC_ROUTE_PATTERNS)
    const missing = onDisk.filter(r => !declared.has(r))
    expect(missing).toEqual([])
  })

  it('the API tree is covered by a catch-all entry', () => {
    expect(isShadowedByStaticRoute('/api/anything/at/all')).toBe(true)
  })
})
