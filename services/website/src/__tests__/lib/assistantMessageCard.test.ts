/**
 * Message preview + edit before send (the Manager assistant's send cards).
 *
 * The claim these pin: the card shows the EXACT message, the Confirm click sends
 * that message and no other, and an edited message — by the model or by hand —
 * passes every screen the standard wording does.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { decomment } from '../helpers/sourceScan'

const mockStop = jest.fn()
jest.mock('@/lib/phoneStop', () => ({ phoneHasExplicitStop: (...a: unknown[]) => mockStop(...a) }))

const mockPost = jest.fn()
jest.mock('@/app/api/admin/parties/create/route', () => ({ POST: jest.fn() }))
jest.mock('@/app/api/admin/parties/[id]/route', () => ({ POST: (...a: unknown[]) => mockPost(...a), PATCH: jest.fn() }))
jest.mock('@/app/api/plan/[ref]/pay-link/route', () => ({ POST: jest.fn() }))

const BOOKING = {
  id: 'bbbbbbbb-0000-4000-8000-0000000000c1',
  booking_ref: 'HH-PTY-MSG01',
  status: 'awaiting_deposit',
  contact_name: 'Pat Example',
  contact_email: 'pat@example.com',
  contact_phone: '6315550123',
  child_name: 'Sam',
  event_type: 'birthday',
  party_type: 'in_studio_theme',
  party_date: '2026-12-05',
}
let evite: { data: unknown; error: unknown } = { data: { slug: 'sam-1', archived_at: null }, error: null }
const fakeDb = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => (table === 'evites' ? evite : { data: BOOKING, error: null }),
      }),
    }),
  }),
}
jest.mock('@/lib/supabase', () => ({ getSupabase: () => fakeDb }))

import { TENANT } from '@/tenant'
import { screenOutboundText, smsFacts, maskPhone, maskEmail } from '@/lib/assistant/outboundText'
import { buildClientLinksCard, buildPhotosCard } from '@/lib/assistant/messageCard'
import { executeProposal } from '@/lib/assistant/execute'
import { mintProposal } from '@/lib/assistant/proposals'
import { defaultSmsBody } from '@/lib/clientLinks'

const OPEN = new Date('2026-11-05T17:00:00Z') // 12:00 ET
const QUIET = new Date('2026-11-05T08:00:00Z') // 03:00 ET
const LINK_PH = ['invite', 'rsvps', 'planner', 'invoice', 'portal']

beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = 'msg-card-secret'
  process.env.PORTAL_LINK_SIGNING_SECRET = 'msg-portal-secret'
})
beforeEach(() => {
  mockStop.mockReset().mockResolvedValue('clear')
  mockPost.mockReset()
  evite = { data: { slug: 'sam-1', archived_at: null }, error: null }
})

const sms = (text: string, authored: 'default' | 'model' | 'manual' = 'manual') =>
  screenOutboundText(text, { channel: 'sms', authored, allowedPlaceholders: LINK_PH })

describe('screenOutboundText: where a customer\'s attention or money can be sent', () => {
  const base = `Hi Pat! It's ${TENANT.people.customerSignoff} {planner}\nReply STOP to opt out`

  it('accepts the standard wording', () => {
    expect(sms(defaultSmsBody(BOOKING, ['planner']), 'default').ok).toBe(true)
  })

  it.each([
    ['a link that is not ours', `${base} https://buy.stripe.com/abc123`],
    ['a bare domain', `${base} sparkleparties.co`],
    ['a payment handle', `${base} Venmo @someone-else`],
    ['a phone number that is not ours', `${base} Zelle 917-555-0134`],
    ['an email address that is not ours', `${base} billing@evil.example`],
    ['a link placeholder that is not ours', `${base} {payroll}`],
    ['the owner\'s name', `${base} ${TENANT.people.neverSignAs[0]}`],
  ])('refuses %s', (_why, text) => {
    expect(sms(text).ok).toBe(false)
  })

  it('refuses a text with no opt-out line, and accepts one with it', () => {
    expect(sms(`Hi {planner}`).ok).toBe(false)
    expect(sms(`Hi {planner} Reply STOP to opt out`).ok).toBe(true)
  })

  it('the model cannot promise a discount; a manager typing one is theirs to say', () => {
    const promise = `${base} We will take 20% off for you`
    expect(sms(promise, 'model').ok).toBe(false)
    expect(sms(promise, 'manual').ok).toBe(true)
  })

  it('but a manager cannot redirect the money either', () => {
    expect(sms(`${base} Venmo @someone-else`, 'manual').ok).toBe(false)
  })

  it('folds curly quotes into plain ones and leaves an emoji alone', () => {
    const r = sms(`It’s ${TENANT.people.customerSignoff} 🎉 {planner} Reply STOP to opt out`)
    expect(r.ok && r.text).toContain("It's")
    expect(r.ok && r.text).toContain('🎉')
  })

  it('reports segments and says why a text is longer than it looks', () => {
    const plain = smsFacts(`Hi {planner} Reply STOP to opt out`, 'HH-PTY-MSG01')
    expect(plain.encoding).toBe('GSM-7')
    const emoji = smsFacts(`Hi 🎉 {planner} Reply STOP to opt out`, 'HH-PTY-MSG01')
    expect(emoji.encoding).toBe('UCS-2')
    expect(emoji.cause).toBeTruthy()
    expect(emoji.segments).toBeGreaterThan(plain.segments)
  })

  it('masks the phone and the email', () => {
    expect(maskPhone('(631) 555-0123')).toBe('***-***-0123')
    expect(maskEmail('pat@example.com')).toBe('p***@example.com')
    expect(maskPhone(null)).toBe('no number')
  })
})

describe('buildClientLinksCard', () => {
  it('shows the exact standard text, masked recipient, segments and an open window', async () => {
    const built = await buildClientLinksCard(fakeDb as never, BOOKING, { kinds: ['planner'], email: true, sms: true, now: OPEN })
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const text = built.preview.channels.find(c => c.channel === 'sms')!
    expect(text.template).toBe(defaultSmsBody(BOOKING, ['planner']))
    expect(text.to).toBe('***-***-0123')
    expect(text.sms!.segments).toBeGreaterThan(0)
    expect(built.preview.recipient).toBe('Pat')
    expect(JSON.stringify(built)).not.toContain('6315550123')
    expect(JSON.stringify(built)).not.toContain('pat@example.com')
    expect(built.preview.level).not.toBe('blocked')
    // The signed input binds the wording the card showed.
    expect(built.input.smsBody).toBe(text.template)
  })

  it('says a text would be refused outside 8am-9pm, and when the number has a STOP', async () => {
    const quiet = await buildClientLinksCard(fakeDb as never, BOOKING, { kinds: ['planner'], email: false, sms: true, now: QUIET })
    expect(quiet.ok && quiet.preview.level).toBe('blocked')
    mockStop.mockResolvedValue('stopped')
    const stopped = await buildClientLinksCard(fakeDb as never, BOOKING, { kinds: ['planner'], email: false, sms: true, now: OPEN })
    expect(stopped.ok && stopped.preview.level).toBe('blocked')
    expect(stopped.ok && stopped.preview.status.join(' ')).toMatch(/STOP/)
  })

  it('warns when the invitation does not exist yet', async () => {
    evite = { data: null, error: null }
    const r = await buildClientLinksCard(fakeDb as never, BOOKING, { kinds: ['invite'], email: true, sms: false, now: OPEN })
    expect(r.ok && r.preview.level).toBe('blocked')
  })

  it('a reworded text replaces the standard one, with the link kept', async () => {
    const edited = `Hi Pat, here's the planner for Sam's party: {planner} Reply STOP to opt out`
    const r = await buildClientLinksCard(fakeDb as never, BOOKING, { kinds: ['planner'], email: false, sms: true, edits: { smsBody: edited }, authored: 'model', now: OPEN })
    expect(r.ok && r.input.smsBody).toBe(edited)
  })

  it('refuses a reworded text that drops the link it promised, or adds a foreign one', async () => {
    const noLink = await buildClientLinksCard(fakeDb as never, BOOKING, { kinds: ['planner'], email: false, sms: true, edits: { smsBody: 'Hi Pat Reply STOP to opt out' }, authored: 'model', now: OPEN })
    expect(noLink.ok).toBe(false)
    const foreign = await buildClientLinksCard(fakeDb as never, BOOKING, { kinds: ['planner'], email: false, sms: true, edits: { smsBody: 'Pay at https://evil.example/x {planner} Reply STOP to opt out' }, authored: 'manual', now: OPEN })
    expect(foreign.ok).toBe(false)
  })

  it('a photo card binds the text and requires {photos}', async () => {
    const photos = [{ id: 'p1', url: 'https://www.example.com/a.jpg', alt: 'Slime' }]
    const ok = await buildPhotosCard(fakeDb as never, BOOKING, { photos, email: false, sms: true, now: OPEN })
    expect(ok.ok && ok.input.smsBody).toMatch(/\{photos\}/)
    const bad = await buildPhotosCard(fakeDb as never, BOOKING, { photos, email: false, sms: true, edits: { smsBody: 'Photos! Reply STOP to opt out' }, authored: 'manual', now: OPEN })
    expect(bad.ok).toBe(false)
  })
})

describe('execute: the Confirm click sends the wording on the card, screened again', () => {
  const req = () => new NextRequest('https://www.example.com/api/admin/assistant/confirm', { method: 'POST', headers: { 'content-type': 'application/json' } })
  const proposal = (input: Record<string, unknown>) =>
    mintProposal({ kind: 'send_client_links', input: { bookingId: BOOKING.id, bookingRef: BOOKING.booking_ref, links: ['planner'], email: false, sms: true, ...input }, title: 't', details: [], actor: 'admin:a@example.com' }).proposal

  it('forwards the bound text to the dashboard route unchanged', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, sentVia: ['text'] }), { status: 200 }))
    const bound = `Hi Pat, your planner: {planner} Reply STOP to opt out`
    const r = await executeProposal(req(), proposal({ smsBody: bound }))
    expect(r.ok).toBe(true)
    const sent = JSON.parse(await (mockPost.mock.calls[0][0] as NextRequest).text())
    expect(sent.smsBody).toBe(bound)
    expect(sent.action).toBe('send_client_links')
  })

  it('refuses at the last gate a bound text that now carries a foreign payment link — and sends nothing', async () => {
    const r = await executeProposal(req(), proposal({ smsBody: 'Pay https://buy.stripe.com/x {planner} Reply STOP to opt out' }))
    expect(r.ok).toBe(false)
    expect(r.status).toBe(422)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('a card minted before wording was bound still sends the standard text', async () => {
    mockPost.mockResolvedValue(new Response(JSON.stringify({ ok: true, sentVia: ['text'] }), { status: 200 }))
    const r = await executeProposal(req(), proposal({}))
    expect(r.ok).toBe(true)
    const sent = JSON.parse(await (mockPost.mock.calls[0][0] as NextRequest).text())
    expect(sent.smsBody).toBe(defaultSmsBody(BOOKING, ['planner']))
  })
})

describe('the source shape', () => {
  const SRC = path.join(process.cwd(), 'src')
  const read = (rel: string) => decomment(fs.readFileSync(path.join(SRC, rel), 'utf8'))

  it('M1: messageCard.ts only reads, and imports no sender', () => {
    const s = read('lib/assistant/messageCard.ts')
    expect(s.match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
    expect(s).not.toMatch(/from '@\/lib\/(sms|stripe|resend|emailTemplates|portalLinkMint)'|new Resend\(|sendSMS/)
  })

  it('M2: the revise route verifies for THIS actor and builds the new card BEFORE it retires the old one', () => {
    const s = read('app/api/admin/assistant/revise/route.ts')
    const auth = s.indexOf('isAdminAuthorized(req)')
    const verify = s.indexOf('verifyProposal(body?.token, actor)')
    const build = s.indexOf('if (!built.ok)')
    const retire = s.indexOf('supersedeProposal(supabase, old.id, actor)')
    const mint = s.indexOf('mintProposal(')
    expect([auth, verify, build, retire, mint].every(i => i > 0)).toBe(true)
    expect(auth).toBeLessThan(verify)
    expect(verify).toBeLessThan(build)
    expect(build).toBeLessThan(retire)
    expect(retire).toBeLessThan(mint)
    // It sends nothing itself.
    expect(s).not.toMatch(/executeProposal|sendSMS|new Resend\(/)
  })

  it('M3: execute re-screens a bound wording before it replays the route', () => {
    const s = read('lib/assistant/execute.ts')
    const gate = s.indexOf('boundWording(input, [')
    const replay = s.indexOf("action: 'send_client_links'")
    expect(gate).toBeGreaterThan(0)
    expect(gate).toBeLessThan(replay)
    expect(s).toMatch(/screenOutboundText\(/)
  })

  it('M4: a changed wording is a new signed card — the bound text is part of the token input', () => {
    const s = read('lib/assistant/messageCard.ts')
    expect(s).toMatch(/\.\.\.\(email \? \{ emailSubject, emailBody \} : \{\}\)/)
    expect(s).toMatch(/\.\.\.\(sms \? \{ smsBody \} : \{\}\)/)
  })
})
