import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const base = 'https://www.hosthampton.com'
  const now = new Date()

  const staticRoutes = [
    { url: base, priority: 1.0, changeFrequency: 'weekly' as const },
    { url: `${base}/party-packages`, priority: 0.9, changeFrequency: 'monthly' as const },
    { url: `${base}/party-add-ons`, priority: 0.8, changeFrequency: 'monthly' as const },
    { url: `${base}/party-room-rental`, priority: 0.8, changeFrequency: 'monthly' as const },
    { url: `${base}/permanent-jewelry`, priority: 0.8, changeFrequency: 'monthly' as const },
    { url: `${base}/first-birthday-parties`, priority: 0.9, changeFrequency: 'monthly' as const },
    { url: `${base}/communion-party`, priority: 0.8, changeFrequency: 'monthly' as const },
    { url: `${base}/fundraiser`, priority: 0.9, changeFrequency: 'weekly' as const },
    { url: `${base}/cm-cheer`, priority: 0.7, changeFrequency: 'monthly' as const },
    { url: `${base}/events`, priority: 0.7, changeFrequency: 'weekly' as const },
    { url: `${base}/contact-us`, priority: 0.7, changeFrequency: 'yearly' as const },
    { url: `${base}/book`, priority: 0.9, changeFrequency: 'weekly' as const },
    { url: `${base}/privacy-policy`, priority: 0.2, changeFrequency: 'yearly' as const },
    { url: `${base}/terms-of-service`, priority: 0.2, changeFrequency: 'yearly' as const },
    { url: `${base}/return-policy`, priority: 0.2, changeFrequency: 'yearly' as const },
    { url: `${base}/party-contract`, priority: 0.2, changeFrequency: 'yearly' as const },
  ]

  return staticRoutes.map(r => ({ ...r, lastModified: now }))
}
