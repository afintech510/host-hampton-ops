/**
 * The invitation hook in the intake routes (spec §2.1; AGENTS.md "IntakeRecord rule").
 *
 * Contract under test: whatever the invitation setup does (throws, answers `unavailable`, hangs, creates a
 * row and fails to queue its render), the intake route answers EXACTLY what it would have answered without it.
 * Three routes are driven end to end; the other four are pinned by source (position and shape of the call).
 */

import * as fs from 'fs'
import * as path from 'path'

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status || 200, json: () => body, body }) },
}))

const mockSend = jest.fn().mockResolvedValue({ id: 'email_1' })
jest.mock('resend', () => ({ Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockSend } })) }))
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ marker: 'supabase' }) }))
jest.mock('@/lib/contacts', () => ({ upsertContact: jest.fn().mockResolvedValue('contact-1') }))
jest.mock('@/lib/sequences', () => ({ enrollInSequence: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/contactInteractions', () => ({ logInteraction: jest.fn().mockResolvedValue(true) }))
jest.mock('@/lib/ownerNotify', () => ({ ownerEmail: () => 'owner@example.com', notifyOwnerSms: jest.fn().mockResolvedValue(undefined), leadSmsLine: () => 'line' }))
jest.mock('@/lib/emailTemplates', () => ({
  leadNotifyHtml: () => '<p>n</p>',
  leadConfirmHtml: () => '<p>c</p>',
  savedQuoteHtml: () => '<p>q</p>',
}))
jest.mock('@/lib/agent/events', () => ({ recordInboundEvent: jest.fn().mockResolvedValue('event-1') }))
const mockPlan = jest.fn()
jest.mock('@/lib/plan', () => ({ ensureLeadPlan: (...a: unknown[]) => mockPlan(...a), linkFirstTouchEvent: jest.fn().mockResolvedValue(undefined) }))
jest.mock('@/lib/evites/ensure', () => ({ ensureEviteForBooking: jest.fn() }))
jest.mock('@/lib/evites/render', () => ({ queueRender: jest.fn(), renderEvite: jest.fn() }))

import { ensureEviteForBooking } from '@/lib/evites/ensure'
import { queueRender } from '@/lib/evites/render'
import { __resetRateLimitForTests } from '@/lib/rateLimit'
import { recordInboundEvent } from '@/lib/agent/events'
import { ensureEviteNonFatal, ENSURE_TIMEOUT_MS } from '@/lib/evites/ensureNonFatal'
import { screenIntakeChildName } from '@/lib/evites/intakeChildName'
import { POST as leadPost } from '@/app/api/lead/route'
import { POST as mobilePost } from '@/app/api/mobile-party-inquiry/route'
import { POST as quotePost } from '@/app/api/quote/save/route'

const ensureMock = ensureEviteForBooking as jest.Mock
const renderQueue = queueRender as jest.Mock

const req = (body: unknown) => ({ json: async () => body, headers: { get: (n: string) => (n.toLowerCase() === 'host' ? 'www.hosthampton.com' : null) } }) as never

const lead = { eventType: 'Kids Birthday Party', fullName: 'Sarah Jones', email: 'sarah@test.com', phone: '631-555-1234', childAge: '7', guestCount: '15', preferredDate: '2026-12-12', sourcePage: 'party-packages' }
const mobile = { name: 'Sarah Jones', email: 'sarah@test.com', phone: '631-555-1234', date: '2026-12-12', details: 'A party at home for twelve' }
const quote = { name: 'Sarah Jones', email: 'sarah@test.com', phone: '631-555-1234', quoteData: { guestCount: 12, lineItems: [], childName: 'Mia' }, summary: 'Glow party', partyDate: '2026-12-12', partyTime: '14:00' }

type Handler = (r: never) => Promise<{ status: number; json: () => Record<string, unknown> }>
const routes: Array<[string, Handler, Record<string, unknown>]> = [
  ['/api/lead', leadPost as unknown as Handler, lead],
  ['/api/mobile-party-inquiry', mobilePost as unknown as Handler, mobile],
  ['/api/quote/save', quotePost as unknown as Handler, quote],
]

beforeEach(() => {
  process.env.RESEND_API_KEY = 're_test'
  process.env.RESEND_FROM_EMAIL = 'x@mail.hosthampton.com'
  __resetRateLimitForTests()
  ensureMock.mockReset()
  renderQueue.mockReset()
  mockSend.mockClear()
  mockPlan.mockReset()
  mockPlan.mockResolvedValue({ bookingId: 'bk-1', bookingRef: 'HH-1', partyType: 'in_studio_theme', reused: false, enriched: true })
  ;(recordInboundEvent as jest.Mock).mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe.each(routes)('%s keeps its answer whatever the invitation does', (_name, post, body) => {
  const baseline = async () => {
    ensureMock.mockResolvedValue({ kind: 'disabled', reason: 'pages-off' })
    const res = await post(req(body))
    __resetRateLimitForTests()
    return { status: res.status, success: res.json().success }
  }

  it('answers 200 when the invitation is created, and queues its render', async () => {
    ensureMock.mockResolvedValue({ kind: 'created', eviteId: 'ev-1', slug: 's' })
    const res = await post(req(body))
    expect(res.status).toBe(200)
    expect(ensureMock).toHaveBeenCalledWith(expect.anything(), 'bk-1')
    expect(renderQueue).toHaveBeenCalledWith('ev-1')
  })

  it('answers the same when ensure THROWS', async () => {
    const was = await baseline()
    ensureMock.mockRejectedValue(new Error('boom: sarah@test.com'))
    const res = await post(req(body))
    expect({ status: res.status, success: res.json().success }).toEqual(was)
  })

  it('answers the same when ensure is UNAVAILABLE', async () => {
    const was = await baseline()
    ensureMock.mockResolvedValue({ kind: 'unavailable', reason: 'booking read failed' })
    const res = await post(req(body))
    expect({ status: res.status, success: res.json().success }).toEqual(was)
    expect(renderQueue).not.toHaveBeenCalled()
  })

  it('answers the same when the render cannot even be queued', async () => {
    const was = await baseline()
    ensureMock.mockResolvedValue({ kind: 'created', eviteId: 'ev-1', slug: 's' })
    renderQueue.mockImplementation(() => {
      throw new Error('queue exploded')
    })
    const res = await post(req(body))
    expect({ status: res.status, success: res.json().success }).toEqual(was)
  })

  it('is not asked to set up an invitation when there is no booking to hang it on', async () => {
    mockPlan.mockResolvedValue({ bookingId: null, bookingRef: null, partyType: null, reused: false })
    ensureMock.mockResolvedValue({ kind: 'created', eviteId: 'ev-1', slug: 's' })
    await post(req(body))
    expect(ensureMock).not.toHaveBeenCalled()
  })

  it('runs AFTER the inbound event was recorded', async () => {
    const order: string[] = []
    ;(recordInboundEvent as jest.Mock).mockImplementationOnce(async () => {
      order.push('event')
      return 'event-1'
    })
    ensureMock.mockImplementation(async () => {
      order.push('ensure')
      return { kind: 'disabled', reason: 'x' }
    })
    await post(req(body))
    expect(order).toEqual(['event', 'ensure'])
  })
})

describe('the child name an intake form may carry', () => {
  it('/api/lead passes a screened childName to the plan', async () => {
    ensureMock.mockResolvedValue({ kind: 'disabled', reason: 'x' })
    await leadPost(req({ ...lead, childName: '  Mia​  ' }))
    expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ childName: 'Mia' }))
  })

  it('/api/mobile-party-inquiry passes a screened childName to the plan', async () => {
    ensureMock.mockResolvedValue({ kind: 'disabled', reason: 'x' })
    await mobilePost(req({ ...mobile, childName: 'Olivia' }))
    expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ childName: 'Olivia' }))
  })

  it("/api/quote/save writes the quote builder's childName to child_name", async () => {
    ensureMock.mockResolvedValue({ kind: 'disabled', reason: 'x' })
    await quotePost(req(quote))
    expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ childName: 'Mia' }))
  })

  it('a missing, blank or non-string name is null and does not refuse the enquiry', async () => {
    ensureMock.mockResolvedValue({ kind: 'disabled', reason: 'x' })
    for (const childName of [undefined, '', '   ', 42, { a: 1 }, ['x']]) {
      __resetRateLimitForTests()
      mockPlan.mockClear()
      const res = await leadPost(req({ ...lead, childName }))
      expect(res.status).toBe(200)
      expect(mockPlan).toHaveBeenCalledWith(expect.objectContaining({ childName: null }))
    }
  })

  it('screenIntakeChildName bounds length and removes control and bidi characters', () => {
    expect(screenIntakeChildName('Mia')).toBe('Mia')
    expect((screenIntakeChildName('x'.repeat(500)) ?? '').length).toBeLessThanOrEqual(60)
    expect(screenIntakeChildName('Mi‮a\u0007')).toBe('Mia')
    expect(screenIntakeChildName(null)).toBeNull()
  })
})

describe('ensureEviteNonFatal', () => {
  const supa = {} as never

  it('a null / empty / non-string id is a quiet no-op', async () => {
    for (const id of [null, undefined, '', 5 as never]) await ensureEviteNonFatal(supa, id)
    expect(ensureMock).not.toHaveBeenCalled()
  })

  it('does not wait forever for a hung database: it carries on after the timeout', async () => {
    jest.useFakeTimers()
    try {
      ensureMock.mockReturnValue(new Promise(() => undefined))
      let done = false
      const p = ensureEviteNonFatal(supa, 'bk-1').then(() => {
        done = true
      })
      await jest.advanceTimersByTimeAsync(ENSURE_TIMEOUT_MS - 1)
      expect(done).toBe(false)
      await jest.advanceTimersByTimeAsync(2)
      await p
      expect(done).toBe(true)
    } finally {
      jest.useRealTimers()
    }
  })

  it('never logs an address or a name', async () => {
    const err = jest.spyOn(console, 'error')
    const warn = jest.spyOn(console, 'warn')
    ensureMock.mockResolvedValueOnce({ kind: 'unavailable', reason: 'booking read failed' })
    await ensureEviteNonFatal(supa, 'bk-1')
    ensureMock.mockRejectedValueOnce(new Error('read failed'))
    await ensureEviteNonFatal(supa, 'bk-1')
    expect(JSON.stringify([...err.mock.calls, ...warn.mock.calls])).not.toMatch(/@/)
  })
})

describe('every intake site (source)', () => {
  const SRC = path.join(__dirname, '../..')
  const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8').replace(/\r\n/g, '\n')
  const SITES: Array<[string, RegExp]> = [
    ['app/api/lead/route.ts', /recordInboundEvent\(/],
    ['app/api/quote/save/route.ts', /recordInboundEvent\(/],
    ['app/api/mobile-party-inquiry/route.ts', /recordInboundEvent\(/],
    ['app/api/party-builder/save/route.ts', /enrollInSequence\(/],
    ['app/api/party-checkout/route.ts', /linkFirstTouchEvent\(booking\.id/],
    ['app/api/admin/parties/create/route.ts', /upsertContact\(/],
    ['app/api/admin/bookings/route.ts', /enrollInSequence\(/],
  ]

  it('lists all seven sites from spec 2.1', () => {
    expect(SITES).toHaveLength(7)
  })

  it.each(SITES)('%s calls ensureEviteNonFatal as a bare awaited statement, once, after the booking write', (rel, writeRe) => {
    const code = read(rel)
    const calls = code.match(/ensureEviteNonFatal\(/g) ?? []
    expect(calls).toHaveLength(1)
    expect(code).toMatch(/^\s*await ensureEviteNonFatal\([^\n]*\)\s*$/m)
    // not assigned, returned, branched on or used in a condition
    expect(code).not.toMatch(/(=|return|if\s*\(|&&|\|\||\?)\s*(await\s+)?ensureEviteNonFatal\(/)
    const at = code.indexOf('await ensureEviteNonFatal(')
    const firstWrite = code.search(writeRe)
    expect(firstWrite).toBeGreaterThan(-1)
    expect(at).toBeGreaterThan(firstWrite)
    // the one wrapper is the only door: no route imports the raw ensure or the renderer
    expect(code).not.toMatch(/from '@\/lib\/evites\/(ensure|render)'/)
  })

  it('party-checkout calls it after linkFirstTouchEvent (the event is recorded first)', () => {
    const code = read('app/api/party-checkout/route.ts')
    expect(code.indexOf('await ensureEviteNonFatal(')).toBeGreaterThan(code.indexOf('await linkFirstTouchEvent('))
  })
})
