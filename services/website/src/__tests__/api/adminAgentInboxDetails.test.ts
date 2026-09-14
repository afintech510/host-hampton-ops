/**
 * Tests for GET /api/admin/agent — the inquiry detail the Inbox renders under
 * each draft.
 *
 * The reviewer's job on that screen is to decide whether a draft is RIGHT, and
 * the draft alone cannot answer that: "did it use the right date?" needs the
 * date. So the properties locked down here are about the detail being true,
 * not about it being present:
 *
 *  1. **A plan's own columns win**, and they reach the panel — date, time,
 *     guests, theme, notes, email, phone.
 *  2. **A draft with no plan is still described.** The info-gather case is
 *     exactly where a reviewer most needs the customer's own words, and it is
 *     the case with no `bookings` row to read them from.
 *  3. **A read failure is never rendered as an empty field.** A booking whose
 *     lookup errored must come back flagged in `unavailable` and named in
 *     `errors[]` — "we could not read the email" and "they gave no email" lead
 *     a human to opposite actions.
 *  4. **`from_address` is only trusted as the channel it came in on.** An SMS
 *     event's from_address is a phone number; filling the Email field with it
 *     would put a phone number in a mailto: link.
 */

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({ status: init?.status || 200, json: () => body, body }),
  },
}))

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))
jest.mock('@/lib/adminAuth', () => {
  const actual = jest.requireActual('@/lib/adminAuth')
  return { ...actual, isAdminAuthorized: () => true }
})
jest.mock('@/lib/agent/draftInquiry', () => ({
  DRAFT_ENTITY: 'inquiry_draft',
  draftForInquiry: jest.fn(),
  redraftForReviewer: jest.fn(),
  planStatusOf: jest.fn(),
}))
jest.mock('@/lib/marketing/graph', () => ({ advance: jest.fn(), writeLedger: jest.fn() }))
jest.mock('@/lib/agent/sendApproved', () => ({ sendApprovedDraft: jest.fn() }))
jest.mock('@/lib/ownerNotify', () => ({ ownerEmail: () => 'owner@example.com', reviewerPhones: () => [] }))
jest.mock('@/lib/agent/events', () => ({ finishEvent: jest.fn() }))
jest.mock('@/lib/agent/config', () => ({
  agentEnabled: () => true,
  draftModel: () => 'test-model',
  reviewLinkSecret: () => 'shh',
}))

import { GET } from '@/app/api/admin/agent/route'

/** A draft WITH a plan behind it. */
const PLANNED_DRAFT = {
  id: 'dr-1',
  review_code: 'HH-2026-0001',
  status: 'sent_for_review',
  party_type: 'in_studio_theme',
  contact_path: 'quote',
  booking_id: 'bk-1',
  contact_id: 'ct-1',
  inbound_event_id: 'ev-1',
  created_at: '2026-09-12T12:00:00Z',
}

/** A draft with NO plan row — the info-gather case from the screenshot. */
const BARE_DRAFT = {
  id: 'dr-2',
  review_code: 'HH-2026-0002',
  status: 'sent_for_review',
  party_type: 'unknown',
  contact_path: 'info_gather',
  booking_id: null,
  contact_id: 'ct-2',
  inbound_event_id: 'ev-2',
  created_at: '2026-09-12T13:00:00Z',
}

const BOOKING = {
  id: 'bk-1',
  booking_ref: 'HH-1234',
  status: 'lead',
  contact_name: 'Jessica Reed',
  contact_email: 'Jessica@Example.com',
  contact_phone: '+16315551212',
  party_date: '2026-09-30',
  party_time: '14:30:00',
  guest_count_approx: 12,
  child_name: 'Mia',
  child_age: 7,
  event_type: 'Kids Birthday Party',
  package_type: 'Slime Party',
  party_tags: { theme: 'mermaid', location_address: '12 Ocean Rd' },
  notes: 'Wants the pink balloons.',
  admin_notes: null,
  total_cents: 85000,
  deposit_amount: 250,
  balance_due_cents: 60000,
  source: 'website_form',
}

const CONTACTS = [
  { id: 'ct-1', first_name: 'Jessica', last_name: 'Reed', email: 'jessica@example.com', phone: '+16315551212' },
  { id: 'ct-2', first_name: 'Sam', last_name: null, email: 'sam@example.com', phone: null },
]

const EVENTS = [
  {
    id: 'ev-1',
    source: 'email',
    from_address: 'jessica@example.com',
    subject: 'Party question',
    body: 'Hi! Looking to book for 12 kids on the 30th.',
    parsed: { guests: 12, route: 'contact-form' },
    sent_at: '2026-09-11T09:00:00Z',
    created_at: '2026-09-11T09:00:05Z',
  },
  {
    id: 'ev-2',
    source: 'sms',
    from_address: '+16319998888',
    subject: null,
    body: 'do you do parties',
    parsed: null,
    sent_at: null,
    created_at: '2026-09-12T12:59:00Z',
  },
]

interface TableData {
  data: unknown
  error: { message: string } | null
}

/**
 * A Supabase stub that answers BY TABLE. The route reads five tables and the
 * whole point of these tests is which answer lands in which field, so a stub
 * that returns one canned row for everything would pass while proving nothing.
 */
function makeSupabase(overrides: Partial<Record<string, TableData>> = {}) {
  const tables: Record<string, TableData> = {
    ingested_messages: { data: EVENTS, error: null },
    inquiry_drafts: { data: [PLANNED_DRAFT, BARE_DRAFT], error: null },
    marketing_ledger: { data: [], error: null },
    bookings: { data: [BOOKING], error: null },
    contacts: { data: CONTACTS, error: null },
    ...overrides,
  }
  // The events list and the per-draft inbound lookup both read
  // `ingested_messages`; both want the same rows, so one entry serves.
  const from = jest.fn((table: string) => {
    const result = tables[table] ?? { data: [], error: null }
    const chain: any = {
      then: (res: any, rej: any) => Promise.resolve(result).then(res, rej),
    }
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle']) chain[m] = () => chain
    return chain
  })
  return { from } as never
}

function req() {
  return {} as never
}

async function load(overrides?: Partial<Record<string, TableData>>) {
  mockGetSupabase.mockReturnValue(makeSupabase(overrides))
  const res: any = await GET(req())
  return res.json()
}

describe('GET /api/admin/agent — inquiry details', () => {
  beforeEach(() => jest.clearAllMocks())

  it('carries the plan columns a reviewer needs to judge the draft', async () => {
    const body = await load()
    const d = body.drafts.find((x: any) => x.id === 'dr-1').details

    expect(d.name).toBe('Jessica Reed')
    expect(d.email).toBe('Jessica@Example.com')
    expect(d.phone).toBe('+16315551212')
    expect(d.party_date).toBe('2026-09-30')
    expect(d.party_time).toBe('14:30:00')
    expect(d.guest_count).toBe(12)
    expect(d.child_name).toBe('Mia')
    expect(d.child_age).toBe(7)
    expect(d.event_type).toBe('Kids Birthday Party')
    expect(d.package_type).toBe('Slime Party')
    expect(d.notes).toBe('Wants the pink balloons.')
    // Theme and the mobile-party address live in party_tags, not in a column.
    expect(d.tags).toEqual({ theme: 'mermaid', location_address: '12 Ocean Rd' })
    expect(d.total_cents).toBe(85000)
    expect(d.unavailable).toEqual([])
  })

  it('shows the original message under the draft', async () => {
    const body = await load()
    const d = body.drafts.find((x: any) => x.id === 'dr-1').details

    expect(d.inquiry.body).toBe('Hi! Looking to book for 12 kids on the 30th.')
    expect(d.inquiry.subject).toBe('Party question')
    expect(d.inquiry.truncated).toBe(false)
    // The time the customer SENT it, not the time we ingested it.
    expect(d.inquiry.received_at).toBe('2026-09-11T09:00:00Z')
    expect(d.inquiry.parsed).toEqual({ guests: 12, route: 'contact-form' })
  })

  it('trims a long thread rather than shipping the whole quoted history', async () => {
    const long = 'x'.repeat(9000)
    const body = await load({
      ingested_messages: { data: [{ ...EVENTS[0], body: long }, EVENTS[1]], error: null },
    })
    const d = body.drafts.find((x: any) => x.id === 'dr-1').details
    expect(d.inquiry.body.length).toBe(4000)
    expect(d.inquiry.truncated).toBe(true)
  })

  it('still describes a draft that has no plan row yet', async () => {
    const body = await load()
    const d = body.drafts.find((x: any) => x.id === 'dr-2').details

    expect(d.name).toBe('Sam')
    expect(d.email).toBe('sam@example.com')
    expect(d.inquiry.body).toBe('do you do parties')
    // No plan, so no party facts — and that is an honest "not provided", which
    // is what the Missing: line on the card is already saying.
    expect(d.party_date).toBeNull()
    expect(d.guest_count).toBeNull()
    expect(d.unavailable).toEqual([])
  })

  it('does not put an SMS sender number in the email field', async () => {
    // The contact row is what supplies dr-2's email above; strip it and the
    // only remaining candidate is an SMS from_address, which must be refused.
    const body = await load({
      contacts: { data: [CONTACTS[0], { ...CONTACTS[1], email: null }], error: null },
    })
    const d = body.drafts.find((x: any) => x.id === 'dr-2').details
    expect(d.email).toBeNull()
    // It IS a phone number, and it is the only one we have for this lead.
    expect(d.phone).toBe('+16319998888')
  })

  it('reads from_address by its shape, not by the event source vocabulary', async () => {
    // Production's Gmail poller writes source='gmail'; an allowlist of 'email'
    // silently dropped every one of those addresses. The address itself says
    // what it is.
    const body = await load({
      contacts: { data: [CONTACTS[0], { ...CONTACTS[1], email: null }], error: null },
      ingested_messages: {
        data: [EVENTS[0], { ...EVENTS[1], source: 'gmail', from_address: 'sam@example.net' }],
        error: null,
      },
    })
    const d = body.drafts.find((x: any) => x.id === 'dr-2').details
    expect(d.email).toBe('sam@example.net')
    expect(d.phone).toBeNull()
  })

  it('flags a draft whose "customer" is one of our own addresses', async () => {
    // Production has these: our own outgoing quote re-ingested with
    // direction='in', drafted a reply to. In the queue it is indistinguishable
    // from a real lead, so the detail panel has to name it.
    const body = await load({
      contacts: {
        data: [CONTACTS[0], { ...CONTACTS[1], email: 'allie@hosthampton.com' }],
        error: null,
      },
    })
    expect(body.drafts.find((x: any) => x.id === 'dr-2').details.self_addressed).toBe(true)
    // A real customer is not flagged.
    expect(body.drafts.find((x: any) => x.id === 'dr-1').details.self_addressed).toBe(false)
  })

  it('reports a failed plan read as a failure, not as a party with no details', async () => {
    const body = await load({ bookings: { data: null, error: { message: 'timeout' } } })
    const d = body.drafts.find((x: any) => x.id === 'dr-1').details

    expect(d.unavailable).toContain('plan')
    expect(body.errors.join(' ')).toContain('plan details: timeout')
    // The draft with no booking_id never asked the bookings table anything, so
    // its details are not in doubt.
    const bare = body.drafts.find((x: any) => x.id === 'dr-2').details
    expect(bare.unavailable).toEqual([])
  })
})
