/**
 * Nurture from the Manager assistant: the enrol card (steps + the first email as
 * it will be read), the enroll route (consent, stage and duplicates re-checked,
 * one row written, nothing sent), and the promise that the card makes about the
 * sender being off.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { decomment } from '../helpers/sourceScan'

type Row = Record<string, unknown>
const db: { tables: Record<string, Row[]>; inserts: Array<{ table: string; row: Row }> } = { tables: {}, inserts: [] }

function from(table: string) {
  let rows = [...(db.tables[table] ?? [])]
  const q: Record<string, unknown> = {}
  q.select = () => q
  q.eq = (c: string, v: unknown) => ((rows = rows.filter(r => r[c] === v)), q)
  q.in = (c: string, vs: unknown[]) => ((rows = rows.filter(r => vs.includes(r[c]))), q)
  q.order = () => q
  q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null })
  q.insert = async (row: Row) => {
    db.inserts.push({ table, row })
    return { error: null }
  }
  q.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res)
  return q
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from }) }))

import { buildEnrolCard, SEQUENCE_SENDER_SCHEDULED } from '@/lib/assistant/nurture'
import { POST as enroll } from '@/app/api/admin/sequences/enroll/route'

const SEQ = 'aaaaaaaa-0000-4000-8000-0000000000e1'
const LEAD = { id: 'b1', booking_ref: 'HH-PTY-NUR01', status: 'lead', contact_id: 'c1', contact_name: 'Pat Example', contact_email: 'pat@example.com', contact_phone: '6315550123', party_date: '2099-01-10', total_cents: 0 }
const NOW = new Date('2026-11-05T17:00:00Z')

function seed(over: { contact?: Row; booking?: Row; enrollments?: Row[]; active?: boolean; payments?: Row[] } = {}) {
  db.inserts = []
  db.tables = {
    bookings: [{ ...LEAD, ...over.booking }],
    booking_payments: over.payments ?? [],
    contacts: [{ id: 'c1', email: 'pat@example.com', first_name: 'Pat', email_opt_in: true, status: 'subscribed', ...over.contact }],
    email_sequences: [{ id: SEQ, name: 'Lead Follow-Up', trigger_event: 'new_inquiry', service_filter: null, is_active: over.active ?? true }],
    email_sequence_steps: [
      { sequence_id: SEQ, step_number: 1, subject: 'Still thinking about your event, {{first_name}}?', body_html: '<p>Hi {{first_name}}, we would love to host you.</p>', body_text: 'Hi {{first_name}}, we would love to host you.', delay_days: 2, delay_reference: 'enrollment' },
      { sequence_id: SEQ, step_number: 2, subject: 'One more thing', body_html: '<p>Hello</p>', body_text: null, delay_days: 6, delay_reference: 'enrollment' },
    ],
    contact_sequence_enrollments: over.enrollments ?? [],
  }
}

beforeAll(() => {
  process.env.ADMIN_PASSWORD = 'nurture-test-admin'
  process.env.ADMIN_SESSION_SECRET = 'nurture-test-secret'
  process.env.PORTAL_LINK_SIGNING_SECRET = 'nurture-portal-secret'
})

const call = (body: unknown, authed = true) =>
  enroll(
    new NextRequest('https://www.example.com/api/admin/sequences/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(authed ? { authorization: 'Bearer nurture-test-admin' } : {}) },
      body: JSON.stringify(body),
    }),
  )

describe('buildEnrolCard', () => {
  it('shows the steps and the first email, rendered for the lead, with the recipient masked', async () => {
    seed()
    const r = await buildEnrolCard({ from } as never, LEAD, SEQ, NOW)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.details.join(' ')).toMatch(/Step 1/)
    expect(r.details.join(' ')).toMatch(/Step 2/)
    const mail = r.preview.channels[0]
    expect(mail.subject).toBe('Still thinking about your event, Pat?')
    expect(mail.display).toMatch(/Hi Pat, we would love to host you/)
    expect(mail.display).toMatch(/Unsubscribe/i)
    expect(mail.to).toBe('p***@example.com')
    expect(mail.editable).toBe(false)
    expect(r.preview.level).toBe('ok')
    expect(r.preview.status.join(' ')).toMatch(/Nothing is sent now/)
    expect(JSON.stringify(r)).not.toContain('pat@example.com')
  })

  it.each([
    ['an opted-out contact', { contact: { email_opt_in: false } }, /opted out/],
    ['an unsubscribed contact', { contact: { status: 'unsubscribed' } }, /opted out/],
    ['a booked party', { booking: { status: 'deposit_paid' } }, /nurture is for leads/],
    ['a party with money on it', { payments: [{ booking_id: 'b1', amount_cents: 25000, payment_type: 'deposit' }] }, /nurture is for leads/],
    ['an existing enrollment', { enrollments: [{ contact_id: 'c1', sequence_id: SEQ, status: 'active' }] }, /Already enrolled/],
    ['a switched-off sequence', { active: false }, /switched off/],
  ])('marks the card blocked for %s', async (_why, over, expected) => {
    seed(over as never)
    const r = await buildEnrolCard({ from } as never, { ...LEAD, ...((over as { booking?: Row }).booking ?? {}) }, SEQ, NOW)
    expect(r.ok && r.preview.level).toBe('blocked')
    expect(r.ok && r.preview.status.join(' ')).toMatch(expected)
  })
})

describe('POST /api/admin/sequences/enroll', () => {
  it('is admin only', async () => {
    seed()
    expect((await call({ bookingId: 'b1', sequenceId: SEQ }, false)).status).toBe(401)
    expect(db.inserts).toEqual([])
  })

  it('writes exactly one active enrollment row for a consenting lead — and nothing else', async () => {
    seed()
    const res = await call({ bookingId: 'b1', sequenceId: SEQ })
    expect(res.status).toBe(200)
    const enrol = db.inserts.filter(i => i.table === 'contact_sequence_enrollments')
    expect(enrol).toHaveLength(1)
    expect(enrol[0].row).toMatchObject({ contact_id: 'c1', sequence_id: SEQ, status: 'active', current_step: 0 })
    expect((enrol[0].row.metadata as Row).booking_ref).toBe('HH-PTY-NUR01')
    expect(db.inserts.map(i => i.table).filter(t => t !== 'contact_sequence_enrollments' && t !== 'booking_modifications')).toEqual([])
  })

  it.each([
    ['opted out', { contact: { email_opt_in: false } }],
    ['unsubscribed', { contact: { status: 'unsubscribed' } }],
    ['already booked', { booking: { status: 'paid_in_full' } }],
    ['already enrolled', { enrollments: [{ contact_id: 'c1', sequence_id: SEQ, status: 'paused' }] }],
    ['sequence off', { active: false }],
  ])('refuses (409) and writes nothing when the lead is %s', async (_why, over) => {
    seed(over as never)
    const res = await call({ bookingId: 'b1', sequenceId: SEQ })
    expect(res.status).toBe(409)
    expect(db.inserts.filter(i => i.table === 'contact_sequence_enrollments')).toEqual([])
  })

  it('needs both ids', async () => {
    seed()
    expect((await call({ bookingId: 'b1' })).status).toBe(400)
  })
})

describe('the source shape', () => {
  const root = path.join(process.cwd(), '..', '..')
  const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

  it('N1: the card says the sender is off only while it is — the constant matches scripts/cron/jobs.tsv', () => {
    const jobs = fs.readFileSync(path.join(root, 'scripts', 'cron', 'jobs.tsv'), 'utf8')
    const scheduled = jobs.split(/\r?\n/).some(l => !l.trim().startsWith('#') && /process-sequences/.test(l))
    expect(SEQUENCE_SENDER_SCHEDULED).toBe(scheduled)
  })

  it('N2: enrolling never runs the sender and never sends mail', () => {
    for (const f of ['app/api/admin/sequences/enroll/route.ts', 'lib/assistant/nurture.ts']) {
      const s = read(f)
      expect({ f, hit: s.match(/processSequences\s*\(|new Resend\(|sendSMS|sendEmail\(/) }).toEqual({ f, hit: null })
    }
  })

  it('N3: the enroll route authorises first and re-reads consent through optedOutReason before it writes', () => {
    const s = read('app/api/admin/sequences/enroll/route.ts')
    const auth = s.indexOf('isAdminAuthorized(req)')
    const consent = s.indexOf('optedOutReason(contact')
    const write = s.indexOf(".from('contact_sequence_enrollments').insert(")
    expect([auth, consent, write].every(i => i > 0)).toBe(true)
    expect(auth).toBeLessThan(consent)
    expect(consent).toBeLessThan(write)
  })

  it('N4: execute.ts replays the enroll route, not a re-implementation', () => {
    const s = read('lib/assistant/execute.ts')
    expect(s).toMatch(/from '@\/app\/api\/admin\/sequences\/enroll\/route'/)
  })
})
