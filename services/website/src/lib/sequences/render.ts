/**
 * Rendering one sequence step into an email.
 *
 * Split out of the processor because it is pure, and because the two things it
 * gets wrong are the two things worth testing on their own: escaping a
 * customer-written name, and putting an unsubscribe link on a marketing email.
 */

import { escapeHtml } from '@/lib/escapeHtml'
import { buildUnsubscribeUrl } from '@/lib/unsubscribeLink'
import { mailHref } from '@/lib/emailSafety'

export interface TemplateVars {
  firstName?: string | null
  businessName?: string | null
  bookingRef?: string | null
  unsubscribeUrl?: string | null
}

/** The placeholders a step body may contain. One list, used by both renderers. */
const PLACEHOLDERS: { token: RegExp; key: keyof TemplateVars; fallback: string }[] = [
  { token: /\{\{first_name\}\}/g, key: 'firstName', fallback: 'there' },
  { token: /\{\{business_name\}\}/g, key: 'businessName', fallback: 'Host Hampton' },
  { token: /\{\{booking_ref\}\}/g, key: 'bookingRef', fallback: '' },
  { token: /\{\{unsubscribe_url\}\}/g, key: 'unsubscribeUrl', fallback: '' },
]

function valueFor(vars: TemplateVars, key: keyof TemplateVars, fallback: string): string {
  const v = vars[key]
  const s = v == null ? '' : String(v)
  return s.trim() === '' ? fallback : s
}

/**
 * Substitute into an HTML body. Values are HTML-ESCAPED.
 *
 * `contacts.first_name` is customer-written — it arrives from the public intake
 * forms — and the pre-existing `renderTemplate` dropped it into markup raw. A
 * field is hostile because of who can WRITE it (hard-won rule 5), and the same
 * defect was already found and fixed on the payment-receipt path in plan §22.
 *
 * `unsubscribe_url` is the one exception, and it is ours: we mint it, so it is
 * inserted as an attribute-safe URL rather than escaped into uselessness.
 */
export function renderHtml(body: string, vars: TemplateVars): string {
  let out = String(body ?? '')
  for (const p of PLACEHOLDERS) {
    const raw = valueFor(vars, p.key, p.fallback)
    const replacement = p.key === 'unsubscribeUrl' ? encodeURI(raw) : escapeHtml(raw)
    out = out.replace(p.token, replacement)
  }
  return out
}

/**
 * Substitute into a plain-text context (a subject line, a text part).
 *
 * HTML escaping would be wrong here — `Sam &amp; Jo` is what the recipient would
 * see — but a subject is an email HEADER, so CR/LF and the other line
 * terminators are flattened. Same reasoning as `flattenToOneLine` in the agent:
 * a newline in a value forges structure in whatever is built around it.
 */
export function renderText(body: string, vars: TemplateVars): string {
  let out = String(body ?? '')
  for (const p of PLACEHOLDERS) {
    out = out.replace(p.token, flattenHeaderValue(valueFor(vars, p.key, p.fallback)))
  }
  return out
}

/** Everything a mail header treats as a line break, plus the C0/C1 controls. */
export function flattenHeaderValue(s: string): string {
  let out = ''
  for (const ch of String(s ?? '')) {
    const cp = ch.codePointAt(0) ?? 0
    const isControl = cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)
    const isLineSeparator = cp === 0x2028 || cp === 0x2029
    out += isControl || isLineSeparator ? ' ' : ch
  }
  return out.replace(/\s{2,}/g, ' ').trim()
}

/**
 * The footer. Appended to every sequence email whose body does not already
 * place `{{unsubscribe_url}}` itself.
 *
 * Not optional and not configurable: an automated marketing email with no way
 * out is a CAN-SPAM problem, and the whole reason the sequencer's opt-out check
 * could only ever learn about an unsubscribe from somewhere ELSE is that its own
 * mail never offered one.
 */
export function unsubscribeFooterHtml(url: string): string {
  // `encodeURI` was the whole screen here, and it does not refuse a scheme:
  // encodeURI('javascript:alert(1)') returns it unchanged. The URL is built
  // server-side from CANONICAL_ORIGIN so nothing hostile reaches it today, but
  // an href needs a URL SCREEN, not an encoder (rule 4).
  const safe = mailHref(url)
  return (
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #e5e0d8;` +
    `font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#8a8279;text-align:center">` +
    `<p style="margin:0 0 6px">Host Hampton &middot; Speonk, NY</p>` +
    `<p style="margin:0">You're getting this because you asked us about an event. ` +
    `<a href="${safe}" style="color:#8a8279;text-decoration:underline">Unsubscribe</a>.</p>` +
    `</div>`
  )
}

export function unsubscribeFooterText(url: string): string {
  return `\n\n—\nHost Hampton · Speonk, NY\nUnsubscribe: ${url}\n`
}

export interface RenderedEmail {
  subject: string
  html: string
  text?: string
  /** True when the body carried its own {{unsubscribe_url}} and we did not append. */
  usedInlineUnsubscribe: boolean
}

export function renderStepEmail(
  step: { subject: string; body_html: string; body_text?: string | null },
  vars: TemplateVars,
  unsubscribeToken: string
): RenderedEmail {
  const url = buildUnsubscribeUrl(unsubscribeToken)
  const allVars: TemplateVars = { ...vars, unsubscribeUrl: url }

  const usedInlineUnsubscribe = /\{\{unsubscribe_url\}\}/.test(String(step.body_html ?? ''))

  let html = renderHtml(step.body_html, allVars)
  if (!usedInlineUnsubscribe) html += unsubscribeFooterHtml(url)

  let text: string | undefined
  if (step.body_text) {
    text = renderText(step.body_text, allVars)
    if (!/\{\{unsubscribe_url\}\}/.test(step.body_text)) text += unsubscribeFooterText(url)
  }

  return {
    subject: renderText(step.subject, allVars),
    html,
    text,
    usedInlineUnsubscribe,
  }
}
