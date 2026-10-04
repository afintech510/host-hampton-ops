/**
 * The post-party "📷 Photo Booth Album" message — email and text.
 *
 * An admin pastes the Fotoshare link for a party and presses Send; the route
 * (`action: 'send_photo_album'` on /api/admin/parties/[id]) emails and texts
 * the customer this message. The wording is the message Adam already sends by
 * hand, kept word for word so the automation reads the same as the human did.
 *
 * PURE, no I/O and no server-only imports, on purpose: the admin panel imports
 * `photoAlbumText` to show the exact preview, and the route imports the same
 * function to build what is sent — so the preview cannot drift from the send.
 */

import { escapeHtml } from './escapeHtml'
import { mailHrefExternal } from './emailSafety'
import { parseScreenedUrl } from './content/contentSafety'
import { REVIEW_BASE_URL } from './marketing/reviewLink'

export const PHOTO_ALBUM_SUBJECT = '📷 Photo Booth Album🥳'

/**
 * The `booking_modifications.change_summary` every successful send starts
 * with. It is how the route knows an album already went out (and refuses to
 * send it twice without `resend: true`), so it is a constant, not a phrase
 * written in two places.
 */
export const PHOTO_ALBUM_SENT_SUMMARY_PREFIX = 'Photo booth album sent'

/** Bounds for the admin-edited "who/what we hosted" phrase. */
export const OCCASION_MAX_LENGTH = 100

export type AlbumUrlScreen = { ok: true; url: string } | { ok: false; reason: string }

/**
 * Is this a Fotoshare album link?
 *
 * HOST-RESTRICTED, deliberately unlike `mailHrefExternal`: this field is pasted
 * by a person in a hurry after a party, and the likeliest wrong paste is some
 * OTHER link on the clipboard — a customer's portal link, a Google Doc, another
 * party's quote. A link that is not Fotoshare is refused with a reason rather
 * than mailed to a family. Same parser as every other mail URL, so control
 * characters, backslashes and non-https are refused before the host is read.
 */
export function screenFotoshareUrl(raw: unknown): AlbumUrlScreen {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return { ok: false, reason: 'Paste the Fotoshare link first.' }
  // Pasted without a scheme ("fotoshare.co/e/abc"), or as http://, is still
  // unambiguous — Fotoshare serves every album over https.
  const withScheme = (/^(www\.)?fotoshare\.co\//i.test(s) ? `https://${s}` : s).replace(/^http:\/\//i, 'https://')
  const url = parseScreenedUrl(withScheme)
  if (!url || !/^https?:\/\//i.test(withScheme)) {
    return { ok: false, reason: 'That is not a valid https:// link.' }
  }
  const host = url.hostname.toLowerCase()
  if (host !== 'fotoshare.co' && !host.endsWith('.fotoshare.co')) {
    return { ok: false, reason: `That link is on ${host}, not fotoshare.co — check you pasted the album link.` }
  }
  if (url.username || url.password || url.port) {
    return { ok: false, reason: 'That link has credentials or a port in it — paste the plain album link.' }
  }
  if (url.pathname === '/' || url.pathname === '') {
    return { ok: false, reason: 'That is the Fotoshare home page, not an album — paste the event link (fotoshare.co/e/…).' }
  }
  return { ok: true, url: url.href }
}

/** The occasion phrase as it will be sent: one line, trimmed, bounded. */
export function screenOccasion(raw: unknown): { ok: true; occasion: string } | { ok: false; reason: string } {
  const s = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : ''
  if (!s) return { ok: false, reason: 'Fill in who we hosted (e.g. "Emma\'s birthday party").' }
  if (s.length > OCCASION_MAX_LENGTH) {
    return { ok: false, reason: `Keep "who we hosted" under ${OCCASION_MAX_LENGTH} characters.` }
  }
  return { ok: true, occasion: s }
}

function possessive(name: string): string {
  return /s$/i.test(name) ? `${name}'` : `${name}'s`
}

/**
 * A starting guess at "<child's name> <event type>" for the sentence
 * "Thank you so much for choosing us to host ___!".
 *
 * Only a guess, and shown to the admin in an editable box: `event_type` in
 * production is free text in a dozen spellings ("kid-party", "Kids Birthday
 * Party", "mobile party", "Baby shower ", "40th Birthday"), so no mapping from
 * it is right every time and the human reading the preview is the check.
 */
export function defaultOccasion(b: {
  child_name?: string | null
  event_type?: string | null
  party_type?: string | null
}): string {
  const child = (b.child_name || '').replace(/\s+/g, ' ').trim()
  const et = (b.event_type || '').replace(/\s+/g, ' ').trim().toLowerCase()

  if (child) {
    if (/corporate/.test(et)) return `${possessive(child)} event`
    if (/shower/.test(et)) return `${possessive(child)} ${et}`
    return `${possessive(child)} birthday party`
  }
  if (/baby shower|bridal shower|shower/.test(et)) return `your ${et}`
  if (/^\d+(st|nd|rd|th) birthday$/.test(et)) return `your ${et}`
  if (/corporate/.test(et) || b.party_type === 'studio_rental') return 'your event'
  return 'your party'
}

export interface PhotoAlbumMessage {
  /** The customer's name as stored; only the first word is used. */
  contactName: string | null | undefined
  /** Already screened by `screenOccasion`. */
  occasion: string
  /** Already screened by `screenFotoshareUrl`. */
  albumUrl: string
}

function firstName(contactName: string | null | undefined): string {
  return (contactName || '').trim().split(/\s+/)[0] || 'there'
}

/**
 * The message as plain text — the SMS body, the plain-text half of the email,
 * and the admin preview. NOT escaped: this is never markup.
 */
export function photoAlbumText(m: PhotoAlbumMessage): string {
  return [
    `Hi ${firstName(m.contactName)} ✨`,
    '',
    `Thank you so much for choosing us to host ${m.occasion}! 🎈🎉`,
    '',
    'Here is the link to access all of your amazing photo booth pics:',
    m.albumUrl,
    '(Please let me know if you have any issues at all!)',
    '',
    'If you have a quick moment, we would be so incredibly grateful if you could leave us a 5-star review on Google! 🌟🙏 It helps our small business grow so much!',
    REVIEW_BASE_URL,
    '',
    'Thank you again!',
  ].join('\n')
}

/**
 * The same message as HTML. Written to look like the personal note it is — no
 * banner, no buttons — because that is what the hand-sent version looked like.
 * Every value is escaped or URL-screened at entry.
 */
export function photoAlbumEmailHtml(raw: PhotoAlbumMessage): string {
  const name = escapeHtml(firstName(raw.contactName))
  const occasion = escapeHtml(raw.occasion)
  const p = (inner: string) => `<p style="margin:0 0 16px;line-height:1.6;">${inner}</p>`
  // Screened at the href, so a refused URL renders no link rather than a raw one.
  const link = (rawUrl: string) =>
    mailHrefExternal(rawUrl)
      ? `<a href="${mailHrefExternal(rawUrl)}" style="color:#1a2744;font-weight:bold;word-break:break-all;">${mailHrefExternal(rawUrl)}</a>`
      : ''
  const albumHref = raw.albumUrl
  const reviewHref = REVIEW_BASE_URL

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:24px 16px;background:#ffffff;">
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#333333;max-width:600px;margin:0 auto;">
  ${p(`Hi ${name} &#10024;`)}
  ${p(`Thank you so much for choosing us to host ${occasion}! &#127880;&#127881;`)}
  ${p(`Here is the link to access all of your amazing photo booth pics:<br>${link(albumHref)}<br>(Please let me know if you have any issues at all!)`)}
  ${p(`If you have a quick moment, we would be so incredibly grateful if you could leave us a 5-star review on Google! &#127775;&#128591; It helps our small business grow so much!<br>${link(reviewHref)}`)}
  ${p('Thank you again!')}
  <p style="margin:24px 0 0;font-size:12px;color:#999999;">Host Hampton &middot; 295 Montauk Highway &middot; Speonk, NY 11972</p>
</div>
</body></html>`
}
