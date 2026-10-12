import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import fs from 'fs'
import path from 'path'
import InvitationCard, { InvitationCardView, PRINT_CSS, PrintSheet, type InvitationPayload, type InvitationViewProps } from '@/components/admin/InvitationCard'
import { adminRsvpViews, summarizeRsvps, summarizeSends } from '@/lib/evites/adminView'
import { ADMIN_RSVP_COLUMNS } from '@/lib/evites/views'
import { readSrc } from '../helpers/sourceScan'

/**
 * The admin "Invitation & RSVPs" card (P08), rendered with react-dom/server (the repo's
 * jest is node-only): what the markup says for a fixture, and the source rules that keep
 * the print stylesheet scoped and raw addresses out of the browser bundle.
 */

const kid = (n: string) => ({ first_name: n })
const row = (o: Record<string, unknown>) => ({
  id: 'r',
  status: 'yes',
  revision: 1,
  parent_name: 'Pat Parent',
  children: [kid('Ava')],
  child_count: 1,
  adult_count: 1,
  has_allergy: false,
  allergy_note: null,
  note_to_honoree: null,
  reminder_opt_out_at: null,
  club_opt_in_at: null,
  club_opted_out_at: null,
  allergy_purged_at: null,
  contacts_purged_at: null,
  created_at: '2026-10-20T12:00:00Z',
  updated_at: '2026-10-20T12:00:00Z',
  ...o,
})

const NOW = new Date('2026-11-01T15:00:00Z')

function fixture(over: Partial<InvitationPayload> = {}, cap: number | null = 10): InvitationPayload {
  const rows = adminRsvpViews(
    [
      row({ id: 'r1', parent_name: 'Pat Parent', children: [kid('Ava'), kid('Ben'), kid('Cleo'), kid('Dan'), kid('Eve'), kid('Fay')], adult_count: 2, has_allergy: true, allergy_note: 'peanuts', note_to_honoree: 'Happy birthday Mia!' }),
      row({ id: 'r2', parent_name: 'Quinn Q', children: [kid('Gus'), kid('Hal'), kid('Ivy'), kid('Jo'), kid('Kai')], adult_count: 1 }),
      row({ id: 'r3', parent_name: 'Rae R', status: 'no', children: [], child_count: 0, adult_count: 0 }),
    ] as never,
    [{ id: 'r1', reminder_email: 'x@y.org', reminder_phone_e164: null, club_email: null }],
    ADMIN_RSVP_COLUMNS,
  )
  return {
    eligible: true,
    pagesMode: 'on',
    sendsMode: 'on',
    booking: { id: 'b', bookingRef: 'HH-TEST-1', status: 'deposit_paid', partyDate: '2026-11-14', contactName: 'Pat' },
    state: 'live',
    evite: {
      id: 'e',
      slug: 'mia-glow-7kq2',
      previousSlugs: [],
      templateSlug: 'glow',
      themeWord: null,
      themeSub: null,
      renderVersion: 2,
      renderedAt: '2026-10-31T12:00:00Z',
      renderError: null,
      calVersion: 0,
      wentLiveAt: null,
      cancelledNoticeAt: null,
      archivedAt: null,
      createdAt: '2026-10-01T12:00:00Z',
      canReslug: true,
    },
    facts: {
      title: "Mia's Glow Party",
      hasName: true,
      themeWord: 'GLOW',
      themeSub: 'PARTY',
      templateSlug: 'glow',
      dateLine: 'Saturday, November 14 · 2–4 PM',
      placeLine: 'Host Hampton · 295 Montauk Hwy, Speonk',
      hostContactLine: null,
      hostNote: null,
      giftNote: null,
      rsvpDeadline: null,
      guestCap: cap,
    },
    links: { publicUrl: 'https://www.hosthampton.com/i/mia-glow-7kq2', hostPageUrl: 'https://www.hosthampton.com/my-booking/invitation', hostPageNote: "Opens with the customer's own sign-in, so it is shown for information." },
    images: { invite: null, og: null },
    templateOptions: ['glow', 'plain'],
    renderFresh: true,
    warnings: { needsTime: false, noParentEmail: false },
    rsvps: { available: true, truncated: false, rows },
    summary: summarizeRsvps(rows, cap),
    ledger: {
      available: true,
      truncated: false,
      groups: summarizeSends(
        [
          { rsvp_id: null, send_type: 'lead_preview', channel: 'email', status: 'sent', attempts: 1, outcome: null, last_error: null, claimed_at: '2026-10-30T12:00:00Z', sent_at: '2026-10-30T12:00:03Z' },
          { rsvp_id: 'r1', send_type: 'new_rsvp', channel: 'email', status: 'failed', attempts: 3, outcome: null, last_error: 'resend 500', claimed_at: '2026-10-31T12:00:00Z', sent_at: null },
          { rsvp_id: 'r2', send_type: 'new_rsvp', channel: 'email', status: 'sending', attempts: 1, outcome: null, last_error: null, claimed_at: '2026-11-01T14:00:00Z', sent_at: null },
        ] as never,
        NOW,
      ),
    },
    ...over,
  }
}

const noop = () => undefined
function view(data: InvitationPayload, over: Partial<InvitationViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(InvitationCardView, { data, busy: null, message: null, revealed: {}, onAction: noop, onReveal: noop, onPrint: noop, ...over }),
  )
}

describe('InvitationCardView with a fixture', () => {
  it('the state chip, links, headcount and the over-cap warning', () => {
    const html = view(fixture())
    expect(html).toContain('Invitation &amp; RSVPs')
    expect(html).toMatch(/data-testid="state-chip"[^>]*>Live</)
    expect(html).toContain('https://www.hosthampton.com/i/mia-glow-7kq2')
    expect(html).toContain('/my-booking/invitation')
    expect(html).toContain('own sign-in')
    // "11 of 10 kids", in red.
    expect(html).toMatch(/<strong class="[^"]*text-red-600[^"]*" data-testid="headcount">11 of 10 kids<\/strong>/)
    expect(html).toContain('More kids than the booked guest count')
    expect(html).toContain('3+ adults')
    expect(html).toContain('2 coming')
    expect(html).toContain('1 declined')
  })

  it('under the cap the headcount is not red; with no cap it says just "kids"', () => {
    const html = view(fixture({}, 12))
    expect(html).toMatch(/<strong class="[^"]*text-\[#1a2744\][^"]*" data-testid="headcount">11 of 12 kids/)
    expect(html).not.toContain('More kids than the booked guest count')
    expect(view(fixture({}, null))).toContain('>11 kids<')
  })

  it('allergies and the notes to the birthday child', () => {
    const html = view(fixture())
    expect(html).toContain('Ava, Ben, Cleo, Dan, Eve, Fay (Pat Parent): peanuts')
    expect(html).toContain('Happy birthday Mia!')
  })

  it('the send ledger: counts, and the failed / stuck rows in red with their reasons', () => {
    const html = view(fixture())
    expect(html).toContain('Lead preview')
    expect(html).toContain('1 sent')
    expect(html).toContain('New RSVP (to parent)')
    expect(html).toContain('1 sending')
    expect(html).toContain('1 failed')
    expect(html).toMatch(/data-testid="ledger-stuck"/)
    expect(html).toContain('resend 500')
    expect(html).toContain('2 stuck or failed')
  })

  it('an unavailable ledger says so and does NOT say nothing was sent', () => {
    const html = view(fixture({ ledger: { available: false, error: 'Ledger unavailable' } }))
    expect(html).toContain('Ledger unavailable')
    expect(html).not.toContain('Nothing sent yet')
    expect(view(fixture({ ledger: { available: true, truncated: false, groups: [] } }))).toContain('Nothing sent yet')
  })

  it('unavailable RSVPs say so instead of "0 kids"', () => {
    const html = view(fixture({ rsvps: { available: false, error: 'RSVPs unavailable' }, summary: null }))
    expect(html).toContain('RSVPs unavailable')
    expect(html).not.toContain('0 kids')
    expect(html).not.toContain('data-testid="headcount"')
  })

  it('warnings: needs a start time, no parent email, a failed render', () => {
    const base = fixture()
    const html = view({ ...base, state: 'needs_time', warnings: { needsTime: true, noParentEmail: true }, evite: { ...base.evite!, renderError: 'og-too-large' } })
    expect(html).toMatch(/data-testid="state-chip"[^>]*>Needs a start time</)
    expect(html).toContain('Needs a start time. Guests cannot RSVP')
    expect(html).toContain('No parent email: share the invitation manually')
    expect(html).toContain('Last render failed: og-too-large')
    expect(view(fixture())).not.toContain('No parent email')
  })

  it('shows no raw contact; the reveal button exists only for an RSVP that has one, and the revealed value shows only when asked', () => {
    const html = view(fixture())
    expect(html).not.toContain('x@y.org')
    expect((html.match(/Show contact/g) ?? []).length).toBe(1)
    expect((html.match(/no contact/g) ?? []).length).toBe(2)
    const shown = view(fixture(), { revealed: { r1: { reminderEmail: 'x@y.org', reminderPhone: null, clubEmail: null } } })
    expect(shown).toContain('x@y.org')
  })

  it('has a button for each action, and "Tell guests" only for a cancelled party', () => {
    const html = view(fixture())
    for (const label of ['Re-render', 'Print RSVP sheet', 'Archive', 'Re-mint link', 'Apply']) expect(html).toContain(label)
    expect(html).not.toContain('Tell guests')
    const base = fixture()
    expect(view({ ...base, booking: { ...base.booking!, status: 'cancelled' } })).toContain('Tell guests it&#x27;s cancelled')
  })

  it('Re-mint link is disabled once the invitation has gone live; archived offers Unarchive instead', () => {
    const base = fixture()
    const live = view({ ...base, evite: { ...base.evite!, canReslug: false, wentLiveAt: '2026-10-31T00:00:00Z' } })
    expect(live).toMatch(/<button[^>]*disabled=""[^>]*>Re-mint link<\/button>/)
    expect(live).toContain('the link can no longer change')
    expect(view(base)).not.toMatch(/<button[^>]*disabled=""[^>]*>Re-mint link<\/button>/)
    const archived = view({ ...base, state: 'unavailable', evite: { ...base.evite!, archivedAt: '2026-10-30T00:00:00Z' } })
    expect(archived).toContain('Unarchive')
    expect(archived).not.toMatch(/>Archive</)
    expect(archived).toContain('Archived')
  })

  it('send_invite_ready: the button appears for a live invitation, is asked to be confirmed, and a held booking says so', () => {
    const base = fixture()
    expect(view(base)).toContain('Send invitation email to parent')
    expect(view({ ...base, state: 'preview' })).not.toContain('Send invitation email to parent')
    expect(view({ ...base, state: 'needs_time' })).not.toContain('Send invitation email to parent')
    const held = view({ ...base, autosend: { configured: true, allowed: false } })
    expect(held).toContain('data-testid="invite-ready-held"')
    expect(held).toContain('booked before launch')
    expect(view({ ...base, autosend: { configured: true, allowed: true } })).not.toContain('invite-ready-held')
    expect(view({ ...base, autosend: { configured: false, allowed: false } })).toContain('automatic sending is not configured')
    expect(view({ ...base, warnings: { needsTime: false, noParentEmail: true } })).toMatch(/<button[^>]*disabled=""[^>]*>Send invitation email to parent<\/button>/)
    expect(view({ ...base, booking: { ...base.booking!, status: 'cancelled' } })).not.toContain('Send invitation email to parent')
  })

  it('buttons lock while an action is in flight', () => {
    const html = view(fixture(), { busy: 'rerender' })
    expect(html).toContain('Rendering...')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Rendering\.\.\.<\/button>/)
  })

  it('no invitation yet: one button, disabled when it cannot be made', () => {
    const none: InvitationPayload = { evite: null, eligible: true, pagesMode: 'on', sendsMode: 'on', canEnsure: true }
    expect(view(none)).toMatch(/<button(?![^>]*disabled="")[^>]*>Create invitation<\/button>/)
    expect(view({ ...none, canEnsure: false, pagesMode: 'off' })).toMatch(/<button[^>]*disabled=""[^>]*>Create invitation<\/button>/)
    expect(view({ ...none, canEnsure: false, pagesMode: 'off' })).toContain('switched off')
  })

  it('a message from the last action is shown', () => {
    expect(view(fixture(), { message: { ok: false, text: 'This invitation has gone live' } })).toContain('This invitation has gone live')
  })
})

describe('the Print RSVP sheet', () => {
  it('is in the card, hidden on screen, and carries the party header, kids, adults, allergies and notes', () => {
    const html = view(fixture())
    const start = html.indexOf('class="evite-print-sheet"')
    expect(start).toBeGreaterThan(-1)
    const sheet = html.slice(start)
    expect(sheet).toContain("Mia&#x27;s Glow Party")
    expect(sheet).toContain('Saturday, November 14')
    expect(sheet).toContain('HH-TEST-1')
    expect(sheet).toContain('11 of 10 kids')
    expect(sheet).toContain('Pat Parent')
    expect(sheet).toContain('Ava, Ben, Cleo, Dan, Eve, Fay')
    expect(sheet).toContain('2+')
    expect(sheet).toContain('peanuts')
    expect(sheet).toContain('Happy birthday Mia!')
    expect(sheet).toContain('Can&#x27;t come (1)')
    expect(sheet).toContain('Rae R')
  })

  it('never carries a raw contact', () => {
    const html = renderToStaticMarkup(createElement(PrintSheet, { data: fixture() }))
    expect(html).not.toContain('x@y.org')
    expect(html).not.toMatch(/@[a-z0-9-]+\.(org|com|net)/i)
  })

  it('prints a sheet even when the RSVPs could not be read, and says so', () => {
    const html = renderToStaticMarkup(createElement(PrintSheet, { data: fixture({ rsvps: { available: false, error: 'x' }, summary: null }) }))
    expect(html).toContain('RSVPs unavailable when this sheet was printed')
  })

  it('the print stylesheet hides everything except the sheet', () => {
    const css = PRINT_CSS.replace(/\s+/g, ' ')
    expect(css).toMatch(/\.evite-print-sheet \{ display: none; \}/)
    expect(css).toContain('@media print')
    expect(css).toMatch(/body \* \{ visibility: hidden !important; \}/)
    expect(css).toMatch(/\.evite-print-sheet, \.evite-print-sheet \* \{ visibility: visible !important; \}/)
    expect(css).toMatch(/\.evite-print-sheet \{ display: block !important; position: absolute;/)
    // The hide rule is INSIDE the print media query, so the screen is untouched.
    expect(css.indexOf('body *')).toBeGreaterThan(css.indexOf('@media print'))
    // And the card ships the stylesheet.
    expect(view(fixture())).toContain('@media print')
  })

  it('the Print button is wired to window.print', () => {
    const src = readSrc('components', 'admin', 'InvitationCard.tsx')
    expect(src).toMatch(/onPrint=\{\(\)\s*=>\s*window\.print\(\)\}/)
  })
})

describe('the default export (fetching shell)', () => {
  const props = { bookingId: '11111111-1111-4111-8111-111111111111', headers: { authorization: 'Bearer x' } }

  it('renders a loading card for an eligible booking', () => {
    const html = renderToStaticMarkup(createElement(InvitationCard, { ...props, status: 'deposit_paid', partyType: 'in_studio_theme', partyTags: null }))
    expect(html).toContain('data-testid="invitation-card-loading"')
    expect(html).toContain('Invitation &amp; RSVPs')
  })

  it('renders NOTHING for a booking that could never have an invitation (studio rental, unknown with no location)', () => {
    expect(renderToStaticMarkup(createElement(InvitationCard, { ...props, status: 'deposit_paid', partyType: 'studio_rental', partyTags: null }))).toBe('')
    expect(renderToStaticMarkup(createElement(InvitationCard, { ...props, status: 'inquiry', partyType: null, partyTags: {} }))).toBe('')
  })

  it('a cancelled party of an eligible type still gets the card (there may be an invitation to withdraw)', () => {
    const html = renderToStaticMarkup(createElement(InvitationCard, { ...props, status: 'cancelled', partyType: 'mobile_party', partyTags: null }))
    expect(html).toContain('invitation-card-loading')
  })

  it('party_type unknown falls back to the planner location', () => {
    const html = renderToStaticMarkup(createElement(InvitationCard, { ...props, status: 'approved', partyType: 'unknown', partyTags: { location_type: 'mobile' } }))
    expect(html).toContain('invitation-card-loading')
  })
})

describe('source rules', () => {
  const card = () => readSrc('components', 'admin', 'InvitationCard.tsx')

  it('imports from adminView as TYPES only: its runtime code reads font files and must not reach the browser', () => {
    const src = card()
    const imports = src.match(/import[^;]*?from\s*['"][^'"]+['"]/g) ?? []
    expect(imports.length).toBeGreaterThan(2)
    for (const i of imports) {
      if (/lib\/evites\/adminView/.test(i)) expect(i).toMatch(/^import\s+type\b/)
      // Nothing server-side: no supabase, no fs, no render pipeline.
      expect(i).not.toMatch(/lib\/supabase|['"]fs['"]|evites\/render|evites\/glyphs|evites\/adminLoad/)
    }
    expect(src).toMatch(/lib\/evites\/adminView/)
  })

  it('is a client component and fetches only the invitation endpoint', () => {
    const raw = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'admin', 'InvitationCard.tsx'), 'utf8')
    expect(raw.split(/\r?\n/)[0]).toBe("'use client'")
    const urls = card().match(/\/api\/[^`'"?]*/g) ?? []
    expect(urls.length).toBeGreaterThan(0)
    for (const u of urls) expect(u).toMatch(/^\/api\/admin\/parties\//)
    expect(card()).toMatch(/\/invitation`/)
  })

  it('asks for confirmation before archive, reslug and notify_cancelled', () => {
    const src = card()
    const block = src.slice(src.indexOf('const CONFIRMS'), src.indexOf('export default function InvitationCard'))
    for (const a of ['archive', 'reslug', 'notify_cancelled']) expect(block).toMatch(new RegExp(`${a}:`))
    expect(src).toMatch(/window\.confirm\(confirmText\)/)
  })

  it('PartiesTab mounts the card in the detail drawer with the booking id and the auth headers', () => {
    const src = readSrc('app', 'admin', 'PartiesTab.tsx')
    expect(src).toMatch(/import InvitationCard from '@\/components\/admin\/InvitationCard'/)
    const at = src.indexOf('<InvitationCard')
    expect(at).toBeGreaterThan(-1)
    const tag = src.slice(at, src.indexOf('/>', at))
    expect(tag).toMatch(/bookingId=\{selected\.id\}/)
    expect(tag).toMatch(/headers=\{headers\}/)
    expect(tag).toMatch(/partyType=\{selected\.party_type\}/)
    expect((src.match(/<InvitationCard/g) ?? []).length).toBe(1)
  })
})
