import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BookedInvitationView, type BookedInvitationViewProps, type SummaryEntry } from '@/components/admin/BookedInvitation'
import type { EviteSummary } from '@/lib/evites/adminSummary'
import { readSrc } from '../helpers/sourceScan'

/**
 * The per-party invitation button on the admin Booked page, rendered with react-dom/server (the repo's jest is
 * node-only): what the markup says for each kind of summary, plus the source rules for the wiring.
 */

const EVITE = { slug: 'mia-glow-7kq2', publicUrl: 'https://www.hosthampton.com/i/mia-glow-7kq2', state: 'live', renderFresh: true, inviteReadySent: false } as const

/** No invitation yet. */
const summary = (over: Partial<EviteSummary> = {}): EviteSummary => ({ eligible: true, canEnsure: true, noParentEmail: false, evite: null, ...over })

/** An invitation exists. */
const withEvite = (evite: Partial<NonNullable<EviteSummary['evite']>> = {}, over: Partial<EviteSummary> = {}): EviteSummary =>
  summary({ ...over, evite: { ...EVITE, ...evite } })

function render(entry: SummaryEntry | undefined, o: Partial<BookedInvitationViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(BookedInvitationView, { entry, busy: null, message: null, onCreate: () => undefined, onSend: () => undefined, ...o }),
  )
}

describe('no invitation yet', () => {
  it('shows "Create invitation", and no Open / Send / chip', () => {
    const html = render(summary())
    expect(html).toContain('Create invitation')
    expect(html).toContain('data-testid="booked-create-invitation"')
    expect(html).not.toContain('Open invitation')
    expect(html).not.toContain('Send to parent')
    expect(html).not.toContain('booked-invitation-chip')
  })

  it('is disabled while the request is in flight', () => {
    const html = render(summary(), { busy: 'ensure' })
    expect(html).toContain('Creating...')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="booked-create-invitation"/)
  })

  it('says invitations are off, with no button, when they cannot be created', () => {
    const html = render(summary({ canEnsure: false }))
    expect(html).toContain('Invitations are off')
    expect(html).not.toContain('Create invitation')
  })
})

describe('an invitation exists', () => {
  it('shows the chip, Open invitation as a safe new-tab link to /i/<slug>, and Send to parent', () => {
    const html = render(withEvite())
    expect(html).toContain('Live')
    expect(html).toContain('Open invitation')
    expect(html).toMatch(/<a [^>]*href="https:\/\/www\.hosthampton\.com\/i\/mia-glow-7kq2"/)
    expect(html).toMatch(/<a [^>]*target="_blank"/)
    expect(html).toMatch(/<a [^>]*rel="noopener noreferrer"/)
    expect(html).toContain('Send to parent')
    expect(html).not.toContain('Create invitation')
  })

  it.each([
    ['preview', 'Preview'],
    ['needs_time', 'Needs time'],
    ['live', 'Live'],
    ['closed', 'Closed'],
  ] as const)('the %s state reads "%s"', (state, label) => {
    const html = render(withEvite({ state }))
    expect(html).toMatch(new RegExp(`data-testid="booked-invitation-chip">${label}<`))
  })

  it('Send to parent is disabled while a request is in flight', () => {
    const html = render(withEvite(), { busy: 'send_invite_ready' })
    expect(html).toContain('Sending...')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="booked-send-invitation"/)
  })

  it('an already-emailed invitation shows "Emailed to parent" instead of a Send button', () => {
    const html = render(withEvite({ inviteReadySent: true }))
    expect(html).toContain('Emailed to parent')
    expect(html).not.toContain('Send to parent')
    expect(html).toContain('Open invitation')
  })

  it('no parent email: Send is disabled and says why', () => {
    const html = render(withEvite({}, { noParentEmail: true }))
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*data-testid="booked-send-invitation"/)
    expect(html).toContain('No parent email')
  })

  it('a withdrawn invitation shows the chip only: no public link to a page that 404s, no send', () => {
    const html = render(withEvite({ state: 'unavailable', renderFresh: null }))
    expect(html).toContain('Withdrawn')
    expect(html).not.toContain('Open invitation')
    expect(html).not.toContain('Send to parent')
  })

  it('shows the inline result of the last action', () => {
    const ok = render(withEvite(), { message: { ok: true, text: 'Invitation email sent to the parent.' } })
    expect(ok).toContain('Invitation email sent to the parent.')
    expect(ok).toContain('text-green-700')
    const refused = render(withEvite(), { message: { ok: false, text: 'The invitation is not live yet (the booking needs its time and a deposit), so there is nothing to send.' } })
    expect(refused).toContain('not live yet')
    expect(refused).toContain('text-red-700')
  })
})

describe('no button where there can be no invitation', () => {
  it('a studio rental or a cancelled / lost party (not eligible) renders nothing at all', () => {
    expect(render(summary({ eligible: false, canEnsure: false }))).toBe('')
    expect(render(withEvite({}, { eligible: false, canEnsure: false }))).toBe('')
  })

  it('an unknown booking (null) renders nothing', () => {
    expect(render(null)).toBe('')
  })
})

describe('the read states', () => {
  it('a failed read says "Invitation status unavailable", never "Create invitation"', () => {
    const html = render('unavailable')
    expect(html).toContain('Invitation status unavailable')
    expect(html).not.toContain('Create invitation')
    expect(html).not.toContain('Open invitation')
  })

  it('loading shows neither button', () => {
    const html = render(undefined)
    expect(html).toContain('booked-invitation-loading')
    expect(html).not.toContain('Create invitation')
  })
})

describe('wiring (source rules)', () => {
  const comp = readSrc('components', 'admin', 'BookedInvitation.tsx')
  const tab = readSrc('app', 'admin', 'BookedTab.tsx')

  it('the actions are the existing invitation route; send is behind a confirm', () => {
    expect(comp).toMatch(/\/api\/admin\/parties\/\$\{bookingId\}\/invitation/)
    expect(comp).toMatch(/action === 'send_invite_ready' && !window\.confirm\(/)
    const confirmAt = comp.search(/window\.confirm\(/)
    const fetchAt = comp.search(/fetch\(`\/api\/admin\/parties/)
    expect(confirmAt).toBeGreaterThan(-1)
    expect(fetchAt).toBeGreaterThan(confirmAt)
  })

  it('the batch read is ONE request per page of ids, not per row, and runs from the list', () => {
    expect(comp).toMatch(/\/api\/admin\/evites\/summary\?bookingIds=/)
    expect(comp).toMatch(/SUMMARY_BATCH\s*=\s*50/)
    expect(tab).toMatch(/useInvitationSummaries\(/)
    expect(tab).toMatch(/<BookedInvitation\b/)
    // The row component makes no summary request of its own.
    const rowFn = comp.slice(comp.indexOf('export default function BookedInvitation'))
    expect(rowFn).not.toMatch(/evites\/summary/)
  })

  it('clicks on the control do not open the row detail panel', () => {
    expect(comp).toMatch(/onClick=\{\(e\) => e\.stopPropagation\(\)\}/)
  })

  it('a refused request is shown, and a 401 signs the admin out', () => {
    expect(comp).toMatch(/res\.status === 401/)
    expect(comp).toMatch(/failureText\(body, res\.status\)/)
  })
})
