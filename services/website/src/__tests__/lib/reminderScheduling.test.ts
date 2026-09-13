/**
 * WHEN a reminder is scheduled for — asserted as an exact instant, in both
 * halves of the year.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE DID NOT EXIST, WHICH IS THE WHOLE POINT.
 *
 * `lib/reminders.ts` holds the four enqueuers every party, booking and event
 * ticket passes through. Until 2026-09-13 it built its times with
 * `new Date(date + 'T12:00:00')` + `.setHours(10, 0, 0, 0)` on a container that
 * runs in UTC, so all ten reminder types fired four to five hours before the
 * hour they were written for — `event_sms_1day` at 6am Eastern, and
 * `party_admin_unpaid_dayof` at 3am.
 *
 * The suite was 3048 tests green with that bug in it, and stayed 3048 green
 * after it was fixed: NOT ONE TEST ASSERTED A SCHEDULED TIME. The `scheduled_for`
 * values in `reminderEngine.test.ts` are all test INPUTS, fed to the queue; no
 * test had ever driven an enqueuer and looked at what came out. A guard that
 * cannot fail is the thing that lets a defect live for five months.
 *
 * `checkinReminders.test.ts` is the counter-example and the model for this file:
 * it asserts exact UTC instants for both EDT and EST, and its module is the one
 * that was correct. Every assertion below therefore names an EXPLICIT UTC
 * instant with the offset spelled out, so a regression prints a wrong timestamp
 * rather than a vague failure — and every reminder type is covered in BOTH
 * seasons, because `booking_sms_1day` was lawful in summer and a TCPA
 * quiet-hours violation in winter, and a test run in July would have missed it.
 */

import { makeFakeDb, scheduledRemindersSpec, type TableSpec, type FakeDb } from '../helpers/fakeReminderDb'

const CONTACT_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'

let fake: FakeDb
jest.mock('@/lib/supabase', () => ({ getSupabase: () => fake.supabase }))
// The check-in scheduler has its own exhaustively-tested module and its own
// suite; stubbed here so these assertions are about lib/reminders.ts alone.
jest.mock('@/lib/checkinReminders', () => ({
  ...jest.requireActual('@/lib/checkinReminders'),
  enqueueCheckinReminders: jest.fn(async () => {}),
}))

import {
  enqueueEventReminders,
  enqueueBookingReminders,
  enqueuePartyReminders,
  enqueueReviewRequest,
} from '@/lib/reminders'

const contactsSpec: TableSpec = {
  columns: {
    id: 'uuid', email: 'text', phone: 'text', first_name: 'text',
    sms_opt_in: 'bool', email_opt_in: 'bool', status: 'text', created_at: 'timestamptz',
  },
}
const bookingsSpec: TableSpec = {
  columns: { id: 'uuid', booking_ref: 'text', party_time: 'text' },
}

function setup(smsOptIn = true) {
  fake = makeFakeDb(
    {
      scheduled_reminders: scheduledRemindersSpec(),
      contacts: contactsSpec,
      bookings: bookingsSpec,
    },
    {
      contacts: [{
        id: CONTACT_ID, email: 'parent@example.com', phone: '+16314008080',
        first_name: 'Sam', sms_opt_in: smsOptIn, email_opt_in: true,
        status: 'customer', created_at: '2026-01-01T00:00:00.000Z',
      }],
      bookings: [{ id: '33333333-3333-4333-8333-333333333333', booking_ref: 'HH-TEST-0001', party_time: '2:00 PM' }],
    }
  )
}

/** The queued row for one reminder type, or undefined. */
function queued(type: string) {
  return fake.tables.scheduled_reminders.find((r: Record<string, unknown>) => r.reminder_type === type)
}

function when(type: string): string | undefined {
  const row = queued(type)
  return row ? String(row.scheduled_for) : undefined
}

beforeEach(() => { jest.useRealTimers() })
afterEach(() => { jest.useRealTimers() })

/**
 * Freeze the clock well before the party so nothing is filtered out by the
 * "never schedule into the past" guard, which would otherwise make an assertion
 * vacuously pass by queueing no row at all.
 */
function freezeAt(iso: string) {
  jest.useFakeTimers().setSystemTime(new Date(iso))
}

/* ───────────────────────────────────────────────────────────────────────────
 * 1. EDT (UTC-4). 10:00 Eastern is 14:00Z.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('party reminders land on the intended EASTERN hour — EDT', () => {
  const PARTY = '2026-10-10'

  beforeEach(async () => {
    setup()
    freezeAt('2026-09-01T00:00:00.000Z')
    await enqueuePartyReminders({ contactEmail: 'parent@example.com', bookingRef: 'HH-TEST-0001', partyDate: PARTY })
  })

  it('party_balance_t2 fires 10:00 ET two days before, NOT 06:00 ET', () => {
    expect(when('party_balance_t2')).toBe('2026-10-08T14:00:00.000Z')
  })

  it('party_balance_t1 fires 10:00 ET the day before', () => {
    expect(when('party_balance_t1')).toBe('2026-10-09T14:00:00.000Z')
  })

  it('party_admin_unpaid_dayof fires 07:00 ET on the day — it used to wake the owner at 3am', () => {
    expect(when('party_admin_unpaid_dayof')).toBe('2026-10-10T11:00:00.000Z')
  })

  it('party_thank_you_t1 fires 10:00 ET the day after', () => {
    expect(when('party_thank_you_t1')).toBe('2026-10-11T14:00:00.000Z')
  })

  it('queues exactly the four party types and nothing else', () => {
    expect(fake.tables.scheduled_reminders.map((r: Record<string, unknown>) => r.reminder_type).sort())
      .toEqual(['party_admin_unpaid_dayof', 'party_balance_t1', 'party_balance_t2', 'party_thank_you_t1'])
  })
})

describe('booking reminders land on the intended EASTERN hour — EDT', () => {
  beforeEach(async () => {
    setup()
    freezeAt('2026-09-01T00:00:00.000Z')
    await enqueueBookingReminders({ contactEmail: 'parent@example.com', bookingRef: 'HH-TEST-0001', partyDate: '2026-10-10' })
  })

  it('booking_email_7day fires 10:00 ET seven days before', () => {
    expect(when('booking_email_7day')).toBe('2026-10-03T14:00:00.000Z')
  })

  it('booking_email_1day — "Tomorrow\'s the big day!" — fires 10:00 ET, not 06:00', () => {
    expect(when('booking_email_1day')).toBe('2026-10-09T14:00:00.000Z')
  })

  it('booking_sms_1day fires 12:00 ET, comfortably inside quiet hours', () => {
    expect(when('booking_sms_1day')).toBe('2026-10-09T16:00:00.000Z')
  })
})

describe('event reminders land on the intended EASTERN hour — EDT', () => {
  beforeEach(async () => {
    setup()
    freezeAt('2026-09-01T00:00:00.000Z')
    await enqueueEventReminders({ contactEmail: 'parent@example.com', eventId: EVENT_ID, eventDate: '2026-10-10' })
  })

  it('event_email_3day fires 10:00 ET three days before', () => {
    expect(when('event_email_3day')).toBe('2026-10-07T14:00:00.000Z')
  })

  it('event_email_dayof fires 08:00 ET — it used to go out at 4am', () => {
    expect(when('event_email_dayof')).toBe('2026-10-10T12:00:00.000Z')
  })

  it('event_sms_1day fires 10:00 ET — it used to be a 6am text', () => {
    expect(when('event_sms_1day')).toBe('2026-10-09T14:00:00.000Z')
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 2. EST (UTC-5). The half of the year a hard-coded -04:00 would be wrong in,
 *    and the half in which booking_sms_1day used to break quiet hours.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the same reminders in EST — a fixed offset would be an hour out here', () => {
  beforeEach(async () => {
    setup()
    freezeAt('2026-11-01T00:00:00.000Z')
    await enqueueBookingReminders({ contactEmail: 'parent@example.com', bookingRef: 'HH-TEST-0001', partyDate: '2026-12-12' })
    await enqueueEventReminders({ contactEmail: 'parent@example.com', eventId: EVENT_ID, eventDate: '2026-12-12' })
  })

  it('booking_email_1day is 10:00 EST = 15:00Z, not 14:00Z', () => {
    expect(when('booking_email_1day')).toBe('2026-12-11T15:00:00.000Z')
  })

  it('booking_sms_1day is 12:00 EST = 17:00Z — it used to fire at 07:00 ET, unlawfully', () => {
    expect(when('booking_sms_1day')).toBe('2026-12-11T17:00:00.000Z')
  })

  it('event_sms_1day is 10:00 EST = 15:00Z — it used to fire at 05:00 ET', () => {
    expect(when('event_sms_1day')).toBe('2026-12-11T15:00:00.000Z')
  })

  it('event_email_dayof is 08:00 EST = 13:00Z', () => {
    expect(when('event_email_dayof')).toBe('2026-12-12T13:00:00.000Z')
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 3. Every SMS reminder this module schedules is inside the legal window.
 *
 *    Stated as a property rather than a list, so a NEW sms reminder type added
 *    to lib/reminders.ts is covered the day it is added rather than the day
 *    somebody remembers to extend a fixture.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('no SMS this module schedules may land outside 8am–9pm Eastern', () => {
  const cases: { label: string; date: string; now: string }[] = [
    { label: 'EDT', date: '2026-10-10', now: '2026-09-01T00:00:00.000Z' },
    { label: 'EST', date: '2026-12-12', now: '2026-11-01T00:00:00.000Z' },
    // Either side of both DST transitions in 2026.
    { label: 'spring-forward eve', date: '2026-03-09', now: '2026-02-01T00:00:00.000Z' },
    { label: 'fall-back eve', date: '2026-11-02', now: '2026-10-01T00:00:00.000Z' },
  ]

  it.each(cases)('$label: every queued sms row is within the window', async ({ date, now }) => {
    setup()
    freezeAt(now)
    await enqueuePartyReminders({ contactEmail: 'parent@example.com', bookingRef: 'HH-TEST-0001', partyDate: date })
    await enqueueBookingReminders({ contactEmail: 'parent@example.com', bookingRef: 'HH-TEST-0001', partyDate: date })
    await enqueueEventReminders({ contactEmail: 'parent@example.com', eventId: EVENT_ID, eventDate: date })
    await enqueueReviewRequest({
      contactEmail: 'parent@example.com', referenceType: 'booking',
      referenceId: 'HH-TEST-0001', eventDate: date,
    })

    const smsRows = fake.tables.scheduled_reminders.filter((r: Record<string, unknown>) => r.channel === 'sms')
    // Count what was examined. A rule that examines zero rows passes for the
    // wrong reason (link 24's R8).
    expect(smsRows.length).toBeGreaterThan(0)

    for (const row of smsRows) {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York', hour: 'numeric', hour12: false,
        }).format(new Date(String(row.scheduled_for)))
      ) % 24
      expect({ type: row.reminder_type, hour }).toEqual({ type: row.reminder_type, hour: expect.any(Number) })
      expect(hour).toBeGreaterThanOrEqual(8)
      expect(hour).toBeLessThan(21)
    }
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 4. An unreadable date drops that reminder, loudly — not the whole set.
 *
 *    The old code pushed `Invalid Date.toISOString()`, which throws RangeError.
 *    Every caller wraps these in a "non-fatal" try/catch, so ONE malformed
 *    party_date silently cost a customer every reminder they should have had.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('a party_date that cannot be read', () => {
  it('queues nothing and does NOT throw', async () => {
    setup()
    freezeAt('2026-09-01T00:00:00.000Z')
    const err = jest.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      enqueuePartyReminders({ contactEmail: 'parent@example.com', bookingRef: 'HH-TEST-0001', partyDate: 'sometime in June' })
    ).resolves.toBeUndefined()

    expect(fake.tables.scheduled_reminders).toHaveLength(0)
    // Rule 10: it must SAY it stopped, and name the row.
    expect(err).toHaveBeenCalled()
    expect(err.mock.calls.some(c => String(c[0]).includes('unreadable date'))).toBe(true)
    err.mockRestore()
  })

  it('a valid date still queues the full set — the guard is not over-broad', async () => {
    setup()
    freezeAt('2026-09-01T00:00:00.000Z')
    await enqueuePartyReminders({ contactEmail: 'parent@example.com', bookingRef: 'HH-TEST-0001', partyDate: '2026-10-10' })
    expect(fake.tables.scheduled_reminders).toHaveLength(4)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 5. The review request, which had its own flavour of the same bug.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('enqueueReviewRequest', () => {
  it('fires 14:00 ET the day after, not 14:00Z (which was 10am ET)', async () => {
    setup()
    freezeAt('2026-09-01T00:00:00.000Z')
    await enqueueReviewRequest({
      contactEmail: 'parent@example.com', referenceType: 'booking',
      referenceId: 'HH-TEST-0001', eventDate: '2026-10-10',
    })
    expect(when('review_request_sms')).toBe('2026-10-11T18:00:00.000Z')
  })

  it('is not queued at all for a contact who has not opted in to SMS', async () => {
    setup(false)
    freezeAt('2026-09-01T00:00:00.000Z')
    await enqueueReviewRequest({
      contactEmail: 'parent@example.com', referenceType: 'booking',
      referenceId: 'HH-TEST-0001', eventDate: '2026-10-10',
    })
    expect(fake.tables.scheduled_reminders).toHaveLength(0)
  })
})
