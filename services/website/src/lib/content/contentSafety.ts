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

/**
 * What a browser treats as the start of a tag: `<` followed by a letter (a start
 * tag), `/` (an end tag), `!` (a declaration or comment) or `?` (a bogus
 * comment). Anything else after `<` is TEXT — `<10 guests` is prose, not markup.
 *
 * ONE source, because `containsMarkup` and the stripper below used to carry two
 * different definitions of "a tag": the predicate said `<[a-zA-Z!/?]` while the
 * stripper deleted `<[^>]*>`, which is anything at all between angle brackets.
 * The stripper's wider definition ate real copy — `"Groups of <10 guests and >4
 * adults"` came out as `"Groups of 4 adults"` and `"5 < 10 and 20 > 3"` as
 * `"5 3"` — on every render, silently, because `ContentRenderBody` and
 * `buildJsonLd` call `htmlToPlainText` unguarded on FAQ questions, FAQ answers
 * and section headings. A constant declared in two places is a constant nothing
 * is checking (rule 11); so is a definition.
 */
const TAG_OPEN_SOURCE = '<[a-zA-Z!/?]'
const TAG_OPEN_RE = new RegExp(TAG_OPEN_SOURCE)
/** A complete tag. Same opener as the predicate, so the two cannot drift. */
const tagRe = () => new RegExp(`${TAG_OPEN_SOURCE}[^>]*>`, 'g')

/** Does this string carry anything a browser would parse as markup? */
export function containsMarkup(s: string | null | undefined): boolean {
  if (!s) return false
  return TAG_OPEN_RE.test(s)
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
  s = s.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
  s = s.replace(tagRe(), '')
  s = decodeEntities(s)
  // A second pass: decoding can reveal markup that was entity-encoded once.
  s = s.replace(tagRe(), '')
  return s
    .split('\n')
    .map(line => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Origin this site is served from. Relative image paths resolve against it, and
 * a URL that resolves back to it is returned as a bare path.
 */
const SITE_ORIGIN = 'https://www.hosthampton.com'

/**
 * The only hosts a DB-authored image may come from.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY AN ALLOWLIST AND NOT "any https URL". The previous screen accepted any
 * `http(s)://host`, which is two different problems on a page we publish:
 *
 *  - **`<img src>`** — every visitor's IP address, User-Agent and Referer are
 *    handed to whoever owns that host, on a page of ours, with no consent
 *    banner and nothing in the DOM that looks wrong.
 *  - **`og:image`** — the share card Facebook, iMessage and Slack render for a
 *    Host Hampton URL becomes whatever that host decides to serve, and it can
 *    change after a human approved the row.
 *
 * `featured_image` and `structured.gallery[]` are written by the COPY agent, so
 * rule 5 applies: the field is hostile because of who can WRITE it. The hosts
 * below are the ones the app already declares — `SITE_URL` and the Supabase
 * storage bucket in `next.config.js` `images.domains`. A test asserts this list
 * still covers that config, so adding an image host in one place and not the
 * other fails the suite rather than silently refusing every image from it.
 *
 * `http:` is not accepted for a remote host: this site is https, so a plaintext
 * subresource is blocked as mixed content by every browser anyway — allowing it
 * only created a value that looked screened and could never load.
 */
export const ALLOWED_IMAGE_HOSTS: readonly string[] = [
  'www.hosthampton.com',
  'hosthampton.com',
  'ychnlroczjhwimouecxz.supabase.co',
]

/**
 * Is this a URL we are willing to point an `<img src>` at?
 *
 * Returns the RESOLVED, re-serialised URL — what a URL parser agreed the string
 * means — or null when the value is unusable, so the caller renders no image
 * rather than a broken or hostile one.
 *
 * The screen PARSES rather than prefix-matches, because prefix-matching this is
 * how the protocol-relative check got bypassed:
 *
 *     safeImageUrl('/\\evil.example.com/x.png')   // old: allowed, "site-relative"
 *     new URL('/\\evil.example.com/x.png', SITE)  // → https://evil.example.com/x.png
 *
 * The WHATWG URL spec normalises a backslash to a forward slash in a special
 * scheme, so one backslash turns a path the screen read as local into a
 * different ORIGIN in every browser. `startsWith('//')` was the whole guard and
 * it never saw it. Measured, not reasoned about (rule 8).
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
  // Refused outright rather than normalised: a backslash in an image URL is
  // never what a writer meant, and leaving it to the parser is how the meaning
  // of the string stops matching the meaning of the check above it.
  if (s.includes('\\')) return null
  // Only two shapes are even considered — an absolute http(s) URL, or a
  // site-relative path. `images/x.png` and `javascript:` never reach the parser.
  if (!/^(?:https?:\/\/|\/)/i.test(s)) return null

  let url: URL
  try {
    url = new URL(s, SITE_ORIGIN)
  } catch {
    return null
  }
  // https only. A site-relative path resolves to https by construction, so this
  // rejects exactly one thing: an explicit `http://` URL, which a browser blocks
  // as mixed content anyway — a value that looked screened and could never load.
  if (url.protocol !== 'https:') return null
  if (!ALLOWED_IMAGE_HOSTS.includes(url.host.toLowerCase())) return null
  // Site-relative in, site-relative out: the page should not start emitting
  // absolute URLs for its own images just because they went through a parser.
  if (url.origin === SITE_ORIGIN) return `${url.pathname}${url.search}${url.hash}`
  return url.href
}

/**
 * Is this a URL we are willing to put in a social caption's "link in bio" slot?
 *
 * Narrower than `safeImageUrl` and deliberately so: an image may come from the
 * Supabase bucket, but a link we publish under Host Hampton's name goes to Host
 * Hampton and nowhere else. A model wrote this field, and a link is the single
 * most valuable thing an injected instruction could get us to publish.
 *
 * Returns the ABSOLUTE https URL (a caption is read outside a browser context,
 * so a bare path means nothing there), or null.
 *
 * Shares `safeImageUrl`'s parsing rather than repeating it — same control-char
 * and backslash refusals, same `new URL` resolution, same "check the host the
 * parser agreed on". Rule 11: two implementations of one screen is a screen
 * nothing is checking, and the backslash bypass in §11.1 is exactly what
 * reasoning about prefixes a second time would reproduce.
 */
export function safeSiteLink(raw: string | null | undefined): string | null {
  const screened = safeImageUrl(raw)
  if (!screened) return null
  // safeImageUrl returns a bare path for our own origin and an absolute URL for
  // any other allowed host. Only our origin is acceptable here, so anything that
  // came back absolute is by definition not ours.
  if (!screened.startsWith('/')) return null
  return `${SITE_ORIGIN}${screened}`
}
