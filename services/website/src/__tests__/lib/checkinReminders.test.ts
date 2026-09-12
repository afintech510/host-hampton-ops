/**
 * Tests for the check-in reminder scheduler.
 * Covers: the two send times (incl. DST), past-date skipping, the reschedule
 * path clearing old rows first, and suppression on completion.
 *
 * The scheduling half was rebuilt 2026-09-12 on `helpers/fakeReminderDb`. The
 * mock it used before accepted any insert, which is why nobody noticed that
 * `reference_id` was a `uuid` column and this module writes a booking_ref into
 * it: every insert here had been answered 22P02 since the feature shipped, and
 * `checkin_tokens` held zero rows in production as a result. The store now
 * carries the real column types, so a regression would fail rather than pass.
 */

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: () => mockGetSupabase() }))

import {
  computeCheckinReminderTimes,
  enqueueCheckinReminders,
  cancelCheckinReminders,
  isCheckinReminderType,
} from '@/lib/checkinReminders'
import {
  makeFakeDb,
  scheduledRemindersSpec,
  type TableSpec,
} from '../helpers/fakeReminderDb'

const CONTACT_ID = '11111111-1111-4111-8111-111111111111'

const contactsSpec: TableSpec = {
  columns: { id: 'uuid', email: 'text', created_at: 'timestamptz' },
}

function setup(opts: { contactEmail?: string | null; legacy?: boolean } = {}) {
  const fake = makeFakeDb(
    {
      scheduled_reminders: scheduledRemindersSpec({ legacyUuidReferenceId: opts.legacy }),
      contacts: contactsSpec,
    },
    {
      contacts:
        opts.contactEmail === null
          ? []
          : [{ id: CONTACT_ID, email: opts.contactEmail ?? 'jane@example.com', created_at: '2026-01-01T00:00:00.000Z' }],
    }
  )
  mockGetSupabase.mockReturnValue(fake.supabase)
  return fake
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
    const fake = setup()

    await enqueueCheckinReminders(base)

    const rows = [...fake.tables.scheduled_reminders].sort((a, b) =>
      String(a.scheduled_for).localeCompare(String(b.scheduled_for))
    )
    expect(rows).toHaveLength(2)

    expect(rows[0]).toMatchObject({
      contact_id: CONTACT_ID,
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
    expect(fake.refusals).toHaveLength(0)
  })

  it('THE DEFECT, PINNED: the pre-044 uuid column refused both rows', async () => {
    const fake = setup({ legacy: true })

    await enqueueCheckinReminders(base)

    expect(fake.tables.scheduled_reminders).toHaveLength(0)
    // Both rows are attempted and both are refused — the per-row enqueue reports
    // each one. The old bulk insert lost the whole batch to the first failure
    // and then threw the error away, which is how this went unseen.
    expect(fake.refusals).toHaveLength(2)
    expect(fake.refusals.every(r => r.error.code === '22P02')).toBe(true)
  })

  it('never sets status — the DB default of pending must apply', async () => {
    const fake = setup()
    await enqueueCheckinReminders(base)
    expect(fake.tables.scheduled_reminders.every(r => r.status === 'pending')).toBe(true)
  })

  it('cancels existing pending rows first, so a date change does not double-send', async () => {
    const fake = setup()

    await enqueueCheckinReminders(base)
    // Reschedule to a different party date.
    await enqueueCheckinReminders({ ...base, partyDate: '2026-10-18' })

    const rows = fake.tables.scheduled_reminders
    const pending = rows.filter(r => r.status === 'pending')
    const cancelled = rows.filter(r => r.status === 'cancelled')

    expect(cancelled).toHaveLength(2)
    expect(pending).toHaveLength(2)
    // The surviving pending rows are the NEW schedule, and the unique index did
    // not stand in the way of the reschedule.
    expect(pending.map(r => r.scheduled_for).sort()).toEqual([
      '2026-10-17T06:00:00.000Z',
      '2026-10-18T10:00:00.000Z',
    ])
  })

  it('skips a send time already in the past', async () => {
    const fake = setup()

    // Between the 36hr mark and the party itself.
    await enqueueCheckinReminders({ ...base, now: new Date('2026-10-10T12:00:00Z') })

    const rows = fake.tables.scheduled_reminders
    expect(rows).toHaveLength(1)
    expect(rows[0].reminder_type).toBe('checkin_link_dayof')
  })

  it('inserts nothing when the whole party is in the past', async () => {
    const fake = setup()
    await enqueueCheckinReminders({ ...base, now: new Date('2026-11-01T00:00:00Z') })
    expect(fake.tables.scheduled_reminders).toHaveLength(0)
  })

  it('finds a contact whose stored address is MIXED CASE', async () => {
    const fake = setup({ contactEmail: 'Jane@Example.com' })
    await enqueueCheckinReminders(base)
    expect(fake.tables.scheduled_reminders).toHaveLength(2)
  })

  it('does nothing when there is no contact for the email', async () => {
    const fake = setup({ contactEmail: null })
    await enqueueCheckinReminders(base)
    expect(fake.tables.scheduled_reminders).toHaveLength(0)
  })

  it('leaves an EXISTING schedule alone when the contacts read fails (rule 12)', async () => {
    const fake = setup()
    await enqueueCheckinReminders(base)
    const before = fake.tables.scheduled_reminders.map(r => ({ ...r }))

    fake.failReads('contacts')
    await enqueueCheckinReminders({ ...base, partyDate: '2026-10-18' })

    // Nothing cancelled, nothing added — a blip must not silently disarm the
    // customer's pre-arrival texts.
    expect(fake.tables.scheduled_reminders).toHaveLength(before.length)
    expect(fake.tables.scheduled_reminders.every(r => r.status === 'pending')).toBe(true)
  })

  it('never throws — a scheduling failure must not break a booking', async () => {
    mockGetSupabase.mockImplementation(() => { throw new Error('db down') })
    await expect(enqueueCheckinReminders(base)).resolves.toBeUndefined()
  })
})

describe('cancelCheckinReminders', () => {
  it('cancels only pending check-in rows for that booking', async () => {
    const fake = setup()
    await enqueueCheckinReminders({
      bookingRef: 'HH-2026-0042',
      contactEmail: 'jane@example.com',
      partyDate: '2026-10-11',
      partyTime: '2:00 PM',
      now: new Date('2026-09-01T00:00:00Z'),
    })
    // A reminder for a DIFFERENT booking, and one already sent, must survive.
    fake.tables.scheduled_reminders.push({
      id: 'aaaaaaaa-0000-4000-8000-000000000009',
      contact_id: CONTACT_ID, reminder_type: 'checkin_link_36hr', reference_type: 'booking',
      reference_id: 'HH-2026-9999', scheduled_for: '2026-10-10T06:00:00.000Z',
      channel: 'sms', status: 'pending',
    })
    fake.tables.scheduled_reminders[0].status = 'sent'

    await cancelCheckinReminders('HH-2026-0042')

    const byRef = (ref: string) => fake.tables.scheduled_reminders.filter(r => r.reference_id === ref)
    expect(byRef('HH-2026-9999')[0].status).toBe('pending')
    // The already-sent one is history and must not be rewritten.
    expect(byRef('HH-2026-0042').filter(r => r.status === 'sent')).toHaveLength(1)
    expect(byRef('HH-2026-0042').filter(r => r.status === 'cancelled')).toHaveLength(1)
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
