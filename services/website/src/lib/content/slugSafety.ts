/**
 * Is this `website_content` slug a URL we can actually serve?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS. Publishing a row CREATES A URL, and there are three ways for
 * that URL to be worthless or worse, none of which announce themselves:
 *
 *  1. **A static route shadows it.** `app/[...slug]` is a catch-all, and Next
 *     gives a static segment precedence over a catch-all. All four English
 *     drafts sitting in the table today (`first-birthday-parties`,
 *     `communion-party`, `fundraiser`, `cm-cheer`) have a hand-built
 *     `app/<slug>/page.tsx`. Publish one and the graph says `published`, the
 *     ledger records it, the admin panel shows a green badge and the sitemap
 *     lists the URL — and a visitor sees the static page. The row renders
 *     NOWHERE. Nothing in the system says so.
 *  2. **A reserved prefix blocks it.** `parseLocaleSlug` refuses `admin`,
 *     `api`, `book`, … before it reads the DB, so the page 404s.
 *  3. **The slug is not a slug.** An LLM writes this field. `Permanent Jewelry
 *     in Southampton, NY` round-trips through a URL as
 *     `/Permanent%20Jewelry%20in%20Southampton,%20NY`.
 *
 * All three are decided by the SAME data the renderer uses, so they can be
 * decided BEFORE the money is spent (`createTownServiceDraft` checks the slug
 * before it calls Claude), before the publish (the admin route refuses), and
 * shown to the reviewer in the panel.
 *
 * Rule 10: a guardrail that stops something must say that it stopped it — every
 * refusal here carries a `code` and a sentence a human can act on.
 */

import { RESERVED_PREFIXES, type Locale } from '@/lib/content/slug'

/**
 * Every App Router page route that is NOT the `[...slug]` catch-all, as a
 * pattern. `[x]` matches one segment, `[...x]` matches the rest.
 *
 * This is a hand-maintained constant because the filesystem is not readable
 * from a `next start` standalone bundle — but it is NOT trusted: a test walks
 * `src/app` and fails if a real page route is missing from this list, which is
 * the only direction that is dangerous (a missing entry means the checker calls
 * a shadowed slug safe). Extra entries only make the checker more cautious.
 */
export const STATIC_ROUTE_PATTERNS: readonly string[] = [
  '/',
  '/admin',
  '/admin/events',
  '/admin/lead/[ref]',
  '/arts-and-crafts-party',
  '/balloon-dog-painting-party',
  '/boggle',
  '/book',
  '/book/success',
  '/canvas-bags',
  '/canvas-tote-activation',
  '/checkin/[token]',
  '/classes',
  '/cm-cheer',
  '/cm-cheer/order',
  '/cm-cheer/orders',
  '/communion-party',
  '/contact-us',
  '/cora',
  '/custom-accessories',
  '/events',
  '/events/[slug]',
  '/events/success',
  '/faq',
  '/first-birthday-parties',
  '/fundraiser',
  '/gift-cards',
  '/gift-cards/success',
  '/glow-party',
  '/halloween-craft-party',
  '/kids-party-menu',
  '/kids-party-menu/success',
  '/kids-party-menu/summary',
  '/li-high',
  '/mermaid-party',
  '/mobile-craft-party',
  '/mobile-craft-party/[location]',
  '/mobile-party',
  '/my-booking',
  '/my-booking/login',
  '/my-booking/pay',
  '/paint-party',
  '/party-add-ons',
  '/party-builder',
  '/party-menu',
  '/party-packages',
  '/party-planner',
  '/party-quote',
  '/party-room-rental',
  '/permanent-jewelry',
  '/plan/[ref]/summary',
  '/privacy-policy',
  '/return-policy',
  '/review/[token]',
  '/shower-venue',
  '/signup',
  '/signup-sheet',
  '/sitemap',
  '/sitemap.xml',
  '/slime-party',
  '/spa-party',
  '/squishy-party',
  '/studio-rental',
  '/terms-of-service',
  '/toddler-party',
  '/trucker-hat-bar',
  '/vendor-registration',
  '/vendor-registration/success',
  // Not pages, but paths Next / the CDN own.
  '/api/[...rest]',
  '/robots.txt',
  '/favicon.ico',
  '/_next/[...rest]',
]

/** Longest slug we will accept, in characters. Keeps a URL readable + loggable. */
export const MAX_SLUG_CHARS = 80
/** A landing page is one or two segments. Deeper is a mistake, not a plan. */
export const MAX_SLUG_SEGMENTS = 2

export type SlugIssueCode =
  | 'empty'
  | 'format'
  | 'too_long'
  | 'too_deep'
  | 'reserved'
  | 'shadowed'

export interface SlugCheck {
  ok: boolean
  /** The URL path this row will be served from, e.g. `/es/party-room-rental`. */
  path: string
  code?: SlugIssueCode
  /** One sentence, written for whoever has to fix it. */
  message?: string
}

/** Does `path` match a route pattern with `[x]` / `[...x]` segments? */
function matchesPattern(pattern: string, path: string): boolean {
  const pSegs = pattern.split('/').filter(Boolean)
  const tSegs = path.split('/').filter(Boolean)
  for (let i = 0; i < pSegs.length; i++) {
    const p = pSegs[i]
    if (p.startsWith('[...')) return tSegs.length > i // catch-all eats the rest
    if (i >= tSegs.length) return false
    if (p.startsWith('[')) continue // one dynamic segment matches anything
    if (p !== tSegs[i]) return false
  }
  return tSegs.length === pSegs.length
}

/** True if a real Next route already owns this URL path. */
export function isShadowedByStaticRoute(path: string): boolean {
  return STATIC_ROUTE_PATTERNS.some(p => matchesPattern(p, path))
}

/**
 * The URL a (slug, locale) pair is served from. English keeps the bare slug;
 * Spanish lives under `/es/`, which is itself the reason a Spanish row is never
 * shadowed — no static route starts with an `es` segment, so the catch-all
 * always wins there. That is why `/es/party-room-rental` (the one published row
 * in the table) renders while an English row of the same slug would not.
 */
export function contentPath(slug: string, locale: Locale): string {
  return locale === 'es' ? `/es/${slug}` : `/${slug}`
}

/**
 * Full pre-flight for a content slug. Called before spending on a draft, before
 * publishing, and by the admin panel to badge a row.
 */
export function checkSlug(rawSlug: string, locale: Locale): SlugCheck {
  const slug = (rawSlug || '').trim()
  const path = contentPath(slug, locale)

  if (!slug) {
    return { ok: false, path, code: 'empty', message: 'Slug is empty — there is no URL to serve this from.' }
  }
  if (slug.length > MAX_SLUG_CHARS) {
    return {
      ok: false,
      path,
      code: 'too_long',
      message: `Slug is ${slug.length} characters; the limit is ${MAX_SLUG_CHARS}.`,
    }
  }
  // Lowercase letters, digits and hyphens, in `/`-joined segments. No leading or
  // trailing hyphen, no empty segment, no `.` or `..`, no escaping.
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(slug)) {
    return {
      ok: false,
      path,
      code: 'format',
      message:
        `"${slug}" is not a URL slug — use lowercase letters, digits and single hyphens ` +
        `(e.g. permanent-jewelry-southampton).`,
    }
  }
  const segments = slug.split('/')
  if (segments.length > MAX_SLUG_SEGMENTS) {
    return {
      ok: false,
      path,
      code: 'too_deep',
      message: `Slug has ${segments.length} path segments; the limit is ${MAX_SLUG_SEGMENTS}.`,
    }
  }
  // Reserved check mirrors parseLocaleSlug exactly (it runs on the base slug,
  // after the locale prefix is stripped) — imported, not restated (rule 11).
  if (RESERVED_PREFIXES.has(segments[0])) {
    return {
      ok: false,
      path,
      code: 'reserved',
      message: `"${segments[0]}" is a reserved path prefix — the renderer refuses it before it reads the database, so this page would 404.`,
    }
  }
  if (isShadowedByStaticRoute(path)) {
    return {
      ok: false,
      path,
      code: 'shadowed',
      message:
        `${path} is already a hand-built page in the site. Next gives a static route precedence over the ` +
        `catch-all renderer, so publishing this row would change nothing a visitor sees — it would just add ` +
        `a second entry for that URL to the sitemap. Choose a different slug.`,
    }
  }

  return { ok: true, path }
}
