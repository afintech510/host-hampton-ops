/**
 * Plan §25.4 / §25.9 — Slack request signing.
 *
 * `/api/slack/interactions` will be a public URL that can approve a message to
 * a customer. Every assertion here is about what must NOT get through.
 */

import {
  isSlackReviewer,
  slackSignature,
  verifySlackRequest,
  SLACK_MAX_SKEW_SECONDS,
} from '@/lib/slack/signature'

const SECRET = 'slack-signing-secret'
const NOW = new Date('2026-09-12T12:00:00Z')
const TS = String(Math.floor(NOW.getTime() / 1000))
// A real interaction body: form-encoded, with the JSON in a `payload` field.
const BODY = 'payload=%7B%22type%22%3A%22block_actions%22%2C%22user%22%3A%7B%22id%22%3A%22U123%22%7D%7D'

const sign = (body = BODY, ts = TS, secret = SECRET) => slackSignature(secret, ts, body)

describe('verifySlackRequest', () => {
  it('accepts a request Slack actually signed', () => {
    expect(
      verifySlackRequest({ signature: sign(), timestamp: TS, rawBody: BODY, secret: SECRET, now: NOW }),
    ).toBe('ok')
  })

  it('FAILS CLOSED when the secret is unset', () => {
    // The whole SignWell lesson: a verifier that passes without a key reads
    // like protection in review and is the absence of it.
    expect(
      verifySlackRequest({ signature: sign(), timestamp: TS, rawBody: BODY, secret: '', now: NOW }),
    ).toBe('unconfigured')
  })

  it('rejects a tampered body', () => {
    const tampered = BODY.replace('U123', 'U666')
    expect(
      verifySlackRequest({ signature: sign(), timestamp: TS, rawBody: tampered, secret: SECRET, now: NOW }),
    ).toBe('bad_signature')
  })

  it('rejects a signature made with a different secret', () => {
    expect(
      verifySlackRequest({
        signature: sign(BODY, TS, 'wrong-secret'),
        timestamp: TS,
        rawBody: BODY,
        secret: SECRET,
        now: NOW,
      }),
    ).toBe('bad_signature')
  })

  it('rejects a replay from six minutes ago', () => {
    const old = String(Number(TS) - (SLACK_MAX_SKEW_SECONDS + 60))
    expect(
      verifySlackRequest({ signature: sign(BODY, old), timestamp: old, rawBody: BODY, secret: SECRET, now: NOW }),
    ).toBe('stale')
  })

  it('rejects a timestamp far in the FUTURE, not only a stale one', () => {
    // Checking one direction only leaves an open replay window.
    const future = String(Number(TS) + (SLACK_MAX_SKEW_SECONDS + 60))
    expect(
      verifySlackRequest({ signature: sign(BODY, future), timestamp: future, rawBody: BODY, secret: SECRET, now: NOW }),
    ).toBe('stale')
  })

  it('accepts right up to the skew boundary', () => {
    const edge = String(Number(TS) - SLACK_MAX_SKEW_SECONDS)
    expect(
      verifySlackRequest({ signature: sign(BODY, edge), timestamp: edge, rawBody: BODY, secret: SECRET, now: NOW }),
    ).toBe('ok')
  })

  it('rejects missing or nonsense headers', () => {
    expect(verifySlackRequest({ signature: null, timestamp: TS, rawBody: BODY, secret: SECRET, now: NOW })).toBe('missing_headers')
    expect(verifySlackRequest({ signature: sign(), timestamp: null, rawBody: BODY, secret: SECRET, now: NOW })).toBe('missing_headers')
    expect(verifySlackRequest({ signature: sign(), timestamp: 'abc', rawBody: BODY, secret: SECRET, now: NOW })).toBe('bad_timestamp')
    expect(verifySlackRequest({ signature: 'garbage', timestamp: TS, rawBody: BODY, secret: SECRET, now: NOW })).toBe('bad_signature')
    expect(verifySlackRequest({ signature: '', timestamp: TS, rawBody: BODY, secret: SECRET, now: NOW })).toBe('missing_headers')
  })

  it('signs the RAW body — a re-serialised one does not match', () => {
    // Slack sends form-encoded interactions. Anything that parses and
    // re-encodes before hashing breaks every signature, which is why the
    // handler must call req.text() first.
    const decoded = decodeURIComponent(BODY.replace('payload=', ''))
    expect(
      verifySlackRequest({ signature: sign(), timestamp: TS, rawBody: decoded, secret: SECRET, now: NOW }),
    ).toBe('bad_signature')
  })
})

describe('isSlackReviewer', () => {
  const orig = process.env
  beforeEach(() => { process.env = { ...orig } })
  afterEach(() => { process.env = orig })

  it('an EMPTY allowlist authorises nobody', () => {
    delete process.env.SLACK_REVIEWER_USER_IDS
    expect(isSlackReviewer('U123')).toBe(false)
    process.env.SLACK_REVIEWER_USER_IDS = ''
    expect(isSlackReviewer('U123')).toBe(false)
  })

  it('authorises only listed ids', () => {
    process.env.SLACK_REVIEWER_USER_IDS = 'U123, U456'
    expect(isSlackReviewer('U123')).toBe(true)
    expect(isSlackReviewer('U456')).toBe(true)
    expect(isSlackReviewer('U999')).toBe(false)
    expect(isSlackReviewer(null)).toBe(false)
    expect(isSlackReviewer('')).toBe(false)
  })

  it('does not match on a prefix or substring of a real id', () => {
    process.env.SLACK_REVIEWER_USER_IDS = 'U123456'
    expect(isSlackReviewer('U123')).toBe(false)
    expect(isSlackReviewer('U1234567')).toBe(false)
  })
})
