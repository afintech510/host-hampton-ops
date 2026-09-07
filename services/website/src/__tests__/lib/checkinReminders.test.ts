/**
 * Tests for the check-in reminder scheduler.
 * Covers: the two send times (incl. DST), past-date skipping, the reschedule
 * path clearing old rows first, and suppression on completion.
 */

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

import {
  computeCheckinReminderTimes,
  enqueueCheckinReminders,
  cancelCheckinReminders,
  isCheckinReminderType,
} from '@/lib/checkinReminders'

/**
 * Supabase mock: contacts.single resolves the contact, scheduled_reminders
 * records inserts and update() calls (with the filters applied to them).
 */
function makeSupabase(opts: { contact?: any } = {}) {
  const inserted: any[][] = []
  const updates: { payload: any; filters: Record<string, any> }[] = []

  function chain(table: string): any {
    const c: any = {}
    const filters: Record<string, any> = {}

    ;['select', 'order', 'limit'].forEach(m => (c[m] = jest.fn(() => c)))
    c.eq = jest.fn((k: string, v: any) => { filters[k] = v; return c })
    c.in = jest.fn((k: string, v: any) => { filters[k] = v; return c })

    c.single = jest.fn(() =>
      Promise.resolve({ data: table === 'contacts' ? (opts.contact ?? null) : null, error: null }),
    )

    c.insert = jest.fn((rows: any) => {
      if (table === 'scheduled_reminders') inserted.push(Array.isArray(rows) ? rows : [rows])
      return Promise.resolve({ error: null })
    })

    c.update = jest.fn((payload: any) => {
      const u: any = { payload, filters }
      ;['eq', 'in'].forEach(m => {
        u[m] = jest.fn((k: string, v: any) => { filters[k] = v; return u })
      })
      // Terminal await on the update chain.
      const p = Promise.resolve({ error: null })
      u.then = p.then.bind(p)
      u.catch = p.catch.bind(p)
      if (table === 'scheduled_reminders') updates.push({ payload, filters })
      return u
    })

    return c
  }

  return { supabase: { from: jest.fn((t: string) => chain(t)) } as any, inserted, updates }
}

beforeEach(() => jest.clearAllMocks())

describe('computeCheckinReminderTimes', () => {
  it('schedules 36 hours before the party start, in Eastern', () => {
    // 2026-10-11 2:00 PM EDT = 18:00Z; minus 36h = 2026-10-10T06:00:00Z
    const { at36hr } = computeCheckinReminderTimes('2026-10-11', '2:00 PM')
    expect(at36hr?.toISOString()).toBe('2026-10-10T06:00:00.000Z')
  })

  it('schedules the day-of send at 6:00am Eastern, not 6:00am UTC', () => {
    const { dayOf } = computeCheckinReminderTimes('2026-10-11', '2:00 PM')
    expect(dayOf?.toISOString()).toBe('2026-10-11T10:00:00.000Z') // EDT
  })

  it('uses the right offset for a winter party', () => {
    const { dayOf } = computeCheckinReminderTimes('2026-12-05', '2:00 PM')
    expect(dayOf?.toISOString()).toBe('2026-12-05T11:00:00.000Z') // EST
  })

  it('still schedules the day-of send when party_time is unparseable', () => {
    const { at36hr, dayOf } = computeCheckinReminderTimes('2026-10-11', 'afternoon')
    expect(at36hr).toBeNull()
    expect(dayOf).not.toBeNull()
  })

  it('returns nothing when there is no party date', () => {
    expect(computeCheckinReminderTimes(null, '2:00 PM')).toEqual({ at36hr: null, dayOf: null })
  })
})

describe('enqueueCheckinReminders', () => {
  const base = {
    bookingRef: 'HH-2026-0042',
    contactEmail: 'jane@example.com',
    partyDate: '2026-10-11',
    partyTime: '2:00 PM',
    now: new Date('2026-09-01T00:00:00Z'),
  }

  it('inserts both rows with the correct shape', async () => {
    const { supabase, inserted } = makeSupabase({ contact: { id: 'c-1' } })
    mockGetSupabase.mockReturnValue(supabase)

    await enqueueCheckinReminders(base)

    expect(inserted).toHaveLength(1)
    const rows = inserted[0]
    expect(rows).toHaveLength(2)

    expect(rows[0]).toMatchObject({
      contact_id: 'c-1',
      reminder_type: 'checkin_link_36hr',
      reference_type: 'booking',
      reference_id: 'HH-2026-0042',
      channel: 'sms',
      scheduled_for: '2026-10-10T06:00:00.000Z',
    })
    expect(rows[1]).toMatchObject({
      reminder_type: 'checkin_link_dayof',
      channel: 'sms',
      scheduled_for: '2026-10-11T10:00:00.000Z',
    })
  })

  it('never sets status — the DB default of pending must apply', async () => {
    const { supabase, inserted } = makeSupabase({ contact: { id: 'c-1' } })
    mockGetSupabase.mockReturnValue(supabase)
    await enqueueCheckinReminders(base)
    expect(inserted[0][0]).not.toHaveProperty('status')
  })

  it('cancels existing pending rows first, so a date change does not double-send', async () => {
    const { supabase, updates } = makeSupabase({ contact: { id: 'c-1' } })
    mockGetSupabase.mockReturnValue(supabase)

    await enqueueCheckinReminders(base)

    expect(updates).toHaveLength(1)
    expect(updates[0].payload).toEqual({ status: 'cancelled' })
    expect(updates[0].filters.reference_id).toBe('HH-2026-0042')
  })

  it('skips a send time already in the past', async () => {
    const { supabase, inserted } = makeSupabase({ contact: { id: 'c-1' } })
    mockGetSupabase.mockReturnValue(supabase)

    // Between the 36hr mark and the party itself.
    await enqueueCheckinReminders({ ...base, now: new Date('2026-10-10T12:00:00Z') })

    const rows = inserted[0]
    expect(rows).toHaveLength(1)
    expect(rows[0].reminder_type).toBe('checkin_link_dayof')
  })

  it('inserts nothing when the whole party is in the past', async () => {
    const { supabase, inserted } = makeSupabase({ contact: { id: 'c-1' } })
    mockGetSupabase.mockReturnValue(supabase)

    await enqueueCheckinReminders({ ...base, now: new Date('2026-11-01T00:00:00Z') })
    expect(inserted).toHaveLength(0)
  })

  it('does nothing when there is no contact for the email', async () => {
    const { supabase, inserted } = makeSupabase({ contact: null })
    mockGetSupabase.mockReturnValue(supabase)

    await enqueueCheckinReminders(base)
    expect(inserted).toHaveLength(0)
  })

  it('never throws — a scheduling failure must not break a booking', async () => {
    mockGetSupabase.mockImplementation(() => { throw new Error('db down') })
    await expect(enqueueCheckinReminders(base)).resolves.toBeUndefined()
  })
})

describe('cancelCheckinReminders', () => {
  it('cancels only pending check-in rows for that booking', async () => {
    const { supabase, updates } = makeSupabase()
    mockGetSupabase.mockReturnValue(supabase)

    await cancelCheckinReminders('HH-2026-0042')

    expect(updates).toHaveLength(1)
    expect(updates[0].payload).toEqual({ status: 'cancelled' })
    expect(updates[0].filters).toMatchObject({
      reference_type: 'booking',
      reference_id: 'HH-2026-0042',
      status: 'pending',
      reminder_type: ['checkin_link_36hr', 'checkin_link_dayof'],
    })
  })

  it('never throws', async () => {
    mockGetSupabase.mockImplementation(() => { throw new Error('db down') })
    await expect(cancelCheckinReminders('HH-1')).resolves.toBeUndefined()
  })
})

describe('isCheckinReminderType', () => {
  it('matches both check-in types and nothing else', () => {
    expect(isCheckinReminderType('checkin_link_36hr')).toBe(true)
    expect(isCheckinReminderType('checkin_link_dayof')).toBe(true)
    expect(isCheckinReminderType('booking_sms_1day')).toBe(false)
  })
})
