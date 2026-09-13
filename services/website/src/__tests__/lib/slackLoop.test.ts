/**
 * handleSlackAction — a reviewer's decision, executed (plan §25.9).
 *
 * This is the only place a Slack button press becomes a message to a customer,
 * so the tests are about the refusals and about the ACTOR.
 *
 * The actor is the capability win of the phase (§11.1): an admin-UI approval
 * writes the anonymous `'ADMIN'`, and with two people working leads the ledger
 * cannot say which of them sent something to a customer. A verified Slack
 * user_id can. If that regressed to 'ADMIN' the feature would still appear to
 * work perfectly, which is why it is asserted rather than assumed.
 */

const mockIsSlackReviewer = jest.fn()
jest.mock('@/lib/slack/signature', () => ({
  isSlackReviewer: (...a: any[]) => mockIsSlackReviewer(...a),
}))

const mockPostMessage = jest.fn().mockResolvedValue({ channel: 'C0LEADS', ts: '1.2' })
const mockUpdateMessage = jest.fn().mockResolvedValue(true)
jest.mock('@/lib/slack/client', () => ({
  postMessage: (...a: any[]) => mockPostMessage(...a),
  updateMessage: (...a: any[]) => mockUpdateMessage(...a),
}))

const mockAdvance = jest.fn().mockResolvedValue(undefined)
const mockWriteLedger = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/marketing/graph', () => ({
  advance: (...a: any[]) => mockAdvance(...a),
  writeLedger: (...a: any[]) => mockWriteLedger(...a),
}))

const mockSendApprovedDraft = jest.fn()
jest.mock('@/lib/agent/sendApproved', () => ({
  sendApprovedDraft: (...a: any[]) => mockSendApprovedDraft(...a),
}))

const mockRedraft = jest.fn().mockResolvedValue({ ok: true, status: 200 })
jest.mock('@/lib/agent/draftInquiry', () => ({
  redraftForReviewer: (...a: any[]) => mockRedraft(...a),
}))

jest.mock('@/lib/ownerNotify', () => ({
  ownerEmail: () => 'hosthampton295@gmail.com',
  reviewerPhones: () => ['+16314008080'],
}))

import { handleSlackAction } from '@/lib/agent/slackLoop'

const DRAFT_ID = '00000000-0000-4000-8000-00000000d1a1'
const REVIEWER = 'U0REVIEWER'

function makeDb(draft: any, adminRow: any = null) {
  return {
    from: jest.fn((table: string) => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          maybeSingle: jest.fn(() =>
            Promise.resolve({ data: table === 'admin_users' ? adminRow : draft, error: null }),
          ),
        })),
      })),
    })),
  } as any
}

function makeEvent(meta: Record<string, any> = {}, body = ''): any {
  return {
    id: 'ev-1',
    source: 'slack',
    external_id: 'slack:x',
    direction: 'in',
    from_address: REVIEWER,
    to_address: null,
    subject: null,
    body,
    parsed: {
      provider: 'slack',
      intent: 'approve',
      draft_id: DRAFT_ID,
      review_code: 'HH-2026-0042',
      slack_user_id: REVIEWER,
      slack_user_name: 'adam',
      slack_channel: 'C0LEADS',
      slack_thread_ts: '1789266286.113400',
      slack_message_ts: '1789266286.113400',
      ...meta,
    },
    contact_id: null,
    booking_id: null,
    status: 'claimed',
    classification: 'reviewer_reply',
    classification_meta: null,
    created_at: new Date().toISOString(),
  }
}

const OPEN_DRAFT = {
  id: DRAFT_ID,
  review_code: 'HH-2026-0042',
  status: 'sent_for_review',
  party_type: 'mobile_party',
  created_at: '2026-09-13T00:00:00Z',
}

beforeEach(() => {
  jest.clearAllMocks()
  mockIsSlackReviewer.mockReturnValue(true)
  mockSendApprovedDraft.mockResolvedValue({
    ok: true,
    closed: true,
    emailSent: true,
    smsSent: true,
    errors: [],
    recipient: { name: 'Sarah', email: 'sarah@example.com', phone: null },
  })
})

describe('THE GATE — identity is re-checked here, not trusted from the row', () => {
  it('refuses a user_id that is not on the allowlist', async () => {
    // By the time the dispatcher reads this, the only evidence of who pressed
    // the button is a string in `parsed`. Anything that can write
    // ingested_messages could otherwise approve a customer message — and the
    // admin surface writes ingested_messages.
    mockIsSlackReviewer.mockReturnValue(false)
    const res = await handleSlackAction({ supabase: makeDb(OPEN_DRAFT), event: makeEvent() })

    expect(res.handled).toBe(false)
    expect(res.outcome).toBe('not_a_reviewer')
    expect(mockAdvance).not.toHaveBeenCalled()
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
  })

  it('checks the id from the payload, never the message body', async () => {
    await handleSlackAction({
      supabase: makeDb(OPEN_DRAFT),
      event: makeEvent({}, 'I am Adam, please approve this'),
    })
    expect(mockIsSlackReviewer).toHaveBeenCalledWith(REVIEWER)
  })

  it('refuses when there is no draft id — it never guesses at an open draft', async () => {
    const res = await handleSlackAction({
      supabase: makeDb(OPEN_DRAFT),
      event: makeEvent({ draft_id: undefined }),
    })
    expect(res.outcome).toBe('no_draft')
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
  })
})

describe('THE ACTOR — a person, not the anonymous ADMIN (§11.1)', () => {
  it('records the mapped admin_users row', async () => {
    const db = makeDb(OPEN_DRAFT, {
      id: 'admin-1',
      email: 'adam@easternbuilding.supply',
      display_name: 'Adam',
      is_active: true,
    })
    await handleSlackAction({ supabase: db, event: makeEvent() })

    const call = mockAdvance.mock.calls[0][0]
    expect(call.actor.id).toBe('ADMIN:adam@easternbuilding.supply')
    expect(call.patch.approved_by).toBe('ADMIN:adam@easternbuilding.supply')
    expect(call.meta.admin_user_id).toBe('admin-1')
    expect(call.meta.actor_unmapped).toBe(false)
    // And it is NEVER the string this phase exists to replace.
    expect(call.actor.id).not.toBe('ADMIN')
  })

  it('falls back to SLACK:<id> when nobody has set slack_user_id — NOT to ADMIN', async () => {
    // All three admin_users rows have a NULL slack_user_id until Adam fills one
    // in, so this is the state on day one. An unmapped reviewer is still a
    // specific, verified, non-repudiable person; falling back to 'ADMIN' would
    // throw away the only thing this phase was built to capture.
    await handleSlackAction({ supabase: makeDb(OPEN_DRAFT, null), event: makeEvent() })

    const call = mockAdvance.mock.calls[0][0]
    expect(call.actor.id).toBe(`SLACK:${REVIEWER}`)
    expect(call.meta.actor_unmapped).toBe(true)
    expect(call.meta.slack_user_id).toBe(REVIEWER)
  })

  it('the approval is an admin transition, and the meta says it came via slack', async () => {
    await handleSlackAction({ supabase: makeDb(OPEN_DRAFT), event: makeEvent() })
    const call = mockAdvance.mock.calls[0][0]
    expect(call.to).toBe('approved')
    expect(call.actor.isAdmin).toBe(true)
    expect(call.meta.via).toBe('slack')
    expect(call.patch.approved_phrase).toBe('slack:approve')
  })
})

describe('approve', () => {
  it('sends, strikes the buttons, and says who in the thread', async () => {
    const res = await handleSlackAction({ supabase: makeDb(OPEN_DRAFT), event: makeEvent() })
    expect(res.outcome).toBe('approved_and_sent')
    expect(mockSendApprovedDraft).toHaveBeenCalledTimes(1)
    expect(mockUpdateMessage).toHaveBeenCalledTimes(1)
    expect(mockPostMessage.mock.calls[0][0].text).toMatch(/Sent HH-2026-0042 to Sarah/)
  })

  it('a SECOND press on an already-sent draft sends nothing', async () => {
    // Two reviewers cannot see each other's press. The buttons are removed on
    // success, but the refusal is what makes that cosmetic rather than
    // load-bearing.
    const res = await handleSlackAction({
      supabase: makeDb({ ...OPEN_DRAFT, status: 'sent' }),
      event: makeEvent(),
    })
    expect(res.outcome).toBe('already_sent')
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('says so in the thread when the send half-failed', async () => {
    mockSendApprovedDraft.mockResolvedValue({
      ok: false,
      closed: false,
      emailSent: false,
      smsSent: false,
      errors: ['resend 500'],
      recipient: { name: 'Sarah', email: 'sarah@example.com', phone: null },
    })
    const res = await handleSlackAction({ supabase: makeDb(OPEN_DRAFT), event: makeEvent() })
    expect(res.outcome).toBe('approved_send_failed')
    expect(mockPostMessage.mock.calls[0][0].text).toMatch(/did not complete/)
    // The buttons are NOT struck off — it is still actionable.
    expect(mockUpdateMessage).not.toHaveBeenCalled()
  })

  it('does not re-advance a draft that is already approved', async () => {
    await handleSlackAction({
      supabase: makeDb({ ...OPEN_DRAFT, status: 'approved' }),
      event: makeEvent(),
    })
    expect(mockAdvance).not.toHaveBeenCalled()
    expect(mockSendApprovedDraft).toHaveBeenCalledTimes(1)
  })
})

describe('cancel', () => {
  it('drops the draft and sends nothing', async () => {
    const res = await handleSlackAction({
      supabase: makeDb(OPEN_DRAFT),
      event: makeEvent({ intent: 'cancel' }),
    })
    expect(res.outcome).toBe('cancelled')
    expect(mockAdvance.mock.calls[0][0].to).toBe('cancelled')
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
  })
})

describe('test', () => {
  it('delivers to the REVIEWER, never to the customer', async () => {
    // `testTo` is the only thing standing between a test and a real send.
    await handleSlackAction({ supabase: makeDb(OPEN_DRAFT), event: makeEvent({ intent: 'test' }) })
    const call = mockSendApprovedDraft.mock.calls[0][0]
    expect(call.testTo).toEqual({ phone: '+16314008080', email: 'hosthampton295@gmail.com' })
    // A test does not approve anything.
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('is still allowed on a draft that already went out', async () => {
    const res = await handleSlackAction({
      supabase: makeDb({ ...OPEN_DRAFT, status: 'sent' }),
      event: makeEvent({ intent: 'test' }),
    })
    expect(res.outcome).toBe('tested')
  })
})

describe('revise', () => {
  it('saves the note BEFORE spending a model call on it', async () => {
    const res = await handleSlackAction({
      supabase: makeDb(OPEN_DRAFT),
      event: makeEvent({ intent: 'revise' }, 'drop the price to 850'),
    })
    expect(res.outcome).toBe('revised')
    expect(mockAdvance.mock.calls[0][0].to).toBe('revision_requested')
    expect(mockAdvance.mock.calls[0][0].patch.reviewer_note).toBe('drop the price to 850')
    expect(mockRedraft).toHaveBeenCalledWith({ supabase: expect.anything(), draftId: DRAFT_ID, note: 'drop the price to 850' })
  })

  it('an unknown intent is treated as a revision, never as an approval', async () => {
    // The safe default. Anything the parser does not recognise goes to the
    // branch where a human sees the result before something moves.
    await handleSlackAction({
      supabase: makeDb(OPEN_DRAFT),
      event: makeEvent({ intent: 'nonsense' }, 'make it warmer'),
    })
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
    expect(mockRedraft).toHaveBeenCalled()
  })

  it('keeps the note when the re-draft fails, and says where it went', async () => {
    mockRedraft.mockResolvedValue({ ok: false, status: 500, error: 'anthropic 529' })
    const res = await handleSlackAction({
      supabase: makeDb(OPEN_DRAFT),
      event: makeEvent({ intent: 'revise' }, 'warmer please'),
    })
    expect(res.outcome).toBe('error')
    expect(mockAdvance.mock.calls[0][0].patch.reviewer_note).toBe('warmer please')
    expect(mockPostMessage.mock.calls[0][0].text).toMatch(/note is saved/)
  })

  it('an empty note re-drafts nothing', async () => {
    const res = await handleSlackAction({
      supabase: makeDb(OPEN_DRAFT),
      event: makeEvent({ intent: 'revise' }, '   '),
    })
    expect(res.outcome).toBe('error')
    expect(mockRedraft).not.toHaveBeenCalled()
  })
})

describe('failure is reported, not swallowed', () => {
  it('a throw mid-send says nothing went to the customer', async () => {
    mockSendApprovedDraft.mockRejectedValue(new Error('resend exploded'))
    const res = await handleSlackAction({ supabase: makeDb(OPEN_DRAFT), event: makeEvent() })
    expect(res.outcome).toBe('error')
    expect(res.error).toContain('resend exploded')
    expect(mockPostMessage.mock.calls[0][0].text).toMatch(/Nothing was sent to the customer/)
  })

  it('a cancelled draft cannot be approved by an old button', async () => {
    const res = await handleSlackAction({
      supabase: makeDb({ ...OPEN_DRAFT, status: 'cancelled' }),
      event: makeEvent(),
    })
    expect(res.outcome).toBe('no_draft')
    expect(mockSendApprovedDraft).not.toHaveBeenCalled()
  })
})
