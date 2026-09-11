/**
 * Tests for lib/agent/threadTimeline.ts.
 *
 * Three properties matter, and each of them is a bug the timeline would
 * otherwise ship:
 *
 *  1. An ABSENT anchor must skip its query, never issue one with `undefined`.
 *     PostgREST treats a missing filter as "all rows", so a lead with no
 *     contact would have rendered every payment in the business.
 *  2. Messages sort by `sent_at`, not `created_at`. The 12-month Gmail backfill
 *     ingested 2024 email today; ordering by ingestion would have put a
 *     two-year-old message at the top of a live thread.
 *  3. A source that FAILS is reported, not silently absent. Silence is what
 *     success looks like, which is exactly how a held draft once read as sent.
 */

import { loadLeadTimeline } from '@/lib/agent/threadTimeline'

type Rows = Record<string, unknown>[]

interface Tables {
  inquiry_drafts?: Rows
  ingested_messages?: Rows
  marketing_ledger?: Rows
  booking_payments?: Rows
  contact_interactions?: Rows
}

function makeSupabase(tables: Tables, errors: Partial<Record<keyof Tables, string>> = {}) {
  const queried: string[] = []

  const from = jest.fn((table: string) => {
    queried.push(table)
    const result = {
      data: errors[table as keyof Tables] ? null : (tables[table as keyof Tables] ?? []),
      error: errors[table as keyof Tables] ? { message: errors[table as keyof Tables] } : null,
    }
    const chain: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(result).then(res, rej),
    }
    for (const m of ['select', 'or', 'eq', 'in', 'order', 'limit']) {
      chain[m] = () => chain
    }
    return chain
  })

  return { supabase: { from } as never, queried }
}

describe('loadLeadTimeline anchors', () => {
  it('refuses to build a timeline from no anchor at all', async () => {
    const { supabase, queried } = makeSupabase({})
    const out = await loadLeadTimeline({ supabase })
    expect(out.items).toEqual([])
    expect(queried).toEqual([])
    expect(out.errors[0]).toMatch(/No booking, contact or draft/)
  })

  it('skips the contact-only and booking-only queries when those anchors are absent', async () => {
    // Only a draft id. `booking_payments` is keyed on a booking and
    // `contact_interactions` on a contact — neither may be queried, because an
    // unfiltered read of either returns the whole business.
    const { supabase, queried } = makeSupabase({ inquiry_drafts: [] })
    await loadLeadTimeline({ supabase, draftId: 'dr-1' })
    expect(queried).toContain('inquiry_drafts')
    expect(queried).toContain('ingested_messages')
    expect(queried).not.toContain('booking_payments')
    expect(queried).not.toContain('contact_interactions')
  })

  it('queries payments and interactions once their anchors exist', async () => {
    const { supabase, queried } = makeSupabase({ inquiry_drafts: [] })
    await loadLeadTimeline({ supabase, bookingId: 'bk-1', contactId: 'ct-1' })
    expect(queried).toContain('booking_payments')
    expect(queried).toContain('contact_interactions')
  })
})

describe('loadLeadTimeline assembly', () => {
  it('orders a message by when it was SENT, not when we ingested it', async () => {
    const { supabase } = makeSupabase({
      inquiry_drafts: [],
      ingested_messages: [
        {
          id: 'm-old',
          source: 'gmail',
          direction: 'in',
          body: 'a question from 2024',
          sent_at: '2024-03-01T10:00:00.000Z',
          created_at: '2026-09-10T10:00:00.000Z',
        },
        {
          id: 'm-new',
          source: 'website_form',
          direction: 'in',
          body: 'todays inquiry',
          sent_at: '2026-09-11T10:00:00.000Z',
          created_at: '2026-09-11T10:00:00.000Z',
        },
      ],
    })

    const out = await loadLeadTimeline({ supabase, contactId: 'ct-1' })
    expect(out.items.map(i => i.id)).toEqual(['message:m-old', 'message:m-new'])
    expect(out.items[0].at).toBe('2024-03-01T10:00:00.000Z')
  })

  it('puts an outbound message on the right and everything else on the left', async () => {
    const { supabase } = makeSupabase({
      inquiry_drafts: [],
      ingested_messages: [
        { id: 'm-1', source: 'quo', direction: 'out', created_at: '2026-09-11T10:00:00.000Z' },
        { id: 'm-2', source: 'quo', direction: 'in', created_at: '2026-09-11T11:00:00.000Z' },
      ],
    })
    const out = await loadLeadTimeline({ supabase, contactId: 'ct-1' })
    expect(out.items.map(i => i.side)).toEqual(['outbound', 'inbound'])
  })

  it('synthesises v1 from the row when a draft has no revisions yet', async () => {
    const { supabase } = makeSupabase({
      inquiry_drafts: [
        {
          id: 'dr-1',
          review_code: 'HH-2026-0042',
          subject: 'Your party',
          email_draft: 'hello',
          sms_draft: 'hi',
          revisions: [],
          created_at: '2026-09-11T10:00:00.000Z',
        },
      ],
    })
    const out = await loadLeadTimeline({ supabase, draftId: 'dr-1' })
    const versions = out.items.filter(i => i.kind === 'draft_version')
    expect(versions).toHaveLength(1)
    expect(versions[0]).toMatchObject({ version: 1, author: 'agent', smsDraft: 'hi' })
  })

  it('does NOT use the row bodies as v1 once revisions exist — they are the latest text', async () => {
    // The trap this guards: `email_draft` on the row is v3's text. Showing it as
    // v1 would make every diff read as "nothing changed".
    const { supabase } = makeSupabase({
      inquiry_drafts: [
        {
          id: 'dr-1',
          review_code: 'HH-2026-0042',
          email_draft: 'the latest text',
          sms_draft: 'latest sms',
          revisions: [
            { at: '2026-09-11T10:00:00.000Z', actor: 'agent', email_draft: 'first', sms_draft: 'first sms' },
            { at: '2026-09-11T11:00:00.000Z', actor: 'reviewer', note: 'warmer please' },
            {
              at: '2026-09-11T11:01:00.000Z',
              actor: 'agent',
              note: 'revision',
              email_draft: 'the latest text',
              sms_draft: 'latest sms',
            },
          ],
          created_at: '2026-09-11T09:00:00.000Z',
        },
      ],
    })

    const out = await loadLeadTimeline({ supabase, draftId: 'dr-1' })
    const versions = out.items.filter(i => i.kind === 'draft_version' && i.version > 0)
    expect(versions.map(v => (v as { version: number }).version)).toEqual([1, 2])
    expect(versions[0]).toMatchObject({ smsDraft: 'first sms', previousSmsDraft: null })
    // v2 carries v1's bodies, which is what makes the inline diff possible.
    expect(versions[1]).toMatchObject({ smsDraft: 'latest sms', previousSmsDraft: 'first sms' })
  })

  it('keeps a note-only revision as the INSTRUCTION, not as a version', async () => {
    const { supabase } = makeSupabase({
      inquiry_drafts: [
        {
          id: 'dr-1',
          revisions: [
            { at: '2026-09-11T11:00:00.000Z', actor: 'reviewer', note: 'mom to mom please' },
            { at: '2026-09-11T11:01:00.000Z', actor: 'agent', email_draft: 'x', sms_draft: 'y' },
          ],
          created_at: '2026-09-11T09:00:00.000Z',
        },
      ],
    })
    const out = await loadLeadTimeline({ supabase, draftId: 'dr-1' })
    const notes = out.items.filter(i => i.kind === 'draft_version' && i.version === 0)
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ side: 'system', author: 'reviewer', note: 'mom to mom please' })
  })

  it('reports a source it could not read instead of rendering it as empty', async () => {
    const { supabase } = makeSupabase({ inquiry_drafts: [] }, { booking_payments: 'relation does not exist' })
    const out = await loadLeadTimeline({ supabase, bookingId: 'bk-1' })
    expect(out.errors).toContain('payments: relation does not exist')
  })

  it('sorts payments and interactions into the same stream as messages', async () => {
    const { supabase } = makeSupabase({
      inquiry_drafts: [],
      ingested_messages: [{ id: 'm-1', source: 'quo', direction: 'in', sent_at: '2026-09-01T00:00:00.000Z' }],
      booking_payments: [
        {
          id: 'p-1',
          payment_type: 'deposit',
          payment_method: 'card',
          amount_cents: 25000,
          total_charged_cents: 25000,
          recorded_by: 'system',
          paid_at: '2026-09-03T00:00:00.000Z',
        },
      ],
      contact_interactions: [{ id: 'i-1', type: 'phone_call', created_at: '2026-09-02T00:00:00.000Z' }],
    })

    const out = await loadLeadTimeline({ supabase, bookingId: 'bk-1', contactId: 'ct-1' })
    expect(out.items.map(i => i.kind)).toEqual(['message', 'interaction', 'payment'])
  })
})
