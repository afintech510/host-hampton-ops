import { readSrc } from '../helpers/sourceScan'

/**
 * The "Your invitation" card on `/my-booking` (P07). The repo's jest is node-only, so this reads
 * the source: the card is driven by a 200 from the host endpoint, its hook sits above every early
 * return, and nothing else on the page (or the booking endpoint's column list) was touched.
 */

const src = readSrc('app', 'my-booking', 'MyBookingContent.tsx')

describe('/my-booking "Your invitation" card', () => {
  it('asks the host endpoint and shows the card only on a 200', () => {
    expect(src).toMatch(/fetch\('\/api\/portal\/invitation'/)
    expect(src).toMatch(/setHasInvitation\(r\.ok\)/)
    expect(src).toMatch(/\{hasInvitation && \(/)
    expect(src).toContain('href="/my-booking/invitation"')
    expect(src).toContain('Your invitation')
  })

  it('a failed or refused request leaves the card hidden (it starts false and only an ok response sets it)', () => {
    expect(src).toMatch(/useState\(false\)/)
    expect(src).not.toMatch(/setHasInvitation\(true\)/)
  })

  it('the hooks are declared above the first early return (rules of hooks)', () => {
    const hookAt = src.indexOf('const [hasInvitation, setHasInvitation]')
    const firstReturn = src.search(/\n\s*if \(loading\) \{\s*\n\s*return/)
    expect(hookAt).toBeGreaterThan(-1)
    expect(firstReturn).toBeGreaterThan(-1)
    expect(hookAt).toBeLessThan(firstReturn)
  })

  it('the booking endpoint’s column allow-list was not touched', () => {
    const booking = readSrc('app', 'api', 'portal', 'booking', 'route.ts')
    expect(booking).not.toMatch(/evite|invitation/i)
  })

  it('the card is a plain link button (no router push, no next/link)', () => {
    expect(src).not.toMatch(/from 'next\/link'/)
  })
})
