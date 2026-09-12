/**
 * Screening a variant — on the way IN and on the way OUT.
 *
 * ── Why both ways ───────────────────────────────────────────────────────────
 *
 * Plan §24's headline finding: `sanitizeVoiceProfile` was correct, well
 * reasoned, and ran only on what the distiller PROPOSED. The profile that was
 * actually live had never been near it, and it had been feeding mobile prices
 * into a prompt that says "ABSOLUTELY NO PRICING" for months.
 *
 * A `content_variants` row is written by a model and read by a CUSTOMER. It can
 * also be written straight into Postgres, edited by hand, or predate a screen
 * rule that was tightened afterwards. So a row being in the table is not
 * evidence it ever passed a screen (hard-won rule 8), and `screenVariant` runs
 * at read time in `loadVariants()` as well as at write time in `generate.ts`.
 *
 * ── Why the model writes PLAIN TEXT and we build the HTML ───────────────────
 *
 * `content-pipeline.md` §2 settled this argument once: the renderer was handed
 * agent-written HTML for `dangerouslySetInnerHTML`, and the fix was to make the
 * stored content TEXT rather than to add a sanitiser — "a sanitiser is a list of
 * things you thought of". Same choice here, and the stakes are higher, because
 * a variant body goes into a MAIL body where the same markup reaches an inbox
 * we do not control and cannot audit.
 *
 * So: the model writes `subject` (one line) and `body_text` (plain paragraphs).
 * `bodyHtmlFromText()` builds the HTML, escaped. No model-written markup ever
 * reaches an email.
 *
 * ── The placeholder rule is rule 15 ─────────────────────────────────────────
 *
 * `lib/sequences/render.ts` knows exactly four `{{tokens}}`. Anything else in a
 * body is rendered to the recipient LITERALLY — "Hi {{customer_first}}," in a
 * real inbox. An input the renderer cannot interpret is refused, never guessed
 * at and never passed through.
 */

import { escapeHtml } from '@/lib/escapeHtml'
import { containsFabricatedTerms, containsForeignContact, NO_AMOUNTS_ALLOWED } from '@/lib/agent/draftGuards'
import { flattenToOneLine } from '@/lib/agent/extractPlanFields'
import { sanitizeCaptionText, trimChars } from '@/lib/social/normalize'
import { containsMarkup, safeSiteLink } from '@/lib/content/contentSafety'
import { MAX_SUBJECT_CHARS, MAX_BODY_CHARS } from './types'

/**
 * The placeholders `lib/sequences/render.ts` substitutes. Imported in spirit and
 * asserted against that module's own list by `experimentScreen.test.ts`, so the
 * two cannot drift into a body carrying a token nothing replaces (rule 11).
 */
export const ALLOWED_PLACEHOLDERS = ['first_name', 'business_name', 'booking_ref', 'unsubscribe_url'] as const

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]*)\s*\}\}/g

/**
 * Are there any `{{` or `}}` left over once the well-formed placeholders are
 * removed? Counted rather than matched with a lookbehind: a variable-length
 * lookbehind is legal in V8 and unreadable, and a regex that has to be clever
 * about its own boundaries is how the two `containsMarkup` definitions in
 * content-pipeline.md §11.3 came to disagree.
 */
function hasStrayBraces(text: string): boolean {
  const stripped = text.replace(PLACEHOLDER_RE, ' ')
  return stripped.includes('{{') || stripped.includes('}}')
}

export interface VariantCopy {
  subject: string
  bodyText: string
}

export type ScreenResult =
  | { ok: true; copy: VariantCopy; notes: string[] }
  | { ok: false; reason: string }

/**
 * Screen one variant's copy.
 *
 * Returns the CLEANED copy plus every change it made (rule 10: a guardrail that
 * trimmed something has to say it trimmed it), or the reason it refused.
 *
 * Never throws. This runs inside the send path and inside the read path; a
 * screen that throws would take the sequencer down with it.
 */
export function screenVariant(raw: { subject?: unknown; bodyText?: unknown }): ScreenResult {
  const notes: string[] = []

  // ── subject: a mail HEADER, so one line, always ──────────────────────────
  if (typeof raw.subject !== 'string' || flattenToOneLine(raw.subject).length === 0) {
    return { ok: false, reason: 'it has no subject line' }
  }
  let subject = flattenToOneLine(raw.subject)
  if (Array.from(subject).length > MAX_SUBJECT_CHARS) {
    subject = trimChars(subject, MAX_SUBJECT_CHARS)
    notes.push(`subject trimmed to ${MAX_SUBJECT_CHARS} characters`)
  }

  // ── body: plain text, paragraphs kept ────────────────────────────────────
  if (typeof raw.bodyText !== 'string') {
    return { ok: false, reason: 'it has no body text' }
  }
  // `sanitizeCaptionText` is the strongest invisible-character screen in the
  // codebase — it knows the TAG block, the Hangul fillers and lone surrogates
  // that §11.5 of the Phase 4 review added. Imported, not restated (rule 11).
  let bodyText = sanitizeCaptionText(raw.bodyText)
  if (bodyText !== String(raw.bodyText)) notes.push('invisible or control characters removed from the body')
  if (bodyText.trim().length < 40) {
    return { ok: false, reason: 'the body is too short to be an email' }
  }
  if (Array.from(bodyText).length > MAX_BODY_CHARS) {
    bodyText = trimChars(bodyText, MAX_BODY_CHARS)
    notes.push(`body trimmed to ${MAX_BODY_CHARS} characters`)
  }

  // ── markup: the model may not write any ──────────────────────────────────
  // One shared definition of "a tag" (content-pipeline.md §11.3 — two
  // definitions in one file turned "Groups of <10 guests" into "Groups of").
  for (const [field, value] of [['subject', subject], ['body', bodyText]] as const) {
    if (containsMarkup(value)) {
      return { ok: false, reason: `the ${field} contains markup — this surface takes plain text only` }
    }
  }

  // ── placeholders the renderer cannot interpret ───────────────────────────
  const combined = `${subject}\n${bodyText}`
  let pm: RegExpExecArray | null
  PLACEHOLDER_RE.lastIndex = 0
  while ((pm = PLACEHOLDER_RE.exec(combined)) !== null) {
    const token = pm[1]
    if (!(ALLOWED_PLACEHOLDERS as readonly string[]).includes(token)) {
      return {
        ok: false,
        reason:
          `it uses the placeholder "{{${token}}}", which nothing substitutes — ` +
          `a recipient would read it literally. Allowed: ${ALLOWED_PLACEHOLDERS.map(p => `{{${p}}}`).join(', ')}`,
      }
    }
  }
  if (hasStrayBraces(combined)) {
    return { ok: false, reason: 'it contains an unmatched "{{" or "}}"' }
  }

  // ── money and concessions ────────────────────────────────────────────────
  // NO_AMOUNTS_ALLOWED, exactly as the social calendar passes it: a marketing
  // email may state no dollar figure at all, not even the $250 deposit. Mobile
  // pricing is under review (PLAN.md §15) and the published $500/$750 tiers
  // stay up by Adam's choice — so generated copy names no number and points at
  // the website, which is the same rule `seo.test.ts` enforces on the site.
  const fabricated = containsFabricatedTerms(combined, { allowedAmounts: NO_AMOUNTS_ALLOWED })
  if (fabricated) return { ok: false, reason: `it states ${fabricated}` }

  // ── links, addresses, payment handles ────────────────────────────────────
  const foreign = containsForeignContact(combined)
  if (foreign) return { ok: false, reason: `it contains a ${foreign} that is not ours` }

  // `containsForeignContact` allows venmo.com and stripe.com because a QUOTE
  // draft legitimately links to them. A marketing variant does not: the only
  // links it may carry are ours, and `safeSiteLink` PARSES rather than
  // prefix-matching, which is the whole of content-pipeline.md §11.1 (one
  // backslash made `/\evil.example.com/x` site-relative to the screen and
  // another origin to every browser).
  for (const link of extractLinks(combined)) {
    if (!safeSiteLink(link)) {
      return { ok: false, reason: `it links to "${trimChars(link, 80)}", which is not a Host Hampton URL` }
    }
  }

  return { ok: true, copy: { subject, bodyText }, notes }
}

/** Every http(s) or protocol-relative URL in the text, as written. */
export function extractLinks(text: string): string[] {
  const out: string[] = []
  const re = /(?:https?:)?\/\/[^\s<>"')\]]+/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(String(text ?? ''))) !== null) out.push(m[0])
  return out
}

/**
 * Build the mail HTML from the screened plain text.
 *
 * Every character is `escapeHtml`'d, so there is no path by which model-written
 * markup reaches an inbox — the property that makes the "plain text in, HTML
 * out" choice above worth anything. Paragraphs are blank-line separated, which
 * is how the model is told to write them.
 *
 * `{{tokens}}` survive escaping (braces are not escaped) and are substituted
 * later by `renderStepEmail`, which escapes the VALUES as well.
 */
export function bodyHtmlFromText(bodyText: string): string {
  const paras = String(bodyText ?? '')
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
  const open = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#3d3530">'
  return `${open}${paras.join('')}</div>`
}
