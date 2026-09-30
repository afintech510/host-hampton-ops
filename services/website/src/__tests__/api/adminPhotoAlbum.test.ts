/**
 * `POST /api/admin/parties/[id]` with `action: 'send_photo_album'` — paste the
 * Fotoshare link, email + text it to the family with the review ask.
 *
 * What must hold: the link is saved before anything is sent; a second send of
 * the same album needs `resend: true` (a text cannot be un-sent); a text never
 * goes out in quiet hours or to a number with a STOP; and a partial send is
 * reported as partial.
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

const BK = 'bbbbbbbb-0000-4000-8000-0000000000a1'
const ALBUM = 'https://fotoshare.co/e/AbC123'

function db(over: Record<string, unknown> = {}, extra: Record<string, Record<string, unknown>[]> = {}) {
  return makeFakeMoneyDb({
    bookings: [{
      id: BK, booking_ref: 'HH-PTY-ALBUM', status: 'approved',
      contact_name: 'Jessica Smith', contact_email: 'adam@easternbuilding.supply',
      contact_phone: '631-400-8080', child_name: 'Emma',
      event_type: 'kid-party', party_type: 'in_studio_theme',
      party_date: '2026-09-27', party_time: '14:00', photo_gallery_url: null,
      ...over,
    }],
    booking_modifications: [],
    marketing_ledger: [],
    contacts: [],
    contact_interactions: [],
    ...extra,
  })
}

let body: any
const req = () => ({ headers: { get: () => null }, json: async () => body }) as any
const params = Promise.resolve({ id: BK })

beforeEach(() => {
  jest.clearAllMocks()
  mockQuiet.mockReturnValue({ kind: 'open' })
  mockSendSMSVia.mockResolvedValue('SM_1')
  mockResendSend.mockResolvedValue({ data: { id: 'em_1' }, error: null })
  body = { action: 'send_photo_album', confirm: true, url: ALBUM, occasion: "Emma's birthday party" }
  process.env.RESEND_API_KEY = 're_test'
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('send_photo_album — the happy path', () => {
  it('saves the link, emails and texts the same message, and logs it', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(res.json().sentVia).toEqual(['email', 'text'])

    expect(d.rows('bookings')[0].photo_gallery_url).toBe(ALBUM)

    expect(mockResendSend).toHaveBeenCalledTimes(1)
    const mail = mockResendSend.mock.calls[0][0]
    expect(mail.subject).toBe('📷 Photo Booth Album🥳')
    expect(mail.to).toBe('adam@easternbuilding.supply')
    expect(mail.replyTo).toBeTruthy()               // replies reach a person, not noReply
    expect(mail.text).toContain("host Emma's birthday party!")
    expect(mail.html).toContain(`href="${ALBUM}"`)

    expect(mockSendSMSVia).toHaveBeenCalledTimes(1)
    const [provider, to, sms] = mockSendSMSVia.mock.calls[0]
    expect(provider).toBe('quo')
    expect(to).toBe('+16314008080')
    expect(sms).toBe(mail.text)                       // one message, two channels

    const mods = d.rows('booking_modifications')
    expect(mods.some((m: any) => m.change_summary.startsWith('Photo booth album sent via email + text'))).toBe(true)
    expect(d.rows('marketing_ledger').filter((r: any) => r.entity_type === 'review_request')).toHaveLength(2)
  })

  it('can send by email only', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body.sms = false
    const res: any = await POST(req(), { params })
    expect(res.json().sentVia).toEqual(['email'])
    expect(mockSendSMSVia).not.toHaveBeenCalled()
  })
})

describe('send_photo_album — refusals send nothing', () => {
  it.each([
    ['unconfirmed', { confirm: undefined }],
    ['not a Fotoshare link', { url: 'https://www.hosthampton.com/portal/x' }],
    ['no occasion', { occasion: '  ' }],
    ['no channel', { email: false, sms: false }],
  ])('%s → 400', async (_label, patch) => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body = { ...body, ...patch }
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(400)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(d.rows('bookings')[0].photo_gallery_url).toBeNull()
  })

  it('a cancelled booking is refused', async () => {
    const d = db({ status: 'cancelled' })
    mockGetSupabase.mockReturnValue(d.client)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(409)
    expect(mockResendSend).not.toHaveBeenCalled()
  })

  it('asking to text a booking with no phone is refused, not silently emailed', async () => {
    const d = db({ contact_phone: null })
    mockGetSupabase.mockReturnValue(d.client)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(409)
    expect(mockResendSend).not.toHaveBeenCalled()
  })
})

describe('send_photo_album — never twice by accident', () => {
  it('a second send answers 409 alreadySent until resend:true', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    expect((await POST(req(), { params }) as any).status).toBe(200)
    jest.clearAllMocks()
    mockQuiet.mockReturnValue({ kind: 'open' })
    mockSendSMSVia.mockResolvedValue('SM_2')
    mockResendSend.mockResolvedValue({ data: { id: 'em_2' }, error: null })

    const again: any = await POST(req(), { params })
    expect(again.status).toBe(409)
    expect(again.json().alreadySent).toBe(true)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSVia).not.toHaveBeenCalled()

    body.resend = true
    const forced: any = await POST(req(), { params })
    expect(forced.status).toBe(200)
    expect(mockSendSMSVia).toHaveBeenCalledTimes(1)
  })

  it('a send that reached nobody does not count as sent', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'boom' } })
    mockSendSMSVia.mockResolvedValue(null)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(502)
    // The link is still saved — it was saved before the sends.
    expect(d.rows('bookings')[0].photo_gallery_url).toBe(ALBUM)

    mockResendSend.mockResolvedValue({ data: { id: 'em_3' }, error: null })
    mockSendSMSVia.mockResolvedValue('SM_3')
    expect((await POST(req(), { params }) as any).status).toBe(200)   // no resend flag needed
  })
})

describe('send_photo_album — the text obeys the SMS rules', () => {
  it('in quiet hours the email goes and the text does not, and it says so', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    mockQuiet.mockReturnValue({ kind: 'quiet', reason: 'quiet', until: new Date() } as any)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(res.json().sentVia).toEqual(['email'])
    expect(res.json().failures.join(' ')).toMatch(/outside 8am–9pm/)
    expect(mockSendSMSVia).not.toHaveBeenCalled()
  })

  it('a STOP on any contact row holding the number blocks the text', async () => {
    const d = db({}, {
      contacts: [
        { id: 'c1', phone: '(631) 400-8080', sms_opt_in: true, sms_opt_in_at: null, created_at: '2026-01-01' },
        { id: 'c2', phone: '+16314008080', sms_opt_in: false, sms_opt_in_at: '2026-02-01', created_at: '2026-02-01' },
      ],
    })
    mockGetSupabase.mockReturnValue(d.client)
    const res: any = await POST(req(), { params })
    expect(res.json().sentVia).toEqual(['email'])
    expect(res.json().failures.join(' ')).toMatch(/STOP/)
    expect(mockSendSMSVia).not.toHaveBeenCalled()
  })
})
