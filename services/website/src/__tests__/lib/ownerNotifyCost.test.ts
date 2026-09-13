/**
 * Plan §21.2 / §21.9 — an owner SMS is GSM-7, and it is cheap.
 *
 * These assert on the REAL output of the real builders. The defect they exist
 * to prevent was invisible for exactly this reason: `lib/smsSegments.ts` had
 * computed the right answer since §20 and nothing ever called it on a body we
 * actually send, so ' · ' sat in `leadSmsLine` billing 2.3x across sixteen call
 * sites with every test in the suite green.
 */

import { gsm7Sanitize, smsEncodingOf, smsSegmentInfo } from '@/lib/smsSegments'
import { leadSmsLine, prepareOwnerSms } from '@/lib/ownerNotify'
import { reviewerSmsBody, parkedSmsBody } from '@/lib/agent/draftInquiry'

const TOKEN = `HH-2026-0042.${'a'.repeat(64)}`

describe('gsm7Sanitize', () => {
  it('converts the characters that actually cost us money', () => {
    expect(gsm7Sanitize('a · b')).toBe('a - b')
    expect(gsm7Sanitize('⚠ held')).toBe('!! held')
    expect(gsm7Sanitize('one — two – three')).toBe('one - two - three')
    expect(gsm7Sanitize('kid’s party')).toBe("kid's party")
    expect(gsm7Sanitize('“quoted”')).toBe('"quoted"')
    expect(gsm7Sanitize('wait…')).toBe('wait...')
  })

  it('keeps characters that are already legal GSM-7', () => {
    // é, ö, ü, à, £ and € are all in the alphabet. Folding them would be a
    // needless mangling of a real name. (ë is NOT — GSM-03.38 is a specific
    // 128-character set, not "Latin-1", and this test asserting otherwise is
    // how that got established rather than assumed.)
    const s = 'José paid £20 and €5 für Zöe'
    expect(gsm7Sanitize(s)).toBe(s)
    expect(smsEncodingOf(gsm7Sanitize(s))).toBe('GSM-7')
  })

  it('folds a diacritic it cannot spend instead of deleting the letter', () => {
    // The failure this pass exists to avoid is 'Zo Kovai'.
    expect(gsm7Sanitize('Zoë Kovačić')).toBe('Zoe Kovacic')
    expect(gsm7Sanitize('Łukasz Nowak')).toContain('ukasz Nowak')
  })

  it('drops what it cannot render at all', () => {
    expect(gsm7Sanitize('done ✨🎉')).toBe('done ')
    expect(smsEncodingOf(gsm7Sanitize('done ✨🎉'))).toBe('GSM-7')
  })

  it('is idempotent and total — any input comes back GSM-7', () => {
    for (const s of ['', 'plain', '· ⚠ — … ’ ✨', 'Zoë', '🎂🎈']) {
      const once = gsm7Sanitize(s)
      expect(gsm7Sanitize(once)).toBe(once)
      if (once) expect(smsEncodingOf(once)).toBe('GSM-7')
    }
  })
})

describe('owner SMS bodies are GSM-7', () => {
  it('leadSmsLine — the separator that cost 2.3x on sixteen call sites', () => {
    const line = leadSmsLine({
      kind: 'MOBILE party inquiry',
      name: 'Sarah Klein',
      phone: '+16315551212',
      email: 'sarah@example.com',
      date: '2026-10-12',
      guests: 24,
    })
    expect(line).not.toContain('·')
    expect(smsEncodingOf(line)).toBe('GSM-7')
    expect(smsSegmentInfo(line).segments).toBeLessThanOrEqual(2)
  })

  it('reviewerSmsBody', () => {
    const body = reviewerSmsBody({
      reviewCode: 'HH-2026-0042',
      partyType: 'mobile_party',
      path: 'quote',
      summary: 'Sarah Klein, Oct 12, 24 guests, mobile craft party in Sag Harbor.',
      missing: [],
      previewToken: TOKEN,
    })
    expect(smsEncodingOf(body)).toBe('GSM-7')
  })

  it('reviewerSmsBody with a guardrail warning', () => {
    const body = reviewerSmsBody({
      reviewCode: 'HH-2026-0042',
      partyType: 'mobile_party',
      path: 'quote',
      summary: 'Sarah Klein, Oct 12.',
      missing: ['party_time'],
      previewToken: TOKEN,
      warning: 'draft names a payment handle we do not use',
    })
    expect(body).toContain('CHECK THIS')
    expect(body).not.toContain('⚠')
    expect(smsEncodingOf(body)).toBe('GSM-7')
  })

  it('parkedSmsBody', () => {
    const body = parkedSmsBody({
      reviewCode: 'HH-2026-0042',
      partyType: 'mobile_party',
      reason: 'draft quoted a price on an info-gather path',
      summary: 'Sarah Klein, Oct 12, 24 guests.',
      previewToken: TOKEN,
    })
    expect(body).toMatch(/DRAFT HELD/)
    expect(smsEncodingOf(body)).toBe('GSM-7')
  })
})

describe('reviewer SMS cost', () => {
  it('a realistic reviewer body is at most 3 segments', () => {
    const body = reviewerSmsBody({
      reviewCode: 'HH-2026-0042',
      partyType: 'mobile_party',
      path: 'quote',
      summary: 'Sarah Klein, Oct 12, 24 guests, mobile craft party in Sag Harbor. Asked about add-ons and whether we travel that far.',
      missing: ['party_time', 'venue_address'],
      previewToken: TOKEN,
    })
    // Before §21.2 this was ~12 segments: UCS-2 at 67/segment, carrying the
    // whole draft inline alongside the link that already renders it.
    expect(smsSegmentInfo(body).segments).toBeLessThanOrEqual(3)
  })

  it('no longer duplicates the draft that the review link already renders', () => {
    const body = reviewerSmsBody({
      reviewCode: 'HH-2026-0042',
      partyType: 'mobile_party',
      path: 'quote',
      summary: 'Sarah Klein, Oct 12.',
      missing: [],
      previewToken: TOKEN,
    })
    expect(body).not.toContain('SMS: ')
    expect(body).toContain('/review/')
  })
})

describe('prepareOwnerSms', () => {
  const origEnv = process.env
  let errSpy: jest.SpyInstance
  let logSpy: jest.SpyInstance
  beforeEach(() => {
    process.env = { ...origEnv }
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    process.env = origEnv
    errSpy.mockRestore()
    logSpy.mockRestore()
  })

  it('sanitises before truncating, and truncates with "..." not "…"', () => {
    // The old marker was itself non-GSM: the guard against a long message was
    // doubling the bill on precisely the messages it fired on.
    const out = prepareOwnerSms('·'.repeat(2000))
    expect(out.endsWith('...')).toBe(true)
    expect(out).toHaveLength(1500)
    expect(smsEncodingOf(out)).toBe('GSM-7')
  })

  it('logs the segment count on every send', () => {
    prepareOwnerSms('a short one', 2)
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[sms-cost] 1 seg x 2 recipient(s)'))
  })

  it('errors above the threshold, so an expensive body cannot be silent', () => {
    prepareOwnerSms('x'.repeat(700))
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[sms-cost] 5 seg'))
  })

  it('honours SMS_SEGMENT_WARN', () => {
    process.env.SMS_SEGMENT_WARN = '10'
    prepareOwnerSms('x'.repeat(700))
    expect(errSpy).not.toHaveBeenCalled()
  })
})
