const BRAND = {
  headerBg: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  footerBg: '#BCCDEB',
  bodyBg: '#F6F1EB',
  navy: '#1a2744',
  gray: '#555',
} as const

interface ConfirmationData {
  name: string
  timeSlot: string
  services: string[]
  partySize: number
  estimatedTotal: number
  duration?: string
}

export function summerHairConfirmationHtml(d: ConfirmationData): string {
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
    <h1 style="color:${BRAND.navy};font-size:26px;margin:0 0 6px;font-weight:normal;">You're Booked! ✨</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">Summer Hair — Friday, July 3</p>
  </div>
  <div style="padding:36px 40px;">
    <p style="color:${BRAND.navy};font-size:16px;line-height:1.7;">Hi ${firstName}!</p>
    <p style="color:${BRAND.gray};font-size:14px;line-height:1.7;">Your Summer Hair appointment is confirmed. Here are your details:</p>
    <table style="width:100%;border-collapse:collapse;margin:20px 0;">
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Time</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.duration || d.timeSlot}</td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Party Size</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.partySize} ${d.partySize === 1 ? 'person' : 'people'}</td></tr>
    </table>
    <p style="color:${BRAND.navy};font-size:14px;font-weight:bold;margin:20px 0 8px;">Services Selected:</p>
    <table style="width:100%;border-collapse:collapse;">${serviceRows}</table>
    <div style="background:#f8f5f0;border-radius:12px;padding:16px 20px;margin:24px 0;text-align:center;">
      <p style="color:${BRAND.navy};font-size:18px;font-weight:bold;margin:0;">Estimated Total: $${d.estimatedTotal}</p>
      <p style="color:${BRAND.gray};font-size:12px;margin:6px 0 0;">Payable in person</p>
    </div>
    <p style="color:${BRAND.gray};font-size:13px;line-height:1.6;">See you at <strong>295 Montauk Highway, Suite 7, Speonk, NY 11972</strong> on Friday, July 3rd at ${d.duration || d.timeSlot}.</p>
    <p style="color:${BRAND.gray};font-size:13px;line-height:1.6;">Questions? Call or text us at <a href="tel:6319989325" style="color:${BRAND.navy};font-weight:600;">(631) 998-9325</a>.</p>
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
  timeSlot: string
  services: string[]
  partySize: number
  notes?: string | null
  estimatedTotal: number
  duration?: string
}

export function summerHairAdminNotifyHtml(d: AdminNotifyData): string {
  const serviceList = d.services.map(s => `<li style="padding:2px 0;color:${BRAND.gray};">${s}</li>`).join('')
  const notesRow = d.notes
    ? `<tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Notes</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.notes}</td></tr>`
    : ''

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:620px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:28px 40px;text-align:center;">
    <h1 style="color:${BRAND.navy};font-size:22px;margin:0;font-weight:normal;">New Summer Hair Booking</h1>
  </div>
  <div style="padding:28px 40px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Name</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.name}</td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Email</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><a href="mailto:${d.email}" style="color:${BRAND.navy};">${d.email}</a></td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Phone</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><a href="tel:${d.phone}" style="color:${BRAND.navy};">${d.phone}</a></td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Time</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.duration || d.timeSlot}</td></tr>
      <tr><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;"><strong>Party Size</strong></td><td style="padding:8px 0;color:${BRAND.gray};border-bottom:1px solid #f0ece7;">${d.partySize} ${d.partySize === 1 ? 'person' : 'people'}</td></tr>
      ${notesRow}
    </table>
    <p style="color:${BRAND.navy};font-size:14px;font-weight:bold;margin:20px 0 8px;">Services:</p>
    <ul style="margin:0;padding-left:20px;">${serviceList}</ul>
    <div style="background:#f8f5f0;border-radius:12px;padding:14px 20px;margin:20px 0;text-align:center;">
      <p style="color:${BRAND.navy};font-size:18px;font-weight:bold;margin:0;">Est. Total: $${d.estimatedTotal}</p>
    </div>
  </div>
</div>
</body></html>`
}
