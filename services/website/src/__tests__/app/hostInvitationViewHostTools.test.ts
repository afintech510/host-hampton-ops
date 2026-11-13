import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { HostInvitationView } from '@/components/evites/HostInvitationView'
import type { HostPayload } from '@/lib/evites/hostView'
import { formFromCustomize } from '@/lib/evites/hostUi'
import { PAGE_COLORS, PAGE_MOTIONS, PAGE_MOTION_LABELS } from '@/lib/evites/pageTheme'

/** The host's Customize form (migration 097): Appearance, the second person to ask, Registry & message. */

const payload = (customize: Partial<HostPayload['customize']> = {}): HostPayload => ({
  state: 'live',
  facts: {
    title: 'Baby Shower',
    honoreeName: null,
    dateLine: 'Saturday, November 21',
    shortDateLine: 'Sat, Nov 21',
    placeLine: 'James Joyce',
    hostContactLine: null,
    hostNote: null,
    giftNote: null,
    rsvpDeadline: null,
    guestCap: 30,
    shareText: 'x',
    reshareText: 'y',
    audience: 'guests',
    partyNoun: 'Baby Shower',
    venueName: 'James Joyce',
  },
  url: 'https://www.hosthampton.com/i/x',
  images: { invite: null, og: null },
  renderFresh: true,
  rsvps: [],
  summary: { kidsYes: 0, adultsYes: 0, adultsPlus: false, noCount: 0, cap: 30, allergies: [] },
  customize: {
    host_note: null, gift_note: null, rsvp_deadline: null, show_host_contact: true, host_contact_name: null, host_contact_phone: null,
    host_contact2_name: null, host_contact2_phone: null, page_color: 'midnight', page_motion: 'none', registry_url: null, registry_note: null,
    ...customize,
  },
  deadlineRange: { min: '2026-11-01', max: '2026-11-21' },
  design: null,
})

const view = (p: HostPayload, error: { field: string | null; message: string } | null = null) =>
  renderToStaticMarkup(
    createElement(HostInvitationView, { data: p, preview: createElement('div'), form: formFromCustomize(p.customize), dirty: false, saving: false, formError: error, saved: false, copied: false }),
  )

describe('Appearance', () => {
  const out = view(payload({ page_color: 'teal', page_motion: 'drift' }))
  it('has a labelled, aria-pressed swatch per palette colour, the stored one pressed', () => {
    for (const c of PAGE_COLORS) {
      expect(out).toContain(`data-page-color="${c.key}"`)
      expect(out).toContain(`aria-label="${c.label}"`)
    }
    expect(out).toMatch(/aria-pressed="true"[^>]*aria-label="Teal"|aria-label="Teal"[^>]*aria-pressed="true"/)
    expect((out.match(/data-page-color="[a-z]+"/g) ?? []).length).toBe(PAGE_COLORS.length)
  })
  it('offers Still / Sparkle / Slow shimmer, the stored one pressed', () => {
    for (const m of PAGE_MOTIONS) expect(out).toContain(`data-page-motion="${m}"`)
    expect(PAGE_MOTION_LABELS).toEqual({ none: 'Still', sparkle: 'Sparkle', drift: 'Slow shimmer' })
    expect(out).toMatch(/aria-pressed="true"[^>]*data-page-motion="drift"|data-page-motion="drift"[^>]*aria-pressed="true"/)
  })
  it('has a live mini-preview in the chosen colour', () => {
    expect(out).toContain('data-section="appearance-preview"')
    expect(out).toContain('background-color:#0b3b3f')
  })
})

describe('second person to ask', () => {
  it('is a labelled optional name + phone pair and shows its own errors', () => {
    const out = view(payload({ host_contact2_name: 'Ciara', host_contact2_phone: '631-875-6580' }), { field: 'host_contact2_phone', message: 'Please add a phone number' })
    expect(out).toContain('Second person to ask (optional)')
    expect(out).toContain('id="hi-contact2-name"')
    expect(out).toContain('value="Ciara"')
    expect(out).toContain('value="631-875-6580"')
    expect(out).toContain('Please add a phone number')
  })
})

describe('registry & message', () => {
  it('has a link field and a 300-character message field, prefilled', () => {
    const out = view(payload({ registry_url: 'https://www.babylist.com/x', registry_note: 'Hello there' }))
    expect(out).toContain('Registry link')
    expect(out).toContain('A message for your guests')
    expect(out).toContain('value="https://www.babylist.com/x"')
    expect(out).toContain('maxLength="300"')
    expect(out).toContain('Hello there')
    expect(out).toContain('11/300')
  })
})
