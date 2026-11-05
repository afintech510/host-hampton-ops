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
/**
 * `/r/` is Phase 5's tracked-link redirect. Those URLs only ever appear inside
 * an email, so no crawler should reach one — but a `Disallow` is cheap
 * insurance, because a bot that follows one records a click event against a
 * real person's A/B assignment. Fabricated signal is worse than none, and a
 * crawler's click is exactly that.
 */
const disallow = ['/api/', '/admin', '/admin/', '/cm-cheer/order', '/r/']

// AI answer-engine crawlers we explicitly welcome — we WANT ChatGPT, Claude,
// Perplexity, Google's AI Overviews, etc. to read and cite Host Hampton when
// people ask them about kids parties anywhere on Long Island. ChatGPT is a
// measured lead channel (utm_source=chatgpt.com on /spa-party,
// /arts-and-crafts-party and /mobile-party, Nassau included).
//
// THIS FILE CAN BE OVERRIDDEN AT THE EDGE. Cloudflare's "Managed robots.txt"
// prepends its own block that Disallows GPTBot, ClaudeBot, Google-Extended and
// more, and its "Block AI bots" rule 403s them outright. Both were on until
// 2026-11-04, when Adam chose to let training crawlers in too, and were
// switched off (zone bot_management: ai_bots_protection, ai_training,
// is_robots_txt_managed). Measure with a UA sweep, never by reading this file.
const aiCrawlers = [
  'GPTBot',               // OpenAI training crawler
  'OAI-SearchBot',        // ChatGPT search index — what produces citations
  'ChatGPT-User',         // ChatGPT browsing on a user's behalf
  'ClaudeBot',            // Anthropic training crawler
  'Claude-SearchBot',     // Claude search index
  'Claude-User',          // Claude fetching on a user's behalf
  'Claude-Web',           // Anthropic (legacy name)
  'anthropic-ai',         // Anthropic (legacy name)
  'PerplexityBot',        // Perplexity index
  'Perplexity-User',      // Perplexity browsing on a user's behalf
  'Google-Extended',      // Gemini apps grounding + training (not AI Overviews — that is Googlebot)
  'Applebot',             // Siri / Spotlight / Apple search
  'Applebot-Extended',    // Apple Intelligence
  'Meta-ExternalAgent',   // Meta AI
  'Meta-ExternalFetcher', // Meta AI fetching on a user's behalf
  'DuckAssistBot',        // DuckDuckGo AI answers
  'MistralAI-User',       // Mistral Le Chat fetching on a user's behalf
  'YouBot',               // You.com
  'CCBot',                // Common Crawl (feeds many models)
  'Bytespider',           // TikTok / ByteDance
  'Amazonbot',            // Amazon / Alexa
  'cohere-ai',            // Cohere
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
