import { MetadataRoute } from 'next'

// Pages that should never be indexed (flows, confirmations, admin, API).
const disallow = ['/api/', '/admin/', '/book/success', '/events/success', '/cm-cheer/order']

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
