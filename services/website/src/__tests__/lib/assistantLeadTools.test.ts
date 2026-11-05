/**
 * The Manager assistant's lead tools: list_leads, get_first_inquiry,
 * get_sms_thread, get_next_step. Strictly read-only; stages derived; phone
 * numbers masked; "waiting on us" checked against the real text thread.
 */
import fs from 'fs'
import path from 'path'
import { decomment } from '../helpers/sourceScan'

const mockThread = jest.fn()
jest.mock('@/lib/quo', () => ({ fetchQuoThread: (...a: unknown[]) => mockThread(...a) }))
jest.mock('@/lib/media', () => ({
  ...jest.requireActual('@/lib/media'),
  findPhotos: async () => ({ kind: 'ok', data: [{ id: 'p1', url: 'https://www.example.com/a.jpg', alt: 'a' }] }),
}))

type Row = Record<string, unknown>
function fakeDb(tables: Record<string, Row[]>) {
  const writes: string[] = []
  const from = (table: string) => {
    let rows = [...(tables[table] ?? [])]
    const q: Record<string, unknown> = {}
    const chain = () => q
    q.select = chain
    q.eq = (c: string, v: unknown) => ((rows = rows.filter(r => r[c] === v)), q)
    q.in = (c: string, vs: unknown[]) => ((rows = rows.filter(r => vs.includes(r[c]))), q)
    q.gte = (c: string, v: string) => ((rows = rows.filter(r => String(r[c]) >= v)), q)
    q.or = chain
    q.order = (c: string, o?: { ascending?: boolean }) => {
      rows.sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : 1) * (o?.ascending === false ? -1 : 1))
      return q
    }
    q.limit = (n: number) => ((rows = rows.slice(0, n)), q)
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
    for (const w of ['insert', 'update', 'upsert', 'delete']) q[w] = () => { writes.push(`${table}.${w}`); return q }
    return q
  }
  return { client: { from } as never, writes }
}

import { runAssistantTool } from '@/lib/assistant/tools'

const NOW = new Date('2026-11-05T17:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const PHONE_A = '6315550111'
const PHONE_B = '6315550222'

const bookings: Row[] = [
  { id: 'a', booking_ref: 'HH-PTY-AAA01', status: 'lead', contact_id: 'ca', contact_name: 'Ava Example', contact_phone: PHONE_A, party_type: 'in_studio_theme', event_type: 'birthday', party_date: '2026-12-12', guest_count_approx: 10, child_name: 'Zed', total_cents: 0, created_at: hoursAgo(30) },
  { id: 'b', booking_ref: 'HH-PTY-BBB02', status: 'awaiting_deposit', contact_id: 'cb', contact_name: 'Ben Example', contact_phone: PHONE_B, party_type: 'mobile_party', event_type: 'birthday', party_date: '2026-12-20', guest_count_approx: 12, child_name: null, total_cents: 85000, created_at: hoursAgo(50) },
  { id: 'c', booking_ref: 'HH-PTY-CCC03', status: 'deposit_paid', contact_id: 'cc', contact_name: 'Cy Example', contact_phone: '6315550333', party_type: 'in_studio_theme', event_type: 'birthday', party_date: '2026-12-01', guest_count_approx: 8, child_name: null, total_cents: 60000, created_at: hoursAgo(80) },
]
const tables = () => ({
  bookings,
  booking_payments: [{ booking_id: 'c', amount_cents: 25000, payment_type: 'deposit' }],
  ingested_messages: [
    { id: 'm1', booking_id: 'a', direction: 'in', source: 'website_form', sent_at: null, created_at: hoursAgo(30), subject: 'Lead: birthday', body: 'Hi! We want a slime party for 10 kids in December.', parsed: { party_type: 'in_studio_theme', guests: 10, secret_extra: 'x' } },
    { id: 'm2', booking_id: 'b', direction: 'in', source: 'quo', sent_at: hoursAgo(49), created_at: hoursAgo(49) },
  ],
  inquiry_drafts: [],
  booking_modifications: [{ booking_id: 'b', change_summary: 'Links sent to customer (invoice) via email', created_at: hoursAgo(40) }],
  contact_interactions: [],
})

const ctx = (db: ReturnType<typeof fakeDb>) => ({ actor: 'admin:a@example.com', supabase: db.client, now: NOW })
beforeEach(() => mockThread.mockReset().mockResolvedValue({ kind: 'unconfigured' }))

describe('list_leads', () => {
  it('lists open leads with the DERIVED stage, masked phones, and who waits on whom', async () => {
    const db = fakeDb(tables())
    const out = await runAssistantTool('list_leads', {}, ctx(db))
    const r = out.result as { leads: Array<Record<string, unknown>> }
    expect(r.leads.map(l => l.ref)).toEqual(['HH-PTY-AAA01', 'HH-PTY-BBB02'])
    const a = r.leads.find(l => l.ref === 'HH-PTY-AAA01')!
    const b = r.leads.find(l => l.ref === 'HH-PTY-BBB02')!
    expect(a.stage).toBe('inquiry')
    expect(a.waiting_on).toBe('us')
    expect(b.stage).toBe('quoted')
    expect(b.waiting_on).toBe('them') // we sent the invoice after their last text
    expect(JSON.stringify(out.result)).not.toContain(PHONE_A)
    expect(JSON.stringify(out.result)).toContain('***-***-0111')
    expect(db.writes).toEqual([])
  })

  it('a booked party is not an open lead, and stage "booked" finds it', async () => {
    const db = fakeDb(tables())
    const booked = await runAssistantTool('list_leads', { stage: 'booked' }, ctx(db))
    expect((booked.result as { leads: Array<{ ref: string }> }).leads.map(l => l.ref)).toEqual(['HH-PTY-CCC03'])
  })

  it('"waiting on us" is corrected when the Quo thread shows we already replied by hand', async () => {
    mockThread.mockResolvedValue({ kind: 'ok', messages: [{ id: 'q1', at: hoursAgo(29), direction: 'out', text: 'Hi!', hasMedia: false, status: 'delivered' }] })
    const db = fakeDb(tables())
    const out = await runAssistantTool('list_leads', { waiting: 'us' }, ctx(db))
    expect((out.result as { leads: unknown[] }).leads).toEqual([])
  })

  it('says so when the thread could not be checked', async () => {
    mockThread.mockResolvedValue({ kind: 'unavailable', reason: 'down' })
    const out = await runAssistantTool('list_leads', { waiting: 'us' }, ctx(fakeDb(tables())))
    const r = out.result as { leads: unknown[]; note?: string }
    expect(r.leads.length).toBe(1)
    expect(r.note).toMatch(/could not be checked/)
  })

  it('refuses a stage or party type it does not know', async () => {
    const db = fakeDb(tables())
    expect((await runAssistantTool('list_leads', { stage: 'hot' }, ctx(db))).isError).toBe(true)
    expect((await runAssistantTool('list_leads', { party_type: 'yacht' }, ctx(db))).isError).toBe(true)
  })
})

describe('get_first_inquiry', () => {
  it('returns the original message and only the parsed fields it knows', async () => {
    const t = tables()
    ;(t.bookings[0] as Row).first_touch_event_id = 'm1'
    ;(t.ingested_messages[0] as Row).id = 'm1'
    const out = await runAssistantTool('get_first_inquiry', { booking_ref: 'HH-PTY-AAA01' }, ctx(fakeDb(t)))
    const r = out.result as { message_written_by_customer: string; parsed_details: Record<string, unknown> }
    expect(r.message_written_by_customer).toMatch(/slime party/)
    expect(r.parsed_details).toEqual({ party_type: 'in_studio_theme', guests: 10 })
  })

  it('reports an unknown ref as an error, not an empty answer', async () => {
    const out = await runAssistantTool('get_first_inquiry', { booking_ref: 'HH-NOPE' }, ctx(fakeDb(tables())))
    expect(out.isError).toBe(true)
  })
})

describe('get_sms_thread', () => {
  it('returns the Quo thread oldest first, newest last, with the phone masked', async () => {
    mockThread.mockResolvedValue({
      kind: 'ok',
      messages: [
        { id: '1', at: hoursAgo(5), direction: 'in', text: 'Is Saturday open?', hasMedia: false, status: 'received' },
        { id: '2', at: hoursAgo(4), direction: 'out', text: 'Yes!', hasMedia: false, status: 'delivered' },
      ],
    })
    const out = await runAssistantTool('get_sms_thread', { booking_ref: 'HH-PTY-AAA01' }, ctx(fakeDb(tables())))
    const r = out.result as { complete: boolean; messages: Array<{ from: string }> }
    expect(r.complete).toBe(true)
    expect(r.messages.map(m => m.from)).toEqual(['customer', 'us'])
    expect(JSON.stringify(out.result)).not.toContain(PHONE_A)
  })

  it('falls back to recorded inbound texts and says the thread is incomplete', async () => {
    mockThread.mockResolvedValue({ kind: 'unavailable', reason: 'down' })
    const t = tables()
    t.ingested_messages.push({ id: 'm9', booking_id: 'a', direction: 'in', source: 'quo', sent_at: hoursAgo(3), created_at: hoursAgo(3), body: 'Hello?' } as never)
    const out = await runAssistantTool('get_sms_thread', { booking_ref: 'HH-PTY-AAA01' }, ctx(fakeDb(t)))
    const r = out.result as { complete: boolean; note: string; messages: unknown[] }
    expect(r.complete).toBe(false)
    expect(r.note).toMatch(/Do not say a lead is unanswered/)
    expect(r.messages.length).toBe(1)
  })
})

describe('get_next_step', () => {
  it('an unpriced inquiry waiting on us: reply first, then planner and photos — nothing is sent', async () => {
    const db = fakeDb(tables())
    const out = await runAssistantTool('get_next_step', { booking_ref: 'HH-PTY-AAA01' }, ctx(db))
    const r = out.result as { stage: string; actions: Array<{ tool: string }> }
    expect(r.stage).toBe('inquiry')
    expect(r.actions.map(a => a.tool)).toEqual(['get_sms_thread', 'propose_send_client_links', 'propose_send_photos'])
    expect(out.proposal).toBeUndefined()
    expect(db.writes).toEqual([])
  })

  it('a priced, unpaid quote points at the invoice and the deposit link', async () => {
    const out = await runAssistantTool('get_next_step', { booking_ref: 'HH-PTY-BBB02' }, ctx(fakeDb(tables())))
    const r = out.result as { actions: Array<{ how?: string }> }
    expect(r.actions.some(a => /invoice/.test(a.how ?? ''))).toBe(true)
  })
})

describe('the source shape', () => {
  const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))
  it('L1: the lead modules only read — no write call, no sender, no select("*"), no notes column', () => {
    for (const f of ['lib/assistant/leadView.ts', 'lib/assistant/leadTools.ts']) {
      const s = read(f)
      expect({ f, writes: s.match(/\.(insert|update|upsert|delete)\s*\(/g) }).toEqual({ f, writes: null })
      expect(s).not.toMatch(/select\(\s*['"`]\*/)
      expect(s).not.toMatch(/\bnotes\b/)
      expect(s).not.toMatch(/sendSMS|new Resend\(|mintProposal/)
    }
  })

  it('L2: a phone leaves the lead views only through maskPhone', () => {
    const s = read('lib/assistant/leadView.ts')
    expect(s).toMatch(/phone: maskPhone\(/)
    expect(s).not.toMatch(/phone: b\.contact_phone/)
  })
})
