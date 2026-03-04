import { NextResponse } from 'next/server'
import { getSupabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface SitemapEntry {
  url: string
  lastmod: string
  changefreq: string
  priority: number
}

export async function GET() {
  const base = 'https://www.hosthampton.com'
  const now = new Date().toISOString()

  const entries: SitemapEntry[] = [
    { url: base, lastmod: now, changefreq: 'weekly', priority: 1.0 },
    { url: `${base}/party-packages`, lastmod: now, changefreq: 'monthly', priority: 0.9 },
    { url: `${base}/glow-party`, lastmod: now, changefreq: 'monthly', priority: 0.9 },
    { url: `${base}/first-birthday-parties`, lastmod: now, changefreq: 'monthly', priority: 0.9 },
    { url: `${base}/book`, lastmod: now, changefreq: 'weekly', priority: 0.9 },
    { url: `${base}/party-room-rental`, lastmod: now, changefreq: 'monthly', priority: 0.8 },
    { url: `${base}/permanent-jewelry`, lastmod: now, changefreq: 'monthly', priority: 0.8 },
    { url: `${base}/communion-party`, lastmod: now, changefreq: 'monthly', priority: 0.8 },
    { url: `${base}/fundraiser`, lastmod: now, changefreq: 'weekly', priority: 0.8 },
    { url: `${base}/events`, lastmod: now, changefreq: 'weekly', priority: 0.8 },
    { url: `${base}/contact-us`, lastmod: now, changefreq: 'yearly', priority: 0.7 },
    { url: `${base}/cm-cheer`, lastmod: now, changefreq: 'monthly', priority: 0.6 },

    { url: `${base}/privacy-policy`, lastmod: now, changefreq: 'yearly', priority: 0.2 },
    { url: `${base}/terms-of-service`, lastmod: now, changefreq: 'yearly', priority: 0.2 },
    { url: `${base}/return-policy`, lastmod: now, changefreq: 'yearly', priority: 0.2 },
    { url: `${base}/mobile-party`, lastmod: now, changefreq: 'monthly', priority: 0.8 },
    { url: `${base}/custom-accessories`, lastmod: now, changefreq: 'monthly', priority: 0.8 },
    { url: `${base}/kids-party-menu`, lastmod: now, changefreq: 'monthly', priority: 0.9 },
    { url: `${base}/trucker-hat-bar`, lastmod: now, changefreq: 'monthly', priority: 0.7 },
  ]

  // Dynamic event pages
  try {
    const supabase = getSupabase()
    const { data: events } = await supabase
      .from('events')
      .select('slug, updated_at')
      .eq('is_active', true)

    if (events) {
      for (const e of events) {
        entries.push({
          url: `${base}/events/${e.slug}`,
          lastmod: new Date(e.updated_at).toISOString(),
          changefreq: 'weekly',
          priority: 0.7,
        })
      }
    }
  } catch {
    // Sitemap still works without dynamic events
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `<url>
<loc>${e.url}</loc>
<lastmod>${e.lastmod}</lastmod>
<changefreq>${e.changefreq}</changefreq>
<priority>${e.priority}</priority>
</url>`).join('\n')}
</urlset>`

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
