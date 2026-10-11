import {
  dayBeforeEmail,
  detailsChangedEmail,
  finalHeadcountEmail,
  inviteReadyEmail,
  leadPreviewEmail,
  newRsvpEmail,
  partyCancelledEmail,
  rsvpChangedEmail,
  rsvpConfirmedEmail,
  weekBeforeEmail,
  type EviteEmail,
  type EviteMailParty,
} from '@/lib/email-templates/evites'
import { generateUnsubscribeToken } from '@/lib/unsubscribeLink'
import { STUDIO_ARRIVAL_NOTE, STUDIO_ARRIVAL_NOTE_READY, STUDIO_MAPS_URL } from '@/lib/studioLocation'

/** The ten evite bodies (spec §9.1): escaping, explicit dates, the Allie signature, the copy rules. */

const PARTY: EviteMailParty = {
  honoree: 'Mia',
  partyNoun: 'Glow Party',
  title: "Mia's Glow Party",
  dateLine: 'Saturday, November 14 · 2–4 PM',
  placeLine: 'Host Hampton · 295 Montauk Hwy, Speonk',
  fullAddress: 'Host Hampton, 295 Montauk Hwy, Speonk, NY 11972',
  hostContactLine: 'Any questions? Ask Allie · 631-998-9325',
  locationType: 'studio',
}
const NO_NAME: EviteMailParty = { ...PARTY, honoree: null, title: 'Glow Birthday Party' }
const LINKS = {
  calendar: 'https://www.hosthampton.com/i/mia-glow-7kq2/cal',
  edit: 'https://www.hosthampton.com/i/mia-glow-7kq2/rsvp/abc.123.sig',
  stop: 'https://www.hosthampton.com/i/mia-glow-7kq2/rsvp/abc.123.sig?stop=1',
}
const GUEST = { parentName: 'Gina Guest', childNames: ['Ava', 'Ben'] }
const HOST_URL = 'https://www.hosthampton.com/my-booking/invitation'
const IMAGE = 'https://proj.supabase.co/storage/v1/object/public/evites/0123456789abcdef0123456789abcdef/invite-v1-9f2c.jpg'

const HOSTILE = `<script>alert(1)</script> "quoted" & O'Brien`
const HOSTILE_PARTY: EviteMailParty = { ...PARTY, honoree: HOSTILE, title: HOSTILE, placeLine: HOSTILE, fullAddress: HOSTILE, hostContactLine: HOSTILE, partyNoun: HOSTILE }

let savedSecret: string | undefined
beforeEach(() => {
  savedSecret = process.env.PORTAL_LINK_SIGNING_SECRET
  process.env.PORTAL_LINK_SIGNING_SECRET = 'test-signing-secret-0123456789abcdef'
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})
afterEach(() => {
  if (savedSecret === undefined) delete process.env.PORTAL_LINK_SIGNING_SECRET
  else process.env.PORTAL_LINK_SIGNING_SECRET = savedSecret
  jest.restoreAllMocks()
})

const token = () => generateUnsubscribeToken('pat@example.com') as string

function all(party: EviteMailParty = PARTY): Record<string, EviteEmail> {
  const parentRsvp = {
    party,
    recipientFirstName: 'Pat',
    rsvp: { status: 'yes' as const, parentName: GUEST.parentName, childNames: GUEST.childNames, adultCount: 1 as const, hasAllergy: true, allergyNote: 'peanuts' },
    hostUrl: HOST_URL,
  }
  const guest = { party, guest: GUEST, links: LINKS }
  return {
    lead_preview: leadPreviewEmail({ party, recipientFirstName: 'Pat', imageUrl: IMAGE, inviteUrl: 'https://www.hosthampton.com/i/mia-glow-7kq2', reserveUrl: 'https://www.hosthampton.com/api/portal/auth?ref=HH-1&token=t&redirect=%2Fparty-planner', unsubscribeToken: token() }),
    invite_ready: inviteReadyEmail({ party, recipientFirstName: 'Pat', magicUrl: 'https://www.hosthampton.com/api/portal/auth?ref=HH-1&token=t&redirect=%2Fmy-booking%2Finvitation' }),
    new_rsvp: newRsvpEmail(parentRsvp),
    rsvp_changed: rsvpChangedEmail(parentRsvp),
    rsvp_confirmed: rsvpConfirmedEmail(guest),
    week_before: weekBeforeEmail(guest),
    day_before: dayBeforeEmail({ ...guest, mapsUrl: STUDIO_MAPS_URL }),
    details_changed: detailsChangedEmail(guest),
    final_headcount: finalHeadcountEmail({
      party,
      recipientFirstName: 'Pat',
      hostUrl: HOST_URL,
      summary: { kidsYes: 7, adultsYes: 5, adultsPlus: true, noCount: 2, cap: 10, allergies: [{ parent: GUEST.parentName, children: ['Ava'], note: 'peanuts' }], notes: [{ parent: GUEST.parentName, note: 'Happy birthday!' }] },
    }),
    party_cancelled: partyCancelledEmail({ party, guest: GUEST }),
  }
}

describe('every template returns a subject, an HTML body and a plain-text body', () => {
  it('all ten, non-empty', () => {
    const emails = all()
    expect(Object.keys(emails)).toHaveLength(10)
    for (const [name, e] of Object.entries(emails)) {
      expect(e.subject.trim().length).toBeGreaterThan(5)
      expect(e.html).toContain('<html')
      expect(e.text.trim().length).toBeGreaterThan(40)
      expect(`${name}: ${e.subject}`).not.toMatch(/[\r\n]/)
    }
  })
})

describe('hostile fields are escaped in the HTML and left alone in the text', () => {
  const emails = all(HOSTILE_PARTY)

  it('no tag survives into any HTML body', () => {
    for (const [name, e] of Object.entries(emails)) {
      expect(`${name}: ${e.html}`).not.toContain('<script>')
      expect(`${name}: ${e.html}`).not.toContain('alert(1)</script>')
    }
  })

  it('the HTML carries the escaped form (quotes and ampersands as entities)', () => {
    for (const name of ['invite_ready', 'rsvp_confirmed', 'week_before', 'day_before', 'details_changed', 'party_cancelled', 'final_headcount']) {
      expect(`${name}: ${emails[name].html}`).toContain('&lt;script&gt;')
      expect(`${name}: ${emails[name].html}`).toContain('&quot;quoted&quot;')
    }
  })

  it('the plain-text half is NEVER escaped', () => {
    for (const name of ['invite_ready', 'rsvp_confirmed', 'week_before', 'day_before', 'details_changed', 'party_cancelled', 'final_headcount']) {
      const t = emails[name].text
      expect(`${name}: ${t}`).not.toMatch(/&lt;|&gt;|&quot;|&amp;|&#39;/)
      expect(t).toContain('"quoted" & O\'Brien')
    }
  })

  it('a guest-supplied name, child name, allergy note and message are escaped in the parent emails too', () => {
    const party = PARTY
    const rsvp = { status: 'yes' as const, parentName: HOSTILE, childNames: [HOSTILE], adultCount: 2 as const, hasAllergy: true, allergyNote: HOSTILE }
    const created = newRsvpEmail({ party, recipientFirstName: HOSTILE, rsvp, hostUrl: HOST_URL })
    const changed = rsvpChangedEmail({ party, recipientFirstName: HOSTILE, rsvp, hostUrl: HOST_URL })
    for (const e of [created, changed]) {
      expect(e.html).not.toContain('<script>')
      expect(e.html).toContain('&lt;script&gt;')
      expect(e.text).toContain('<script>alert(1)</script>')
    }
    const head = finalHeadcountEmail({
      party,
      recipientFirstName: 'Pat',
      hostUrl: HOST_URL,
      summary: { kidsYes: 1, adultsYes: 1, adultsPlus: false, noCount: 0, cap: null, allergies: [{ parent: HOSTILE, children: [HOSTILE], note: HOSTILE }], notes: [{ parent: HOSTILE, note: HOSTILE }] },
    })
    expect(head.html).not.toContain('<script>')
    expect(head.text).toContain('<script>alert(1)</script>')
  })

  it('a newline typed into a name cannot become a second header in a subject', () => {
    const e = newRsvpEmail({
      party: { ...PARTY, honoree: 'Mia\r\nBcc: evil@example.com' },
      recipientFirstName: 'Pat',
      rsvp: { status: 'no', parentName: 'Gina\nBcc: evil@example.com', childNames: [], adultCount: 0, hasAllergy: null, allergyNote: null },
      hostUrl: HOST_URL,
    })
    expect(e.subject).not.toMatch(/[\r\n]/)
  })
})

describe('URLs go through a URL screen, not an escaper', () => {
  it('a hostile link is not rendered as a link at all', () => {
    const e = weekBeforeEmail({ party: PARTY, guest: GUEST, links: { calendar: 'javascript:alert(1)', edit: 'https://evil.example/steal', stop: '//evil.example' } })
    expect(e.html).not.toContain('javascript:')
    expect(e.html).not.toContain('evil.example')
    expect(e.html).not.toMatch(/href="[^"]*"[^>]*>Add to calendar/)
    expect(e.html).toContain('Update your RSVP')
  })

  it('the real links are real anchors', () => {
    const e = weekBeforeEmail({ party: PARTY, guest: GUEST, links: LINKS })
    expect(e.html).toContain('href="https://www.hosthampton.com/i/mia-glow-7kq2/cal"')
    expect(e.html).toContain('href="https://www.hosthampton.com/i/mia-glow-7kq2/rsvp/abc.123.sig"')
    expect(e.html).toContain('href="https://www.hosthampton.com/i/mia-glow-7kq2/rsvp/abc.123.sig?stop=1"')
  })

  it('a stored image from outside our origin must be https, and javascript: is refused', () => {
    const e = leadPreviewEmail({ party: PARTY, recipientFirstName: 'Pat', imageUrl: 'javascript:alert(1)', inviteUrl: 'https://www.hosthampton.com/i/mia-glow-7kq2', reserveUrl: null, unsubscribeToken: token() })
    expect(e.html).not.toContain('javascript:')
    expect(e.html).not.toContain('<img')
  })
})

describe('the copy rules', () => {
  const emails = all()

  it('signed Allie & the Host Hampton team, and never Adam', () => {
    for (const [name, e] of Object.entries(emails)) {
      expect(`${name}: ${e.text}`).toContain('Allie & the Host Hampton team')
      expect(`${name}: ${e.html}`).toContain('Allie &amp; the Host Hampton team')
      expect(`${name}: ${e.subject} ${e.html} ${e.text}`).not.toMatch(/\bAdam\b/)
    }
  })

  it('never says tomorrow or today: the date is written out', () => {
    for (const [name, e] of Object.entries(emails)) {
      expect(`${name}: ${e.subject} ${e.html} ${e.text}`).not.toMatch(/\b(tomorrow|today)\b/i)
    }
    for (const name of ['week_before', 'day_before', 'details_changed', 'final_headcount', 'party_cancelled']) {
      expect(`${name}: ${emails[name].subject}`).toContain('Saturday, November 14')
      expect(`${name}: ${emails[name].text}`).toContain('Saturday, November 14')
      expect(`${name}: ${emails[name].html}`).toContain('Saturday, November 14')
    }
  })

  it('guest reminders carry D16/D17: details, add to calendar, update my RSVP, stop reminders, the contact line', () => {
    for (const name of ['rsvp_confirmed', 'week_before', 'day_before', 'details_changed']) {
      const e = emails[name]
      expect(`${name}: ${e.text}`).toContain(LINKS.calendar)
      expect(`${name}: ${e.text}`).toContain(`Plans changed? Update your RSVP: ${LINKS.edit}`)
      expect(`${name}: ${e.text}`).toContain(`Stop reminders: ${LINKS.stop}`)
      expect(`${name}: ${e.text}`).toContain('Any questions? Ask Allie')
      expect(`${name}: ${e.html}`).toContain('Plans changed?')
      expect(`${name}: ${e.html}`).toContain('Stop reminders')
      expect(`${name}: ${e.html}`).toContain('Add to calendar')
      expect(`${name}: ${e.text}`).toContain('2–4 PM')
    }
  })

  it('details_changed tells the guest to replace the old event', () => {
    expect(emails.details_changed.text).toMatch(/replace/i)
    expect(emails.details_changed.html).toMatch(/replace/i)
  })

  it('party_cancelled is a notice with no RSVP links', () => {
    const e = emails.party_cancelled
    expect(e.subject).toMatch(/^Cancelled:/)
    expect(e.text).toMatch(/has been cancelled/)
    expect(e.text).not.toContain('Update your RSVP')
  })

  it('the parent emails say who answered, how many kids and adults, and the allergy note, and link to the host page', () => {
    for (const name of ['new_rsvp', 'rsvp_changed']) {
      const e = emails[name]
      expect(e.text).toContain('Gina Guest')
      expect(e.text).toContain('Ava, Ben')
      expect(e.text).toContain('1 adult')
      expect(e.text).toContain('Allergies: Yes: peanuts')
      expect(e.text).toContain(HOST_URL)
    }
    expect(emails.new_rsvp.subject).toMatch(/^New RSVP:/)
    expect(emails.rsvp_changed.subject).toMatch(/^RSVP updated:/)
  })

  it('a "no" answer lists no kids and no allergies', () => {
    const e = newRsvpEmail({ party: PARTY, recipientFirstName: 'Pat', rsvp: { status: 'no', parentName: 'Gina', childNames: [], adultCount: 0, hasAllergy: null, allergyNote: null }, hostUrl: HOST_URL })
    expect(e.text).toContain("Can't make it")
    expect(e.text).not.toContain('Kids:')
    expect(e.subject).toContain("can't make it")
  })

  it('final_headcount: totals, the cap, the allergy roll-up, the guest notes', () => {
    const e = emails.final_headcount
    expect(e.text).toContain('Kids: 7 of 10 expected')
    expect(e.text).toContain('Adults: 5+')
    expect(e.text).toContain("Can't come: 2")
    expect(e.text).toContain('Gina Guest (Ava): peanuts')
    expect(e.text).toContain('Happy birthday!')
  })

  it('final_headcount with no allergies says so', () => {
    const e = finalHeadcountEmail({ party: PARTY, recipientFirstName: null, hostUrl: HOST_URL, summary: { kidsYes: 3, adultsYes: 2, adultsPlus: false, noCount: 0, cap: null, allergies: [], notes: [] } })
    expect(e.text).toContain('None listed')
    expect(e.text.startsWith('Hi there,')).toBe(true)
  })
})

describe('lead_preview', () => {
  const base = { recipientFirstName: 'Pat', imageUrl: IMAGE, inviteUrl: 'https://www.hosthampton.com/i/mia-glow-7kq2' }
  const RESERVE = 'https://www.hosthampton.com/api/portal/auth?ref=HH-1&token=t&redirect=%2Fparty-planner'

  it('subject with a name and without', () => {
    expect(leadPreviewEmail({ ...base, party: PARTY, reserveUrl: RESERVE, unsubscribeToken: token() }).subject).toBe("Here's Mia's Glow Party invitation ✨")
    expect(leadPreviewEmail({ ...base, party: NO_NAME, reserveUrl: RESERVE, unsubscribeToken: token() }).subject).toBe("Here's your Glow Party invitation ✨")
  })

  it('image, "See the invitation" and "Reserve your date" when the mint worked', () => {
    const e = leadPreviewEmail({ ...base, party: PARTY, reserveUrl: RESERVE, unsubscribeToken: token() })
    expect(e.html).toContain(`<img src="${IMAGE}"`)
    expect(e.html).toContain('See the invitation')
    expect(e.html).toContain('Reserve your date')
    expect(e.text).toContain('See the invitation: https://www.hosthampton.com/i/mia-glow-7kq2')
    expect(e.text).toContain('Reserve your date:')
  })

  it('the Reserve button is OMITTED, in both halves, when the mint failed', () => {
    const e = leadPreviewEmail({ ...base, party: PARTY, reserveUrl: null, unsubscribeToken: token() })
    expect(e.html).toContain('See the invitation')
    expect(e.html).not.toContain('Reserve your date')
    expect(e.text).not.toContain('Reserve your date')
  })

  it('the footer has the physical address, the signed unsubscribe link, and the List-Unsubscribe headers come back', () => {
    const t = token()
    const e = leadPreviewEmail({ ...base, party: PARTY, reserveUrl: RESERVE, unsubscribeToken: t })
    expect(e.html).toContain('295 Montauk Hwy')
    expect(e.html).toContain('Speonk, NY 11972')
    expect(e.html).toContain(`href="https://www.hosthampton.com/unsubscribe?t=${encodeURIComponent(t)}"`)
    expect(e.text).toContain(`Unsubscribe: https://www.hosthampton.com/unsubscribe?t=${encodeURIComponent(t)}`)
    expect(e.headers?.['List-Unsubscribe']).toContain('/api/unsubscribe?t=')
    expect(e.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })

  it('no other template carries List-Unsubscribe headers', () => {
    for (const [name, e] of Object.entries(all())) {
      if (name !== 'lead_preview') expect(`${name}: ${e.headers ? 'headers' : 'none'}`).toBe(`${name}: none`)
    }
  })
})

describe('invite_ready', () => {
  it('subject, and the magic link button', () => {
    const e = all().invite_ready
    expect(e.subject).toBe("Mia's Glow Party invitation is ready!")
    expect(e.html).toContain('Open my invitation')
    expect(e.text).toContain('Open my invitation: https://www.hosthampton.com/api/portal/auth')
    expect(all(NO_NAME).invite_ready.subject).toBe('Your Glow Party invitation is ready!')
  })

  it('REFUSES to render with a link that did not survive its screen (a dead link is never mailed)', () => {
    for (const bad of ['', 'javascript:alert(1)', 'https://evil.example/login']) {
      expect(() => inviteReadyEmail({ party: PARTY, recipientFirstName: 'Pat', magicUrl: bad })).toThrow(/did not survive/)
    }
  })
})

describe('day_before: the arrival note', () => {
  const input = { party: PARTY, guest: GUEST, links: LINKS, mapsUrl: STUDIO_MAPS_URL }

  it('the worded note (Adam, 2026-10-11) is in the default day-before email, and no TODO ever is', () => {
    expect(STUDIO_ARRIVAL_NOTE_READY).toBe(true)
    expect(STUDIO_ARRIVAL_NOTE).toContain('Free parking right out front at 295 Montauk Hwy')
    const e = dayBeforeEmail(input)
    for (const part of [e.html, e.text, e.subject]) expect(part).not.toMatch(/TODO/)
    expect(e.text).toContain(`Getting here: ${STUDIO_ARRIVAL_NOTE}`)
  })

  it('a placeholder passed in explicitly is refused too', () => {
    const e = dayBeforeEmail({ ...input, arrivalNote: 'TODO(Adam): park somewhere' })
    expect(e.html).not.toMatch(/TODO/)
    expect(e.text).not.toMatch(/TODO/)
  })

  it('once worded, the note appears for the studio (escaped in HTML, plain in text) and never for a mobile party', () => {
    const e = dayBeforeEmail({ ...input, arrivalNote: 'Park behind the building & use the blue door.' })
    expect(e.text).toContain('Getting here: Park behind the building & use the blue door.')
    expect(e.html).toContain('Park behind the building &amp; use the blue door.')
    const mobile = dayBeforeEmail({ ...input, party: { ...PARTY, locationType: 'mobile', fullAddress: '12 Dune Rd, Westhampton, NY' }, arrivalNote: 'Park behind the building.' })
    expect(mobile.text).not.toContain('Getting here')
    expect(mobile.text).toContain('Where: 12 Dune Rd, Westhampton, NY')
  })

  it('carries the full address and a directions link for the studio', () => {
    const e = dayBeforeEmail(input)
    expect(e.text).toContain('Where: Host Hampton, 295 Montauk Hwy, Speonk, NY 11972')
    expect(e.text).toContain('Directions:')
    expect(e.html).toContain('Get directions')
  })
})
