/**
 * Every EVITE email body (spec §9.1): ten sends, each `{ subject, html, text }`.
 *
 *   lead_preview     to the person who enquired: "Here's Mia's Glow Party invitation"
 *   invite_ready     to the parent once the party is booked: "...is ready!" + magic link
 *   new_rsvp         to the parent: who answered
 *   rsvp_changed     to the parent: an answer changed
 *   rsvp_confirmed   to the guest: "you're on the list" (+ .ics)
 *   week_before      to the guest, a week out (+ .ics)
 *   day_before       to the guest, the day before: time, full address, arrival note (+ .ics)
 *   details_changed  to the guest when the date, time or place moved (+ .ics)
 *   final_headcount  to the parent after the day-before reminders: totals and allergies
 *   party_cancelled  to the guest (+ CANCEL .ics)
 *
 * RULES THIS FILE HOLDS (all checked by `emailTemplateEscaping.test.ts` or `evitesMail.test.ts`):
 *   - TEXT in an element body is escaped ONCE, at entry: `const d = escapeFields(raw)`. The
 *     HTML half reads `d`; the plain-text half and the SUBJECT read `raw`, and are never
 *     escaped (an `&amp;` in front of a parent is a bug, just a quieter one).
 *   - A URL in an href / src is read from `raw` and goes through `mailHref` (our own pages) or
 *     `mailHrefExternal` (a stored image, a maps link), never `escapeHtml`. A URL that does
 *     not survive its screen renders NO link, not a different one.
 *   - Dates are written out, from the facts' own strings ("Saturday, November 14"). Nothing
 *     here says "tomorrow" or "today": a reminder opened a week late must not lie.
 *   - Signed "Allie & the Host Hampton team". Customer messages are always from Allie.
 *   - `lead_preview` carries the physical address, the signed unsubscribe link and the
 *     `List-Unsubscribe` headers; it is a one-time follow-up to the person's own enquiry.
 *   - `day_before` never renders the arrival-note placeholder (`STUDIO_ARRIVAL_NOTE` is a
 *     TODO until it is worded): it checks the sentinel itself.
 *
 * The templates build NO URLs and read NO database: the caller (`lib/evites/sendOne.ts`) mints
 * the portal link, signs the guest's edit link and builds the .ics, then hands the strings in.
 */

import { escapeFields, mailHref, mailHrefExternal } from '@/lib/emailSafety'
import { buildUnsubscribeUrl, unsubscribeHeaders } from '@/lib/unsubscribeLink'
import {
  STUDIO_ARRIVAL_NOTE,
  STUDIO_ARRIVAL_NOTE_READY,
  STUDIO_ARRIVAL_NOTE_SENTINEL,
  STUDIO_LOCALITY,
  STUDIO_STREET,
} from '@/lib/studioLocation'

/* ── shared types ─────────────────────────────────────────────── */

export interface EviteEmail {
  subject: string
  html: string
  /** The plain-text half. Never escaped. */
  text: string
  /** Only `lead_preview` has any (`List-Unsubscribe`). */
  headers?: Record<string, string>
}

/** The party, as the facts say it. Every string is the facts' own. */
export interface EviteMailParty {
  /** 'Mia', or null when the booking has no name. */
  honoree: string | null
  /** 'Glow Party' | 'Birthday Party' */
  partyNoun: string
  /** "Mia's Glow Party" | 'Glow Birthday Party' */
  title: string
  /** 'Saturday, November 14 · 2–4 PM' (or the date alone, or 'Pick your date' in a preview). */
  dateLine: string
  /** The page's place line. */
  placeLine: string
  /** The calendar location: the full address. Null for a mobile party with none. */
  fullAddress: string | null
  /** 'Any questions? Ask Allie · 631-998-9325', or null when the host hid it. */
  hostContactLine: string | null
  locationType: 'studio' | 'mobile'
}

export interface EviteGuestLinks {
  /** `/i/<slug>/cal` */
  calendar: string
  /** The guest's own signed edit link. */
  edit: string
  /** The edit link + `?stop=1`. */
  stop: string
}

export interface LeadPreviewInput {
  party: EviteMailParty
  recipientFirstName: string | null
  /** The stored invitation image (absolute), or null: then the email simply has no picture. */
  imageUrl: string | null
  inviteUrl: string
  /** The minted planner / invoice link. NULL when the mint failed: the button is omitted. */
  reserveUrl: string | null
  /** From `generateUnsubscribeToken(email)`; the caller does not send without one. */
  unsubscribeToken: string
}

export interface InviteReadyInput {
  party: EviteMailParty
  recipientFirstName: string | null
  /** The minted `/my-booking/invitation` magic link. REQUIRED: the template refuses to render without a usable one. */
  magicUrl: string
}

export interface ParentRsvpInput {
  party: EviteMailParty
  recipientFirstName: string | null
  rsvp: {
    status: 'yes' | 'no'
    parentName: string
    childNames: string[]
    adultCount: 0 | 1 | 2
    hasAllergy: boolean | null
    allergyNote: string | null
  }
  /** `/my-booking/invitation` */
  hostUrl: string
}

export interface GuestMailInput {
  party: EviteMailParty
  guest: { parentName: string; childNames: string[] }
  links: EviteGuestLinks
  /** day_before only: a directions link for the studio (an external https URL). */
  mapsUrl?: string | null
  /** day_before only: overrides the studio constant (tests). A TODO placeholder is never rendered. */
  arrivalNote?: string | null
}

export interface FinalHeadcountInput {
  party: EviteMailParty
  recipientFirstName: string | null
  hostUrl: string
  summary: {
    kidsYes: number
    adultsYes: number
    adultsPlus: boolean
    noCount: number
    cap: number | null
    allergies: Array<{ parent: string; children: string[]; note: string | null }>
    notes: Array<{ parent: string; note: string }>
  }
}

export interface PartyCancelledInput {
  party: EviteMailParty
  guest: { parentName: string; childNames: string[] }
}

/* ── brand and layout (mirrors reminders.ts) ──────────────────── */

const BRAND = {
  headerBg: 'linear-gradient(135deg,#E8C7CB 0%,#A1B5C8 100%)',
  footerBg: '#BCCDEB',
  bodyBg: '#F6F1EB',
  cardBorder: 'linear-gradient(135deg,#A1B5C8 0%,#E8C7CB 100%)',
  navy: '#1a2744',
  gray: '#555',
} as const

const SIGNATURE_TEXT = 'Allie & the Host Hampton team'
const SIGNATURE_HTML = 'Allie &amp; the Host Hampton team'
const MIDDLE_DOT = ' · '

function shell(heading: string, sub: string, body: string, footerNote: string): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:${BRAND.bodyBg};">
<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#ffffff;">
  <div style="background:${BRAND.headerBg};padding:32px 40px;text-align:center;">
    <p style="color:${BRAND.navy};opacity:0.6;font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px;">Host Hampton &middot; Speonk, NY</p>
    <h1 style="color:${BRAND.navy};font-size:26px;margin:0 0 6px;font-weight:normal;">${heading}</h1>
    <p style="color:${BRAND.navy};opacity:0.7;font-size:15px;margin:0;">${sub}</p>
  </div>
  <div style="padding:32px 40px;">
    ${body}
    <p style="font-size:15px;color:${BRAND.navy};line-height:1.7;margin:28px 0 0;">${SIGNATURE_HTML}</p>
  </div>
  <div style="background:${BRAND.footerBg};padding:20px 40px;text-align:center;">
    <p style="color:${BRAND.navy};font-size:12px;margin:0 0 4px;">Host Hampton &middot; ${STUDIO_STREET} &middot; ${STUDIO_LOCALITY}</p>
    <p style="color:${BRAND.navy};opacity:0.6;font-size:11px;margin:0;">${footerNote}</p>
  </div>
</div>
</body></html>`
}

function paragraph(inner: string): string {
  return `<p style="color:${BRAND.gray};font-size:15px;line-height:1.7;margin:0 0 16px;">${inner}</p>`
}

function detailCard(rows: Array<{ label: string; value: string }>): string {
  const rowHtml = rows
    .map((r, i) => {
      const border = i > 0 ? 'border-top:1px solid #f0ece7;' : ''
      return `<tr><td style="padding:9px 0;color:${BRAND.gray};width:90px;vertical-align:top;${border}"><strong>${r.label}</strong></td><td style="padding:9px 0;color:${BRAND.gray};${border}">${r.value}</td></tr>`
    })
    .join('')
  return `<div style="background:${BRAND.cardBorder};padding:3px;border-radius:12px;margin:0 0 20px;"><div style="background:white;border-radius:10px;padding:18px 22px;"><table style="width:100%;border-collapse:collapse;font-size:14px;">${rowHtml}</table></div></div>`
}

/** One bullet: a bold lead-in and the rest. Both arrive already escaped. */
function listItem(lead: string, rest: string): string {
  return `<li><strong>${lead}</strong>${rest}</li>`
}

/** A button. The href is screened here; a URL that fails its screen renders no button at all. */
function button(href: string | null | undefined, label: string): string {
  if (!mailHref(href)) return ''
  return `<p style="text-align:center;margin:0 0 14px;"><a href="${mailHref(href)}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;padding:12px 28px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;">${label}</a></p>`
}

/** An inline link; a URL that fails its screen leaves the words, unlinked. */
function inlineLink(href: string | null | undefined, label: string): string {
  if (!mailHref(href)) return label
  return `<a href="${mailHref(href)}" style="color:${BRAND.navy};">${label}</a>`
}

/** The date part of a facts date line: 'Saturday, November 14 · 2–4 PM' -> 'Saturday, November 14'. */
function dateOnly(dateLine: string): string {
  const at = dateLine.indexOf(MIDDLE_DOT)
  return (at > 0 ? dateLine.slice(0, at) : dateLine).trim()
}

/** "Mia's Glow Party" | "your Glow Party", and the sentence-initial form. */
function ownerLabels(p: EviteMailParty): { label: string; cap: string } {
  const label = p.honoree ? `${p.honoree}'s ${p.partyNoun}` : `your ${p.partyNoun}`
  return { label, cap: label.charAt(0).toUpperCase() + label.slice(1) }
}

function firstNameHello(name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? `Hi ${first},` : 'Hi there,'
}

/** A subject is one line: a stray CR/LF in a typed name must never become a second header. */
function oneLine(s: string): string {
  return s.replace(/[\r\n\u2028\u2029]+/g, ' ').trim()
}

function adultsText(n: number, plus: boolean): string {
  if (n <= 0) return 'no adults staying'
  return `${n}${plus ? '+' : ''} adult${n === 1 && !plus ? '' : 's'}`
}

function kidsText(names: string[]): string {
  return names.length === 0 ? 'no children listed' : names.join(', ')
}

function guestLinksHtml(links: EviteGuestLinks): string {
  return (
    `<p style="color:${BRAND.gray};font-size:14px;line-height:1.9;margin:0 0 16px;">` +
    `Plans changed? ${inlineLink(links.edit, 'Update your RSVP')}<br>` +
    `${inlineLink(links.stop, 'Stop reminders')} for this party.</p>`
  )
}

function guestLinksText(links: EviteGuestLinks): string[] {
  return [`Plans changed? Update your RSVP: ${links.edit}`, `Stop reminders: ${links.stop}`]
}

const GUEST_FOOTER = 'You are getting this because you RSVP&rsquo;d to this party. Reminders are about this party only.'
const PARENT_FOOTER = 'You are getting this because you booked a party with Host Hampton.'

/* ── a) lead_preview ──────────────────────────────────────────── */

export function leadPreviewEmail(raw: LeadPreviewInput): EviteEmail {
  const d = escapeFields(raw)
  const hd = ownerLabels(d.party)
  const rw = ownerLabels(raw.party)

  const subject = oneLine(`Here's ${rw.label} invitation ✨`)
  const unsubscribeUrl = buildUnsubscribeUrl(raw.unsubscribeToken)

  const picture = mailHrefExternal(raw.imageUrl)
    ? `<p style="text-align:center;margin:0 0 20px;"><img src="${mailHrefExternal(raw.imageUrl)}" alt="The invitation" width="300" style="max-width:100%;height:auto;border-radius:12px;"></p>`
    : ''

  const body = `
    ${paragraph(`${firstNameHello(d.recipientFirstName)}`)}
    ${paragraph(`Here&rsquo;s a first look at ${hd.label} invitation, made from the details you sent us. Once your date is reserved, you can text it to your guests and watch the RSVPs come in.`)}
    ${picture}
    ${button(raw.inviteUrl, 'See the invitation')}
    ${button(raw.reserveUrl, 'Reserve your date')}
    ${paragraph(`${d.party.hostContactLine ?? ''}`)}`

  const footerNote = `You are getting this one-time note because you asked us about a party. <a href="${mailHref(unsubscribeUrl)}" style="color:${BRAND.navy};">Unsubscribe</a>`

  const text = [
    firstNameHello(raw.recipientFirstName),
    '',
    `Here's a first look at ${rw.label} invitation, made from the details you sent us. Once your date is reserved, you can text it to your guests and watch the RSVPs come in.`,
    '',
    `See the invitation: ${raw.inviteUrl}`,
    ...(raw.reserveUrl && mailHref(raw.reserveUrl) ? [`Reserve your date: ${raw.reserveUrl}`] : []),
    '',
    ...(raw.party.hostContactLine ? [raw.party.hostContactLine, ''] : []),
    SIGNATURE_TEXT,
    '',
    `Host Hampton, ${STUDIO_STREET}, ${STUDIO_LOCALITY}`,
    `You are getting this one-time note because you asked us about a party. Unsubscribe: ${unsubscribeUrl}`,
  ].join('\n')

  return {
    subject,
    html: shell(`${hd.cap} invitation`, 'A first look', body, footerNote),
    text,
    headers: unsubscribeHeaders(raw.unsubscribeToken),
  }
}

/* ── b) invite_ready ──────────────────────────────────────────── */

export function inviteReadyEmail(raw: InviteReadyInput): EviteEmail {
  const d = escapeFields(raw)
  const hd = ownerLabels(d.party)
  const rw = ownerLabels(raw.party)
  // The caller marks the send `failed` on a mint failure; this is the second lock. A dead
  // link in the one email whose whole point is the link is worse than no email.
  if (!mailHref(raw.magicUrl)) throw new Error('invite_ready: the invitation link did not survive its URL screen, so the email is not built')

  const body = `
    ${paragraph(firstNameHello(d.recipientFirstName))}
    ${paragraph(`Your party is booked, so ${hd.label} invitation is ready to share. Open it, text it to your guests, and the RSVPs will show up in one list for you.`)}
    ${detailCard([
      { label: 'When', value: d.party.dateLine },
      { label: 'Where', value: d.party.placeLine },
    ])}
    ${button(raw.magicUrl, 'Open my invitation')}
    ${paragraph('Tip: tap <strong>Text my invitation</strong> on that page to send it straight from your phone.')}`

  const text = [
    firstNameHello(raw.recipientFirstName),
    '',
    `Your party is booked, so ${rw.label} invitation is ready to share. Open it, text it to your guests, and the RSVPs will show up in one list for you.`,
    '',
    `When: ${raw.party.dateLine}`,
    `Where: ${raw.party.placeLine}`,
    '',
    `Open my invitation: ${raw.magicUrl}`,
    '',
    SIGNATURE_TEXT,
  ].join('\n')

  return {
    subject: oneLine(`${rw.cap} invitation is ready!`),
    html: shell(`${hd.cap} invitation is ready!`, 'Share it with your guests', body, PARENT_FOOTER),
    text,
  }
}

/* ── c/d) new_rsvp, rsvp_changed (to the parent) ──────────────── */

function parentRsvpEmail(raw: ParentRsvpInput, d: ParentRsvpInput, changed: boolean): EviteEmail {
  // `d` is `escapeFields(raw)`, done at the top of the two exported templates below.
  const hd = ownerLabels(d.party)
  const rw = ownerLabels(raw.party)
  const yes = raw.rsvp.status === 'yes'

  const answer = yes ? 'is coming' : "can't make it"
  const subject = oneLine(
    changed
      ? `RSVP updated: ${raw.rsvp.parentName} ${answer} to ${rw.label}`
      : `New RSVP: ${raw.rsvp.parentName} ${answer} to ${rw.label}`,
  )

  const allergyHtml = yes && raw.rsvp.hasAllergy ? (d.rsvp.allergyNote ? `Yes: ${d.rsvp.allergyNote}` : 'Yes') : yes ? 'None listed' : ''
  const allergyText = yes && raw.rsvp.hasAllergy ? (raw.rsvp.allergyNote ? `Yes: ${raw.rsvp.allergyNote}` : 'Yes') : yes ? 'None listed' : ''

  const rows = [
    { label: 'From', value: d.rsvp.parentName },
    { label: 'Answer', value: yes ? 'Yes, coming' : 'Can&rsquo;t make it' },
    ...(yes
      ? [
          { label: 'Kids', value: kidsText(d.rsvp.childNames) },
          { label: 'Adults', value: adultsText(d.rsvp.adultCount, d.rsvp.adultCount === 2) },
          { label: 'Allergies', value: allergyHtml },
        ]
      : []),
  ]

  const body = `
    ${paragraph(firstNameHello(d.recipientFirstName))}
    ${paragraph(changed ? `A guest changed their answer for ${hd.label}.` : `Someone just answered the invitation to ${hd.label}.`)}
    ${detailCard(rows)}
    ${button(raw.hostUrl, 'See your guest list')}`

  const text = [
    firstNameHello(raw.recipientFirstName),
    '',
    changed ? `A guest changed their answer for ${rw.label}.` : `Someone just answered the invitation to ${rw.label}.`,
    '',
    `From: ${raw.rsvp.parentName}`,
    `Answer: ${yes ? 'Yes, coming' : "Can't make it"}`,
    ...(yes
      ? [`Kids: ${kidsText(raw.rsvp.childNames)}`, `Adults: ${adultsText(raw.rsvp.adultCount, raw.rsvp.adultCount === 2)}`, `Allergies: ${allergyText}`]
      : []),
    '',
    `See your guest list: ${raw.hostUrl}`,
    '',
    SIGNATURE_TEXT,
  ].join('\n')

  return { subject, html: shell(changed ? 'An RSVP changed' : 'New RSVP', hd.cap, body, PARENT_FOOTER), text }
}

export function newRsvpEmail(raw: ParentRsvpInput): EviteEmail {
  const d = escapeFields(raw)
  return parentRsvpEmail(raw, d, false)
}

export function rsvpChangedEmail(raw: ParentRsvpInput): EviteEmail {
  const d = escapeFields(raw)
  return parentRsvpEmail(raw, d, true)
}

/* ── e) rsvp_confirmed ────────────────────────────────────────── */

export function rsvpConfirmedEmail(raw: GuestMailInput): EviteEmail {
  const d = escapeFields(raw)
  const hd = ownerLabels(d.party)
  const rw = ownerLabels(raw.party)

  const body = `
    ${paragraph(firstNameHello(d.guest.parentName))}
    ${paragraph(`You&rsquo;re on the list for ${hd.label}! We&rsquo;ve saved a spot for ${kidsText(d.guest.childNames)}.`)}
    ${detailCard([
      { label: 'When', value: d.party.dateLine },
      { label: 'Where', value: d.party.placeLine },
    ])}
    ${button(raw.links.calendar, 'Add to calendar')}
    ${guestLinksHtml(raw.links)}
    ${paragraph(d.party.hostContactLine ?? '')}`

  const text = [
    firstNameHello(raw.guest.parentName),
    '',
    `You're on the list for ${rw.label}! We've saved a spot for ${kidsText(raw.guest.childNames)}.`,
    '',
    `When: ${raw.party.dateLine}`,
    `Where: ${raw.party.placeLine}`,
    '',
    `Add to calendar: ${raw.links.calendar}`,
    ...guestLinksText(raw.links),
    '',
    ...(raw.party.hostContactLine ? [raw.party.hostContactLine, ''] : []),
    SIGNATURE_TEXT,
  ].join('\n')

  return {
    subject: oneLine(`You're on the list for ${rw.label}`),
    html: shell(`You&rsquo;re on the list!`, hd.cap, body, GUEST_FOOTER),
    text,
  }
}

/* ── f) week_before ───────────────────────────────────────────── */

export function weekBeforeEmail(raw: GuestMailInput): EviteEmail {
  const d = escapeFields(raw)
  const hd = ownerLabels(d.party)
  const rw = ownerLabels(raw.party)
  const date = dateOnly(raw.party.dateLine)

  const body = `
    ${paragraph(firstNameHello(d.guest.parentName))}
    ${paragraph(`A reminder that ${hd.label} is coming up on <strong>${dateOnly(d.party.dateLine)}</strong>. Here are the details.`)}
    ${detailCard([
      { label: 'When', value: d.party.dateLine },
      { label: 'Where', value: d.party.placeLine },
    ])}
    ${button(raw.links.calendar, 'Add to calendar')}
    ${guestLinksHtml(raw.links)}
    ${paragraph(d.party.hostContactLine ?? '')}`

  const text = [
    firstNameHello(raw.guest.parentName),
    '',
    `A reminder that ${rw.label} is coming up on ${date}. Here are the details.`,
    '',
    `When: ${raw.party.dateLine}`,
    `Where: ${raw.party.placeLine}`,
    '',
    `Add to calendar: ${raw.links.calendar}`,
    ...guestLinksText(raw.links),
    '',
    ...(raw.party.hostContactLine ? [raw.party.hostContactLine, ''] : []),
    SIGNATURE_TEXT,
  ].join('\n')

  return {
    subject: oneLine(`Reminder: ${rw.label} is ${date}`),
    html: shell('One week to go!', hd.cap, body, GUEST_FOOTER),
    text,
  }
}

/* ── g) day_before ────────────────────────────────────────────── */

/** The studio arrival note, or null. A TODO placeholder is NEVER returned, whoever passed it. */
function usableArrivalNote(raw: GuestMailInput): string | null {
  if (raw.party.locationType !== 'studio') return null
  const candidate = raw.arrivalNote !== undefined ? raw.arrivalNote : STUDIO_ARRIVAL_NOTE_READY ? STUDIO_ARRIVAL_NOTE : null
  if (typeof candidate !== 'string') return null
  const note = candidate.trim()
  if (note === '' || note.startsWith(STUDIO_ARRIVAL_NOTE_SENTINEL)) return null
  return note
}

export function dayBeforeEmail(raw: GuestMailInput): EviteEmail {
  const d = escapeFields(raw)
  const hd = ownerLabels(d.party)
  const rw = ownerLabels(raw.party)
  const date = dateOnly(raw.party.dateLine)
  const note = usableArrivalNote(raw)
  const noteHtml = note ? escapeFields({ note }).note : null
  const address = raw.party.fullAddress ?? raw.party.placeLine
  const addressHtml = d.party.fullAddress ?? d.party.placeLine
  const directions = mailHrefExternal(raw.mapsUrl)
    ? `<p style="text-align:center;margin:0 0 14px;"><a href="${mailHrefExternal(raw.mapsUrl)}" style="display:inline-block;background:${BRAND.navy};color:#ffffff;padding:12px 28px;border-radius:50px;text-decoration:none;font-size:14px;font-weight:bold;">Get directions</a></p>`
    : ''

  const body = `
    ${paragraph(firstNameHello(d.guest.parentName))}
    ${paragraph(`${hd.cap} is on <strong>${dateOnly(d.party.dateLine)}</strong>. We can&rsquo;t wait to see you! Everything you need:`)}
    ${detailCard([
      { label: 'When', value: d.party.dateLine },
      { label: 'Where', value: addressHtml },
    ])}
    ${noteHtml ? paragraph(`<strong>Getting here:</strong> ${noteHtml}`) : ''}
    ${directions}
    ${button(raw.links.calendar, 'Add to calendar')}
    ${guestLinksHtml(raw.links)}
    ${paragraph(d.party.hostContactLine ?? '')}`

  const text = [
    firstNameHello(raw.guest.parentName),
    '',
    `${rw.cap} is on ${date}. We can't wait to see you! Everything you need:`,
    '',
    `When: ${raw.party.dateLine}`,
    `Where: ${address}`,
    ...(note ? ['', `Getting here: ${note}`] : []),
    ...(raw.mapsUrl && mailHrefExternal(raw.mapsUrl) ? ['', `Directions: ${raw.mapsUrl}`] : []),
    '',
    `Add to calendar: ${raw.links.calendar}`,
    ...guestLinksText(raw.links),
    '',
    ...(raw.party.hostContactLine ? [raw.party.hostContactLine, ''] : []),
    SIGNATURE_TEXT,
  ].join('\n')

  return {
    subject: oneLine(`${rw.cap} is ${date}`),
    html: shell(`See you ${dateOnly(d.party.dateLine)}!`, hd.cap, body, GUEST_FOOTER),
    text,
  }
}

/* ── h) details_changed ───────────────────────────────────────── */

export function detailsChangedEmail(raw: GuestMailInput): EviteEmail {
  const d = escapeFields(raw)
  const hd = ownerLabels(d.party)
  const rw = ownerLabels(raw.party)
  const date = dateOnly(raw.party.dateLine)

  const body = `
    ${paragraph(firstNameHello(d.guest.parentName))}
    ${paragraph(`The details for ${hd.label} have changed. Please use the new ones below.`)}
    ${detailCard([
      { label: 'When', value: d.party.dateLine },
      { label: 'Where', value: d.party.placeLine },
    ])}
    ${paragraph('We&rsquo;ve attached the updated calendar event. If you saved the old one, please <strong>replace it</strong> with this one so your phone shows the right time.')}
    ${button(raw.links.calendar, 'Add to calendar')}
    ${guestLinksHtml(raw.links)}
    ${paragraph(d.party.hostContactLine ?? '')}`

  const text = [
    firstNameHello(raw.guest.parentName),
    '',
    `The details for ${rw.label} have changed. Please use the new ones below.`,
    '',
    `When: ${raw.party.dateLine}`,
    `Where: ${raw.party.placeLine}`,
    '',
    "We've attached the updated calendar event. If you saved the old one, please replace it with this one so your phone shows the right time.",
    `Add to calendar: ${raw.links.calendar}`,
    ...guestLinksText(raw.links),
    '',
    ...(raw.party.hostContactLine ? [raw.party.hostContactLine, ''] : []),
    SIGNATURE_TEXT,
  ].join('\n')

  return {
    subject: oneLine(`Update: ${rw.label} is now ${date}`),
    html: shell('New details', hd.cap, body, GUEST_FOOTER),
    text,
  }
}

/* ── i) final_headcount ───────────────────────────────────────── */

export function finalHeadcountEmail(raw: FinalHeadcountInput): EviteEmail {
  const d = escapeFields(raw)
  const hd = ownerLabels(d.party)
  const rw = ownerLabels(raw.party)
  const date = dateOnly(raw.party.dateLine)
  const s = raw.summary

  const capHtml = s.cap !== null ? ` of ${s.cap} expected` : ''
  const capText = s.cap !== null ? ` of ${s.cap} expected` : ''

  const allergyHtml =
    d.summary.allergies.length === 0
      ? paragraph('No food allergies were listed.')
      : `<ul style="margin:0 0 16px;padding-left:20px;color:${BRAND.gray};font-size:14px;line-height:1.9;">${d.summary.allergies
          .map((a) => listItem(a.parent, ` (${kidsText(a.children)})${a.note ? `: ${a.note}` : ''}`))
          .join('')}</ul>`
  const notesHtml =
    d.summary.notes.length === 0
      ? ''
      : `${paragraph('<strong>Notes from guests</strong>')}<ul style="margin:0 0 16px;padding-left:20px;color:${BRAND.gray};font-size:14px;line-height:1.9;">${d.summary.notes
          .map((n) => listItem(n.parent, `: ${n.note}`))
          .join('')}</ul>`

  const body = `
    ${paragraph(firstNameHello(d.recipientFirstName))}
    ${paragraph(`Here&rsquo;s your final headcount for ${hd.label} on <strong>${dateOnly(d.party.dateLine)}</strong>.`)}
    ${detailCard([
      { label: 'Kids', value: `${d.summary.kidsYes}${capHtml}` },
      { label: 'Adults', value: `${d.summary.adultsYes}${d.summary.adultsPlus ? '+' : ''}` },
      { label: 'Can&rsquo;t come', value: `${d.summary.noCount}` },
    ])}
    ${paragraph('<strong>Food allergies</strong>')}
    ${allergyHtml}
    ${notesHtml}
    ${button(raw.hostUrl, 'See the full list')}`

  const text = [
    firstNameHello(raw.recipientFirstName),
    '',
    `Here's your final headcount for ${rw.label} on ${date}.`,
    '',
    `Kids: ${s.kidsYes}${capText}`,
    `Adults: ${s.adultsYes}${s.adultsPlus ? '+' : ''}`,
    `Can't come: ${s.noCount}`,
    '',
    'Food allergies:',
    ...(s.allergies.length === 0
      ? ['  None listed']
      : s.allergies.map((a) => `  ${a.parent} (${kidsText(a.children)})${a.note ? `: ${a.note}` : ''}`)),
    ...(s.notes.length === 0 ? [] : ['', 'Notes from guests:', ...s.notes.map((n) => `  ${n.parent}: ${n.note}`)]),
    '',
    `See the full list: ${raw.hostUrl}`,
    '',
    SIGNATURE_TEXT,
  ].join('\n')

  return {
    subject: oneLine(`Final headcount for ${rw.label} on ${date}`),
    html: shell('Your final headcount', hd.cap, body, PARENT_FOOTER),
    text,
  }
}

/* ── j) party_cancelled ───────────────────────────────────────── */

export function partyCancelledEmail(raw: PartyCancelledInput): EviteEmail {
  const d = escapeFields(raw)
  const hd = ownerLabels(d.party)
  const rw = ownerLabels(raw.party)
  const date = dateOnly(raw.party.dateLine)

  const body = `
    ${paragraph(firstNameHello(d.guest.parentName))}
    ${paragraph(`We&rsquo;re sorry to let you know that ${hd.label}, planned for <strong>${dateOnly(d.party.dateLine)}</strong>, has been cancelled. You don&rsquo;t need to do anything.`)}
    ${paragraph('We&rsquo;ve attached a calendar update that removes it from your calendar.')}
    ${paragraph(d.party.hostContactLine ?? '')}`

  const text = [
    firstNameHello(raw.guest.parentName),
    '',
    `We're sorry to let you know that ${rw.label}, planned for ${date}, has been cancelled. You don't need to do anything.`,
    "We've attached a calendar update that removes it from your calendar.",
    '',
    ...(raw.party.hostContactLine ? [raw.party.hostContactLine, ''] : []),
    SIGNATURE_TEXT,
  ].join('\n')

  return {
    subject: oneLine(`Cancelled: ${rw.label} on ${date}`),
    html: shell('This party has been cancelled', hd.cap, body, GUEST_FOOTER),
    text,
  }
}
