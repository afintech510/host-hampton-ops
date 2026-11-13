/**
 * The registry link and message on the public invitation page (migration 097). Pure.
 *
 *   screenRegistryUrl(v)  a typed value -> { ok, value } (value null = cleared) | { ok: false }
 *   registryView(url, note) the page's "Registry & message" section, or null when neither is set
 *
 * The link is a host's own text and ends up in an `href` on a guest-facing page, so the rule is
 * strict and is applied TWICE: when it is saved, and again when the page is drawn (a row written
 * some other way, or by a looser version of this screen, can never reach an anchor). https only;
 * no credentials; no whitespace or control characters; a real host name (a dot, never an IP
 * literal or `localhost`); at most 298 characters, the bound the table's CHECK enforces.
 * The page shows the HOSTNAME only, so a long tracking query string is never printed.
 */

export const REGISTRY_URL_MAX = 298
export const REGISTRY_NOTE_MAX = 300

/** The stored form of a registry link, or null when it is not an acceptable https link. */
export function cleanRegistryUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (s.length < 11 || s.length > REGISTRY_URL_MAX) return null
  if (/[\s\x00-\x1f\x7f<>"'`\\]/.test(s)) return null
  if (!/^https:\/\//.test(s)) return null
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '') return null
  const host = u.hostname.toLowerCase()
  if (!host.includes('.') || host.startsWith('.') || host.endsWith('.') || host.startsWith('[')) return null
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return null
  return s
}

export type RegistryUrlResult = { ok: true; value: string | null } | { ok: false }

export function screenRegistryUrl(v: unknown): RegistryUrlResult {
  if (v === null || (typeof v === 'string' && v.trim() === '')) return { ok: true, value: null }
  const c = cleanRegistryUrl(v)
  return c === null ? { ok: false } : { ok: true, value: c }
}

/** 'babylist.com' for `https://www.babylist.com/list/abc?x=1`: the host without a leading `www.`. */
export function registryHostname(url: string): string | null {
  const c = cleanRegistryUrl(url)
  if (c === null) return null
  return new URL(c).hostname.toLowerCase().replace(/^www\./, '')
}

export interface RegistryView {
  note: string | null
  /** The link and the hostname the button shows, or null when there is no (acceptable) link. */
  link: { href: string; host: string } | null
}

export function registryView(url: unknown, note: unknown): RegistryView | null {
  const href = cleanRegistryUrl(url)
  const host = href ? registryHostname(href) : null
  const n = typeof note === 'string' && note.trim() !== '' ? note.trim() : null
  const link = href && host ? { href, host } : null
  if (!link && !n) return null
  return { note: n, link }
}
