/**
 * What a `website_content` row is allowed to put on a page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. `ContentRenderBody` used to hand two DB columns straight to
 * `dangerouslySetInnerHTML`: `structured.sections[].html` and `body_html`. That
 * component renders in two places — the PUBLIC page at `app/[...slug]`, and the
 * ADMIN PREVIEW MODAL, which is where a reviewer looks at a draft while holding
 * an authenticated `hh_admin` session. `website_content` is written by the COPY
 * agent: `createTownServiceDraft` runs `JSON.parse` on a model's reply and
 * stores `draft.sections` wholesale, so a model that answered with
 * `{"heading":"…","html":"<img src=x onerror=…>"}` — the same JSON shape, one
 * different key — got that markup executed in the reviewer's own session, and
 * then on a public page once approved.
 *
 * Hard-won rule 5: a field is hostile because of who can WRITE it, not which
 * block it prints in. Rule 5 is also why the fix is at the READER and not only
 * at the writer — `body_html` is a column, and the next writer will not
 * remember.
 *
 * The screen is deliberately not a sanitiser. A sanitiser is a list of things
 * you thought of; this renderer has never needed markup at all (no live row
 * sets `body_html`, no section carries `html`, and the COPY prompt asks for
 * "plain text, no HTML"), so the safe answer is that DB content is TEXT. A
 * hand-built HTML page belongs in `app/`, where it is reviewed in a diff.
 *
 * Rule 10: when this drops something it says so, and the admin panel badges the
 * row, so a stripped page is never silently a shorter page.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
}

function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      // Only decode into safe scalar values; a lone surrogate or an out-of-range
      // code point is left as written rather than guessed at (rule 15).
      if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return whole
      return String.fromCodePoint(code)
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? whole
  })
}

/** Does this string carry anything a browser would parse as markup? */
export function containsMarkup(s: string | null | undefined): boolean {
  if (!s) return false
  return /<[a-zA-Z!/?]/.test(s)
}

/**
 * Reduce DB-authored "HTML" to the text a reader was meant to see.
 *
 * Block-level tags become line breaks so a stripped page still has paragraphs;
 * `<script>` / `<style>` bodies are removed ENTIRELY rather than turned into
 * visible text, because their content is code, not copy.
 */
export function htmlToPlainText(input: string | null | undefined): string {
  if (!input) return ''
  let s = String(input)
  s = s.replace(/<(script|style|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
  // An unterminated <script> is the interesting case: drop to end of string.
  s = s.replace(/<(script|style|template)\b[\s\S]*$/i, ' ')
  s = s.replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
  s = s.replace(/<[^>]*>/g, '')
  s = decodeEntities(s)
  // A second pass: decoding can reveal markup that was entity-encoded once.
  s = s.replace(/<[^>]*>/g, '')
  return s
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Is this a URL we are willing to point an `<img src>` at?
 *
 * `featured_image` and `structured.gallery[]` are DB-authored too. A relative
 * path or an absolute http(s) URL is fine; `javascript:`, `data:` and protocol-
 * relative `//evil/x.png` are not. Returns null when the value is unusable, so
 * the caller renders no image rather than a broken or hostile one.
 */
export function safeImageUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = String(raw).trim()
  if (!s) return null
  // Control characters are how a java<NUL>script: style bypass is built, and
  // U+2028/U+2029 are the pair that has already cost this codebase a guardrail
  // (plan 24). Tested by CODE POINT, never as a literal: an invisible character
  // typed into a source file is a screen nobody can read in a diff.
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number
    if (cp < 0x20 || cp === 0x7f || (cp >= 0x80 && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029) return null
  }
  if (s.startsWith('//')) return null
  if (s.startsWith('/')) return s
  if (/^https?:\/\/[^/\s]+/i.test(s)) return s
  return null
}
