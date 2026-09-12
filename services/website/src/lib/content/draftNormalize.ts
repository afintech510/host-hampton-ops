/**
 * Turn one model reply into a `website_content` row we are willing to publish.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. `createTownServiceDraft` used to `JSON.parse` Claude's answer and insert
 * `draft.sections`, `draft.faq`, `draft.keywords`, `draft.title` and
 * `draft.meta_description` **wholesale**, with no check that any of them were
 * the shape the type annotation claimed. The type annotation is a cast, not a
 * parser. Four consequences, each of which had a live path:
 *
 *  - `title` and `meta_description` go straight into `<title>` and
 *    `<meta name="description">`. The prompt asked for "~55-60" and "~150"
 *    characters and nothing enforced it: the one published row in the table
 *    (`/es/party-room-rental`) carries a **165-character** description, over
 *    Google's limit, and `first-birthday-parties` carries 171. A budget stated
 *    only in a prompt is a request, not a constraint — so the budget lives
 *    here, in the writer, and the numbers are IMPORTED from `lib/seo.ts`
 *    (`MAX_TITLE_CHARS` / `MAX_DESCRIPTION_CHARS`) rather than restated, which
 *    is rule 11.
 *  - `sections[].html` is a key the RENDERER used to hand to
 *    `dangerouslySetInnerHTML`. See `contentSafety.ts`. It is dropped here too,
 *    because a hostile value should never reach storage in the first place.
 *  - a newline in a title forges nothing today, but `title` is quoted into the
 *    admin panel, the ledger and the sitemap. Everything is flattened.
 *  - nothing bounded the SIZE of anything. A model that loops produces a row
 *    that a reviewer cannot read and a page nobody will scroll.
 *
 * Rule 10 throughout: every trim, drop and rejection is recorded in `notes`,
 * which the caller writes to the ledger and shows in the panel. A normaliser
 * that silently shortens a page is the same defect as a guardrail that parks a
 * draft and tells nobody.
 *
 * Rule 15: a field this cannot interpret is DROPPED, never guessed at. A draft
 * that loses its title or all of its body is REJECTED — an empty landing page
 * that reached `pending_review` would be a reviewer's problem forever.
 */

import { MAX_TITLE_CHARS, MAX_DESCRIPTION_CHARS, TITLE_SUFFIX } from '@/lib/seo'
import { htmlToPlainText, containsMarkup } from '@/lib/content/contentSafety'

export const MAX_SECTIONS = 6
export const MAX_SECTION_HEADING_CHARS = 90
export const MAX_SECTION_TEXT_CHARS = 2000
export const MAX_FAQ_ITEMS = 8
export const MAX_FAQ_Q_CHARS = 160
export const MAX_FAQ_A_CHARS = 800
export const MAX_KEYWORDS = 10
export const MAX_KEYWORD_CHARS = 60

export interface NormalizedSection {
  heading: string
  text: string
}
export interface NormalizedFaq {
  q: string
  a: string
}
export interface NormalizedDraft {
  title: string
  meta_description: string
  keywords: string[]
  sections: NormalizedSection[]
  faq: NormalizedFaq[]
}

export type NormalizeOutcome =
  | { ok: true; draft: NormalizedDraft; notes: string[] }
  | { ok: false; error: string; notes: string[] }

/** Collapse to one line and strip the control/format characters that forge structure. */
function flatten(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  let out = ''
  for (const ch of raw) {
    const cp = ch.codePointAt(0) as number
    // Line terminators — including the four that `flattenToOneLine` in
    // lib/agent/draftGuards.ts had to grow after plan §24 (U+0085, U+2028,
    // U+2029) — become a space. Other controls, C1 and the bidi/zero-width
    // formatting characters are removed outright.
    if (cp === 0x0a || cp === 0x0d || cp === 0x09 || cp === 0x85 || cp === 0x2028 || cp === 0x2029) {
      out += ' '
      continue
    }
    if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f)) continue
    if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfeff) continue
    if (cp >= 0x202a && cp <= 0x202e) continue
    if (cp >= 0x2066 && cp <= 0x2069) continue
    out += ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

/** Multi-line text: paragraphs survive, everything else is flattened per line. */
function flattenBlock(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw
    .split(/\r\n|\r|\n/)
    .map(line => flatten(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Trim to `max` characters on a word boundary.
 *
 * Cutting mid-word is what makes a truncated meta description read as broken
 * rather than short, and Google shows the tail as an ellipsis either way.
 */
export function trimToBudget(s: string, max: number): string {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  // Only back up to a word boundary if one is reasonably near the end;
  // otherwise a single very long token would collapse the whole string.
  const body = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return body.replace(/[\s,;:–—-]+$/, '').trim()
}

/**
 * Fit a page title inside the budget while KEEPING the brand suffix.
 *
 * The COPY prompt asks for a title ending in "| Host Hampton" and
 * `app/[...slug]` renders it with `title: { absolute }` so the root layout's
 * template is not applied a second time. Truncating the string plainly would
 * therefore eat the brand off the end and leave the page unbranded in a SERP —
 * so the suffix is detached, the headline is trimmed, and the suffix is put
 * back. If the suffix alone will not fit, the title is trimmed without it.
 */
export function trimTitleToBudget(title: string, max = MAX_TITLE_CHARS): string {
  if (title.length <= max) return title
  const suffixRe = new RegExp(`\\s*\\|\\s*Host Hampton\\s*$`, 'i')
  if (!suffixRe.test(title)) return trimToBudget(title, max)
  const head = title.replace(suffixRe, '').trim()
  const room = max - TITLE_SUFFIX.length
  if (room < 12) return trimToBudget(head, max)
  return `${trimToBudget(head, room)}${TITLE_SUFFIX}`
}

/** Plain text from a model field, dropping any markup it smuggled in. */
function textField(raw: unknown, notes: string[], label: string, max: number): string {
  if (typeof raw !== 'string') return ''
  let s = raw
  if (containsMarkup(s)) {
    notes.push(`${label}: markup removed (this renderer publishes text, not HTML).`)
    s = htmlToPlainText(s)
  }
  const flat = flattenBlock(s)
  if (flat.length > max) {
    notes.push(`${label}: trimmed from ${flat.length} to ${max} characters.`)
    return trimToBudget(flat, max)
  }
  return flat
}

/**
 * Validate + bound one model reply. `ok: false` means the draft is not worth a
 * row; the caller must not insert it.
 */
export function normalizeDraft(raw: unknown): NormalizeOutcome {
  const notes: string[] = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Model reply was not a JSON object.', notes }
  }
  const r = raw as Record<string, unknown>

  // ── title ──────────────────────────────────────────────────────────────
  let title = flatten(r.title)
  if (containsMarkup(title)) {
    notes.push('title: markup removed.')
    title = flatten(htmlToPlainText(title))
  }
  if (!title) {
    return { ok: false, error: 'Model reply had no usable title.', notes }
  }
  if (title.length > MAX_TITLE_CHARS) {
    const trimmed = trimTitleToBudget(title)
    notes.push(`title: ${title.length} chars, over the ${MAX_TITLE_CHARS}-char budget — trimmed to ${trimmed.length}.`)
    title = trimmed
  }

  // ── meta description ───────────────────────────────────────────────────
  const meta_description = textField(r.meta_description, notes, 'meta_description', MAX_DESCRIPTION_CHARS)

  // ── keywords ───────────────────────────────────────────────────────────
  const rawKeywords = Array.isArray(r.keywords) ? r.keywords : []
  if (!Array.isArray(r.keywords) && r.keywords != null) {
    notes.push('keywords: dropped — not an array.')
  }
  const keywords: string[] = []
  for (const k of rawKeywords) {
    const flat = flatten(k)
    if (!flat) continue
    keywords.push(trimToBudget(flat, MAX_KEYWORD_CHARS))
    if (keywords.length >= MAX_KEYWORDS) break
  }
  if (rawKeywords.length > keywords.length) {
    notes.push(`keywords: kept ${keywords.length} of ${rawKeywords.length}.`)
  }

  // ── sections ───────────────────────────────────────────────────────────
  const rawSections = Array.isArray(r.sections) ? r.sections : []
  if (!Array.isArray(r.sections) && r.sections != null) {
    notes.push('sections: dropped — not an array.')
  }
  const sections: NormalizedSection[] = []
  let droppedHtmlKeys = 0
  for (const s of rawSections) {
    if (s === null || typeof s !== 'object' || Array.isArray(s)) continue
    const sec = s as Record<string, unknown>
    // `html` is the key the renderer used to execute. It is never stored.
    if (typeof sec.html === 'string' && sec.html.trim()) droppedHtmlKeys++
    const heading = textField(sec.heading, notes, 'section heading', MAX_SECTION_HEADING_CHARS)
    // A section that only offered `html` still has its prose recovered from it,
    // rather than being thrown away — rule 15 says do not GUESS at an input,
    // not that text inside markup is unreadable.
    const text =
      textField(sec.text, notes, 'section text', MAX_SECTION_TEXT_CHARS) ||
      textField(sec.html, notes, 'section html', MAX_SECTION_TEXT_CHARS)
    if (!heading && !text) continue
    sections.push({ heading, text })
    if (sections.length >= MAX_SECTIONS) break
  }
  if (droppedHtmlKeys > 0) {
    notes.push(
      `sections: ${droppedHtmlKeys} section(s) returned an "html" field. The renderer publishes text, ` +
      `not model-authored markup, so the tags were stripped and only the prose was kept.`,
    )
  }
  if (rawSections.length > sections.length) {
    notes.push(`sections: kept ${sections.length} of ${rawSections.length}.`)
  }

  // ── faq ────────────────────────────────────────────────────────────────
  const rawFaq = Array.isArray(r.faq) ? r.faq : []
  if (!Array.isArray(r.faq) && r.faq != null) {
    notes.push('faq: dropped — not an array.')
  }
  const faq: NormalizedFaq[] = []
  for (const f of rawFaq) {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) continue
    const item = f as Record<string, unknown>
    const q = textField(item.q, notes, 'faq question', MAX_FAQ_Q_CHARS)
    const a = textField(item.a, notes, 'faq answer', MAX_FAQ_A_CHARS)
    // A question with no answer is worse than no FAQ: it publishes a
    // `Question` node with an empty `acceptedAnswer` into structured data.
    if (!q || !a) continue
    faq.push({ q, a })
    if (faq.length >= MAX_FAQ_ITEMS) break
  }
  if (rawFaq.length > faq.length) {
    notes.push(`faq: kept ${faq.length} of ${rawFaq.length}.`)
  }

  // A landing page with no body is not a draft; it is a title nobody can
  // review. Refuse rather than queue an empty page for a human.
  if (sections.length === 0 && faq.length === 0) {
    return { ok: false, error: 'Model reply produced no usable sections or FAQ.', notes }
  }

  return { ok: true, draft: { title, meta_description, keywords, sections, faq }, notes }
}
