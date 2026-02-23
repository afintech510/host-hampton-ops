import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', '/admin/', '/book/success', '/events/success', '/cm-cheer/order'],
    },
    sitemap: 'https://www.hosthampton.com/sitemap.xml',
  }
}
