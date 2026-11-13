import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { InvitationCardView, type InvitationPayload } from '@/components/admin/InvitationCard'
import { BookedInvitationView } from '@/components/admin/BookedInvitation'
import { adminRsvpViews, summarizeRsvps } from '@/lib/evites/adminView'
import { ADMIN_RSVP_COLUMNS } from '@/lib/evites/views'

/**
 * The admin Invitation card for an outside event (audience 'guests'): "Guests" and "host", never
 * "Kids" and "parent"; the kids' wording unchanged; and the host's-own-image control.
 */

const kid = (n: string) => ({ first_name: n })
const rowsFor = () =>
  adminRsvpViews(
    [
      {
        id: 'r1', status: 'yes', revision: 1, parent_name: 'Pat Guest', children: [kid('Pat'), kid('Lee')], child_count: 2, adult_count: 0,
        has_allergy: false, allergy_note: null, note_to_honoree: 'Congratulations!', reminder_opt_out_at: null, club_opt_in_at: null,
        club_opted_out_at: null, allergy_purged_at: null, contacts_purged_at: null, created_at: '2026-10-20T12:00:00Z', updated_at: '2026-10-20T12:00:00Z',
      },
    ] as never,
    [],
    ADMIN_RSVP_COLUMNS,
  )

function payload(audience: 'kids' | 'guests', over: Partial<InvitationPayload['evite'] & object> = {}): InvitationPayload {
  const rows = rowsFor()
  return {
    eligible: true,
    pagesMode: 'on',
    sendsMode: 'on',
    booking: { id: 'b', bookingRef: 'HH-PTY-WQ3TC', status: 'deposit_paid', partyDate: '2026-11-21', contactName: 'Maeghan' },
    state: 'live',
    evite: {
      id: 'e', slug: 'x', previousSlugs: [], templateSlug: 'custom', themeWord: null, themeSub: null, renderVersion: 1, renderedAt: null,
      renderError: null, calVersion: 1, wentLiveAt: null, cancelledNoticeAt: null, archivedAt: null, createdAt: '2026-10-01T00:00:00Z', canReslug: true,
      ...over,
    },
    facts: {
      title: 'Baby Shower', hasName: true, themeWord: 'BABY', themeSub: 'SHOWER', templateSlug: 'plain', dateLine: 'Saturday, November 21',
      placeLine: 'James Joyce', hostContactLine: null, hostNote: null, giftNote: null, rsvpDeadline: null, guestCap: 30, audience,
    },
    warnings: { needsTime: false, noParentEmail: true },
    autosend: { configured: true, allowed: false },
    rsvps: { available: true, truncated: false, rows },
    summary: summarizeRsvps(rows, 30),
    ledger: { available: true, truncated: false, groups: [] },
  } as unknown as InvitationPayload
}

const view = (data: InvitationPayload) =>
  renderToStaticMarkup(
    createElement(InvitationCardView, { data, busy: null, message: null, revealed: {}, onAction: () => undefined, onReveal: () => undefined, onPrint: () => undefined, onArt: () => undefined }),
  )

describe('outside event wording', () => {
  const out = view(payload('guests'))
  it('says Guests and host', () => {
    expect(out).toContain('2 of 30 guests')
    expect(out).toContain('No host email')
    expect(out).toContain('Send invitation email to host')
    expect(out).toContain('Notes to the host')
    expect(out).toContain('Notes for the host') // the print sheet
    expect(out).toContain('<th>Guests</th>')
    expect(out).toContain('<th>Name</th>')
  })
  it('never says kids, parent or adults', () => {
    expect(out).not.toMatch(/\bkids?\b/i)
    expect(out).not.toMatch(/\bparent\b/i)
    expect(out).not.toMatch(/\badults?\b/i)
    expect(out).not.toContain('birthday child')
  })
})

describe('the kids wording is unchanged', () => {
  for (const audience of ['kids', undefined] as const) {
    const out = view(payload((audience ?? 'kids') as 'kids'))
    it(`audience ${String(audience)}`, () => {
      expect(out).toContain('2 of 30 kids')
      expect(out).toContain('No parent email')
      expect(out).toContain('Send invitation email to parent')
      expect(out).toContain('Notes to the birthday child')
      expect(out).toContain('<th>Parent</th>')
      expect(out).toContain('<th>Kids</th>')
      expect(out).toContain('<th>Adults</th>')
    })
  }
})

describe("the host's own invitation image control", () => {
  it('offers upload with a file input that takes images only; Remove only when one is set', () => {
    const none = view(payload('guests', { hasCustomArt: false }))
    expect(none).toContain('Upload the host&#x27;s own invitation image')
    expect(none).toContain('accept="image/jpeg,image/png,image/webp"')
    expect(none).not.toContain('Remove it')
    const set = view(payload('guests', { hasCustomArt: true }))
    expect(set).toContain('Remove it')
    expect(set).toContain('in use')
  })
})

describe('the Booked row', () => {
  const entry = (audience?: 'kids' | 'guests') =>
    ({
      eligible: true,
      canEnsure: true,
      noParentEmail: true,
      ...(audience ? { audience } : {}),
      evite: { slug: 'x', publicUrl: 'https://www.hosthampton.com/i/x', state: 'live', renderFresh: true, inviteReadySent: false },
    }) as never
  const row = (e: never) => renderToStaticMarkup(createElement(BookedInvitationView, { entry: e, busy: null, message: null, onCreate: () => undefined, onSend: () => undefined }))
  it('says host for an outside event and parent otherwise', () => {
    expect(row(entry('guests'))).toContain('Send to host')
    expect(row(entry('guests'))).toContain('No host email')
    expect(row(entry('kids'))).toContain('Send to parent')
    expect(row(entry())).toContain('No parent email')
  })
})
