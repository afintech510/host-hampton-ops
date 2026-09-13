/**
 * POST /api/slack/interactions and /api/slack/events (plan §25.9).
 *
 * These are public URLs whose job is to start an approval that sends a real
 * message to a real customer. The tests that matter are the refusals:
 *
 *   - an unsigned request                        → 401
 *   - an unset SLACK_SIGNING_SECRET              → 401, never a skip
 *   - a signed request from a user who is not on
 *     SLACK_REVIEWER_USER_IDS                    → nothing is queued
 *
 * The last one is §4.2 restated for a new channel: identity comes from the
 * channel-verified sender, never from content. A verified stranger is still a
 * stranger.
 */

import crypto from 'crypto'

const SECRET = 'slack-test-signing-secret'
const REVIEWER = 'U0REVIEWER'
const STRANGER = 'U0STRANGER'
const DRAFT_ID = '00000000-0000-4000-8000-00000000d1a1'

const mockRecordInboundEvent = jest.fn().mockResolvedValue('event-1')
jest.mock('@/lib/agent/events', () => ({
  recordInboundEvent: (...a: any[]) => mockRecordInboundEvent(...a),
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

const mockOpenView = jest.fn().mockResolvedValue(true)
const mockRespond = jest.fn().mockResolvedValue(true)
const mockPostMessage = jest.fn().mockResolvedValue({ channel: 'C0LEADS', ts: '1.2' })
jest.mock('@/lib/slack/client', () => ({
  openView: (...a: any[]) => mockOpenView(...a),
  respondToInteraction: (...a: any[]) => mockRespond(...a),
  postMessage: (...a: any[]) => mockPostMessage(...a),
  slackLeadsChannel: () => process.env.SLACK_LEADS_CHANNEL || '',
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: class {
    status: number
    body: any
    constructor(body: any, init?: any) {
      this.body = body
      this.status = init?.status || 200
    }
    static json(body: any, init?: any) {
      return { status: init?.status || 200, body, json: () => body }
    }
  },
}))

import { POST as interactionsPOST } from '@/app/api/slack/interactions/route'
import { POST as eventsPOST } from '@/app/api/slack/events/route'
import { ACTION_APPROVE, ACTION_EDIT, encodeActionValue } from '@/lib/slack/blocks'

function sign(body: string, ts: string, secret = SECRET): string {
  return 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${body}`).digest('hex')
}

function makeReq(rawBody: string, opts: { ts?: string; sig?: string; secret?: string } = {}) {
  const ts = opts.ts ?? String(Math.floor(Date.now() / 1000))
  const sig = opts.sig ?? sign(rawBody, ts, opts.secret ?? SECRET)
  const headers: Record<string, string> = {
    'x-slack-signature': sig,
    'x-slack-request-timestamp': ts,
  }
  return {
    text: jest.fn().mockResolvedValue(rawBody),
    headers: { get: jest.fn((k: string) => headers[k.toLowerCase()] ?? null) },
  } as any
}

/** Slack posts interactions form-encoded with a `payload` field. */
function interaction(payload: Record<string, any>): string {
  return new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
}

function buttonPress(userId: string, actionId = ACTION_APPROVE): Record<string, any> {
  return {
    type: 'block_actions',
    user: { id: userId, username: 'adam' },
    trigger_id: 'trigger-123',
    response_url: 'https://hooks.slack.com/actions/T0/1/abc',
    channel: { id: 'C0LEADS' },
    message: { ts: '1789266286.113400' },
    actions: [
      {
        action_id: actionId,
        action_ts: '1789266400.000100',
        value: encodeActionValue({ draftId: DRAFT_ID, reviewCode: 'HH-2026-0042' }),
      },
    ],
  }
}

const ENV = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...ENV }
  process.env.SLACK_SIGNING_SECRET = SECRET
  process.env.SLACK_REVIEWER_USER_IDS = REVIEWER
  process.env.SLACK_LEADS_CHANNEL = 'C0LEADS'
  mockRecordInboundEvent.mockResolvedValue('event-1')
})

afterEach(() => {
  process.env = ENV
})

describe('POST /api/slack/interactions — the signature', () => {
  it('rejects an unsigned request', async () => {
    const body = interaction(buttonPress(REVIEWER))
    const res: any = await interactionsPOST(makeReq(body, { sig: 'v0=deadbeef' }))
    expect(res.status).toBe(401)
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('rejects a TAMPERED body — the signature covers the bytes', async () => {
    const signed = interaction(buttonPress(REVIEWER))
    const ts = String(Math.floor(Date.now() / 1000))
    const sig = sign(signed, ts)
    // Same signature, a different draft id in the body.
    const tampered = interaction({
      ...buttonPress(REVIEWER),
      actions: [
        {
          action_id: ACTION_APPROVE,
          action_ts: '1',
          value: encodeActionValue({ draftId: 'someone-elses-draft', reviewCode: 'HH-2026-9999' }),
        },
      ],
    })
    const res: any = await interactionsPOST(makeReq(tampered, { ts, sig }))
    expect(res.status).toBe(401)
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('FAILS CLOSED when SLACK_SIGNING_SECRET is unset', async () => {
    // 'unconfigured' is a rejection, never a skip. A verifier that passes when
    // it has no key is worse than no verifier — it reads like protection.
    delete process.env.SLACK_SIGNING_SECRET
    const body = interaction(buttonPress(REVIEWER))
    const res: any = await interactionsPOST(makeReq(body))
    expect(res.status).toBe(401)
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('rejects a six-minute-old replay', async () => {
    const body = interaction(buttonPress(REVIEWER))
    const ts = String(Math.floor(Date.now() / 1000) - 360)
    const res: any = await interactionsPOST(makeReq(body, { ts, sig: sign(body, ts) }))
    expect(res.status).toBe(401)
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })
})

describe('POST /api/slack/interactions — the allowlist (§4.2)', () => {
  it('a VERIFIED but unlisted user cannot approve', async () => {
    // The request is authentic. The person is not authorised. Those are two
    // different things and only the first one is about cryptography.
    const body = interaction(buttonPress(STRANGER))
    const res: any = await interactionsPOST(makeReq(body))

    expect(res.status).toBe(200) // authentic, so Slack must not retry
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
    expect(mockRespond).toHaveBeenCalled()
    expect(mockRespond.mock.calls[0][1].text).toMatch(/reviewer list/i)
  })

  it('an EMPTY allowlist authorises nobody, including the owner', async () => {
    process.env.SLACK_REVIEWER_USER_IDS = ''
    const body = interaction(buttonPress(REVIEWER))
    await interactionsPOST(makeReq(body))
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('an unlisted user cannot open the edit modal either', async () => {
    const body = interaction(buttonPress(STRANGER, ACTION_EDIT))
    await interactionsPOST(makeReq(body))
    expect(mockOpenView).not.toHaveBeenCalled()
  })

  it('a listed reviewer queues the approval — and nothing more', async () => {
    const body = interaction(buttonPress(REVIEWER))
    const res: any = await interactionsPOST(makeReq(body))

    expect(res.status).toBe(200)
    expect(mockRecordInboundEvent).toHaveBeenCalledTimes(1)
    const row = mockRecordInboundEvent.mock.calls[0][0]
    expect(row.source).toBe('slack')
    expect(row.parsed.intent).toBe('approve')
    expect(row.parsed.draft_id).toBe(DRAFT_ID)
    expect(row.parsed.slack_user_id).toBe(REVIEWER)
    // THE POINT: the route wrote a row. It did not send anything.
    expect(row.classification).toBe('reviewer_reply')
  })

  it('the queued external_id is stable per press, so a Slack retry is a no-op', async () => {
    const press = buttonPress(REVIEWER)
    await interactionsPOST(makeReq(interaction(press)))
    await interactionsPOST(makeReq(interaction(press)))
    const a = mockRecordInboundEvent.mock.calls[0][0].externalId
    const b = mockRecordInboundEvent.mock.calls[1][0].externalId
    expect(a).toBe(b)
    expect(a).toContain(DRAFT_ID)
  })

  it('says so when the queue refused, rather than acking a press that went nowhere', async () => {
    // recordInboundEvent is non-fatal and returns null on a refused insert.
    // Before migration 049 that is exactly what a Slack row did — 23514 on the
    // source CHECK — and an unconditional "Sending..." would have been the
    // reminder engine all over again.
    mockRecordInboundEvent.mockResolvedValue(null)
    await interactionsPOST(makeReq(interaction(buttonPress(REVIEWER))))
    expect(mockRespond.mock.calls[0][1].text).toMatch(/couldn't queue/i)
  })
})

describe('POST /api/slack/interactions — the edit modal', () => {
  it('opens the modal BEFORE any database work (trigger_id lives 3 seconds)', async () => {
    await interactionsPOST(makeReq(interaction(buttonPress(REVIEWER, ACTION_EDIT))))
    expect(mockOpenView).toHaveBeenCalledTimes(1)
    expect(mockOpenView.mock.calls[0][0]).toBe('trigger-123')
    // An edit press queues nothing — the SUBMISSION does.
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('points at the thread when the modal cannot be opened', async () => {
    mockOpenView.mockResolvedValue(false)
    await interactionsPOST(makeReq(interaction(buttonPress(REVIEWER, ACTION_EDIT))))
    expect(mockRespond.mock.calls[0][1].text).toMatch(/reply in this thread/i)
  })

  it('an empty note keeps the modal open instead of losing what they typed', async () => {
    const body = interaction({
      type: 'view_submission',
      user: { id: REVIEWER },
      view: {
        id: 'V123',
        callback_id: 'hh_edit_modal',
        private_metadata: JSON.stringify({ draftId: DRAFT_ID, reviewCode: 'HH-2026-0042' }),
        state: { values: { hh_edit_block: { hh_edit_input: { value: '   ' } } } },
      },
    })
    const res: any = await interactionsPOST(makeReq(body))
    expect(res.body.response_action).toBe('errors')
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('a real note queues a revision', async () => {
    const body = interaction({
      type: 'view_submission',
      user: { id: REVIEWER },
      view: {
        id: 'V123',
        callback_id: 'hh_edit_modal',
        private_metadata: JSON.stringify({
          draftId: DRAFT_ID,
          reviewCode: 'HH-2026-0042',
          channel: 'C0LEADS',
          threadTs: '1789266286.113400',
        }),
        state: { values: { hh_edit_block: { hh_edit_input: { value: 'drop the price to 850' } } } },
      },
    })
    await interactionsPOST(makeReq(body))
    const row = mockRecordInboundEvent.mock.calls[0][0]
    expect(row.parsed.intent).toBe('revise')
    expect(row.body).toBe('drop the price to 850')
    expect(row.parsed.slack_thread_ts).toBe('1789266286.113400')
  })

  it('an unlisted user cannot submit the modal', async () => {
    const body = interaction({
      type: 'view_submission',
      user: { id: STRANGER },
      view: {
        id: 'V123',
        callback_id: 'hh_edit_modal',
        private_metadata: JSON.stringify({ draftId: DRAFT_ID, reviewCode: 'HH-2026-0042' }),
        state: { values: { hh_edit_block: { hh_edit_input: { value: 'send it to me instead' } } } },
      },
    })
    await interactionsPOST(makeReq(body))
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })
})

/* ── Events ─────────────────────────────────────────────────────────────── */

function makeDraftDb(draft: any) {
  return {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({ maybeSingle: jest.fn(() => Promise.resolve({ data: draft, error: null })) })),
      })),
    })),
  } as any
}

function messageEvent(extra: Record<string, any> = {}): string {
  return JSON.stringify({
    type: 'event_callback',
    event_id: 'Ev123',
    event: {
      type: 'message',
      user: REVIEWER,
      channel: 'C0LEADS',
      ts: '1789266999.000100',
      thread_ts: '1789266286.113400',
      text: 'make it warmer and mention parking',
      ...extra,
    },
  })
}

describe('POST /api/slack/events — a thread reply is a revision', () => {
  beforeEach(() => {
    mockGetSupabase.mockReturnValue(
      makeDraftDb({ id: DRAFT_ID, review_code: 'HH-2026-0042', status: 'sent_for_review' }),
    )
  })

  it('queues the reply against the draft the thread belongs to', async () => {
    const body = messageEvent()
    const res: any = await eventsPOST(makeReq(body))
    expect(res.body.queued).toBe(true)
    const row = mockRecordInboundEvent.mock.calls[0][0]
    expect(row.source).toBe('slack')
    expect(row.parsed.intent).toBe('revise')
    expect(row.parsed.draft_id).toBe(DRAFT_ID)
    expect(row.body).toBe('make it warmer and mention parking')
    // Slack's own event id is the dedupe, so a redelivery is refused by the DB.
    expect(row.externalId).toBe('slack:Ev123')
  })

  it('IGNORES the bot — otherwise the agent re-drafts its own reply, forever', async () => {
    // This is the unbounded-Sonnet-spend guard. The agent posts the revised
    // draft into the same thread; without this that post is a new reply, which
    // is a new revision, which posts again.
    const res: any = await eventsPOST(makeReq(messageEvent({ bot_id: 'B0AGENT' })))
    expect(res.body.ignored).toBe('bot')
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('ignores a bot_message subtype too', async () => {
    await eventsPOST(makeReq(messageEvent({ subtype: 'bot_message' })))
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('ignores a TOP-LEVEL message — chatting in the channel is not revising', async () => {
    const res: any = await eventsPOST(makeReq(messageEvent({ thread_ts: undefined })))
    expect(res.body.ignored).toMatch(/thread/)
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('ignores the thread PARENT (thread_ts === ts)', async () => {
    await eventsPOST(makeReq(messageEvent({ ts: '1789266286.113400' })))
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('ignores a non-reviewer talking in the thread', async () => {
    const res: any = await eventsPOST(makeReq(messageEvent({ user: STRANGER })))
    expect(res.body.ignored).toBe('not a reviewer')
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('ignores a message edit', async () => {
    await eventsPOST(makeReq(messageEvent({ subtype: 'message_changed' })))
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
  })

  it('refuses to revise a draft that already went to the customer', async () => {
    mockGetSupabase.mockReturnValue(makeDraftDb({ id: DRAFT_ID, review_code: 'HH-2026-0042', status: 'sent' }))
    const res: any = await eventsPOST(makeReq(messageEvent()))
    expect(res.body.ignored).toBe('already sent')
    expect(mockRecordInboundEvent).not.toHaveBeenCalled()
    expect(mockPostMessage.mock.calls[0][0].text).toMatch(/already went to the customer/)
  })

  it('answers the url_verification handshake — but only after verifying it', async () => {
    const body = JSON.stringify({ type: 'url_verification', challenge: 'abc123' })
    const ok: any = await eventsPOST(makeReq(body))
    expect(ok.body.challenge).toBe('abc123')

    // Unsigned, the handshake gets no exemption.
    const bad: any = await eventsPOST(makeReq(body, { sig: 'v0=nope' }))
    expect(bad.status).toBe(401)
  })

  it('503s on a lookup failure so Slack redelivers rather than losing the instruction', async () => {
    mockGetSupabase.mockReturnValue({
      from: jest.fn(() => ({
        select: jest.fn(() => ({
          eq: jest.fn(() => ({
            maybeSingle: jest.fn(() => Promise.resolve({ data: null, error: { message: 'timeout' } })),
          })),
        })),
      })),
    } as any)
    const res: any = await eventsPOST(makeReq(messageEvent()))
    expect(res.status).toBe(503)
  })
})
