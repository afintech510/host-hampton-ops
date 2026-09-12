import { MetadataRoute } from 'next'

/**
 * Paths we do not want crawled at all.
 *
 * Deliberately SHORT. A `Disallow` stops a URL being fetched, which means the
 * `noindex` on the page is never read — so a disallowed URL can still be listed
 * from an inbound link, with no snippet and no way to remove it. Anything that
 * must stay OUT of the index says so on the page instead (`NOINDEX` in
 * lib/seo.ts): the customer portal, /plan, /review, /checkin, the confirmation
 * pages and the internal tools all carry a robots meta tag.
 *
 * `/admin` is listed WITHOUT the trailing slash as well: `/admin/` does not
 * match `/admin` itself, which returns 200.
 */
const disallow = ['/api/', '/admin', '/admin/', '/cm-cheer/order']

// AI answer-engine crawlers we explicitly welcome — we WANT ChatGPT, Claude,
// Perplexity, Google's AI Overviews, etc. to read and cite Host Hampton when
// people ask them about party venues on the East End.
const aiCrawlers = [
  'GPTBot',            // OpenAI / ChatGPT
  'OAI-SearchBot',     // OpenAI search
  'ChatGPT-User',      // ChatGPT browsing on a user's behalf
  'ClaudeBot',         // Anthropic / Claude
  'Claude-Web',        // Anthropic web fetch
  'anthropic-ai',      // Anthropic crawler
  'PerplexityBot',     // Perplexity
  'Perplexity-User',   // Perplexity browsing on a user's behalf
  'Google-Extended',   // Google Gemini / AI Overviews training + grounding
  'Applebot-Extended', // Apple Intelligence
  'CCBot',             // Common Crawl (feeds many models)
  'Bytespider',        // TikTok / ByteDance
  'Amazonbot',         // Amazon / Alexa
  'cohere-ai',         // Cohere
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Everyone (search engines + anything unlisted)
      { userAgent: '*', allow: '/', disallow },
      // AI crawlers — same access, listed explicitly so it's unambiguous we allow them
      { userAgent: aiCrawlers, allow: '/', disallow },
    ],
    sitemap: 'https://www.hosthampton.com/sitemap.xml',
    host: 'https://www.hosthampton.com',
  }
}
