/**
 * lib/reviewTextArchive.ts — the automatic "swipe to Done" for review texts.
 * The rule that matters: a thread the customer has replied to is NEVER archived.
 */
import { archiveReviewTextThreads, quoMessageIdFrom, ARCHIVED_REVIEW_TEXT_TYPES } from '@/lib/reviewTextArchive'

const OLD_ENV = process.env
const NOW = new Date('2026-10-12T17:30:00Z')

beforeEach(() => {
  jest.restoreAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  process.env = { ...OLD_ENV, QUO_API_KEY: 'quo_test_key' }
})
afterAll(() => { process.env = OLD_ENV })

/** A supabase double that records the filters it was given. */
function fakeSupabase(rows: any[], error: any = null) {
  const calls: Record<string, any[]> = {}
  const chain: any = {}
  for (const m of ['from', 'select', 'in', 'eq', 'gte', 'lte']) {
    chain[m] = (...args: any[]) => { calls[m] = args; return chain }
  }
  chain.then = (res: any) => res({ data: error ? null : rows, error })
  return { client: chain, calls }
}

interface QuoState {
  messages: Record<string, { conversationId: string; phoneNumberId: string } | number>
  conversations: { id: string; lastActivityId: string }[] | number
  markStatus?: number
}

function mockQuo(state: QuoState) {
  const marked: string[] = []
  const fn = jest.fn(async (url: string, opts: any) => {
    expect(opts.headers.Authorization).toBe('quo_test_key')
    expect(opts.headers['Quo-Api-Version']).toBe('2026-03-30')
    const u = new URL(url)
    const reply = (status: number, body: any) => ({ status, json: async () => body })
    let m = /^\/messages\/(.+)$/.exec(u.pathname)
    if (m) {
      const v = state.messages[decodeURIComponent(m[1])]
      if (v === undefined) return reply(404, {})
      if (typeof v === 'number') return reply(v, {})
      return reply(200, { data: { id: m[1], ...v } })
    }
    if (u.pathname === '/conversations') {
      if (typeof state.conversations === 'number') return reply(state.conversations, {})
      return reply(200, { data: state.conversations, nextCursor: null })
    }
    m = /^\/conversations\/(.+)\/mark-as-done$/.exec(u.pathname)
    if (m && opts.method === 'POST') {
      marked.push(decodeURIComponent(m[1]))
      return reply(state.markStatus ?? 200, { data: { id: m[1] } })
    }
    throw new Error(`unexpected Quo call ${opts.method} ${url}`)
  })
  ;(global as any).fetch = fn
  return { fn, marked }
}

const row = (msg: string, minutesAgo = 20) => ({
  id: `r-${msg}`,
  last_outcome: `quo:${msg}`,
  sent_at: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
})

describe('quoMessageIdFrom', () => {
  it('reads only a quo message id', () => {
    expect(quoMessageIdFrom('quo:ACtestReviewText01')).toBe('ACtestReviewText01')
    expect(quoMessageIdFrom('twilio:SM123')).toBeNull()
    expect(quoMessageIdFrom('quo:AC1/../x')).toBeNull()
    expect(quoMessageIdFrom(null)).toBeNull()
  })
})

describe('archiveReviewTextThreads', () => {
  it('archives a thread whose last activity is still our review text', async () => {
    const { client } = fakeSupabase([row('AC1')])
    const { marked } = mockQuo({
      messages: { AC1: { conversationId: 'CN1', phoneNumberId: 'PN1' } },
      conversations: [{ id: 'CN1', lastActivityId: 'AC1' }],
    })
    const s = await archiveReviewTextThreads(client, NOW, 0)
    expect(marked).toEqual(['CN1'])
    expect(s).toMatchObject({ ok: true, examined: 1, archived: 1, leftOpen: 0, failed: 0 })
  })

  it('NEVER archives a thread the customer has replied to', async () => {
    const { client } = fakeSupabase([row('AC1'), row('AC2')])
    const { marked } = mockQuo({
      messages: {
        AC1: { conversationId: 'CN1', phoneNumberId: 'PN1' },
        AC2: { conversationId: 'CN2', phoneNumberId: 'PN1' },
      },
      conversations: [
        { id: 'CN1', lastActivityId: 'AC_their_reply' },
        { id: 'CN2', lastActivityId: 'AC2' },
      ],
    })
    const s = await archiveReviewTextThreads(client, NOW, 0)
    expect(marked).toEqual(['CN2'])
    expect(s).toMatchObject({ archived: 1, leftOpen: 1 })
  })

  it('reads only sent review texts inside the settle..window band', async () => {
    const { client, calls } = fakeSupabase([])
    mockQuo({ messages: {}, conversations: [] })
    const s = await archiveReviewTextThreads(client, NOW, 0)
    expect(calls.from).toEqual(['scheduled_reminders'])
    expect(calls.in).toEqual(['reminder_type', [...ARCHIVED_REVIEW_TEXT_TYPES]])
    expect(calls.eq).toEqual(['status', 'sent'])
    expect(calls.gte).toEqual(['sent_at', '2026-10-12T16:00:00.000Z'])
    expect(calls.lte).toEqual(['sent_at', '2026-10-12T17:27:00.000Z'])
    expect(s).toMatchObject({ ok: true, examined: 0 })
    expect((global as any).fetch).not.toHaveBeenCalled()
  })

  it('a thread missing from the listing is a failure, not an archive', async () => {
    const { client } = fakeSupabase([row('AC1'), row('AC2')])
    const { marked } = mockQuo({
      messages: {
        AC1: { conversationId: 'CN1', phoneNumberId: 'PN1' },
        AC2: { conversationId: 'CN2', phoneNumberId: 'PN1' },
      },
      conversations: [{ id: 'CN2', lastActivityId: 'AC2' }],
    })
    const s = await archiveReviewTextThreads(client, NOW, 0)
    expect(marked).toEqual(['CN2'])
    expect(s).toMatchObject({ ok: true, archived: 1, failed: 1 })
  })

  it('a failed conversation listing archives nothing and reports not-ok', async () => {
    const { client } = fakeSupabase([row('AC1')])
    const { marked } = mockQuo({
      messages: { AC1: { conversationId: 'CN1', phoneNumberId: 'PN1' } },
      conversations: 500,
    })
    const s = await archiveReviewTextThreads(client, NOW, 0)
    expect(marked).toEqual([])
    expect(s).toMatchObject({ ok: false, archived: 0, failed: 1 })
  })

  it('a refused mark-as-done is counted as failed', async () => {
    const { client } = fakeSupabase([row('AC1')])
    mockQuo({
      messages: { AC1: { conversationId: 'CN1', phoneNumberId: 'PN1' } },
      conversations: [{ id: 'CN1', lastActivityId: 'AC1' }],
      markStatus: 403,
    })
    const s = await archiveReviewTextThreads(client, NOW, 0)
    expect(s).toMatchObject({ ok: false, archived: 0, failed: 1 })
  })

  it('a database read failure is reported, and Quo is not called', async () => {
    const { client } = fakeSupabase([], { message: 'boom' })
    mockQuo({ messages: {}, conversations: [] })
    const s = await archiveReviewTextThreads(client, NOW, 0)
    expect(s.ok).toBe(false)
    expect(s.reason).toMatch(/boom/)
    expect((global as any).fetch).not.toHaveBeenCalled()
  })

  it('skips rows that were not sent through Quo', async () => {
    const { client } = fakeSupabase([{ id: 'x', last_outcome: 'twilio:SM1', sent_at: NOW.toISOString() }])
    mockQuo({ messages: {}, conversations: [] })
    const s = await archiveReviewTextThreads(client, NOW, 0)
    expect(s).toMatchObject({ ok: true, examined: 0 })
  })
})
