import { MetadataRoute } from 'next'
import { getSupabase } from '@/lib/supabase'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = 'https://www.hosthampton.com'
  const now = new Date()

  // Static pages
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, priority: 1.0, changeFrequency: 'weekly' },
    { url: `${base}/party-packages`, lastModified: now, priority: 0.9, changeFrequency: 'monthly' },
    { url: `${base}/glow-party`, lastModified: now, priority: 0.9, changeFrequency: 'monthly' },
    { url: `${base}/first-birthday-parties`, lastModified: now, priority: 0.9, changeFrequency: 'monthly' },
    { url: `${base}/party-room-rental`, lastModified: now, priority: 0.8, changeFrequency: 'monthly' },
    { url: `${base}/permanent-jewelry`, lastModified: now, priority: 0.8, changeFrequency: 'monthly' },
    { url: `${base}/party-add-ons`, lastModified: now, priority: 0.8, changeFrequency: 'monthly' },
    { url: `${base}/communion-party`, lastModified: now, priority: 0.8, changeFrequency: 'monthly' },
    { url: `${base}/fundraiser`, lastModified: now, priority: 0.8, changeFrequency: 'weekly' },
    { url: `${base}/book`, lastModified: now, priority: 0.9, changeFrequency: 'weekly' },
    { url: `${base}/events`, lastModified: now, priority: 0.8, changeFrequency: 'weekly' },
    { url: `${base}/cm-cheer`, lastModified: now, priority: 0.6, changeFrequency: 'monthly' },
    { url: `${base}/contact-us`, lastModified: now, priority: 0.7, changeFrequency: 'yearly' },
    { url: `${base}/party-contract`, lastModified: now, priority: 0.3, changeFrequency: 'yearly' },
    { url: `${base}/privacy-policy`, lastModified: now, priority: 0.2, changeFrequency: 'yearly' },
    { url: `${base}/terms-of-service`, lastModified: now, priority: 0.2, changeFrequency: 'yearly' },
    { url: `${base}/return-policy`, lastModified: now, priority: 0.2, changeFrequency: 'yearly' },
  ]

  // Dynamic event pages
  let eventRoutes: MetadataRoute.Sitemap = []
  try {
    const supabase = getSupabase()
    const { data: events } = await supabase
      .from('events')
      .select('slug, updated_at')
      .eq('is_active', true)

    if (events) {
      eventRoutes = events.map(e => ({
        url: `${base}/events/${e.slug}`,
        lastModified: new Date(e.updated_at),
        priority: 0.7,
        changeFrequency: 'weekly' as const,
      }))
    }
  } catch {
    // Sitemap should still work even if DB is unreachable
  }

  return [...staticRoutes, ...eventRoutes]
}
