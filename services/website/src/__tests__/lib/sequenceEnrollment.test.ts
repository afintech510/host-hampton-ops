/**
 * `enrollInSequence` — the third arm of the `upsertContact` fan-out.
 *
 * Two things are being asserted, and both were wrong:
 *
 *   1. The "already a customer, do not nurture them as a lead" guard used
 *      `.eq('contact_email', …)`, case-SENSITIVE, against a column where 9 of
 *      61 live rows are not lowercase. A returning customer reads as a fresh
 *      lead and starts receiving "here's why you should book" email.
 *   2. That read's error was discarded, so a Supabase blip said the same
 *      thing — and enrolling is the direction that costs goodwill, so
 *      "could not tell" must NOT enrol (rule 12).
 *
 * Everything runs against `makeContactsDb`, whose `.eq()` is case-sensitive
 * exactly like Postgres — which is the only reason a test here can tell the
 * old filter from the new one.
 */

import { makeContactsDb } from '../helpers/fakeContactsDb'

const mockGetSupabase = jest.fn()
jest.mock('@/lib/supabase', () => ({ getSupabase: (...a: any[]) => mockGetSupabase(...a) }))

import { enrollInSequence } from '@/lib/sequences'

const CONTACT = '00000000-0000-4000-8000-00000000d001'
const SEQ_GENERIC = '00000000-0000-4000-8000-0000000000a1'
const SEQ_KIDS = '00000000-0000-4000-8000-0000000000a2'

function sequences() {
  return [
    { id: SEQ_GENERIC, trigger_event: 'new_inquiry', is_active: true, service_filter: null, total_emails: 3 },
    { id: SEQ_KIDS, trigger_event: 'new_inquiry', is_active: true, service_filter: 'kids_party', total_emails: 3 },
  ]
}

function db(seed: Record<string, any[]> = {}) {
  const fake = makeContactsDb({ email_sequences: sequences(), ...seed })
  mockGetSupabase.mockReturnValue(fake.supabase)
  return fake
}

const BASE = {
  contactId: CONTACT,
  contactEmail: 'jeberhardt517@gmail.com',
  triggerEvent: 'new_inquiry' as const,
}

beforeEach(() => jest.clearAllMocks())

describe('enrollInSequence', () => {
  it('enrols into every matching active sequence', async () => {
    const fake = db()
    const res = await enrollInSequence({ ...BASE, serviceType: 'kids_party' })
    expect(res).toEqual({ kind: 'enrolled', sequences: 2 })
    expect(fake.tables.contact_sequence_enrollments).toHaveLength(2)
  })

  it('respects a sequence service filter', async () => {
    const fake = db()
    const res = await enrollInSequence({ ...BASE, serviceType: 'room_rental' })
    expect(res).toEqual({ kind: 'enrolled', sequences: 1 })
    expect(fake.tables.contact_sequence_enrollments[0].sequence_id).toBe(SEQ_GENERIC)
  })

  it('skips a person who already has a confirmed booking', async () => {
    db({
      bookings: [
        { id: '00000000-0000-4000-8000-0000000000b1', booking_ref: 'HH-1', contact_email: 'jeberhardt517@gmail.com', status: 'deposit_paid' },
      ],
    })
    const res = await enrollInSequence(BASE)
    expect(res).toEqual({ kind: 'skipped-booked' })
  })

  it('THE FIX: skips them when the booking address is stored in a different case', async () => {
    // `.eq('contact_email', lower(input))` returned nothing for this row, so a
    // paying customer was enrolled in the lead-nurture sequence.
    const fake = db({
      bookings: [
        { id: '00000000-0000-4000-8000-0000000000b1', booking_ref: 'HH-1', contact_email: 'Jeberhardt517@gmail.com', status: 'confirmed' },
      ],
    })
    const res = await enrollInSequence(BASE)
    expect(res).toEqual({ kind: 'skipped-booked' })
    expect(fake.tables.contact_sequence_enrollments).toHaveLength(0)
  })

  it('a cancelled or lead booking does NOT count as booked', async () => {
    db({
      bookings: [
        { id: '00000000-0000-4000-8000-0000000000b1', booking_ref: 'HH-1', contact_email: 'jeberhardt517@gmail.com', status: 'cancelled' },
        { id: '00000000-0000-4000-8000-0000000000b2', booking_ref: 'HH-2', contact_email: 'jeberhardt517@gmail.com', status: 'lead' },
      ],
    })
    expect((await enrollInSequence(BASE)).kind).toBe('enrolled')
  })

  it('a FAILED booking check defers — it does not enrol on a guess', async () => {
    const fake = db()
    fake.failReads('bookings')

    const res = await enrollInSequence(BASE)

    expect(res.kind).toBe('deferred')
    expect(fake.tables.contact_sequence_enrollments).toHaveLength(0)
  })

  it('a FAILED sequence read defers rather than reading as "no sequences"', async () => {
    const fake = db()
    fake.failReads('email_sequences')

    const res = await enrollInSequence(BASE)

    expect(res.kind).toBe('deferred')
    expect(fake.tables.contact_sequence_enrollments).toHaveLength(0)
  })

  it('no matching sequence is its own outcome, distinct from a failure', async () => {
    const fake = makeContactsDb({ email_sequences: [] })
    mockGetSupabase.mockReturnValue(fake.supabase)
    expect(await enrollInSequence(BASE)).toEqual({ kind: 'no-sequences' })
  })

  it('a refused enrolment is `failed`, and is NOT logged as a success', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const fake = db()
    fake.failWrites('contact_sequence_enrollments')

    const res = await enrollInSequence({ ...BASE, serviceType: 'room_rental' })

    expect(res.kind).toBe('failed')
    // The old code printed "Enrolled … in sequences" here regardless (rule 10).
    expect(log.mock.calls.flat().join(' ')).not.toContain('Enrolled')
    log.mockRestore()
  })

  it('is idempotent — a second call adds no second enrolment', async () => {
    const fake = db()
    await enrollInSequence({ ...BASE, serviceType: 'room_rental' })
    await enrollInSequence({ ...BASE, serviceType: 'room_rental' })
    expect(fake.tables.contact_sequence_enrollments).toHaveLength(1)
  })

  it('a booking_confirmed trigger does not run the already-booked check at all', async () => {
    const fake = makeContactsDb({
      email_sequences: [
        { id: SEQ_GENERIC, trigger_event: 'booking_confirmed', is_active: true, service_filter: null, total_emails: 2 },
      ],
      bookings: [
        { id: '00000000-0000-4000-8000-0000000000b1', booking_ref: 'HH-1', contact_email: 'jeberhardt517@gmail.com', status: 'confirmed' },
      ],
    })
    mockGetSupabase.mockReturnValue(fake.supabase)

    const res = await enrollInSequence({ ...BASE, triggerEvent: 'booking_confirmed' })
    expect(res).toEqual({ kind: 'enrolled', sequences: 1 })
  })

  it('does not print the customer address in full', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    db()
    await enrollInSequence({ ...BASE, serviceType: 'room_rental' })
    const line = log.mock.calls.flat().join(' ')
    expect(line).not.toContain('jeberhardt517@gmail.com')
    expect(line).toContain('***@gmail.com')
    log.mockRestore()
  })
})
