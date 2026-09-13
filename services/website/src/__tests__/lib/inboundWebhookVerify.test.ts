/**
 * The inbound verifiers, EXERCISED rather than read.
 *
 * `inboundSurface.test.ts` reads the source and can tell you the screen is still
 * wired into the route. It cannot tell you the HMAC is computed over the bytes
 * the provider signs — which is the entire defect it exists because of, and
 * which a source-reading rule was green throughout.
 *
 * **Every signature in this file is produced by an INDEPENDENT implementation of
 * the published scheme, written out below, not by importing the module under
 * test.** That is the point. `docs/quo-webhook-setup.md` §4 verified the live
 * endpoint by signing a payload the way the verifier checks it, and so proved
 * only that the verifier agreed with itself while Quo's real deliveries were
 * being refused (hard-won rule 8). A test that shares the implementation cannot
 * catch that class of bug.
 *
 * Quo/OpenPhone: https://support.quo.com/core-concepts/integrations/webhooks
 * Twilio:        https://www.twilio.com/docs/usage/security
 */

import crypto from 'crypto'
import {
  verifyQuoWebhook,
  verifyTwilioWebhook,
  decodeSigningKey,
  INBOUND_EVENT_MAX_AGE_MS,
} from '@/lib/inboundWebhookVerify'
import { smsKeywordIntent, SMS_STOP_KEYWORDS } from '@/lib/smsOptOut'

/** 32 random bytes, base64 — the shape Quo hands out (44 characters). */
const QUO_SECRET = crypto.randomBytes(32).toString('base64')
const TWILIO_TOKEN = 'ac0123456789abcdef0123456789abcd'
const BODY = JSON.stringify({
  type: 'message.received',
  data: { object: { id: 'ACx', from: '+16315551234', to: ['+16319989325'], text: 'hi', direction: 'incoming' } },
})

/* ── Independent implementations of the two published schemes ───────────── */

/** OpenPhone: base64(HMAC-SHA256(base64decode(key), `${ts}.${payload}`)). */
function openphoneHeader(secret: string, body: string, tsMs: number): string {
  const key = Buffer.from(secret, 'base64')
  const sig = crypto.createHmac('sha256', key).update(`${tsMs}.${body}`).digest('base64')
  return `hmac;1;${tsMs};${sig}`
}

/** Standard Webhooks: base64(HMAC-SHA256(key, `${id}.${ts}.${payload}`)). */
function standardHeaders(secret: string, body: string, tsSec: number, id = 'msg_1') {
  const key = Buffer.from(secret, 'base64')
  const sig = crypto.createHmac('sha256', key).update(`${id}.${tsSec}.${body}`).digest('base64')
  return { 'webhook-id': id, 'webhook-timestamp': String(tsSec), 'webhook-signature': `v1,${sig}` }
}

/** Twilio: base64(HMAC-SHA1(token, url + sorted key+value pairs)). */
function twilioHeader(token: string, url: string, form: string): string {
  const params = new URLSearchParams(form)
  const keys: string[] = []
  params.forEach((_v, k) => { if (!keys.includes(k)) keys.push(k) })
  keys.sort()
  let payload = url
  for (const k of keys) for (const v of params.getAll(k)) payload += k + v
  return crypto.createHmac('sha1', token).update(Buffer.from(payload, 'utf8')).digest('base64')
}

const bag = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

describe('verifyQuoWebhook', () => {
  const originalEnv = process.env
  beforeEach(() => { process.env = { ...originalEnv, QUO_WEBHOOK_SECRET: QUO_SECRET } })
  afterAll(() => { process.env = originalEnv })

  it('accepts the scheme Quo actually uses, and says which', () => {
    // THE regression test. This exact case was a 401 in production for 2.5 days.
    const now = Date.now()
    const res = verifyQuoWebhook(bag({ 'openphone-signature': openphoneHeader(QUO_SECRET, BODY, now) }), BODY, now)
    expect(res).toEqual({ ok: true, scheme: 'openphone' })
  })

  it('still accepts Standard Webhooks, so the runbook harness keeps working', () => {
    const now = Date.now()
    const res = verifyQuoWebhook(bag(standardHeaders(QUO_SECRET, BODY, Math.floor(now / 1000))), BODY, now)
    expect(res).toEqual({ ok: true, scheme: 'standard-webhooks' })
  })

  it('refuses a signature over a DIFFERENT body', () => {
    const now = Date.now()
    const header = openphoneHeader(QUO_SECRET, BODY, now)
    const tampered = BODY.replace('+16315551234', '+16314008080') // a reviewer phone
    const res = verifyQuoWebhook(bag({ 'openphone-signature': header }), tampered, now)
    expect(res.ok).toBe(false)
    expect((res as { reason: string }).reason).toBe('bad-signature')
  })

  it('refuses a signature made with a different key', () => {
    const now = Date.now()
    const other = crypto.randomBytes(32).toString('base64')
    const res = verifyQuoWebhook(bag({ 'openphone-signature': openphoneHeader(other, BODY, now) }), BODY, now)
    expect((res as { reason: string }).reason).toBe('bad-signature')
  })

  it('reports WHICH signature headers arrived, so a wrong scheme is diagnosable', () => {
    // The 2.5 days of silence were possible because "verification FAILED" could
    // not distinguish a wrong key from a wrong scheme.
    const res = verifyQuoWebhook(bag({ 'openphone-signature': 'hmac;1;123;AAAA' }), BODY, 123)
    expect(res.ok).toBe(false)
    expect((res as { headersSeen: string[] }).headersSeen).toEqual(['openphone-signature'])
    const none = verifyQuoWebhook(bag({}), BODY)
    expect((none as { headersSeen: string[] }).headersSeen).toEqual([])
    expect((none as { reason: string }).reason).toBe('no-signature-header')
  })

  it('refuses a malformed openphone header rather than reading past it', () => {
    for (const header of ['hmac', 'hmac;1', 'hmac;1;', 'hmac;1;123', ';;;']) {
      const res = verifyQuoWebhook(bag({ 'openphone-signature': header }), BODY)
      expect({ header, ok: res.ok }).toEqual({ header, ok: false })
    }
  })

  it('refuses a delivery older than the age bound, and accepts one inside it', () => {
    const now = Date.now()
    const fresh = openphoneHeader(QUO_SECRET, BODY, now - INBOUND_EVENT_MAX_AGE_MS + 60_000)
    expect(verifyQuoWebhook(bag({ 'openphone-signature': fresh }), BODY, now).ok).toBe(true)
    const stale = openphoneHeader(QUO_SECRET, BODY, now - INBOUND_EVENT_MAX_AGE_MS - 60_000)
    const res = verifyQuoWebhook(bag({ 'openphone-signature': stale }), BODY, now)
    expect((res as { reason: string }).reason).toBe('stale')
  })

  it('an UNREADABLE timestamp is not treated as stale', () => {
    // It is inside the signature, so it cannot be forged independently.
    // Refusing on it would mean a provider changing its timestamp format takes
    // this edge down — which is the failure this module exists to repair.
    const key = Buffer.from(QUO_SECRET, 'base64')
    const sig = crypto.createHmac('sha256', key).update(`not-a-number.${BODY}`).digest('base64')
    const res = verifyQuoWebhook(bag({ 'openphone-signature': `hmac;1;not-a-number;${sig}` }), BODY)
    expect(res).toEqual({ ok: true, scheme: 'openphone' })
  })

  it('FAILS CLOSED in production when the secret is unset, and skips outside it', () => {
    delete process.env.QUO_WEBHOOK_SECRET
    const nodeEnv = process.env.NODE_ENV
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true })
    try {
      const res = verifyQuoWebhook(bag({}), BODY)
      expect(res).toMatchObject({ ok: false, reason: 'unconfigured' })
      // …and a BUILD is not a request.
      process.env.NEXT_PHASE = 'phase-production-build'
      expect(verifyQuoWebhook(bag({}), BODY)).toMatchObject({ ok: true, scheme: 'skipped' })
      delete process.env.NEXT_PHASE
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: nodeEnv, configurable: true })
    }
    expect(verifyQuoWebhook(bag({}), BODY)).toMatchObject({ ok: true, scheme: 'skipped' })
  })

  it('never throws on a request shape it did not expect', () => {
    // A verifier that throws answers 500, not 401 — a crash where a refusal
    // belongs, in front of every inbound write.
    expect(() => verifyQuoWebhook(undefined as never, BODY)).not.toThrow()
    expect(() => verifyQuoWebhook({ get: () => { throw new Error('x') } }, BODY)).not.toThrow()
    expect(verifyQuoWebhook(undefined as never, BODY).ok).toBe(false)
  })

  it('accepts a whsec_-prefixed secret, and the decode round-trips', () => {
    expect(decodeSigningKey(QUO_SECRET).equals(Buffer.from(QUO_SECRET, 'base64'))).toBe(true)
    expect(decodeSigningKey(`whsec_${QUO_SECRET}`).equals(Buffer.from(QUO_SECRET, 'base64'))).toBe(true)
    // A secret that is NOT base64 is used as raw bytes rather than silently
    // becoming a wrong key: `Buffer.from(x, 'base64')` never throws, it drops
    // what it cannot read, so the old "try base64, catch, fall back" was dead
    // code that hid a mis-set secret behind a wrong key.
    expect(decodeSigningKey('not base64!!').toString('utf8')).toBe('not base64!!')
  })
})

describe('verifyTwilioWebhook', () => {
  const originalEnv = process.env
  const URL_ = 'https://www.hosthampton.com/api/webhooks/twilio'
  const FORM = 'From=%2B16315551234&Body=STOP&MessageSid=SM1'
  const req = (sig: string | null) => ({
    url: URL_,
    headers: bag(sig ? { 'x-twilio-signature': sig, host: 'www.hosthampton.com' } : { host: 'www.hosthampton.com' }),
  })

  beforeEach(() => { process.env = { ...originalEnv, TWILIO_AUTH_TOKEN: TWILIO_TOKEN } })
  afterAll(() => { process.env = originalEnv })

  it('accepts a genuine Twilio signature', () => {
    const res = verifyTwilioWebhook(req(twilioHeader(TWILIO_TOKEN, URL_, FORM)), new URLSearchParams(FORM))
    expect(res).toEqual({ ok: true, scheme: 'twilio' })
  })

  it('the signature covers the PARAMETERS, so it cannot be moved to another From', () => {
    // This is what makes Twilio's scheme worth verifying at all, and what
    // SignWell's `type@time` does NOT give you: `From` decides whose consent
    // gets written, and it is inside what was signed.
    const stolen = twilioHeader(TWILIO_TOKEN, URL_, 'From=%2B16319990000&Body=STOP&MessageSid=SM1')
    const res = verifyTwilioWebhook(req(stolen), new URLSearchParams(FORM))
    expect((res as { reason: string }).reason).toBe('bad-signature')
  })

  it('the signature covers the URL, so it cannot be replayed at another route', () => {
    const elsewhere = twilioHeader(TWILIO_TOKEN, 'https://www.hosthampton.com/api/webhooks/other', FORM)
    const res = verifyTwilioWebhook(req(elsewhere), new URLSearchParams(FORM))
    expect((res as { reason: string }).reason).toBe('bad-signature')
  })

  it('tolerates the trailing-slash spelling Twilio may have been configured with', () => {
    const slashed = twilioHeader(TWILIO_TOKEN, `${URL_}/`, FORM)
    expect(verifyTwilioWebhook(req(slashed), new URLSearchParams(FORM))).toEqual({ ok: true, scheme: 'twilio' })
  })

  it('handles a repeated parameter the way Twilio concatenates it', () => {
    const form = 'From=%2B16315551234&MediaUrl0=a&MediaUrl0=b&Body=hi'
    const sig = twilioHeader(TWILIO_TOKEN, URL_, form)
    expect(verifyTwilioWebhook(req(sig), new URLSearchParams(form))).toEqual({ ok: true, scheme: 'twilio' })
  })

  it('refuses a missing or wrong signature', () => {
    expect((verifyTwilioWebhook(req(null), new URLSearchParams(FORM)) as { reason: string }).reason)
      .toBe('no-signature-header')
    expect((verifyTwilioWebhook(req('AAAA'), new URLSearchParams(FORM)) as { reason: string }).reason)
      .toBe('bad-signature')
  })

  it('FAILS CLOSED in production when the auth token is unset', () => {
    delete process.env.TWILIO_AUTH_TOKEN
    const nodeEnv = process.env.NODE_ENV
    Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', configurable: true })
    try {
      expect(verifyTwilioWebhook(req(null), new URLSearchParams(FORM)))
        .toMatchObject({ ok: false, reason: 'unconfigured' })
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', { value: nodeEnv, configurable: true })
    }
  })

  it('does not let a forged host decide what gets signed', () => {
    // `publicOrigin` screens the forwarded host; an attacker who could choose
    // the signed string could make any signature verify.
    const forged = {
      url: URL_,
      headers: bag({
        'x-twilio-signature': twilioHeader(TWILIO_TOKEN, 'https://evil.example.com/api/webhooks/twilio', FORM),
        'x-forwarded-host': 'evil.example.com',
        host: 'www.hosthampton.com',
      }),
    }
    expect(verifyTwilioWebhook(forged, new URLSearchParams(FORM)).ok).toBe(false)
  })
})

describe('smsKeywordIntent', () => {
  it('recognises every carrier opt-out word, exactly', () => {
    for (const kw of SMS_STOP_KEYWORDS) {
      expect({ kw, intent: smsKeywordIntent(kw) }).toEqual({ kw, intent: 'stop' })
      expect({ kw, intent: smsKeywordIntent(` ${kw.toLowerCase()} `) }).toEqual({ kw, intent: 'stop' })
      expect({ kw, intent: smsKeywordIntent(`${kw}.`) }).toEqual({ kw, intent: 'stop' })
    }
  })

  it('recognises the resume words', () => {
    for (const kw of ['START', 'start', 'UNSTOP', 'Resume']) {
      expect({ kw, intent: smsKeywordIntent(kw) }).toEqual({ kw, intent: 'start' })
    }
  })

  it('is EXACT, so a sentence containing STOP is not an opt-out', () => {
    // A `contains` test on this surface writes a false statement about somebody's
    // consent — and the opposite mistake silently keeps texting them.
    for (const text of [
      "Please don't stop sending me these",
      'Can we stop by at 3?',
      'STOP by the studio tomorrow',
      'I want to cancel the 4pm slot, not the party',
      'yes please',
      'Yes we can do Saturday',
    ]) {
      expect({ text, intent: smsKeywordIntent(text) }).toEqual({ text, intent: null })
    }
  })

  it('an empty or missing body is not a keyword', () => {
    for (const v of ['', '   ', null, undefined]) expect(smsKeywordIntent(v)).toBeNull()
  })

  it('HELP is its own intent, distinct from both', () => {
    expect(smsKeywordIntent('HELP')).toBe('help')
    expect(smsKeywordIntent('info')).toBe('help')
  })
})
