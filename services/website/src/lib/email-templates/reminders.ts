/* ── Shared brand tokens (mirrors emailTemplates.ts) ─────────── */
const BRAND = {
  headerBg: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  footerBg: '#BCCDEB',
  bodyBg: '#F6F1EB',
  cardBorder: 'linear-gradient(135deg,#A1B5C8 0%,#E8C7CB 100%)',
  navy: '#1a2744',
  gray: '#555',
  ctaBg: '#1a2744',
  ctaText: '#F6F1EB',
} as const

const contactBlock = `
  <strong><a href="tel:6319989325" style="color:${BRAND.navy};text-decoration:none;">(631) 998-9325</a></strong> &nbsp;&middot;&nbsp;
  <strong><a href="mailto:hosthampton295@gmail.com" style="color:${BRAND.navy};text-decoration:none;">hosthampton295@gmail.com</a></strong>`

function reminderFooter(): string {
  return `
  <div style="background:${BRAND.footerBg};padding:20px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">295 Montauk Highway, Suite 7 &middot; Speonk, NY 11972</p>
    <p style="color:${BRAND.navy};opacity:0.5;font-size:11px;margin:0;">Host Hampton &middot; (631) 998-9325</p>
  </div>`
}

function reminderWrapper(headerContent: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:36px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton &middot; Speonk, NY</p>
    ${headerContent}
  </div>
  <div style="padding:36px 40px;">
    ${bodyContent}
    <p style="font-size:14px;color:${BRAND.gray};line-height:1.8;margin:24px 0 0;">
      Questions? We&rsquo;re here anytime:<br>${contactBlock}
    </p>
  </div>
  ${reminderFooter()}
</div>
</body></html>`
}

function detailCard(rows: { label: string; value: string }[]): string {
  const rowHtml = rows.map((r, i) => {
    const border = i > 0 ? `border-top:1px solid #f0ece7;` : ''
    return `<tr>
      <td style="padding:9px 0;color:${BRAND.gray};width:130px;${border}"><strong>${r.label}</strong></td>
      <td style="padding:9px 0;color:${BRAND.gray};${border}">${r.value}</td>
    </tr>`
  }).join('')

  return `<div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin-bottom:24px;">
    <div style="background:white;border-radius:10px;padding:22px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        ${rowHtml}
      </table>
    </div>
  </div>`
}

/* ── a) Event Reminder — 3 Days Out ───────────────────────────── */

export interface ReminderEvent3DayParams {
  customerName: string
  eventTitle: string
  eventDate: string
  eventTime: string
  location: string
}

export function reminderEvent3DayHtml(params: ReminderEvent3DayParams): string {
  const { customerName, eventTitle, eventDate, eventTime, location } = params
  const firstName = customerName.split(' ')[0] || 'there'

  const headerContent = `
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">Your Event Is Coming Up!</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">${eventTitle} &mdash; just 3 days away</p>`

  const bodyContent = `
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">We can&rsquo;t wait to see you at <strong>${eventTitle}</strong>! Here&rsquo;s everything you need for a smooth arrival.</p>
    ${detailCard([
      { label: 'Event', value: eventTitle },
      { label: 'Date', value: eventDate },
      { label: 'Time', value: eventTime },
      { label: 'Location', value: location },
    ])}
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 12px;">What to Bring</h3>
      <ul style="margin:0;padding-left:20px;color:${BRAND.gray};font-size:14px;line-height:2.1;">
        <li>Your ticket confirmation email (or ticket reference number)</li>
        <li>A valid photo ID (for adult events)</li>
        <li>Comfortable clothing you don&rsquo;t mind getting creative in</li>
        <li>Any excitement you can carry &mdash; this is going to be fun!</li>
      </ul>
    </div>
    <div style="background:#e6f0e8;border-radius:10px;padding:16px 20px;border:1px solid #b8d4bc;">
      <p style="margin:0;font-size:14px;color:#1a5c2a;">&#128205; <strong>${location}</strong> &mdash; free parking available on-site.</p>
    </div>`

  return reminderWrapper(headerContent, bodyContent)
}

/* ── b) Event Reminder — Day Of ──────────────────────────────── */

export interface ReminderEventDayOfParams {
  customerName: string
  eventTitle: string
  eventTime: string
  location: string
}

export function reminderEventDayOfHtml(params: ReminderEventDayOfParams): string {
  const { customerName, eventTitle, eventTime, location } = params
  const firstName = customerName.split(' ')[0] || 'there'
  const mapsUrl = `https://maps.google.com/?q=295+Montauk+Highway+Suite+7+Speonk+NY+11972`

  const headerContent = `
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">See You Today!</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">${eventTitle} starts at ${eventTime}</p>`

  const bodyContent = `
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Today&rsquo;s the day! <strong>${eventTitle}</strong> is happening today at <strong>${eventTime}</strong>. We&rsquo;re getting everything ready and we&rsquo;re so excited to see you.</p>
    ${detailCard([
      { label: 'Today&rsquo;s Event', value: eventTitle },
      { label: 'Start Time', value: eventTime },
      { label: 'Address', value: `${location}, 295 Montauk Hwy, Suite 7, Speonk NY 11972` },
    ])}
    <div style="background:#e6f0e8;border-radius:10px;padding:20px;margin-bottom:20px;border:1px solid #b8d4bc;text-align:center;">
      <p style="margin:0 0 12px;font-size:14px;color:#1a5c2a;font-weight:bold;">295 Montauk Highway, Suite 7 &mdash; Speonk, NY 11972</p>
      <a href="${mapsUrl}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;padding:10px 24px;border-radius:50px;text-decoration:none;font-size:13px;font-weight:bold;">Open in Google Maps</a>
    </div>
    <div style="background:#f0ece7;border-radius:10px;padding:16px 20px;">
      <p style="margin:0;font-size:14px;color:${BRAND.gray};">&#128336; Plan to arrive a few minutes early so you can get settled and enjoy every moment!</p>
    </div>`

  return reminderWrapper(headerContent, bodyContent)
}

/* ── c) Booking Reminder — 7 Days Out ────────────────────────── */

export interface ReminderBooking7DayParams {
  customerName: string
  bookingRef: string
  partyDate: string
  partyTime: string
  packageName?: string
  balanceDueNote?: string
}

export function reminderBooking7DayHtml(params: ReminderBooking7DayParams): string {
  const { customerName, bookingRef, partyDate, partyTime, packageName, balanceDueNote } = params
  const firstName = customerName.split(' ')[0] || 'there'

  const packageRow = packageName
    ? { label: 'Package', value: packageName }
    : null

  const cardRows = [
    { label: 'Booking Ref', value: bookingRef },
    { label: 'Party Date', value: partyDate },
    { label: 'Party Time', value: partyTime },
    ...(packageRow ? [packageRow] : []),
  ]

  const balanceBlock = balanceDueNote
    ? `<div style="background:#fffbeb;border-left:4px solid #f59e0b;border-radius:6px;padding:14px 16px;margin-bottom:20px;">
        <p style="margin:0;font-size:14px;color:#92400e;"><strong>Balance Due:</strong> ${balanceDueNote}</p>
      </div>`
    : ''

  const headerContent = `
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">Your Party Is in One Week!</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">Time to get excited &mdash; we&rsquo;re getting ready for you</p>`

  const bodyContent = `
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 20px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 24px;">Just one week to go! We&rsquo;re putting the finishing touches on everything to make your celebration absolutely magical. Here&rsquo;s a quick recap of your booking:</p>
    ${detailCard(cardRows)}
    ${balanceBlock}
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:20px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 12px;">Quick Checklist</h3>
      <table style="width:100%;font-size:13px;color:${BRAND.gray};">
        <tr><td style="padding:5px 0;vertical-align:top;width:20px;">&#9744;</td><td style="padding:5px 0;">Confirm your headcount with us if it has changed</td></tr>
        <tr><td style="padding:5px 0;vertical-align:top;">&#9744;</td><td style="padding:5px 0;">Let us know of any food allergies or special accommodations</td></tr>
        <tr><td style="padding:5px 0;vertical-align:top;">&#9744;</td><td style="padding:5px 0;">Share your digital EVITE with guests if you haven&rsquo;t already</td></tr>
        <tr><td style="padding:5px 0;vertical-align:top;">&#9744;</td><td style="padding:5px 0;">Arrange cake pickup / delivery for party day</td></tr>
      </table>
    </div>
    <div style="background:#e6f0e8;border-radius:10px;padding:16px 20px;border:1px solid #b8d4bc;">
      <p style="margin:0;font-size:14px;color:#1a5c2a;">Need to update your headcount or have a question? Just reply to this email or give us a call!</p>
    </div>`

  return reminderWrapper(headerContent, bodyContent)
}

/* ── d) Booking Reminder — 1 Day Out ─────────────────────────── */

export interface ReminderBooking1DayParams {
  customerName: string
  partyTime: string
  packageName?: string
}

export function reminderBooking1DayHtml(params: ReminderBooking1DayParams): string {
  const { customerName, partyTime, packageName } = params
  const firstName = customerName.split(' ')[0] || 'there'
  const mapsUrl = `https://maps.google.com/?q=295+Montauk+Highway+Suite+7+Speonk+NY+11972`

  const packageLine = packageName
    ? `<p style="color:${BRAND.gray};font-size:14px;margin:0 0 20px;">Your <strong>${packageName}</strong> is all set and ready for an unforgettable party.</p>`
    : ''

  const headerContent = `
    <h1 style="color:${BRAND.navy};font-size:28px;margin:0 0 6px;font-weight:normal;">Tomorrow&rsquo;s the Big Day!</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">We&rsquo;re so excited to celebrate with you</p>`

  const bodyContent = `
    <p style="font-size:16px;color:${BRAND.navy};margin:0 0 16px;">Hi ${firstName},</p>
    <p style="color:${BRAND.gray};line-height:1.7;margin:0 0 16px;">Get ready &mdash; your celebration is <strong>tomorrow at ${partyTime}</strong>! The team at Host Hampton has been busy setting the stage for an amazing party.</p>
    ${packageLine}
    ${detailCard([
      { label: 'Arrival Time', value: partyTime },
      { label: 'Address', value: '295 Montauk Highway, Suite 7' },
      { label: 'City', value: 'Speonk, NY 11972' },
    ])}
    <div style="background:#e6f0e8;border-radius:10px;padding:20px;margin-bottom:20px;border:1px solid #b8d4bc;text-align:center;">
      <p style="margin:0 0 12px;font-size:14px;color:#1a5c2a;font-weight:bold;">295 Montauk Highway, Suite 7 &mdash; Speonk, NY 11972</p>
      <a href="${mapsUrl}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;padding:10px 24px;border-radius:50px;text-decoration:none;font-size:13px;font-weight:bold;">Get Directions</a>
    </div>
    <div style="background:#f0ece7;border-radius:10px;padding:20px;margin-bottom:4px;">
      <h3 style="font-size:14px;color:${BRAND.navy};margin:0 0 10px;">A Few Tips for Party Day</h3>
      <ul style="margin:0;padding-left:20px;color:${BRAND.gray};font-size:13px;line-height:2;">
        <li>Plan to arrive at your booked time &mdash; setup is ready and waiting!</li>
        <li>Free parking is available at 295 Montauk Hwy</li>
        <li>A 10&ndash;15% gratuity for your party helpers is always appreciated</li>
        <li>Enjoy every moment &mdash; you deserve this celebration!</li>
      </ul>
    </div>`

  return reminderWrapper(headerContent, bodyContent)
}
