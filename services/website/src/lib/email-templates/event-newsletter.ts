import { escapeHtml } from '@/lib/escapeHtml'
import { safeImageUrl, safeSiteLink } from '@/lib/content/contentSafety'

/* ── Shared brand tokens (mirrors emailTemplates.ts) ─────────── */
const BRAND = {
  headerBg: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  footerBg: '#BCCDEB',
  bodyBg: '#F6F1EB',
  cardBorder: 'linear-gradient(135deg,#A1B5C8 0%,#E8C7CB 100%)',
  navy: '#1a2744',
  dustyBlue: '#A1B5C8',
  blush: '#E8C7CB',
  ivory: '#F6F1EB',
  mauve: '#C9A9A6',
  gray: '#555',
  ctaBg: '#1a2744',
  ctaText: '#F6F1EB',
} as const

/* ── Layout helpers ───────────────────────────────────────────── */

function newsletterHeader(preheader?: string): string {
  const preheaderSpan = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#F6F1EB;">${escapeHtml(preheader)}</div>`
    : ''
  return `${preheaderSpan}
  <div style="background:${BRAND.headerBg};padding:40px 40px 32px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:30px;margin:0 0 8px;font-weight:normal;line-height:1.3;">What&rsquo;s Coming Up<br>at Host Hampton</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">Events, workshops &amp; celebrations in Speonk</p>
  </div>`
}

/**
 * The unsubscribe link is Brevo's own merge tag, `{{ unsubscribe }}`.
 *
 * It used to be `{{unsubscribe_url}}` — a token name from OUR sequencer, which
 * Brevo has never heard of, so the href in every campaign this template has ever
 * produced was the literal seven-character string. (Brevo also appends its own
 * unsubscribe footer to a classic campaign, which is why nobody noticed; that is
 * the link that has actually been working.)
 */
function canSpamFooter(): string {
  return `
  <div style="background:${BRAND.footerBg};padding:24px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:13px;margin:0 0 6px;font-weight:bold;">Host Hampton</p>
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 &middot; Speonk, NY 11972</p>
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">(631) 998-9325 &middot; <a href="https://www.instagram.com/hosthampton" style="color:${BRAND.navy};">@hosthampton</a></p>
    <p style="color:${BRAND.navy};opacity:0.6;font-size:11px;margin:12px 0 0;">
      You&rsquo;re receiving this because you signed up for Host Hampton updates.<br>
      <a href="{{ unsubscribe }}" style="color:${BRAND.navy};text-decoration:underline;">Unsubscribe</a> &middot; 295 Montauk Highway, Suite 7, Speonk, NY 11972
    </p>
  </div>`
}

/* ── Event Card ───────────────────────────────────────────────── */

interface NewsletterEvent {
  title: string
  date: string
  time: string
  price: string
  imageUrl?: string
  ticketUrl: string
}

function eventCard(event: NewsletterEvent): string {
  // Every value here is a database string and this markup goes to 944 real
  // inboxes. A field is hostile because of who can WRITE it (hard-won rule 5),
  // and the URL fields get the SAME parsing screen the public pages use rather
  // than a second implementation of it (rule 11) — which is what let one
  // backslash through on the website (docs/content-pipeline.md §11.1).
  const img = safeImageUrl(event.imageUrl)
  const ticketUrl = safeSiteLink(event.ticketUrl) ?? 'https://www.hosthampton.com/events'
  const imageBlock = img
    ? `<img src="${escapeHtml(img.startsWith('/') ? `https://www.hosthampton.com${img}` : img)}" alt="${escapeHtml(event.title)}" width="100%" style="display:block;width:100%;height:auto;border-radius:10px 10px 0 0;">`
    : `<div style="background:${BRAND.headerBg};height:140px;border-radius:10px 10px 0 0;display:flex;align-items:center;justify-content:center;">
        <p style="color:${BRAND.navy};font-size:13px;letter-spacing:1px;text-transform:uppercase;margin:0;opacity:0.6;">Host Hampton</p>
      </div>`

  return `
  <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:20px;">
    <div style="background:white;border-radius:10px;overflow:hidden;">
      ${imageBlock}
      <div style="padding:20px 22px 24px;">
        <h3 style="color:${BRAND.navy};font-size:17px;margin:0 0 10px;font-weight:bold;line-height:1.3;">${escapeHtml(event.title)}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;">
          <tr>
            <td style="padding:4px 0;color:${BRAND.gray};width:16px;">&#128197;</td>
            <td style="padding:4px 0;color:${BRAND.gray};">${escapeHtml(event.date)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:${BRAND.gray};">&#128336;</td>
            <td style="padding:4px 0;color:${BRAND.gray};">${escapeHtml(event.time)}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:${BRAND.gray};">&#127915;</td>
            <td style="padding:4px 0;color:${BRAND.navy};font-weight:bold;">${escapeHtml(event.price)}</td>
          </tr>
        </table>
        <a href="${escapeHtml(ticketUrl)}" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:11px 28px;border-radius:50px;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:0.5px;">Get Tickets</a>
      </div>
    </div>
  </div>`
}

/* ── Event Newsletter ─────────────────────────────────────────── */

export interface EventNewsletterParams {
  events: NewsletterEvent[]
  preheader?: string
  intro?: string  // AI-generated intro paragraph (falls back to static copy)
}

export function eventNewsletterHtml(params: EventNewsletterParams): string {
  const { events, preheader, intro } = params

  // Pair events into rows for the two-column desktop grid.
  // Each row is a table with two 50%-wide cells. On mobile, Outlook-safe
  // single-column stacking is achieved via max-width on the outer wrapper —
  // true responsive requires a <style> tag which many clients strip, so we
  // fall back to a single-column layout at all widths for maximum
  // deliverability. For a richer two-column grid, callers can inject a
  // <style> block ahead of this HTML.
  const cards = events.map(eventCard).join('')

  const noEventsBlock = events.length === 0
    ? `<p style="color:${BRAND.gray};text-align:center;padding:32px 0;font-size:15px;">No upcoming events at the moment — check back soon!</p>`
    : ''

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>What&rsquo;s Coming Up at Host Hampton</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#ffffff;">
  ${newsletterHeader(preheader)}
  <div style="padding:36px 32px 24px;">
    <p style="color:${BRAND.gray};font-size:15px;line-height:1.7;margin:0 0 28px;text-align:center;">
      ${intro ? escapeHtml(intro) : 'Reserve your spot for upcoming workshops, parties &amp; pop-ups at Host Hampton&rsquo;s boutique celebration studio in Speonk, NY.'}
    </p>
    ${noEventsBlock}${cards}
    <div style="text-align:center;padding:16px 0 8px;">
      <a href="https://www.hosthampton.com/events" style="display:inline-block;background:transparent;color:${BRAND.navy};padding:12px 32px;border-radius:50px;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:0.5px;border:2px solid ${BRAND.navy};">View All Events</a>
    </div>
  </div>
  <div style="background:#f0ece7;padding:24px 32px;margin:0 0 0;">
    <p style="color:${BRAND.navy};font-size:14px;font-weight:bold;margin:0 0 8px;text-align:center;">Follow along for behind-the-scenes &amp; last-minute spots</p>
    <p style="text-align:center;margin:0;">
      <a href="https://www.instagram.com/hosthampton" style="display:inline-block;background:${BRAND.navy};color:#ffffff;padding:10px 24px;border-radius:50px;text-decoration:none;font-size:13px;font-weight:bold;">@hosthampton on Instagram</a>
    </p>
  </div>
  ${canSpamFooter()}
</div>
</body></html>`
}
