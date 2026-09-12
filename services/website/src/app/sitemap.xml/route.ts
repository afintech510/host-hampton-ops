import { getSupabase } from '@/lib/supabase'
import { LOCATIONS } from '@/lib/locations'
import { CRAFT_PARTIES } from '@/lib/craftParties'

const BASE = 'https://www.hosthampton.com'

// robots.ts advertises /sitemap.xml — this route handler fulfils it.
//
// NOTE: we use a Route Handler here (app/sitemap.xml/route.ts) rather than the
// Next metadata convention (app/sitemap.ts). The metadata convention generates
// an optional catch-all (/sitemap.xml[[...__metadata_id__]]) that collides with
// the existing human-readable /sitemap page route. The handler avoids that.
// Must render per-request: this route reads events + published content from
// Supabase, and those credentials do not exist at build time. Prerendering it
// (via `revalidate`) silently dropped every DB-driven URL from the sitemap —
// the try/catch below swallows the failure, so it fails quiet, not loud.
// Crawler load is handled by the Cache-Control header at the bottom instead,
// and the `lastmod` churn that actually hurt us is fixed by the constant below.
export const dynamic = 'force-dynamic'

/**
 * Stable `lastmod` for our hand-built pages.
 *
 * This was previously `new Date()` on every request, which told Google that every
 * URL changed on every fetch — the fastest way to make it ignore `lastmod`
 * entirely. Bump this date when page copy actually changes.
 */
const CONTENT_LAST_MODIFIED = '2026-09-12'

interface Entry {
  path: string
  changefreq: string
  priority: number
  lastmod?: string
}

const STATIC_ROUTES: Entry[] = [
  { path: '/', changefreq: 'weekly', priority: 1.0 },
  { path: '/party-packages', changefreq: 'weekly', priority: 0.9 },
  { path: '/mobile-party', changefreq: 'weekly', priority: 0.9 },
  { path: '/mobile-craft-party', changefreq: 'weekly', priority: 0.9 },
  { path: '/party-room-rental', changefreq: 'monthly', priority: 0.8 },
  { path: '/studio-rental', changefreq: 'monthly', priority: 0.8 },
  { path: '/kids-party-menu', changefreq: 'monthly', priority: 0.8 },
  { path: '/party-quote', changefreq: 'monthly', priority: 0.7 },
  { path: '/party-builder', changefreq: 'monthly', priority: 0.6 },
  { path: '/party-planner', changefreq: 'monthly', priority: 0.6 },
  { path: '/party-menu', changefreq: 'monthly', priority: 0.7 },
  { path: '/glow-party', changefreq: 'monthly', priority: 0.7 },
  { path: '/first-birthday-parties', changefreq: 'monthly', priority: 0.7 },
  { path: '/communion-party', changefreq: 'monthly', priority: 0.6 },
  { path: '/permanent-jewelry', changefreq: 'monthly', priority: 0.6 },
  { path: '/custom-accessories', changefreq: 'monthly', priority: 0.5 },
  { path: '/canvas-bags', changefreq: 'monthly', priority: 0.5 },
  { path: '/trucker-hat-bar', changefreq: 'monthly', priority: 0.5 },
  { path: '/fundraiser', changefreq: 'monthly', priority: 0.5 },
  { path: '/events', changefreq: 'weekly', priority: 0.7 },
  { path: '/gift-cards', changefreq: 'monthly', priority: 0.5 },
  { path: '/faq', changefreq: 'monthly', priority: 0.5 },
  { path: '/contact-us', changefreq: 'yearly', priority: 0.6 },
  { path: '/book', changefreq: 'monthly', priority: 0.8 },
  // Indexable lead-capture pages that were routable and crawlable but absent
  // from the sitemap. A sitemap that omits its own indexable pages is not
  // wrong so much as incomplete — these are the only two that were.
  { path: '/signup', changefreq: 'yearly', priority: 0.3 },
  { path: '/vendor-registration', changefreq: 'monthly', priority: 0.4 },
  { path: '/sitemap', changefreq: 'monthly', priority: 0.3 },
  { path: '/privacy-policy', changefreq: 'yearly', priority: 0.2 },
  { path: '/terms-of-service', changefreq: 'yearly', priority: 0.2 },
  { path: '/return-policy', changefreq: 'yearly', priority: 0.2 },
]

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function urlNode(e: Entry): string {
  const lastmod = e.lastmod ? `\n    <lastmod>${e.lastmod}</lastmod>` : ''
  return `  <url>\n    <loc>${xmlEscape(BASE + e.path)}</loc>${lastmod}\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority.toFixed(1)}</priority>\n  </url>`
}

export async function GET() {
  const entries: Entry[] = [...STATIC_ROUTES]

  // Mobile craft party location landing pages.
  for (const l of LOCATIONS) {
    entries.push({ path: `/mobile-craft-party/${l.slug}`, changefreq: 'monthly', priority: 0.7, lastmod: CONTENT_LAST_MODIFIED })
  }

  // Craft / theme landing pages (/slime-party, /spa-party, …).
  for (const c of CRAFT_PARTIES) {
    entries.push({ path: `/${c.slug}`, changefreq: 'monthly', priority: 0.8, lastmod: CONTENT_LAST_MODIFIED })
  }

  // DB-driven published content pages + active events (best-effort).
  //
  // "Best-effort" used to mean SILENT: a failed read dropped every DB URL and
  // served a sitemap that looked complete. Google would then see the event and
  // Spanish pages disappear and read that as "these are gone". It still serves
  // the static half rather than 500ing — a partial sitemap beats none — but a
  // failure now says so in the container log, because an absence reads exactly
  // like a fact (plan §18, the held draft that notified nobody).
  try {
    const supabase = getSupabase()

    const { data: content, error: contentError } = await supabase
      .from('website_content')
      .select('slug, locale, updated_at')
      .eq('status', 'published')
    if (contentError) console.error('[sitemap] website_content read failed:', contentError.message)
    for (const c of content || []) {
      const row = c as { slug: string; locale: string; updated_at: string | null }
      entries.push({
        path: row.locale === 'es' ? `/es/${row.slug}` : `/${row.slug}`,
        changefreq: 'monthly',
        priority: 0.6,
        lastmod: row.updated_at || CONTENT_LAST_MODIFIED,
      })
    }

    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select('slug, updated_at')
      .eq('is_active', true)
    if (eventsError) console.error('[sitemap] events read failed:', eventsError.message)
    for (const e of events || []) {
      const row = e as { slug: string; updated_at: string | null }
      entries.push({ path: `/events/${row.slug}`, changefreq: 'weekly', priority: 0.6, lastmod: row.updated_at || CONTENT_LAST_MODIFIED })
    }
  } catch (err) {
    // Sitemap still serves static + location entries if the DB is unreachable.
    console.error('[sitemap] DB section skipped:', err instanceof Error ? err.message : String(err))
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.map(urlNode).join('\n')}\n</urlset>`

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
