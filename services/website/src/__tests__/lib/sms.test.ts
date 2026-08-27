/**
 * Tests for the SMS provider router (src/lib/sms.ts).
 * Verifies provider selection, explicit overrides, and that MMS always
 * uses Twilio regardless of SMS_PROVIDER.
 */

jest.mock('@/lib/twilio', () => ({
  sendSMS: jest.fn().mockResolvedValue('TW1'),
  sendMMS: jest.fn().mockResolvedValue('MM1'),
  normalizePhone: (s: string) => s,
}))
jest.mock('@/lib/quo', () => ({
  sendSMSViaQuo: jest.fn().mockResolvedValue('QUO1'),
}))

import { sendSMS, sendMMS, sendBulkSMS, sendSMSVia, getSmsProvider } from '@/lib/sms'
import { sendSMS as twSendSMS, sendMMS as twSendMMS } from '@/lib/twilio'
import { sendSMSViaQuo } from '@/lib/quo'

const OLD_ENV = process.env
beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...OLD_ENV }
  delete process.env.SMS_PROVIDER
})
afterAll(() => { process.env = OLD_ENV })

describe('getSmsProvider', () => {
  it('defaults to twilio', () => {
    expect(getSmsProvider()).toBe('twilio')
  })
  it('is quo only when SMS_PROVIDER=quo', () => {
    process.env.SMS_PROVIDER = 'quo'
    expect(getSmsProvider()).toBe('quo')
    process.env.SMS_PROVIDER = 'something-else'
    expect(getSmsProvider()).toBe('twilio')
  })
})

describe('sendSMS (env-driven)', () => {
  it('uses Twilio by default', async () => {
    expect(await sendSMS('+1', 'hi')).toBe('TW1')
    expect(twSendSMS).toHaveBeenCalledWith('+1', 'hi')
    expect(sendSMSViaQuo).not.toHaveBeenCalled()
  })
  it('uses Quo when SMS_PROVIDER=quo', async () => {
    process.env.SMS_PROVIDER = 'quo'
    expect(await sendSMS('+1', 'hi')).toBe('QUO1')
    expect(sendSMSViaQuo).toHaveBeenCalledWith('+1', 'hi')
    expect(twSendSMS).not.toHaveBeenCalled()
  })
})

describe('sendSMSVia (explicit override)', () => {
  it('routes to the named provider regardless of env', async () => {
    process.env.SMS_PROVIDER = 'twilio'
    expect(await sendSMSVia('quo', '+1', 'x')).toBe('QUO1')
    expect(sendSMSViaQuo).toHaveBeenCalled()

    expect(await sendSMSVia('twilio', '+1', 'y')).toBe('TW1')
    expect(twSendSMS).toHaveBeenCalled()
  })
})

describe('sendMMS', () => {
  it('always uses Twilio, even when SMS_PROVIDER=quo', async () => {
    process.env.SMS_PROVIDER = 'quo'
    expect(await sendMMS('+1', 'x', ['http://img'])).toBe('MM1')
    expect(twSendMMS).toHaveBeenCalled()
    expect(sendSMSViaQuo).not.toHaveBeenCalled()
  })
})

describe('sendBulkSMS', () => {
  it('routes SMS per-contact via the override provider', async () => {
    const res = await sendBulkSMS(
      [{ phone: '+1', body: 'a' }, { phone: '+2', body: 'b' }],
      0,
      undefined,
      'quo'
    )
    expect(res).toEqual(['QUO1', 'QUO1'])
    expect(sendSMSViaQuo).toHaveBeenCalledTimes(2)
  })
  it('sends MMS via Twilio when mediaUrls are provided', async () => {
    const res = await sendBulkSMS([{ phone: '+1', body: 'a' }], 0, ['http://img'], 'quo')
    expect(res).toEqual(['MM1'])
    expect(twSendMMS).toHaveBeenCalled()
    expect(sendSMSViaQuo).not.toHaveBeenCalled()
  })
})
