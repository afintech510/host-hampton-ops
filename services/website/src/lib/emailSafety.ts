/**
 * What a value is allowed to become inside an outbound email body.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. `lib/emailTemplates.ts` and its siblings build HTML with template
 * literals, and until 2026-09-12 they interpolated customer-written fields
 * straight into that markup — 31 templates, one `escapeHtml` call between them.
 * `docs/reminder-engine-review.md` §10.4 recorded it as a known gap rather than
 * rewriting it inside a cron review.
 *
 * This module is deliberately TINY and defines nothing new. It composes the two
 * screens this codebase already has:
 *
 *   - `escapeHtml` (lib/escapeHtml.ts) for text, and
 *   - `parseScreenedUrl` / `safeSiteLink` (lib/content/contentSafety.ts) for
 *     URLs.
 *
 * Rule 11's sharpest form is a CONCEPT defined twice, and this project has paid
 * for that five times. A second escaper or a second URL parser living in the
 * mail layer is exactly that shape, so there isn't one: `mailHref` is a
 * composition, not a screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DISTINCTION THAT MATTERS, and it is rule 4's habit — classify before you
 * "fix" a field:
 *
 *   TEXT in an element body      → escapeHtml. A customer's name, a note, a
 *                                  package label, an event title.
 *   A URL in href / src          → a URL SCREEN, then attribute escaping.
 *                                  escapeHtml ALONE on an href is worse than
 *                                  nothing: it leaves `javascript:alert(1)`
 *                                  working while looking screened.
 *   A number you computed        → neither. `${(cents/100).toFixed(2)}` cannot
 *                                  carry markup and escaping it is noise.
 *   A nested template you built  → neither. It is already HTML; escaping it
 *                                  prints the tags to the customer, which is
 *                                  the wrong-fix failure mode from §11.12 of
 *                                  the Phase 5 review.
 *
 * And the plain-text half of every one of these emails must NOT be escaped: an
 * `&amp;` in front of a customer is a bug, just a quieter one.
 */

import { escapeHtml } from './escapeHtml'
import { parseScreenedUrl, safeSiteLink } from './content/contentSafety'

/** Where the refusal is reported. Rule 10: a screen that drops something says so. */
function refuse(kind: string, raw: unknown): '' {
  console.warn(`[emailSafety] refused ${kind} ${JSON.stringify(String(raw ?? '').slice(0, 160))}`)
  return ''
}

/**
 * A link to somewhere on hosthampton.com, ready to drop into `href="…"`.
 *
 * Returns `''` when the value is not one of ours, so the caller renders no link
 * rather than a link somewhere else. Every URL these templates receive is built
 * server-side from the canonical origin (`lib/publicOrigin.ts`), so an empty
 * return means a real bug upstream and is warned about rather than swallowed.
 */
export function mailHref(raw: string | null | undefined): string {
  if (!raw) return ''
  const screened = safeSiteLink(raw)
  if (!screened) return refuse('site link', raw)
  return escapeHtml(screened)
}

/**
 * A link that is allowed to leave our origin, ready to drop into `href="…"`.
 *
 * Two fields need this and only two: `photo_gallery_url`, which a human types
 * into the admin panel and which is normally a Google Photos or Dropbox album,
 * and the Google review link. Both are still screened — same parser, same
 * control-character and backslash refusals, https only — so `javascript:` and
 * `data:` cannot reach a customer's mail client, and the value cannot be a
 * protocol-relative path wearing our hostname.
 *
 * It is NOT host-restricted, and that is the deliberate difference from
 * `safeSiteLink`. An allowlist here would refuse the photo album of every party
 * Host Hampton has ever run.
 */
export function mailHrefExternal(raw: string | null | undefined): string {
  if (!raw) return ''
  const url = parseScreenedUrl(raw)
  if (!url) return refuse('external link', raw)
  return escapeHtml(url.href)
}

/** A `mailto:` for an address that may have been typed by anybody. */
export function mailToHref(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = String(raw).trim()
  // An address, not a URL: no scheme, no path, no query, one `@`, nothing a mail
  // client could read as a second header or a second recipient. `%0A` is the
  // interesting one — a newline in a `mailto:` is how a `bcc:` gets appended.
  if (!/^[^\s<>()[\],;:\\"@%]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(s)) return refuse('mailto', raw)
  return `mailto:${escapeHtml(s)}`
}

/** A `tel:`/`sms:` for a phone number that may have been typed by anybody. */
export function telHref(raw: string | null | undefined, scheme: 'tel' | 'sms' = 'tel'): string {
  if (!raw) return ''
  const digits = String(raw).replace(/[^\d+]/g, '')
  if (!/^\+?\d{7,15}$/.test(digits)) return refuse(scheme, raw)
  return `${scheme}:${digits}`
}

type Escaped<T> = T

/**
 * Escape every string in a template's data object, once, at the top of the
 * template function.
 *
 * WHY THIS SHAPE rather than `${escapeHtml(d.x)}` at 480 interpolation sites:
 * the sites are the part that gets added to. A new row in a table copied from
 * the row above it inherits whatever the row above did, and the reviewer sees a
 * one-line diff that looks like every other line in the file. Escaping at ENTRY
 * means a template is safe by the shape of its first line, and the tripwire
 * (`src/__tests__/lib/emailTemplateEscaping.test.ts`) can check that first line
 * instead of trying to be a type checker.
 *
 * It is the same pattern `lib/email-templates/reminders.ts` already used —
 * `const [a, b] = [params.a, params.b].map(v => escapeHtml(v ?? ''))` — made
 * reusable rather than retyped in every function (rule 11).
 *
 * URL FIELDS ARE EXCLUDED BY THE CALLER, not by this function guessing from the
 * key name. A field called `portalUrl` is screened with `mailHref`; a field
 * called `venmoHandle` is text. Guessing from the name is how a value ends up
 * double-treated — HTML-escaped and then handed to a URL parser that no longer
 * recognises it, which is a live-email breakage and worse than the injection.
 * Pass the raw object for URLs: `escapeFields(raw)` for the text,
 * `mailHref(raw.portalUrl)` for the link.
 *
 * Numbers, booleans, null and undefined pass through untouched, so
 * `${d.guestCount}` and `${d.isFree ? … : …}` keep working.
 */
export function escapeFields<T>(input: T): Escaped<T> {
  return walk(input, 0) as Escaped<T>
}

function walk(value: unknown, depth: number): unknown {
  // A guard, not a policy: these are flat data objects one or two levels deep,
  // and a cycle would otherwise hang a request that is sending mail.
  if (depth > 6) return value
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return escapeHtml(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(v => walk(v, depth + 1))
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = walk(v, depth + 1)
    return out
  }
  return value
}
