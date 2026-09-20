/**
 * Link previews for the things we actually text people.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 *
 * The links Adam sends a customer are portal magic links —
 * `/api/portal/auth?ref=…&token=…`. That is a Route Handler that answers a 307.
 * A Route Handler cannot export `metadata`, so there is no HTML, no `og:` tag
 * and no image: in iMessage the link renders as a bare grey URL chip, and on
 * Android/WhatsApp as nothing at all. The customer is asked to tap a naked
 * `hosthampton.com/api/portal/auth?ref=HH-PTY-…&token=a0f0e005…`, which is also
 * the shape of every phishing link they have ever been warned about.
 *
 * ── Why not just let the bot follow the redirect ─────────────────────────────
 *
 * Two reasons, and the second is the serious one.
 *
 *   1. It lands on `/plan/<ref>/summary`, which is cookie-gated, so an
 *      unauthenticated fetch gets bounced to the login page — the preview would
 *      advertise "My Booking — Log in".
 *   2. The auth route SETS a portal cookie on that 307. A preview fetcher that
 *      keeps cookies across a redirect would then render the real invoice, and
 *      the customer's name and balance would be baked into a picture sitting in
 *      a Messages thread. Nothing here is willing to find out which fetchers do
 *      that.
 *
 * So a recognised preview fetcher is answered with a small, entirely generic
 * HTML document and is never given a cookie and never stamps `used_at`.
 * (`used_at` is the column that answers "has this customer opened their link";
 * a bot fetch stamping it would make that column lie the moment the text was
 * sent — the same dead-evidence failure rule 17 is named for.)
 *
 * ── The escape hatch is the load-bearing part ───────────────────────────────
 *
 * User-agent sniffing is a guess, and a WRONG guess here means a real customer
 * gets a page instead of being logged in. So the page a "bot" receives carries
 * a visible button to the same URL with `go=1`, which bypasses this check
 * entirely. A misdetected human is one tap from where they were going, and a
 * new fetcher we have never heard of simply gets today's behaviour — a plain
 * redirect, no preview — rather than a broken login.
 */

import { escapeHtml } from '@/lib/escapeHtml'

/**
 * User-agent fragments belonging to link-preview fetchers, lowercased.
 *
 * `facebookexternalhit` is first because it is the one that matters most:
 * **Apple Messages uses it.** iMessage's preview fetcher identifies as
 * `facebookexternalhit/1.1 Facebot Twitterbot/1.0`, so the Facebook and Twitter
 * names are what unlock iOS previews, not any Apple string.
 *
 * Every entry is a crawler that renders a CARD. Deliberately NOT here: search
 * crawlers (Googlebot, Bingbot) — they should keep getting the redirect and the
 * `noindex` behind it, because this route must never become a page that a
 * search engine holds a copy of.
 */
export const LINK_PREVIEW_AGENTS = [
  'facebookexternalhit',
  'facebot',
  'twitterbot',
  'applebot',
  'whatsapp',
  'slackbot',
  'slack-imgproxy',
  'discordbot',
  'telegrambot',
  'linkedinbot',
  'skypeuripreview',
  'redditbot',
  'pinterest',
  'embedly',
  'iframely',
  'quora link preview',
  'nuzzel',
  'vkshare',
  'outlook-ios',
  'google-pagerenderer',
  'developers.google.com/+/web/snippet',
] as const

/** Does this user-agent belong to something drawing a preview card? */
export function isLinkPreviewBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  const ua = userAgent.toLowerCase()
  return LINK_PREVIEW_AGENTS.some(frag => ua.includes(frag))
}

/**
 * The query parameter that says "I am a human, skip the sniffing".
 *
 * Present on the button in the preview page below, so a misdetected customer
 * is one tap from the real flow.
 */
export const PREVIEW_BYPASS_PARAM = 'go'

export function wantsPreviewBypass(value: string | null | undefined): boolean {
  return value === '1'
}

export interface PreviewCardOptions {
  /** Absolute origin, from `publicOrigin(req)` — never a raw forwarded host. */
  origin: string
  title: string
  description: string
  /** Where the visible button goes. Already-escaped-on-output. */
  continueUrl: string
}

/**
 * A complete, generic OG document.
 *
 * **It must never carry customer data.** Not a name, not a booking ref, not a
 * total — a preview card is a picture that sits in a message thread, gets
 * screenshotted, and is rendered by a third party's server. The title and
 * description arguments are supplied by the caller from CONSTANTS, never from
 * a row; the escaping below is the belt to that braces.
 */
export function previewCardHtml(opts: PreviewCardOptions): string {
  const { origin, title, description, continueUrl } = opts
  const image = `${origin}/images/og-default.png`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="noindex, nofollow">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Host Hampton">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Host Hampton — Boutique Celebration Studio in Speonk, NY">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       background:#2F343B;color:#F7F2E8;font-family:Montserrat,system-ui,sans-serif;text-align:center;padding:32px}
  .b{max-width:520px}
  h1{font-family:'Playfair Display',Georgia,serif;font-weight:400;font-size:28px;margin:0 0 12px}
  p{color:rgba(247,242,232,0.72);line-height:1.7;margin:0 0 28px;font-size:15px}
  a{display:inline-block;background:#F7F2E8;color:#2F343B;text-decoration:none;
    padding:14px 38px;border-radius:50px;font-weight:600;font-size:15px}
</style>
</head>
<body>
  <div class="b">
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(description)}</p>
    <a href="${escapeHtml(continueUrl)}">Open my booking</a>
  </div>
</body>
</html>`
}
