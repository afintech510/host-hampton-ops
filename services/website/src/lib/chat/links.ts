/**
 * What the chat widget is willing to turn into a link or an image.
 *
 * Pure and import-free (the widget is a client component). The server already
 * screens what the model says (lib/chat/text.ts), and the widget does not trust
 * that to be the only line: a URL becomes a clickable link only when its ORIGIN is
 * one the page itself is served from, and everything else stays inert text.
 */

export type Segment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string }

const URL_RE = /https?:\/\/[^\s<>"')\]]+/gi

/** Trailing punctuation that belongs to the sentence, not the URL. */
function trimUrl(raw: string): { url: string; rest: string } {
  const m = /[.,;:!?]+$/.exec(raw)
  return m ? { url: raw.slice(0, -m[0].length), rest: m[0] } : { url: raw, rest: '' }
}

/** The URL if its origin is one of `origins`, else null. Never a `javascript:` or protocol-relative anything. */
export function sameOriginUrl(raw: string, origins: readonly string[]): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return origins.includes(u.origin) ? u.toString() : null
  } catch {
    return null
  }
}

/** Split a reply into text and links; only same-origin URLs become links. */
export function linkSegments(text: string, origins: readonly string[]): Segment[] {
  const out: Segment[] = []
  let last = 0
  let m: RegExpExecArray | null
  const re = new RegExp(URL_RE.source, 'gi')
  while ((m = re.exec(text)) !== null) {
    const { url, rest } = trimUrl(m[0])
    const href = sameOriginUrl(url, origins)
    if (!href) continue
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) })
    out.push({ kind: 'link', text: url, href })
    last = m.index + url.length
    if (rest) re.lastIndex = last
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) })
  return out
}

/** An image URL the widget will load: https, or a path on this site. */
export function imageSrc(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 600) return null
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  try {
    return new URL(raw).protocol === 'https:' ? raw : null
  } catch {
    return null
  }
}

/** The path of an on-site link, so "see more" stays on whichever host the visitor is on. */
export function onSitePath(raw: unknown, origins: readonly string[]): string | null {
  if (typeof raw !== 'string') return null
  const href = sameOriginUrl(raw, origins)
  if (!href) return raw.startsWith('/') && !raw.startsWith('//') ? raw : null
  const u = new URL(href)
  return `${u.pathname}${u.search}`
}
