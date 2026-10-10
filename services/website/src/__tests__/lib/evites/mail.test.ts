const sendMock = jest.fn()
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: (...a: unknown[]) => sendMock(...a) } })),
}))

import { sendEviteEmail, DEFAULT_FROM, RESEND_TIMEOUT_MS } from '@/lib/evites/mail'

/** `sendEviteEmail` (spec §2 `mail.ts`): the one Resend call, a named outcome, never throws. */

const INPUT = { to: 'gina@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' }
const ENV = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k]
  process.env.RESEND_API_KEY = 're_test_key'
  process.env.RESEND_FROM_EMAIL = 'Host Hampton <hello@mail.hosthampton.com>'
  sendMock.mockReset()
})
afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('sendEviteEmail', () => {
  it('sent: returns the provider id and sends from RESEND_FROM_EMAIL', async () => {
    sendMock.mockResolvedValue({ data: { id: 're_abc' }, error: null })
    expect(await sendEviteEmail(INPUT)).toEqual({ kind: 'sent', providerId: 're_abc' })
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({ from: 'Host Hampton <hello@mail.hosthampton.com>', to: 'gina@example.com', subject: 'Hello', html: '<p>Hi</p>', text: 'Hi' })
  })

  it('falls back to the reminder sender address, like send-reminders', async () => {
    delete process.env.RESEND_FROM_EMAIL
    sendMock.mockResolvedValue({ data: { id: 're_abc' }, error: null })
    await sendEviteEmail(INPUT)
    expect(sendMock.mock.calls[0][0].from).toBe(DEFAULT_FROM)
  })

  it('unconfigured: no key means nothing is attempted', async () => {
    delete process.env.RESEND_API_KEY
    expect(await sendEviteEmail(INPUT)).toEqual({ kind: 'unconfigured' })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('an error in the RESPONSE is a failure, not a send (Resend resolves, it does not throw)', async () => {
    sendMock.mockResolvedValue({ data: null, error: { message: 'domain is not verified' } })
    const out = await sendEviteEmail(INPUT)
    expect(out.kind).toBe('failed')
    expect(out.kind === 'failed' && out.error).toMatch(/domain is not verified/)
  })

  it('a response with neither an error nor an id is a failure', async () => {
    sendMock.mockResolvedValue({ data: null, error: null })
    expect((await sendEviteEmail(INPUT)).kind).toBe('failed')
    sendMock.mockResolvedValue({ data: {}, error: null })
    expect((await sendEviteEmail(INPUT)).kind).toBe('failed')
  })

  it('never throws: a rejected call is a failure', async () => {
    sendMock.mockRejectedValue(new Error('socket hang up'))
    const out = await sendEviteEmail(INPUT)
    expect(out).toEqual({ kind: 'failed', error: 'resend threw: socket hang up' })
  })

  describe('v1.2 finding 5: a hung Resend call is abandoned', () => {
    beforeEach(() => jest.useFakeTimers())
    afterEach(() => jest.useRealTimers())

    it('RESEND_TIMEOUT_MS is 30 seconds', () => {
      expect(RESEND_TIMEOUT_MS).toBe(30_000)
    })

    it('a call that never answers is a `failed` after 30 s, not a promise that holds the claim until the 15-minute sweep', async () => {
      sendMock.mockReturnValue(new Promise(() => undefined))
      let out: unknown = null
      const p = sendEviteEmail(INPUT).then((o) => (out = o))
      await jest.advanceTimersByTimeAsync(29_999)
      expect(out).toBeNull() // still waiting
      await jest.advanceTimersByTimeAsync(1)
      await p
      expect(out).toEqual({ kind: 'failed', error: expect.stringMatching(/^resend timed out: no answer within 30 seconds/) })
    })

    it('a late answer after the timeout changes nothing and raises nothing', async () => {
      let late: (v: unknown) => void = () => undefined
      sendMock.mockReturnValue(new Promise((r) => (late = r)))
      const p = sendEviteEmail(INPUT)
      await jest.advanceTimersByTimeAsync(30_000)
      expect((await p).kind).toBe('failed')
      late({ data: { id: 're_late' }, error: null })
      await jest.advanceTimersByTimeAsync(10)
    })

    it('a prompt answer clears the timer (no stray timer keeps the process alive)', async () => {
      sendMock.mockResolvedValue({ data: { id: 're_abc' }, error: null })
      expect(await sendEviteEmail(INPUT)).toEqual({ kind: 'sent', providerId: 're_abc' })
      expect(jest.getTimerCount()).toBe(0)
    })
  })

  it('passes attachments, headers and reply-to through; sends none when there are none', async () => {
    sendMock.mockResolvedValue({ data: { id: 're_abc' }, error: null })
    await sendEviteEmail({
      ...INPUT,
      attachments: [{ filename: 'party.ics', content: Buffer.from('BEGIN:VCALENDAR'), contentType: 'text/calendar; method=PUBLISH; charset=UTF-8' }],
      headers: { 'List-Unsubscribe': '<https://www.hosthampton.com/api/unsubscribe?t=x>' },
      replyTo: 'owner@example.com',
    })
    const sent = sendMock.mock.calls[0][0]
    expect(sent.attachments).toEqual([{ filename: 'party.ics', content: Buffer.from('BEGIN:VCALENDAR'), contentType: 'text/calendar; method=PUBLISH; charset=UTF-8' }])
    expect(sent.headers).toEqual({ 'List-Unsubscribe': '<https://www.hosthampton.com/api/unsubscribe?t=x>' })
    expect(sent.replyTo).toBe('owner@example.com')

    sendMock.mockClear()
    await sendEviteEmail(INPUT)
    const bare = sendMock.mock.calls[0][0]
    expect('attachments' in bare).toBe(false)
    expect('headers' in bare).toBe(false)
    expect('replyTo' in bare).toBe(false)
  })
})
