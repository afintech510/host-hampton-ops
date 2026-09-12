/**
 * The forwarded-host screen.
 *
 * MEASURED IN PRODUCTION FIRST, 2026-09-12, before a line of this was written:
 *
 *     curl -H 'X-Forwarded-Host: evil.example.com' \
 *          https://www.hosthampton.com/api/portal/auth
 *     → 307  location: https://evil.example.com/my-booking/login?error=invalid
 *
 * nginx's HTTPS `default_server` answers 444 for an unknown `Host`, so `Host`
 * itself cannot be forged past the edge. `X-Forwarded-Host` is a different
 * story: nginx never SETS it, so it arrives exactly as the caller typed it, and
 * twenty-two routes preferred it over `Host` when building the origin for
 * customer emails, owner notifications, Stripe `success_url`s and redirects.
 *
 * Both directions are exercised here, because a screen is only proved by
 * refusing the payload AND letting the legitimate value through.
 */

import {
  publicOrigin,
  publicHost,
  isLocalRequest,
  screenRequestHost,
  CANONICAL_ORIGIN,
  CANONICAL_HOST,
  ALLOWED_REQUEST_HOSTS,
} from '@/lib/publicOrigin'
import { SITE_URL } from '@/lib/seo'

/** A request carrying exactly the headers named. */
function req(headers: Record<string, string>) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  return { headers: { get: (n: string) => lower[n.toLowerCase()] ?? null } }
}

let warn: jest.SpyInstance

beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => warn.mockRestore())

describe('the canonical origin agrees with the rest of the codebase', () => {
  it('matches lib/seo.ts, which is what every page and every JSON-LD node uses', () => {
    expect(CANONICAL_ORIGIN).toBe(SITE_URL)
  })

  it('the allowlist contains the canonical host', () => {
    expect(ALLOWED_REQUEST_HOSTS).toContain(CANONICAL_HOST)
    expect(CANONICAL_HOST).toBe('www.hosthampton.com')
  })
})

describe('legitimate hosts survive', () => {
  it.each([
    ['www.hosthampton.com', 'https://www.hosthampton.com'],
    ['hosthampton.com', 'https://hosthampton.com'],
    ['localhost:3002', 'http://localhost:3002'],
    ['127.0.0.1:3002', 'http://127.0.0.1:3002'],
  ])('%s → %s', (host, origin) => {
    expect(publicOrigin(req({ host }))).toBe(origin)
    expect(warn).not.toHaveBeenCalled()
  })

  it('is case-insensitive, because a Host header is', () => {
    expect(publicOrigin(req({ host: 'WWW.HostHampton.COM' }))).toBe(CANONICAL_ORIGIN)
  })

  it('prefers x-forwarded-host when it is one of ours', () => {
    expect(publicOrigin(req({ host: 'localhost:3002', 'x-forwarded-host': 'www.hosthampton.com' }))).toBe(
      CANONICAL_ORIGIN
    )
  })

  it('a local host is marked local, so a cookie is not given the Secure flag in dev', () => {
    expect(isLocalRequest(req({ host: 'localhost:3002' }))).toBe(true)
    expect(isLocalRequest(req({ host: 'www.hosthampton.com' }))).toBe(false)
  })

  it('a CLAIMED localhost cannot make a production request look local', () => {
    // Otherwise a caller drops the Secure flag off an admin session cookie by
    // asking for it — the reason isLocalRequest reads the screened host.
    expect(isLocalRequest(req({ host: 'www.hosthampton.com', 'x-forwarded-host': 'localhost' }))).toBe(false)
  })
})

describe('every hostile host form falls back to the canonical origin', () => {
  const HOSTILE: [string, string][] = [
    ['the production payload', 'evil.example.com'],
    ['a subdomain of the attacker that ENDS with our name', 'www.hosthampton.com.evil.example.com'],
    ['userinfo, where the real host is after the @', 'evil.example.com@www.hosthampton.com'],
    ['userinfo the other way round', 'www.hosthampton.com@evil.example.com'],
    ['userinfo with a port, which is the form that fools a split on :', 'www.hosthampton.com:80@evil.example.com'],
    ['a path glued on', 'www.hosthampton.com/../evil.example.com'],
    ['a backslash, which a URL parser normalises to a slash', 'www.hosthampton.com\\@evil.example.com'],
    ['a comma list, which is the multi-proxy spelling', 'www.hosthampton.com, evil.example.com'],
    ['a query string', 'www.hosthampton.com?x=evil.example.com'],
    ['a fragment', 'www.hosthampton.com#evil.example.com'],
    ['a protocol-relative prefix', '//evil.example.com'],
    ['an absolute URL where a host was expected', 'https://evil.example.com'],
    ['an IDN homograph of our own name', 'www.hosthampton.com'],
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a bare port', ':3002'],
  ]

  it.each(HOSTILE)('%s: %s', (_why, host) => {
    expect(publicOrigin(req({ 'x-forwarded-host': host }))).toBe(CANONICAL_ORIGIN)
    expect(publicHost(req({ 'x-forwarded-host': host }))).toBe(CANONICAL_HOST)
  })

  /**
   * Built by CODE POINT, never typed as a literal — an invisible character in a
   * source file is a screen nobody can read in a diff, which is the lesson from
   * `contentSafety.ts` and from plan §24's U+2028.
   */
  it.each([
    ['NUL', 0x00],
    ['CR', 0x0d],
    ['LF', 0x0a],
    ['TAB', 0x09],
    ['DEL', 0x7f],
    ['C1 (0x85, NEL)', 0x85],
    ['U+2028 LINE SEPARATOR', 0x2028],
    ['U+2029 PARAGRAPH SEPARATOR', 0x2029],
  ])('a %s inside the host is refused', (_name, cp) => {
    const host = `www.hosthampton${String.fromCodePoint(cp)}.com`
    expect(screenRequestHost(host)).toBeNull()
    expect(publicOrigin(req({ 'x-forwarded-host': host }))).toBe(CANONICAL_ORIGIN)
  })

  it('a header-splitting attempt cannot smuggle a second host', () => {
    const host = `www.hosthampton.com${String.fromCodePoint(0x0d)}${String.fromCodePoint(0x0a)}X-Evil: 1`
    expect(screenRequestHost(host)).toBeNull()
  })

  it('says so when it refuses, rather than falling back silently', () => {
    publicOrigin(req({ 'x-forwarded-host': 'evil.example.com' }))
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('evil.example.com')
    expect(String(warn.mock.calls[0][0])).toContain('refused')
  })

  it('does not warn when no host header was sent at all', () => {
    // Absence is not an attack, and a log line per request is how a log becomes
    // unreadable. Rule 10 asks a guardrail to report what it STOPPED.
    expect(publicOrigin(req({}))).toBe(CANONICAL_ORIGIN)
    expect(warn).not.toHaveBeenCalled()
  })

  it('bounds what it logs, because the value is attacker-written', () => {
    publicOrigin(req({ 'x-forwarded-host': 'e'.repeat(5000) + '.example.com' }))
    expect(String(warn.mock.calls[0][0]).length).toBeLessThan(300)
  })
})

describe('no route builds an origin from a raw header any more', () => {
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const SRC = path.resolve(__dirname, '../../')

  function walk(d: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        if (e.name === '__tests__') continue
        walk(p, out)
      } else if (/\.tsx?$/.test(e.name)) out.push(p)
    }
    return out
  }

  it("reads x-forwarded-host in exactly one place: the screen itself", () => {
    const readers: string[] = []
    for (const abs of walk(SRC)) {
      const rel = path.relative(SRC, abs).split(path.sep).join('/')
      if (rel === 'lib/publicOrigin.ts') continue
      if (/x-forwarded-host/.test(fs.readFileSync(abs, 'utf8'))) readers.push(rel)
    }
    expect(readers).toEqual([])
  })

  it('the origin constant is not spelled a sixth way', () => {
    const dupes: string[] = []
    for (const abs of walk(SRC)) {
      const rel = path.relative(SRC, abs).split(path.sep).join('/')
      if (rel === 'lib/publicOrigin.ts' || rel === 'lib/seo.ts') continue
      // `lib/content/contentSafety.ts` keeps its own SITE_ORIGIN deliberately:
      // the URL screens must not change behaviour with an env var, and the test
      // below pins the two together instead.
      if (rel === 'lib/content/contentSafety.ts') continue
      const src = fs.readFileSync(abs, 'utf8')
      if (/process\.env\.NEXT_PUBLIC_SITE_URL/.test(src)) dupes.push(rel)
    }
    expect(dupes).toEqual([])
  })
})
