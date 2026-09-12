/**
 * The writer-side parser and screens for a model-written social post.
 *
 * A caption is copy that would go out under Host Hampton's name to the public.
 * Everything §23 and §24 established about the learning loop applies, because it
 * is the same shape: an LLM writes text, a human approves it, and the human is
 * skimming. So the model's reply is PARSED — a TypeScript annotation is a cast,
 * not a parser (docs/content-pipeline.md §5) — and every field is bounded,
 * flattened and screened before it can reach the database.
 *
 * The screens are IMPORTED, never restated (hard-won rule 11):
 *   - `containsFabricatedTerms` with an EMPTY allowed-amount set, so a social
 *     caption may state no dollar figure at all. The mobile pricing rework means
 *     every published mobile figure is under review (PLAN.md §15) and
 *     `seo.test.ts` already asserts no mobile surface publishes a price; the
 *     same rule binds generated copy.
 *   - `containsForeignContact`, because a link or a payment handle that is not
 *     ours is the highest-value thing an injection could get published.
 *   - `containsMarkup`, because a caption is plain text everywhere it renders.
 *   - `safeSiteLink` for the one URL field.
 */

import {
  containsFabricatedTerms,
  containsForeignContact,
  NO_AMOUNTS_ALLOWED,
} from '@/lib/agent/draftGuards'
import { containsMarkup, htmlToPlainText, safeSiteLink } from '@/lib/content/contentSafety'

/** Instagram's own caption ceiling. Anything near it is not a caption anyway. */
export const MAX_CAPTION_CHARS = 2200
export const MAX_HASHTAGS = 12
export const MAX_HASHTAG_CHARS = 40
export const MAX_CTA_CHARS = 80
export const MAX_IMAGE_IDEA_CHARS = 300

/**
 * The labels of the existing `social_platform` enum, not a list we invented.
 * Note `facebook_page` — the enum has no bare `facebook`, and inserting one is a
 * 22P02 at runtime that no mocked test would ever see (rule 13: read the
 * constraint, do not remember it).
 */
export const PLATFORMS = ['instagram', 'facebook_page', 'google_business'] as const
export const POST_TYPES = ['event', 'evergreen', 'seasonal', 'behind_the_scenes', 'community'] as const

export type Platform = (typeof PLATFORMS)[number]
export type PostType = (typeof POST_TYPES)[number]

export interface NormalizedPost {
  caption: string
  hashtags: string[]
  image_idea: string | null
  call_to_action: string | null
  link_url: string | null
}

export type NormalizeResult =
  | { ok: true; post: NormalizedPost; notes: string[] }
  | { ok: false; error: string }

/**
 * Flatten the characters that forge structure without being visible.
 *
 * Newlines are KEPT — a caption has paragraphs — but the C0 controls that are
 * not a newline, the whole C1 block, U+2028/U+2029 and everything that occupies
 * no width go. §24's finding in one sentence: a rule that renders as one line in
 * the panel to the very person whose approval is the guardrail can open a second
 * line somewhere else.
 *
 * The first version of this list was written from memory and missed the family
 * that matters most today: **the Unicode TAG block, U+E0000–U+E007F, whose code
 * points mirror ASCII one for one.** A caption ending in tag characters renders
 * as nothing at all in the review panel, survives the clipboard intact, and says
 * whatever the writer wanted wherever it is finally read. Same class as U+2028
 * in §24 — invisible structure inside a value a human is signing off on.
 *
 * Built by code point, never by typing a literal: an invisible character in a
 * source file is a screen nobody can read in a diff.
 */
function isInvisible(cp: number): boolean {
  if (cp === 0x00ad) return true // soft hyphen
  if (cp === 0x061c) return true // Arabic letter mark
  if (cp === 0x180e) return true // Mongolian vowel separator (Cf since Unicode 6.3)
  if (cp >= 0x200b && cp <= 0x200f) return true // ZWSP/ZWNJ/ZWJ, LRM, RLM
  if (cp >= 0x202a && cp <= 0x202e) return true // bidi embeddings and overrides
  if (cp >= 0x2060 && cp <= 0x2064) return true // word joiner, invisible operators
  if (cp >= 0x2066 && cp <= 0x2069) return true // bidi isolates
  if (cp === 0xfeff) return true // BOM / zero-width no-break space
  if (cp === 0x115f || cp === 0x1160 || cp === 0x3164 || cp === 0xffa0) return true // Hangul fillers
  if (cp >= 0xfff9 && cp <= 0xfffb) return true // interlinear annotation
  if (cp >= 0xe0000 && cp <= 0xe007f) return true // TAG block — invisible ASCII
  if (cp >= 0xe0100 && cp <= 0xe01ef) return true // variation selectors supplement
  return false
}

export function sanitizeCaptionText(input: unknown): string {
  const s = typeof input === 'string' ? input : ''
  let out = ''
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number
    if (cp === 0x0a) {
      out += '\n'
      continue
    }
    if (cp === 0x09 || cp === 0x0d) {
      out += ' '
      continue
    }
    if (cp < 0x20 || cp === 0x7f) continue
    if (cp >= 0x80 && cp <= 0x9f) continue
    if (cp === 0x2028 || cp === 0x2029 || cp === 0x0085) {
      out += '\n'
      continue
    }
    // A LONE SURROGATE is not a character. `for…of` yields it on its own when it
    // is unpaired, and storing it produces U+FFFD in every consumer and a
    // `\uXXXX` error inside Postgres jsonb. Rule 15: an input that cannot be
    // interpreted is DROPPED, never guessed at. A well-formed pair arrives here
    // as one code point above 0xFFFF and is untouched.
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    if (isInvisible(cp)) continue
    out += ch
  }
  return out.replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

/**
 * Cut to a budget without splitting a character in half.
 *
 * `slice()` counts UTF-16 code units, so cutting a caption that ends on an emoji
 * — which is a normal thing for a caption to do — leaves a lone surrogate, and a
 * lone surrogate is not a character: it serialises as U+FFFD. That is
 * docs/content-pipeline.md §11.4, found in the SEO trim; the same arithmetic is
 * wrong here for the same reason.
 */
export function trimChars(s: string, max: number): string {
  const chars = Array.from(s)
  if (chars.length <= max) return s
  return chars.slice(0, max).join('').trimEnd()
}

export function normalizeHashtag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const cleaned = sanitizeCaptionText(raw).replace(/\s+/g, '')
  const body = cleaned.replace(/^#+/, '')
  // Letters, digits and underscore are what a hashtag can actually contain on
  // every platform we target. Anything else means the model wrote a phrase.
  if (!/^[A-Za-z0-9_]{2,}$/.test(body)) return null
  return `#${trimChars(body, MAX_HASHTAG_CHARS - 1)}`
}

/**
 * Turn one element of the model's reply into a row, or say why not.
 *
 * A refusal is NOT a silent drop: the caller writes every reason to the ledger
 * and the panel (rule 10).
 */
export function normalizeSocialPost(raw: unknown): NormalizeResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'not an object' }
  }
  const o = raw as Record<string, unknown>
  const notes: string[] = []

  let caption = sanitizeCaptionText(o.caption)
  if (!caption) return { ok: false, error: 'no caption' }

  if (containsMarkup(caption)) {
    const stripped = htmlToPlainText(caption)
    // Rule 10 in reverse (§11.5): only claim a strip that actually happened.
    if (stripped !== caption) notes.push('markup removed from caption')
    caption = sanitizeCaptionText(stripped)
    if (!caption) return { ok: false, error: 'caption was entirely markup' }
  }

  if (Array.from(caption).length > MAX_CAPTION_CHARS) {
    caption = trimChars(caption, MAX_CAPTION_CHARS)
    notes.push(`caption trimmed to ${MAX_CAPTION_CHARS} characters`)
  }

  const money = containsFabricatedTerms(caption, { allowedAmounts: NO_AMOUNTS_ALLOWED })
  if (money) return { ok: false, error: `caption states ${money}` }

  const foreign = containsForeignContact(caption)
  if (foreign) return { ok: false, error: `caption carries a ${foreign}` }

  const hashtags: string[] = []
  if (Array.isArray(o.hashtags)) {
    for (const h of o.hashtags) {
      const tag = normalizeHashtag(h)
      if (!tag) {
        notes.push('a hashtag was dropped (not a hashtag)')
        continue
      }
      if (hashtags.includes(tag)) continue
      if (hashtags.length >= MAX_HASHTAGS) {
        notes.push(`hashtags capped at ${MAX_HASHTAGS}`)
        break
      }
      hashtags.push(tag)
    }
  }

  const textField = (v: unknown, max: number, label: string): string | null => {
    let s = sanitizeCaptionText(v).replace(/\n+/g, ' ').trim()
    if (!s) return null
    if (containsMarkup(s)) {
      const stripped = htmlToPlainText(s)
      if (stripped !== s) notes.push(`markup removed from ${label}`)
      s = sanitizeCaptionText(stripped).replace(/\n+/g, ' ').trim()
      if (!s) return null
    }
    if (Array.from(s).length > max) {
      s = trimChars(s, max)
      notes.push(`${label} trimmed to ${max} characters`)
    }
    return s
  }

  const call_to_action = textField(o.call_to_action, MAX_CTA_CHARS, 'call to action')
  const image_idea = textField(o.image_idea, MAX_IMAGE_IDEA_CHARS, 'image idea')

  // The CTA is customer-facing copy too, and it is exactly where "DM us for
  // 20% off" would land. Same screen, same reason.
  if (call_to_action) {
    const ctaMoney = containsFabricatedTerms(call_to_action, { allowedAmounts: NO_AMOUNTS_ALLOWED })
    if (ctaMoney) return { ok: false, error: `call to action states ${ctaMoney}` }
    const ctaForeign = containsForeignContact(call_to_action)
    if (ctaForeign) return { ok: false, error: `call to action carries a ${ctaForeign}` }
  }

  let link_url: string | null = null
  if (o.link_url != null && o.link_url !== '') {
    link_url = safeSiteLink(typeof o.link_url === 'string' ? o.link_url : null)
    if (!link_url) notes.push('link dropped — not a hosthampton.com URL')
  }

  return { ok: true, post: { caption, hashtags, image_idea, call_to_action, link_url }, notes }
}

export function isPlatform(v: unknown): v is Platform {
  return typeof v === 'string' && (PLATFORMS as readonly string[]).includes(v)
}

export function isPostType(v: unknown): v is PostType {
  return typeof v === 'string' && (POST_TYPES as readonly string[]).includes(v)
}

/**
 * The same screens, applied on the way OUT.
 *
 * A row being `draft` in Postgres is not evidence it ever passed a screen (rule
 * 8): migration 043 is the only thing standing between a hand-written INSERT and
 * the admin panel, and §24 found precisely this — a live voice profile that had
 * never been near the sanitiser it was written for. Returns the reasons a stored
 * row would be refused today, empty when it is clean.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `hashtags` and `image_idea` are screened here because **the panel renders
 * them**, which is the only test that matters (hard-won rule 11, sharpest form:
 * a field read by two readers and screened in only one is a screen nobody is
 * applying). `SocialTab` prints the hashtag line under the caption and the
 * "Photo:" block under that; Allie reads both as vetted copy and copies the
 * hashtags into Instagram by hand. The writer-side parser bounds them —
 * `normalizeHashtag` allows only `[A-Za-z0-9_]` — but the whole premise of this
 * function is that a row can arrive without ever meeting the writer, and the
 * PATCH edit path is a second writer that never ran that parser either.
 */
export function screenStoredPost(row: {
  caption?: string | null
  call_to_action?: string | null
  link_url?: string | null
  hashtags?: unknown
  image_idea?: string | null
}): string[] {
  const problems: string[] = []
  const caption = String(row.caption ?? '')

  if (containsMarkup(caption)) problems.push('caption contains markup')
  const money = containsFabricatedTerms(caption, { allowedAmounts: NO_AMOUNTS_ALLOWED })
  if (money) problems.push(`caption states ${money}`)
  const foreign = containsForeignContact(caption)
  if (foreign) problems.push(`caption carries a ${foreign}`)
  if (sanitizeCaptionText(caption) !== caption.trim()) {
    problems.push('caption contains invisible or control characters')
  }

  /** The same four questions, asked of any other field a human reads. */
  const screenText = (value: string, label: string): void => {
    if (containsMarkup(value)) problems.push(`${label} contains markup`)
    const amt = containsFabricatedTerms(value, { allowedAmounts: NO_AMOUNTS_ALLOWED })
    if (amt) problems.push(`${label} states ${amt}`)
    const fc = containsForeignContact(value)
    if (fc) problems.push(`${label} carries a ${fc}`)
    if (sanitizeCaptionText(value) !== value.trim()) {
      problems.push(`${label} contains invisible or control characters`)
    }
  }

  if (row.call_to_action) screenText(String(row.call_to_action), 'call to action')
  if (row.image_idea) screenText(String(row.image_idea), 'image idea')

  if (Array.isArray(row.hashtags)) {
    for (const h of row.hashtags) {
      const raw = String(h ?? '')
      if (!raw) continue
      // Judged by the writer's own rule rather than a second one written here.
      if (!normalizeHashtag(raw)) {
        problems.push(`hashtag "${trimChars(raw, 40)}" is not a hashtag`)
        continue
      }
      screenText(raw, 'hashtag')
    }
  }

  if (row.link_url && !safeSiteLink(row.link_url)) {
    problems.push('link is not a hosthampton.com URL')
  }

  return problems
}
