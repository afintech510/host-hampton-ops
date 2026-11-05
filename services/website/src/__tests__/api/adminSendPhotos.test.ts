/**
 * `POST /api/admin/parties/[id]` with `action: 'send_photos'` — email and/or a
 * text LINK carrying real party photos from the library.
 *
 * What must hold: photos are resolved ONLY through the library reader (approved
 * AND no identifiable child); a withdrawn photo refuses the whole send; the text
 * is a short link and never a picture message; quiet hours and STOP are checked
 * before anything is created or sent; and every outcome is in the change log.
 * Nothing here can reach a real person: Resend, Quo and the database are fakes.
 */

import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

const mockResendSend = jest.fn().mockResolvedValue({ data: { id: 'em_1' }, error: null })
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } })),
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

jest.mock('@/lib/adminAuth', () => ({
  ...jest.requireActual('@/lib/adminAuth'),
  isAdminAuthorized: jest.fn(() => true),
}))

const mockSendSMSVia = jest.fn().mockResolvedValue('SM_1')
jest.mock('@/lib/sms', () => ({
  sendSMSVia: (...a: any[]) => mockSendSMSVia(...a),
  normalizePhone: (p: string) => `+1${p.replace(/\D/g, '').slice(-10)}`,
}))

const mockQuiet = jest.fn(() => ({ kind: 'open' }))
jest.mock('@/lib/quietHours', () => ({ checkSmsQuietHours: () => mockQuiet() }))

jest.mock('@/lib/googleCalendar', () => ({
  createCalendarEvent: jest.fn(), addMinutes: jest.fn(() => '12:00'),
  updateCalendarEvent: jest.fn(), deleteCalendarEvent: jest.fn(),
}))
jest.mock('@/lib/checkinReminders', () => ({
  enqueueCheckinReminders: jest.fn(), cancelCheckinReminders: jest.fn(),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }) },
}))

import { POST } from '@/app/api/admin/parties/[id]/route'
import { TENANT } from '@/tenant'

const BK = 'bbbbbbbb-0000-4000-8000-0000000000b1'
const P1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const P2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const P3 = 'aaaaaaaa-0000-4000-8000-000000000003'

function photo(id: string, over: Record<string, unknown> = {}) {
  return {
    id, url: `https://cdn.example/media/${id}.webp`, alt: `Photo ${id.slice(-1)}`, w: 800, h: 600,
    party_type: 'in_studio_theme', theme_slug: 'slime-party', activities: ['slime-making'], ig_permalink: null,
    approved: true, no_identifiable_faces: true, sort: 0, quality: 4, posted_at: '2026-10-01', ...over,
  }
}

function db(over: Record<string, unknown> = {}, photos = [photo(P1), photo(P2), photo(P3, { approved: false })]) {
  return makeFakeMoneyDb({
    bookings: [{
      id: BK, booking_ref: 'HH-PTY-PHOTO', status: 'approved',
      contact_name: 'Pat Example', contact_email: 'parent@example.com',
      contact_phone: '631-555-0100', child_name: 'Sam',
      event_type: 'kid-party', party_type: 'in_studio_theme',
      party_date: '2026-11-21', party_time: '14:00',
      ...over,
    }],
    booking_modifications: [],
    contacts: [],
    media_assets: photos,
    photo_sets: [],
  })
}

let body: any
const req = () => ({ headers: { get: () => null }, json: async () => body }) as any
const params = Promise.resolve({ id: BK })

beforeEach(() => {
  jest.clearAllMocks()
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-portal-secret'
  process.env.RESEND_API_KEY = 're_test'
  mockQuiet.mockReturnValue({ kind: 'open' })
  mockSendSMSVia.mockResolvedValue('SM_1')
  mockResendSend.mockResolvedValue({ data: { id: 'em_1' }, error: null })
  body = { action: 'send_photos', confirm: true, photoIds: [P1, P2], email: true, sms: true }
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('send_photos — the happy path', () => {
  it('emails the photos inline and texts ONE short link, never a picture message', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, action: 'photos_sent', sentVia: ['email', 'text'], count: 2 })

    // The set is saved with exactly the ids asked for.
    const set = d.rows('photo_sets')[0] as any
    expect(set.photo_ids).toEqual([P1, P2])
    expect(set.booking_id).toBe(BK)

    const mail = mockResendSend.mock.calls[0][0]
    expect(mail.to).toBe('parent@example.com')
    expect(mail.replyTo).toBeTruthy()
    expect(mail.html).toContain(`src="https://cdn.example/media/${P1}.webp"`)
    expect(mail.html).toContain(`src="https://cdn.example/media/${P2}.webp"`)
    expect(mail.html).toContain(TENANT.people.customerSignoff)
    expect(mail.text).toContain('/p/')

    // The text: provider, number, body — three arguments, no media attachment.
    expect(mockSendSMSVia).toHaveBeenCalledTimes(1)
    const call = mockSendSMSVia.mock.calls[0]
    expect(call).toHaveLength(3)
    const [provider, to, sms] = call
    expect(provider).toBe('quo')
    expect(to).toBe('+16315550100')
    expect(sms).toMatch(/\/p\/[a-z0-9]{18}/)
    expect(sms).toContain('Reply STOP to opt out')
    expect(sms).not.toContain('.webp') // links to the set page, not to an image
    expect(sms).toContain(TENANT.people.customerSignoff)
    expect(sms).not.toMatch(/\bAdam\b/)

    const mods = d.rows('booking_modifications')
    expect(mods.some((m: any) => /^Photos sent to customer \(2\) via email \+ text/.test(m.change_summary))).toBe(true)
  })

  it('can send by email only (no text, no quiet-hours check)', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body.sms = false
    const res: any = await POST(req(), { params })
    expect(res.json().sentVia).toEqual(['email'])
    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(mockQuiet).not.toHaveBeenCalled()
  })

  it('accepts a filter instead of ids and finds the photos through the same reader', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body = { action: 'send_photos', confirm: true, filter: { partyType: 'in_studio_theme' }, email: true, sms: false }
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    // The unapproved third photo is never part of the set.
    expect((d.rows('photo_sets')[0] as any).photo_ids.sort()).toEqual([P1, P2])
  })
})

describe('send_photos — refusals send nothing', () => {
  it.each([
    ['unconfirmed', { confirm: undefined }, 400],
    ['no channel', { email: false, sms: false }, 400],
    ['no photos named', { photoIds: [], filter: undefined }, 400],
  ])('%s is refused (400)', async (_label, patch, status) => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body = { ...body, ...patch }
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(status)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(d.rows('photo_sets')).toHaveLength(0)
  })

  it('a photo that is not approved is never sent, and the whole send is refused', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body.photoIds = [P1, P3] // P3 is unapproved
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(409)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(d.rows('photo_sets')).toHaveLength(0)
  })

  it('a photo that may show a child is never sent', async () => {
    const d = db({}, [photo(P1, { no_identifiable_faces: false })])
    mockGetSupabase.mockReturnValue(d.client)
    body.photoIds = [P1]
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(409)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it.each(['cancelled', 'lost'])('a %s party is refused', async status => {
    const d = db({ status })
    mockGetSupabase.mockReturnValue(d.client)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(409)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('no valid email with email ticked → 409; no phone with text ticked → 409', async () => {
    mockGetSupabase.mockReturnValue(db({ contact_email: 'not-an-email' }).client)
    expect(((await POST(req(), { params })) as any).status).toBe(409)
    mockGetSupabase.mockReturnValue(db({ contact_phone: '' }).client)
    expect(((await POST(req(), { params })) as any).status).toBe(409)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSVia).not.toHaveBeenCalled()
  })
})

describe('send_photos — the text follows the same rules as send_client_links', () => {
  it('outside 8am–9pm: the email still goes, the text does not, and it is said', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    mockQuiet.mockReturnValue({ kind: 'closed' } as any)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(res.json().sentVia).toEqual(['email'])
    expect(res.json().failures.join(' ')).toMatch(/outside 8am–9pm/)
    expect(mockSendSMSVia).not.toHaveBeenCalled()
  })

  it('text-only outside the window changes nothing at all (no set is even created)', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    mockQuiet.mockReturnValue({ kind: 'closed' } as any)
    body.email = false
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(409)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(d.rows('photo_sets')).toHaveLength(0)
  })

  it('a STOP on any contact row holding the number blocks the text, and the email still goes', async () => {
    const d = db()
    d.rows('contacts').push(
      { id: 'c1', phone: '(631) 555-0100', sms_opt_in: true, sms_opt_in_at: null, created_at: '2026-01-01' },
      { id: 'c2', phone: '+16315550100', sms_opt_in: false, sms_opt_in_at: '2026-02-01', created_at: '2026-02-01' },
    )
    mockGetSupabase.mockReturnValue(d.client)
    const res: any = await POST(req(), { params })
    expect(res.json().sentVia).toEqual(['email'])
    expect(res.json().failures.join(' ')).toMatch(/STOP/)
    expect(mockSendSMSVia).not.toHaveBeenCalled()
  })

  it('a provider failure on both channels is a 502 and is logged as NOT sent', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'bounced' } })
    mockSendSMSVia.mockResolvedValue(null)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(502)
    expect(d.rows('booking_modifications').some((m: any) => /^Photos NOT sent/.test(m.change_summary))).toBe(true)
  })
})
