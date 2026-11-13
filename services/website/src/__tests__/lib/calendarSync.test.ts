import {
  planBookingCalendar, partyWindow, clockTime, refOf, toBookingEvent,
  type BookingEvent, type CalendarBooking,
} from '@/lib/calendarSync'

const TODAY = '2026-11-04'

function booking(over: Partial<CalendarBooking> = {}): CalendarBooking {
  return {
    id: 'b1', booking_ref: 'HH-PTY-TEST1', status: 'deposit_paid', party_type: 'in_studio_theme', event_type: 'kids-party',
    party_date: '2026-11-29', party_time: '13:00', party_tags: {}, contact_name: 'Bonnie Vahlsing', contact_email: 'b@example.com',
    package_type: 'Party', guest_count_approx: 12, child_name: null, google_calendar_event_id: null, quote_snapshot: null,
    ...over,
  }
}

function event(over: Partial<BookingEvent> = {}): BookingEvent {
  return { id: 'ev1', ref: 'HH-PTY-TEST1', date: '2026-11-29', start: '13:00', end: '15:00', allDay: false, summary: '[PARTY] x', ...over }
}

describe('planBookingCalendar — the calendar follows the money', () => {
  it('removes the event of a cancelled booking nobody paid for (HH-2026-9024)', () => {
    const p = planBookingCalendar(booking({ status: 'cancelled' }), 0, [event()], TODAY)
    expect(p.ops).toEqual([expect.objectContaining({ kind: 'delete', eventId: 'ev1', reason: 'cancelled' })])
    expect(p.keepId).toBeNull()
  })

  it('removes the event of a lost lead', () => {
    const p = planBookingCalendar(booking({ status: 'lost' }), 0, [event()], TODAY)
    expect(p.ops).toEqual([expect.objectContaining({ kind: 'delete', reason: 'marked lost' })])
  })

  it('does not hold the slot for an approved quote with nothing paid', () => {
    const p = planBookingCalendar(booking({ status: 'approved' }), 0, [event()], TODAY)
    expect(p.stage).toBe('quoted')
    expect(p.ops).toEqual([expect.objectContaining({ kind: 'delete', reason: 'nothing paid yet' })])
  })

  it('holds the slot once an approved booking has a deposit', () => {
    const p = planBookingCalendar(booking({ status: 'approved' }), 25000, [event()], TODAY)
    expect(p.ops).toEqual([])
    expect(p.keepId).toBe('ev1')
  })

  it('never creates or deletes an event for an outside event (migration 096), paid or not', () => {
    const outside = booking({ party_type: 'outside_event', status: 'confirmed', google_calendar_event_id: 'ev9' })
    for (const paid of [0, 25000]) {
      const p = planBookingCalendar(outside, paid, [], TODAY)
      expect(p.ops).toEqual([])
      expect(p.keepId).toBe('ev9')
    }
    // Even a stray event naming the ref is left alone (no delete op).
    expect(planBookingCalendar(outside, 0, [event({ id: 'ev9' })], TODAY).ops).toEqual([])
  })

  it('still creates the event for a normal studio party and a null party_type once paid', () => {
    for (const party_type of ['in_studio_theme', null]) {
      const p = planBookingCalendar(booking({ party_type, party_date: '2026-11-14', party_time: '12:00' }), 25000, [], TODAY)
      expect(p.ops).toEqual([expect.objectContaining({ kind: 'create' })])
    }
  })

  it('creates the missing event for a paid party (hand-entered deposits had none)', () => {
    const p = planBookingCalendar(booking({ party_date: '2026-11-14', party_time: '12:00' }), 25000, [], TODAY)
    expect(p.ops).toEqual([expect.objectContaining({
      kind: 'create', window: { date: '2026-11-14', start: '12:00', end: '14:00' },
      description: expect.stringMatching(/^Ref: HH-PTY-TEST1$/m),
    })])
  })

  it('moves an event whose party was rescheduled (HH-PTY-B7T6W: 11-28 12:00 → 11-29 13:00)', () => {
    const p = planBookingCalendar(booking(), 25000, [event({ date: '2026-11-28', start: '12:00', end: '14:00' })], TODAY)
    expect(p.ops).toEqual([expect.objectContaining({
      kind: 'move', eventId: 'ev1',
      from: { date: '2026-11-28', start: '12:00', end: '14:00' },
      window: { date: '2026-11-29', start: '13:00', end: '15:00' },
    })])
  })

  it('keeps one event and deletes the duplicates, preferring the stored id', () => {
    const p = planBookingCalendar(
      booking({ google_calendar_event_id: 'ev2' }), 25000,
      [event({ id: 'ev1' }), event({ id: 'ev2' }), event({ id: 'ev3', start: '10:00', end: '12:00' })], TODAY,
    )
    expect(p.keepId).toBe('ev2')
    expect(p.ops.map(o => [o.kind, 'eventId' in o ? o.eventId : null])).toEqual([['delete', 'ev1'], ['delete', 'ev3']])
  })

  it('blocks 90 minutes for a mini party, as the invitation does (HH-2026-0765: 10:00–11:30)', () => {
    const p = planBookingCalendar(
      booking({ party_date: '2026-12-19', party_time: '10:00', quote_snapshot: { isMiniParty: true } }),
      25000, [event({ date: '2026-12-19', start: '11:00', end: '13:00' })], TODAY,
    )
    expect(p.ops).toEqual([expect.objectContaining({
      kind: 'move', window: { date: '2026-12-19', start: '10:00', end: '11:30' },
    })])
    // Not a mini: still two hours.
    expect(partyWindow({ party_date: '2026-12-19', party_time: '10:00', party_tags: {}, quote_snapshot: { isMiniParty: false } }))
      .toEqual({ date: '2026-12-19', start: '10:00', end: '12:00' })
  })

  it('uses the rented window for a studio rental', () => {
    const p = planBookingCalendar(
      booking({ party_type: 'studio_rental', party_time: '10:00', party_tags: { rental_start_time: '10:00', rental_end_time: '13:00' } }),
      25000, [], TODAY,
    )
    expect(p.ops[0]).toEqual(expect.objectContaining({ kind: 'create', window: { date: '2026-11-29', start: '10:00', end: '13:00' } }))
    expect((p.ops[0] as { summary: string }).summary).toMatch(/^\[STUDIO RENTAL\] /)
  })

  it('never touches a party that has already happened', () => {
    const past = planBookingCalendar(booking({ party_date: '2026-10-17' }), 25000, [], TODAY)
    expect(past.stage).toBe('completed')
    expect(past.ops).toEqual([])
  })

  it('leaves a booked party alone when its time cannot be placed ("Evening")', () => {
    const p = planBookingCalendar(booking({ party_time: 'Evening' }), 25000, [event()], TODAY)
    expect(p.ops).toEqual([])
    expect(p.note).toMatch(/cannot be placed/)
  })

  it('counts a refund against what was paid', () => {
    // 25000 paid then 25000 refunded nets to 0 — the caller passes the net figure.
    expect(planBookingCalendar(booking({ status: 'approved' }), 0, [event()], TODAY).ops[0].kind).toBe('delete')
  })
})

describe('time and ref parsing', () => {
  it('reads every party_time spelling the table holds', () => {
    expect(clockTime('11:00')).toBe('11:00')
    expect(clockTime('9:30')).toBe('09:30')
    expect(clockTime('12:00 PM')).toBe('12:00')
    expect(clockTime('2:00 pm')).toBe('14:00')
    expect(clockTime('Evening')).toBeNull()
    expect(clockTime(null)).toBeNull()
    expect(clockTime('25:00')).toBeNull()
  })

  it('needs a real date', () => {
    expect(partyWindow({ party_date: null, party_time: '11:00', party_tags: {} })).toBeNull()
    expect(partyWindow({ party_date: '2026-11', party_time: '11:00', party_tags: {} })).toBeNull()
  })

  it('matches the Ref line exactly, never a ref that merely starts the same', () => {
    expect(refOf('Ref: HH-PTY-AB12\nGuests: ~5')).toBe('HH-PTY-AB12')
    expect(refOf('Contact: x\nRef: HH-2026-0765')).toBe('HH-2026-0765')
    expect(refOf('No ref here')).toBeNull()
    expect(refOf(undefined)).toBeNull()
  })

  it('reads an event in Eastern time, across the DST change', () => {
    const e = toBookingEvent({
      id: 'x', description: 'Ref: R1',
      start: { dateTime: '2026-11-28T17:00:00Z' }, end: { dateTime: '2026-11-28T19:00:00Z' },
    })
    expect(e).toEqual(expect.objectContaining({ ref: 'R1', date: '2026-11-28', start: '12:00', end: '14:00', allDay: false }))
    // 01:30 UTC on the 1st is 8:30pm ET on the 30th — the case the old UTC month window dropped.
    const late = toBookingEvent({ id: 'y', start: { dateTime: '2026-12-01T01:30:00Z' }, end: { dateTime: '2026-12-01T03:30:00Z' } })
    expect(late.date).toBe('2026-11-30')
    expect(late.start).toBe('20:30')
  })
})
