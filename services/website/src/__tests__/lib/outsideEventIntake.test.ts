const upsertContact = jest.fn(async () => ({}))
const ensureEviteNonFatal = jest.fn(async () => undefined)
const logBookingChange = jest.fn(async () => undefined)

jest.mock('@/lib/contacts', () => ({ upsertContact: (...a: unknown[]) => (upsertContact as (...x: unknown[]) => unknown)(...a) }))
jest.mock('@/lib/evites/ensureNonFatal', () => ({ ensureEviteNonFatal: (...a: unknown[]) => (ensureEviteNonFatal as (...x: unknown[]) => unknown)(...a) }))
jest.mock('@/lib/bookingAudit', () => ({ logBookingChange: (...a: unknown[]) => (logBookingChange as (...x: unknown[]) => unknown)(...a) }))

import { createOutsideEventBooking } from '@/lib/outsideEventIntake'

const GOOD = {
  contactName: 'Allie Larkin',
  contactEmail: 'hosthampton295@gmail.com',
  contactPhone: '631-400-8080',
  partyType: 'outside_event',
  childName: 'Maeghan',
  occasion: 'Baby Shower',
  venueName: 'James Joyce',
  locationAddress: '49 S Ocean Ave, Patchogue, NY 11772',
  partyDate: '2027-01-30',
  partyTime: '12:00',
  eventEndTime: '15:00',
}

/** A fake Supabase: records the bookings insert, answers the evite slug read. */
function fakeSupabase(opts: { insertError?: string; slug?: string | null } = {}) {
  const inserted: Array<Record<string, unknown>> = []
  const supa = {
    from(table: string) {
      if (table === 'bookings') {
        return {
          insert(row: Record<string, unknown>) {
            inserted.push(row)
            return {
              select: () => ({
                single: async () => (opts.insertError ? { data: null, error: { message: opts.insertError } } : { data: { id: 'bk-1' }, error: null }),
              }),
            }
          },
        }
      }
      if (table === 'evites') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: opts.slug === null ? null : { slug: opts.slug ?? 'maeghan-babyshower-7kq2' }, error: null }) }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }
  return { supa: supa as never, inserted }
}

const run = (body: Record<string, unknown> = GOOD, opts = {}) => {
  const f = fakeSupabase(opts)
  return createOutsideEventBooking(f.supa, { body, actor: 'admin:adam@example.com', origin: 'https://www.hosthampton.com' }).then((answer) => ({ answer, inserted: f.inserted }))
}

beforeEach(() => {
  upsertContact.mockClear()
  ensureEviteNonFatal.mockClear()
  logBookingChange.mockClear()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})
afterEach(() => jest.restoreAllMocks())

describe('createOutsideEventBooking', () => {
  it('writes a CONFIRMED booking with nothing owed, the outside_event type and the tags the invitation reads', async () => {
    const { answer, inserted } = await run()
    expect(answer.status).toBe(200)
    expect(inserted).toHaveLength(1)
    const row = inserted[0]
    expect(row).toMatchObject({
      status: 'confirmed',
      party_type: 'outside_event',
      event_type: 'outside-event',
      party_date: '2027-01-30',
      party_time: '12:00',
      child_name: 'Maeghan',
      contact_name: 'Allie Larkin',
      contact_email: 'hosthampton295@gmail.com',
      contact_phone: '631-400-8080',
      deposit_amount: 0,
      total_cents: 0,
      balance_due_cents: 0,
      package_type: null,
      guest_count_approx: null,
      source: 'admin',
    })
    expect(row.modification_cutoff).toBeNull()
    expect(row.guest_count_cutoff).toBeNull()
    expect(row.party_tags).toMatchObject({
      location_type: 'mobile',
      occasion: 'Baby Shower',
      venue_name: 'James Joyce',
      location_address: '49 S Ocean Ave, Patchogue, NY 11772',
      audience: 'guests',
      event_end_time: '15:00',
      created_by: 'admin:adam@example.com',
    })
  })

  it('answers with the invitation page and the admin link, and sends the client nothing', async () => {
    const { answer } = await run()
    expect(answer.body).toMatchObject({
      ok: true,
      bookingId: 'bk-1',
      inviteUrl: 'https://www.hosthampton.com/i/maeghan-babyshower-7kq2',
    })
    expect(String(answer.body.adminUrl)).toMatch(/^https:\/\/www\.hosthampton\.com\/admin\?tab=parties&ref=HH-/)
    expect(String(answer.body.bookingRef)).toMatch(/^HH-/)
    // no quote, no portal link: the only side effects are the audit line, the contact and the invitation
    expect(logBookingChange).toHaveBeenCalledTimes(1)
    expect(upsertContact).toHaveBeenCalledTimes(1)
    expect(upsertContact).toHaveBeenCalledWith(expect.objectContaining({ email: 'hosthampton295@gmail.com', sourceDetail: expect.stringMatching(/Outside-venue invitation/) }))
    expect(ensureEviteNonFatal).toHaveBeenCalledWith(expect.anything(), 'bk-1')
  })

  it('no invitation yet (the flag is off, or it is still being made): inviteUrl is null, the booking still stands', async () => {
    const { answer } = await run(GOOD, { slug: null })
    expect(answer.status).toBe(200)
    expect(answer.body.inviteUrl).toBeNull()
    expect(answer.body.bookingId).toBe('bk-1')
  })

  it('a bad form is a 400 and writes nothing at all', async () => {
    const { answer, inserted } = await run({ ...GOOD, occasion: '' })
    expect(answer.status).toBe(400)
    expect(String(answer.body.error)).toMatch(/what the event is/i)
    expect(inserted).toHaveLength(0)
    expect(upsertContact).not.toHaveBeenCalled()
    expect(ensureEviteNonFatal).not.toHaveBeenCalled()
  })

  it('a failed booking write is a 500 and nothing after it runs: no contact, no invitation for a booking that does not exist', async () => {
    const { answer } = await run(GOOD, { insertError: 'db down' })
    expect(answer.status).toBe(500)
    expect(answer.body).toEqual({ error: 'db down' })
    expect(upsertContact).not.toHaveBeenCalled()
    expect(ensureEviteNonFatal).not.toHaveBeenCalled()
    expect(logBookingChange).not.toHaveBeenCalled()
  })

  it('a kids audience and a guest count are stored', async () => {
    const { inserted } = await run({ ...GOOD, audience: 'kids', guestCount: 40 })
    expect(inserted[0].guest_count_approx).toBe(40)
    expect(inserted[0].party_tags).toMatchObject({ audience: 'kids' })
  })
})
