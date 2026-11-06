/**
 * Sending a client a booking link approves the party (lib/linkApproval.ts).
 *
 * Approval is the date check that stops a client booking online before the studio
 * is confirmed free; a person who sends the planner, invoice or portal link has
 * done that check. The send approves, silently, after it succeeded.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { decomment } from '../helpers/sourceScan'

const mockPost = jest.fn()
jest.mock('@/app/api/admin/parties/create/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/parties/[id]/route', () => ({ POST: (...a: unknown[]) => mockPost(...a), PATCH: jest.fn() }))
jest.mock('@/app/api/plan/[ref]/pay-link/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/sequences/enroll/route', () => ({ POST: jest.fn() }))
jest.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { contact_name: 'Pat Example', child_name: 'Sam', event_type: 'birthday', party_type: 'in_studio_theme', booking_ref: 'HH-PTY-APR01' },
            error: null,
          }),
        }),
      }),
    }),
  }),
}))
jest.mock('@/lib/phoneStop', () => ({ phoneHasExplicitStop: async () => 'clear' }))

import { APPROVABLE_ON_LINK_SEND, approveOnLinkSend, linkSendApproves } from '@/lib/linkApproval'
import { buildClientLinksCard } from '@/lib/assistant/messageCard'
import { executeProposal } from '@/lib/assistant/execute'
import { mintProposal } from '@/lib/assistant/proposals'

type Row = Record<string, unknown>
function fakeClient(opts: { rows?: Row[]; updateError?: { message: string } } = {}) {
  const log: Array<{ table: string; op: string; row?: Row; filters: Array<[string, unknown]> }> = []
  const rows = opts.rows ?? [{ id: 'b1', status: 'pending_review' }]
  const from = (table: string) => {
    const filters: Array<[string, unknown]> = []
    const entry: { table: string; op: string; row?: Row; filters: Array<[string, unknown]> } = { table, op: 'select', filters }
    const q: Record<string, unknown> = {}
    q.update = (row: Row) => ((entry.op = 'update'), (entry.row = row), (log.push(entry)), q)
    q.insert = async (row: Row) => (log.push({ table, op: 'insert', row, filters }), { error: null })
    q.eq = (c: string, v: unknown) => (filters.push([c, v]), q)
    q.select = () => q
    q.then = (res: (v: unknown) => unknown) => {
      if (opts.updateError) return Promise.resolve({ data: null, error: opts.updateError }).then(res)
      const matched = rows.filter(r => filters.every(([c, v]) => r[c] === v))
      return Promise.resolve({ data: matched, error: null }).then(res)
    }
    return q
  }
  return { client: { from } as never, log }
}

describe('which sends approve', () => {
  it('a booking link approves a waiting party; an invitation or photos do not', () => {
    for (const s of APPROVABLE_ON_LINK_SEND) {
      expect(linkSendApproves(s, ['planner'])).toBe(true)
      expect(linkSendApproves(s, ['invoice'])).toBe(true)
      expect(linkSendApproves(s, ['portal'])).toBe(true)
      expect(linkSendApproves(s, ['invite'])).toBe(false)
      expect(linkSendApproves(s, ['invite', 'planner'])).toBe(true)
      expect(linkSendApproves(s)).toBe(true) // the portal-link actions pass no kinds
    }
  })

  it('never revives or re-approves anything', () => {
    for (const s of ['cancelled', 'lost', 'approved', 'modifications_locked', 'paid_in_full', 'completed', null, undefined, 7]) {
      expect(linkSendApproves(s, ['planner'])).toBe(false)
    }
  })
})

describe('approveOnLinkSend', () => {
  it('writes the approval columns with the sender\'s name, conditional on the status it read, and logs it', async () => {
    const { client, log } = fakeClient()
    const r = await approveOnLinkSend(client, { bookingId: 'b1', status: 'pending_review', actor: 'admin:a@example.com', via: 'email + text' })
    expect(r).toBe('approved')
    const upd = log.find(l => l.op === 'update')!
    expect(upd.row).toMatchObject({ status: 'approved', approved_by: 'admin:a@example.com' })
    expect(upd.row!.approved_at).toEqual(expect.any(String))
    expect(upd.filters).toEqual([['id', 'b1'], ['status', 'pending_review']])
    const audit = log.find(l => l.table === 'booking_modifications')!
    expect(String(audit.row!.change_summary)).toMatch(/Approved automatically.*No confirmation email/)
  })

  it('leaves a party that changed status in the meantime alone', async () => {
    const { client, log } = fakeClient({ rows: [{ id: 'b1', status: 'cancelled' }] })
    expect(await approveOnLinkSend(client, { bookingId: 'b1', status: 'pending_review', actor: 'a', via: 'text' })).toBe('skipped')
    expect(log.find(l => l.table === 'booking_modifications')).toBeUndefined()
  })

  it('reports a failed write instead of pretending', async () => {
    const { client, log } = fakeClient({ updateError: { message: 'boom' } })
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await approveOnLinkSend(client, { bookingId: 'b1', status: 'pending_review', actor: 'a', via: 'text' })).toBe('failed')
    expect(log.find(l => l.table === 'booking_modifications')).toBeUndefined()
    spy.mockRestore()
  })
})

describe('the assistant card and result', () => {
  const booking = (status: string) => ({
    id: 'b1', booking_ref: 'HH-PTY-APR01', status, contact_name: 'Pat Example', contact_email: 'pat@example.com',
    contact_phone: '6315550123', child_name: 'Sam', event_type: 'birthday', party_type: 'in_studio_theme', party_date: '2026-12-05',
  })
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { slug: 's', archived_at: null }, error: null }) }) }) }) } as never
  const NOW = new Date('2026-11-05T17:00:00Z')

  it('tells the manager, before they confirm, that the send approves the party', async () => {
    const waiting = await buildClientLinksCard(db, booking('pending_review'), { kinds: ['planner'], email: true, sms: false, now: NOW })
    expect(waiting.ok && waiting.preview.status.join(' ')).toMatch(/approves the party.*no separate confirmation email/i)
    const inviteOnly = await buildClientLinksCard(db, booking('pending_review'), { kinds: ['invite'], email: true, sms: false, now: NOW })
    expect(inviteOnly.ok && inviteOnly.preview.status.join(' ')).not.toMatch(/approves the party/)
    const already = await buildClientLinksCard(db, booking('approved'), { kinds: ['planner'], email: true, sms: false, now: NOW })
    expect(already.ok && already.preview.status.join(' ')).not.toMatch(/approves the party/)
  })

  const req = () => new NextRequest('https://www.example.com/api/admin/assistant/confirm', { method: 'POST', headers: { 'content-type': 'application/json' } })
  const card = () =>
    mintProposal({
      kind: 'send_client_links',
      input: { bookingId: 'b1', bookingRef: 'HH-PTY-APR01', links: ['planner'], email: true, sms: false, emailSubject: 'Your planner', emailBody: 'Hi Pat,\n\n{planner}\n\nAllie' },
      title: 't', details: [], actor: 'admin:a@example.com',
    }).proposal
  it('the result says the party is now Approved, or that approving failed', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, sentVia: ['email'], approved: true }), { status: 200 }))
    expect((await executeProposal(req(), card())).message).toMatch(/now Approved/)
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, sentVia: ['email'], approved: false, approvalFailed: true }), { status: 200 }))
    expect((await executeProposal(req(), card())).message).toMatch(/could NOT be marked Approved/)
  })
})

describe('the source shape', () => {
  const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

  it('A1: in all three send actions the approval runs only AFTER the send has succeeded', () => {
    const s = read('app/api/admin/parties/[id]/route.ts')

    const links = s.slice(s.indexOf("if (action === 'send_client_links') {"), s.indexOf("if (action === 'send_checkin_link')"))
    const failed502 = links.indexOf('status: 502')
    const approve1 = links.indexOf('approveOnLinkSend(')
    expect(failed502).toBeGreaterThan(0)
    expect(approve1).toBeGreaterThan(failed502)

    const sms = s.slice(s.indexOf("if (action === 'send_portal_sms') {"), s.indexOf("if (action === 'send_client_links') {"))
    expect(sms.indexOf('approveOnLinkSend(')).toBeGreaterThan(sms.indexOf('Failed to send SMS'))

    const portal = s.slice(s.indexOf("if (action === 'send_portal_link' || action === 'generate_portal_url') {"), s.indexOf("if (action === 'send_portal_sms') {"))
    expect(portal.indexOf('approveOnLinkSend(')).toBeGreaterThan(portal.indexOf("sentVia.push('sms')"))
    expect(portal).toMatch(/sentVia\.length > 0 && linkSendApproves/)
    // minting a link for the manager (generate_portal_url) approves nothing.
    expect(portal.indexOf("action === 'send_portal_link'")).toBeGreaterThan(-1)
  })

  it('A2: it never sends the confirmation email and never touches a payment', () => {
    const s = read('lib/linkApproval.ts')
    expect(s).not.toMatch(/Resend|sendSMS|partyApprovedHtml|booking_payments/)
  })

  it('A3: the update is conditional on the status it read', () => {
    expect(read('lib/linkApproval.ts')).toMatch(/\.eq\('status', opts\.status\)/)
  })
})
