import { TENANT } from '@/tenant'
import { containsForeignContact, containsFabricatedTerms } from '@/lib/agent/draftGuards'
import { smsEncodingOf, smsSegmentInfo, gsm7Sanitize } from '@/lib/smsSegments'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { buildPortalUrl } from '@/lib/portalAuth'
import { EMAIL_BODY_MAX_LENGTH, SMS_BODY_MAX_LENGTH, SUBJECT_MAX_LENGTH } from '@/lib/clientLinks'

/**
 * Every screen a customer-facing message passes on its way from the assistant
 * to a customer — the default wording, the model's revision of it, and a
 * manager's hand edit alike.
 *
 * It is one function on purpose. The card shows the text THROUGH this, and
 * `execute.ts` runs the text through it again at the last gate, immediately
 * before the dashboard route is replayed; a second copy of these checks would be
 * a screen nothing is checking.
 *
 * What it refuses is deliberately narrow and entirely about where a customer's
 * attention or money could be sent: a link, address, payment handle or phone
 * number that is not ours (`containsForeignContact`), a signature as the owner,
 * a placeholder that is not one of ours, and an SMS with no STOP line. What a
 * manager says in their own words is theirs; WHERE THE MONEY GOES is nobody's to
 * edit. Text the MODEL wrote gets one more screen — promises of a discount or a
 * waived charge — because the model has no authority to make any.
 */

export type Authored = 'default' | 'model' | 'manual'
export type TextChannel = 'sms' | 'email' | 'subject'

/** The placeholders a message may carry. Anything else in braces is refused. */
export const MESSAGE_PLACEHOLDERS = ['invite', 'rsvps', 'planner', 'invoice', 'portal', 'photos'] as const
const BRACES = /\{([^{}]*)\}/g

export type TextScreenResult = { ok: true; text: string; notes: string[] } | { ok: false; reason: string }

const MAX: Record<TextChannel, number> = {
  sms: SMS_BODY_MAX_LENGTH,
  email: EMAIL_BODY_MAX_LENGTH,
  subject: SUBJECT_MAX_LENGTH,
}

/**
 * Fold the punctuation a keyboard or a model produces (curly quotes, dashes,
 * non-breaking spaces) into plain GSM characters, and leave everything else —
 * including the emoji the default wording uses — exactly as it was. A curly
 * apostrophe silently turns a one-segment text into a three-segment one;
 * an emoji is a choice the card tells the manager about instead.
 */
export function foldSmsPunctuation(text: string): string {
  let out = ''
  for (const ch of text) {
    if (smsEncodingOf(ch) === 'GSM-7') {
      out += ch
      continue
    }
    const folded = gsm7Sanitize(ch)
    out += folded !== '' ? folded : ch
  }
  return out
}

const BARE_DOMAIN =
  /(?:^|[^@\w.-])([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|co|us|me|ly|app|biz|info|xyz|link|site|online|shop|store|page|gle|gl))(?![\w-])/gi

function ownHost(host: string): boolean {
  try {
    const ours = new URL(CANONICAL_ORIGIN).hostname.replace(/^www\./i, '').toLowerCase()
    const h = host.replace(/^www\./i, '').toLowerCase()
    return h === ours || h.endsWith(`.${ours}`)
  } catch {
    return false
  }
}

/** A domain written without a scheme ("sparkleparties.co") is still a link. */
function foreignBareDomain(text: string): string | null {
  const re = new RegExp(BARE_DOMAIN.source, 'gi')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!ownHost(m[1])) return m[1].toLowerCase()
  }
  return null
}

/** Names the message must never be written as, from the tenant config. */
function ownerNameHit(text: string): string | null {
  for (const name of TENANT.people.neverSignAs) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${esc}\\b`, 'i').test(text)) return name
  }
  return null
}

export function screenOutboundText(
  raw: unknown,
  opts: { channel: TextChannel; authored: Authored; allowedPlaceholders: readonly string[] },
): TextScreenResult {
  if (typeof raw !== 'string') return { ok: false, reason: `The ${opts.channel === 'sms' ? 'text' : opts.channel} is missing.` }
  const notes: string[] = []
  let text = raw
    .replace(/\r\n?/g, '\n')
    // Zero-width and control characters hide text from the reader and the screens.
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
  if (opts.channel === 'subject') text = text.replace(/\s+/g, ' ')
  else text = text.replace(/\n{3,}/g, '\n\n')

  if (!text) return { ok: false, reason: `The ${opts.channel === 'sms' ? 'text' : opts.channel} is empty.` }
  if (text.length > MAX[opts.channel]) {
    return { ok: false, reason: `Keep the ${opts.channel === 'sms' ? 'text' : opts.channel} under ${MAX[opts.channel]} characters (it is ${text.length}).` }
  }

  if (opts.channel === 'sms' && opts.authored !== 'default') {
    const folded = foldSmsPunctuation(text)
    if (folded !== text) notes.push('Curly quotes and dashes were changed to plain ones so the text stays short.')
    text = folded
  }

  // Placeholders: the ones this message type uses, and nothing else in braces.
  const re = new RegExp(BRACES.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (!opts.allowedPlaceholders.includes(m[1])) {
      return { ok: false, reason: `"{${m[1]}}" is not a link this message can carry.` }
    }
  }

  const foreign = containsForeignContact(text)
  if (foreign) return { ok: false, reason: `It contains a ${foreign}, which is not ours. Customer messages may only link to our own pages.` }
  const bare = foreignBareDomain(text)
  if (bare) return { ok: false, reason: `It mentions ${bare}, which is not ours. Customer messages may only link to our own pages.` }

  const owner = ownerNameHit(text)
  if (owner) {
    return { ok: false, reason: `It names ${owner}. Customer messages come from ${TENANT.people.customerSignoff}, never the owner.` }
  }

  if (opts.authored === 'model') {
    const promise = containsFabricatedTerms(text, { allowedAmounts: new Set<string>() })
    if (promise) return { ok: false, reason: `It states ${promise}, which the assistant cannot promise or quote. Say it yourself in the edit box if you mean it.` }
  }

  if (opts.channel === 'sms' && !/\bstop\b/i.test(text)) {
    return { ok: false, reason: 'A text must end with the opt-out line ("Reply STOP to opt out").' }
  }

  return { ok: true, text, notes }
}

/* ── masking: a card shows who it goes to, not their number ─────────── */

export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? '').replace(/\D/g, '')
  return digits.length >= 4 ? `***-***-${digits.slice(-4)}` : 'no number'
}

export function maskEmail(email: string | null | undefined): string {
  const s = String(email ?? '').trim()
  const at = s.lastIndexOf('@')
  if (at < 1) return 'no email'
  return `${s.slice(0, 1)}***${s.slice(at)}`
}

export function firstNameOf(name: string | null | undefined): string {
  return (name || '').trim().split(/\s+/)[0] || 'there'
}

/* ── what the recipient will actually receive ────────────────────────── */

/**
 * A realistic length for each link. The real URLs are minted at the moment of
 * sending (a portal link is a sign-in token), so the card can only estimate how
 * long the filled-in text will be — good to a few characters, which is all a
 * segment count needs.
 */
export function estimatedLinkLength(placeholder: string, bookingRef: string): number {
  switch (placeholder) {
    case 'invite':
      return `${CANONICAL_ORIGIN}/i/`.length + 14
    case 'photos':
      return `${CANONICAL_ORIGIN}/p/`.length + 40
    default:
      return buildPortalUrl(bookingRef, 'x'.repeat(64), `/plan/${bookingRef}/summary`).length
  }
}

export interface SmsFacts {
  encoding: 'GSM-7' | 'UCS-2'
  segments: number
  units: number
  /** Why it is UCS-2, when it is, in words. */
  cause: string | null
}

export function smsFacts(template: string, bookingRef: string): SmsFacts {
  const filled = template.replace(new RegExp(BRACES.source, 'g'), (whole, p: string) =>
    (MESSAGE_PLACEHOLDERS as readonly string[]).includes(p) ? 'x'.repeat(estimatedLinkLength(p, bookingRef)) : whole,
  )
  const info = smsSegmentInfo(filled)
  let cause: string | null = null
  if (info.encoding === 'UCS-2') {
    for (const ch of filled) {
      if (smsEncodingOf(ch) !== 'GSM-7') {
        cause = ch.length > 1 || ch.charCodeAt(0) > 0x2000 ? `the ${ch} emoji or symbol` : `the character "${ch}"`
        break
      }
    }
  }
  return { encoding: info.encoding, segments: info.segments, units: info.units, cause }
}

/** The text the way the recipient reads it, with each link shown as a labelled marker. */
export function displayWithLinks(template: string, labels: Record<string, string>): string {
  return template.replace(new RegExp(BRACES.source, 'g'), (whole, p: string) =>
    labels[p] ? `[${labels[p]} link]` : whole,
  )
}
