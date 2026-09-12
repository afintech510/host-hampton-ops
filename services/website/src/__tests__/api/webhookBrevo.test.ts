/**
 * Tests for the Brevo marketing webhook — POST /api/webhooks/brevo.
 *
 * Rewritten by chain link 9 around a tiny in-memory `contacts` store instead of
 * fixed-value chains, for the reason rule 8 keeps producing: **a mock that
 * returns a fixed row cannot see a matching bug.** The defect this suite now
 * catches is that `.eq('email', …)` is case-SENSITIVE in Postgres while Brevo
 * posts addresses back lowercased, and 21 real contacts are stored with
 * capitals — so an `unsubscribed` event for `BON…@GMAIL.COM` updated zero rows
 * and the handler still answered `{received: true}`. The store below models
 * `eq` and `ilike` the way Postgres does them, so the old code fails it.
 */

interface Row {
  id: string
  email: string | null
  email_opt_in?: boolean
  last_engaged_at?: string | null
  status?: string
}

function makeStore(contacts: Row[]) {
  const interactions: { contact_id: string; type: string; metadata: any }[] = []
  const bounceCounts: Record<string, number> = {}

  /** `_` and `%` are LIKE wildcards; the app must not rely on ilike alone. */
  const ilikeMatch = (value: string | null, pattern: string): boolean => {
    const re = new RegExp(
      '^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.').replace(/%/g, '.*') + '$',
      'i'
    )
    return re.test(String(value ?? ''))
  }

  function contactsTable() {
    let filtered = contacts.slice()
    let op: 'select' | 'update' = 'select'
    let patch: Record<string, unknown> = {}

    const chain: any = {
      select: () => {
        op = 'select'
        return chain
      },
      update: (p: Record<string, unknown>) => {
        op = 'update'
        patch = p
        return chain
      },
      eq: (col: string, val: any) => {
        filtered = filtered.filter(r => (r as any)[col] === val)
        return chain
      },
      ilike: (col: string, val: string) => {
        filtered = filtered.filter(r => ilikeMatch((r as any)[col], val))
        return chain
      },
      in: (col: string, vals: any[]) => {
        filtered = filtered.filter(r => vals.includes((r as any)[col]))
        return chain
      },
      then: (res: any, rej: any) => {
        if (op === 'update') for (const r of filtered) Object.assign(r, patch)
        return Promise.resolve({ data: op === 'update' ? null : filtered, error: null }).then(res, rej)
      },
    }
    return chain
  }

  function interactionsTable() {
    let ids: string[] = []
    const chain: any = {
      select: () => chain,
      insert: (row: any) => {
        interactions.push(row)
        bounceCounts[row.contact_id] = (bounceCounts[row.contact_id] ?? 0) + (row.type === 'email_bounced' ? 1 : 0)
        return chain
      },
      eq: () => chain,
      in: (_col: string, vals: any[]) => {
        ids = vals
        return chain
      },
      then: (res: any, rej: any) =>
        Promise.resolve({
          data: null,
          error: null,
          count: ids.reduce((n, id) => n + (bounceCounts[id] ?? 0), 0),
        }).then(res, rej),
    }
    return chain
  }

  return {
    client: { from: (t: string) => (t === 'contacts' ? contactsTable() : interactionsTable()) },
    contacts,
    interactions,
  }
}

const mockGetSupabase = jest.fn()

jest.mock('@/lib/supabase', () => ({
  getSupabase: (...args: any[]) => mockGetSupabase(...args),
}))

jest.mock('next/server', () => ({
  NextRequest: jest.fn(),
  NextResponse: {
    json: (body: any, init?: any) => ({
      status: init?.status || 200,
      json: () => body,
      body,
    }),
  },
}))

import { POST } from '@/app/api/webhooks/brevo/route'

describe('POST /api/webhooks/brevo', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  const makeReq = (body: any) => ({ json: jest.fn().mockResolvedValue(body) }) as any

  it('returns 400 for invalid JSON', async () => {
    const res = await POST({ json: jest.fn().mockRejectedValue(new Error('parse error')) } as any)
    expect(res.status).toBe(400)
  })

  it('returns 400 when event or email is missing', async () => {
    const res = await POST(makeReq({ event: 'unsubscribed' }))
    expect(res.status).toBe(400)
  })

  it('handles unsubscribe — sets email_opt_in=false and logs interaction', async () => {
    const store = makeStore([{ id: 'c-001', email: 'test@example.com', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    const res = await POST(makeReq({ event: 'unsubscribed', email: 'test@example.com' }))

    expect(res.json().received).toBe(true)
    expect(store.contacts[0].email_opt_in).toBe(false)
    expect(store.interactions.map(i => i.type)).toContain('email_unsubscribed')
  })

  /**
   * THE regression this rewrite exists for. Brevo lowercases; the row does not.
   */
  it('opts out a contact stored with capitals in its address', async () => {
    const store = makeStore([{ id: 'c-mixed', email: 'BON.Jovi@GMAIL.COM', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    const res = await POST(makeReq({ event: 'unsubscribed', email: 'bon.jovi@gmail.com' }))

    expect(res.json().matched).toBe(1)
    expect(store.contacts[0].email_opt_in).toBe(false)
  })

  /**
   * `ilike` is how the candidates are fetched and it must NOT be the answer:
   * `_` matches any single character in LIKE, so a stranger can be swept up.
   */
  it('does not opt out a different address that an underscore would match', async () => {
    const store = makeStore([
      { id: 'c-a', email: 'first_last@gmail.com', email_opt_in: true },
      { id: 'c-b', email: 'firstXlast@gmail.com', email_opt_in: true },
    ])
    mockGetSupabase.mockReturnValue(store.client)

    await POST(makeReq({ event: 'unsubscribed', email: 'first_last@gmail.com' }))

    expect(store.contacts.find(c => c.id === 'c-a')!.email_opt_in).toBe(false)
    expect(store.contacts.find(c => c.id === 'c-b')!.email_opt_in).toBe(true)
  })

  it('handles hard_bounce — disables email', async () => {
    const store = makeStore([{ id: 'c-002', email: 'bounce@example.com', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    const res = await POST(makeReq({ event: 'hard_bounce', email: 'bounce@example.com' }))

    expect(res.json().received).toBe(true)
    expect(store.contacts[0].email_opt_in).toBe(false)
  })

  it('leaves a contact opted in after a single soft bounce', async () => {
    const store = makeStore([{ id: 'c-soft', email: 'soft@example.com', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    await POST(makeReq({ event: 'soft_bounce', email: 'soft@example.com' }))

    expect(store.contacts[0].email_opt_in).toBe(true)
  })

  it('disables email on the third soft bounce', async () => {
    const store = makeStore([{ id: 'c-soft3', email: 'soft3@example.com', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    await POST(makeReq({ event: 'soft_bounce', email: 'soft3@example.com' }))
    await POST(makeReq({ event: 'soft_bounce', email: 'soft3@example.com' }))
    expect(store.contacts[0].email_opt_in).toBe(true)
    await POST(makeReq({ event: 'soft_bounce', email: 'soft3@example.com' }))
    expect(store.contacts[0].email_opt_in).toBe(false)
  })

  it('handles opened — updates last_engaged_at', async () => {
    const store = makeStore([{ id: 'c-003', email: 'active@example.com', last_engaged_at: null }])
    mockGetSupabase.mockReturnValue(store.client)

    const res = await POST(makeReq({ event: 'opened', email: 'active@example.com' }))

    expect(res.json().received).toBe(true)
    expect(typeof store.contacts[0].last_engaged_at).toBe('string')
  })

  it('handles clicked — logs the link', async () => {
    const store = makeStore([{ id: 'c-004', email: 'click@example.com' }])
    mockGetSupabase.mockReturnValue(store.client)

    const res = await POST(
      makeReq({ event: 'clicked', email: 'click@example.com', link: 'https://hosthampton.com/events' })
    )

    expect(res.json().received).toBe(true)
    expect(store.interactions.find(i => i.type === 'email_clicked')?.metadata.link).toBe(
      'https://hosthampton.com/events'
    )
  })

  it('returns 200 for an unrecognised event (graceful no-op)', async () => {
    const store = makeStore([{ id: 'c-005', email: 'test@example.com', email_opt_in: true }])
    mockGetSupabase.mockReturnValue(store.client)

    const res = await POST(makeReq({ event: 'delivered', email: 'test@example.com' }))

    expect(res.json().received).toBe(true)
    expect(store.contacts[0].email_opt_in).toBe(true)
  })

  it('reports an unknown address rather than pretending it did something', async () => {
    const store = makeStore([])
    mockGetSupabase.mockReturnValue(store.client)

    const res = await POST(makeReq({ event: 'unsubscribed', email: 'nobody@example.com' }))

    expect(res.json().matched).toBe(0)
    expect(store.interactions).toHaveLength(0)
  })
})
