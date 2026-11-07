/**
 * Party links for the manager: the admin view of a party, and the invoice /
 * planner / portal pages as links the manager can open or copy.
 *
 * The admin view is a plain link. The client pages are SIGN-IN links, so they come
 * from a confirmed card, are never sent anywhere, and are never saved in the chat.
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

const BOOKING = {
  id: 'bbbbbbbb-0000-4000-8000-0000000000d1',
  booking_ref: 'HH-PTY-LNK01',
  status: 'awaiting_deposit',
  contact_name: 'Pat Example',
  contact_email: 'pat@example.com',
  contact_phone: '6315550123',
  child_name: 'Sam',
  party_type: 'in_studio_theme',
  party_date: '2026-12-05',
}
let row: Record<string, unknown> | null = BOOKING
const writes: string[] = []
const fakeDb = {
  from: (table: string) => {
    const q: Record<string, unknown> = {}
    q.select = () => q
    q.eq = () => q
    q.maybeSingle = async () => ({ data: row, error: null })
    for (const w of ['insert', 'update', 'upsert', 'delete']) q[w] = () => (writes.push(`${table}.${w}`), q)
    return q
  },
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => fakeDb }))

import { runAssistantTool } from '@/lib/assistant/tools'
import { executeProposal } from '@/lib/assistant/execute'
import { mintProposal } from '@/lib/assistant/proposals'
import { CANONICAL_ORIGIN } from '@/lib/publicOrigin'
import { GET as resolve } from '@/app/api/admin/parties/resolve/route'

const ctx = { actor: 'admin:a@example.com', supabase: fakeDb as never, now: new Date('2026-11-05T17:00:00Z') }
beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = 'party-links-secret'
  process.env.ADMIN_PASSWORD = 'party-links-admin'
})
beforeEach(() => {
  row = BOOKING
  writes.length = 0
  mockPost.mockReset()
})

describe('get_party_links', () => {
  it('gives the admin page link for the party and writes nothing', async () => {
    const out = await runAssistantTool('get_party_links', { booking_ref: 'HH-PTY-LNK01' }, ctx)
    const r = out.result as { admin_party_page: string; lead_thread: string }
    expect(r.admin_party_page).toBe(`${CANONICAL_ORIGIN}/admin?tab=parties&party=${BOOKING.id}`)
    expect(r.lead_thread).toBe(`${CANONICAL_ORIGIN}/admin/lead/HH-PTY-LNK01`)
    expect(JSON.stringify(out.result)).not.toMatch(/token=|portal\/auth/)
    expect(writes).toEqual([])
  })

  it('says so when there is no such party', async () => {
    row = null
    expect((await runAssistantTool('get_party_links', { booking_ref: 'HH-NOPE' }, ctx)).isError).toBe(true)
  })
})

describe('propose_party_link', () => {
  it('draws a card that says it is not sent, and makes nothing', async () => {
    const out = await runAssistantTool('propose_party_link', { booking_ref: 'HH-PTY-LNK01', destination: 'invoice' }, ctx)
    expect(out.isError).toBeFalsy()
    expect(out.proposal?.proposal.kind).toBe('party_link')
    const text = out.proposal!.proposal.details.join(' ')
    expect(text).toMatch(/NOT sent to the client/)
    expect(text).toMatch(/signed in as them/)
    expect(writes).toEqual([])
  })

  it('refuses an unknown destination and a cancelled party', async () => {
    expect((await runAssistantTool('propose_party_link', { booking_ref: 'HH-PTY-LNK01', destination: 'admin' }, ctx)).isError).toBe(true)
    row = { ...BOOKING, status: 'cancelled' }
    expect((await runAssistantTool('propose_party_link', { booking_ref: 'HH-PTY-LNK01', destination: 'invoice' }, ctx)).isError).toBe(true)
  })
})

describe('confirming a party_link card', () => {
  const req = () => new NextRequest('https://www.example.com/api/admin/assistant/confirm', { method: 'POST', headers: { 'content-type': 'application/json' } })
  const proposal = (destination: string) =>
    mintProposal({ kind: 'party_link', input: { bookingId: BOOKING.id, bookingRef: BOOKING.booking_ref, destination }, title: 't', details: [], actor: 'admin:a@example.com' }).proposal

  it('mints through the dashboard action, delivers nothing, and returns the link', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, action: 'portal_url_generated', portalUrl: 'https://www.example.com/api/portal/auth?ref=X&token=T' }), { status: 200 }))
    const r = await executeProposal(req(), proposal('invoice'))
    expect(r.ok).toBe(true)
    expect(r.links?.[0].url).toMatch(/portal\/auth/)
    expect(r.message).toMatch(/Not sent to the client/)
    const sent = JSON.parse(await (mockPost.mock.calls[0][0] as NextRequest).text())
    expect(sent).toEqual({ action: 'generate_portal_url', destination: 'invoice' })
  })

  it('the portal link uses the route\'s default destination, and never a send action', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, portalUrl: 'https://www.example.com/x' }), { status: 200 }))
    await executeProposal(req(), proposal('portal'))
    const sent = JSON.parse(await (mockPost.mock.calls[0][0] as NextRequest).text())
    expect(sent).toEqual({ action: 'generate_portal_url' })
    expect(sent.action).not.toBe('send_portal_link')
  })

  it('a refusal comes back as a refusal', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ error: 'Could not mint' }), { status: 503 }))
    const r = await executeProposal(req(), proposal('invoice'))
    expect(r.ok).toBe(false)
  })
})

describe('opening a party from a link', () => {
  const call = (qs: string, authed = true) =>
    resolve(new NextRequest(`https://www.example.com/api/admin/parties/resolve${qs}`, { headers: authed ? { authorization: 'Bearer party-links-admin' } : {} }))

  it('turns a booking reference into the row id — admin only', async () => {
    expect((await call('?ref=HH-PTY-LNK01', false)).status).toBe(401)
    const ok = await call('?ref=HH-PTY-LNK01')
    expect(await ok.json()).toEqual({ id: BOOKING.id })
  })

  it('refuses a reference that is not shaped like one, and says when there is none', async () => {
    expect((await call('?ref=a%25')).status).toBe(400)
    expect((await call('')).status).toBe(400)
    row = null
    expect((await call('?ref=HH-PTY-NOPE1')).status).toBe(404)
  })
})

describe('the source shape', () => {
  const read = (rel: string) => decomment(fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8'))

  it('P1: the confirm route never writes the links of a party_link or a create_party result into the saved thread', () => {
    const s = read('app/api/admin/assistant/confirm/route.ts')
    // A created party's links include its sign-in planner link and its invoice link.
    expect(s).toMatch(/const keepLinks = proposal\.kind !== 'party_link' && proposal\.kind !== 'create_party'/)
    expect(s).toMatch(/keepLinks \? result\.links : undefined/)
  })

  it('P2: the admin page reads tab / party / ref from the address and hands it to the Parties tab', () => {
    const p = read('app/admin/page.tsx')
    expect(p).toMatch(/q\.get\('party'\)/)
    expect(p).toMatch(/q\.get\('ref'\)/)
    expect(p).toMatch(/deepLink=\{deepLink\}/)
    const t = read('app/admin/PartiesTab.tsx')
    expect(t).toMatch(/\/api\/admin\/parties\/resolve\?ref=/)
    // A failed detail read is not an open party.
    expect(t).toMatch(/if \(!res\.ok\) return\s+const data = await res\.json\(\)\s+setSelected\(data\)/)
  })

  it('P3: the chat turns a URL into a link only when it is this site\'s own', () => {
    const s = read('components/admin/AssistantChat.tsx')
    expect(s).toMatch(/new URL\(trimmed, origin\)\.origin === origin/)
    expect(s).toMatch(/rel="noopener noreferrer"/)
  })

  it('P4: the lead tools stay read-only with the new tool in them', () => {
    const s = read('lib/assistant/leadTools.ts')
    expect(s.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
    expect(s).toMatch(/name: 'get_party_links'/)
  })
})
