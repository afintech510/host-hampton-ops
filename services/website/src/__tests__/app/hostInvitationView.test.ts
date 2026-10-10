import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HostInvitationView, openInvitationImage, type HostViewProps } from '@/components/evites/HostInvitationView'
import type { HostPayload, HostRsvp } from '@/lib/evites/hostView'
import { formFromCustomize, UPDATING_MESSAGE } from '@/lib/evites/hostUi'
import { readSrc } from '../helpers/sourceScan'

/**
 * The host page drawn from a payload (P07, spec §7.2): the Share panel's disabled states, the
 * state banner, the headcount and the RSVP list. Server-rendered to a string, as the repo's
 * jest is node-only.
 */

const rsvp = (over: Partial<HostRsvp> = {}): HostRsvp => ({
  status: 'yes',
  parent_name: 'Pat Parent',
  children: [{ first_name: 'Ava' }],
  adult_count: 1,
  has_allergy: false,
  allergy_note: null,
  note_to_honoree: null,
  created_at: '2026-10-20T12:00:00Z',
  updated_at: '2026-10-20T12:00:00Z',
  ...over,
})

const payload = (over: Partial<HostPayload> = {}): HostPayload => ({
  state: 'live',
  facts: {
    title: "Mia's Glow Party",
    honoreeName: 'Mia',
    dateLine: 'Saturday, November 14 · 2–4 PM',
    shortDateLine: 'Sat, Nov 14 · 2–4 PM',
    placeLine: 'Host Hampton · 295 Montauk Hwy, Speonk',
    hostContactLine: 'Any questions? Ask Allie',
    hostNote: null,
    giftNote: null,
    rsvpDeadline: null,
    guestCap: 10,
    shareText: "You're invited to Mia's Glow Party on Sat, Nov 14! RSVP here:",
    reshareText: "Still hoping you can make Mia's party on Sat, Nov 14! RSVP here:",
  },
  url: 'https://www.hosthampton.com/i/mia-glow-7kq2',
  images: { invite: 'https://p.supabase.co/storage/v1/object/public/evites/k/invite-v1-ab12.jpg', og: null },
  renderFresh: true,
  rsvps: [],
  summary: { kidsYes: 0, adultsYes: 0, adultsPlus: false, noCount: 0, cap: 10, allergies: [] },
  customize: { host_note: null, gift_note: null, rsvp_deadline: null, show_host_contact: true, host_contact_name: null, host_contact_phone: null },
  deadlineRange: { min: '2026-11-01', max: '2026-11-14' },
  ...over,
})

function view(p: HostPayload, over: Partial<HostViewProps> = {}): string {
  return renderToStaticMarkup(
    createElement(HostInvitationView, {
      data: p,
      preview: createElement('div', { 'data-preview': '1' }),
      form: formFromCustomize(p.customize),
      dirty: false,
      saving: false,
      formError: null,
      saved: false,
      copied: false,
      ...over,
    }),
  )
}

/** The opening tag of the share control named `kind` (a button or the download anchor/span). */
function control(html: string, kind: string): string {
  const m = new RegExp(`<(?:button|a|span)[^>]*data-share="${kind}"[^>]*>`).exec(html)
  if (!m) throw new Error(`no ${kind} control in the markup`)
  return m[0]
}
const disabled = (html: string, kind: string): boolean => /\sdisabled(=|\s|>)/.test(control(html, kind)) || /aria-disabled="true"/.test(control(html, kind))

describe('Share panel disabled states', () => {
  const KINDS = ['text', 'copy', 'download', 'reshare']

  it('live + fresh: every control is enabled, nothing explains', () => {
    const html = view(payload())
    for (const k of KINDS) expect(disabled(html, k)).toBe(false)
    expect(html).not.toContain(UPDATING_MESSAGE)
    // v1.2 finding 8: a BUTTON, never an anchor to the storage host (GA4 records an outbound click, with the URL, for a cross-origin link)
    expect(control(html, 'download')).toMatch(/^<button\b/)
    expect(control(html, 'download')).not.toContain('href=')
    expect(control(html, 'download')).not.toContain('download=')
    expect(html).not.toContain('p.supabase.co')
  })

  it('Download image opens the picture with window.open(url, "_blank", "noopener") and renders no link to a foreign origin', () => {
    const calls: unknown[][] = []
    openInvitationImage('https://p.supabase.co/storage/v1/object/public/evites/k/invite-v1-ab12.jpg', (...a) => calls.push(a))
    expect(calls).toEqual([['https://p.supabase.co/storage/v1/object/public/evites/k/invite-v1-ab12.jpg', '_blank', 'noopener']])
    // and the component wires the button to it (no anchor-with-href={images.invite} left in the source)
    const src = readSrc('components', 'evites', 'HostInvitationView.tsx')
    expect(src).toMatch(/openInvitationImage\(data\.images\.invite/)
    expect(src).not.toMatch(/href=\{data\.images\.invite/)
    const anchors = Array.from(view(payload()).matchAll(/<a\b[^>]*href="([^"]*)"/g)).map((m) => m[1])
    expect(anchors.length).toBeGreaterThan(0)
    for (const href of anchors) expect(href).not.toContain('supabase.co')
  })

  it('live but the picture is stale: all four are disabled and the panel says "Updating your invitation..."', () => {
    const html = view(payload({ renderFresh: false }))
    for (const k of KINDS) expect(disabled(html, k)).toBe(true)
    expect(html).toContain(UPDATING_MESSAGE)
    // a disabled download is not a link to a stale picture
    expect(control(html, 'download')).not.toContain('href=')
  })

  it.each([
    ['preview', /as soon as your party is booked/],
    ['needs_time', /start time is set/],
    ['closed', /nothing left to share/],
  ] as const)('%s: all four are disabled, even with a fresh picture, and the panel says why', (state, why) => {
    const html = view(payload({ state, renderFresh: true }))
    for (const k of KINDS) expect(disabled(html, k)).toBe(true)
    expect(html).toMatch(why)
  })

  it('live and fresh but no image on file: Download is disabled, the rest are not', () => {
    const html = view(payload({ images: { invite: null, og: null } }))
    expect(disabled(html, 'download')).toBe(true)
    expect(disabled(html, 'text')).toBe(false)
  })

  it('the copy-link button reflects a copy', () => {
    expect(view(payload(), { copied: true })).toContain('Link copied!')
    expect(view(payload())).toContain('Copy link')
  })

  it('the public link is a plain anchor (a client-side navigation would skip the GA cleaning of /i/ URLs)', () => {
    const html = view(payload())
    expect(html).toContain('<a href="https://www.hosthampton.com/i/mia-glow-7kq2"')
    const src = readSrc('components', 'evites', 'HostInvitationView.tsx') + readSrc('components', 'evites', 'HostInvitation.tsx')
    expect(src).not.toMatch(/from 'next\/link'/)
    expect(src).not.toMatch(/<Link\b/)
  })
})

describe('State banner', () => {
  it.each([
    ['preview', true, 'Preview'],
    ['needs_time', true, 'Time coming soon'],
    ['live', true, 'Your invitation is live'],
    ['live', false, UPDATING_MESSAGE],
    ['closed', true, 'This party has happened'],
  ] as const)('%s (fresh=%s) says "%s"', (state, fresh, title) => {
    expect(view(payload({ state, renderFresh: fresh }))).toContain(title)
  })
})

describe('RSVP list', () => {
  it('shows the headcount against the cap: "11 of 10 kids", flagged', () => {
    const html = view(payload({ summary: { kidsYes: 11, adultsYes: 5, adultsPlus: true, noCount: 0, cap: 10, allergies: [] } }))
    expect(html).toContain('11 of 10 kids')
    expect(html).toContain('more than the guest count on your booking')
    expect(html).toContain('5+ adults')
  })

  it('under the cap there is no warning', () => {
    const html = view(payload({ summary: { kidsYes: 4, adultsYes: 2, adultsPlus: false, noCount: 0, cap: 10, allergies: [] } }))
    expect(html).toContain('4 of 10 kids')
    expect(html).not.toContain('more than the guest count')
  })

  it('lists each yes answer with kids, adults, allergy and the note to the birthday child', () => {
    const html = view(
      payload({
        rsvps: [rsvp({ parent_name: 'Ann A', children: [{ first_name: 'Ava' }, { first_name: 'Ben' }], adult_count: 2, has_allergy: true, allergy_note: 'peanuts', note_to_honoree: 'Happy birthday Mia!' })],
        summary: { kidsYes: 2, adultsYes: 2, adultsPlus: true, noCount: 0, cap: 10, allergies: [{ parent: 'Ann A', children: ['Ava', 'Ben'], note: 'peanuts' }] },
      }),
    )
    expect(html).toContain('Ann A')
    expect(html).toContain('Ava, Ben')
    expect(html).toContain('2+ adults')
    expect(html).toContain('Allergy: peanuts')
    expect(html).toContain('Food allergies to plan for')
    expect(html).toContain('Note for Mia: Happy birthday Mia!')
  })

  it('"Can’t make it" is its own section, names only', () => {
    const html = view(
      payload({
        rsvps: [rsvp(), rsvp({ status: 'no', parent_name: 'Cat Decline', children: [], adult_count: 0 })],
        summary: { kidsYes: 1, adultsYes: 1, adultsPlus: false, noCount: 1, cap: 10, allergies: [] },
      }),
    )
    expect(html).toMatch(/Can(&#x27;|')t make it \(1\)/)
    const no = html.slice(html.indexOf('data-rsvps="no"'))
    expect(no).toContain('Cat Decline')
    expect(html.slice(0, html.indexOf('data-rsvps="no"'))).not.toContain('Cat Decline')
  })

  it('no answers yet says so, and shows no "Can’t make it" section', () => {
    const html = view(payload())
    expect(html).toContain('No answers yet')
    expect(html).not.toContain('data-rsvps="no"')
  })

  it('guest text is escaped, not interpreted', () => {
    const html = view(payload({ rsvps: [rsvp({ parent_name: '<img src=x onerror=alert(1)>', note_to_honoree: '<script>alert(1)</script>' })] }))
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;img src=x')
  })
})

describe('Customize form', () => {
  it('has the six optional controls, the 140-character limits and the date bounds', () => {
    const html = view(payload())
    expect(html).toContain('id="hi-host-note"')
    expect(html).toContain('id="hi-gift-note"')
    expect(html).toContain('id="hi-deadline"')
    expect(html).toContain('min="2026-11-01"')
    expect(html).toContain('max="2026-11-14"')
    expect(html).toContain('id="hi-contact-name"')
    expect(html).toContain('id="hi-contact-phone"')
    expect(html).toContain('Show it on the invitation')
    expect(html.match(/maxLength="140"|maxlength="140"/gi)?.length).toBe(2)
    expect(html).toMatch(/maxlength="40"/i)
  })

  it('Save is disabled until something changed', () => {
    expect(view(payload())).toMatch(/<button[^>]*type="submit"[^>]*disabled/)
    expect(view(payload(), { dirty: true })).not.toMatch(/<button[^>]*type="submit"[^>]*disabled/)
  })

  it('a refused field shows its message beside the field', () => {
    const html = view(payload(), { dirty: true, formError: { field: 'host_contact_phone', message: 'Please enter a US phone number.' } })
    expect(html).toContain('Please enter a US phone number.')
  })
})

describe('the page names no phone number of its own', () => {
  it('neither view file spells a phone number as a literal', () => {
    for (const f of ['HostInvitationView.tsx', 'HostInvitation.tsx']) {
      expect(readSrc('components', 'evites', f)).not.toMatch(/\b\d{3}[-.)\s]?\s?\d{3}[-.\s]?\d{4}\b/)
    }
  })
})
