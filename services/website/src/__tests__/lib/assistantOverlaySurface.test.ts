/**
 * The admin chat overlay (drawer, threads, the new propose_* tools, photo sets).
 *
 * The safety sentence from assistantSurface.test.ts still holds and is extended,
 * not loosened: the model can READ and it can PROPOSE; only a signed, actor-bound,
 * single-use proposal confirmed by a human WRITES, by replaying the dashboard's own
 * admin route. These rules pin what the overlay added to that sentence:
 *
 *   O1  every admin write tool is `propose_*` and has a branch in execute.ts;
 *   O2  every propose tool writes nothing and mints a card of a known kind;
 *   O3  the drawer is importable from the admin layout and the admin-verified
 *       invoice branch ONLY — never from a customer route;
 *   O4  the confirm route still authorises -> verifies -> claims -> executes;
 *   O5  the used-proposal store is durable (a restart cannot make a card replayable);
 *   O6  execute.ts replays the right admin action with the right body, and a chat
 *       edit can never carry a status or a total;
 *   O7  threads are per admin per context and stale cards are shown expired;
 *   O8  a photo-set link is signed, expires, serves only what is still approved,
 *       and the text it rides in is a link, not a picture.
 */
import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { decomment } from '../helpers/sourceScan'
import { makeFakeMoneyDb } from '../helpers/fakeMoneyDb'

const mockLoadInvoice = jest.fn()
jest.mock('@/lib/planInvoice', () => ({
  ...jest.requireActual('@/lib/planInvoice'),
  loadPlanInvoice: (...a: unknown[]) => mockLoadInvoice(...a),
}))
const mockAddOns = jest.fn()
jest.mock('@/lib/pricingCatalog', () => ({
  ...jest.requireActual('@/lib/pricingCatalog'),
  loadLineItemAddOns: (...a: unknown[]) => mockAddOns(...a),
}))
const mockLoadCatalog = jest.fn()
const mockQuote = jest.fn()
jest.mock('@/lib/quoteRequest', () => ({
  ...jest.requireActual('@/lib/quoteRequest'),
  loadQuoteCatalog: (...a: unknown[]) => mockLoadCatalog(...a),
  quoteFromCatalog: (...a: unknown[]) => mockQuote(...a),
}))

const mockCreate = jest.fn()
const mockPost = jest.fn()
const mockPatch = jest.fn()
const mockPay = jest.fn()
jest.mock('@/app/api/admin/parties/create/route', () => ({ POST: (...a: unknown[]) => mockCreate(...a) }))
jest.mock('@/app/api/admin/parties/[id]/route', () => ({
  POST: (...a: unknown[]) => mockPost(...a),
  PATCH: (...a: unknown[]) => mockPatch(...a),
}))
jest.mock('@/app/api/plan/[ref]/pay-link/route', () => ({ POST: (...a: unknown[]) => mockPay(...a) }))

import { ASSISTANT_TOOLS, runAssistantTool } from '@/lib/assistant/tools'
import { executeProposal, CHAT_EDITABLE_COLUMNS } from '@/lib/assistant/execute'
import { mintProposal, verifyProposal, type Proposal } from '@/lib/assistant/proposals'
import { claimProposal } from '@/lib/assistant/usedProposals'
import { screenContext, contextKey, contextPromptLine } from '@/lib/assistant/context'
import { expireStaleCards, readThread, recordCardDismissed, recordCardOutcome, writeThread, type ThreadLine } from '@/lib/assistant/threads'
import { systemPrompt } from '@/lib/assistant/run'
import {
  createPhotoSet, loadPhotoSet, newPhotoSetCode, photoSetToken, photosEmailHtml, photosSmsText, verifyPhotoSetToken,
} from '@/lib/photoSets'
import { TENANT } from '@/tenant'

const SRC = path.join(process.cwd(), 'src')
const src = (rel: string) => decomment(fs.readFileSync(path.join(SRC, rel), 'utf8'))
function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : /\.(tsx?)$/.test(e.name) ? [p] : []
  })
}
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/')

const SECRET = 'overlay-test-secret'
const ACTOR = 'admin:a@example.com'
const BK = 'bbbbbbbb-0000-4000-8000-0000000000c1'
const P1 = 'aaaaaaaa-0000-4000-8000-0000000000a1'
const P2 = 'aaaaaaaa-0000-4000-8000-0000000000a2'
const P3 = 'aaaaaaaa-0000-4000-8000-0000000000a3'

beforeAll(() => {
  process.env.ADMIN_SESSION_SECRET = SECRET
  process.env.PORTAL_LINK_SIGNING_SECRET = 'overlay-portal-secret'
})

/* ── O1: the tool list and the executor agree ─────────────────────────── */

const READ_TOOLS = ['find_client', 'search_parties', 'get_party', 'check_date', 'get_pricing', 'get_quote', 'find_photos', 'list_leads', 'get_first_inquiry', 'get_sms_thread', 'get_next_step', 'get_invitation', 'list_sequences', 'get_party_links', 'list_payment_pledges', 'list_memories', 'list_crew_parties', 'get_crew_party', 'list_crew_members']

describe('O1: every write tool is propose_* and has an executor branch', () => {
  const kindsInUnion = (): string[] => {
    const s = src('lib/assistant/proposals.ts')
    const block = s.slice(s.indexOf('export type ProposalKind'), s.indexOf('export interface ProposalPhoto'))
    return Array.from(block.matchAll(/'([a-z_]+)'/g)).map(m => m[1])
  }

  it('the tool list is exactly the known reads plus propose_* — nothing else can be named', () => {
    const names = ASSISTANT_TOOLS.map(t => t.name)
    const others = names.filter(n => !n.startsWith('propose_'))
    expect(others.sort()).toEqual([...READ_TOOLS].sort())
    expect(names.filter(n => n.startsWith('propose_')).length).toBe(32)
    for (const t of ASSISTANT_TOOLS.filter(t => t.name.startsWith('propose_'))) expect(t.description).toMatch(/^PROPOSE /)
  })

  it('every proposal kind has a `case` in execute.ts, and every case is a kind', () => {
    const kinds = kindsInUnion()
    expect(kinds.length).toBe(32)
    const exec = src('lib/assistant/execute.ts')
    const cases = Array.from(exec.matchAll(/case '([a-z_]+)':/g)).map(m => m[1])
    expect(cases.sort()).toEqual([...kinds].sort())
  })

  it('every kind a propose tool mints is in the union (nothing mints a kind the executor lacks)', () => {
    const kinds = new Set(kindsInUnion())
    const tools = src('lib/assistant/tools.ts')
    const minted = [
      ...Array.from(tools.matchAll(/kind: '([a-z_]+)'/g)).map(m => m[1]),
      ...Array.from(tools.matchAll(/cardOutcome\(\s*'([a-z_]+)'/g)).map(m => m[1]),
      // The message cards (send links / send photos) mint through messageCardOutcome.
      ...Array.from(tools.matchAll(/messageCardOutcome\(\s*'([a-z_]+)'/g)).map(m => m[1]),
    ]
    expect(minted.length).toBeGreaterThanOrEqual(10)
    for (const k of minted) expect(kinds.has(k)).toBe(true)
  })

  it('no read tool can mint a proposal: mintProposal is reachable only from propose* functions', () => {
    const tools = src('lib/assistant/tools.ts')
    // The two callers of mintProposal.
    const helperHome = tools.indexOf('function cardOutcome(')
    expect(helperHome).toBeGreaterThan(0)
    const mintSites = Array.from(tools.matchAll(/mintProposal\(/g)).map(m => m.index as number)
    expect(mintSites.length).toBeGreaterThanOrEqual(3)
    for (const readFn of ['findClient', 'searchParties', 'getParty', 'checkDate', 'getPricing', 'getQuote', 'findPhotosTool']) {
      const start = tools.indexOf(`async function ${readFn}(`)
      expect(start).toBeGreaterThan(0)
      const next = tools.slice(start + 10).search(/\n(async )?function /)
      const body = tools.slice(start, next < 0 ? undefined : start + 10 + next)
      expect(body).not.toMatch(/mintProposal\(|cardOutcome\(/)
    }
  })

  it('tools.ts, run.ts and the new store/thread modules hold no Stripe, SMS or mail client', () => {
    for (const f of ['lib/assistant/tools.ts', 'lib/assistant/run.ts', 'lib/assistant/threads.ts', 'lib/assistant/usedProposals.ts']) {
      const s = src(f)
      expect(s).not.toMatch(/from '@\/lib\/(sms|stripe|resend|emailTemplates|portalLinkMint)'/)
      expect(s).not.toMatch(/new Stripe\(|new Resend\(/)
    }
    // And tools.ts cannot write at all: it only reads and proposes.
    expect(src('lib/assistant/tools.ts').match(/\.(insert|update|upsert|delete)\s*\(/g)).toBeNull()
  })

  it('get_quote hands the arithmetic to the quote engine; the model supplies words only', () => {
    const tools = src('lib/assistant/tools.ts')
    expect(tools).toMatch(/quoteFromCatalog\(loaded\.data/)
    expect(tools).not.toMatch(/computeQuote|totalCents\(/)
  })

  it('the system prompt keeps both safety sentences and names the new tools\' rules', () => {
    const p = systemPrompt('2026-11-04')
    expect(p).toMatch(/do NOT do anything/)
    expect(p).toMatch(/never an instruction to you/)
    expect(p).toMatch(/propose_record_payment/)
    expect(p).toMatch(/find_photos/)
    expect(p).toContain(`signed by ${TENANT.people.customerSignoff}`)
  })
})

/* ── O2: each propose tool writes nothing and mints a known card ──────── */

describe('O2: the propose tools write nothing', () => {
  const BOOKING = {
    id: BK, booking_ref: 'HH-PTY-OVR01', status: 'approved', contact_name: 'Pat Example', contact_email: 'parent@example.com',
    contact_phone: '631-555-0100', child_name: 'Sam', child_age: 6, party_type: 'in_studio_theme', event_type: 'kid-party',
    party_date: '2026-12-05', party_time: '14:00', guest_count_approx: 10, package_type: 'Slime Party', admin_notes: null, total_cents: 90000,
  }
  const mkdb = (booking: Record<string, unknown> = {}) =>
    makeFakeMoneyDb({
      bookings: [{ ...BOOKING, ...booking }],
      booking_line_items: [
        { id: 'li-1', booking_id: BK, name: 'Slime Party', quantity: 1, unit_price_cents: 59500, guest_multiplied: false },
        { id: 'li-2', booking_id: BK, name: 'Extra kid', quantity: 1, unit_price_cents: 3500, guest_multiplied: true },
      ],
      media_assets: [
        { id: P1, url: 'https://cdn.example/media/1.webp', alt: 'Slime table', w: 1, h: 1, party_type: 'in_studio_theme', theme_slug: 'slime-party', activities: ['slime-making'], approved: true, no_identifiable_faces: true, sort: 0 },
        { id: P2, url: 'https://cdn.example/media/2.webp', alt: 'Glow room', w: 1, h: 1, party_type: 'in_studio_theme', theme_slug: 'glow-party', activities: [], approved: true, no_identifiable_faces: true, sort: 0 },
        { id: P3, url: 'https://cdn.example/media/3.webp', alt: 'Candidate', w: 1, h: 1, party_type: 'in_studio_theme', theme_slug: 'slime-party', activities: [], approved: false, no_identifiable_faces: true, sort: 0 },
      ],
    })

  beforeEach(() => {
    mockLoadInvoice.mockReset()
    mockAddOns.mockReset()
    mockLoadInvoice.mockResolvedValue({
      ok: true,
      invoice: { booking: BOOKING, totalCents: 90000, paidCents: 25000, outstandingCents: 65000, guestCount: 10, depositOwedCents: 0 },
    })
    mockAddOns.mockResolvedValue([{ name: 'Balloon Garland', priceCents: 15000, guestMultiplied: false }])
  })

  const CASES: Array<[string, Record<string, unknown>, string]> = [
    ['propose_update_party', { booking_ref: 'HH-PTY-OVR01', guest_count: 14, party_time: '15:00' }, 'update_party'],
    ['propose_add_line_item', { booking_ref: 'HH-PTY-OVR01', add_on: 'Balloon Garland' }, 'add_line_item'],
    ['propose_remove_line_item', { booking_ref: 'HH-PTY-OVR01', line_item_name: 'Extra kid' }, 'remove_line_item'],
    ['propose_edit_line_item', { booking_ref: 'HH-PTY-OVR01', line_item_name: 'Extra kid', unit_price_cents: 4000 }, 'edit_line_item'],
    ['propose_set_preferences', { booking_ref: 'HH-PTY-OVR01', pizza_or_bagels: 'bagels', character_request: 'Elsa' }, 'set_preferences'],
    ['propose_record_payment', { booking_ref: 'HH-PTY-OVR01', amount_cents: 25000, payment_method: 'venmo' }, 'record_payment'],
    ['propose_cancel', { booking_ref: 'HH-PTY-OVR01' }, 'cancel_party'],
    ['propose_send_photos', { booking_ref: 'HH-PTY-OVR01', photo_ids: [P1, P2], email: true, sms: false }, 'send_photos'],
  ]

  it.each(CASES)('%s mints a signed, actor-bound card of kind %s and performs no write', async (name, input, kind) => {
    const d = mkdb()
    const out = await runAssistantTool(name, input, { actor: ACTOR, supabase: d.client as never, now: new Date('2026-11-04T15:00:00Z') })
    expect(out.isError).toBeFalsy()
    expect(out.proposal?.proposal.kind).toBe(kind)
    expect(out.proposal?.proposal.actor).toBe(ACTOR)
    expect((out.result as { status: string }).status).toBe('awaiting_manager_confirmation')
    expect(verifyProposal(out.proposal!.token, ACTOR).ok).toBe(true)
    expect(verifyProposal(out.proposal!.token, 'admin:other@example.com')).toEqual({ ok: false, reason: 'wrong_actor' })
    expect(d.log.filter(l => /^(INSERT|UPDATE|DELETE)/.test(l))).toEqual([])
  })

  it('propose_add_line_item finds a food or drink by its catalog name, at the catalog price, filed under its own category', async () => {
    mockAddOns.mockResolvedValue([
      { name: 'Coffee Bar', priceCents: 15000, guestMultiplied: false, category: 'beverage-add-on' },
      { name: 'Hot Chocolate Bar', priceCents: 15000, guestMultiplied: false, category: 'beverage-add-on' },
    ])
    const out = await runAssistantTool('propose_add_line_item', { booking_ref: 'HH-PTY-OVR01', add_on: 'Hot Chocolate Bar' }, { actor: ACTOR, supabase: mkdb().client as never })
    expect(out.isError).toBeFalsy()
    expect(out.proposal?.proposal.input).toMatchObject({ name: 'Hot Chocolate Bar', unit_price_cents: 15000, category: 'beverage-add-on' })
    // A name that is not on the list is still refused, never approximated.
    const no = await runAssistantTool('propose_add_line_item', { booking_ref: 'HH-PTY-OVR01', add_on: 'Hot Cocoa Fountain' }, { actor: ACTOR, supabase: mkdb().client as never })
    expect(no.isError).toBe(true)
    expect(no.proposal).toBeUndefined()
  })

  it('propose_mark_lost: a lead with nothing paid is proposed; a party with money is pointed at cancel', async () => {
    mockLoadInvoice.mockResolvedValue({ ok: true, invoice: { booking: BOOKING, totalCents: 90000, paidCents: 0, outstandingCents: 90000, guestCount: 10 } })
    const ok = await runAssistantTool('propose_mark_lost', { booking_ref: 'HH-PTY-OVR01' }, { actor: ACTOR, supabase: mkdb().client as never })
    expect(ok.proposal?.proposal.kind).toBe('mark_lost')
    mockLoadInvoice.mockResolvedValue({ ok: true, invoice: { booking: BOOKING, totalCents: 90000, paidCents: 25000, outstandingCents: 65000, guestCount: 10 } })
    const no = await runAssistantTool('propose_mark_lost', { booking_ref: 'HH-PTY-OVR01' }, { actor: ACTOR, supabase: mkdb().client as never })
    expect(no.isError).toBe(true)
    expect(no.proposal).toBeUndefined()
    expect(JSON.stringify(no.result)).toContain('propose_cancel')
    // A failed payments read is not "nothing paid".
    mockLoadInvoice.mockResolvedValue({ ok: false, notFound: false })
    const unknown = await runAssistantTool('propose_mark_lost', { booking_ref: 'HH-PTY-OVR01' }, { actor: ACTOR, supabase: mkdb().client as never })
    expect(unknown.isError).toBe(true)
  })

  it.each(['cancelled', 'lost'])('a %s party gets no card from any propose tool', async status => {
    for (const [name, input] of CASES) {
      const out = await runAssistantTool(name, input, { actor: ACTOR, supabase: mkdb({ status }).client as never })
      expect(out.isError).toBe(true)
      expect(out.proposal).toBeUndefined()
    }
  })

  it('propose_update_party cannot carry a status or a total, and refuses a past date', async () => {
    const d = mkdb()
    const out = await runAssistantTool(
      'propose_update_party',
      { booking_ref: 'HH-PTY-OVR01', guest_count: 12, status: 'paid_in_full', total_cents: 1, balance_due_cents: 0 },
      { actor: ACTOR, supabase: d.client as never },
    )
    expect(Object.keys(out.proposal!.proposal.input.updates as object)).toEqual(['guest_count_approx'])
    const past = await runAssistantTool('propose_update_party', { booking_ref: 'HH-PTY-OVR01', party_date: '2020-01-01' }, { actor: ACTOR, supabase: d.client as never, now: new Date('2026-11-04T15:00:00Z') })
    expect(past.isError).toBe(true)
    const none = await runAssistantTool('propose_update_party', { booking_ref: 'HH-PTY-OVR01', status: 'paid_in_full' }, { actor: ACTOR, supabase: d.client as never })
    expect(none.isError).toBe(true)
  })

  it('propose_add_line_item takes the price from the catalog, refuses an unknown add-on and a negative custom price', async () => {
    const d = mkdb()
    const ok = await runAssistantTool('propose_add_line_item', { booking_ref: 'HH-PTY-OVR01', add_on: 'balloon garland', unit_price_cents: 1 }, { actor: ACTOR, supabase: d.client as never })
    expect(ok.proposal?.proposal.input).toMatchObject({ name: 'Balloon Garland', unit_price_cents: 15000, quantity: 1 })
    expect(ok.proposal?.proposal.details.join(' ')).toContain('$150.00')
    expect(ok.proposal?.proposal.details.join(' ')).toContain('$900.00 → $1050.00')
    const unknown = await runAssistantTool('propose_add_line_item', { booking_ref: 'HH-PTY-OVR01', add_on: 'Fog Machine' }, { actor: ACTOR, supabase: d.client as never })
    expect(unknown.isError).toBe(true)
    const negative = await runAssistantTool('propose_add_line_item', { booking_ref: 'HH-PTY-OVR01', name: 'Discount', unit_price_cents: -5000 }, { actor: ACTOR, supabase: d.client as never })
    expect(negative.isError).toBe(true)
  })

  it('propose_add_line_item carries an optional per-guest extra with its description, and it adds nothing to the total', async () => {
    const d = mkdb()
    const out = await runAssistantTool(
      'propose_add_line_item',
      { booking_ref: 'HH-PTY-OVR01', name: 'Additional Craft Station: Perfume Making', unit_price_cents: 3000, per_guest: true, optional: true, description: '$30 per guest. Optional.' },
      { actor: ACTOR, supabase: d.client as never },
    )
    expect(out.isError).toBeFalsy()
    expect(out.proposal?.proposal.input).toMatchObject({ unit_price_cents: 3000, guest_multiplied: true, is_optional: true, is_featured: false, description: '$30 per guest. Optional.' })
    const text = out.proposal!.proposal.details.join(' ')
    expect(text).toContain('optional - not in total')
    expect(text).toContain('Adds about $0.00')
    expect(text).toContain('$900.00 → $900.00')
  })

  it('propose_record_payment defaults to NO receipt, refuses a guessed method and a refund', async () => {
    const d = mkdb()
    const ok = await runAssistantTool('propose_record_payment', { booking_ref: 'HH-PTY-OVR01', amount_cents: 10000, payment_method: 'cash' }, { actor: ACTOR, supabase: d.client as never })
    expect(ok.proposal?.proposal.input.send_receipt).toBe(false)
    expect(ok.proposal?.proposal.details.join(' ')).toMatch(/No receipt is sent/)
    const loud = await runAssistantTool('propose_record_payment', { booking_ref: 'HH-PTY-OVR01', amount_cents: 10000, payment_method: 'cash', send_receipt: true }, { actor: ACTOR, supabase: d.client as never })
    expect(loud.proposal?.proposal.input.send_receipt).toBe(true)
    for (const bad of [
      { amount_cents: 0, payment_method: 'cash' },
      { amount_cents: -5, payment_method: 'cash' },
      { amount_cents: 10.5, payment_method: 'cash' },
      { amount_cents: 10000, payment_method: 'bitcoin' },
      { amount_cents: 10000, payment_method: 'cash', payment_type: 'refund' },
    ]) {
      const out = await runAssistantTool('propose_record_payment', { booking_ref: 'HH-PTY-OVR01', ...bad }, { actor: ACTOR, supabase: d.client as never })
      expect(out.isError).toBe(true)
    }
  })

  it('propose_send_photos resolves ONLY approved photos, shows thumbnails, and stores the ids it resolved', async () => {
    const d = mkdb()
    const out = await runAssistantTool('propose_send_photos', { booking_ref: 'HH-PTY-OVR01', photo_ids: [P1, P3], email: true, sms: true }, { actor: ACTOR, supabase: d.client as never })
    // P3 is an unapproved candidate: left out, and the card says so.
    expect(out.proposal?.proposal.input.photoIds).toEqual([P1])
    expect(out.proposal?.proposal.photos?.map(p => p.id)).toEqual([P1])
    expect(out.proposal?.proposal.details.join(' ')).toMatch(/not approved to send/)
    expect(out.proposal?.proposal.details.join(' ')).toMatch(/never a picture message/)
    const none = await runAssistantTool('propose_send_photos', { booking_ref: 'HH-PTY-OVR01', photo_ids: [P3], email: true, sms: false }, { actor: ACTOR, supabase: d.client as never })
    expect(none.isError).toBe(true)
    const byFilter = await runAssistantTool('propose_send_photos', { booking_ref: 'HH-PTY-OVR01', theme: 'slime-party', email: true, sms: false }, { actor: ACTOR, supabase: d.client as never })
    expect(byFilter.proposal?.proposal.input.photoIds).toEqual([P1])
    const vague = await runAssistantTool('propose_send_photos', { booking_ref: 'HH-PTY-OVR01', email: true, sms: false }, { actor: ACTOR, supabase: d.client as never })
    expect(vague.isError).toBe(true)
  })

  it('find_photos returns id, url and alt for approved photos only; get_quote passes words, not numbers', async () => {
    const d = mkdb()
    const found = await runAssistantTool('find_photos', { theme: 'slime-party' }, { actor: ACTOR, supabase: d.client as never })
    expect((found.result as { photos: { id: string }[] }).photos.map(p => p.id)).toEqual([P1])
    expect(Object.keys((found.result as { photos: object[] }).photos[0]).sort()).toEqual(['activities', 'alt', 'id', 'kind', 'party_type', 'theme', 'url'])
    // One pasteable "description: link" line per photo, same order.
    const lines = (found.result as { text_lines: string[] }).text_lines
    const first = (found.result as { photos: { alt: string; url: string }[] }).photos[0]
    expect(lines).toEqual([`${first.alt || 'Party photo'}: ${first.url}`])

    mockLoadCatalog.mockResolvedValue({ kind: 'ok', data: {} })
    mockQuote.mockReturnValue({
      ok: true,
      quote: { totalCents: 123400, effectiveGuestCount: 12, lineItems: [{ name: 'Slime Party', quantity: 1, unit_price_cents: 59500, guest_multiplied: false }] },
      unmatched: ['fog'], ambiguous: [], travelNotIncluded: false, plannerUrl: 'https://example.com/plan',
    })
    const q = await runAssistantTool(
      'get_quote',
      { party_type: 'studio', guests: 12, theme: 'Slime Party', add_ons: ['fog'], price_cents: 1 },
      { actor: ACTOR, supabase: d.client as never },
    )
    const arg = mockQuote.mock.calls[0][1]
    expect(arg).toEqual({ partyType: 'studio', guests: 12, theme: 'Slime Party', activities: [], mini: false, addOns: ['fog'] })
    expect((q.result as { total: string }).total).toBe('$1234.00')
    expect((q.result as { not_found: string[] }).not_found).toEqual(['fog'])
  })
})

/* ── O3: the drawer never reaches a customer ──────────────────────────── */

describe('O3: the drawer is importable only where an admin is verified', () => {
  const importers = (needle: RegExp) =>
    walk(SRC)
      .filter(f => !f.includes('/__tests__/') && !f.includes('\\__tests__\\'))
      .filter(f => needle.test(decomment(fs.readFileSync(f, 'utf8'))))
      .map(rel)
      .sort()

  it('AssistantDrawer is imported by the admin layout and the invoice page, and by nothing else', () => {
    expect(importers(/from '@\/components\/admin\/AssistantDrawer'|from '\.\/AssistantDrawer'/)).toEqual([
      'app/admin/layout.tsx',
      'app/plan/[ref]/summary/page.tsx',
    ])
  })

  it('AssistantChat is imported only by the drawer and the full-screen admin page', () => {
    expect(importers(/from '@\/components\/admin\/AssistantChat'|from '\.\/AssistantChat'/)).toEqual([
      'app/admin/assistant/page.tsx',
      'components/admin/AssistantDrawer.tsx',
    ])
  })

  it('on the invoice page the drawer sits inside the verified-admin, feature-flagged branch', () => {
    const s = src('app/plan/[ref]/summary/page.tsx')
    expect(s).toMatch(/\{isAdminView && featureEnabled\('managerAssistant'\) && <AssistantDrawer verified page="invoice" bookingRef=\{ref\} \/>\}/)
    // `isAdminView` is the planAccess result, which reads the SIGNED hh_admin cookie.
    expect(s).toMatch(/const isAdminView = access\.isAdmin/)
    // One mount, no other rendering of it on the page.
    expect((s.match(/<AssistantDrawer/g) ?? []).length).toBe(1)
  })

  it('the admin layout mounts it behind the tenant feature flag', () => {
    expect(src('app/admin/layout.tsx')).toMatch(/featureEnabled\('managerAssistant'\) && <AssistantDrawer \/>/)
  })

  it('no customer-facing component imports anything from components/admin', () => {
    const offenders = walk(path.join(SRC, 'components'))
      .filter(f => !rel(f).startsWith('components/admin/'))
      .filter(f => /from '@\/components\/admin\//.test(decomment(fs.readFileSync(f, 'utf8'))))
      .map(rel)
    expect(offenders).toEqual([])
  })

  it('/admin/assistant is the SAME chat component, not a second UI', () => {
    const page = src('app/admin/assistant/page.tsx')
    expect(page).toMatch(/<AssistantChat /)
    expect(page).not.toMatch(/fetch\('\/api\/admin\/assistant'/)
    expect(src('components/admin/AssistantDrawer.tsx')).toMatch(/<AssistantChat /)
    expect(src('components/admin/AssistantDrawer.tsx')).toMatch(/router\.refresh\(\)/)
  })
})

/* ── O4: the confirm route's order ────────────────────────────────────── */

describe('O4: authorise -> verify -> claim -> execute', () => {
  const s = src('app/api/admin/assistant/confirm/route.ts')
  it('in that order, and a claim that cannot be recorded stops before execute', () => {
    const idx = [
      s.indexOf('isAdminAuthorized(req)'),
      s.indexOf('verifyProposal(body?.token, actor)'),
      s.indexOf('claimProposal(supabase, proposal)'),
      s.indexOf('executeProposal(req, proposal)'),
    ]
    expect(idx.every(i => i > 0)).toBe(true)
    expect([...idx].sort((a, b) => a - b)).toEqual(idx)
    const unavailable = s.indexOf("claim === 'unavailable'")
    expect(unavailable).toBeGreaterThan(idx[2])
    expect(unavailable).toBeLessThan(idx[3])
    expect(s.slice(unavailable, idx[3])).toMatch(/status: 503/)
  })

  it('a claim is released only for a 4xx refusal, never for a 5xx that may have half-happened', () => {
    const i = s.indexOf('releaseProposal(supabase, proposal.id)')
    expect(i).toBeGreaterThan(0)
    expect(s.slice(i - 140, i)).toMatch(/result\.status >= 400 && result\.status < 500/)
    expect((s.match(/releaseProposal\(/g) ?? []).length).toBe(1)
  })
})

/* ── O5: the used-proposal store is durable ───────────────────────────── */

describe('O5: a restart cannot make a card replayable', () => {
  it('neither the store nor proposals.ts keeps state in the process', () => {
    for (const f of ['lib/assistant/usedProposals.ts', 'lib/assistant/proposals.ts']) {
      const s = src(f)
      expect(s).not.toMatch(/new Map\(|new Set\(|globalThis|__hhAssistantUsed/)
    }
    const store = src('lib/assistant/usedProposals.ts')
    expect(store).toMatch(/\.from\('assistant_used_proposals'\)\.insert\(/)
    expect(store).toMatch(/23505/)
  })

  it('the migration makes proposal_id the primary key, with RLS on and anon revoked', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), '..', '..', 'starting_plan', 'migration_084_assistant_threads.sql'), 'utf8')
    const block = sql.slice(sql.indexOf('CREATE TABLE IF NOT EXISTS public.assistant_used_proposals'), sql.indexOf('CREATE INDEX IF NOT EXISTS idx_assistant_used_proposals_expires'))
    expect(block).toMatch(/proposal_id uuid PRIMARY KEY/)
    for (const t of ['assistant_threads', 'assistant_used_proposals', 'photo_sets']) {
      expect(sql).toMatch(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`))
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON public\\.${t} FROM anon, authenticated`))
    }
    expect(sql).toMatch(/uq_assistant_threads_actor_context/)
  })

  it('behaviourally: a brand-new module instance (a restart) over the same table still refuses the second confirm', async () => {
    const rows = new Set<string>()
    const sb = {
      from: () => ({
        insert: async (row: { proposal_id: string }) =>
          rows.has(row.proposal_id) ? { error: { code: '23505', message: 'duplicate key' } } : (rows.add(row.proposal_id), { error: null }),
        delete: () => ({ lt: async () => ({ error: null }), eq: async () => ({ error: null }) }),
      }),
    } as never
    const { proposal } = mintProposal({ kind: 'send_photos', input: {}, title: 't', details: [], actor: ACTOR })

    let before = ''
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const first = require('@/lib/assistant/usedProposals') as typeof import('@/lib/assistant/usedProposals')
      before = 'loaded'
      return first.claimProposal(sb, proposal).then(r => expect(r).toBe('claimed'))
    })
    expect(before).toBe('loaded')
    await new Promise(r => setTimeout(r, 0))

    let second: string | undefined
    await new Promise<void>(resolve => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fresh = require('@/lib/assistant/usedProposals') as typeof import('@/lib/assistant/usedProposals')
        fresh.claimProposal(sb, proposal).then(r => {
          second = r
          resolve()
        })
      })
    })
    expect(second).toBe('already_used')
    // And the in-process claim function agrees.
    expect(await claimProposal(sb, proposal)).toBe('already_used')
  })
})

/* ── O6: the executor replays the dashboard's own action ──────────────── */

describe('O6: execute.ts replays the right admin action', () => {
  const original = () =>
    new NextRequest('https://www.example.com/api/admin/assistant/confirm', { method: 'POST', headers: { cookie: 'hh_admin=x', host: 'www.example.com' } })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const seen: { method: string; url: string; body: Record<string, unknown> }[] = []
  const capture = (resp: Response) => async (req: NextRequest) => {
    seen.push({ method: req.method, url: req.url, body: (await req.json()) as Record<string, unknown> })
    return resp
  }
  const prop = (kind: Proposal['kind'], input: Record<string, unknown>): Proposal => ({ id: 'p1', kind, input, title: 't', details: [], actor: ACTOR, expiresAt: Date.now() + 1000 })

  beforeEach(() => {
    seen.length = 0
    mockPost.mockReset()
    mockPatch.mockReset()
  })

  it('update_party is a PATCH carrying only the chat-editable columns', async () => {
    mockPatch.mockImplementation(capture(json({ ok: true, totalCents: 120000 })))
    const r = await executeProposal(original(), prop('update_party', { bookingId: BK, bookingRef: 'HH-PTY-X', updates: { guest_count_approx: 14, status: 'paid_in_full', total_cents: 1, balance_due_cents: 0 } }))
    expect(r.ok).toBe(true)
    expect(r.message).toContain('$1200.00')
    expect(seen[0].method).toBe('PATCH')
    expect(seen[0].url).toContain(`/api/admin/parties/${BK}`)
    expect(seen[0].body).toEqual({ guest_count_approx: 14 })
    expect(CHAT_EDITABLE_COLUMNS).not.toContain('status')
    expect(CHAT_EDITABLE_COLUMNS).not.toContain('total_cents')
  })

  it.each([
    ['add_line_item', { bookingId: BK, bookingRef: 'R', name: 'Balloon Garland', category: 'add-on', quantity: 1, unit_price_cents: 15000, guest_multiplied: false }, { action: 'add_line_item', name: 'Balloon Garland', unit_price_cents: 15000 }],
    ['remove_line_item', { bookingId: BK, bookingRef: 'R', lineItemId: 'li-2' }, { action: 'remove_line_item', line_item_id: 'li-2' }],
    ['edit_line_item', { bookingId: BK, bookingRef: 'R', lineItemId: 'li-2', changes: { unit_price_cents: 4000, status: 'paid_in_full' } }, { action: 'edit_line_item', line_item_id: 'li-2', unit_price_cents: 4000 }],
    ['edit_rental', { bookingId: BK, bookingRef: 'R', startTime: '10:00', endTime: '15:00' }, { action: 'edit_rental', startTime: '10:00', endTime: '15:00' }],
    ['change_theme', { bookingId: BK, bookingRef: 'R', themeId: 'th-1', themeName: 'Glow Party', mini: true, fromMobile: true, price_cents: 1 }, { action: 'change_theme', theme_id: 'th-1', mini: true, from_mobile: true }],
    ['add_discount', { bookingId: BK, bookingRef: 'R', label: 'Discount: Returning client', discountCents: 10000, reason: 'Returning client' }, { action: 'add_line_item', name: 'Discount: Returning client', category: 'discount', unit_price_cents: -10000, guest_multiplied: false }],
    ['send_message', { bookingId: BK, bookingRef: 'R', email: false, sms: true, smsBody: 'Hi Pat!\nRunning early.\nReply STOP to opt out' }, { action: 'send_message', confirm: true, email: false, sms: true, smsBody: 'Hi Pat!\nRunning early.\nReply STOP to opt out' }],
    ['set_preferences', { bookingId: BK, bookingRef: 'R', preferences: { pizzaOrBagels: 'bagels', total_cents: 1 } }, { action: 'set_preferences', pizzaOrBagels: 'bagels' }],
    ['cancel_party', { bookingId: BK, bookingRef: 'R' }, { action: 'cancel' }],
    ['mark_lost', { bookingId: BK, bookingRef: 'R' }, { action: 'mark_lost' }],
    ['send_photos', { bookingId: BK, bookingRef: 'R', photoIds: [P1], email: true, sms: false }, { action: 'send_photos', confirm: true, photoIds: [P1], email: true, sms: false }],
  ])('%s POSTs the matching action to the party route', async (kind, input, expected) => {
    mockPost.mockImplementation(capture(json({ ok: true, count: 1, sentVia: ['email'], failures: [] })))
    const r = await executeProposal(original(), prop(kind as Proposal['kind'], input))
    expect(r.ok).toBe(true)
    expect(seen[0].method).toBe('POST')
    expect(seen[0].body).toMatchObject(expected)
  })

  it('record_payment carries send_receipt:false unless the card said otherwise, and never force_ledger', async () => {
    mockPost.mockImplementation(capture(json({ ok: true, message: 'Payment of $250.00 recorded.' })))
    await executeProposal(original(), prop('record_payment', { bookingId: BK, bookingRef: 'R', amount_cents: 25000, payment_method: 'venmo', payment_type: 'partial' }))
    expect(seen[0].body).toMatchObject({ action: 'record_payment', amount_cents: 25000, payment_method: 'venmo', send_receipt: false })
    expect(seen[0].body).not.toHaveProperty('force_ledger')
    await executeProposal(original(), prop('record_payment', { bookingId: BK, bookingRef: 'R', amount_cents: 25000, payment_method: 'venmo', payment_type: 'partial', send_receipt: true }))
    expect(seen[1].body.send_receipt).toBe(true)
  })

  it('a refusal from the route comes back as not-ok with its status and reason (so a 4xx can release the claim)', async () => {
    mockPost.mockImplementation(capture(json({ error: 'This booking is cancelled — nothing was sent.' }, 409)))
    const r = await executeProposal(original(), prop('send_photos', { bookingId: BK, bookingRef: 'R', photoIds: [P1], email: true, sms: false }))
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(r.message).toContain('cancelled')
  })

  it('replays on the confirming admin\'s own credentials', async () => {
    mockPost.mockImplementation(async (req: NextRequest) => {
      expect(req.headers.get('cookie')).toBe('hh_admin=x')
      return json({ ok: true })
    })
    expect((await executeProposal(original(), prop('cancel_party', { bookingId: BK, bookingRef: 'R' }))).ok).toBe(true)
  })
})

/* ── O7: threads ──────────────────────────────────────────────────────── */

function fakeThreadDb() {
  const rows: Record<string, unknown>[] = []
  const sb = {
    from: () => {
      const preds: [string, unknown][] = []
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (c: string, v: unknown) => (preds.push([c, v]), chain)
      chain.maybeSingle = async () => ({ data: rows.find(r => preds.every(([c, v]) => r[c] === v)) ?? null, error: null })
      chain.upsert = async (row: Record<string, unknown>) => {
        const i = rows.findIndex(r => r.actor === row.actor && r.context_key === row.context_key)
        if (i >= 0) rows[i] = { ...rows[i], ...row }
        else rows.push({ id: `t${rows.length + 1}`, ...row })
        return { error: null }
      }
      return chain
    },
  }
  return { sb: sb as never, rows }
}

describe('O7: threads', () => {
  it('screenContext narrows to a closed vocabulary and the key is per booking', () => {
    expect(screenContext({ page: 'invoice', booking_ref: 'HH-PTY-AB12C' })).toEqual({ page: 'invoice', bookingRef: 'HH-PTY-AB12C' })
    expect(screenContext({ page: '/etc/passwd', booking_ref: 'x; drop table' })).toEqual({ page: 'admin', bookingRef: null })
    expect(screenContext(null)).toEqual({ page: 'assistant', bookingRef: null })
    expect(contextKey(screenContext({ page: 'invoice', booking_ref: 'HH-PTY-AB12C' }))).toBe('booking:HH-PTY-AB12C')
    expect(contextKey(screenContext({}))).toBe('general')
    expect(contextPromptLine(screenContext({ page: 'invoice', booking_ref: 'HH-PTY-AB12C' }))).toContain('HH-PTY-AB12C')
    expect(contextPromptLine(screenContext({}))).toBeNull()
    expect(systemPrompt('2026-11-04', screenContext({ page: 'invoice', booking_ref: 'HH-PTY-AB12C' }))).toContain('they mean HH-PTY-AB12C')
  })

  it('one thread per admin per context; another admin never sees it', async () => {
    const { sb } = fakeThreadDb()
    await writeThread(sb, ACTOR, 'booking:R1', 'R1', [{ role: 'user', content: 'hi' }], [{ role: 'user', text: 'hi' }])
    await writeThread(sb, ACTOR, 'booking:R1', 'R1', [{ role: 'user', content: 'again' }], [{ role: 'user', text: 'again' }])
    await writeThread(sb, ACTOR, 'general', null, [], [])
    const mine = await readThread(sb, ACTOR, 'booking:R1')
    expect(mine.kind === 'ok' && mine.thread?.lines).toEqual([{ role: 'user', text: 'again' }])
    const theirs = await readThread(sb, 'admin:b@example.com', 'booking:R1')
    expect(theirs.kind === 'ok' && theirs.thread).toBeNull()
  })

  it('a pending card past its token life is shown expired, never confirmable', () => {
    const card = (state: 'pending' | 'done', expiresAt: number) => ({ id: 'c', title: 't', details: [], token: 'tok', kind: 'cancel_party', state, expiresAt })
    const lines: ThreadLine[] = [{ role: 'assistant', text: 'x', cards: [card('pending', 1000), card('done', 1000), card('pending', 9_000_000_000_000)] }]
    const out = expireStaleCards(lines, 5000)
    expect(out[0].cards!.map(c => c.state)).toEqual(['expired', 'done', 'pending'])
  })

  it('a confirmed card is written into both documents so the next answer knows', async () => {
    const { sb } = fakeThreadDb()
    const card = { id: 'c1', title: 'Cancel R1', details: [], token: 't', kind: 'cancel_party', state: 'pending' as const, expiresAt: 9e12 }
    await writeThread(sb, ACTOR, 'booking:R1', 'R1', [], [{ role: 'assistant', text: 'ok', cards: [card] }])
    await recordCardOutcome(sb, ACTOR, 'booking:R1', 'R1', { id: 'c1', title: 'Cancel R1' }, { state: 'done', message: 'Cancelled R1.' })
    const r = await readThread(sb, ACTOR, 'booking:R1')
    if (r.kind !== 'ok' || !r.thread) throw new Error('thread missing')
    expect(r.thread.lines[0].cards![0]).toMatchObject({ state: 'done', result: 'Cancelled R1.' })
    expect((r.thread.messages[0] as { content: string }).content).toContain('confirmed "Cancel R1". Result: Cancelled R1.')
  })

  it('a dismissed card is noted from the STORED title, not from anything the browser sent', async () => {
    const { sb } = fakeThreadDb()
    const card = { id: 'c9', title: 'Cancel R9', details: [], token: 't', kind: 'cancel_party', state: 'pending' as const, expiresAt: 9e12 }
    await writeThread(sb, ACTOR, 'general', null, [], [{ role: 'assistant', text: 'ok', cards: [card] }])
    await recordCardDismissed(sb, ACTOR, 'general', null, 'c9')
    await recordCardDismissed(sb, ACTOR, 'general', null, 'no-such-card')
    const r = await readThread(sb, ACTOR, 'general')
    if (r.kind !== 'ok' || !r.thread) throw new Error('thread missing')
    expect(r.thread.lines[0].cards![0].state).toBe('dismissed')
    expect(r.thread.messages).toHaveLength(1)
    expect((r.thread.messages[0] as { content: string }).content).toBe('[Manager dismissed "Cancel R9" — it was not done.]')
  })

  it('the chat route no longer trusts a browser-held history', () => {
    const s = src('app/api/admin/assistant/route.ts')
    expect(s).not.toMatch(/body\?\.messages/)
    expect(s).toMatch(/readThread\(supabase, actor, key\)/)
    expect(s).toMatch(/writeThread\(/)
  })
})

/* ── O8: photo sets ───────────────────────────────────────────────────── */

describe('O8: a photo-set link', () => {
  const photoRow = (id: string, over: Record<string, unknown> = {}) => ({
    id, url: `https://cdn.example/media/${id}.webp`, alt: `Alt ${id.slice(-1)}`, w: 8, h: 6, party_type: 'in_studio_theme', theme_slug: null,
    activities: [], ig_permalink: null, approved: true, no_identifiable_faces: true, sort: 0, ...over,
  })

  it('tokens are signed: a tampered, truncated or foreign token is refused without a lookup', () => {
    const code = newPhotoSetCode()
    expect(code).toMatch(/^[a-z2-9]{10}$/)
    const token = photoSetToken(code, 's1')
    expect(token).toHaveLength(18)
    expect(verifyPhotoSetToken(token, 's1')).toBe(code)
    expect(verifyPhotoSetToken(token, 's2')).toBeNull()
    expect(verifyPhotoSetToken(`${token.slice(0, 17)}${token[17] === 'a' ? 'b' : 'a'}`, 's1')).toBeNull()
    expect(verifyPhotoSetToken(token.slice(0, 17), 's1')).toBeNull()
    expect(verifyPhotoSetToken(`${code.toUpperCase()}${token.slice(10)}`, 's1')).toBeNull()
    for (const junk of [undefined, null, 5, '', '../../etc', 'x'.repeat(18)]) expect(verifyPhotoSetToken(junk as never, 's1')).toBeNull()
  })

  it('serves the stored photos in the stored order, and stops serving one that is later withdrawn', async () => {
    const d = makeFakeMoneyDb({ media_assets: [photoRow(P1), photoRow(P2)], photo_sets: [], bookings: [{ id: BK, booking_ref: 'R' }] })
    const made = await createPhotoSet(d.client as never, { bookingId: BK, photoIds: [P2, P1], actor: ACTOR })
    if (!made.ok) throw new Error('set not created')
    expect(made.url).toMatch(/\/p\/[a-z0-9]{18}$/)
    const first = await loadPhotoSet(d.client as never, made.token)
    expect(first.kind === 'ok' && first.photos.map(p => p.id)).toEqual([P2, P1])
    // A human withdraws approval AFTER the link went out.
    ;(d.rows('media_assets').find(r => r.id === P2) as Record<string, unknown>).approved = false
    const second = await loadPhotoSet(d.client as never, made.token)
    expect(second.kind === 'ok' && second.photos.map(p => p.id)).toEqual([P1])
    ;(d.rows('media_assets').find(r => r.id === P1) as Record<string, unknown>).no_identifiable_faces = false
    expect(await loadPhotoSet(d.client as never, made.token)).toEqual({ kind: 'gone' })
  })

  it('an expired link and an unknown link are the same answer', async () => {
    const d = makeFakeMoneyDb({ media_assets: [photoRow(P1)], photo_sets: [], bookings: [{ id: BK, booking_ref: 'R' }] })
    const made = await createPhotoSet(d.client as never, { bookingId: BK, photoIds: [P1], actor: ACTOR, now: new Date('2026-01-01T00:00:00Z') })
    if (!made.ok) throw new Error('set not created')
    expect(await loadPhotoSet(d.client as never, made.token, new Date('2026-06-01T00:00:00Z'))).toEqual({ kind: 'gone' })
    expect(await loadPhotoSet(d.client as never, photoSetToken(newPhotoSetCode()))).toEqual({ kind: 'gone' })
  })

  it('caps a set at the library limit and refuses an empty one', async () => {
    const d = makeFakeMoneyDb({ photo_sets: [], bookings: [{ id: BK, booking_ref: 'R' }] })
    const many = Array.from({ length: 30 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const made = await createPhotoSet(d.client as never, { bookingId: BK, photoIds: many, actor: ACTOR })
    expect(made.ok).toBe(true)
    expect(((d.rows('photo_sets')[0] as { photo_ids: string[] }).photo_ids).length).toBe(12)
    expect((await createPhotoSet(d.client as never, { bookingId: BK, photoIds: [], actor: ACTOR })).ok).toBe(false)
  })

  it('the text is one short link signed by the tenant sign-off; the email escapes text and screens image URLs', () => {
    const sms = photosSmsText('Pat Example', 'https://www.example.com/p/abcdefghjkmnpqrstu', 3)
    expect(sms).toContain('https://www.example.com/p/abcdefghjkmnpqrstu')
    expect(sms).toContain(`It's ${TENANT.people.customerSignoff} from ${TENANT.business.name}`)
    expect(sms).toContain('Reply STOP to opt out')
    expect(sms.split('\n').length).toBe(3)
    const photos = [
      { id: P1, url: 'https://cdn.example/a.webp', alt: '<script>alert(1)</script>', w: 1, h: 1, partyType: null, themeSlug: null, activities: [], igPermalink: null },
      { id: P2, url: 'javascript:alert(1)', alt: 'bad', w: 1, h: 1, partyType: null, themeSlug: null, activities: [], igPermalink: null },
    ]
    jest.spyOn(console, 'warn').mockImplementation(() => {})
    const html = photosEmailHtml('<b>Pat</b>', photos, 'https://www.example.com/p/x')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('src="https://cdn.example/a.webp"')
    expect(html).toContain('&lt;b&gt;Pat&lt;/b&gt;')
    expect((html.match(/<img /g) ?? []).length).toBe(1)
  })

  it('the page is noindex, no-referrer, a flat 404 for a bad link, and only the page reads photo_sets', () => {
    const layout = src('app/p/layout.tsx')
    expect(layout).toMatch(/robots: NOINDEX/)
    expect(layout).toMatch(/referrer: 'no-referrer'/)
    const page = src('app/p/[token]/page.tsx')
    expect(page).toMatch(/loadPhotoSet\(getSupabase\(\), token\)/)
    expect(page).toMatch(/if \(set\.kind === 'gone'\) notFound\(\)/)
    const readers = walk(SRC)
      .filter(f => !f.includes('__tests__'))
      .filter(f => /from\('photo_sets'\)/.test(decomment(fs.readFileSync(f, 'utf8'))))
      .map(rel)
      .sort()
    expect(readers).toEqual(['lib/photoSets.ts'])
  })

  it('the route\'s photo send resolves photos only through findPhotos and never attaches media to a text', () => {
    const route = src('app/api/admin/parties/[id]/route.ts')
    const start = route.indexOf("if (action === 'send_photos')")
    const end = route.indexOf("if (action === 'delete_booking')")
    const body = route.slice(start, end)
    expect(body).toMatch(/findPhotos\(/)
    expect(body).not.toMatch(/from\('media_assets'\)/)
    expect(body).toMatch(/checkSmsQuietHours\(/)
    expect(body).toMatch(/phoneHasExplicitStop\(/)
    expect(body).toMatch(/logBookingChange\(/)
    // sendSMSVia(provider, number, body) — three arguments, no media option.
    expect(body).toMatch(/sendSMSVia\(\s*'quo',\s*normalizePhone\(phone\),[^;]*photosSmsText\(/)
    expect(body).not.toMatch(/mediaUrl|MMS|mms/)
    // Quiet hours and STOP are decided before anything is created or sent.
    expect(body.indexOf('checkSmsQuietHours(')).toBeLessThan(body.indexOf('createPhotoSet('))
    expect(body.indexOf('createPhotoSet(')).toBeLessThan(body.indexOf('resend.emails.send('))
  })
})
