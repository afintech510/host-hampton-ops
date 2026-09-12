import { escapeFields, mailHref, mailHrefExternal, mailToHref, telHref } from '@/lib/emailSafety'

/**
 * NOTE for whoever is next. Most templates in this file interpolate
 * `customerName`, `childName` and friends into HTML unescaped. Those all send to
 * the customer who typed the value, so the blast radius is their own inbox — but
 * it is not nothing, and `partyAdminUnpaidDayOfHtml` renders customer-written
 * name and phone into the OWNER's inbox, which does cross a trust boundary.
 *
 * The four reminder templates below (balance, admin day-of alert, thank-you,
 * birthday rebook) are escaped, because the reminder engine that sends them was
 * dead until 2026-09-12 and this review is what brought it to life. The rest of
 * the file is a pre-existing gap recorded in `docs/reminder-engine-review.md`
 * rather than rewritten here — they are live revenue-path emails and this was a
 * cron review, not a template rewrite.
 */

/* ── Shared brand tokens for all email templates ──────────────── */
const BRAND = {
  headerBg: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  headerBgAdmin: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  footerBg: '#BCCDEB',
  bodyBg: '#F6F1EB',
  cardBorder: 'linear-gradient(135deg,#A1B5C8 0%,#E8C7CB 100%)',
  navy: '#1a2744',
  ivory: '#F6F1EB',
  gray: '#555',
  ctaBg: '#1a2744',
  ctaText: '#F6F1EB',
} as const

const contactBlock = `
      <strong><a href="tel:6319989325" style="color:${BRAND.navy};text-decoration:none;">📞 (631) 998-9325</a></strong> &nbsp;·&nbsp;
      <strong><a href="sms:6319989325" style="color:${BRAND.navy};text-decoration:none;">💬 Text Us</a></strong><br>
      <strong><a href="mailto:hosthampton295@gmail.com" style="color:${BRAND.navy};text-decoration:none;">✉️ hosthampton295@gmail.com</a></strong>`

const footer = `
  <div style="background:${BRAND.footerBg};padding:20px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 · Speonk, NY 11972</p>
  </div>`

const footerTagline = (tagline: string) => `
  <div style="background:${BRAND.footerBg};padding:20px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 · Speonk, NY 11972</p>
    <p style="color:${BRAND.navy};opacity:0.5;font-size:11px;margin:0;">${tagline}</p>
  </div>`

/* ── Ticket Confirmation (customer) ───────────────────────────── */

interface TicketConfirmationData {
  customerName: string
  eventTitle: string
  eventDate: string
  eventTime: string
  location: string
  quantity: number
  variantLabel?: string
  totalFormatted: string
  ticketRef: string
  isFree: boolean
  sessions?: { date: string; time: string; label?: string }[]
}

export function ticketConfirmationHtml(raw: TicketConfirmationData): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  const variantLine = d.variantLabel
    ? `<tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Option</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.variantLabel}</td></tr>`
    : ''
  const priceLine = d.isFree
    ? '<span style="font-weight:bold;color:#059669;">FREE</span>'
    : `<span style="font-weight:bold;color:#059669;">${d.totalFormatted} ✓</span>`

  // Build date/time rows — multi-session gets a list of dates instead of single date+time
  let dateTimeRows: string
  if (d.sessions && d.sessions.length > 1) {
    const sessionLines = d.sessions.map(s => {
      const label = s.label ? ` — ${s.label}` : ''
      return `<div style="padding:4px 0;">${s.date} at ${s.time}${label}</div>`
    }).join('')
    dateTimeRows = `
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;vertical-align:top;"><strong>Dates</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${sessionLines}</td></tr>`
  } else {
    dateTimeRows = `
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Date</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.eventDate}</td></tr>
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Time</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.eventTime}</td></tr>`
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">You're In! 🎉</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">Your ${d.isFree ? 'RSVP' : 'tickets are'} confirmed</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 28px;">You're all set for <strong>${d.eventTitle}</strong>. We can't wait to see you!</p>
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:16px;color:${BRAND.navy};margin:0 0 16px;font-weight:bold;">🎟️ Ticket Details</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:8px 0;color:${BRAND.gray};width:120px;"><strong>Ref</strong></td><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;">${d.ticketRef}</td></tr>
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Event</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.eventTitle}</td></tr>
          ${dateTimeRows}
          ${variantLine}
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Qty</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.quantity}</td></tr>
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Total</strong></td><td style="padding:8px 0;border-top:1px solid #f0ece7;">${priceLine}</td></tr>
        </table>
      </div>
    </div>
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 14px;">📍 Location</h3>
      <p style="margin:0;font-size:14px;color:${BRAND.gray};">${d.location}</p>
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('See you there!')}
</div>
</body></html>`
}

/* ── Ticket Purchase Notify (admin) ───────────────────────────── */

interface TicketNotifyData {
  ticketRef: string
  customerName: string
  customerEmail: string
  customerPhone?: string
  eventTitle: string
  eventDate: string
  eventTime: string
  quantity: number
  variantLabel?: string
  totalFormatted: string
  isFree: boolean
  stripePI?: string
  sessions?: { date: string; time: string; label?: string }[]
}

export function ticketPurchaseNotifyHtml(raw: TicketNotifyData): string {
  const d = escapeFields(raw)
  const dateCell = d.sessions && d.sessions.length > 1
    ? d.sessions.map(s => `${s.date} at ${s.time}${s.label ? ` — ${s.label}` : ''}`).join('<br>')
    : d.eventDate + (d.eventTime ? ` at ${d.eventTime}` : '')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:${BRAND.bodyBg};font-family:sans-serif;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;">
  <div style="background:${BRAND.headerBgAdmin};padding:20px 28px;">
    <h2 style="color:${BRAND.navy};margin:0;font-size:18px;">🎟️ New ${d.isFree ? 'RSVP' : 'Ticket Purchase'}</h2>
    <p style="color:${BRAND.navy};opacity:0.7;margin:4px 0 0;font-size:13px;">${d.ticketRef} — ${d.eventTitle}</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:110px;">Customer</td><td style="padding:10px 12px;">${d.customerName}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="${mailToHref(raw.customerEmail)}">${d.customerEmail}</a></td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Phone</td><td style="padding:10px 12px;">${d.customerPhone || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Event</td><td style="padding:10px 12px;">${d.eventTitle}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;vertical-align:top;">Date</td><td style="padding:10px 12px;">${dateCell}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Qty</td><td style="padding:10px 12px;">${d.quantity}</td></tr>
      ${d.variantLabel ? `<tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Option</td><td style="padding:10px 12px;">${d.variantLabel}</td></tr>` : ''}
      <tr><td style="padding:10px 12px;font-weight:bold;">Total</td><td style="padding:10px 12px;color:#059669;font-weight:bold;">${d.totalFormatted}</td></tr>
      ${d.stripePI ? `<tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Stripe PI</td><td style="padding:10px 12px;font-size:12px;color:#888;">${d.stripePI}</td></tr>` : ''}
    </table>
  </div>
</div>
</body></html>`
}

/* ── Fundraiser Auto-Reply (customer) ─────────────────────────── */

export interface FundraiserInquiryAutoReplyData {
  contactName: string
  organizationName: string
  estimatedQuantity?: string
  organizationType?: string
}

export function fundraiserInquiryAutoReplyHtml(raw: FundraiserInquiryAutoReplyData): string {
  const d = escapeFields(raw)
  const firstName = d.contactName.split(' ')[0] || 'there'
  const orgLabel = d.organizationType === 'school' ? 'schools'
    : d.organizationType === 'team' ? 'sports teams'
    : d.organizationType === 'dance' ? 'dance studios'
    : d.organizationType === 'church' ? 'community organizations'
    : 'organizations'
  const qtyLine = d.estimatedQuantity
    ? `<tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:140px;">Est. Quantity</td><td style="padding:10px 12px;">${d.estimatedQuantity} items</td></tr>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:26px;margin:0 0 6px;font-weight:normal;">Fundraiser Request Received</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">We'll send your free mockup within 24 hours</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Thank you for reaching out about our custom merchandise fundraising program! We love working with ${orgLabel} like <strong>${d.organizationName}</strong> and we're excited to show you what's possible.</p>
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:16px;color:${BRAND.navy};margin:0 0 16px;font-weight:bold;">Your Request</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:10px 12px;font-weight:bold;width:140px;">Organization</td><td style="padding:10px 12px;">${d.organizationName}</td></tr>
          <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Contact</td><td style="padding:10px 12px;">${d.contactName}</td></tr>
          ${qtyLine}
        </table>
      </div>
    </div>
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 14px;">What Happens Next</h3>
      <table style="width:100%;font-size:14px;color:${BRAND.gray};">
        <tr><td style="padding:6px 0;vertical-align:top;width:24px;font-weight:bold;color:${BRAND.navy};">1.</td><td style="padding:6px 0;">We'll design a <strong>free digital mockup</strong> of your custom merchandise within 24 hours.</td></tr>
        <tr><td style="padding:6px 0;vertical-align:top;font-weight:bold;color:${BRAND.navy};">2.</td><td style="padding:6px 0;">You share it with your group and gather pre-orders through a <strong>custom ordering page</strong> we build for you.</td></tr>
        <tr><td style="padding:6px 0;vertical-align:top;font-weight:bold;color:${BRAND.navy};">3.</td><td style="padding:6px 0;">We handle <strong>production, delivery, and payment collection</strong> — you collect your profit share.</td></tr>
      </table>
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline("Let's raise some money!")}
</div>
</body></html>`
}

/* ── Fundraiser Inquiry Notify (admin) ────────────────────────── */

export interface FundraiserInquiryNotifyData {
  contactName: string
  organizationName: string
  email: string
  phone?: string
  organizationType: string
  estimatedQuantity?: string
  message?: string
}

export function fundraiserInquiryNotifyHtml(raw: FundraiserInquiryNotifyData): string {
  const d = escapeFields(raw)
  const orgTypeLabel = d.organizationType === 'school' ? 'School / PTA'
    : d.organizationType === 'team' ? 'Sports Team'
    : d.organizationType === 'dance' ? 'Dance Studio / Cheer'
    : d.organizationType === 'church' ? 'Church / Faith Group'
    : d.organizationType || 'Other'
  const messageRow = d.message
    ? `<tr><td colspan="2" style="padding:12px;border-top:1px solid #eee;"><strong style="display:block;margin-bottom:4px;">Message:</strong><span style="color:${BRAND.gray};">${d.message}</span></td></tr>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:${BRAND.bodyBg};font-family:sans-serif;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;">
  <div style="background:${BRAND.headerBgAdmin};padding:20px 28px;">
    <h2 style="color:${BRAND.navy};margin:0;font-size:18px;">New Fundraiser Lead</h2>
    <p style="color:${BRAND.navy};opacity:0.7;margin:4px 0 0;font-size:13px;">${d.organizationName} — ${d.contactName}</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:130px;">Contact</td><td style="padding:10px 12px;">${d.contactName}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="${mailToHref(raw.email)}">${d.email}</a></td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Phone</td><td style="padding:10px 12px;">${d.phone || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Organization</td><td style="padding:10px 12px;">${d.organizationName}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Org Type</td><td style="padding:10px 12px;">${orgTypeLabel}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Est. Quantity</td><td style="padding:10px 12px;">${d.estimatedQuantity || '—'}</td></tr>
      ${messageRow}
    </table>
  </div>
</div>
</body></html>`
}

/* ── Lead Notify (admin) ──────────────────────────────────────── */

interface LeadNotifyData {
  fullName: string
  email: string
  phone?: string
  eventType: string
  childAge?: string
  guestCount?: string
  partyTheme?: string
  preferredDate?: string
  timeOfDay?: string
  notes?: string
}

export function leadNotifyHtml(raw: LeadNotifyData): string {
  const d = escapeFields(raw)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBgAdmin};padding:28px 32px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 6px;">Host Hampton — New Lead</p>
    <h1 style="color:${BRAND.navy};font-size:22px;margin:0;font-weight:normal;">New ${d.eventType} Inquiry</h1>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:140px;">Name</td><td style="padding:10px 12px;">${d.fullName}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="${mailToHref(raw.email)}">${d.email}</a></td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Phone</td><td style="padding:10px 12px;">${d.phone || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Event Type</td><td style="padding:10px 12px;">${d.eventType}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Child's Age</td><td style="padding:10px 12px;">${d.childAge || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Guest Count</td><td style="padding:10px 12px;">${d.guestCount || '—'}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Party Theme</td><td style="padding:10px 12px;">${d.partyTheme || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Preferred Date</td><td style="padding:10px 12px;">${d.preferredDate || '—'}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Time of Day</td><td style="padding:10px 12px;">${d.timeOfDay || '—'}</td></tr>
      ${d.notes ? `<tr><td style="padding:10px 12px;font-weight:bold;">Notes</td><td style="padding:10px 12px;">${d.notes}</td></tr>` : ''}
    </table>
  </div>
</div>
</body></html>`
}

/* ── Saved Quote (customer) ───────────────────────────────────── */

export function savedQuoteHtml(raw: {
  customerName: string
  quoteLink: string
  summary: string
  partyDate?: string
  partyTime?: string
  bookLink?: string
}): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  const hasSlot = d.partyDate && d.partyTime

  const slotBlock = hasSlot
    ? `<div style="background:#e6f0e8;border-radius:10px;padding:16px 20px;margin-bottom:24px;border:1px solid #b8d4bc;">
        <p style="margin:0;font-size:14px;color:${BRAND.navy};">📅 <strong>${d.partyDate}</strong> at <strong>${d.partyTime}</strong></p>
        <p style="margin:4px 0 0;font-size:12px;color:${BRAND.gray};">Subject to availability — reserve now to lock it in!</p>
      </div>`
    : ''

  const bookButton = raw.bookLink
    ? `<div style="text-align:center;margin-bottom:16px;">
        <a href="${mailHref(raw.bookLink)}" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:14px 36px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;letter-spacing:0.5px;">Reserve Your Date</a>
      </div>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">Your Party Quote</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">Saved and ready when you are</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Here's your saved party quote. Click below to pick up where you left off — adjust your selections, check availability, and reserve your date!</p>
    ${slotBlock}
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 12px;">Your Selections</h3>
      <p style="color:${BRAND.gray};font-size:13px;line-height:1.8;margin:0;white-space:pre-line;">${d.summary}</p>
    </div>
    ${bookButton}
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${mailHref(raw.quoteLink)}" style="display:inline-block;background:transparent;color:${BRAND.navy};padding:12px 32px;border-radius:50px;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:0.5px;border:2px solid ${BRAND.navy};">Continue Building Your Party</a>
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? We're here to help!<br>${contactBlock}
    </p>
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Lead Confirmation (customer) ────────────────────────────── */

export function leadConfirmHtml(raw: {
  customerName: string
  eventType: string
  preferredDate?: string
  guestCount?: string
  bookLink: string
}): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  const dateRow = d.preferredDate
    ? `<tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:140px;">Preferred Date</td><td style="padding:10px 12px;">${d.preferredDate}</td></tr>`
    : ''
  const guestRow = d.guestCount
    ? `<tr><td style="padding:10px 12px;font-weight:bold;width:140px;">Guest Count</td><td style="padding:10px 12px;">~${d.guestCount}</td></tr>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">We Got Your Inquiry!</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">We&rsquo;ll be in touch within 24 hours</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Thank you for your interest in hosting your event at Host Hampton! Here&rsquo;s a summary of your inquiry:</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:140px;">Event</td><td style="padding:10px 12px;">${d.eventType}</td></tr>
      ${dateRow}
      ${guestRow}
    </table>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Ready to secure your date? Reserve with a $250 deposit:</p>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${mailHref(raw.bookLink)}" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:14px 36px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;letter-spacing:0.5px;">Check Availability &amp; Reserve</a>
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? We&rsquo;re here to help!<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('Your space. Your vision. We make it happen.')}
</div>
</body></html>`
}

/* ── Booking Confirmation (customer) ──────────────────────────── */

export interface BookingConfirmationData {
  customerName: string
  bookingRef: string
  dateFormatted: string
  partyTime: string
  eventTypeDisplay: string
  depositFormatted: string
  packageName?: string
  childName?: string
  childAge?: string
  guestCount?: string
  notes?: string
  isRoomRental: boolean
  balanceDueDate: string
}

export function bookingConfirmationHtml(raw: BookingConfirmationData): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  const packageLine = d.packageName
    ? `<tr><td style="padding:8px 0;color:${BRAND.gray};"><strong>Package</strong></td><td style="padding:8px 0;color:${BRAND.gray};">${d.packageName}</td></tr>`
    : ''
  const childLine = d.childName
    ? `<tr><td style="padding:8px 0;color:${BRAND.gray};"><strong>Guest of honor</strong></td><td style="padding:8px 0;color:${BRAND.gray};">${d.childName}${d.childAge ? `, turning ${d.childAge}` : ''}</td></tr>`
    : ''
  const guestLine = d.guestCount
    ? `<tr><td style="padding:8px 0;color:${BRAND.gray};"><strong>Guest count</strong></td><td style="padding:8px 0;color:${BRAND.gray};">~${d.guestCount}${d.isRoomRental ? ' guests' : ' children'}</td></tr>`
    : ''
  const notesLine = d.notes
    ? `<div style="background:#fffbeb;padding:12px 16px;border-left:4px solid #f59e0b;border-radius:4px;margin-top:16px;color:#666;font-size:14px;"><strong>Your notes:</strong> ${d.notes}</div>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">You're All Set! 🎉</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">Your deposit is received &amp; date is locked in</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 28px;">Your <strong>${d.depositFormatted} deposit</strong> has been successfully received. We can't wait to celebrate with you at Host Hampton!</p>
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:24px;">
        <h2 style="font-size:16px;color:${BRAND.navy};margin:0 0 16px;font-weight:bold;">🎈 Booking Summary</h2>
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <tr><td style="padding:8px 0;color:${BRAND.gray};width:140px;"><strong>Booking ref</strong></td><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;">${d.bookingRef}</td></tr>
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Date</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.dateFormatted}</td></tr>
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Time</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.partyTime || 'TBD'}</td></tr>
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Event type</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.eventTypeDisplay}</td></tr>
          ${packageLine}${childLine}${guestLine}
        </table>
        ${notesLine}
      </div>
    </div>
    <div style="background:#e6f0e8;border-radius:10px;padding:20px;margin-bottom:24px;border:1px solid #b8d4bc;">
      <h3 style="font-size:14px;color:#1a5c2a;margin:0 0 12px;">💰 Payment Summary</h3>
      <div style="display:flex;justify-content:space-between;margin:6px 0;font-size:14px;color:${BRAND.gray};">
        <span>Deposit paid today</span><span style="font-weight:bold;color:#059669;">${d.depositFormatted} ✓</span>
      </div>
      <div style="border-top:1px solid #b8d4bc;margin:10px 0;padding-top:10px;font-size:13px;color:#666;">
        <strong>Balance due:</strong> Remaining balance is collected at your event.<br>
        We'll send you a full quote within 24 hours.
      </div>
    </div>
    ${d.isRoomRental ? '' : `<div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 16px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#92400e;"><strong>🎁 Party helper tip:</strong> A 10–15% gratuity for your party helpers is greatly appreciated and goes directly to our team!</p>
    </div>`}
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 14px;">What happens next</h3>
      ${d.isRoomRental ? `<ol style="margin:0;padding-left:20px;color:${BRAND.gray};line-height:2;font-size:14px;">
        <li>We'll reach out <strong>within 24 hours</strong> to confirm your rental details</li>
        <li>We'll go over any setup needs, vendor access, or special requirements</li>
        <li>A $500 refundable security hold is authorized on your card when you arrive, and released after the event</li>
        <li>Remaining balance is due <strong>${d.balanceDueDate}</strong></li>
      </ol>` : `<ol style="margin:0;padding-left:20px;color:${BRAND.gray};line-height:2;font-size:14px;">
        <li>We'll reach out <strong>within 24 hours</strong> to confirm your booking details</li>
        <li>You'll receive a personalized themed EVITE digital invitation</li>
        <li>We'll work together to finalize themes, activities &amp; fun details</li>
        <li>Remaining balance is due <strong>${d.balanceDueDate}</strong></li>
      </ol>`}
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? We'd love to hear from you:<br>${contactBlock}<br>
      <span style="color:#888;font-size:12px;">Mon–Fri 12–7pm · Sat–Sun 10am–8pm</span>
    </p>
  </div>
  ${footerTagline("Can't wait to make your celebration magical!")}
</div>
</body></html>`
}

/* ── Booking Refund (customer) ───────────────────────────────── */

export function bookingRefundHtml(raw: { customerName: string; eventType: string; bookingRef: string; refundAmount: string; reason?: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Deposit Refund Processed</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Your deposit refund of <strong>${d.refundAmount}</strong> for your <strong>${d.eventType}</strong> booking (${d.bookingRef}) has been processed. It will appear on your statement within 5–10 business days.</p>
    ${d.reason ? `<p style="color:#888;font-size:13px;margin:0 0 24px;"><em>Reason: ${d.reason}</em></p>` : ''}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Contact us anytime:<br>${contactBlock}
    </p>
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Gift Card (customer) ─────────────────────────────────────── */

interface GiftCardEmailData {
  recipientName: string
  senderName: string
  amountFormatted: string
  code: string
  personalMessage?: string
}

export function giftCardHtml(raw: GiftCardEmailData): string {
  const d = escapeFields(raw)
  const firstName = d.recipientName.split(' ')[0] || 'there'
  const messageLine = d.personalMessage
    ? `<div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;font-style:italic;color:${BRAND.gray};font-size:15px;line-height:1.7;">"${d.personalMessage}"<br><span style="font-style:normal;font-size:13px;color:${BRAND.navy};margin-top:8px;display:inline-block;">— ${d.senderName}</span></div>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">You've Got a Gift Card!</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">From ${d.senderName} with love</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 28px;">Someone special wants you to celebrate! You've received a <strong>Host Hampton gift card</strong> — use it toward any party, event, or experience.</p>
    ${messageLine}
    <div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
      <div style="background:white;border-radius:10px;padding:32px;text-align:center;">
        <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${BRAND.gray};margin:0 0 8px;">Gift Card Value</p>
        <p style="font-size:42px;font-weight:bold;color:#059669;margin:0 0 16px;">${d.amountFormatted}</p>
        <div style="background:#f0ece7;display:inline-block;padding:12px 28px;border-radius:8px;">
          <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:${BRAND.gray};margin:0 0 4px;">Your Code</p>
          <p style="font-size:24px;font-weight:bold;color:${BRAND.navy};margin:0;letter-spacing:3px;font-family:monospace;">${d.code}</p>
        </div>
      </div>
    </div>
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 14px;">How to Use Your Gift Card</h3>
      <ol style="margin:0;padding-left:20px;color:${BRAND.gray};line-height:2;font-size:14px;">
        <li>Visit <a href="https://www.hosthampton.com/book" style="color:${BRAND.navy};font-weight:bold;">hosthampton.com/book</a> to browse parties &amp; events</li>
        <li>Enter your gift card code <strong>${d.code}</strong> at checkout</li>
        <li>Your balance will be applied automatically</li>
      </ol>
    </div>
    <div style="text-align:center;margin-bottom:16px;">
      <a href="https://www.hosthampton.com/book" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:14px 36px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;letter-spacing:0.5px;">Book a Party</a>
    </div>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="https://www.hosthampton.com/events" style="display:inline-block;background:transparent;color:${BRAND.navy};padding:12px 32px;border-radius:50px;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:0.5px;border:2px solid ${BRAND.navy};">Browse Events</a>
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('Celebrate with us!')}
</div>
</body></html>`
}

/* ── Gift Card Purchase Notify (admin) ────────────────────────── */

interface GiftCardNotifyData {
  code: string
  amountFormatted: string
  purchaserName: string
  purchaserEmail: string
  recipientName: string
  recipientEmail: string
  personalMessage?: string
  stripePI?: string
}

export function giftCardNotifyHtml(raw: GiftCardNotifyData): string {
  const d = escapeFields(raw)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:20px;background:${BRAND.bodyBg};font-family:sans-serif;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:8px;overflow:hidden;">
  <div style="background:${BRAND.headerBgAdmin};padding:20px 28px;">
    <h2 style="color:${BRAND.navy};margin:0;font-size:18px;">New Gift Card Purchase</h2>
    <p style="color:${BRAND.navy};opacity:0.7;margin:4px 0 0;font-size:13px;">${d.code} — ${d.amountFormatted}</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;width:130px;">Code</td><td style="padding:10px 12px;font-weight:bold;letter-spacing:2px;">${d.code}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Amount</td><td style="padding:10px 12px;color:#059669;font-weight:bold;">${d.amountFormatted}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Purchased By</td><td style="padding:10px 12px;">${d.purchaserName}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Purchaser Email</td><td style="padding:10px 12px;"><a href="${mailToHref(raw.purchaserEmail)}">${d.purchaserEmail}</a></td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Recipient</td><td style="padding:10px 12px;">${d.recipientName}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Recipient Email</td><td style="padding:10px 12px;"><a href="${mailToHref(raw.recipientEmail)}">${d.recipientEmail}</a></td></tr>
      ${d.personalMessage ? `<tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Message</td><td style="padding:10px 12px;font-style:italic;">${d.personalMessage}</td></tr>` : ''}
      ${d.stripePI ? `<tr><td style="padding:10px 12px;font-weight:bold;">Stripe PI</td><td style="padding:10px 12px;font-size:12px;color:#888;">${d.stripePI}</td></tr>` : ''}
    </table>
  </div>
</div>
</body></html>`
}

/* ── Gift Card Purchase Confirmation (purchaser) ──────────────── */

export function giftCardPurchaseConfirmHtml(raw: {
  purchaserName: string
  recipientName: string
  amountFormatted: string
  code: string
}): string {
  const d = escapeFields(raw)
  const firstName = d.purchaserName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">Gift Card Sent!</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">Your gift is on its way</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 28px;">Your <strong>${d.amountFormatted}</strong> gift card for <strong>${d.recipientName}</strong> has been purchased and emailed to them. Here's a copy for your records:</p>
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:24px;text-align:center;">
      <p style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:${BRAND.gray};margin:0 0 4px;">Gift Card Code</p>
      <p style="font-size:22px;font-weight:bold;color:${BRAND.navy};margin:0;letter-spacing:3px;font-family:monospace;">${d.code}</p>
      <p style="font-size:13px;color:${BRAND.gray};margin:8px 0 0;">Value: ${d.amountFormatted}</p>
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('Thanks for gifting a celebration!')}
</div>
</body></html>`
}

/* ── Ticket Refund (customer) ─────────────────────────────────── */

export function ticketRefundHtml(raw: { customerName: string; eventTitle: string; ticketRef: string; refundAmount: string; reason?: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Refund Processed</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Your refund of <strong>${d.refundAmount}</strong> for <strong>${d.eventTitle}</strong> (${d.ticketRef}) has been processed. It will appear on your statement within 5–10 business days.</p>
    ${d.reason ? `<p style="color:#888;font-size:13px;margin:0 0 24px;"><em>Reason: ${d.reason}</em></p>` : ''}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Contact us anytime:<br>${contactBlock}
    </p>
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Party Builder — helpers ─────────────────────────────────── */

interface PartyLineItem { name: string; quantity: number; unit_price_cents: number; guest_multiplied: boolean; totalCents: number }

function lineItemRows(items: PartyLineItem[]): string {
  return items.map(i => `
    <tr>
      <td style="padding:6px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${i.name}${i.quantity > 1 ? ` ×${i.quantity}` : ''}${i.guest_multiplied ? ' (per guest)' : ''}</td>
      <td style="padding:6px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;text-align:right;">$${(i.totalCents / 100).toFixed(2)}</td>
    </tr>`).join('')
}

/**
 * Takes an ALREADY-SCREENED href (`mailHref` / `mailHrefExternal`), not a raw
 * URL, so the screen is visible at the call site rather than hidden one frame
 * down. An empty href means the screen refused the value and has already said
 * so; a button that goes nowhere is worse than no button, and every URL that
 * reaches this file is built server-side from the canonical origin, so this
 * branch means a bug upstream rather than an expected state.
 */
function payButton(href: string, label: string): string {
  if (!href) return ''
  return `<div style="text-align:center;margin:28px 0;">
    <a href="${href}" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:14px 40px;font-size:16px;text-decoration:none;border-radius:6px;font-family:Georgia,serif;">${label}</a>
  </div>`
}

/* ── Party Deposit Received (customer) ───────────────────────── */

export function partyDepositReceivedHtml(raw: { customerName: string; bookingRef: string; depositFormatted: string; partyDate: string; portalUrl: string; lineItems: PartyLineItem[]; totalFormatted: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Deposit Received!</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 20px;">Thank you! Your deposit of <strong>${d.depositFormatted}</strong> for booking <strong>${d.bookingRef}</strong> has been received.</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Your party date: <strong>${d.partyDate}</strong></p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td colspan="2" style="padding:8px 0;color:${BRAND.navy};font-weight:bold;border-bottom:2px solid ${BRAND.navy};">Your Party</td></tr>
      ${lineItemRows(d.lineItems)}
      <tr><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;">Total</td><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;text-align:right;">${d.totalFormatted}</td></tr>
    </table>
    <div style="background:${BRAND.bodyBg};border-radius:8px;padding:16px 20px;margin:0 0 24px;">
      <p style="color:${BRAND.navy};font-size:14px;margin:0;"><strong>What happens next:</strong></p>
      <p style="color:${BRAND.gray};font-size:14px;line-height:1.7;margin:8px 0 0;">We'll review and confirm all details within 24 hours. You'll receive an email once your booking is approved.</p>
    </div>
    ${payButton(mailHref(raw.portalUrl), 'View Your Booking')}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('Let the celebration begin!')}
</div>
</body></html>`
}

/* ── Studio Rental Invite (customer) ─────────────────────────── */

export function studioRentalInviteHtml(raw: {
  customerName: string
  studioUrl: string
}): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Reserve Our Studio</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 20px;">Thanks for your interest in renting our private Hamptons studio for your celebration! We made it easy to book online, start to finish.</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Just pick your date and time, add any extras (décor, food, treats, photo booth and more), review and sign the rental agreement, and reserve with a deposit — all in one place.</p>
    <div style="background:${BRAND.bodyBg};border-radius:8px;padding:16px 20px;margin:0 0 24px;">
      <p style="color:${BRAND.gray};font-size:14px;line-height:1.7;margin:0;">
        • Seats up to 65 · standing room for 85<br>
        • Weekend $600 / 3 hrs (+$150/hr) · Weekday $475 / 3 hrs (+$100/hr)<br>
        • $250 deposit holds your date; balance payable any time before your event
      </p>
    </div>
    ${payButton(mailHref(raw.studioUrl), 'Start Your Booking')}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? We're happy to help:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('We can’t wait to host you!')}
</div>
</body></html>`
}

/* ── Studio Rental Confirmation (customer) ───────────────────── */

export function studioRentalConfirmationHtml(raw: {
  customerName: string
  bookingRef: string
  depositFormatted: string
  eventDate: string          // pre-formatted, e.g. "Saturday, June 13, 2026"
  startTime: string          // "2:00 PM"
  endTime: string            // "6:00 PM"
  guestCount: number
  lineItems: PartyLineItem[]
  totalFormatted: string
  balanceFormatted: string
  balanceDueDate: string     // pre-formatted
  portalUrl: string
  agreementUrl?: string | null
}): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Your Studio is Reserved!</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 20px;">Your deposit of <strong>${d.depositFormatted}</strong> for booking <strong>${d.bookingRef}</strong> is in — your date is locked. 🎉</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td style="padding:6px 0;color:${BRAND.gray};width:130px;">Date</td><td style="padding:6px 0;color:${BRAND.navy};font-weight:bold;">${d.eventDate}</td></tr>
      <tr><td style="padding:6px 0;color:${BRAND.gray};">Time</td><td style="padding:6px 0;color:${BRAND.navy};">${d.startTime} – ${d.endTime}</td></tr>
      <tr><td style="padding:6px 0;color:${BRAND.gray};">Guests</td><td style="padding:6px 0;color:${BRAND.navy};">${d.guestCount}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td colspan="2" style="padding:8px 0;color:${BRAND.navy};font-weight:bold;border-bottom:2px solid ${BRAND.navy};">Your Rental</td></tr>
      ${lineItemRows(d.lineItems)}
      <tr><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;">Total</td><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;text-align:right;">${d.totalFormatted}</td></tr>
      <tr><td style="padding:4px 0;color:${BRAND.gray};font-size:13px;">Deposit paid</td><td style="padding:4px 0;color:${BRAND.gray};font-size:13px;text-align:right;">${d.depositFormatted}</td></tr>
      <tr><td style="padding:4px 0;color:${BRAND.navy};font-size:13px;font-weight:bold;">Balance due ${d.balanceDueDate}</td><td style="padding:4px 0;color:${BRAND.navy};font-size:13px;font-weight:bold;text-align:right;">${d.balanceFormatted}</td></tr>
    </table>
    <div style="background:${BRAND.bodyBg};border-radius:8px;padding:16px 20px;margin:0 0 24px;">
      <p style="color:${BRAND.navy};font-size:14px;margin:0 0 6px;"><strong>A few things to know:</strong></p>
      <p style="color:${BRAND.gray};font-size:14px;line-height:1.7;margin:0;">
        • Your balance can be paid any time before your event — we'll remind you around <strong>${d.balanceDueDate}</strong>.<br>
        • A <strong>$500 refundable security hold</strong> is authorized on your card when you arrive and released after the event if there's no damage. It's a hold, not a charge.<br>
        • Your rental window includes your own setup and cleanup time.
      </p>
    </div>
    ${raw.agreementUrl ? `<p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0 0 8px;">📄 <a href="${mailHrefExternal(raw.agreementUrl)}" style="color:${BRAND.navy};">View your signed rental agreement</a></p>` : ''}
    <p style="color:${BRAND.gray};font-size:14px;line-height:1.7;margin:0 0 4px;text-align:center;">Need more time or want to add extras? Manage your booking anytime:</p>
    ${payButton(mailHref(raw.portalUrl), 'View & Manage Booking')}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('We can’t wait to host you!')}
</div>
</body></html>`
}

/* ── Party Admin New Booking (admin) ─────────────────────────── */

export function partyAdminNewBookingHtml(raw: { bookingRef: string; customerName: string; customerEmail: string; customerPhone?: string; partyDate: string; partyTime: string; guestCount: number; packageType: string; depositFormatted: string; totalFormatted: string; paymentMethod: string; lineItems: PartyLineItem[]; notes?: string; adminUrl: string }): string {
  const d = escapeFields(raw)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBgAdmin};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Admin</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">New Party Booking</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="color:${BRAND.navy};font-size:18px;font-weight:bold;margin:0 0 20px;">${d.bookingRef}</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td style="padding:6px 0;color:${BRAND.gray};width:130px;">Customer</td><td style="padding:6px 0;color:${BRAND.navy};font-weight:bold;">${d.customerName}</td></tr>
      <tr><td style="padding:6px 0;color:${BRAND.gray};">Email</td><td style="padding:6px 0;color:${BRAND.navy};">${d.customerEmail}</td></tr>
      ${d.customerPhone ? `<tr><td style="padding:6px 0;color:${BRAND.gray};">Phone</td><td style="padding:6px 0;color:${BRAND.navy};">${d.customerPhone}</td></tr>` : ''}
      <tr><td style="padding:6px 0;color:${BRAND.gray};">Date</td><td style="padding:6px 0;color:${BRAND.navy};">${d.partyDate}</td></tr>
      <tr><td style="padding:6px 0;color:${BRAND.gray};">Time</td><td style="padding:6px 0;color:${BRAND.navy};">${d.partyTime}</td></tr>
      <tr><td style="padding:6px 0;color:${BRAND.gray};">Guests</td><td style="padding:6px 0;color:${BRAND.navy};">${d.guestCount}</td></tr>
      <tr><td style="padding:6px 0;color:${BRAND.gray};">Package</td><td style="padding:6px 0;color:${BRAND.navy};">${d.packageType}</td></tr>
      <tr><td style="padding:6px 0;color:${BRAND.gray};">Payment</td><td style="padding:6px 0;color:${BRAND.navy};">${d.paymentMethod}</td></tr>
    </table>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td colspan="2" style="padding:8px 0;color:${BRAND.navy};font-weight:bold;border-bottom:2px solid ${BRAND.navy};">Line Items</td></tr>
      ${lineItemRows(d.lineItems)}
      <tr><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;">Total</td><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;text-align:right;">${d.totalFormatted}</td></tr>
      <tr><td style="padding:4px 0;color:${BRAND.gray};font-size:13px;">Deposit</td><td style="padding:4px 0;color:${BRAND.gray};font-size:13px;text-align:right;">${d.depositFormatted}</td></tr>
    </table>
    ${d.notes ? `<div style="background:#f8f6f3;border-radius:6px;padding:12px 16px;margin:0 0 20px;"><p style="color:${BRAND.gray};font-size:13px;margin:0;"><strong>Customer Notes:</strong> ${d.notes}</p></div>` : ''}
    ${payButton(mailHref(raw.adminUrl), 'Review & Approve')}
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Party Approved (customer) ───────────────────────────────── */

/* ── Party Request Received (customer, no payment) ───────────── */

export function partyRequestReceivedHtml(raw: { customerName: string; bookingRef: string; partyDate: string; partyTime: string; depositFormatted: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Request Received!</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Thanks for your party request <strong>${d.bookingRef}</strong>! Our team will confirm availability for your requested date and get back to you within 24 hours.</p>
    <div style="background:${BRAND.bodyBg};border-radius:8px;padding:20px 24px;margin:0 0 24px;">
      <p style="color:${BRAND.navy};margin:0 0 8px;"><strong>Requested Date:</strong> ${d.partyDate}</p>
      <p style="color:${BRAND.navy};margin:0;"><strong>Requested Time:</strong> ${d.partyTime}</p>
    </div>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;"><strong>Nothing is booked yet and no payment is due.</strong> Once we confirm your date, we'll email you a secure link to pay your deposit (${d.depositFormatted}) and lock it in.</p>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline("We can't wait to celebrate with you!")}
</div>
</body></html>`
}

export function partyApprovedHtml(raw: { customerName: string; bookingRef: string; partyDate: string; partyTime: string; balanceFormatted: string; portalUrl: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">You're Confirmed!</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Great news — your party booking <strong>${d.bookingRef}</strong> has been approved!</p>
    <div style="background:${BRAND.bodyBg};border-radius:8px;padding:20px 24px;margin:0 0 24px;">
      <p style="color:${BRAND.navy};margin:0 0 8px;"><strong>Date:</strong> ${d.partyDate}</p>
      <p style="color:${BRAND.navy};margin:0 0 8px;"><strong>Time:</strong> ${d.partyTime}</p>
      <p style="color:${BRAND.navy};margin:0;"><strong>Remaining Balance:</strong> ${d.balanceFormatted}</p>
    </div>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">You can view your booking details, make changes, or submit payments through your portal anytime.</p>
    ${payButton(mailHref(raw.portalUrl), 'View Your Booking')}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline("We can't wait to celebrate with you!")}
</div>
</body></html>`
}

/* ── Party Changes Requested (customer) ──────────────────────── */

export function partyChangesRequestedHtml(raw: { customerName: string; bookingRef: string; adminMessage: string; portalUrl: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">A Note About Your Booking</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 20px;">We have an update regarding your booking <strong>${d.bookingRef}</strong>:</p>
    <div style="background:${BRAND.bodyBg};border-radius:8px;padding:16px 20px;margin:0 0 24px;border-left:4px solid ${BRAND.navy};">
      <p style="color:${BRAND.navy};font-size:14px;line-height:1.7;margin:0;">${d.adminMessage}</p>
    </div>
    ${payButton(mailHref(raw.portalUrl), 'View Your Booking')}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Party Payment Received (customer) ───────────────────────── */

export function partyPaymentReceivedHtml(raw: { customerName: string; bookingRef: string; amountFormatted: string; paymentMethod: string; newBalanceFormatted: string; portalUrl: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Payment Received</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">We've received your payment of <strong>${d.amountFormatted}</strong> via <strong>${d.paymentMethod}</strong> for booking <strong>${d.bookingRef}</strong>.</p>
    <div style="background:${BRAND.bodyBg};border-radius:8px;padding:16px 20px;margin:0 0 24px;text-align:center;">
      <p style="color:${BRAND.gray};font-size:13px;margin:0 0 4px;">Remaining Balance</p>
      <p style="color:${BRAND.navy};font-size:28px;font-weight:bold;margin:0;">${d.newBalanceFormatted}</p>
    </div>
    ${payButton(mailHref(raw.portalUrl), 'View Your Booking')}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('Thank you!')}
</div>
</body></html>`
}

/* ── Party Balance Reminder (customer, T-2 / T-1) ───────────── */

export function partyBalanceReminderHtml(raw: { customerName: string; bookingRef: string; partyDate: string; balanceFormatted: string; payUrl: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Balance Reminder</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Your party on <strong>${d.partyDate}</strong> is almost here! A friendly reminder that the remaining balance of <strong>${d.balanceFormatted}</strong> is due before the event.</p>
    ${payButton(mailHref(raw.payUrl), 'Pay Now')}
    <p style="color:${BRAND.gray};font-size:13px;line-height:1.7;margin:0 0 24px;">You can also pay via Venmo, Zelle, or cash — just let us know!</p>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Party Portal Magic Link (customer) ──────────────────────── */

export function partyPortalMagicLinkHtml(raw: { customerName: string; bookingRef: string; portalUrl: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Your Booking Portal</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Click below to access your booking <strong>${d.bookingRef}</strong>. You can view details, make changes, and submit payments.</p>
    ${payButton(mailHref(raw.portalUrl), 'Access My Booking')}
    <p style="color:${BRAND.gray};font-size:13px;line-height:1.7;margin:0 0 24px;">This link expires in 72 hours. If it expires, you can request a new one from the login page.</p>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Party Payment Instructions (customer, non-card) ─────────── */

export function partyPaymentInstructionsHtml(raw: { customerName: string; bookingRef: string; depositFormatted: string; paymentMethod: string; venmoHandle?: string; zelleEmail?: string; portalUrl: string }): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  let instructions = ''
  if (d.paymentMethod === 'venmo') {
    instructions = `<p style="color:${BRAND.navy};font-size:15px;margin:0;"><strong>Venmo:</strong> Send ${d.depositFormatted} to <strong>${d.venmoHandle || '@HostHampton'}</strong> (Venmo phone <strong>631-599-2469</strong>).</p><p style="color:${BRAND.gray};font-size:13px;margin:4px 0 0;">Include your booking ref <strong>${d.bookingRef}</strong> in the note.</p>`
  } else if (d.paymentMethod === 'zelle') {
    instructions = `<p style="color:${BRAND.navy};font-size:15px;margin:0;"><strong>Zelle:</strong> Send ${d.depositFormatted} to <strong>631-599-2469</strong> (Host Hampton).</p><p style="color:${BRAND.gray};font-size:13px;margin:4px 0 0;">Include your booking ref <strong>${d.bookingRef}</strong> in the memo.</p>`
  } else {
    instructions = `<p style="color:${BRAND.navy};font-size:15px;margin:0;"><strong>Cash:</strong> Bring ${d.depositFormatted} to Host Hampton before or on the day of your event.</p>`
  }
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Payment Instructions</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Thank you for booking with Host Hampton! Your booking <strong>${d.bookingRef}</strong> has been reserved. Please send your deposit to confirm:</p>
    <div style="background:${BRAND.bodyBg};border-radius:8px;padding:20px 24px;margin:0 0 24px;">
      ${instructions}
    </div>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Once we receive your deposit, we'll confirm all details within 24 hours.</p>
    ${payButton(mailHref(raw.portalUrl), 'View Your Booking')}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Party Admin Unpaid Day-Of (admin alert) ─────────────────── */

export function partyQuoteSentHtml(raw: {
  customerName: string; bookingRef: string; partyDate?: string; partyTime?: string;
  guestCount: number; packageType: string; childName?: string;
  totalFormatted: string; depositFormatted: string; balanceFormatted: string;
  lineItems: PartyLineItem[]; builderUrl: string; notes?: string;
}): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  const dateLine = d.partyDate
    ? `<tr><td style="padding:6px 0;color:${BRAND.gray};width:130px;">Date</td><td style="padding:6px 0;color:${BRAND.navy};font-weight:bold;">${d.partyDate}</td></tr>`
    : ''
  const timeLine = d.partyTime
    ? `<tr><td style="padding:6px 0;color:${BRAND.gray};">Time</td><td style="padding:6px 0;color:${BRAND.navy};">${d.partyTime}</td></tr>`
    : ''
  const childLine = d.childName
    ? `<tr><td style="padding:6px 0;color:${BRAND.gray};">Celebration</td><td style="padding:6px 0;color:${BRAND.navy};font-weight:bold;">${d.childName}</td></tr>`
    : ''
  const notesLine = d.notes
    ? `<div style="background:#f0ece7;border-radius:8px;padding:16px 20px;margin:0 0 24px;"><p style="color:${BRAND.navy};font-size:13px;margin:0 0 6px;font-weight:bold;">Notes</p><p style="color:${BRAND.gray};font-size:14px;line-height:1.6;margin:0;">${d.notes}</p></div>`
    : ''
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">Your Host Hampton Party Plan</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">Booking ${d.bookingRef}</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">We've put together your custom party plan! Review the details below — you can add or remove options, then pay your $250 deposit (${d.depositFormatted}) to lock it in. We can't wait to celebrate with you.</p>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      ${childLine}
      <tr><td style="padding:6px 0;color:${BRAND.gray};width:130px;">Package</td><td style="padding:6px 0;color:${BRAND.navy};">${d.packageType}</td></tr>
      <tr><td style="padding:6px 0;color:${BRAND.gray};">Guests</td><td style="padding:6px 0;color:${BRAND.navy};">${d.guestCount}</td></tr>
      ${dateLine}
      ${timeLine}
    </table>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td colspan="2" style="padding:8px 0;color:${BRAND.navy};font-weight:bold;border-bottom:2px solid ${BRAND.navy};">Your Party</td></tr>
      ${lineItemRows(d.lineItems)}
      <tr><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;">Estimated Total</td><td style="padding:8px 0;color:${BRAND.navy};font-weight:bold;text-align:right;">${d.totalFormatted}</td></tr>
    </table>
    <div style="background:${BRAND.bodyBg};border-radius:8px;padding:16px 20px;margin:0 0 24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr><td style="padding:4px 0;color:${BRAND.gray};">Deposit to reserve</td><td style="padding:4px 0;color:${BRAND.navy};font-weight:bold;text-align:right;">${d.depositFormatted}</td></tr>
        <tr><td style="padding:4px 0;color:${BRAND.gray};">Remaining balance</td><td style="padding:4px 0;color:${BRAND.navy};text-align:right;">${d.balanceFormatted}</td></tr>
      </table>
    </div>
    ${notesLine}
    ${payButton(mailHref(raw.builderUrl), 'View & Customize Your Party Plan')}
    <p style="font-size:13px;color:${BRAND.gray};line-height:1.7;margin:0 0 20px;text-align:center;">
      Use the link above to customize your add-ons and pay your $250 deposit to lock it in.
    </p>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline("Let's plan something amazing!")}
</div>
</body></html>`
}

/* ── Party Admin Unpaid Day-of (admin) ─────────────────────── */

export function partyAdminUnpaidDayOfHtml(raw: { bookingRef: string; customerName: string; customerPhone?: string; partyDate: string; balanceFormatted: string; adminUrl: string }): string {
  const d = escapeFields(raw)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBgAdmin};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Admin Alert</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Unpaid Balance — Today</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 20px;">Booking <strong>${d.bookingRef}</strong> has a party today (<strong>${d.partyDate}</strong>) with an outstanding balance.</p>
    <div style="background:#fff3f3;border-radius:8px;padding:16px 20px;margin:0 0 24px;text-align:center;">
      <p style="color:#c00;font-size:13px;margin:0 0 4px;">Unpaid Balance</p>
      <p style="color:#c00;font-size:28px;font-weight:bold;margin:0;">${d.balanceFormatted}</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:0 0 20px;">
      <tr><td style="padding:6px 0;color:${BRAND.gray};width:100px;">Customer</td><td style="padding:6px 0;color:${BRAND.navy};font-weight:bold;">${d.customerName}</td></tr>
      ${d.customerPhone ? `<tr><td style="padding:6px 0;color:${BRAND.gray};">Phone</td><td style="padding:6px 0;color:${BRAND.navy};"><a href="${telHref(raw.customerPhone)}" style="color:${BRAND.navy};">${d.customerPhone}</a></td></tr>` : ''}
    </table>
    ${payButton(mailHref(raw.adminUrl), 'View Booking')}
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Email Login Code (6-digit) ─────────────────────────────── */

export function emailAuthCodeHtml(raw: { code: string; expiresMinutes?: number }): string {
  const d = escapeFields(raw)
  const minutes = d.expiresMinutes ?? 15
  // Spaced-out display of the code so it's easy to read at a glance.
  const codeDisplay = d.code.split('').join('&nbsp;')
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:520px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:32px 36px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:24px;margin:0;font-weight:normal;">Your Sign-In Code</h1>
  </div>
  <div style="padding:32px 36px;text-align:center;">
    <p style="color:${BRAND.gray};font-size:15px;line-height:1.6;margin:0 0 24px;">
      Use this code to sign in to your party planner and view your saved plans.
    </p>
    <div style="background:${BRAND.bodyBg};border:2px dashed ${BRAND.navy};border-radius:12px;padding:24px 16px;margin:0 0 20px;">
      <p style="color:${BRAND.navy};font-size:36px;font-weight:bold;letter-spacing:6px;margin:0;font-family:'Courier New',monospace;">${codeDisplay}</p>
    </div>
    <p style="color:${BRAND.gray};font-size:13px;line-height:1.6;margin:0 0 24px;">
      This code expires in <strong>${minutes} minutes</strong>. If you didn&rsquo;t request it, you can safely ignore this email.
    </p>
    <p style="font-size:13px;color:${BRAND.gray};line-height:1.7;margin:0;">
      Questions? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footer}
</div>
</body></html>`
}

/* ── Party Thank You / Post-Event (customer, T+1) ────────────── */

export function partyThankYouHtml(raw: {
  customerName: string
  bookingRef: string
  partyDate: string
  photoGalleryUrl?: string | null
  reviewUrl?: string
  childName?: string | null
}): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  const celebrant = d.childName ? `${d.childName}'s ` : ''
  const photoBlock = raw.photoGalleryUrl
    ? `<div style="background:${BRAND.bodyBg};border-radius:10px;padding:24px;margin:0 0 24px;text-align:center;">
        <h3 style="font-size:16px;color:${BRAND.navy};margin:0 0 8px;">📸 Your Party Photos</h3>
        <p style="color:${BRAND.gray};font-size:14px;line-height:1.6;margin:0 0 16px;">We captured the magic! Click below to see the full gallery.</p>
        ${payButton(mailHrefExternal(raw.photoGalleryUrl), 'View Photos')}
      </div>`
    : ''
  const reviewBlock = raw.reviewUrl
    ? `<div style="text-align:center;margin:0 0 24px;">
        <p style="color:${BRAND.navy};font-size:15px;margin:0 0 12px;">Loved your celebration? A quick review means the world to us.</p>
        <a href="${mailHrefExternal(raw.reviewUrl)}" style="display:inline-block;background:#fff;border:2px solid ${BRAND.navy};color:${BRAND.navy};padding:10px 28px;font-size:14px;text-decoration:none;border-radius:6px;font-family:Georgia,serif;">Leave a Google Review</a>
      </div>`
    : `<p style="color:${BRAND.gray};font-size:14px;line-height:1.7;margin:0 0 24px;">If you loved your celebration, we'd be so grateful for a quick Google review — just search <strong>Host Hampton</strong> on Google and click "Write a review."</p>`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Thank You for Celebrating With Us 💛</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">
      Thank you for hosting ${celebrant}party with us on <strong>${d.partyDate}</strong>! It was such a joy to be part of your celebration, and we hope every moment felt as special as it looked from our side.
    </p>
    ${photoBlock}
    ${reviewBlock}
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;font-size:14px;">
      Already thinking about the next celebration? We'd love to help — birthdays, communions, baby showers, permanent jewelry parties, room rentals, you name it.
    </p>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions or memories to share? Reach out anytime:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('See you again soon!')}
</div>
</body></html>`
}

/* ── Birthday Rebooking (customer, ~10 months after last party) ── */

/**
 * AUTO_EXECUTE rebooking nudge: fires when a past party is 8–10 months out,
 * inviting the family to book next year's celebration. Owner-pre-approved
 * template — merge fields only (child name, next age, book link).
 */
export function birthdayRebookHtml(raw: {
  customerName: string
  childName?: string | null
  nextAge?: number | null
  bookLink: string
}): string {
  const d = escapeFields(raw)
  const firstName = d.customerName.split(' ')[0] || 'there'
  const who = d.childName ? d.childName : 'your little one'
  const turning = d.nextAge != null ? ` turning ${d.nextAge}` : ''
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0;font-weight:normal;">Is it party season again?</h1>
  </div>
  <div style="padding:36px 40px;">
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 20px;">
      We had the best time celebrating with you last year — and we can hardly believe another birthday for ${who}${turning} is right around the corner!
    </p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">
      Our calendar for the popular party weekends fills up early. If you'd like to celebrate with us again, now's a great time to lock in your date.
    </p>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${mailHref(raw.bookLink)}" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:14px 36px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;letter-spacing:0.5px;">Check Availability &amp; Reserve</a>
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? We'd love to help plan the next one:<br>${contactBlock}
    </p>
  </div>
  ${footerTagline("Let's celebrate again!")}
</div>
</body></html>`
}
