/**
 * "Send links to client" — the invitation, the planner, the invoice and the
 * booking portal, by email and/or text, from the Parties detail panel.
 *
 * The admin picks which links and which channels, then either sends the default
 * wording or opens Preview / edit and changes it. The text carries PLACEHOLDERS
 * (`{invite}`, `{invoice}` …), never real links: a portal link is a sign-in
 * token, so it is minted by the route at the moment of sending and a preview
 * that nobody sends does not leave a live token behind. The route fills the
 * placeholders in; `checkPlaceholders` is what stops a selected link from being
 * silently dropped because somebody edited its placeholder out.
 *
 * PURE, no I/O and no server-only imports: the panel imports the defaults and
 * the checks to show the preview, and the route imports the same functions to
 * build what is sent (`action: 'send_client_links'` on /api/admin/parties/[id]).
 */

import { escapeHtml } from './escapeHtml'
import { mailHref } from './emailSafety'
import { defaultOccasion } from './photoAlbum'

export const CLIENT_LINK_KINDS = ['invite', 'planner', 'invoice', 'portal'] as const
export type ClientLinkKind = (typeof CLIENT_LINK_KINDS)[number]

export const CLIENT_LINK_LABELS: Record<ClientLinkKind, string> = {
  invite: 'Invitation',
  planner: 'Party planner',
  invoice: 'Invoice',
  portal: 'Booking portal',
}

/**
 * Every placeholder, and the link kind it belongs to. `{rsvps}` is the host's
 * own invitation page (RSVPs, design picker); it rides with `invite` and is
 * optional, where `{invite}` (the public link the parent forwards) is required.
 */
export const PLACEHOLDERS = {
  invite: 'invite',
  rsvps: 'invite',
  planner: 'planner',
  invoice: 'invoice',
  portal: 'portal',
} as const satisfies Record<string, ClientLinkKind>
export type Placeholder = keyof typeof PLACEHOLDERS

/** The placeholder a selected link must appear as. */
const REQUIRED: Record<ClientLinkKind, Placeholder> = {
  invite: 'invite',
  planner: 'planner',
  invoice: 'invoice',
  portal: 'portal',
}

const PLACEHOLDER_RE = /\{(invite|rsvps|planner|invoice|portal)\}/g

export const SUBJECT_MAX_LENGTH = 200
export const EMAIL_BODY_MAX_LENGTH = 5000
export const SMS_BODY_MAX_LENGTH = 1200

export interface ClientLinkBooking {
  contact_name?: string | null
  child_name?: string | null
  event_type?: string | null
  party_type?: string | null
  booking_ref?: string | null
}

function firstName(contactName: string | null | undefined): string {
  return (contactName || '').trim().split(/\s+/)[0] || 'there'
}

/** Known kinds, de-duplicated, in the canonical order. Unknown values are dropped. */
export function screenLinkKinds(raw: unknown): ClientLinkKind[] {
  const list = Array.isArray(raw) ? raw : []
  return CLIENT_LINK_KINDS.filter(k => list.includes(k))
}

/** The placeholders that appear in a text. */
export function placeholdersIn(text: string): Placeholder[] {
  const found: Placeholder[] = []
  const re = new RegExp(PLACEHOLDER_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!found.includes(m[1] as Placeholder)) found.push(m[1] as Placeholder)
  }
  return found
}

/**
 * Does this text carry exactly the links that were picked? Returns the
 * problems, in words an admin can act on; empty means it is fine to send.
 */
export function checkPlaceholders(text: string, kinds: readonly ClientLinkKind[], channel: 'email' | 'text'): string[] {
  const present = placeholdersIn(text)
  const problems: string[] = []
  for (const k of kinds) {
    if (!present.includes(REQUIRED[k])) {
      problems.push(`The ${channel} has no {${REQUIRED[k]}}, so the ${CLIENT_LINK_LABELS[k].toLowerCase()} link would not be in it. Put it back or untick ${CLIENT_LINK_LABELS[k]}.`)
    }
  }
  for (const p of present) {
    if (!kinds.includes(PLACEHOLDERS[p])) {
      problems.push(`The ${channel} has {${p}} but ${CLIENT_LINK_LABELS[PLACEHOLDERS[p]]} is not ticked.`)
    }
  }
  return problems
}

/** Swap each placeholder for its link. A placeholder with no link is left as typed. */
export function fillLinks(text: string, urls: Partial<Record<Placeholder, string>>): string {
  return text.replace(PLACEHOLDER_RE, (whole, p: Placeholder) => urls[p] ?? whole)
}

/* ── the default wording ──────────────────────────────────────────── */

function occasionOf(b: ClientLinkBooking): string {
  // "Emma's birthday party" / "your party" — the phrase the photo album uses.
  return defaultOccasion(b)
}

function inviteOwner(b: ClientLinkBooking): string {
  const child = (b.child_name || '').replace(/\s+/g, ' ').trim()
  if (!child) return 'your'
  return /s$/i.test(child) ? `${child}'` : `${child}'s`
}

/** The default text message. Short lines, one per link, signed Allie. */
export function defaultSmsBody(b: ClientLinkBooking, kinds: readonly ClientLinkKind[]): string {
  const lines = [`Hi ${firstName(b.contact_name)}! It's Allie from Host Hampton 🎉`]
  if (kinds.includes('invite')) lines.push(`Here's ${inviteOwner(b)} invitation to share with your guests: {invite}`)
  if (kinds.includes('planner')) lines.push(`Plan your party (theme, add-ons, guest count): {planner}`)
  if (kinds.includes('invoice')) lines.push(`Your invoice: {invoice}`)
  if (kinds.includes('portal')) lines.push(`Your booking (details & payments): {portal}`)
  lines.push('Reply STOP to opt out')
  return lines.join('\n')
}

export function defaultEmailSubject(b: ClientLinkBooking, kinds: readonly ClientLinkKind[]): string {
  const occasion = occasionOf(b)
  if (kinds.length === 1) {
    switch (kinds[0]) {
      case 'invite': return `${inviteOwner(b) === 'your' ? 'Your' : inviteOwner(b)} party invitation is ready! 🎉`
      case 'planner': return `Plan ${occasion} with Host Hampton`
      case 'invoice': return `Your Host Hampton invoice${b.booking_ref ? ` — ${b.booking_ref}` : ''}`
      case 'portal': return `Your Host Hampton booking${b.booking_ref ? ` — ${b.booking_ref}` : ''}`
    }
  }
  return `Your links for ${occasion} — Host Hampton`
}

export function defaultEmailBody(b: ClientLinkBooking, kinds: readonly ClientLinkKind[]): string {
  const blocks = [`Hi ${firstName(b.contact_name)},`, `Here ${kinds.length === 1 ? 'is your link' : 'are your links'} for ${occasionOf(b)}:`]
  if (kinds.includes('invite')) {
    blocks.push(
      `Invitation — share this link with your guests:\n{invite}\n\nSee who's coming and change the design:\n{rsvps}`,
    )
  }
  if (kinds.includes('planner')) blocks.push(`Party planner — choose your theme, add-ons and guest count:\n{planner}`)
  if (kinds.includes('invoice')) blocks.push(`Your invoice:\n{invoice}`)
  if (kinds.includes('portal')) blocks.push(`Your booking — party details and payments:\n{portal}`)
  blocks.push('Just reply to this email if you have any questions!', 'Allie\nHost Hampton')
  return blocks.join('\n\n')
}

/* ── screens for what the admin typed ─────────────────────────────── */

export type TextScreen = { ok: true; text: string } | { ok: false; reason: string }

export function screenSubject(raw: unknown): TextScreen {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  if (!s) return { ok: false, reason: 'The email needs a subject.' }
  if (s.length > SUBJECT_MAX_LENGTH) return { ok: false, reason: `Keep the subject under ${SUBJECT_MAX_LENGTH} characters.` }
  return { ok: true, text: s }
}

export function screenBody(raw: unknown, channel: 'email' | 'text'): TextScreen {
  const max = channel === 'email' ? EMAIL_BODY_MAX_LENGTH : SMS_BODY_MAX_LENGTH
  const s = typeof raw === 'string' ? raw.replace(/\r\n?/g, '\n').trim() : ''
  if (!s) return { ok: false, reason: `The ${channel} is empty.` }
  if (s.length > max) return { ok: false, reason: `Keep the ${channel} under ${max} characters.` }
  return { ok: true, text: s }
}

/* ── the email as HTML ────────────────────────────────────────────── */

/**
 * The email body as HTML, built from the PLACEHOLDER text: every piece the
 * admin typed is escaped, and every placeholder becomes a link screened by
 * `mailHref` (all of these are our own origin). A placeholder whose link is
 * missing or refused renders as nothing rather than as a raw string.
 */
export function clientLinksEmailHtml(bodyTemplate: string, urls: Partial<Record<Placeholder, string>>): string {
  // Screened at the href, so a refused URL renders no link rather than a raw one.
  const linkFor = (p: Placeholder): string =>
    mailHref(urls[p])
      ? `<a href="${mailHref(urls[p])}" style="color:#1a2744;font-weight:bold;word-break:break-all;">${mailHref(urls[p])}</a>`
      : ''
  const renderLine = (line: string): string => {
    let out = ''
    let last = 0
    const re = new RegExp(PLACEHOLDER_RE.source, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(line)) !== null) {
      out += escapeHtml(line.slice(last, m.index)) + linkFor(m[1] as Placeholder)
      last = m.index + m[0].length
    }
    return out + escapeHtml(line.slice(last))
  }
  const paragraphs = bodyTemplate
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map(block => block.split('\n').map(renderLine).join('<br>'))
    .map(inner => `<p style="margin:0 0 16px;line-height:1.6;">${inner}</p>`)
    .join('\n  ')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:24px 16px;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#333333;max-width:600px;margin:0 auto;">
  ${paragraphs}
  <p style="margin:24px 0 0;font-size:12px;color:#999999;">Host Hampton &middot; 295 Montauk Highway &middot; Speonk, NY 11972</p>
</div>
</body></html>`
}
