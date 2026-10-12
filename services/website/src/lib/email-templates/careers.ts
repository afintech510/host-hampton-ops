/**
 * The two emails a /join-the-team application sends.
 *
 *   jobApplicationOwnerEmail   → the owner alert. Every applicant value is
 *                                escaped at entry; the portfolio link goes
 *                                through `mailHrefExternal`, the admin link
 *                                through `mailHref`, the reply link through
 *                                `mailToHref`, the call link through `telHref`.
 *   jobApplicationConfirmEmail → the applicant's confirmation, signed ALLIE.
 *                                Customer-facing mail is always from Allie,
 *                                never Adam (memory: customer-messages-sign-as-allie).
 *
 * Each returns HTML and a plain-text half. The plain text is built from the RAW
 * values and is never escaped — an `&amp;` in front of an applicant is a bug,
 * just a quieter one (lib/emailSafety.ts).
 */

import { escapeFields, mailHref, mailHrefExternal, mailToHref, telHref } from '../emailSafety'

export interface JobApplicationAlert {
  applicationRef: string | null
  name: string
  email: string
  phone: string
  roleLabel: string
  weekendLabel: string
  weekdayLabel: string
  carLabel: string
  heardLabel: string
  /** Lead answers — null when the applicant did not get those questions. */
  leadAnswers: { label: string; value: string }[] | null
  helperAnswers: { label: string; value: string }[] | null
  whyUs: string
  portfolioUrl: string | null
  adminUrl: string
  /** Set when the database refused the row: the email is then the only copy. */
  notSaved: boolean
}

/** Subject lines are a header, not markup: flatten whitespace, never escape. */
function subjectSafe(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 120)
}

const ROW = 'padding:6px 12px 6px 0;color:#7a8296;font-size:13px;vertical-align:top;white-space:nowrap;'
const VAL = 'padding:6px 0;color:#1a2744;font-size:14px;vertical-align:top;'

export function jobApplicationOwnerEmail(raw: JobApplicationAlert): { subject: string; html: string; text: string } {
  const d = escapeFields(raw)
  // Computed once for the `if`s below; each href calls its screen inline so the
  // tripwire (emailTemplateEscaping.test.ts) can see the screen at the attribute.
  const portfolio = mailHrefExternal(raw.portfolioUrl)
  const admin = mailHref(raw.adminUrl)
  const reply = mailToHref(raw.email)
  const call = telHref(raw.phone)

  const tableRows = (rows: { label: string; value: string }[]) =>
    rows
      .map(r => `<tr><td style="${ROW}">${r.label}</td><td style="${VAL}">${r.value.replace(/\n/g, '<br>')}</td></tr>`)
      .join('')

  const basics = [
    { label: 'Role', value: d.roleLabel },
    { label: 'Email', value: reply ? `<a href="${mailToHref(raw.email)}" style="color:#1a2744;">${d.email}</a>` : d.email },
    { label: 'Phone', value: call ? `<a href="${telHref(raw.phone)}" style="color:#1a2744;">${d.phone}</a>` : d.phone },
    { label: 'Weekends', value: d.weekendLabel },
    { label: 'Weekdays', value: d.weekdayLabel },
    { label: 'Car + license', value: d.carLabel },
    { label: 'Heard via', value: d.heardLabel },
  ]

  const html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#1a2744;">
    ${raw.notSaved ? `<p style="background:#fde8e8;color:#9b1c1c;padding:12px 16px;border-radius:8px;font-size:14px;"><strong>This application did NOT save to the database.</strong> This email is the only copy — keep it.</p>` : ''}
    <h2 style="font-size:20px;margin:0 0 4px;">New job application: ${d.name}</h2>
    <p style="font-size:13px;color:#7a8296;margin:0 0 16px;">${d.applicationRef ?? 'no reference'} &middot; /join-the-team</p>
    <table style="border-collapse:collapse;margin-bottom:16px;">${tableRows(basics)}</table>
    ${d.leadAnswers ? `<h3 style="font-size:15px;margin:20px 0 6px;">Party Lead answers</h3><table style="border-collapse:collapse;">${tableRows(d.leadAnswers)}</table>` : ''}
    ${portfolio ? `<p style="font-size:14px;margin:8px 0;"><a href="${mailHrefExternal(raw.portfolioUrl)}" style="color:#1a2744;font-weight:600;">Portfolio / photos</a></p>` : ''}
    ${d.helperAnswers ? `<h3 style="font-size:15px;margin:20px 0 6px;">Party Helper answers</h3><table style="border-collapse:collapse;">${tableRows(d.helperAnswers)}</table>` : ''}
    <h3 style="font-size:15px;margin:20px 0 6px;">Why Host Hampton</h3>
    <blockquote style="border-left:3px solid #E8C7CB;padding:8px 14px;margin:0 0 20px;color:#555;font-size:14px;">${d.whyUs.replace(/\n/g, '<br>')}</blockquote>
    ${admin ? `<p><a href="${mailHref(raw.adminUrl)}" style="display:inline-block;background:#1a2744;color:#F6F1EB;padding:10px 20px;border-radius:999px;text-decoration:none;font-weight:600;font-size:14px;">Open all applications</a></p>` : ''}
  </div>`

  const lines = (rows: { label: string; value: string }[] | null) =>
    rows ? rows.map(r => `${r.label}: ${r.value}`).join('\n') : ''

  const text = [
    raw.notSaved ? 'THIS APPLICATION DID NOT SAVE TO THE DATABASE. This email is the only copy.\n' : '',
    `New job application: ${raw.name} (${raw.applicationRef ?? 'no reference'})`,
    '',
    `Role: ${raw.roleLabel}`,
    `Email: ${raw.email}`,
    `Phone: ${raw.phone}`,
    `Weekends: ${raw.weekendLabel}`,
    `Weekdays: ${raw.weekdayLabel}`,
    `Car + license: ${raw.carLabel}`,
    `Heard via: ${raw.heardLabel}`,
    raw.leadAnswers ? `\nParty Lead answers\n${lines(raw.leadAnswers)}` : '',
    raw.portfolioUrl ? `Portfolio: ${raw.portfolioUrl}` : '',
    raw.helperAnswers ? `\nParty Helper answers\n${lines(raw.helperAnswers)}` : '',
    `\nWhy Host Hampton:\n${raw.whyUs}`,
    '',
    `All applications: ${raw.adminUrl}`,
  ]
    .filter(l => l !== '')
    .join('\n')

  return {
    subject: subjectSafe(`${raw.notSaved ? '[NOT SAVED] ' : ''}Job application: ${raw.name} — ${raw.roleLabel}`),
    html,
    text,
  }
}

export interface JobApplicationConfirm {
  firstName: string
  roleLabel: string
}

export function jobApplicationConfirmEmail(raw: JobApplicationConfirm): { subject: string; html: string; text: string } {
  const d = escapeFields(raw)

  const html = `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1a2744;">
    <h2 style="font-size:20px;margin-bottom:12px;">Hi ${d.firstName}!</h2>
    <p style="font-size:14px;line-height:1.7;color:#444;">Thank you for applying to join the Host Hampton team (${d.roleLabel}). We read every application ourselves, and if it looks like a good fit we'll call or text you to set up a time to meet.</p>
    <p style="font-size:14px;line-height:1.7;color:#444;">Our parties are mostly on weekends, at our studio in Speonk and at families' homes across the East End. If anything changes with your availability in the meantime, just reply to this email.</p>
    <p style="font-size:14px;line-height:1.7;color:#444;margin-top:24px;">Talk soon,<br>Allie<br><span style="color:#888;">Host Hampton</span></p>
  </div>`

  const text = [
    `Hi ${raw.firstName}!`,
    '',
    `Thank you for applying to join the Host Hampton team (${raw.roleLabel}). We read every application ourselves, and if it looks like a good fit we'll call or text you to set up a time to meet.`,
    '',
    "Our parties are mostly on weekends, at our studio in Speonk and at families' homes across the East End. If anything changes with your availability in the meantime, just reply to this email.",
    '',
    'Talk soon,',
    'Allie',
    'Host Hampton',
  ].join('\n')

  return { subject: 'Thanks for applying to Host Hampton', html, text }
}
