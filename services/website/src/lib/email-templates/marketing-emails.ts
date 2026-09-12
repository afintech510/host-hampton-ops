/**
 * MEASURED 2026-09-12: **nothing imports this file.** All five templates below
 * are unreached — no route, no cron, no library references
 * `email-templates/marketing-emails`. They are screened anyway, because a
 * template that is safe only while unused is a trap for whoever wires it up,
 * and the wiring is a one-line import.
 *
 * Also unreached and therefore not "working": the CAN-SPAM footer's unsubscribe
 * href is the literal `{{unsubscribe_url}}`, which is OUR sequencer's token
 * name, not Brevo's. `docs/phase-4-campaign-automation.md` records the same bug
 * being fixed in the newsletter template (Brevo wants `{{ unsubscribe }}`); this
 * copy was missed because nothing sends it.
 *
 * ESCAPING CONVENTION IN THIS FILE. The exported templates escape their params
 * at ENTRY, before the defaults are destructured. That order is load-bearing:
 * the default `useCases` / `sessionTypes` arrays are hand-written strings that
 * already contain HTML entities (`Baby showers &amp; bridal showers`), so
 * escaping after defaulting would print `&amp;amp;` to a customer. The internal
 * helpers (`marketingHeader`, `ctaButton`, `marketingWrapper`) therefore receive
 * values that are ALREADY escaped or trusted, and must not escape again.
 */

import { escapeHtml } from '@/lib/escapeHtml'
import { escapeFields, mailHref } from '@/lib/emailSafety'
import { safeImageUrl } from '@/lib/content/contentSafety'

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

/* ── Shared layout helpers ────────────────────────────────────── */

function marketingHeader(headline: string, subline: string): string {
  return `
  <div style="background:${BRAND.headerBg};padding:40px 40px 32px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 8px;font-weight:normal;line-height:1.35;">${headline}</h1>
    <p style="color:${BRAND.navy};opacity:0.75;font-size:15px;margin:0;">${subline}</p>
  </div>`
}

function ctaButton(label: string, url: string): string {
  const href = mailHref(url)
  if (!href) return ''
  return `<div style="text-align:center;margin:24px 0 8px;">
    <a href="${href}" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:14px 36px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;letter-spacing:0.5px;">${label}</a>
  </div>`
}

function canSpamFooter(): string {
  return `
  <div style="background:${BRAND.footerBg};padding:24px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:13px;margin:0 0 6px;font-weight:bold;">Host Hampton</p>
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 &middot; Speonk, NY 11972</p>
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">(631) 998-9325 &middot; <a href="https://www.instagram.com/hosthampton" style="color:${BRAND.navy};">@hosthampton</a></p>
    <p style="color:${BRAND.navy};opacity:0.6;font-size:11px;margin:12px 0 0;">
      You&rsquo;re receiving this because you signed up for Host Hampton updates.<br>
      <a href="{{unsubscribe_url}}" style="color:${BRAND.navy};text-decoration:underline;">Unsubscribe</a> &middot; 295 Montauk Highway, Suite 7, Speonk, NY 11972
    </p>
  </div>`
}

function marketingWrapper(body: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#ffffff;">
  ${body}
  ${canSpamFooter()}
</div>
</body></html>`
}

/* ── a) Party Theme Spotlight ─────────────────────────────────── */

export interface MarketingPartiesParams {
  themeName: string
  themeDescription: string
  imageUrl?: string
  availabilityNote?: string
  promoText?: string
}

export function marketingPartiesHtml(params: MarketingPartiesParams): string {
  const { themeName, themeDescription, availabilityNote, promoText } = escapeFields(params)
  // The image URL is SCREENED, not escaped, and so comes off the raw params —
  // an HTML-escaped URL is no longer a URL a parser recognises (rule 4).
  const imageUrl = safeImageUrl(params.imageUrl)

  const heroBlock = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${themeName}" width="100%" style="display:block;width:100%;height:280px;object-fit:cover;">`
    : `<div style="background:${BRAND.headerBg};height:180px;text-align:center;display:table;width:100%;"><div style="display:table-cell;vertical-align:middle;"><p style="color:${BRAND.navy};font-size:13px;letter-spacing:2px;text-transform:uppercase;margin:0;opacity:0.6;">Host Hampton</p></div></div>`

  const availBlock = availabilityNote
    ? `<div style="background:#e6f0e8;border-radius:10px;padding:16px 20px;margin-bottom:20px;border:1px solid #b8d4bc;">
        <p style="margin:0;font-size:14px;color:#1a5c2a;">&#128197; ${availabilityNote}</p>
      </div>`
    : ''

  const promoBlock = promoText
    ? `<div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 16px;margin-bottom:20px;">
        <p style="margin:0;font-size:14px;color:#92400e;"><strong>Limited-time offer:</strong> ${promoText}</p>
      </div>`
    : ''

  const body = `
  ${heroBlock}
  ${marketingHeader(`${themeName} Party Theme`, 'Boutique children&rsquo;s parties in Speonk, NY')}
  <div style="padding:36px 40px 28px;">
    <p style="color:${BRAND.gray};font-size:15px;line-height:1.75;margin:0 0 24px;">${themeDescription}</p>
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:15px;color:${BRAND.navy};margin:0 0 14px;font-weight:bold;">What&rsquo;s Included</h2>
        <ul style="margin:0;padding-left:20px;color:${BRAND.gray};font-size:14px;line-height:2.1;">
          <li>2-hour private party room</li>
          <li>Theme-coordinated decor &amp; setup</li>
          <li>Party coordinator on-site</li>
          <li>Custom digital EVITE invitation</li>
          <li>Up to 15 children included</li>
        </ul>
      </div>
    </div>
    ${availBlock}${promoBlock}
    ${ctaButton('Book Your Party', 'https://www.hosthampton.com/party-packages')}
    <p style="text-align:center;color:${BRAND.gray};font-size:13px;margin:12px 0 0;">Starting at $249 &middot; Deposit reserves your date</p>
  </div>`

  return marketingWrapper(body)
}

/* ── b) Room Rental Promo ─────────────────────────────────────── */

export interface MarketingRentalsParams {
  useCases?: string[]
  pricingNote?: string
}

export function marketingRentalsHtml(params: MarketingRentalsParams = {}): string {
  const {
    useCases = [
      'Baby showers &amp; bridal showers',
      'Corporate events &amp; team celebrations',
      'Milestone birthday parties (adults)',
      'Pop-up boutiques &amp; photo shoots',
      'Dance recital after-parties',
      'Holiday gatherings &amp; reunions',
    ],
    pricingNote,
  } = escapeFields(params)

  const useCaseItems = useCases.map(u => `<li style="padding:5px 0;">${u}</li>`).join('')

  const pricingBlock = pricingNote
    ? `<div style="background:#e6f0e8;border-radius:10px;padding:16px 20px;margin-bottom:20px;border:1px solid #b8d4bc;">
        <p style="margin:0;font-size:14px;color:#1a5c2a;">&#128179; ${pricingNote}</p>
      </div>`
    : ''

  const body = `
  ${marketingHeader('Rent Our Beautiful Studio', 'Your event. Your vision. Our space.')}
  <div style="padding:36px 40px 28px;">
    <p style="color:${BRAND.gray};font-size:15px;line-height:1.75;margin:0 0 24px;">
      Host Hampton&rsquo;s boutique studio is available for private rental. Bring your own vendors, decorators, and ideas &mdash; we provide the perfect backdrop for any celebration.
    </p>
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:15px;color:${BRAND.navy};margin:0 0 14px;font-weight:bold;">Perfect For</h2>
        <ul style="margin:0;padding-left:20px;color:${BRAND.gray};font-size:14px;line-height:1.5;">
          ${useCaseItems}
        </ul>
      </div>
    </div>
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 12px;">The Space Includes</h3>
      <table style="width:100%;font-size:13px;color:${BRAND.gray};">
        <tr><td style="padding:4px 0;vertical-align:top;width:20px;">&#10003;</td><td style="padding:4px 0;">Fully decorated &amp; climate-controlled interior</td></tr>
        <tr><td style="padding:4px 0;vertical-align:top;">&#10003;</td><td style="padding:4px 0;">Tables, chairs &amp; basic linen setup</td></tr>
        <tr><td style="padding:4px 0;vertical-align:top;">&#10003;</td><td style="padding:4px 0;">Bluetooth speaker system</td></tr>
        <tr><td style="padding:4px 0;vertical-align:top;">&#10003;</td><td style="padding:4px 0;">Private parking &amp; street-level access</td></tr>
        <tr><td style="padding:4px 0;vertical-align:top;">&#10003;</td><td style="padding:4px 0;">BYO catering &amp; alcohol (with permit)</td></tr>
      </table>
    </div>
    ${pricingBlock}
    ${ctaButton('See Availability', 'https://www.hosthampton.com/book?type=room-rental')}
    <p style="text-align:center;color:${BRAND.gray};font-size:13px;margin:12px 0 0;">4-hour minimum &middot; Hourly rates available &middot; Book online in minutes</p>
  </div>`

  return marketingWrapper(body)
}

/* ── c) Permanent Jewelry Promo ───────────────────────────────── */

export interface MarketingJewelryParams {
  sessionTypes?: string[]
}

export function marketingJewelryHtml(params: MarketingJewelryParams = {}): string {
  const {
    sessionTypes = [
      'Permanent anklet or bracelet (14k gold-filled)',
      'Layered chain sets',
      'Charm additions to existing jewelry',
      'Mother-daughter duo sessions',
      'Party add-on for birthday groups',
    ],
  } = escapeFields(params)

  const sessionItems = sessionTypes.map(s => `<li style="padding:5px 0;">${s}</li>`).join('')

  const body = `
  ${marketingHeader('Permanent Jewelry &amp; Accessories', 'Welded-on, clasp-free &mdash; yours forever.')}
  <div style="padding:36px 40px 28px;">
    <p style="color:${BRAND.gray};font-size:15px;line-height:1.75;margin:0 0 24px;">
      No clasp. No fuss. Just beautiful, dainty jewelry welded directly onto your wrist or ankle &mdash; made to wear forever (or until you cut it off for a milestone moment). Now available at Host Hampton in Speonk!
    </p>
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:15px;color:${BRAND.navy};margin:0 0 14px;font-weight:bold;">Session Options</h2>
        <ul style="margin:0;padding-left:20px;color:${BRAND.gray};font-size:14px;line-height:1.5;">
          ${sessionItems}
        </ul>
      </div>
    </div>
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 12px;">Why You&rsquo;ll Love It</h3>
      <table style="width:100%;font-size:13px;color:${BRAND.gray};">
        <tr><td style="padding:5px 0;vertical-align:top;width:20px;">&#10022;</td><td style="padding:5px 0;">Quick appointment &mdash; done in minutes</td></tr>
        <tr><td style="padding:5px 0;vertical-align:top;">&#10022;</td><td style="padding:5px 0;">14k gold-filled, sterling silver &amp; gold vermeil options</td></tr>
        <tr><td style="padding:5px 0;vertical-align:top;">&#10022;</td><td style="padding:5px 0;">Safe for swimming, showering &amp; everyday wear</td></tr>
        <tr><td style="padding:5px 0;vertical-align:top;">&#10022;</td><td style="padding:5px 0;">Perfect solo treat or group gift experience</td></tr>
      </table>
    </div>
    ${ctaButton('Book a Session', 'https://www.hosthampton.com/permanent-jewelry')}
    <p style="text-align:center;color:${BRAND.gray};font-size:13px;margin:12px 0 0;">Starting at $38 &middot; Walk-ins welcome when available</p>
  </div>`

  return marketingWrapper(body)
}

/* ── d) Workshop / Camp Event Spotlight ───────────────────────── */

export interface MarketingEventsParams {
  eventTitle: string
  eventDate: string
  eventDescription: string
  eventUrl: string
  spotsLeft?: number
}

export function marketingEventsHtml(params: MarketingEventsParams): string {
  const { eventTitle, eventDate, eventDescription, spotsLeft } = escapeFields(params)
  const eventUrl = params.eventUrl

  const urgencyBlock = spotsLeft !== undefined
    ? `<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:10px;padding:16px 20px;margin-bottom:20px;text-align:center;">
        <p style="margin:0;font-size:15px;color:#b91c1c;font-weight:bold;">Only ${spotsLeft} spot${spotsLeft === 1 ? '' : 's'} left!</p>
        <p style="margin:4px 0 0;font-size:13px;color:#b91c1c;">These fill up fast &mdash; don&rsquo;t miss out.</p>
      </div>`
    : ''

  const body = `
  ${marketingHeader(eventTitle, eventDate)}
  <div style="padding:36px 40px 28px;">
    <p style="color:${BRAND.gray};font-size:15px;line-height:1.75;margin:0 0 24px;">${eventDescription}</p>
    ${urgencyBlock}
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:15px;color:${BRAND.navy};margin:0 0 14px;font-weight:bold;">Event Details</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr>
            <td style="padding:8px 0;color:${BRAND.gray};width:100px;"><strong>Date</strong></td>
            <td style="padding:8px 0;color:${BRAND.gray};">${eventDate}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Location</strong></td>
            <td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">Host Hampton, 295 Montauk Hwy, Speonk NY</td>
          </tr>
        </table>
      </div>
    </div>
    ${ctaButton('Reserve Your Spot', eventUrl)}
    <p style="text-align:center;color:${BRAND.gray};font-size:13px;margin:12px 0 0;">Space is limited &mdash; secure your place today</p>
  </div>`

  return marketingWrapper(body)
}

/* ── e) Fundraiser / Community Program ────────────────────────── */

export interface MarketingCommunityParams {
  programName?: string
  ctaText?: string
}

export function marketingCommunityHtml(params: MarketingCommunityParams = {}): string {
  const {
    programName = 'Custom Merch Fundraising Program',
    ctaText = 'Learn More',
  } = escapeFields(params)

  const body = `
  ${marketingHeader(programName, 'Raise money for your organization &mdash; we handle the rest.')}
  <div style="padding:36px 40px 28px;">
    <p style="color:${BRAND.gray};font-size:15px;line-height:1.75;margin:0 0 24px;">
      Host Hampton partners with schools, sports teams, dance studios, and community groups to run custom merchandise fundraisers &mdash; at zero upfront cost to you.
    </p>
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:15px;color:${BRAND.navy};margin:0 0 16px;font-weight:bold;">How It Works</h2>
        <table style="width:100%;font-size:14px;color:${BRAND.gray};">
          <tr>
            <td style="padding:8px 0;vertical-align:top;width:28px;font-weight:bold;color:${BRAND.navy};font-size:16px;">1.</td>
            <td style="padding:8px 0;">We design a <strong>free digital mockup</strong> of your custom merchandise</td>
          </tr>
          <tr>
            <td style="padding:10px 0 8px;vertical-align:top;font-weight:bold;color:${BRAND.navy};font-size:16px;border-top:1px solid #f0ece7;">2.</td>
            <td style="padding:10px 0 8px;border-top:1px solid #f0ece7;">You share a <strong>custom ordering page</strong> with your community</td>
          </tr>
          <tr>
            <td style="padding:8px 0;vertical-align:top;font-weight:bold;color:${BRAND.navy};font-size:16px;border-top:1px solid #f0ece7;">3.</td>
            <td style="padding:8px 0;border-top:1px solid #f0ece7;">We handle <strong>production, delivery &amp; payment</strong> &mdash; you collect your profit</td>
          </tr>
        </table>
      </div>
    </div>
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 12px;">Great For</h3>
      <ul style="margin:0;padding-left:20px;color:${BRAND.gray};font-size:14px;line-height:2;">
        <li>Schools &amp; PTAs</li>
        <li>Youth sports teams &amp; travel leagues</li>
        <li>Dance studios &amp; cheer squads</li>
        <li>Faith groups &amp; community organizations</li>
      </ul>
    </div>
    <div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#92400e;"><strong>No upfront cost.</strong> Groups typically earn $3&ndash;$8 per item sold.</p>
    </div>
    ${ctaButton(ctaText, 'https://www.hosthampton.com/fundraiser')}
    <p style="text-align:center;color:${BRAND.gray};font-size:13px;margin:12px 0 0;">Questions? Reply to this email or call (631) 998-9325</p>
  </div>`

  return marketingWrapper(body)
}
