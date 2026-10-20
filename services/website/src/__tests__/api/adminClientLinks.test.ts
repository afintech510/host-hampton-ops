/**
 * `POST /api/admin/parties/[id]` with `action: 'send_client_links'` — the
 * Parties panel's "Send links to client": invitation / planner / invoice /
 * portal, by email and/or text, in the default wording or an admin's edit.
 *
 * What must hold: the links are minted only once every check has passed (a
 * refused send leaves no live sign-in token); a picked link cannot be dropped
 * by editing its placeholder out; the invitation must exist and not be
 * archived; a text never goes out in quiet hours or to a STOPped number; the
 * admin's wording is escaped in the HTML and untouched in the text; and no
 * sign-in link is written to the audit trail.
 */

import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'
import {
  defaultEmailBody, defaultEmailSubject, defaultSmsBody, checkPlaceholders, clientLinksEmailHtml,
} from '@/lib/clientLinks'

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

const BK = 'bbbbbbbb-0000-4000-8000-0000000000c1'
const BOOKING = {
  id: BK, booking_ref: 'HH-PTY-LINKS', status: 'approved',
  contact_name: 'Jessica Smith', contact_email: 'adam@easternbuilding.supply',
  contact_phone: '631-400-8080', child_name: 'Emma',
  event_type: 'kid-party', party_type: 'in_studio_theme',
  party_date: '2026-11-27', party_time: '14:00',
}

function db(over: Record<string, unknown> = {}, extra: Record<string, Record<string, unknown>[]> = {}) {
  return makeFakeMoneyDb({
    bookings: [{ ...BOOKING, ...over }],
    booking_modifications: [],
    portal_tokens: [],
    evites: [{ id: 'ev1', booking_id: BK, slug: 'emma-glow-x7', archived_at: null }],
    marketing_ledger: [],
    contacts: [],
    contact_interactions: [],
    ...extra,
  })
}

function defaults(links: any[]) {
  return {
    action: 'send_client_links', confirm: true, links, email: true, sms: true,
    emailSubject: defaultEmailSubject(BOOKING, links),
    emailBody: defaultEmailBody(BOOKING, links),
    smsBody: defaultSmsBody(BOOKING, links),
  }
}

let body: any
const req = () => ({ headers: { get: () => null }, json: async () => body }) as any
const params = Promise.resolve({ id: BK })

beforeEach(() => {
  jest.clearAllMocks()
  mockQuiet.mockReturnValue({ kind: 'open' })
  mockSendSMSVia.mockResolvedValue('SM_1')
  mockResendSend.mockResolvedValue({ data: { id: 'em_1' }, error: null })
  body = defaults(['invite', 'invoice'])
  process.env.RESEND_API_KEY = 're_test'
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('send_client_links — the happy path', () => {
  it('mints the links, fills them in, emails and texts, and logs without the tokens', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)

    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    expect(res.json().sentVia).toEqual(['email', 'text'])

    const mail = mockResendSend.mock.calls[0][0]
    expect(mail.to).toBe('adam@easternbuilding.supply')
    expect(mail.replyTo).toBeTruthy()
    expect(mail.text).toContain('/i/emma-glow-x7')
    expect(mail.text).toMatch(/\/api\/portal\/auth\?ref=HH-PTY-LINKS&token=[^&\s]+&redirect=%2Fplan%2FHH-PTY-LINKS%2Fsummary/)
    expect(mail.text).toMatch(/redirect=%2Fmy-booking%2Finvitation/)   // {rsvps}
    expect(mail.text).not.toMatch(/\{(invite|rsvps|planner|invoice|portal)\}/)
    expect(mail.html).toContain('href="https://www.hosthampton.com/i/emma-glow-x7"')

    const [provider, to, sms] = mockSendSMSVia.mock.calls[0]
    expect(provider).toBe('quo')
    expect(to).toBe('+16314008080')
    expect(sms).toContain('/i/emma-glow-x7')
    expect(sms).toMatch(/redirect=%2Fplan%2F/)
    expect(sms).toContain('Allie')
    expect(sms).toContain('Reply STOP')

    // invoice (shared by email + text) and rsvps (email only): two tokens.
    expect(d.rows('portal_tokens')).toHaveLength(2)

    const mods = d.rows('booking_modifications')
    const log = mods.find((m: any) => m.change_summary.startsWith('Links sent to customer'))
    expect(log.change_summary).toContain('invitation + invoice')
    expect(JSON.stringify(mods)).not.toMatch(/token=/)
    expect(JSON.stringify(res.json())).not.toMatch(/token=/)
  })

  it('email only mints only what the email uses', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body = { ...defaults(['planner']), sms: false }
    const res: any = await POST(req(), { params })
    expect(res.json().sentVia).toEqual(['email'])
    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(d.rows('portal_tokens')).toHaveLength(1)
    expect(mockResendSend.mock.calls[0][0].text).toMatch(/redirect=%2Fparty-planner/)
  })

  it('sends the admin\'s edited wording, escaped in the HTML and untouched in the text', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body = {
      ...defaults(['portal']),
      emailBody: 'Hi <b>Jess</b> & co,\n\nYour page: {portal}\n\nAllie',
      smsBody: 'Hey Jess — {portal} — Allie',
    }
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(200)
    const mail = mockResendSend.mock.calls[0][0]
    expect(mail.html).toContain('Hi &lt;b&gt;Jess&lt;/b&gt; &amp; co,')
    expect(mail.text).toMatch(/^Hi <b>Jess<\/b> & co,/)
    expect(mockSendSMSVia.mock.calls[0][2]).toMatch(/^Hey Jess — https:\/\/www\.hosthampton\.com\/api\/portal\/auth\?ref=HH-PTY-LINKS&token=\S+ — Allie$/)
  })
})

describe('send_client_links — refusals send nothing and mint nothing', () => {
  it.each([
    ['unconfirmed', { confirm: undefined }],
    ['no links', { links: [] }],
    ['unknown link only', { links: ['admin'] }],
    ['no channel', { email: false, sms: false }],
    ['picked link edited out of the text', { smsBody: 'Hi! Reply STOP to opt out' }],
    ['placeholder for an unpicked link', { smsBody: defaultSmsBody(BOOKING, ['invite', 'invoice']) + ' {planner}' }],
    ['empty subject', { emailSubject: '   ' }],
  ])('%s → 400', async (_label, patch) => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    body = { ...body, ...patch }
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(400)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(d.rows('portal_tokens')).toHaveLength(0)
  })

  it.each([
    ['cancelled booking', { status: 'cancelled' }, {}],
    ['lost booking', { status: 'lost' }, {}],
    ['text asked, no phone', { contact_phone: null }, {}],
    ['email asked, no email', { contact_email: '' }, {}],
    ['no invitation yet', {}, { evites: [] }],
    ['archived invitation', {}, { evites: [{ id: 'ev1', booking_id: BK, slug: 'emma-glow-x7', archived_at: '2026-10-01T00:00:00Z' }] }],
  ])('%s → 409', async (_label, over, extra) => {
    const d = db(over, extra as any)
    mockGetSupabase.mockReturnValue(d.client)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(409)
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(d.rows('portal_tokens')).toHaveLength(0)
  })

  it('a text-only send in quiet hours changes nothing at all', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    mockQuiet.mockReturnValue({ kind: 'quiet', reason: 'quiet', until: new Date() } as any)
    body = { ...body, email: false }
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(409)
    expect(res.json().error).toMatch(/outside 8am–9pm/)
    expect(mockSendSMSVia).not.toHaveBeenCalled()
    expect(d.rows('portal_tokens')).toHaveLength(0)
  })
})

describe('send_client_links — the text obeys the SMS rules', () => {
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

  it('a send that reached nobody answers 502 and is logged as NOT sent', async () => {
    const d = db()
    mockGetSupabase.mockReturnValue(d.client)
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'boom' } })
    mockSendSMSVia.mockResolvedValue(null)
    const res: any = await POST(req(), { params })
    expect(res.status).toBe(502)
    expect(d.rows('booking_modifications').some((m: any) => m.change_summary.startsWith('Links NOT sent'))).toBe(true)
  })
})

describe('lib/clientLinks — the defaults are sendable as written', () => {
  const ALL = ['invite', 'planner', 'invoice', 'portal'] as const
  it.each([[['invite']], [['planner']], [['invoice']], [['portal']], [[...ALL]]])('%j', (links) => {
    expect(checkPlaceholders(defaultEmailBody(BOOKING, links), links, 'email')).toEqual([])
    expect(checkPlaceholders(defaultSmsBody(BOOKING, links), links, 'text')).toEqual([])
    expect(defaultEmailSubject(BOOKING, links).length).toBeGreaterThan(0)
  })

  it('names the child when there is one, and does not invent one', () => {
    expect(defaultSmsBody(BOOKING, ['invite'])).toContain("Emma's invitation")
    expect(defaultSmsBody({ ...BOOKING, child_name: null }, ['invite'])).toContain('your invitation')
    expect(defaultEmailSubject({ ...BOOKING, child_name: null }, ['invite'])).toBe('Your party invitation is ready! 🎉')
  })

  it('a link that is not ours renders as no link rather than a raw one', () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const html = clientLinksEmailHtml('Go: {portal}', { portal: 'javascript:alert(1)' })
    expect(html).not.toContain('javascript:')
    expect(html).toContain('Go: </p>')
  })
})
