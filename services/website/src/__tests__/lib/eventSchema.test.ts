import {
  parseEventTime,
  venueUtcOffset,
  toEventDateTime,
  eventPriceRangeCents,
  buildEventOffers,
  buildEventSchema,
  type EventSchemaInput,
} from '@/lib/eventSchema'

/**
 * The live `events.event_time` column holds SEVEN different free-text shapes,
 * read out of production on 2026-09-12. Three of them carry no meridiem.
 */
const LIVE_TIME_SHAPES = ['10', '10:00 am', '10:00 AM', '6:00', '6:00 PM', '7:00 PM', '9:00 AM']

const base: EventSchemaInput = {
  slug: 'bitchy-bingo-halloween-edition',
  title: 'Bitchy Bingo — Halloween Edition',
  short_description: 'Bingo, but meaner.',
  event_date: '2026-10-09',
  event_time: '7:00 PM',
  price_cents: 2500,
  available_tickets: 29,
}

describe('parseEventTime', () => {
  it.each([
    ['7:00 PM', 19, 0],
    ['7pm', 19, 0],
    ['12:00 AM', 0, 0],
    ['12:00 PM', 12, 0],
    ['10:00 am', 10, 0],
    ['10:00 AM', 10, 0],
    ['09:30AM', 9, 30],
    ['9:00 AM', 9, 0],
    ['19:00', 19, 0],
    ['00:30', 0, 30],
    ['23:59', 23, 59],
  ])('reads %s unambiguously', (raw, hour, minute) => {
    expect(parseEventTime(raw)).toEqual({ hour, minute })
  })

  // The whole point of the module. '6:00' is 6am or 6pm and the row does not
  // say which — guessing would put a four-hour-wrong time in Google's event
  // listing, which sends people to a closed door.
  it.each(['6:00', '10', '1', '12', '11:30', 'noon', '10am-1pm', '', '  ', '25:00', '9:99'])(
    'refuses the ambiguous or unreadable %p',
    raw => {
      expect(parseEventTime(raw)).toBeNull()
    },
  )

  it('refuses null and undefined', () => {
    expect(parseEventTime(null)).toBeNull()
    expect(parseEventTime(undefined)).toBeNull()
  })

  it('never throws on any shape the live table actually holds', () => {
    for (const raw of LIVE_TIME_SHAPES) expect(() => parseEventTime(raw)).not.toThrow()
  })
})

describe('venueUtcOffset', () => {
  it('is -04:00 in October (EDT) and -05:00 in January (EST)', () => {
    expect(venueUtcOffset('2026-10-09')).toBe('-04:00')
    expect(venueUtcOffset('2026-01-09')).toBe('-05:00')
  })

  it('returns null rather than a guess for a nonsense date', () => {
    expect(venueUtcOffset('not-a-date')).toBeNull()
  })
})

describe('toEventDateTime', () => {
  it('produces a valid ISO 8601 instant for an unambiguous time', () => {
    expect(toEventDateTime('2026-10-09', '7:00 PM')).toBe('2026-10-09T19:00:00-04:00')
  })

  // The bug this module exists for: the page used to emit exactly this.
  it('never emits the old "2026-10-09T7:00 PM" shape', () => {
    for (const raw of LIVE_TIME_SHAPES) {
      const out = toEventDateTime('2026-10-09', raw)
      expect(out).not.toMatch(/ (AM|PM|am|pm)/)
      expect(out).not.toContain(' ')
    }
  })

  it('every output parses as a real Date', () => {
    for (const raw of LIVE_TIME_SHAPES) {
      const out = toEventDateTime('2026-10-09', raw)!
      expect(Number.isNaN(new Date(out).getTime())).toBe(false)
    }
  })

  it('degrades to date-only when the time is ambiguous', () => {
    expect(toEventDateTime('2026-10-09', '6:00')).toBe('2026-10-09')
    expect(toEventDateTime('2026-10-09', '10')).toBe('2026-10-09')
    expect(toEventDateTime('2026-10-09', null)).toBe('2026-10-09')
  })

  it('is undefined without a usable date', () => {
    expect(toEventDateTime(null, '7:00 PM')).toBeUndefined()
    expect(toEventDateTime('', '7:00 PM')).toBeUndefined()
    expect(toEventDateTime('October 9th', '7:00 PM')).toBeUndefined()
  })
})

describe('eventPriceRangeCents', () => {
  it('is the base price when there are no variants', () => {
    expect(eventPriceRangeCents(base)).toEqual({ low: 2500, high: 2500 })
  })

  it('spans the variants when there are some', () => {
    const e: EventSchemaInput = {
      ...base,
      price_cents: 4500,
      has_variants: true,
      variants: [
        { label: 'First Child', priceCents: 4500 },
        { label: 'Sibling', priceCents: 3500 },
      ],
    }
    expect(eventPriceRangeCents(e)).toEqual({ low: 3500, high: 4500 })
  })

  it('applies a live sale to every variant, not just the base', () => {
    const e: EventSchemaInput = {
      ...base,
      price_cents: 4500,
      sale_discount_cents: 500,
      sale_ends_at: '2099-01-01T00:00:00Z',
      has_variants: true,
      variants: [
        { label: 'First Child', priceCents: 4500 },
        { label: 'Sibling', priceCents: 3500 },
      ],
    }
    expect(eventPriceRangeCents(e)).toEqual({ low: 3000, high: 4000 })
  })

  it('ignores an expired sale', () => {
    const e: EventSchemaInput = {
      ...base,
      sale_discount_cents: 500,
      sale_ends_at: '2020-01-01T00:00:00Z',
    }
    expect(eventPriceRangeCents(e)).toEqual({ low: 2500, high: 2500 })
  })

  it('is null when there is no price to publish', () => {
    expect(eventPriceRangeCents({ ...base, price_cents: undefined as unknown as number })).toBeNull()
    expect(eventPriceRangeCents({ ...base, price_cents: NaN })).toBeNull()
  })

  it('drops a malformed variant rather than reading it as $0', () => {
    const e: EventSchemaInput = {
      ...base,
      price_cents: 4500,
      has_variants: true,
      variants: [
        { label: 'Good', priceCents: 4500 },
        { label: 'Broken', priceCents: undefined as unknown as number },
      ],
    }
    expect(eventPriceRangeCents(e)).toEqual({ low: 4500, high: 4500 })
  })
})

describe('buildEventOffers', () => {
  it('is a plain Offer for a single price', () => {
    const offers = buildEventOffers(base)!
    expect(offers['@type']).toBe('Offer')
    expect(offers.price).toBe('25.00')
    expect(offers.priceCurrency).toBe('USD')
    expect(offers.availability).toBe('https://schema.org/InStock')
  })

  // The listing page shows "from $35"; the schema used to say $45.
  it('is an AggregateOffer spanning the variants when prices differ', () => {
    const offers = buildEventOffers({
      ...base,
      price_cents: 4500,
      has_variants: true,
      variants: [
        { label: 'First Child', priceCents: 4500 },
        { label: 'Sibling', priceCents: 3500 },
      ],
    })!
    expect(offers['@type']).toBe('AggregateOffer')
    expect(offers.lowPrice).toBe('35.00')
    expect(offers.highPrice).toBe('45.00')
    expect(offers.offerCount).toBe(2)
  })

  it('says SoldOut when there are no tickets left', () => {
    expect(buildEventOffers({ ...base, available_tickets: 0 })!.availability)
      .toBe('https://schema.org/SoldOut')
  })

  it('says InStock when the ticket count is unknown', () => {
    expect(buildEventOffers({ ...base, available_tickets: null })!.availability)
      .toBe('https://schema.org/InStock')
  })

  it('carries priceValidUntil only while a sale is live', () => {
    expect(buildEventOffers(base)!.priceValidUntil).toBeUndefined()
    const onSale = buildEventOffers({
      ...base,
      sale_discount_cents: 500,
      sale_ends_at: '2099-06-01T00:00:00Z',
    })!
    expect(onSale.priceValidUntil).toBe('2099-06-01')
  })

  it('is undefined when the event has no price', () => {
    expect(buildEventOffers({ ...base, price_cents: undefined as unknown as number })).toBeUndefined()
  })
})

describe('buildEventSchema', () => {
  it('carries every property Google requires for an Event', () => {
    const s = buildEventSchema(base)
    expect(s['@type']).toBe('Event')
    expect(s.name).toBe(base.title)
    expect(s.startDate).toBe('2026-10-09T19:00:00-04:00')
    expect(s.location).toBeDefined()
    expect((s.location as Record<string, unknown>)['@type']).toBe('Place')
  })

  it('omits startDate entirely rather than emitting an unparseable one', () => {
    const s = buildEventSchema({ ...base, event_date: null })
    expect(s.startDate).toBeUndefined()
  })

  it('only publishes endDate when it is really after the start', () => {
    expect(buildEventSchema({ ...base, event_end_time: '8:30 PM' }).endDate)
      .toBe('2026-10-09T20:30:00-04:00')
    // '8:00' is ambiguous, so it degrades to the date — which is BEFORE the
    // start instant and would make the event look like it ends before it opens.
    expect(buildEventSchema({ ...base, event_end_time: '8:00' }).endDate).toBeUndefined()
    expect(buildEventSchema({ ...base, event_end_time: '1' }).endDate).toBeUndefined()
    expect(buildEventSchema({ ...base, event_end_time: null }).endDate).toBeUndefined()
  })

  it('has no offers key at all when the event has no price', () => {
    const s = buildEventSchema({ ...base, price_cents: undefined as unknown as number })
    expect('offers' in s).toBe(false)
  })

  it('survives every free-text time the live table holds, with valid output', () => {
    for (const event_time of LIVE_TIME_SHAPES) {
      const s = buildEventSchema({ ...base, event_time })
      const start = s.startDate as string
      // Either a bare date or a full ISO instant — never anything in between.
      expect(start).toMatch(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?$/)
    }
  })

  it('serialises to JSON without losing anything', () => {
    expect(() => JSON.parse(JSON.stringify(buildEventSchema(base)))).not.toThrow()
  })
})
