import {
  generateUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  buildOneClickUrl,
  unsubscribeHeaders,
} from '@/lib/unsubscribeLink'

const SECRET = 'test-portal-signing-secret'

describe('unsubscribe tokens', () => {
  const original = process.env
  beforeEach(() => {
    process.env = { ...original, PORTAL_LINK_SIGNING_SECRET: SECRET, NEXT_PUBLIC_SITE_URL: 'https://www.hosthampton.com' }
  })
  afterAll(() => { process.env = original })

  it('round-trips an address', () => {
    const t = generateUnsubscribeToken('adam@easternbuilding.supply')
    expect(t).toBeTruthy()
    expect(verifyUnsubscribeToken(t)).toBe('adam@easternbuilding.supply')
  })

  it('normalises case on both sides, so one person is one token', () => {
    const t = generateUnsubscribeToken('Adam@Eastern.Test')
    expect(verifyUnsubscribeToken(t)).toBe('adam@eastern.test')
  })

  it('refuses a token whose payload was swapped for another address', () => {
    const mine = generateUnsubscribeToken('a@example.test') as string
    const sig = mine.slice(mine.lastIndexOf('.') + 1)
    const forgedPayload = Buffer.from('victim@example.test', 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')
    expect(verifyUnsubscribeToken(`${forgedPayload}.${sig}`)).toBeNull()
  })

  it('refuses a token signed with a different secret', () => {
    const t = generateUnsubscribeToken('a@example.test')
    process.env.PORTAL_LINK_SIGNING_SECRET = 'a-different-secret'
    expect(verifyUnsubscribeToken(t)).toBeNull()
  })

  it('refuses malformed input without throwing', () => {
    expect(verifyUnsubscribeToken(null)).toBeNull()
    expect(verifyUnsubscribeToken('')).toBeNull()
    expect(verifyUnsubscribeToken('nodothere')).toBeNull()
    expect(verifyUnsubscribeToken('.sig')).toBeNull()
    // A short signature would make timingSafeEqual throw; it must be a refusal.
    expect(verifyUnsubscribeToken('YUBleGFtcGxlLnRlc3Q.ab')).toBeNull()
  })

  it('mints nothing when no signing secret is configured', () => {
    delete process.env.PORTAL_LINK_SIGNING_SECRET
    expect(generateUnsubscribeToken('a@example.test')).toBeNull()
    expect(verifyUnsubscribeToken('anything.at.all')).toBeNull()
  })

  it('the confirmation page and the one-click endpoint are different URLs', () => {
    // GET must never unsubscribe: mail scanners fetch every link in a message.
    expect(buildUnsubscribeUrl('t')).toBe('https://www.hosthampton.com/unsubscribe?t=t')
    expect(buildOneClickUrl('t')).toBe('https://www.hosthampton.com/api/unsubscribe?t=t')
  })

  it('emits the RFC 8058 headers that give Gmail a native button', () => {
    const h = unsubscribeHeaders('tok')
    expect(h['List-Unsubscribe']).toContain('/api/unsubscribe?t=tok')
    expect(h['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })
})
