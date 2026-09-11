/**
 * Tests for lib/agent/sendApproved.ts — the one module that messages a customer.
 *
 * What matters here: it refuses unless the draft is 'approved', it is idempotent
 * per channel, a partial failure does NOT get reported as sent, and a TEST send
 * writes nothing.
 */

const mockResendSend = jest.fn()
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send: (...a: any[]) => mockResendSend(...a) } })),
}))

const mockSendSMSViaQuo = jest.fn()
jest.mock('@/lib/quo', () => ({ sendSMSViaQuo: (...a: any[]) => mockSendSMSViaQuo(...a) }))

const mockAdvance = jest.fn().mockResolvedValue({ from: 'approved', to: 'sent' })
const mockWriteLedger = jest.fn().mockResolvedValue(undefined)
jest.mock('@/lib/marketing/graph', () => ({
  advance: (...a: any[]) => mockAdvance(...a),
  writeLedger: (...a: any[]) => mockWriteLedger(...a),
}))

import { sendApprovedDraft, renderEmailHtml, resolveRecipient } from '@/lib/agent/sendApproved'

const ACTOR = { id: 'REVIEWER:+16314008080', isAdmin: true }

function baseDraft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1',
    review_code: 'HH-2026-0042',
    status: 'approved',
    party_type: 'mobile_party',
    contact_path: 'quote',
    draft_kind: 'quote',
    channel: 'both',
    subject: 'Your mobile party on Nov 14',
    email_draft: 'Hi Jess!\n\nHere are the details.\n\n— Allie\nHost Hampton',
    sms_draft: 'Hi Jess! Details are in your email. – Allie, Host Hampton',
    booking_id: null,
    contact_id: 'contact-1',
    inbound_event_id: null,
    customer_email_sent_at: null,
    customer_sms_sent_at: null,
    ...overrides,
  }
}

/**
 * Supabase double. Routes each .from(table) to a canned row, and records every
 * update so the test can assert what was stamped.
 */
function makeSupabase(opts: {
  draft?: Record<string, unknown> | null
  contact?: Record<string, unknown> | null
  booking?: Record<string, unknown> | null
  event?: Record<string, unknown> | null
} = {}) {
  const updates: { table: string; patch: Record<string, unknown> }[] = []

  const from = jest.fn((table: string) => {
    const ops: [string, ...unknown[]][] = []
    const chain: any = {
      then: (res: any, rej: any) => {
        const upd = ops.find(o => o[0] === 'update')
        if (upd) {
          updates.push({ table, patch: upd[1] as Record<string, unknown> })
          return Promise.resolve({ data: [{ id: 'x' }], error: null }).then(res, rej)
        }
        const row =
          table === 'inquiry_drafts' ? (opts.draft === undefined ? baseDraft() : opts.draft)
          : table === 'contacts' ? opts.contact ?? null
          : table === 'bookings' ? opts.booking ?? null
          : table === 'ingested_messages' ? opts.event ?? null
          : null
        return Promise.resolve({ data: row, error: null }).then(res, rej)
      },
    }
    for (const m of ['select', 'eq', 'update', 'maybeSingle', 'single', 'limit']) {
      chain[m] = jest.fn((...args: unknown[]) => {
        ops.push([m, ...args])
        return chain
      })
    }
    return chain
  })

  return { supabase: { from } as any, updates }
}

describe('renderEmailHtml', () => {
  it('preserves paragraphs and escapes HTML in the approved text', () => {
    const html = renderEmailHtml('First para.\n\nSecond <b>para</b> & more.')
    expect(html).toContain('First para.')
    expect(html).toContain('&lt;b&gt;para&lt;/b&gt; &amp; more.')
    expect(html.match(/<p style="font-size:15px/g)?.length).toBe(2)
  })

  it('keeps single line breaks inside a paragraph', () => {
    expect(renderEmailHtml('line one\nline two')).toContain('line one<br />line two')
  })
})

describe('resolveRecipient', () => {
  it('prefers the party plan over the contact record', async () => {
    const { supabase } = makeSupabase({
      booking: { contact_email: 'plan@example.com', contact_phone: '6315550001', contact_name: 'Plan Name' },
      contact: { email: 'contact@example.com', phone: '6315550002', first_name: 'Contact', last_name: 'Name' },
    })
    const r = await resolveRecipient(supabase, baseDraft({ booking_id: 'b1' }) as any)
    expect(r).toEqual({ email: 'plan@example.com', phone: '+16315550001', name: 'Plan Name' })
  })

  it('falls back to the inbound event when nothing else has a handle', async () => {
    const { supabase } = makeSupabase({
      contact: null,
      event: { from_address: 'form@example.com', parsed: { phone: '631-555-0003', name: 'Form Name' } },
    })
    const r = await resolveRecipient(supabase, baseDraft({ contact_id: null, inbound_event_id: 'e1' }) as any)
    expect(r).toEqual({ email: 'form@example.com', phone: '+16315550003', name: 'Form Name' })
  })

  it('ignores a phone too short to be real', async () => {
    const { supabase } = makeSupabase({ contact: { email: 'a@b.com', phone: '123', first_name: 'A', last_name: null } })
    const r = await resolveRecipient(supabase, baseDraft() as any)
    expect(r.phone).toBeNull()
  })
})

describe('sendApprovedDraft', () => {
  const originalEnv = process.env

  beforeEach(() => {
    jest.clearAllMocks()
    process.env = { ...originalEnv, RESEND_API_KEY: 'rk_test', RESEND_FROM_EMAIL: 'hi@mail.hosthampton.com' }
    mockResendSend.mockResolvedValue({ data: { id: 're_1' }, error: null })
    mockSendSMSViaQuo.mockResolvedValue('QUO_1')
    mockAdvance.mockResolvedValue({ from: 'approved', to: 'sent' })
  })
  afterAll(() => { process.env = originalEnv })

  const CONTACT = { email: 'jess@example.com', phone: '6315550123', first_name: 'Jess', last_name: 'R' }

  it('refuses to send a draft that is not approved', async () => {
    const { supabase } = makeSupabase({ draft: baseDraft({ status: 'sent_for_review' }), contact: CONTACT })

    const res = await sendApprovedDraft({ supabase, draftId: 'draft-1', actor: ACTOR })

    expect(res.ok).toBe(false)
    expect(res.errors[0]).toContain('not "approved"')
    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSViaQuo).not.toHaveBeenCalled()
  })

  it('sends both channels, stamps them, and closes the draft through the gate', async () => {
    const { supabase, updates } = makeSupabase({ contact: CONTACT })

    const res = await sendApprovedDraft({ supabase, draftId: 'draft-1', actor: ACTOR })

    expect(res).toMatchObject({ ok: true, emailSent: true, smsSent: true, closed: true })
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'jess@example.com', subject: 'Your mobile party on Nov 14' }),
    )
    expect(mockSendSMSViaQuo).toHaveBeenCalledWith('+16315550123', expect.stringContaining('Allie'))

    const stamp = updates.find(u => u.table === 'inquiry_drafts')?.patch
    expect(stamp).toMatchObject({ customer_email_message_id: 're_1', customer_sms_message_id: 'QUO_1' })
    expect(stamp?.customer_email_sent_at).toBeTruthy()
    expect(stamp?.customer_sms_sent_at).toBeTruthy()

    expect(mockAdvance).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'inquiry_draft', to: 'sent', from: 'approved', actor: ACTOR }),
    )
  })

  it('is idempotent per channel: an already-emailed draft is not emailed twice', async () => {
    const { supabase } = makeSupabase({
      draft: baseDraft({ customer_email_sent_at: '2026-09-11T00:00:00Z' }),
      contact: CONTACT,
    })

    const res = await sendApprovedDraft({ supabase, draftId: 'draft-1', actor: ACTOR })

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(mockSendSMSViaQuo).toHaveBeenCalledTimes(1)
    // The whole draft is still finished, because both channels are now done.
    expect(res.closed).toBe(true)
  })

  it('leaves a partially failed send at approved, never reports it as sent', async () => {
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'domain not verified' } })
    const { supabase, updates } = makeSupabase({ contact: CONTACT })

    const res = await sendApprovedDraft({ supabase, draftId: 'draft-1', actor: ACTOR })

    expect(res).toMatchObject({ ok: false, emailSent: false, smsSent: true, closed: false })
    expect(res.errors.join(' ')).toContain('domain not verified')
    expect(mockAdvance).not.toHaveBeenCalled()
    // The SMS that DID land is stamped, so a retry will not re-text.
    const stamp = updates.find(u => u.table === 'inquiry_drafts')?.patch
    expect(stamp?.customer_sms_sent_at).toBeTruthy()
    expect(stamp?.customer_email_sent_at).toBeUndefined()
    expect(stamp?.send_error).toContain('domain not verified')
  })

  it('records a missing handle as an error rather than silently skipping a channel', async () => {
    const { supabase } = makeSupabase({ contact: { email: null, phone: '6315550123', first_name: 'Jess', last_name: null } })

    const res = await sendApprovedDraft({ supabase, draftId: 'draft-1', actor: ACTOR })

    expect(res.errors).toContain('no email address for this draft')
    expect(res.closed).toBe(false)
  })

  it('a TEST send goes to the reviewer and writes nothing', async () => {
    const { supabase, updates } = makeSupabase({ draft: baseDraft({ status: 'sent_for_review' }), contact: CONTACT })

    const res = await sendApprovedDraft({
      supabase,
      draftId: 'draft-1',
      actor: ACTOR,
      testTo: { email: 'owner@example.com', phone: '+16314008080' },
    })

    expect(res).toMatchObject({ ok: true, test: true, closed: false })
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner@example.com', subject: '[TEST] Your mobile party on Nov 14' }),
    )
    expect(mockSendSMSViaQuo).toHaveBeenCalledWith('+16314008080', expect.stringContaining('[TEST]'))
    // Nothing persisted, no transition, even though the draft was not approved.
    expect(updates).toHaveLength(0)
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('moves a lead plan to quoted once the quote has gone out', async () => {
    const { supabase, updates } = makeSupabase({
      draft: baseDraft({ booking_id: 'b1', draft_kind: 'quote' }),
      booking: { status: 'lead', contact_email: 'jess@example.com', contact_phone: '6315550123', contact_name: 'Jess' },
    })

    await sendApprovedDraft({ supabase, draftId: 'draft-1', actor: ACTOR })

    expect(updates.some(u => u.table === 'bookings' && u.patch.status === 'quoted')).toBe(true)
  })

  it('does not touch the plan status for an info-gather draft', async () => {
    const { supabase, updates } = makeSupabase({
      draft: baseDraft({ booking_id: 'b1', draft_kind: 'info_gather', contact_path: 'info_gather' }),
      booking: { status: 'lead', contact_email: 'jess@example.com', contact_phone: '6315550123', contact_name: 'Jess' },
    })

    await sendApprovedDraft({ supabase, draftId: 'draft-1', actor: ACTOR })

    expect(updates.some(u => u.table === 'bookings')).toBe(false)
  })

  it('honours a single-channel draft', async () => {
    const { supabase } = makeSupabase({ draft: baseDraft({ channel: 'sms' }), contact: CONTACT })

    const res = await sendApprovedDraft({ supabase, draftId: 'draft-1', actor: ACTOR })

    expect(mockResendSend).not.toHaveBeenCalled()
    expect(res).toMatchObject({ smsSent: true, emailSent: false, closed: true })
  })

  it('writes one ledger send row with the channels and recipient', async () => {
    const { supabase } = makeSupabase({ contact: CONTACT })

    await sendApprovedDraft({ supabase, draftId: 'draft-1', actor: ACTOR })

    expect(mockWriteLedger).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        entityType: 'inquiry_draft',
        action: 'send',
        actor: ACTOR.id,
        toStatus: 'sent',
      }),
    )
  })
})
