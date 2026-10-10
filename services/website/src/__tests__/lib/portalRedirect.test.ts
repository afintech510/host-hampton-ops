import { PORTAL_REDIRECT_PATHS, safePortalRedirect } from '@/lib/portalRedirect'
import { readSrc } from '../helpers/sourceScan'

/**
 * The ONE portal redirect allow-list (P07). `/my-booking/login?next=` and
 * `/api/portal/auth?redirect=` both go through it, so what the login page will carry and what
 * the magic link will honour can never differ.
 *
 * Decision, documented here and in the module: the match is EXACT. A query string or fragment
 * is refused (`/my-booking/invitation?x=1`), because the list is paths this site owns and a
 * query string is where an attacker's parameter would ride in.
 */

describe('safePortalRedirect', () => {
  it.each(['/my-booking', '/my-booking/invitation', '/party-builder', '/party-planner'])('accepts %s', (p) => {
    expect(safePortalRedirect(p)).toBe(p)
  })

  it('the list is what the auth route has always honoured, plus the invitation page', () => {
    expect([...PORTAL_REDIRECT_PATHS]).toEqual(['/my-booking', '/my-booking/invitation', '/party-builder', '/party-planner'])
  })

  it.each([
    ['protocol-relative', '//evil.com'],
    ['protocol-relative with path', '//evil.com/my-booking'],
    ['absolute https', 'https://evil.com'],
    ['absolute https to our own path on another host', 'https://evil.com/my-booking/invitation'],
    ['absolute http', 'http://www.hosthampton.com/my-booking'],
    ['backslash host', '/\\evil.com'],
    ['backslash after an allowed path', '/my-booking\\@evil.com'],
    ['javascript url', 'javascript:alert(1)'],
    ['data url', 'data:text/html,hi'],
    ['query string on an allowed path (refused by decision)', '/my-booking/invitation?x=1'],
    ['fragment on an allowed path', '/my-booking/invitation#x'],
    ['trailing slash', '/my-booking/invitation/'],
    ['sub-path', '/my-booking/invitation/evil'],
    ['prefix trick: dot-segment', '/my-booking/../admin'],
    ['prefix trick: userinfo', '/my-booking@evil.com'],
    ['prefix trick: host suffix', '/my-booking.evil.com'],
    ['outside the list: admin', '/admin'],
    ['outside the list: login', '/my-booking/login'],
    ['outside the list: pay', '/my-booking/pay'],
    ['outside the list: api', '/api/portal/booking'],
    ['upper-case path', '/MY-BOOKING/INVITATION'],
    ['leading space', ' /my-booking'],
    ['trailing space', '/my-booking '],
    ['trailing newline', '/my-booking\n'],
    ['percent-encoded slash', '/my-booking%2Finvitation'],
    ['empty', ''],
    ['no leading slash', 'my-booking'],
  ])('refuses %s', (_name, value) => {
    expect(safePortalRedirect(value)).toBeNull()
  })

  it.each([undefined, null, 5, {}, [], ['/my-booking'], true])('refuses a non-string (%p)', (v) => {
    expect(safePortalRedirect(v)).toBeNull()
  })

  it('the plan summary is valid only for the ref that was just authenticated', () => {
    expect(safePortalRedirect('/plan/HH-PTY-AAAAA/summary', 'HH-PTY-AAAAA')).toBe('/plan/HH-PTY-AAAAA/summary')
    expect(safePortalRedirect('/plan/HH-PTY-BBBBB/summary', 'HH-PTY-AAAAA')).toBeNull()
    // The login page does not know a ref yet, so it can never carry one.
    expect(safePortalRedirect('/plan/HH-PTY-AAAAA/summary')).toBeNull()
    expect(safePortalRedirect('/plan/HH-PTY-AAAAA/summary?x=1', 'HH-PTY-AAAAA')).toBeNull()
  })
})

describe('the three doors use that one list and keep no list of their own', () => {
  it('the auth route, the resend-link route and the login page all import it', () => {
    for (const f of [
      ['app', 'api', 'portal', 'auth', 'route.ts'],
      ['app', 'api', 'portal', 'resend-link', 'route.ts'],
      ['app', 'my-booking', 'login', 'page.tsx'],
    ]) {
      expect(readSrc(...f)).toMatch(/from '@\/lib\/portalRedirect'/)
    }
  })

  it('the auth route no longer spells a redirect list of its own', () => {
    const src = readSrc('app', 'api', 'portal', 'auth', 'route.ts')
    expect(src).not.toMatch(/allowedRedirects/)
    expect(src).toMatch(/safePortalRedirect\(\s*req\.nextUrl\.searchParams\.get\('redirect'\)\s*,\s*ref\s*\)/)
  })
})
