/**
 * Behavioural tests for the SignWell webhook verification core.
 *
 * These exercise the real HMAC against the real algorithm rather than asserting
 * that a function was called. The defect they exist to prevent was measured in
 * production on 2026-09-12: a POST carrying `"hash":"totally-made-up-hash"` and
 * no credentials wrote `agreement_signed_at` onto a booking.
 *
 * Both directions are covered throughout — that hostile input is REFUSED and
 * that legitimate input still SURVIVES. A guard that rejects everything is not
 * a fix.
 */

import crypto from 'crypto'
import {
  verifySignwellEvent,
  parseSignwellEvent,
  claimsCompletion,
  confirmCompletedAtSignwell,
  SIGNWELL_EVENT_MAX_AGE_MS,
} from '@/lib/signwellWebhook'

const WEBHOOK_ID = 'fa13aab2-213f-425f-a912-ccbf23aff02e'

/** Build a genuinely-signed envelope, exactly as SignWell would. */
function signedEvent(
  type = 'document_completed',
  timeSeconds = Math.floor(Date.now() / 1000),
  doc: Record<string, unknown> = {}
) {
  const hash = crypto
    .createHmac('sha256', WEBHOOK_ID)
    .update(`${type}@${timeSeconds}`)
    .digest('hex')
  return {
    event: { type, time: timeSeconds, hash },
    data: { object: { id: 'doc-1', status: 'completed', metadata: { type: 'studio_rental' }, ...doc } },
  }
}

describe('verifySignwellEvent', () => {
  const OLD = process.env.SIGNWELL_WEBHOOK_ID
  beforeEach(() => { process.env.SIGNWELL_WEBHOOK_ID = WEBHOOK_ID })
  afterAll(() => { if (OLD === undefined) delete process.env.SIGNWELL_WEBHOOK_ID; else process.env.SIGNWELL_WEBHOOK_ID = OLD })

  it('accepts a genuinely signed event', () => {
    expect(verifySignwellEvent(signedEvent())).toEqual({ ok: true })
  })

  // The exact payload that worked against production.
  it('REFUSES the forged hash that worked in production', () => {
    const evt = signedEvent()
    evt.event.hash = 'totally-made-up-hash'
    expect(verifySignwellEvent(evt)).toEqual({ ok: false, reason: 'bad-hash' })
  })

  it('refuses an event with no hash at all', () => {
    const evt: any = signedEvent()
    delete evt.event.hash
    expect(verifySignwellEvent(evt)).toEqual({ ok: false, reason: 'missing-hash' })
  })

  it('refuses a hash that is valid for a DIFFERENT event type', () => {
    const evt = signedEvent('document_viewed')
    // Claim it is a completion while keeping the viewed-event signature.
    evt.event.type = 'document_completed'
    expect(verifySignwellEvent(evt)).toEqual({ ok: false, reason: 'bad-hash' })
  })

  it('refuses a hash that is valid for a DIFFERENT timestamp', () => {
    const t = Math.floor(Date.now() / 1000)
    const evt = signedEvent('document_completed', t)
    evt.event.time = t - 1
    expect(verifySignwellEvent(evt)).toEqual({ ok: false, reason: 'bad-hash' })
  })

  // FAILS CLOSED when unconfigured — deliberately unlike /api/webhooks/quo.
  it('fails CLOSED when SIGNWELL_WEBHOOK_ID is unset', () => {
    delete process.env.SIGNWELL_WEBHOOK_ID
    expect(verifySignwellEvent(signedEvent())).toEqual({ ok: false, reason: 'unconfigured' })
  })

  it('refuses a signed-but-ancient event (bounds replay of an observed triple)', () => {
    const old = Math.floor((Date.now() - SIGNWELL_EVENT_MAX_AGE_MS - 60_000) / 1000)
    expect(verifySignwellEvent(signedEvent('document_completed', old))).toEqual({ ok: false, reason: 'stale' })
  })

  it('accepts an event just inside the freshness window', () => {
    const recent = Math.floor((Date.now() - SIGNWELL_EVENT_MAX_AGE_MS + 60_000) / 1000)
    expect(verifySignwellEvent(signedEvent('document_completed', recent))).toEqual({ ok: true })
  })

  it('refuses a far-future timestamp', () => {
    const future = Math.floor((Date.now() + SIGNWELL_EVENT_MAX_AGE_MS + 60_000) / 1000)
    expect(verifySignwellEvent(signedEvent('document_completed', future))).toEqual({ ok: false, reason: 'stale' })
  })

  it.each([null, undefined, 42, 'string', {}, { event: null }, { event: {} }])(
    'refuses malformed payload %p without throwing',
    (payload) => {
      expect(verifySignwellEvent(payload as unknown).ok).toBe(false)
    }
  )

  it('does not accept a hash of a different length (timingSafeEqual guard)', () => {
    const evt = signedEvent()
    evt.event.hash = evt.event.hash.slice(0, 10)
    expect(verifySignwellEvent(evt)).toEqual({ ok: false, reason: 'bad-hash' })
  })

  it('tolerates event.time arriving as a string', () => {
    const t = Math.floor(Date.now() / 1000)
    const evt: any = signedEvent('document_completed', t)
    evt.event.time = String(t)
    expect(verifySignwellEvent(evt)).toEqual({ ok: true })
  })
})

describe('parseSignwellEvent', () => {
  it('reads the data.object shape', () => {
    const p = parseSignwellEvent(signedEvent())
    expect(p).toMatchObject({ eventType: 'document_completed', documentId: 'doc-1', docType: 'studio_rental' })
  })

  it('reads the flat data shape', () => {
    const p = parseSignwellEvent({ event: { type: 'document_completed' }, data: { id: 'd2', status: 'completed' } })
    expect(p.documentId).toBe('d2')
  })

  // A non-string id used to flow straight into a PostgREST .eq() filter.
  it.each([{ id: 42 }, { id: null }, { id: {} }, { id: [] }, { id: '' }, { id: '   ' }])(
    'refuses to treat %p as a document id',
    (doc) => {
      expect(parseSignwellEvent({ event: { type: 'x' }, data: { object: doc } }).documentId).toBeNull()
    }
  )

  it('never throws on a hostile payload', () => {
    expect(() => parseSignwellEvent({ data: { object: 'not-an-object' } })).not.toThrow()
    expect(() => parseSignwellEvent(null)).not.toThrow()
  })
})

describe('claimsCompletion', () => {
  it('accepts document_completed and document_signed and status=completed', () => {
    expect(claimsCompletion(parseSignwellEvent(signedEvent('document_completed')))).toBe(true)
    expect(claimsCompletion(parseSignwellEvent(signedEvent('document_signed')))).toBe(true)
    expect(claimsCompletion(parseSignwellEvent({ event: { type: 'x' }, data: { object: { status: 'Completed' } } }))).toBe(true)
  })

  it('rejects a mere view', () => {
    expect(claimsCompletion(parseSignwellEvent({
      event: { type: 'document_viewed' }, data: { object: { id: 'd', status: 'Viewed' } },
    }))).toBe(false)
  })
})

describe('confirmCompletedAtSignwell — the authoritative re-read', () => {
  const OLD_KEY = process.env.SIGNWELL_API_KEY
  afterEach(() => { global.fetch = undefined as never })
  afterAll(() => { if (OLD_KEY === undefined) delete process.env.SIGNWELL_API_KEY; else process.env.SIGNWELL_API_KEY = OLD_KEY })

  const mockFetch = (impl: () => unknown) => { global.fetch = jest.fn(impl) as never }

  beforeEach(() => { process.env.SIGNWELL_API_KEY = 'k' })

  it('confirms a document SignWell reports as Completed, and returns ITS metadata', async () => {
    mockFetch(() => Promise.resolve({
      ok: true, status: 200,
      json: () => Promise.resolve({ status: 'Completed', metadata: { booking_ref: 'HH-STU-REAL', type: 'studio_rental' } }),
    }))
    const r = await confirmCompletedAtSignwell('doc-1')
    expect(r).toMatchObject({ kind: 'completed', bookingRef: 'HH-STU-REAL' })
  })

  // This is what makes a forged/replayed body inert: the body said completed,
  // SignWell says Viewed, so nothing is written.
  it('refuses when SignWell says the document is only Viewed', async () => {
    mockFetch(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'Viewed' }) }))
    expect(await confirmCompletedAtSignwell('doc-1')).toEqual({ kind: 'not-completed', status: 'Viewed' })
  })

  it('reports a 404 as not-completed, not as an error', async () => {
    mockFetch(() => Promise.resolve({ ok: false, status: 404 }))
    expect(await confirmCompletedAtSignwell('nope')).toEqual({ kind: 'not-completed', status: 'not-found' })
  })

  // Rule 12: three outcomes. A blip must not read as "not signed".
  it('reports a 5xx as UNAVAILABLE, distinct from not-completed', async () => {
    mockFetch(() => Promise.resolve({ ok: false, status: 502 }))
    expect((await confirmCompletedAtSignwell('doc-1')).kind).toBe('unavailable')
  })

  it('reports a network throw as UNAVAILABLE', async () => {
    mockFetch(() => Promise.reject(new Error('ECONNRESET')))
    expect((await confirmCompletedAtSignwell('doc-1')).kind).toBe('unavailable')
  })

  it('reports unparseable JSON as UNAVAILABLE', async () => {
    mockFetch(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.reject(new Error('bad json')) }))
    expect((await confirmCompletedAtSignwell('doc-1')).kind).toBe('unavailable')
  })

  it('is unavailable rather than confirming when the API key is missing', async () => {
    delete process.env.SIGNWELL_API_KEY
    expect((await confirmCompletedAtSignwell('doc-1')).kind).toBe('unavailable')
  })
})
