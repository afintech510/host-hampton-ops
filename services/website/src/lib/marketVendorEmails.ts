/**
 * Emails for a market vendor booth.
 *
 * Every interpolation below goes through `escapeHtml` AT ENTRY — the field is
 * escaped as it is read into the template, not somewhere downstream where a
 * later edit can route around it. `business_name` and `contact_name` are
 * attacker-supplied through a public form, and a business called
 * `<script>` is a perfectly legal thing to type into it.
 *
 * The one value that is NOT escaped as text is the mailto, which goes through
 * `mailToHref` — a URL needs a screen and then encoding, not HTML escaping.
 */

import { escapeHtml } from '@/lib/escapeHtml'
import { mailToHref } from '@/lib/emailSafety'

const SHELL_OPEN = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F6F1EB;font-family:sans-serif;">
<div style="max-width:560px;margin:0 auto;background:#ffffff;">`

const SHELL_CLOSE = `  <div style="background:#BCCDEB;padding:20px 40px;text-align:center;">
    <p style="color:#1a2744;font-size:12px;margin:0;">Host Hampton &middot; 295 Montauk Highway, Suite 7, Speonk, NY 11972</p>
  </div>
</div>
</body></html>`

function row(label: string, value: string, shaded: boolean): string {
  return `<tr${shaded ? ' style="background:#f9f9f9;"' : ''}>` +
    `<td style="padding:10px 12px;font-weight:bold;color:#1a2744;width:150px;">${escapeHtml(label)}</td>` +
    `<td style="padding:10px 12px;color:#555;">${value}</td></tr>`
}

export function marketVendorConfirmationHtml(v: {
  firstName: string
  businessName: string
  vendorRef: string
  money: string
  marketName: string
  dateLabel: string
  timeLabel: string
  locationLine: string
}): string {
  const firstName = escapeHtml(v.firstName)
  const businessName = escapeHtml(v.businessName)
  const vendorRef = escapeHtml(v.vendorRef)
  const money = escapeHtml(v.money)
  const marketName = escapeHtml(v.marketName)
  const dateLabel = escapeHtml(v.dateLabel)
  const timeLabel = escapeHtml(v.timeLabel)
  const locationLine = escapeHtml(v.locationLine)

  return `${SHELL_OPEN}
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:36px 40px;text-align:center;">
    <p style="color:#1a2744;opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 10px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:#1a2744;font-size:26px;margin:0;font-weight:normal;font-family:Georgia,serif;">Your booth is confirmed</h1>
  </div>
  <div style="padding:32px 40px;">
    <p style="color:#555;font-size:15px;line-height:1.7;margin:0 0 24px;">
      Hi ${firstName} &mdash; you&rsquo;re booked into the <strong style="color:#1a2744;">${marketName}</strong>. We&rsquo;re so glad to have ${businessName} with us.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:24px;">
      ${row('Business', businessName, true)}
      ${row('When', `${dateLabel}<br>${timeLabel}`, false)}
      ${row('Where', locationLine, true)}
      ${row('Booth fee', `<span style="color:#059669;font-weight:bold;">${money} paid &check;</span>`, false)}
      ${row('Vendor ref', `<span style="color:#888;font-size:12px;">${vendorRef}</span>`, true)}
    </table>
    <div style="background:#F7F2E8;border-radius:10px;padding:18px 20px;margin-bottom:24px;">
      <p style="color:#1a2744;font-size:14px;font-weight:bold;margin:0 0 10px;">Before the day</p>
      <ul style="color:#555;font-size:14px;line-height:1.8;margin:0;padding-left:18px;">
        <li><strong>Bring your own table</strong> and anything you need to dress it.</li>
        <li>Power is available &mdash; tell us in advance if you need an outlet.</li>
        <li>Setup starts at <strong>9:00am</strong>; please be ready to sell by 10:00.</li>
        <li>We&rsquo;ll be promoting the market &mdash; tag us <strong>@hosthampton</strong> and we&rsquo;ll share your posts.</li>
      </ul>
    </div>
    <p style="color:#888;font-size:13px;line-height:1.6;margin:0;">
      Questions, or need to change something? Text or call <strong style="color:#1a2744;">(631) 998-9325</strong>.
    </p>
  </div>
${SHELL_CLOSE}`
}

export function marketVendorOwnerHtml(v: {
  vendorRef: string
  contactName: string
  businessName: string
  igHandle: string | null
  email: string
  phone: string
  productCategory: string
  money: string
  marketName: string
}): string {
  return `${SHELL_OPEN}
  <div style="background:linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%);padding:20px 28px;">
    <h2 style="color:#1a2744;margin:0;font-size:18px;">New vendor &mdash; ${escapeHtml(v.marketName)}</h2>
    <p style="color:#1a2744;opacity:0.7;margin:4px 0 0;font-size:13px;">${escapeHtml(v.vendorRef)}</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      ${row('Name', escapeHtml(v.contactName), true)}
      ${row('Business', escapeHtml(v.businessName), false)}
      ${row('Sells', escapeHtml(v.productCategory), true)}
      ${row('Instagram', escapeHtml(v.igHandle || '—'), false)}
      ${row('Email', `<a href="${mailToHref(v.email)}">${escapeHtml(v.email)}</a>`, true)}
      ${row('Phone', escapeHtml(v.phone || '—'), false)}
      ${row('Paid', `<span style="color:#059669;font-weight:bold;">${escapeHtml(v.money)} &check;</span>`, true)}
    </table>
  </div>
${SHELL_CLOSE}`
}
