/**
 * Status changes from the Manager assistant: approve, reopen, and the pledged
 * payments list. Every change is a card a person confirms; each is carried out by
 * the dashboard's own action; the card says in plain words what the client will
 * be told.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { decomment } from '../helpers/sourceScan'

const mockInvoice = jest.fn()
jest.mock('@/lib/planInvoice', () => ({
  ...jest.requireActual('@/lib/planInvoice'),
  loadPlanInvoice: (...a: unknown[]) => mockInvoice(...a),
}))
const mockPost = jest.fn()
jest.mock('@/app/api/admin/parties/create/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/parties/[id]/route', () => ({ POST: (...a: unknown[]) => mockPost(...a), PATCH: jest.fn() }))
jest.mock('@/app/api/plan/[ref]/pay-link/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/sequences/enroll/route', () => ({ POST: jest.fn() }))

type Row = Record<string, unknown>
let tables: Record<string, Row[]> = {}
const writes: string[] = []
const fakeDb = {
  from: (table: string) => {
    let rows = [...(tables[table] ?? [])]
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = (c: string, v: unknown) => ((rows = rows.filter(r => r[c] === v)), q)
    q.in = (c: string, vs: unknown[]) => ((rows = rows.filter(r => vs.includes(r[c]))), q)
    q.gte = (c: string, v: string) => ((rows = rows.filter(r => String(r[c]) >= v)), q)
    q.ilike = () => q
    q.order = () => q
    q.limit = () => q
    q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
    q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
    for (const w of ['insert', 'update', 'upsert', 'delete']) q[w] = () => (writes.push(`${table}.${w}`), q)
    return q
  },
}

import { runAssistantTool } from '@/lib/assistant/tools'
import { executeProposal } from '@/lib/assistant/execute'
import { mintProposal } from '@/lib/assistant/proposals'

const NOW = new Date('2026-11-05T17:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()
const ctx = { actor: 'admin:a@example.com', supabase: fakeDb as never, now: NOW }

const party = (over: Row = {}): Row => ({
  id: 'bbbbbbbb-0000-4000-8000-0000000000f1', booking_ref: 'HH-PTY-STA01', status: 'pending_review',
  contact_name: 'Nicole Example', contact_email: 'nicole@example.com', contact_phone: '6315550177',
  child_name: 'Rae', child_age: 7, party_type: 'in_studio_theme', event_type: 'birthday',
  party_date: '2026-12-12', party_time: '14:00', guest_count_approx: 10, package_type: null, admin_notes: null, total_cents: 85000,
  ...over,
})
const invoice = (over: Record<string, number> = {}) => ({ ok: true, invoice: { totalCents: 85000, paidCents: 25000, outstandingCents: 60000, guestCount: 10, ...over } })

beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = 'status-tools-secret'
})
beforeEach(() => {
  tables = { bookings: [party()] }
  writes.length = 0
  mockPost.mockReset()
  mockInvoice.mockReset().mockResolvedValue(invoice())
})

describe('propose_approve_party', () => {
  it('shows exactly what will happen: the status, the money, and that the client is emailed', async () => {
    const out = await runAssistantTool('propose_approve_party', { booking_ref: 'HH-PTY-STA01' }, ctx)
    expect(out.isError).toBeFalsy()
    const text = out.proposal!.proposal.details.join(' ')
    expect(text).toMatch(/pending_review → approved/)
    expect(text).toMatch(/Emails the client \(n\*\*\*@example\.com\)/)
    expect(text).toMatch(/Your Party is Confirmed!/)
    expect(text).toMatch(/\$600\.00/)
    expect(text).not.toContain('nicole@example.com')
    expect(out.proposal!.proposal.input.sendEmail).toBe(true)
    expect(writes).toEqual([])
  })

  it('can approve without telling the client, and says so on the card', async () => {
    const out = await runAssistantTool('propose_approve_party', { booking_ref: 'HH-PTY-STA01', send_confirmation_email: false }, ctx)
    expect(out.proposal!.proposal.input.sendEmail).toBe(false)
    expect(out.proposal!.proposal.details.join(' ')).toMatch(/NOT emailed/)
  })

  it.each([
    ['a cancelled party', { status: 'cancelled' }, /propose_reopen_party/],
    ['a lost party', { status: 'lost' }, /propose_reopen_party/],
    ['one that is already approved', { status: 'approved' }, /already approved/],
    ['one that is paid in full', { status: 'paid_in_full' }, /already paid_in_full/],
  ])('refuses %s', async (_why, over, expected) => {
    tables.bookings = [party(over as Row)]
    const out = await runAssistantTool('propose_approve_party', { booking_ref: 'HH-PTY-STA01' }, ctx)
    expect(out.isError).toBe(true)
    expect(out.proposal).toBeUndefined()
    expect(JSON.stringify(out.result)).toMatch(expected)
  })

  it('will not email a $0.00 confirmation, or email an address that is not there', async () => {
    mockInvoice.mockResolvedValue(invoice({ totalCents: 0, outstandingCents: 0, paidCents: 0 }))
    const unpriced = await runAssistantTool('propose_approve_party', { booking_ref: 'HH-PTY-STA01' }, ctx)
    expect(unpriced.isError).toBe(true)
    expect(JSON.stringify(unpriced.result)).toMatch(/no price yet/)
    // …but the manager can still approve it without the email.
    const quiet = await runAssistantTool('propose_approve_party', { booking_ref: 'HH-PTY-STA01', send_confirmation_email: false }, ctx)
    expect(quiet.isError).toBeFalsy()

    mockInvoice.mockResolvedValue(invoice())
    tables.bookings = [party({ contact_email: null })]
    const noMail = await runAssistantTool('propose_approve_party', { booking_ref: 'HH-PTY-STA01' }, ctx)
    expect(noMail.isError).toBe(true)
    expect(JSON.stringify(noMail.result)).toMatch(/no valid email/)
  })

  it('says it cannot tell when it cannot read the money', async () => {
    mockInvoice.mockResolvedValue({ ok: false })
    expect((await runAssistantTool('propose_approve_party', { booking_ref: 'HH-PTY-STA01' }, ctx)).isError).toBe(true)
  })
})

describe('propose_reopen_party', () => {
  it('reopens a priced cancelled party as Quoted and an unpriced lost one as Lead', async () => {
    tables.bookings = [party({ status: 'cancelled', total_cents: 85000 })]
    const a = await runAssistantTool('propose_reopen_party', { booking_ref: 'HH-PTY-STA01' }, ctx)
    expect(a.proposal!.proposal.title).toMatch(/as Quoted/)
    tables.bookings = [party({ status: 'lost', total_cents: 0 })]
    const b = await runAssistantTool('propose_reopen_party', { booking_ref: 'HH-PTY-STA01' }, ctx)
    expect(b.proposal!.proposal.title).toMatch(/as Lead/)
    expect(b.proposal!.proposal.details.join(' ')).toMatch(/sent nothing/)
  })

  it('refuses a party that is not lost or cancelled', async () => {
    expect((await runAssistantTool('propose_reopen_party', { booking_ref: 'HH-PTY-STA01' }, ctx)).isError).toBe(true)
  })
})

describe('confirming them', () => {
  const req = () => new NextRequest('https://www.example.com/api/admin/assistant/confirm', { method: 'POST', headers: { 'content-type': 'application/json' } })
  const card = (kind: 'approve_party' | 'reopen_party', input: Row) =>
    mintProposal({ kind, input: { bookingId: 'b1', bookingRef: 'HH-PTY-STA01', ...input }, title: 't', details: [], actor: 'admin:a@example.com' }).proposal
  const body = async () => JSON.parse(await (mockPost.mock.calls[0][0] as NextRequest).text())

  it('approve replays the dashboard action and asks for the email unless the card said not to', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, action: 'approved' }), { status: 200 }))
    const r = await executeProposal(req(), card('approve_party', { sendEmail: true }))
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/emailed the confirmation/)
    expect(await body()).toEqual({ action: 'approve' })

    mockPost.mockClear().mockResolvedValue(new Response(JSON.stringify({ ok: true, emailed: false, emailSkippedByAdmin: true }), { status: 200 }))
    const q = await executeProposal(req(), card('approve_party', { sendEmail: false }))
    expect(q.message).toMatch(/not emailed \(as you asked\)/)
    expect(await body()).toEqual({ action: 'approve', send_email: false })
  })

  it('says plainly when the confirmation email did not go out', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, emailed: false }), { status: 200 }))
    const r = await executeProposal(req(), card('approve_party', { sendEmail: true }))
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/did NOT go out/)
  })

  it('a refusal from the route is a refusal', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ error: 'This booking is cancelled — reopen it first.' }), { status: 409 }))
    const r = await executeProposal(req(), card('approve_party', { sendEmail: true }))
    expect(r.ok).toBe(false)
    expect(r.status).toBe(409)
  })

  it('reopen replays the dashboard action', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, status: 'quoted' }), { status: 200 }))
    const r = await executeProposal(req(), card('reopen_party', {}))
    expect(r.message).toMatch(/Reopened HH-PTY-STA01 as quoted/)
    expect(await body()).toEqual({ action: 'reopen' })
  })
})

describe('list_payment_pledges', () => {
  it('lists what customers said they would send, flags the ones already written down, and skips dead parties', async () => {
    tables = {
      bookings: [
        party({ id: 'a', booking_ref: 'HH-PTY-PLG01' }),
        party({ id: 'b', booking_ref: 'HH-PTY-PLG02', contact_name: 'Ben Example' }),
        party({ id: 'c', booking_ref: 'HH-PTY-PLG03', status: 'cancelled' }),
      ],
      booking_modifications: [
        { booking_id: 'a', change_summary: 'Customer pledged $250.00 via venmo — awaiting admin reconciliation', new_data: { amount_cents: 25000, method: 'venmo' }, created_at: hoursAgo(5) },
        { booking_id: 'b', change_summary: 'Customer pledged $100.00 via zelle — awaiting admin reconciliation', new_data: { amount_cents: 10000, method: 'zelle' }, created_at: hoursAgo(30) },
        { booking_id: 'c', change_summary: 'Customer pledged $50.00 via cash — awaiting admin reconciliation', new_data: { amount_cents: 5000, method: 'cash' }, created_at: hoursAgo(30) },
      ],
      booking_payments: [{ booking_id: 'b', amount_cents: 10000, payment_type: 'partial', paid_at: hoursAgo(2) }],
    }
    const out = await runAssistantTool('list_payment_pledges', {}, ctx)
    const r = out.result as { count: number; pledges: Array<{ ref: string; pledged: string; payment_recorded_since: boolean }> }
    expect(r.count).toBe(2)
    const a = r.pledges.find(p => p.ref === 'HH-PTY-PLG01')!
    const b = r.pledges.find(p => p.ref === 'HH-PTY-PLG02')!
    expect(a.pledged).toMatch(/\$250\.00 by venmo/)
    expect(a.payment_recorded_since).toBe(false)
    expect(b.payment_recorded_since).toBe(true)
    expect(r.pledges.some(p => p.ref === 'HH-PTY-PLG03')).toBe(false)
    expect(writes).toEqual([])
  })
})

describe('the source shape', () => {
  const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

  it('S1: the approve route refuses a cancelled/lost party BEFORE it writes the status, and the no-email path returns before any link is minted', () => {
    const s = read('app/api/admin/parties/[id]/route.ts')
    const start = s.indexOf("if (action === 'approve') {")
    const end = s.indexOf("if (action === 'request_changes') {")
    const body = s.slice(start, end)
    const guard = body.indexOf("booking.status === 'cancelled' || booking.status === 'lost'")
    const write = body.indexOf("status: 'approved'")
    expect(guard).toBeGreaterThan(0)
    expect(guard).toBeLessThan(write)
    expect(body).toMatch(/const notifyCustomer = body\.send_email !== false/)
    // Both the rental branch and the party branch leave before they mint a link or email.
    const skips = Array.from(body.matchAll(/if \(!notifyCustomer\) \{/g)).map(m => m.index as number)
    expect(skips).toHaveLength(2)
    expect(skips[0]).toBeLessThan(body.indexOf('mintPortalLinks('))
    expect(skips[1]).toBeLessThan(body.indexOf('mintPortalLink(supabase, id, booking.booking_ref)'))
    // The deliberate skip is written into the change log.
    expect(body.match(/deliberately NOT sent/g)).toHaveLength(2)
  })

  it('S2: the new executors replay the dashboard action and write nothing themselves', () => {
    const s = read('lib/assistant/execute.ts')
    expect(s).toMatch(/action: 'approve'/)
    expect(s).toMatch(/action: 'reopen'/)
    expect(s.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
  })

  it('S3: the status tools in tools.ts are proposals that touch no table', () => {
    const s = read('lib/assistant/tools.ts')
    expect(s.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
    expect(s).toMatch(/async function proposeApproveParty/)
    expect(s).toMatch(/async function proposeReopenParty/)
  })

  it('S4: the pledge list is read-only', () => {
    const s = read('lib/assistant/leadView.ts')
    expect(s.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
    expect(s).toMatch(/export async function listPledges/)
  })
})
