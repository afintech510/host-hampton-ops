/**
 * send_message: a plain message to the customer in the manager's words. Senders are mocked, so
 * nothing here can text or email anyone. The guards are the same as send_client_links.
 */
type Row = Record<string, any>
let booking: Row = {}
const sentSms: { to: string; body: string }[] = []
const sentMail: Row[] = []
const logged: string[] = []
let quiet: { kind: 'open' | 'closed' } = { kind: 'open' }
let stop: 'clear' | 'stopped' | 'unavailable' = 'clear'
let smsOk = true
const sentCheckin: number[] = []

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: { json: (body: any, init?: any) => ({ status: init?.status || 200, json: async () => body, body }) },
}))
jest.mock('@/lib/adminAuth', () => ({ isAdminAuthorized: () => true, unauthorizedResponse: () => ({ status: 401 }), adminActorId: () => 'admin:test' }))
jest.mock('@/lib/bookingAudit', () => ({ logBookingChange: jest.fn(async (_s: unknown, o: { summary: string }) => { logged.push(o.summary); return true }) }))
jest.mock('@/lib/calendarSync', () => ({ syncBookingCalendar: jest.fn(async () => ({ ok: true })), clearBookingCalendar: jest.fn() }))
jest.mock('@/lib/checkinReminders', () => ({ enqueueCheckinReminders: jest.fn(), cancelCheckinReminders: jest.fn() }))
jest.mock('@/lib/sms', () => ({
  ...jest.requireActual('@/lib/sms'),
  sendSMSVia: jest.fn(async (_p: string, to: string, body: string) => { if (!smsOk) return null; sentSms.push({ to, body }); return 'SM1' }),
  normalizePhone: (p: string) => p,
}))
jest.mock('@/lib/quietHours', () => ({ ...jest.requireActual('@/lib/quietHours'), checkSmsQuietHours: () => quiet }))
jest.mock('@/lib/checkinLink', () => ({ ...jest.requireActual('@/lib/checkinLink'), sendCheckinLinkSms: async () => { sentCheckin.push(1); return { sent: true, url: 'https://x' } } }))
jest.mock('@/lib/phoneStop', () => ({ phoneHasExplicitStop: async () => stop }))
jest.mock('resend', () => ({ Resend: class { emails = { send: async (m: Row) => { sentMail.push(m); return { error: null } } } } }))

function table(name: string) {
  const filters: ((r: Row) => boolean)[] = []
  const q: Record<string, any> = {}
  q.select = () => q
  q.eq = (c: string, v: any) => (filters.push(r => r[c] === v), q)
  q.maybeSingle = async () => ({ data: name === 'bookings' ? booking : null, error: null })
  q.single = async () => ({ data: name === 'bookings' ? booking : null, error: null })
  q.then = (res: (v: any) => any) => Promise.resolve({ data: [], error: null }).then(res)
  return q
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: (n: string) => table(n) }) }))

import { POST } from '@/app/api/admin/parties/[id]/route'

const act = (b: Row) => POST({ json: async () => b, headers: { get: () => null } } as any, { params: Promise.resolve({ id: 'b1' }) })
const SMS = 'Hi Pat! It is Allie.\nWe are all set for Saturday.\nReply STOP to opt out'

beforeEach(() => {
  process.env.RESEND_API_KEY = 'test'
  sentSms.length = 0; sentMail.length = 0; sentCheckin.length = 0; logged.length = 0
  quiet = { kind: 'open' }; stop = 'clear'; smsOk = true
  booking = { id: 'b1', booking_ref: 'HH-PTY-1', status: 'approved', contact_name: 'Pat Example', contact_email: 'pat@example.com', contact_phone: '+16315550100' }
})

describe('send_message', () => {
  it('texts and emails the exact wording, and logs it on the booking', async () => {
    const res: any = await act({ action: 'send_message', confirm: true, sms: true, email: true, smsBody: SMS, emailSubject: 'Saturday', emailBody: 'Hi Pat,\n\nAll set for Saturday.' })
    expect(res.body.ok).toBe(true)
    expect(res.body.sentVia).toEqual(['email', 'text'])
    expect(sentSms).toEqual([{ to: '+16315550100', body: SMS }])
    expect(sentMail[0]).toMatchObject({ to: 'pat@example.com', subject: 'Saturday', text: 'Hi Pat,\n\nAll set for Saturday.' })
    expect(logged[0]).toMatch(/^Message sent to customer via email \+ text/)
  })

  it.each([
    ['no confirm', { confirm: false, sms: true, smsBody: SMS }, 400],
    ['no channel', { confirm: true }, 400],
    ['a text with no STOP line', { confirm: true, sms: true, smsBody: 'See you Saturday' }, 400],
    ['a link placeholder', { confirm: true, sms: true, smsBody: 'Here {portal}\nReply STOP to opt out' }, 400],
    ['an empty email', { confirm: true, email: true, emailSubject: 'x', emailBody: ' ' }, 400],
  ])('refuses %s and sends nothing', async (_n, extra, status) => {
    const res: any = await act({ action: 'send_message', ...(extra as object) })
    expect(res.status).toBe(status)
    expect(sentSms).toHaveLength(0)
    expect(sentMail).toHaveLength(0)
  })

  it('refuses a cancelled party', async () => {
    booking.status = 'cancelled'
    const res: any = await act({ action: 'send_message', confirm: true, sms: true, smsBody: SMS })
    expect(res.status).toBe(409)
    expect(sentSms).toHaveLength(0)
  })

  it('does not text outside 8am-9pm or to a STOP, and the refusal changes nothing', async () => {
    quiet = { kind: 'closed' }
    expect(((await act({ action: 'send_message', confirm: true, sms: true, smsBody: SMS })) as any).status).toBe(409)
    quiet = { kind: 'open' }; stop = 'stopped'
    expect(((await act({ action: 'send_message', confirm: true, sms: true, smsBody: SMS })) as any).status).toBe(409)
    stop = 'unavailable'
    expect(((await act({ action: 'send_message', confirm: true, sms: true, smsBody: SMS })) as any).status).toBe(409)
    expect(sentSms).toHaveLength(0)
  })

  it('still sends the email when only the text is blocked, and says so', async () => {
    stop = 'stopped'
    const res: any = await act({ action: 'send_message', confirm: true, sms: true, email: true, smsBody: SMS, emailSubject: 'Saturday', emailBody: 'Hi Pat,\n\nAll set.' })
    expect(res.body.ok).toBe(true)
    expect(res.body.sentVia).toEqual(['email'])
    expect(res.body.failures.join(' ')).toMatch(/STOP/)
    expect(sentSms).toHaveLength(0)
  })

  it('answers 502 when the text provider fails, not ok', async () => {
    smsOk = false
    const res: any = await act({ action: 'send_message', confirm: true, sms: true, smsBody: SMS })
    expect(res.status).toBe(502)
    expect(logged[0]).toMatch(/^Message NOT sent/)
  })
})

describe('send_checkin_link guards', () => {
  it('sends inside the window to a number with no STOP', async () => {
    const res: any = await act({ action: 'send_checkin_link' })
    expect(res.body.ok).toBe(true)
    expect(sentCheckin).toHaveLength(1)
  })

  it('does not send outside 8am-9pm, to a STOP, or when the STOP cannot be checked', async () => {
    quiet = { kind: 'closed' }
    expect(((await act({ action: 'send_checkin_link' })) as any).status).toBe(409)
    quiet = { kind: 'open' }; stop = 'stopped'
    expect(((await act({ action: 'send_checkin_link' })) as any).status).toBe(409)
    stop = 'unavailable'
    expect(((await act({ action: 'send_checkin_link' })) as any).status).toBe(409)
    expect(sentCheckin).toHaveLength(0)
  })
})
