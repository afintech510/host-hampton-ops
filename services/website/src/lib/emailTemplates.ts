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
}

export function ticketConfirmationHtml(d: TicketConfirmationData): string {
  const firstName = d.customerName.split(' ')[0] || 'there'
  const variantLine = d.variantLabel
    ? `<tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Option</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.variantLabel}</td></tr>`
    : ''
  const priceLine = d.isFree
    ? '<span style="font-weight:bold;color:#059669;">FREE</span>'
    : `<span style="font-weight:bold;color:#059669;">${d.totalFormatted} ✓</span>`

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
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Date</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.eventDate}</td></tr>
          <tr><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;"><strong>Time</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-top:1px solid #f0ece7;">${d.eventTime}</td></tr>
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
}

export function ticketPurchaseNotifyHtml(d: TicketNotifyData): string {
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
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="mailto:${d.customerEmail}">${d.customerEmail}</a></td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Phone</td><td style="padding:10px 12px;">${d.customerPhone || '—'}</td></tr>
      <tr><td style="padding:10px 12px;font-weight:bold;">Event</td><td style="padding:10px 12px;">${d.eventTitle}</td></tr>
      <tr style="background:#f9f9f9;"><td style="padding:10px 12px;font-weight:bold;">Date</td><td style="padding:10px 12px;">${d.eventDate}</td></tr>
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

export function fundraiserInquiryAutoReplyHtml(d: FundraiserInquiryAutoReplyData): string {
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

export function fundraiserInquiryNotifyHtml(d: FundraiserInquiryNotifyData): string {
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
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="mailto:${d.email}">${d.email}</a></td></tr>
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

export function leadNotifyHtml(d: LeadNotifyData): string {
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
      <tr><td style="padding:10px 12px;font-weight:bold;">Email</td><td style="padding:10px 12px;"><a href="mailto:${d.email}">${d.email}</a></td></tr>
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

export function savedQuoteHtml(d: {
  customerName: string
  quoteLink: string
  summary: string
  partyDate?: string
  partyTime?: string
  bookLink?: string
}): string {
  const firstName = d.customerName.split(' ')[0] || 'there'
  const hasSlot = d.partyDate && d.partyTime

  const slotBlock = hasSlot
    ? `<div style="background:#e6f0e8;border-radius:10px;padding:16px 20px;margin-bottom:24px;border:1px solid #b8d4bc;">
        <p style="margin:0;font-size:14px;color:${BRAND.navy};">📅 <strong>${d.partyDate}</strong> at <strong>${d.partyTime}</strong></p>
        <p style="margin:4px 0 0;font-size:12px;color:${BRAND.gray};">Subject to availability — reserve now to lock it in!</p>
      </div>`
    : ''

  const bookButton = d.bookLink
    ? `<div style="text-align:center;margin-bottom:16px;">
        <a href="${d.bookLink}" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:14px 36px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;letter-spacing:0.5px;">Reserve Your Date</a>
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
      <a href="${d.quoteLink}" style="display:inline-block;background:transparent;color:${BRAND.navy};padding:12px 32px;border-radius:50px;text-decoration:none;font-size:13px;font-weight:bold;letter-spacing:0.5px;border:2px solid ${BRAND.navy};">Continue Building Your Party</a>
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

export function leadConfirmHtml(d: {
  customerName: string
  eventType: string
  preferredDate?: string
  guestCount?: string
  bookLink: string
}): string {
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
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Ready to secure your date? Reserve with just a $99 deposit:</p>
    <div style="text-align:center;margin-bottom:24px;">
      <a href="${d.bookLink}" style="display:inline-block;background:${BRAND.ctaBg};color:${BRAND.ctaText};padding:14px 36px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;letter-spacing:0.5px;">Check Availability &amp; Reserve</a>
    </div>
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:0;">
      Questions? We&rsquo;re here to help!<br>${contactBlock}
    </p>
  </div>
  ${footerTagline('Your space. Your vision. We make it happen.')}
</div>
</body></html>`
}

/* ── Ticket Refund (customer) ─────────────────────────────────── */

export function ticketRefundHtml(d: { customerName: string; eventTitle: string; ticketRef: string; refundAmount: string; reason?: string }): string {
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
