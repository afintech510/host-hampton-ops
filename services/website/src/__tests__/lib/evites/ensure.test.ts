import {
  ensureEviteForBooking,
  SLUG_COLLISION_CONSTRAINT,
  BOOKING_COLLISION_CONSTRAINT,
  MAX_SLUG_ATTEMPTS,
} from '@/lib/evites/ensure'
import { isSlugShape } from '@/lib/evites/slug'
import { EVITE_BOOKING_COLUMNS, EVITE_LOOKUP_COLUMNS } from '@/lib/evites/views'

type Result = { data: unknown; error: null | { code?: string; message: string; details?: string } }

/** A scripted fake of the three calls ensure makes. Records everything it is asked. */
function makeFake(script: {
  booking?: Result | (() => Result)
  /** Results for successive evites SELECTs (the existence lookup, then any re-read). */
  lookups?: Result[]
  /** Results for successive evites INSERTs. */
  inserts?: Result[]
  /** `booking_line_items` read. Default: no rows. */
  lineItems?: Result
  /** `party_themes` read. Default: the Glow row. */
  themes?: Result
  /** Results for successive alias checks (`previous_slugs @> {slug}`). Default: no row, i.e. the slug is free. */
  aliases?: Result[]
}) {
  const calls = {
    bookingSelect: [] as string[],
    lookupSelect: [] as string[],
    themeSelect: [] as string[],
    insertedRows: [] as Array<Record<string, unknown>>,
    lookupFilters: [] as Array<[string, unknown]>,
    aliasChecks: [] as unknown[],
  }
  let aliasI = 0
  let lookupI = 0
  let insertI = 0
  const supabase = {
    from(table: string) {
      let mode: 'select' | 'insert' = 'select'
      const b: Record<string, unknown> = {}
      if (table === 'booking_line_items' || table === 'party_themes') {
        // thenable: `await supabase.from(t).select(...)[.eq(...)]` resolves to the scripted result
        const r = table === 'booking_line_items' ? script.lineItems ?? { data: [], error: null } : script.themes ?? { data: [GLOW_THEME], error: null }
        b.select = (cols: string) => {
          calls.themeSelect.push(`${table}: ${cols}`)
          return b
        }
        b.eq = () => b
        b.then = (resolve: (v: Result) => unknown) => resolve(r)
        return b
      }
      b.select = (cols: string) => {
        if (mode === 'select') (table === 'bookings' ? calls.bookingSelect : calls.lookupSelect).push(cols)
        return b
      }
      b.contains = (col: string, val: unknown) => {
        calls.aliasChecks.push([col, val])
        const r = (script.aliases ?? [])[aliasI++] ?? { data: [], error: null }
        b.then = (resolve: (v: Result) => unknown) => resolve(r)
        return b
      }
      b.limit = () => b
      b.insert = (row: Record<string, unknown>) => {
        mode = 'insert'
        calls.insertedRows.push(row)
        return b
      }
      b.eq = (col: string, val: unknown) => {
        calls.lookupFilters.push([col, val])
        return b
      }
      b.maybeSingle = async () => {
        if (table === 'bookings') {
          const r = script.booking
          if (!r) return { data: null, error: null }
          return typeof r === 'function' ? r() : r
        }
        const r = (script.lookups ?? [])[lookupI++]
        return r ?? { data: null, error: null }
      }
      b.single = async () => {
        const r = (script.inserts ?? [])[insertI++]
        return r ?? { data: null, error: { message: 'unscripted insert' } }
      }
      return b
    },
  }
  return { supabase: supabase as never, calls }
}

const GLOW_THEME = { id: 't0000000-0000-4000-8000-000000000001', name: 'Glow Party', slug: 'glow-party', pricing_item_id: null }
const BOOKING_ID = 'b0000000-0000-4000-8000-000000000001'
const EVITE_ID = 'e0000000-0000-4000-8000-000000000001'

const booking = (over: Record<string, unknown> = {}): Result => ({
  data: {
    id: BOOKING_ID,
    booking_ref: 'HH-PTY-AAAAA',
    status: 'awaiting_deposit',
    party_type: 'in_studio_theme',
    package_type: 'Glow Party',
    child_name: 'Mia Rose',
    party_tags: {},
    quote_snapshot: null,
    ...over,
  },
  error: null,
})

const inserted = (slug: string): Result => ({ data: { id: EVITE_ID, booking_id: BOOKING_ID, slug, archived_at: null }, error: null })
const existingRow = (over: Record<string, unknown> = {}): Result => ({
  data: { id: EVITE_ID, booking_id: BOOKING_ID, slug: 'mia-glow-7kq2', archived_at: null, ...over },
  error: null,
})
const slugCollision = (): Result => ({
  data: null,
  error: {
    code: '23505',
    message: `duplicate key value violates unique constraint "${SLUG_COLLISION_CONSTRAINT}"`,
    details: 'Key (slug)=(mia-glow-7kq2) already exists.',
  },
})
const bookingCollision = (): Result => ({
  data: null,
  error: {
    code: '23505',
    message: `duplicate key value violates unique constraint "${BOOKING_COLLISION_CONSTRAINT}"`,
    details: `Key (booking_id)=(${BOOKING_ID}) already exists.`,
  },
})

const KEYS = ['EVITES_PAGES', 'EVITES_PILOT_REFS'] as const
const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const k of KEYS) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
  process.env.EVITES_PAGES = 'on'
  jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  jest.restoreAllMocks()
})

describe('evites/ensure constraint names', () => {
  it('pins the two Postgres constraint names the 23505 handling depends on', () => {
    expect(SLUG_COLLISION_CONSTRAINT).toBe('evites_slug_key')
    expect(BOOKING_COLLISION_CONSTRAINT).toBe('evites_booking_id_key')
    expect(MAX_SLUG_ATTEMPTS).toBe(5)
  })
})

describe('ensureEviteForBooking', () => {
  it('created: inserts booking_id and a slug-shaped slug named for the child', async () => {
    const { supabase, calls } = makeFake({
      booking: booking(),
      lookups: [{ data: null, error: null }],
      inserts: [inserted('mia-glow-7kq2')],
    })
    const out = await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(out).toEqual({ kind: 'created', eviteId: EVITE_ID, slug: 'mia-glow-7kq2' })
    expect(calls.insertedRows).toHaveLength(1)
    expect(calls.insertedRows[0].booking_id).toBe(BOOKING_ID)
    const slug = calls.insertedRows[0].slug as string
    expect(isSlugShape(slug)).toBe(true)
    expect(slug).toMatch(/^mia-glow-/)
  })

  it('names the slug from quote_snapshot.childName when child_name is empty', async () => {
    const { supabase, calls } = makeFake({
      booking: booking({ child_name: null, quote_snapshot: { childName: 'Zoë-Ann Smith' } }),
      inserts: [inserted('zoeann-glow-7kq2')],
    })
    await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(calls.insertedRows[0].slug).toMatch(/^zoeann-glow-/)
  })

  it('falls back to "party" when the booking has no child name', async () => {
    const { supabase, calls } = makeFake({ booking: booking({ child_name: null }), inserts: [inserted('party-glow-7kq2')] })
    await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(calls.insertedRows[0].slug).toMatch(/^party-glow-/)
  })

  it('reads the booking and the existing evite with explicit column lists, never *', async () => {
    const { supabase, calls } = makeFake({ booking: booking(), inserts: [inserted('mia-glow-7kq2')] })
    await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(calls.bookingSelect).toEqual([EVITE_BOOKING_COLUMNS.join(', ')])
    expect(calls.lookupSelect[0]).toBe(EVITE_LOOKUP_COLUMNS.join(', '))
    for (const s of [...calls.bookingSelect, ...calls.lookupSelect]) expect(s).not.toContain('*')
  })

  it('slug collision, then success: mints again and returns created', async () => {
    const { supabase, calls } = makeFake({
      booking: booking(),
      inserts: [slugCollision(), slugCollision(), inserted('mia-glow-9zz9')],
    })
    const out = await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(out).toEqual({ kind: 'created', eviteId: EVITE_ID, slug: 'mia-glow-9zz9' })
    expect(calls.insertedRows).toHaveLength(3)
  })

  it("a minted slug that is another invitation's re-minted alias is taken: mint again, and the insert never carries it", async () => {
    const { supabase, calls } = makeFake({
      booking: booking(),
      aliases: [{ data: [{ id: 'someone-elses' }], error: null }, { data: [{ id: 'someone-elses' }], error: null }, { data: [], error: null }],
      inserts: [inserted('mia-glow-7kq2')],
    })
    const out = await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(out.kind).toBe('created')
    expect(calls.aliasChecks).toHaveLength(3)
    expect(calls.aliasChecks.every((c) => (c as unknown[])[0] === 'previous_slugs' && Array.isArray((c as unknown[])[1]))).toBe(true)
    expect(calls.insertedRows).toHaveLength(1)
    // the slug that was inserted is the one the THIRD check cleared
    expect([(calls.aliasChecks[2] as unknown[])[1]]).toEqual([[calls.insertedRows[0].slug]])
  })

  it('an alias check that cannot be read is unavailable, not "free": nothing is inserted', async () => {
    const { supabase, calls } = makeFake({ booking: booking(), aliases: [{ data: null, error: { message: 'boom' } }] })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('unavailable')
    expect(calls.insertedRows).toHaveLength(0)
  })

  it('every alias hit in a row gives up as unavailable after MAX_SLUG_ATTEMPTS, inserting nothing', async () => {
    const { supabase, calls } = makeFake({
      booking: booking(),
      aliases: Array.from({ length: 8 }, () => ({ data: [{ id: 'x' }], error: null })),
    })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('unavailable')
    expect(calls.aliasChecks).toHaveLength(MAX_SLUG_ATTEMPTS)
    expect(calls.insertedRows).toHaveLength(0)
  })

  it('slug collision five times in a row gives up as unavailable (and never throws)', async () => {
    const { supabase, calls } = makeFake({
      booking: booking(),
      inserts: Array.from({ length: 8 }, slugCollision),
    })
    const out = await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(out.kind).toBe('unavailable')
    expect(calls.insertedRows).toHaveLength(MAX_SLUG_ATTEMPTS)
  })

  it('a slug collision recognised only by the details text is still a slug collision', async () => {
    const { supabase } = makeFake({
      booking: booking(),
      inserts: [
        { data: null, error: { code: '23505', message: 'duplicate key value', details: 'Key (slug)=(x) already exists.' } },
        inserted('mia-glow-7kq2'),
      ],
    })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('created')
  })

  it('booking_id collision: another writer won the race -> exists, with the winner id', async () => {
    const { supabase, calls } = makeFake({
      booking: booking(),
      lookups: [{ data: null, error: null }, existingRow()],
      inserts: [bookingCollision()],
    })
    const out = await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(out).toEqual({ kind: 'exists', eviteId: EVITE_ID, slug: 'mia-glow-7kq2' })
    expect(calls.insertedRows).toHaveLength(1) // did not retry
  })

  it('booking_id collision but the re-read fails -> unavailable, not exists-with-no-id', async () => {
    const { supabase } = makeFake({
      booking: booking(),
      lookups: [{ data: null, error: null }, { data: null, error: { message: 'boom' } }],
      inserts: [bookingCollision()],
    })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('unavailable')
  })

  it('an unknown 23505 (neither constraint) is unavailable, not a blind retry', async () => {
    const { supabase, calls } = makeFake({
      booking: booking(),
      inserts: [
        { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "evites_image_key_key"', details: 'Key (image_key)=(x)' } },
      ],
    })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('unavailable')
    expect(calls.insertedRows).toHaveLength(1)
  })

  it('an archived evite still exists: never re-created, no insert attempted', async () => {
    const { supabase, calls } = makeFake({
      booking: booking(),
      lookups: [existingRow({ archived_at: '2026-10-01T00:00:00Z' })],
    })
    const out = await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(out).toEqual({ kind: 'exists', eviteId: EVITE_ID, slug: 'mia-glow-7kq2' })
    expect(calls.insertedRows).toHaveLength(0)
    // the lookup must not filter archived rows out
    expect(calls.lookupFilters.filter(([c]) => c === 'archived_at')).toHaveLength(0)
  })

  it('an unarchived existing evite is exists too', async () => {
    const { supabase, calls } = makeFake({ booking: booking(), lookups: [existingRow()] })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('exists')
    expect(calls.insertedRows).toHaveLength(0)
  })

  it('insert error -> unavailable', async () => {
    const { supabase } = makeFake({
      booking: booking(),
      inserts: [{ data: null, error: { code: '42P01', message: 'relation "evites" does not exist' } }],
    })
    const out = await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(out.kind).toBe('unavailable')
  })

  it('insert returning neither a row nor an error -> unavailable, never created', async () => {
    const { supabase } = makeFake({ booking: booking(), inserts: [{ data: null, error: null }] })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('unavailable')
  })

  it('booking read error -> unavailable (never ineligible, never created)', async () => {
    const { supabase, calls } = makeFake({ booking: { data: null, error: { message: 'timeout' } } })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('unavailable')
    expect(calls.insertedRows).toHaveLength(0)
  })

  it('existing-evite lookup error -> unavailable, and nothing is inserted', async () => {
    const { supabase, calls } = makeFake({ booking: booking(), lookups: [{ data: null, error: { message: 'timeout' } }] })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('unavailable')
    expect(calls.insertedRows).toHaveLength(0)
  })

  it('a booking that is not there is ineligible', async () => {
    const { supabase } = makeFake({ booking: { data: null, error: null } })
    expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('ineligible')
  })

  describe('eligibility', () => {
    it.each([
      [{ party_type: 'studio_rental' }],
      [{ status: 'cancelled' }],
      [{ status: 'lost' }],
      [{ party_type: null, party_tags: {} }],
    ])('ineligible: %j', async (over) => {
      const { supabase, calls } = makeFake({ booking: booking(over) })
      expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('ineligible')
      expect(calls.insertedRows).toHaveLength(0)
    })

    it('eligible through the location_type fallback', async () => {
      const { supabase } = makeFake({
        booking: booking({ party_type: null, party_tags: { location_type: 'mobile' } }),
        inserts: [inserted('mia-glow-7kq2')],
      })
      expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('created')
    })
  })

  describe('flags', () => {
    it('pages off -> disabled, and nothing is read or written', async () => {
      process.env.EVITES_PAGES = 'off'
      const { supabase, calls } = makeFake({ booking: booking() })
      expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('disabled')
      expect(calls.bookingSelect).toHaveLength(0)
      expect(calls.insertedRows).toHaveLength(0)
    })

    it('pages unset or garbage -> disabled', async () => {
      for (const v of [undefined, 'maybe', 'TRUE']) {
        if (v === undefined) delete process.env.EVITES_PAGES
        else process.env.EVITES_PAGES = v
        const { supabase } = makeFake({ booking: booking() })
        expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('disabled')
      }
    })

    it('pilot: a pilot booking is created', async () => {
      process.env.EVITES_PAGES = 'pilot'
      process.env.EVITES_PILOT_REFS = 'HH-PTY-AAAAA'
      const { supabase } = makeFake({ booking: booking(), inserts: [inserted('mia-glow-7kq2')] })
      expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('created')
    })

    it('pilot: any other booking is disabled and nothing is inserted', async () => {
      process.env.EVITES_PAGES = 'pilot'
      process.env.EVITES_PILOT_REFS = 'HH-PTY-ZZZZZ'
      const { supabase, calls } = makeFake({ booking: booking() })
      expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('disabled')
      expect(calls.insertedRows).toHaveLength(0)
    })

    it('pilot with an empty ref list disables everything', async () => {
      process.env.EVITES_PAGES = 'pilot'
      const { supabase } = makeFake({ booking: booking() })
      expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('disabled')
    })
  })

  describe('never throws', () => {
    it('a throwing booking read -> unavailable', async () => {
      const { supabase } = makeFake({
        booking: () => {
          throw new Error('network down')
        },
      })
      const out = await ensureEviteForBooking(supabase, BOOKING_ID)
      expect(out.kind).toBe('unavailable')
    })

    it('a client that throws on from() -> unavailable', async () => {
      const exploding = {
        from() {
          throw new Error('no client')
        },
      } as never
      await expect(ensureEviteForBooking(exploding, BOOKING_ID)).resolves.toMatchObject({ kind: 'unavailable' })
    })
  })
})

describe('ensureEviteForBooking - the slug names the resolved theme (P03)', () => {
  it('a Glow party is mia-glow-…', async () => {
    const { supabase, calls } = makeFake({ booking: booking(), inserts: [inserted('mia-glow-7kq2')] })
    await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(calls.insertedRows[0].slug).toMatch(/^mia-glow-/)
  })

  it('another catalogue theme names itself in the slug', async () => {
    const { supabase, calls } = makeFake({
      booking: booking({ package_type: 'Swiftie Party' }),
      themes: { data: [GLOW_THEME, { id: 't2', name: 'Swiftie Party', slug: 'swiftie-party', pricing_item_id: null }], error: null },
      inserts: [inserted('mia-swiftie-7kq2')],
    })
    await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(calls.insertedRows[0].slug).toMatch(/^mia-swiftie-/)
  })

  it('no theme evidence at all is mia-birthday-…', async () => {
    const { supabase, calls } = makeFake({
      booking: booking({ package_type: 'Custom Party Theme' }),
      inserts: [inserted('mia-birthday-7kq2')],
    })
    await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(calls.insertedRows[0].slug).toMatch(/^mia-birthday-/)
  })

  it('a theme line item resolves through party_themes.pricing_item_id', async () => {
    const { supabase, calls } = makeFake({
      booking: booking({ package_type: null }),
      lineItems: { data: [{ name: 'K-Pop Demon Hunter Party', category: 'theme', pricing_item_id: 'p-kpop' }], error: null },
      themes: { data: [GLOW_THEME, { id: 't3', name: 'K-Pop Party', slug: 'kpop-party', pricing_item_id: 'p-kpop' }], error: null },
      inserts: [inserted('mia-kpop-7kq2')],
    })
    await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(calls.insertedRows[0].slug).toMatch(/^mia-kpop-/)
  })

  it('a failed line-item or theme read is unavailable and nothing is inserted', async () => {
    for (const script of [
      { lineItems: { data: null, error: { message: 'timeout' } } },
      { themes: { data: null, error: { message: 'timeout' } } },
    ]) {
      const { supabase, calls } = makeFake({ booking: booking(), ...script })
      expect((await ensureEviteForBooking(supabase, BOOKING_ID)).kind).toBe('unavailable')
      expect(calls.insertedRows).toHaveLength(0)
    }
  })

  it('reads both tables with explicit column lists, never *', async () => {
    const { supabase, calls } = makeFake({ booking: booking(), inserts: [inserted('mia-glow-7kq2')] })
    await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(calls.themeSelect).toHaveLength(2)
    for (const s of calls.themeSelect) expect(s).not.toContain('*')
  })

  it('does not read themes at all when the evite already exists', async () => {
    const { supabase, calls } = makeFake({ booking: booking(), lookups: [existingRow()] })
    await ensureEviteForBooking(supabase, BOOKING_ID)
    expect(calls.themeSelect).toHaveLength(0)
  })
})
