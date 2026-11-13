import {
  dayBeforeEmail,
  finalHeadcountEmail,
  inviteReadyEmail,
  newRsvpEmail,
  partyCancelledEmail,
  rsvpChangedEmail,
  rsvpConfirmedEmail,
  weekBeforeEmail,
  detailsChangedEmail,
  type EviteEmail,
  type EviteMailParty,
} from '@/lib/email-templates/evites'

/** An outside event's emails (migration 096): "Guests", no adults count, the occasion as the noun. */

const SHOWER: EviteMailParty = {
  honoree: 'Maeghan',
  partyNoun: 'Baby Shower',
  title: "Maeghan's Baby Shower",
  dateLine: 'Saturday, January 30 · 12–3 PM',
  placeLine: 'James Joyce · 49 S Ocean Ave, Patchogue, NY 11772',
  fullAddress: 'James Joyce, 49 S Ocean Ave, Patchogue, NY 11772',
  hostContactLine: 'Any questions? Ask Allie · 631-998-9325',
  locationType: 'mobile',
  audience: 'guests',
}
const KIDS: EviteMailParty = { ...SHOWER, audience: 'kids' }
const LINKS = {
  calendar: 'https://www.hosthampton.com/i/maeghan-babyshower-7kq2/cal',
  edit: 'https://www.hosthampton.com/i/maeghan-babyshower-7kq2/rsvp/abc.123.sig',
  stop: 'https://www.hosthampton.com/i/maeghan-babyshower-7kq2/rsvp/abc.123.sig?stop=1',
}
const HOST_URL = 'https://www.hosthampton.com/my-booking/invitation'
const MAGIC = 'https://www.hosthampton.com/api/portal/auth?ref=HH-1&token=t&redirect=%2Fmy-booking%2Finvitation'

const rsvp = (over: Partial<{ childNames: string[]; adultCount: 0 | 1 | 2 }> = {}) => ({
  status: 'yes' as const,
  parentName: 'Jen Guest',
  childNames: ['Jen', 'Mike'],
  adultCount: 0 as const,
  hasAllergy: true,
  allergyNote: 'shellfish',
  ...over,
})

const parentRsvp = (party: EviteMailParty, over = {}) => newRsvpEmail({ party, recipientFirstName: 'Sue', rsvp: rsvp(over), hostUrl: HOST_URL })
const text = (m: EviteEmail) => `${m.subject}\n${m.text}`
const everything = (m: EviteEmail) => `${m.subject}\n${m.text}\n${m.html}`

describe('outside event mail: the host hears who is coming', () => {
  it('new_rsvp says Guests and names them, with no adults row', () => {
    const m = parentRsvp(SHOWER)
    expect(m.text).toContain('Guests: Jen, Mike')
    expect(m.text).not.toMatch(/Kids:|Adults:/)
    expect(m.html).toContain('<strong>Guests</strong>')
    expect(m.html).not.toMatch(/<strong>(Kids|Adults)<\/strong>/)
    expect(m.text).toContain('Allergies: Yes: shellfish')
    expect(m.subject).toBe("New RSVP: Jen Guest is coming to Maeghan's Baby Shower")
  })

  it('rsvp_changed is the same', () => {
    const m = rsvpChangedEmail({ party: SHOWER, recipientFirstName: 'Sue', rsvp: rsvp(), hostUrl: HOST_URL })
    expect(m.text).toContain('Guests: Jen, Mike')
    expect(m.text).not.toMatch(/Kids:|Adults:/)
  })

  it('a kids audience is exactly the kids wording', () => {
    const m = parentRsvp(KIDS, { adultCount: 1 })
    expect(m.text).toContain('Kids: Jen, Mike')
    expect(m.text).toContain('Adults: 1 adult')
  })

  it('names nobody: "no guests listed", never "no children listed"', () => {
    expect(parentRsvp(SHOWER, { childNames: [] }).text).toContain('Guests: no guests listed')
    expect(parentRsvp(KIDS, { childNames: [] }).text).toContain('Kids: no children listed')
  })

  it('carries no planner or invoice button when none is given', () => {
    const m = parentRsvp(SHOWER)
    expect(m.text).not.toMatch(/Party planner|Invoice/)
    expect(m.html).not.toMatch(/Party planner|>Invoice</)
  })

  it('final_headcount counts Guests, with no adults line', () => {
    const m = finalHeadcountEmail({
      party: SHOWER,
      recipientFirstName: 'Sue',
      hostUrl: HOST_URL,
      summary: { kidsYes: 31, adultsYes: 0, adultsPlus: false, noCount: 4, cap: 40, allergies: [{ parent: 'Jen Guest', children: ['Jen'], note: 'shellfish' }], notes: [] },
    })
    expect(m.text).toContain('Guests: 31 of 40 expected')
    expect(m.text).not.toMatch(/Kids:|Adults:/)
    expect(m.text).toContain("Can't come: 4")
    expect(m.html).not.toMatch(/<strong>(Kids|Adults)<\/strong>/)
  })
})

describe('outside event mail: the host and the guests read "event", not "party"', () => {
  it('invite_ready: the invitation is ready, with no "your party is booked" and no class list', () => {
    const m = inviteReadyEmail({ party: SHOWER, recipientFirstName: 'Sue', magicUrl: MAGIC })
    expect(m.subject).toBe("Maeghan's Baby Shower invitation is ready!")
    expect(m.text).toContain("Maeghan's Baby Shower invitation is ready to share!")
    expect(m.text).not.toMatch(/party is booked|class list|kids, adults|your party/i)
    expect(m.text).toContain('who is coming and any allergies')
    expect(m.text).toContain('final headcount just before the event')
    expect(m.html).toContain('you hold the invitation to this event')
    expect(m.html).not.toContain('you booked a party')
  })

  it('invite_ready for a kids audience is unchanged', () => {
    const m = inviteReadyEmail({ party: KIDS, recipientFirstName: 'Sue', magicUrl: MAGIC })
    expect(m.text).toContain('Your party is booked')
    expect(m.text).toContain('the class list')
    expect(m.text).toContain('(kids, adults and any allergies)')
    expect(m.html).toContain('you booked a party with Host Hampton')
  })

  it('every guest email says event in its footer and carries the venue and the date', () => {
    const guest = { party: SHOWER, guest: { parentName: 'Jen Guest', childNames: ['Jen', 'Mike'] }, links: LINKS }
    for (const m of [rsvpConfirmedEmail(guest), weekBeforeEmail(guest), dayBeforeEmail(guest), detailsChangedEmail(guest)]) {
      expect(m.html).toContain("RSVP&rsquo;d to this event")
      expect(m.html).not.toContain('to this party')
      expect(everything(m)).toContain('James Joyce')
      expect(text(m)).not.toMatch(/birthday|speonk|montauk/i)
    }
  })

  it('party_cancelled says the event has been cancelled', () => {
    const m = partyCancelledEmail({ party: SHOWER, guest: { parentName: 'Jen Guest', childNames: ['Jen'] } })
    expect(m.html).toContain('This event has been cancelled')
    expect(m.html).not.toContain('This party has been cancelled')
    expect(m.subject).toBe("Cancelled: Maeghan's Baby Shower on Saturday, January 30")
  })

  it('day_before: the full address and a directions link, and never the studio arrival note', () => {
    const m = dayBeforeEmail({
      party: SHOWER,
      guest: { parentName: 'Jen Guest', childNames: ['Jen'] },
      links: LINKS,
      mapsUrl: 'https://www.google.com/maps/search/?api=1&query=James%20Joyce%2C%2049%20S%20Ocean%20Ave%2C%20Patchogue%2C%20NY%2011772',
    })
    expect(m.text).toContain('Where: James Joyce, 49 S Ocean Ave, Patchogue, NY 11772')
    expect(m.text).toContain('Directions: https://www.google.com/maps/search/')
    expect(m.text).not.toContain('Getting here')
  })
})
