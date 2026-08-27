/**
 * Tests for the Quo SMS wrapper (src/lib/quo.ts).
 * Covers: request shape (endpoint, raw Authorization header, JSON body),
 * E.164 normalization, id extraction, error handling, the E2E fake-sender
 * short-circuit, optional userId, and bulk ordering.
 */

import { sendSMSViaQuo, sendBulkSMSViaQuo } from '@/lib/quo'

const OLD_ENV = process.env

beforeEach(() => {
  jest.resetAllMocks()
  process.env = { ...OLD_ENV, QUO_API_KEY: 'quo_test_key', QUO_PHONE_NUMBER: '+16319989325' }
  delete process.env.QUO_USER_ID
  delete process.env.E2E_FAKE_SENDERS
})

afterAll(() => {
  process.env = OLD_ENV
})

function mockFetchOnce(status: number, jsonBody: any) {
  const fn = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => jsonBody,
    text: async () => JSON.stringify(jsonBody),
  })
  ;(global as any).fetch = fn
  return fn
}

describe('sendSMSViaQuo', () => {
  it('POSTs to the Quo messages endpoint with a raw Authorization header and JSON body', async () => {
    const fetchMock = mockFetchOnce(202, { data: { id: 'AC123', status: 'queued' } })

    const id = await sendSMSViaQuo('631-555-0100', 'hello')

    expect(id).toBe('AC123')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.quo.com/v1/messages')
    expect(opts.method).toBe('POST')
    // Raw key — NOT a Bearer token.
    expect(opts.headers.Authorization).toBe('quo_test_key')
    expect(opts.headers['Content-Type']).toBe('application/json')
    const body = JSON.parse(opts.body)
    expect(body).toEqual({
      content: 'hello',
      from: '+16319989325',
      to: ['+16315550100'], // normalized to E.164
    })
  })

  it('falls back to a top-level id when the response has no data wrapper', async () => {
    mockFetchOnce(202, { id: 'AC999' })
    expect(await sendSMSViaQuo('+16315550100', 'hi')).toBe('AC999')
  })

  it('includes userId when QUO_USER_ID is set', async () => {
    process.env.QUO_USER_ID = 'US777'
    const fetchMock = mockFetchOnce(202, { data: { id: 'AC1' } })
    await sendSMSViaQuo('+16315550100', 'hi')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.userId).toBe('US777')
  })

  it('returns null on a non-2xx response (e.g. 400 A2P not approved)', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchOnce(400, { message: 'A2P not approved', code: 'not_approved' })
    expect(await sendSMSViaQuo('+16315550100', 'hi')).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it('short-circuits without calling fetch when E2E_FAKE_SENDERS=1', async () => {
    process.env.E2E_FAKE_SENDERS = '1'
    const fetchMock = mockFetchOnce(202, { data: { id: 'should-not-be-used' } })
    const id = await sendSMSViaQuo('+16315550100', 'hi')
    expect(id).toMatch(/^QUOfake/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('throws-safe: returns null and does not reject when the API key is missing', async () => {
    delete process.env.QUO_API_KEY
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    mockFetchOnce(202, { data: { id: 'AC1' } })
    expect(await sendSMSViaQuo('+16315550100', 'hi')).toBeNull()
    errSpy.mockRestore()
  })
})

describe('sendBulkSMSViaQuo', () => {
  it('sends one request per contact and preserves order', async () => {
    let n = 0
    ;(global as any).fetch = jest.fn().mockImplementation(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ data: { id: `AC${++n}` } }),
      text: async () => '',
    }))

    const results = await sendBulkSMSViaQuo(
      [
        { phone: '+16315550101', body: 'a' },
        { phone: '+16315550102', body: 'b' },
      ],
      0 // no delay in tests
    )

    expect(results).toEqual(['AC1', 'AC2'])
    expect((global as any).fetch).toHaveBeenCalledTimes(2)
  })
})
