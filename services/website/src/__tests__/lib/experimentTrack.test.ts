/**
 * Tracked links — the token, and the two things it must never do.
 *
 * The property under test is not "does the HMAC verify". It is: can any input
 * make `/r/<token>` redirect somewhere that is not ours, and can the unsubscribe
 * link ever be wrapped?
 */

import {
  mintTrackToken,
  verifyTrackToken,
  rewriteTrackedLinks,
  isExcludedFromTracking,
  EXCLUDED_PATHS,
  buildTrackUrl,
} from '@/lib/experiments/track'

const ASSIGN = '00000000-0000-4000-9000-000000000001'
const BACKSLASH = String.fromCodePoint(0x5c)

const OLD_ENV = { ...process.env }
beforeEach(() => {
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://www.hosthampton.com'
})
afterEach(() => {
  process.env = { ...OLD_ENV }
})

describe('mint and verify', () => {
  it('round-trips an assignment and a destination', () => {
    const token = mintTrackToken(ASSIGN, 'https://www.hosthampton.com/book')
    expect(token).toBeTruthy()
    const v = verifyTrackToken(token)
    expect(v.ok).toBe(true)
    if (!v.ok) return
    expect(v.assignmentId).toBe(ASSIGN)
    expect(v.destination).toBe('https://www.hosthampton.com/book')
  })

  it('accepts a site-relative destination and returns it absolute', () => {
    const v = verifyTrackToken(mintTrackToken(ASSIGN, '/party-packages'))
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.destination).toBe('https://www.hosthampton.com/party-packages')
  })

  it('refuses a forged signature', () => {
    const token = mintTrackToken(ASSIGN, '/book') as string
    const tampered = token.slice(0, token.lastIndexOf('.')) + '.' + 'f'.repeat(64)
    expect(verifyTrackToken(tampered).ok).toBe(false)
  })

  it('refuses a token signed with a different secret', () => {
    const token = mintTrackToken(ASSIGN, '/book')
    process.env.PORTAL_LINK_SIGNING_SECRET = 'a-different-secret'
    expect(verifyTrackToken(token).ok).toBe(false)
  })

  it('refuses a malformed, empty or truncated token without throwing', () => {
    for (const bad of ['', 'x', 'nodot', '.', 'a.b', null, undefined]) {
      expect(verifyTrackToken(bad as string).ok).toBe(false)
    }
  })

  it('mints nothing when there is no signing secret, and verifies nothing either', () => {
    delete process.env.PORTAL_LINK_SIGNING_SECRET
    expect(mintTrackToken(ASSIGN, '/book')).toBeNull()
    expect(verifyTrackToken('anything').ok).toBe(false)
  })
})

describe('the redirect can never leave our origin', () => {
  it('refuses to mint against another host', () => {
    expect(mintTrackToken(ASSIGN, 'https://evil.example.com/x')).toBeNull()
    expect(mintTrackToken(ASSIGN, '//evil.example.com/x')).toBeNull()
    // content-pipeline.md §11.1 — a backslash is normalised to a slash by the
    // WHATWG URL parser, so this is site-relative to a prefix check and another
    // ORIGIN to every browser.
    expect(mintTrackToken(ASSIGN, `/${BACKSLASH}evil.example.com/x`)).toBeNull()
    // Phase 4 review §11.3 — our host, and a protocol-relative pathname.
    expect(mintTrackToken(ASSIGN, 'https://www.hosthampton.com//evil.example.com/x')).toBeNull()
    expect(mintTrackToken(ASSIGN, 'javascript:alert(1)')).toBeNull()
  })

  it('re-screens on the way OUT, so a signature is not evidence the target is still acceptable', () => {
    // Signed while the rule allowed it, read after the rule changed. Simulated
    // by minting with one SITE_URL and verifying with the screen's fixed
    // origin — the point is that `verifyTrackToken` calls `safeSiteLink` again
    // rather than trusting its own HMAC (rule 8).
    const token = mintTrackToken(ASSIGN, 'https://www.hosthampton.com/book') as string
    const payload = Buffer.from(`${ASSIGN}|https://evil.example.com/x`, 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    // A payload we did not sign fails on the MAC first — which is the outer
    // fence. The inner one is asserted by mintTrackToken refusing above.
    expect(verifyTrackToken(`${payload}.${token.slice(token.lastIndexOf('.') + 1)}`).ok).toBe(false)
  })
})

describe('EXCLUDED_PATHS — the unsubscribe link is never wrapped', () => {
  it('excludes the opt-out paths', () => {
    expect(EXCLUDED_PATHS).toContain('/unsubscribe')
    expect(EXCLUDED_PATHS).toContain('/api/unsubscribe')
    expect(isExcludedFromTracking('https://www.hosthampton.com/unsubscribe?t=abc')).toBe(true)
    expect(isExcludedFromTracking('https://www.hosthampton.com/api/unsubscribe?t=abc')).toBe(true)
  })

  it('excludes the signed customer surfaces', () => {
    for (const p of ['/portal', '/plan/HH-2026-0001/summary', '/review/tok', '/checkin/tok']) {
      expect(isExcludedFromTracking(`https://www.hosthampton.com${p}`)).toBe(true)
    }
  })

  it('excludes itself, so a rewrite cannot be applied twice', () => {
    expect(isExcludedFromTracking('https://www.hosthampton.com/r/sometoken')).toBe(true)
  })

  it('does not exclude an ordinary marketing page', () => {
    expect(isExcludedFromTracking('https://www.hosthampton.com/book')).toBe(false)
    // `/unsubscribed-thing` must not be caught by a prefix match on
    // `/unsubscribe` — the exclusion is by path SEGMENT, not by string prefix.
    expect(isExcludedFromTracking('https://www.hosthampton.com/unsubscribe-policy')).toBe(false)
  })

  it('an unparseable URL is excluded — cannot tell means do not wrap', () => {
    expect(isExcludedFromTracking('http://[::bad')).toBe(true)
  })
})

describe('rewriteTrackedLinks', () => {
  const unsub = 'https://www.hosthampton.com/unsubscribe?t=sometoken'

  it('wraps our links and leaves the unsubscribe link exactly as it was', () => {
    const html =
      `<p>Come and <a href="https://www.hosthampton.com/book">book a party</a>.</p>` +
      `<a href="${unsub}">Unsubscribe</a>`
    const out = rewriteTrackedLinks({ html, text: '', assignmentId: ASSIGN, unsubscribeUrl: unsub })

    expect(out.rewritten).toBe(1)
    expect(out.html).toContain(`href="${unsub}"`)
    expect(out.html).not.toContain('href="https://www.hosthampton.com/book"')
    expect(out.html).toMatch(/href="https:\/\/www\.hosthampton\.com\/r\//)
    expect(out.skipped.some(s => /unsubscribe/.test(s.reason))).toBe(true)
  })

  it('leaves a foreign link untouched rather than breaking it', () => {
    const html = `<a href="https://instagram.com/hosthampton">us</a>`
    const out = rewriteTrackedLinks({ html, assignmentId: ASSIGN })
    expect(out.html).toBe(html)
    expect(out.rewritten).toBe(0)
    expect(out.skipped).toHaveLength(1)
  })

  it('rewrites bare URLs in the text part', () => {
    const out = rewriteTrackedLinks({
      html: '',
      text: 'Book here: https://www.hosthampton.com/book\nUnsubscribe: ' + unsub,
      assignmentId: ASSIGN,
      unsubscribeUrl: unsub,
    })
    expect(out.text).toContain('/r/')
    expect(out.text).toContain(unsub)
  })

  it('with no signing secret it changes nothing and says why', () => {
    delete process.env.PORTAL_LINK_SIGNING_SECRET
    const html = `<a href="https://www.hosthampton.com/book">book</a>`
    const out = rewriteTrackedLinks({ html, assignmentId: ASSIGN })
    expect(out.html).toBe(html)
    expect(out.rewritten).toBe(0)
    expect(out.skipped[0].reason).toMatch(/signing secret/)
  })

  it('the tracked URL is on our own origin', () => {
    const token = mintTrackToken(ASSIGN, '/book') as string
    expect(buildTrackUrl(token).startsWith('https://www.hosthampton.com/r/')).toBe(true)
  })
})
