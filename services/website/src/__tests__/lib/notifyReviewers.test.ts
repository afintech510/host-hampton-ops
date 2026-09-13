/**
 * The reviewer delivery seam (plan §25.5, §25.9).
 *
 * The test that matters most in this file is "Slack is down and the SMS still
 * goes out". Everything else is arithmetic.
 *
 * That one is not a robustness nicety: §18's Eleonore failure was a real lead
 * sitting unanswered because nothing texted anybody, found only by Adam
 * noticing the ABSENCE of a text. A lead going quiet because Slack had a bad
 * afternoon is that same failure with a new cause, so every way Slack can fail
 * is exercised here and each one is asserted to still produce a text.
 */

import { smsEncodingOf, smsSegmentInfo } from '@/lib/smsSegments'

const mockNotifyOwnerSms = jest.fn().mockResolvedValue(2)
jest.mock('@/lib/ownerNotify', () => ({
  notifyOwnerSms: (...a: any[]) => mockNotifyOwnerSms(...a),
  reviewerPhones: () => ['+16314008080'],
  ownerEmail: () => 'hosthampton295@gmail.com',
}))

const mockPostMessage = jest.fn()
const mockGetPermalink = jest.fn()
jest.mock('@/lib/slack/client', () => ({
  postMessage: (...a: any[]) => mockPostMessage(...a),
  getPermalink: (...a: any[]) => mockGetPermalink(...a),
  slackConfigured: () => !!process.env.SLACK_BOT_TOKEN && !!process.env.SLACK_LEADS_CHANNEL,
}))

const mockCreateShortLink = jest.fn()
jest.mock('@/lib/shortLink', () => ({
  createShortLink: (...a: any[]) => mockCreateShortLink(...a),
}))

import { notifyReviewers, reviewerChannel, reviewerPingBody } from '@/lib/agent/notifyReviewers'

const DRAFT_ID = '00000000-0000-4000-8000-00000000d1a1'
const SHORT = 'https://hosthampton.com/s/8Kq2mXp7Ld3Rw9vTnY4bZc'

/** Captures the update() that persists slack_channel/slack_ts. */
function makeDb() {
  const updates: any[] = []
  return {
    updates,
    db: {
      from: jest.fn(() => ({
        update: jest.fn((patch: any) => {
          updates.push(patch)
          return { eq: jest.fn(() => Promise.resolve({ error: null })) }
        }),
        select: jest.fn(() => ({
          eq: jest.fn(() => ({ maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: null })) })),
        })),
      })),
    } as any,
  }
}

function input(extra: Record<string, any> = {}) {
  const { db } = makeDb()
  return {
    supabase: db,
    draftId: DRAFT_ID,
    reviewCode: 'HH-2026-0042',
    partyType: 'mobile_party',
    path: 'quote' as const,
    summary: 'Sarah, Oct 12, 24 guests, at-home glitter bar',
    emailDraft: 'Hi Sarah,\n\nThanks for reaching out...',
    smsDraft: 'Hi Sarah! Thanks for reaching out...',
    missing: [],
    previewToken: 'HH-2026-0042.abcdef1234567890',
    smsBody:
      '[HH-2026-0042 - mobile party] quote draft ready\nSarah, Oct 12, 24 guests\n' +
      'Review: https://www.hosthampton.com/review/HH-2026-0042.abcdef1234567890\n' +
      'Reply SEND, CANCEL, TEST, or say what to change. (Nothing has gone to the customer.)',
    secret: 'test-secret',
    ...extra,
  }
}

const ENV = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ENV }
  process.env.SLACK_BOT_TOKEN = 'xoxb-test'
  process.env.SLACK_LEADS_CHANNEL = 'C0LEADS'
  mockNotifyOwnerSms.mockResolvedValue(2)
  mockPostMessage.mockResolvedValue({ channel: 'C0LEADS', ts: '1789266286.113400' })
  mockGetPermalink.mockResolvedValue('https://hosthampton.slack.com/archives/C0LEADS/p1789266286113400')
  mockCreateShortLink.mockResolvedValue({ code: 'x'.repeat(22), hash: 'h', url: SHORT })
})

afterEach(() => {
  process.env = ENV
})

describe('REVIEWER_CHANNEL', () => {
  it('defaults to sms when unset', () => {
    delete process.env.REVIEWER_CHANNEL
    expect(reviewerChannel()).toBe('sms')
  })

  it('reads slack and both', () => {
    process.env.REVIEWER_CHANNEL = 'slack'
    expect(reviewerChannel()).toBe('slack')
    process.env.REVIEWER_CHANNEL = 'BOTH'
    expect(reviewerChannel()).toBe('both')
  })

  it('a TYPO falls back to sms, not to silence', () => {
    // The direction is deliberate: a fat-fingered env var must not be able to
    // switch off the channel that is known to work.
    process.env.REVIEWER_CHANNEL = 'slcak'
    expect(reviewerChannel()).toBe('sms')
  })
})

describe('REVIEWER_CHANNEL=sms — unchanged behaviour', () => {
  it('texts the full body and never touches Slack', async () => {
    process.env.REVIEWER_CHANNEL = 'sms'
    const res = await notifyReviewers(input())
    expect(mockPostMessage).not.toHaveBeenCalled()
    expect(mockNotifyOwnerSms).toHaveBeenCalledTimes(1)
    expect(mockNotifyOwnerSms.mock.calls[0][0]).toContain('/review/')
    expect(res.reviewersTexted).toBe(2)
    expect(res.smsLink).toBe('review')
  })
})

describe('REVIEWER_CHANNEL=slack — the happy path', () => {
  beforeEach(() => {
    process.env.REVIEWER_CHANNEL = 'slack'
  })

  it('posts, permalinks, shortens, then pings — in that order', async () => {
    const order: string[] = []
    mockPostMessage.mockImplementation(async () => {
      order.push('post')
      return { channel: 'C0LEADS', ts: '1789266286.113400' }
    })
    mockGetPermalink.mockImplementation(async () => {
      order.push('permalink')
      return 'https://hosthampton.slack.com/archives/C0LEADS/p1789266286113400'
    })
    mockCreateShortLink.mockImplementation(async () => {
      order.push('short')
      return { code: 'x'.repeat(22), hash: 'h', url: SHORT }
    })
    mockNotifyOwnerSms.mockImplementation(async () => {
      order.push('sms')
      return 2
    })

    const res = await notifyReviewers(input())
    expect(order).toEqual(['post', 'permalink', 'short', 'sms'])
    expect(res.smsLink).toBe('slack')
    expect(mockNotifyOwnerSms.mock.calls[0][0]).toContain(SHORT)
  })

  it('mints the short link with kind slack, against the draft', async () => {
    await notifyReviewers(input())
    expect(mockCreateShortLink.mock.calls[0][1]).toMatchObject({
      kind: 'slack',
      entityType: 'inquiry_draft',
      entityId: DRAFT_ID,
      target: 'https://hosthampton.slack.com/archives/C0LEADS/p1789266286113400',
    })
  })

  it('persists slack_channel and slack_ts so revisions reply in-thread', async () => {
    const { db, updates } = makeDb()
    await notifyReviewers(input({ supabase: db }))
    expect(updates).toEqual([{ slack_channel: 'C0LEADS', slack_ts: '1789266286.113400' }])
  })

  it('does NOT move slack_ts when replying INTO a thread', async () => {
    // The stored ts is the THREAD KEY. Overwriting it with a reply's own ts
    // would leave /api/slack/events unable to find this lead's draft, and the
    // symptom would be "thread replies stopped working, but only on leads that
    // had been revised" — which is a horrible thing to debug.
    const { db, updates } = makeDb()
    mockPostMessage.mockResolvedValue({ channel: 'C0LEADS', ts: '1789299999.000100' })
    await notifyReviewers(input({ supabase: db, threadTs: '1789266286.113400', revision: true }))
    expect(updates).toEqual([])
    expect(mockPostMessage.mock.calls[0][0].threadTs).toBe('1789266286.113400')
  })
})

describe('THE RULE: the SMS always sends (§18)', () => {
  beforeEach(() => {
    process.env.REVIEWER_CHANNEL = 'slack'
  })

  it('chat.postMessage failing still texts, and the text carries /review/', async () => {
    mockPostMessage.mockResolvedValue(null)
    const res = await notifyReviewers(input())

    expect(mockNotifyOwnerSms).toHaveBeenCalledTimes(1)
    const body = mockNotifyOwnerSms.mock.calls[0][0]
    expect(body).toContain('/review/')
    // And NOT a broken short link — nothing was minted, so nothing can be in it.
    expect(body).not.toContain('/s/')
    expect(res.reviewersTexted).toBe(2)
    expect(res.smsLink).toBe('review')
    expect(res.warnings).toContain('Slack post failed')
  })

  it('chat.postMessage THROWING still texts', async () => {
    // The client is fail-soft by contract — but a contract is a comment until
    // something asserts the CALLER survives it being broken. This deliberately
    // breaks it. "The SMS always sends" has to be a property of this file, not
    // a property of this file given a property of another one.
    mockPostMessage.mockRejectedValue(new Error('socket hang up'))
    const res = await notifyReviewers(input())
    expect(mockNotifyOwnerSms).toHaveBeenCalledTimes(1)
    expect(mockNotifyOwnerSms.mock.calls[0][0]).toContain('/review/')
    expect(res.reviewersTexted).toBe(2)
    expect(res.smsLink).toBe('review')
  })

  it('getPermalink THROWING still texts', async () => {
    mockGetPermalink.mockRejectedValue(new Error('ETIMEDOUT'))
    const res = await notifyReviewers(input())
    expect(mockNotifyOwnerSms.mock.calls[0][0]).toContain('/review/')
    expect(res.smsLink).toBe('review')
    // The post still landed, so the thread is still usable even though the
    // ping degraded.
    expect(res.slack).toEqual({ channel: 'C0LEADS', ts: '1789266286.113400' })
  })

  it('the slack_ts write THROWING still texts', async () => {
    const db = {
      from: jest.fn(() => ({
        update: jest.fn(() => ({
          eq: jest.fn(() => Promise.reject(new Error('supabase timeout'))),
        })),
      })),
    } as any
    const res = await notifyReviewers(input({ supabase: db }))
    expect(mockNotifyOwnerSms).toHaveBeenCalledTimes(1)
    expect(res.reviewersTexted).toBe(2)
  })

  it('getPermalink failing still texts, with /review/', async () => {
    mockGetPermalink.mockResolvedValue(null)
    const res = await notifyReviewers(input())
    expect(mockNotifyOwnerSms.mock.calls[0][0]).toContain('/review/')
    expect(res.smsLink).toBe('review')
    expect(res.warnings).toContain('chat.getPermalink failed')
    // The post still happened and is still threaded — only the ping degraded.
    expect(res.slack).toEqual({ channel: 'C0LEADS', ts: '1789266286.113400' })
  })

  it('the short link failing falls back to /review/ rather than a raw permalink', async () => {
    // A raw permalink is ~78 characters and would push the ping into a second
    // segment, which is the cost this whole phase exists to remove. The
    // /review/ link is both shorter and the documented fallback.
    mockCreateShortLink.mockResolvedValue(null)
    const res = await notifyReviewers(input())
    const body = mockNotifyOwnerSms.mock.calls[0][0]
    expect(body).toContain('/review/')
    expect(body).not.toContain('slack.com')
    expect(res.smsLink).toBe('review')
  })

  it('an unconfigured Slack falls back loudly instead of going quiet', async () => {
    delete process.env.SLACK_BOT_TOKEN
    const res = await notifyReviewers(input())
    expect(mockPostMessage).not.toHaveBeenCalled()
    expect(mockNotifyOwnerSms).toHaveBeenCalledTimes(1)
    expect(res.warnings.join(' ')).toMatch(/SLACK_BOT_TOKEN/)
  })
})

describe('REVIEWER_CHANNEL=both — the escape hatch', () => {
  it('posts to Slack AND sends the full SMS body', async () => {
    process.env.REVIEWER_CHANNEL = 'both'
    const res = await notifyReviewers(input())
    expect(mockPostMessage).toHaveBeenCalledTimes(1)
    expect(mockNotifyOwnerSms.mock.calls[0][0]).toContain('Reply SEND, CANCEL, TEST')
    expect(res.smsLink).toBe('review')
  })
})

describe('the ping is one GSM-7 segment (§25.9)', () => {
  const ping = (summary: string, code = 'HH-2026-0042', partyType = 'mobile_party') =>
    reviewerPingBody({ reviewCode: code, partyType, summary, url: SHORT })

  it('is GSM-7, not UCS-2', () => {
    expect(smsEncodingOf(ping('Sarah, Oct 12, 24 guests'))).toBe('GSM-7')
  })

  it('is one segment on a realistic summary', () => {
    expect(smsSegmentInfo(ping('Sarah, Oct 12, 24 guests, at-home glitter bar')).segments).toBe(1)
  })

  it('stays one segment when the summary is absurdly long', () => {
    const info = smsSegmentInfo(ping('x'.repeat(500)))
    expect(info.segments).toBe(1)
    expect(info.encoding).toBe('GSM-7')
  })

  it('NEVER truncates the link — a cut URL looks like it worked', () => {
    expect(ping('x'.repeat(500))).toContain(SHORT)
    expect(ping('')).toContain(SHORT)
  })

  it('counts GSM-7 UNITS, not characters', () => {
    // `{`, `}`, `[`, `]`, `~`, `^`, `\` and `|` cost TWO units each in GSM-7.
    // A length-based trim would under-count a summary full of them and quietly
    // produce the two-segment message this function exists to prevent.
    const bracketed = ping('[' .repeat(400))
    expect(smsSegmentInfo(bracketed).segments).toBe(1)
  })

  it('folds a curly apostrophe rather than paying UCS-2 for it', () => {
    // A model writes "kid's" with U+2019 without being asked. One of those
    // flips the whole message from 160 characters a segment to 67.
    const body = ping('Sarah’s kid’s party — Oct 12')
    expect(smsEncodingOf(body)).toBe('GSM-7')
    expect(smsSegmentInfo(body).segments).toBe(1)
  })

  it('drops the summary before it drops the code or the link', () => {
    const body = reviewerPingBody({
      reviewCode: 'HH-2026-0042',
      partyType: 'an_absurdly_long_party_type_name_that_eats_the_whole_budget_and_then_some_more',
      summary: 'this summary has nowhere to go',
      url: SHORT,
    })
    expect(body).toContain('HH-2026-0042')
    expect(body).toContain(SHORT)
    expect(body).not.toContain('nowhere to go')
  })

  it('says DRAFT HELD for a parked draft', () => {
    const body = reviewerPingBody({
      reviewCode: 'HH-2026-0042',
      partyType: 'mobile_party',
      summary: 'Sarah, Oct 12',
      url: SHORT,
      parked: true,
    })
    expect(body).toContain('DRAFT HELD')
    expect(smsEncodingOf(body)).toBe('GSM-7')
  })
})
