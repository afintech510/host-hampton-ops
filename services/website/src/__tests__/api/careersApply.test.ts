/**
 * POST /api/careers/apply — the /join-the-team application.
 *
 * Covers the spec's list (docs/careers-page-plan.md §5): happy path, missing
 * fields, the under-18 refusal, a Helper without the will-learn checkbox, the
 * honeypot, insert failure + email failure → 503, email-only → 200 damaged, and
 * no `contacts` write. Plus the two screens a reviewer cannot see from the diff:
 * the portfolio URL, and escaping in the owner alert.
 */

const mockInsertResult = jest.fn()
const mockFrom = jest.fn()
const mockInsert = jest.fn()

function chain() {
  const c: any = {}
  c.insert = (...args: any[]) => {
    mockInsert(...args)
    return c
  }
  c.select = () => c
  c.single = () => Promise.resolve(mockInsertResult())
  return c
}

jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      mockFrom(table)
      return chain()
    },
  }),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body, headers: init?.headers }),
  },
}))

const mockResendSend = jest.fn()
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: mockResendSend } })),
}))

const mockSms = jest.fn().mockResolvedValue(1)
jest.mock('@/lib/ownerNotify', () => {
  const actual = jest.requireActual('@/lib/ownerNotify')
  return { ...actual, notifyOwnerSms: (...a: any[]) => mockSms(...a) }
})

// If the route ever reached for the lead machinery, these would record it.
const mockUpsertContact = jest.fn()
jest.mock('@/lib/contacts', () => ({ upsertContact: (...a: any[]) => mockUpsertContact(...a) }))

import { POST } from '@/app/api/careers/apply/route'
import { __resetRateLimitForTests } from '@/lib/rateLimit'

const HELPER = {
  role_interest: 'helper',
  name: 'Jamie Rivera',
  email: 'jamie@example.com',
  phone: '631-555-0142',
  is_18_plus: true,
  weekend_availability: 'most',
  weekday_availability: 'sometimes',
  has_car: true,
  heard_about: 'indeed',
  why_us: 'I love crafts and kids.',
  kids_experience: 'Camp counselor two summers.',
  activity_comfort_rating: 4,
  crafts_experience: 'yes',
  braiding_experience: 'some',
  tinsel_experience: 'no',
  nails_experience: 'some',
  will_learn_beauty: true,
}

const LEAD = {
  role_interest: 'lead',
  name: 'Morgan Lee',
  email: 'morgan@example.com',
  phone: '(631) 555-0199',
  is_18_plus: true,
  weekend_availability: 'every',
  weekday_availability: 'yes',
  has_car: false,
  heard_about: 'friend',
  why_us: 'I run events and love a finished room.',
  hospitality_experience: 'Restaurant floor manager, 4 years.',
  lead_comfort_rating: 5,
  decorating_experience: 'Styled two weddings.',
  balloon_experience: 'some',
}

const j = (r: any) => r.json()
const req = (body: any) => ({ json: jest.fn().mockResolvedValue(body), headers: { get: () => null } }) as any

describe('POST /api/careers/apply', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    __resetRateLimitForTests()
    process.env = {
      ...originalEnv,
      RESEND_API_KEY: 're_test_fake',
      RESEND_FROM_EMAIL: 'test@mail.hosthampton.com',
      OWNER_NOTIFY_EMAIL: 'owner@example.com',
    }
    mockInsertResult.mockReturnValue({ data: { id: 'uuid-1', application_ref: 'HHJ-0001' }, error: null })
    mockResendSend.mockResolvedValue({ data: { id: 'email_1' }, error: null })
  })
  afterAll(() => {
    process.env = originalEnv
  })

  it('happy path (Helper): one job_applications row, owner alert, Allie-signed confirmation, one SMS', async () => {
    const res = await POST(req(HELPER))
    expect(res.status).toBe(200)
    expect(j(res)).toMatchObject({ success: true, ref: 'HHJ-0001' })

    expect(mockFrom.mock.calls.map(c => c[0])).toEqual(['job_applications'])
    const row = mockInsert.mock.calls[0][0]
    expect(row).toMatchObject({
      role_interest: 'helper',
      is_18_plus: true,
      will_learn_beauty: true,
      tinsel_experience: 'no',
      activity_comfort_rating: 4,
      lead_comfort_rating: null,
      portfolio_url: null,
    })

    expect(mockResendSend).toHaveBeenCalledTimes(2)
    const [owner, confirm] = mockResendSend.mock.calls.map(c => c[0])
    expect(owner.to).toBe('info@hosthampton.com')
    expect(confirm.replyTo).toBe('info@hosthampton.com')
    expect(owner.replyTo).toBe('jamie@example.com')
    expect(owner.subject).toContain('Jamie Rivera')
    expect(owner.html).toContain('/admin/applications')
    expect(owner.text).toContain('Hair tinsel: No')
    expect(confirm.to).toBe('jamie@example.com')
    expect(confirm.html).toContain('Allie')
    expect(confirm.text).toContain('Allie')
    expect(`${confirm.html}${confirm.text}`).not.toMatch(/Adam/)

    expect(mockSms).toHaveBeenCalledTimes(1)
    expect(mockSms.mock.calls[0][0]).toMatch(/^New Job application: Jamie Rivera - 631-555-0142 - Party Helper \(HHJ-0001\)$/)
  })

  it('never writes a contact — an applicant is not a lead', async () => {
    await POST(req(HELPER))
    await POST(req(LEAD))
    expect(mockUpsertContact).not.toHaveBeenCalled()
    expect(mockFrom.mock.calls.every(c => c[0] === 'job_applications')).toBe(true)
  })

  it('a Lead does not need the will-learn box and gets no Helper columns', async () => {
    const res = await POST(req(LEAD))
    expect(res.status).toBe(200)
    expect(mockInsert.mock.calls[0][0]).toMatchObject({
      role_interest: 'lead',
      lead_comfort_rating: 5,
      balloon_experience: 'some',
      will_learn_beauty: null,
      kids_experience: null,
      has_car: false,
    })
  })

  it('missing fields → 400 naming them, nothing written or sent', async () => {
    const res = await POST(req({ role_interest: 'either', is_18_plus: true, name: 'X' }))
    expect(res.status).toBe(400)
    const err = j(res).error as string
    for (const f of ['email', 'phone', 'weekend availability', 'experience with kids', 'balloon arch', 'hair tinsel']) {
      expect(err).toContain(f)
    }
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSms).not.toHaveBeenCalled()
  })

  it('is_18_plus = false → 400 with the friendly message, nothing written', async () => {
    const res = await POST(req({ ...HELPER, is_18_plus: false }))
    expect(res.status).toBe(400)
    expect(j(res).code).toBe('under_18')
    expect(j(res).error).toMatch(/18 and older/)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('a string "true" is not an 18+ answer', async () => {
    const res = await POST(req({ ...HELPER, is_18_plus: 'true' }))
    expect(res.status).toBe(400)
    expect(j(res).error).toContain('18 or older')
  })

  it('Helper or Either without the will-learn checkbox → 400', async () => {
    for (const role of ['helper', 'either']) {
      const res = await POST(req({ ...HELPER, ...LEAD, role_interest: role, will_learn_beauty: false }))
      expect(res.status).toBe(400)
      expect(j(res).code).toBe('must_learn')
    }
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('honeypot filled → a fake 200, and nothing written, mailed or texted', async () => {
    const res = await POST(req({ ...HELPER, website: 'http://spam.example' }))
    expect(res.status).toBe(200)
    expect(j(res).success).toBe(true)
    expect(mockInsert).not.toHaveBeenCalled()
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSms).not.toHaveBeenCalled()
  })

  it('insert fails AND the owner alert fails → 503', async () => {
    mockInsertResult.mockReturnValue({ data: null, error: { code: '23514', message: 'check violation' } })
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'resend down' } })
    const res = await POST(req(HELPER))
    expect(res.status).toBe(503)
  })

  it('insert fails AND the owner alert throws → 503', async () => {
    mockInsertResult.mockReturnValue({ data: null, error: { code: '08006', message: 'connection' } })
    mockResendSend.mockRejectedValue(new Error('network'))
    const res = await POST(req(HELPER))
    expect(res.status).toBe(503)
  })

  it('insert fails but the owner alert sends → 200, DAMAGED: the alert says it is the only copy', async () => {
    mockInsertResult.mockReturnValue({ data: null, error: { code: '08006', message: 'connection' } })
    const res = await POST(req(HELPER))
    expect(res.status).toBe(200)
    expect(j(res).recorded).toEqual({ application: false, ownerNotified: true })
    const owner = mockResendSend.mock.calls[0][0]
    expect(owner.subject).toMatch(/^\[NOT SAVED\]/)
    expect(owner.html).toContain('did NOT save')
    expect(owner.text).toContain('Camp counselor two summers.')
    expect(mockSms.mock.calls[0][0]).toContain('NOT SAVED')
  })

  it('the row saves but the alert fails → 200 (the admin list still has it)', async () => {
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'resend down' } })
    const res = await POST(req(HELPER))
    expect(res.status).toBe(200)
    expect(j(res).recorded).toEqual({ application: true, ownerNotified: false })
  })

  it('every applicant value in the owner alert HTML is escaped; the plain text is not', async () => {
    await POST(req({ ...HELPER, name: '<script>alert(1)</script> Kim', why_us: 'Me & <b>you</b>' }))
    const owner = mockResendSend.mock.calls[0][0]
    expect(owner.html).not.toContain('<script>')
    expect(owner.html).not.toContain('<b>you</b>')
    expect(owner.html).toContain('&lt;script&gt;')
    expect(owner.html).toContain('Me &amp; &lt;b&gt;you&lt;/b&gt;')
    expect(owner.text).toContain('Me & <b>you</b>')
    const confirm = mockResendSend.mock.calls[1][0]
    expect(confirm.html).not.toContain('<script>')
  })

  it('portfolio: a bare host is given https://, and a javascript: URL is refused', async () => {
    let res = await POST(req({ ...LEAD, portfolio_url: 'instagram.com/morganstyles' }))
    expect(res.status).toBe(200)
    expect(mockInsert.mock.calls[0][0].portfolio_url).toBe('https://instagram.com/morganstyles')
    expect(mockResendSend.mock.calls[0][0].html).toContain('href="https://instagram.com/morganstyles"')

    jest.clearAllMocks()
    res = await POST(req({ ...LEAD, portfolio_url: 'javascript:alert(1)' }))
    expect(res.status).toBe(400)
    expect(mockInsert).not.toHaveBeenCalled()
  })

  it('an unknown enumerated answer is a missing answer, not a stored one', async () => {
    const res = await POST(req({ ...HELPER, weekend_availability: 'sundays-only', braiding_experience: 'expert' }))
    expect(res.status).toBe(400)
    expect(j(res).error).toContain('weekend availability')
    expect(j(res).error).toContain('braiding')
  })
})
