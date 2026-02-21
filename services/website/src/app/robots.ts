import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/api/', '/book/success'] },
    sitemap: 'https://www.hosthampton.com/sitemap.xml',
  }
}
