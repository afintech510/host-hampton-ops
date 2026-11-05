/**
 * Meta Conversions API for the booking funnel (lib/metaCapi.ts).
 *
 * What these pin: it is OFF unless explicitly on; it sends nothing personal for
 * anyone who has not opted in; what it does send is hashed the way Meta
 * documents; it never throws; and the Stripe webhook reports a deposit only on
 * its first processing.
 */
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'
import { decomment } from '../helpers/sourceScan'

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex')

const fetchMock = jest.fn()
beforeAll(() => {
  ;(global as unknown as { fetch: unknown }).fetch = fetchMock
})
beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 })
  process.env.META_CAPI_ENABLED = 'true'
  process.env.META_CAPI_ACCESS_TOKEN = 'test-token-not-real'
  process.env.NEXT_PUBLIC_META_PIXEL_ID = '1234567890'
  delete process.env.META_CAPI_TEST_EVENT_CODE
})
afterEach(() => {
  for (const k of ['META_CAPI_ENABLED', 'META_CAPI_ACCESS_TOKEN', 'NEXT_PUBLIC_META_PIXEL_ID', 'META_CAPI_TEST_EVENT_CODE']) delete process.env[k]
})

import {
  buildUserData, hashEmail, hashPhone, marketingConsent, metaCapiConfig, metaEventBody,
  reportLeadToMeta, reportPurchaseToMeta, screenMetaEventId, sendMetaEvent,
} from '@/lib/metaCapi'

const req = (cookie = '_fbp=fb.1.111.222; hh_consent=granted', extra: Record<string, string> = {}) => ({
  headers: {
    get: (n: string) => ({ cookie, 'user-agent': 'UA/1.0', 'cf-connecting-ip': '203.0.113.9', ...extra } as Record<string, string>)[n.toLowerCase()] ?? null,
  },
})

describe('the switch', () => {
  it('is off unless META_CAPI_ENABLED is exactly "true", and needs the token and a numeric pixel id', () => {
    expect(metaCapiConfig()).not.toBeNull()
    process.env.META_CAPI_ENABLED = '1'
    expect(metaCapiConfig()).toBeNull()
    process.env.META_CAPI_ENABLED = 'true'
    delete process.env.META_CAPI_ACCESS_TOKEN
    expect(metaCapiConfig()).toBeNull()
    process.env.META_CAPI_ACCESS_TOKEN = 'x'
    process.env.NEXT_PUBLIC_META_PIXEL_ID = 'not-a-number'
    expect(metaCapiConfig()).toBeNull()
  })

  it('does nothing at all when off — no request is made', async () => {
    delete process.env.META_CAPI_ENABLED
    expect(await reportLeadToMeta(req(), { body: {}, name: 'Lead', email: 'a@b.co', consented: true })).toBe('skipped')
    expect(await sendMetaEvent({ name: 'Lead', eventId: 'abcdefgh', userData: {} })).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('hashing', () => {
  it('normalises the way Meta documents before SHA-256', () => {
    expect(hashEmail('  Pat@Example.COM ')).toBe(sha('pat@example.com'))
    expect(hashPhone('(631) 555-0123')).toBe(sha('16315550123'))
    expect(hashPhone('+1 631-555-0123')).toBe(sha('16315550123'))
    expect(hashEmail('not an email')).toBeNull()
    expect(hashPhone('12')).toBeNull()
  })

  it('carries no personal identifier for someone who has not consented', () => {
    const u = buildUserData({ fbp: 'fb.1.1.2', ip: '203.0.113.9', userAgent: 'UA' }, { email: 'a@b.co', phone: '6315550123' }, false)
    expect(Object.keys(u).sort()).toEqual(['client_ip_address', 'client_user_agent', 'fbp'])
    const c = buildUserData({}, { email: 'a@b.co', phone: '6315550123' }, true)
    expect(c.em).toEqual([hashEmail('a@b.co')])
    expect(c.ph).toEqual([hashPhone('6315550123')])
  })

  it('consent needs an explicit yes AND no opt-out; "never asked" is not consent', () => {
    expect(marketingConsent({ email_opt_in: true, status: 'subscribed' })).toBe(true)
    expect(marketingConsent({ email_opt_in: null, status: null })).toBe(false)
    expect(marketingConsent({ email_opt_in: false })).toBe(false)
    expect(marketingConsent({ email_opt_in: true, status: 'unsubscribed' })).toBe(false)
    expect(marketingConsent(null)).toBe(false)
  })
})

describe('what goes to Meta', () => {
  it('a lead uses the browser\'s event id (so Meta counts it once) and hashes only when the box was ticked', async () => {
    const body = { attribution: { meta_event_id: 'evt-1234abcd', fbp: 'fb.1.9.9', fbc: 'fb.1.9.ABC' } }
    expect(await reportLeadToMeta(req('hh_consent=granted'), { body, name: 'Lead', email: 'Pat@Example.com', phone: '6315550123', consented: true })).toBe('sent')
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    const ev = sent.data[0]
    expect(ev.event_name).toBe('Lead')
    expect(ev.event_id).toBe('evt-1234abcd')
    expect(ev.action_source).toBe('website')
    expect(ev.user_data.em).toEqual([sha('pat@example.com')])
    expect(ev.user_data.fbc).toBe('fb.1.9.ABC')
    expect(fetchMock.mock.calls[0][0]).toMatch(/graph\.facebook\.com\/v\d+\.\d+\/1234567890\/events$/)
    // Nothing readable about the customer anywhere in the payload.
    expect(JSON.stringify(sent)).not.toMatch(/Pat|example\.com|6315550123/)

    fetchMock.mockClear()
    await reportLeadToMeta(req(), { body, name: 'Lead', email: 'pat@example.com', phone: '6315550123', consented: false })
    const noConsent = JSON.parse(fetchMock.mock.calls[0][1].body).data[0].user_data
    expect(noConsent.em).toBeUndefined()
    expect(noConsent.ph).toBeUndefined()
    expect(noConsent.fbp).toBe('fb.1.111.222') // the cookie on the request wins
  })

  it('refuses an event id that is not an opaque token', () => {
    expect(screenMetaEventId('abcd1234-ef56')).toBe('abcd1234-ef56')
    expect(screenMetaEventId('x')).toBeNull()
    expect(screenMetaEventId('has space and <script>')).toBeNull()
    expect(screenMetaEventId({})).toBeNull()
  })

  it('the body carries value in dollars, the test code when set, and never the booking or the child', () => {
    const b = metaEventBody({ name: 'Purchase', eventId: 'pi_3abcdefghij', userData: {}, value: { cents: 25000 }, contentName: 'Booking Deposit' }, { token: 't', testEventCode: 'TEST123' })
    expect(b.data[0].custom_data).toEqual({ value: 250, currency: 'USD', content_name: 'Booking Deposit' })
    expect(b.test_event_code).toBe('TEST123')
  })

  it('never throws: a network error or a 500 is a status, not an exception', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    expect(await sendMetaEvent({ name: 'Lead', eventId: 'abcdefgh', userData: {} })).toBe('failed')
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })
    expect(await sendMetaEvent({ name: 'Lead', eventId: 'abcdefgh', userData: {} })).toBe('failed')
  })
})

describe('the cookie banner decides', () => {
  const body = { attribution: { meta_event_id: 'evt-1234abcd' } }
  const lead = (r: ReturnType<typeof req>) => reportLeadToMeta(r, { body, name: 'Lead', email: 'a@b.co', consented: true })

  it('sends nothing for a visitor who has not chosen, or declined', async () => {
    expect(await lead(req('_fbp=fb.1.1.2'))).toBe('skipped')
    expect(await lead(req('hh_consent=denied'))).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats Global Privacy Control as a no, even after Accept', async () => {
    expect(await lead(req('hh_consent=granted', { 'sec-gpc': '1' }))).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends for a visitor who accepted', async () => {
    expect(await lead(req('hh_consent=granted'))).toBe('sent')
  })
})

describe('reportPurchaseToMeta', () => {
  function db(contact: Record<string, unknown> | null) {
    return {
      from: (t: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () =>
              t === 'bookings'
                ? { data: { contact_id: 'c1', contact_email: 'pat@example.com', contact_phone: '6315550123', attribution: { fbp: 'fb.1.5.6', fbc: 'fb.1.5.CLK', utm_source: 'facebook', ad_consent: 'granted' } }, error: null }
                : { data: contact, error: null },
          }),
        }),
      }),
    } as never
  }

  it('reports the deposit with the stored ad-click ids and a hashed contact for an opted-in client', async () => {
    expect(await reportPurchaseToMeta(db({ email_opt_in: true, status: 'subscribed' }), { bookingId: 'b1', eventId: 'pi_3Abcdefghijkl', valueCents: 25000 })).toBe('sent')
    const ev = JSON.parse(fetchMock.mock.calls[0][1].body).data[0]
    expect(ev.event_name).toBe('Purchase')
    expect(ev.event_id).toBe('pi_3Abcdefghijkl')
    expect(ev.custom_data.value).toBe(250)
    expect(ev.user_data.fbc).toBe('fb.1.5.CLK')
    expect(ev.user_data.em).toEqual([sha('pat@example.com')])
  })

  it('sends no email or phone for a client who never opted in — but still reports the sale', async () => {
    await reportPurchaseToMeta(db({ email_opt_in: null, status: null }), { bookingId: 'b1', eventId: 'pi_3Abcdefghijkl', valueCents: 25000 })
    const u = JSON.parse(fetchMock.mock.calls[0][1].body).data[0].user_data
    expect(u.em).toBeUndefined()
    expect(u.ph).toBeUndefined()
    expect(u.fbc).toBe('fb.1.5.CLK')
  })

  it('does not report a deposit whose booking never recorded cookie consent', async () => {
    const noConsent = {
      from: (t: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => (t === 'bookings'
              ? { data: { contact_id: 'c1', contact_email: 'a@b.co', contact_phone: null, attribution: { fbp: 'fb.1.5.6' } }, error: null }
              : { data: { email_opt_in: true, status: null }, error: null }),
          }),
        }),
      }),
    } as never
    expect(await reportPurchaseToMeta(noConsent, { bookingId: 'b1', eventId: 'pi_3Abcdefghijkl', valueCents: 25000 })).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips a zero or missing amount rather than reporting a fake sale', async () => {
    expect(await reportPurchaseToMeta(db(null), { bookingId: 'b1', eventId: 'pi_3Abcdefghijkl', valueCents: 0 })).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('every inquiry form reports', () => {
  const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))
  it.each([
    'app/api/lead/route.ts', 'app/api/contact/route.ts', 'app/api/mobile-party-inquiry/route.ts',
    'app/api/fundraiser-inquiry/route.ts', 'app/api/canvas-bag-inquiry/route.ts', 'app/api/trucker-inquiry/route.ts',
  ])('%s sends a Lead after it has decided the lead landed, and never awaits it', rel => {
    const s = read(rel)
    const landed = s.indexOf('landedSomewhere(recorded)')
    const report = s.indexOf("void reportLeadToMeta(req, { body, name: 'Lead'")
    expect(landed).toBeGreaterThan(0)
    expect(report).toBeGreaterThan(landed)
    expect(s).not.toMatch(/await reportLeadToMeta/)
  })
})

describe('the source shape', () => {
  const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

  it('M1: lib/metaCapi.ts writes nothing and holds no token literal', () => {
    const s = read('lib/metaCapi.ts')
    // (`createHash().update(` is an HMAC, not a table write: only a call chained on a table counts.
    expect(s.match(/\.from\(\s*['"`][^'"`]+['"`]\s*\)[\s\S]{0,160}?\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
    expect(s).not.toMatch(/process\.env\.META_CAPI_ACCESS_TOKEN\s*(\|\||\?\?)\s*['"`][^'"`]/)
    expect(s).not.toMatch(/NEXT_PUBLIC_META[A-Z_]*(TOKEN|SECRET)/)
  })

  it('M2: the webhook reports a deposit only on the first processing — never on a redelivery', () => {
    const s = read('app/api/webhook/route.ts')
    const calls = Array.from(s.matchAll(/reportPurchaseToMeta\(/g)).length
    expect(calls).toBe(3)
    // Each call is gated by that branch's own first-time marker, or sits after the duplicate return.
    expect(s).toMatch(/if \(stuFirstTime\) void reportPurchaseToMeta\(/)
    expect(s).toMatch(/if \(pbFirstTime && paymentType === 'deposit'\) void reportPurchaseToMeta\(/)
    const dup = s.indexOf("console.log('Party builder deposit: already handled for session'")
    const call = s.indexOf('reportPurchaseToMeta(supabase, { bookingId, eventId: session.id')
    expect(dup).toBeGreaterThan(0)
    expect(call).toBeGreaterThan(dup)
    // Fire-and-forget: a reporter is never awaited inside the money path.
    expect(s).not.toMatch(/await reportPurchaseToMeta/)
  })

  it('M3: the three inquiry routes report after they have decided the lead landed, and never await it', () => {
    for (const f of ['app/api/lead/route.ts', 'app/api/contact/route.ts', 'app/api/mobile-party-inquiry/route.ts']) {
      const s = read(f)
      const landed = s.indexOf('landedSomewhere(recorded)')
      const report = s.indexOf('void reportLeadToMeta(')
      expect({ f, ok: landed > 0 && report > landed }).toEqual({ f, ok: true })
      expect(s).not.toMatch(/await reportLeadToMeta/)
    }
  })

  it('M4: the browser sends the SAME id the server uses — purchase order_id doubles as the event id', () => {
    const g = read('lib/gtag.ts')
    expect(g).toMatch(/takeMetaEventId\(\)/)
    expect(g).toMatch(/currency: 'USD',\s*\}, transactionId\)/)
    const u = read('lib/utm.ts')
    expect(u).toMatch(/meta_event_id/)
  })
})
