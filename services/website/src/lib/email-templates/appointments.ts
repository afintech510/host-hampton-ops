/**
 * Confirmation and admin-notify mail for a booked appointment.
 *
 * ── EVERY EVENT-SPECIFIC WORD ARRIVES AS DATA ──
 *
 * The file this replaces (`summer-hair.ts`) had "Summer Hair" and "Friday, July
 * 3" written into the markup in five places, plus a hard-coded address. It could
 * not send mail for any other event without being edited, which is the whole
 * defect this plan is removing. `eventName`, `dateLabel`, `locationLine` and
 * `paymentNote` are parameters now; the template knows the brand and nothing
 * else.
 *
 * ── ESCAPING IS AT ENTRY, NOT AT THE INTERPOLATION ──
 *
 * `const d = escapeFields(raw)` is the literal first statement of both exports.
 * A per-field escape list is a list somebody has to keep complete:
 * `reminders.ts` escaped five fields with `.map(v => escapeHtml(…))` and then
 * destructured three more raw beside them, all of which reached the mail. One
 * statement about the whole input cannot be half-done.
 *
 * `raw.email` and `raw.phone` are used UNESCAPED inside `mailToHref`/`telHref`
 * on purpose — those helpers do URL encoding, and handing them a value that has
 * already been HTML-escaped produces `&amp;` inside an href.
 */

import { escapeFields, mailToHref, telHref } from '@/lib/emailSafety'

const BRAND = {
  headerBg: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  footerBg: '#BCCDEB',
  bodyBg: '#F6F1EB',
  navy: '#1a2744',
  gray: '#555',
} as const

/**
 * The studio's public line, for "questions?". NOT the Venmo/Zelle number.
 *
 * The display half is a constant; the `href` is written as a LITERAL at the
 * interpolation site rather than pulled from a constant here. That is not
 * duplication for its own sake — `emailTemplateEscaping.test.ts` requires every
 * interpolated `href` to go through a URL screen (`telHref`/`mailToHref`),
 * because an interpolated href is where a `javascript:` URL gets in. A fixed
 * `tel:` literal has no interpolation to screen, which is the stronger
 * statement, and it is what the retired template did.
 */
const STUDIO_PHONE_DISPLAY = '(631) 998-9325'

interface ConfirmationData {
  name: string
  /** 'Halloween Hair' */
  eventName: string
  /** 'Friday, October 30' */
  dateLabel: string
  locationLine: string
  /** '10:20 AM - 11:00 AM' */
  duration: string
  services: string[]
  partySize: number
  /** Formatted by the caller from the registry — '$38', never recomputed here. */
  estimatedTotal: string
  /** 'Paid in person' / '$25 deposit to hold your slot, balance in person' */
  paymentNote: string
}

export function appointmentConfirmationHtml(raw: ConfirmationData): string {
  const d = escapeFields(raw)
  const firstName = d.name.split(' ')[0] || 'there'
  const serviceRows = d.services.map(s =>
    `<tr><td style="padding:6px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${s}</td></tr>`
  ).join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton · Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:26px;margin:0 0 6px;font-weight:normal;">You're Booked!</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">${d.eventName} — ${d.dateLabel}</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="color:${BRAND.navy};font-size:16px;line-height:1.7;">Hi ${firstName}!</p>
    <p style="color:${BRAND.gray};font-size:14px;line-height:1.7;">Your ${d.eventName} appointment is confirmed. Here are your details:</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Date</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.dateLabel}</td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Time</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.duration}</td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Party Size</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.partySize} ${d.partySize === 1 ? 'person' : 'people'}</td></tr>
    </table>
    <p style="color:${BRAND.navy};font-size:14px;font-weight:bold;margin:20px 0 8px;">Services Selected:</p>
    <table style="width:100%;border-collapse:collapse;">${serviceRows}</table>
    <div style="background:#f8f5f0;border-radius:12px;padding:16px 20px;margin:24px 0;text-align:center;">
      <p style="color:${BRAND.navy};font-size:18px;font-weight:bold;margin:0;">Estimated Total: ${d.estimatedTotal}</p>
      <p style="color:${BRAND.gray};font-size:12px;margin:6px 0 0;">${d.paymentNote}</p>
    </div>
    <p style="color:${BRAND.gray};font-size:13px;line-height:1.6;">See you at <strong>${d.locationLine}</strong> on ${d.dateLabel} at ${d.duration}.</p>
    <p style="color:${BRAND.gray};font-size:13px;line-height:1.6;">Questions? Call or text us at <a href="tel:6319989325" style="color:${BRAND.navy};font-weight:600;">${STUDIO_PHONE_DISPLAY}</a>.</p>
  </div>
  <div style="background:${BRAND.footerBg};padding:20px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:12px;margin:0;">295 Montauk Highway, Suite 7 · Speonk, NY 11972</p>
  </div>
</div>
</body></html>`
}

interface AdminNotifyData {
  name: string
  email: string
  phone: string
  eventName: string
  dateLabel: string
  duration: string
  services: string[]
  partySize: number
  notes?: string | null
  estimatedTotal: string
  paymentNote: string
}

export function appointmentAdminNotifyHtml(raw: AdminNotifyData): string {
  const d = escapeFields(raw)
  const serviceList = d.services.map(s => `<li style="padding:2px 0;color:${BRAND.gray};">${s}</li>`).join('')
  const notesRow = d.notes
    ? `<tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Notes</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.notes}</td></tr>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:28px 40px;text-align:center;">
    <h1 style="color:${BRAND.navy};font-size:22px;margin:0;font-weight:normal;">New ${d.eventName} Booking</h1>
  </div>
  <div style="padding:28px 40px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Name</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.name}</td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Email</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><a href="${mailToHref(raw.email)}" style="color:${BRAND.navy};">${d.email}</a></td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Phone</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><a href="${telHref(raw.phone)}" style="color:${BRAND.navy};">${d.phone}</a></td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Date</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.dateLabel}</td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Time</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.duration}</td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Party Size</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.partySize} ${d.partySize === 1 ? 'person' : 'people'}</td></tr>
      ${notesRow}
    </table>
    <p style="color:${BRAND.navy};font-size:14px;font-weight:bold;margin:20px 0 8px;">Services:</p>
    <ul style="margin:0;padding-left:20px;">${serviceList}</ul>
    <div style="background:#f8f5f0;border-radius:12px;padding:14px 20px;margin:20px 0;text-align:center;">
      <p style="color:${BRAND.navy};font-size:18px;font-weight:bold;margin:0;">Est. Total: ${d.estimatedTotal}</p>
      <p style="color:${BRAND.gray};font-size:12px;margin:6px 0 0;">${d.paymentNote}</p>
    </div>
  </div>
</div>
</body></html>`
}
