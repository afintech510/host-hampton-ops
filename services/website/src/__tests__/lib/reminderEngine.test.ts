/**
 * The reminder engine, tested against a store that models the database.
 *
 * Every test here exists because the previous suite could not have failed: its
 * Supabase mock accepted any insert, so it agreed with code the real table had
 * been rejecting for five months. See `../helpers/fakeReminderDb.ts`.
 */

import {
  makeFakeDb,
  scheduledRemindersSpec,
  type TableSpec,
} from '../helpers/fakeReminderDb'

const CONTACT_ID = '11111111-1111-4111-8111-111111111111'
const EVENT_ID = '22222222-2222-4222-8222-222222222222'

const contactsSpec: TableSpec = {
  columns: {
    id: 'uuid', email: 'text', phone: 'text', first_name: 'text',
    sms_opt_in: 'bool', sms_opt_in_at: 'timestamptz', email_opt_in: 'bool',
    status: 'text', created_at: 'timestamptz',
  },
}

function db(opts: { legacy?: boolean; contactEmail?: string } = {}) {
  return makeFakeDb(
    {
      scheduled_reminders: scheduledRemindersSpec({ legacyUuidReferenceId: opts.legacy }),
      contacts: contactsSpec,
    },
    {
      contacts: [
        {
          id: CONTACT_ID,
          email: opts.contactEmail ?? 'parent@example.com',
          phone: '+16314008080',
          first_name: 'Sam',
          sms_opt_in: true,
          email_opt_in: true,
          status: 'customer',
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    }
  )
}

/* ───────────────────────────────────────────────────────────────────────────
 * 1. The defect itself: the old schema refused the rows the old code wrote.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('the schema the reminder engine actually had', () => {
  it('REFUSED a booking_ref in reference_id with 22P02 — which is why the queue was empty', async () => {
    const { supabase, refusals, tables } = db({ legacy: true })

    const { error } = await supabase.from('scheduled_reminders').insert({
      contact_id: CONTACT_ID,
      reminder_type: 'booking_email_7day',
      reference_type: 'booking',
      reference_id: 'HH-2026-0976', // what lib/reminders.ts wrote for five months
      scheduled_for: '2026-10-01T14:00:00.000Z',
      channel: 'email',
    })

    expect(error?.code).toBe('22P02')
    expect(tables.scheduled_reminders).toHaveLength(0)
    expect(refusals).toHaveLength(1)
  })

  it("REFUSED reference_type 'event' with 23514 — the other half of the same silence", async () => {
    const { supabase } = db({ legacy: true })

    const { error } = await supabase.from('scheduled_reminders').insert({
      contact_id: CONTACT_ID,
      reminder_type: 'event_email_3day',
      reference_type: 'event',
      reference_id: EVENT_ID,
      scheduled_for: '2026-10-01T14:00:00.000Z',
      channel: 'email',
    })

    expect(error?.code).toBe('23514')
    expect(error?.message).toContain('reference_type')
  })

  it('accepts both, after migration 044', async () => {
    const { supabase, tables } = db()

    const a = await supabase.from('scheduled_reminders').insert({
      contact_id: CONTACT_ID, reminder_type: 'booking_email_7day', reference_type: 'booking',
      reference_id: 'HH-2026-0976', scheduled_for: '2026-10-01T14:00:00.000Z', channel: 'email',
    })
    const b = await supabase.from('scheduled_reminders').insert({
      contact_id: CONTACT_ID, reminder_type: 'event_email_3day', reference_type: 'event',
      reference_id: EVENT_ID, scheduled_for: '2026-10-01T14:00:00.000Z', channel: 'email',
    })

    expect(a.error).toBeNull()
    expect(b.error).toBeNull()
    expect(tables.scheduled_reminders).toHaveLength(2)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 2. enqueueReminders: per-row, so one duplicate cannot lose the batch.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('enqueueReminders', () => {
  const rows = (n: string[]) =>
    n.map(type => ({
      contact_id: CONTACT_ID,
      reminder_type: type,
      reference_type: 'booking' as const,
      reference_id: 'HH-2026-0976',
      scheduled_for: '2026-10-01T14:00:00.000Z',
      channel: 'email' as const,
    }))

  it('inserts every row and reports what landed', async () => {
    const { enqueueReminders } = await import('@/lib/reminderQueue')
    const { supabase, tables } = db()

    const res = await enqueueReminders(supabase, rows(['booking_email_7day', 'booking_email_1day']))

    expect(res).toMatchObject({ inserted: 2, duplicate: 0, refused: [] })
    expect(res.outcomes).toEqual(['inserted', 'inserted'])
    expect(tables.scheduled_reminders).toHaveLength(2)
  })

  it('treats the dedup 23505 as "already queued", not as an error', async () => {
    const { enqueueReminders } = await import('@/lib/reminderQueue')
    const { supabase } = db()

    await enqueueReminders(supabase, rows(['booking_email_7day']))
    const second = await enqueueReminders(supabase, rows(['booking_email_7day']))

    expect(second).toMatchObject({ inserted: 0, duplicate: 1, refused: [] })
    // Per row, not inferred from a clock — the caller charging an SMS budget
    // needs to know THIS row was already there.
    expect(second.byType.booking_email_7day).toBe('duplicate')
  })

  it('does NOT lose the rest of the batch to one duplicate — a bulk insert would', async () => {
    const { enqueueReminders } = await import('@/lib/reminderQueue')
    const { supabase, tables } = db()

    await enqueueReminders(supabase, rows(['booking_email_7day']))
    const res = await enqueueReminders(
      supabase,
      rows(['booking_email_7day', 'booking_email_1day', 'party_thank_you_t1'])
    )

    expect(res.duplicate).toBe(1)
    expect(res.inserted).toBe(2)
    expect(tables.scheduled_reminders).toHaveLength(3)
  })

  it('REPORTS a genuine refusal rather than swallowing it', async () => {
    const { enqueueReminders } = await import('@/lib/reminderQueue')
    const { supabase, tables } = db()

    const res = await enqueueReminders(supabase, [
      { ...rows(['booking_email_7day'])[0], reminder_type: 'not_a_real_type' },
    ])

    expect(res.inserted).toBe(0)
    expect(res.refused).toHaveLength(1)
    expect(res.refused[0].reason).toContain('reminder_type')
    expect(tables.scheduled_reminders).toHaveLength(0)
  })

  it('lets a cancelled row be re-enqueued — the check-in reschedule path', async () => {
    const { enqueueReminders } = await import('@/lib/reminderQueue')
    const { supabase, tables } = db()

    await enqueueReminders(supabase, [{ ...rows(['checkin_link_36hr'])[0], channel: 'sms' as const }])
    tables.scheduled_reminders[0].status = 'cancelled'

    const res = await enqueueReminders(supabase, [
      { ...rows(['checkin_link_36hr'])[0], channel: 'sms' as const, scheduled_for: '2026-11-01T14:00:00.000Z' },
    ])

    expect(res.inserted).toBe(1)
    // …but a SENT one may not be re-sent.
    tables.scheduled_reminders[1].status = 'sent'
    const third = await enqueueReminders(supabase, [
      { ...rows(['checkin_link_36hr'])[0], channel: 'sms' as const },
    ])
    expect(third.inserted).toBe(0)
    expect(third.duplicate).toBe(1)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 3. The claim. This is the test that a mock returning a fixed row cannot pass.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('claimReminder', () => {
  async function seeded() {
    const { enqueueReminders } = await import('@/lib/reminderQueue')
    const fake = db()
    await enqueueReminders(fake.supabase, [
      {
        contact_id: CONTACT_ID, reminder_type: 'booking_sms_1day', reference_type: 'booking',
        reference_id: 'HH-2026-0976', scheduled_for: '2026-10-01T14:00:00.000Z', channel: 'sms',
      },
    ])
    return { fake, id: fake.tables.scheduled_reminders[0].id as string }
  }

  it('exactly ONE of five concurrent ticks wins the row', async () => {
    const { claimReminder } = await import('@/lib/reminderQueue')
    const { fake, id } = await seeded()

    const results = await Promise.all([1, 2, 3, 4, 5].map(() => claimReminder(fake.supabase, id)))

    expect(results.filter(r => r.kind === 'claimed')).toHaveLength(1)
    expect(results.filter(r => r.kind === 'lost')).toHaveLength(4)
    expect(fake.tables.scheduled_reminders[0].status).toBe('sending')
  })

  it('a row that is not pending cannot be claimed', async () => {
    const { claimReminder } = await import('@/lib/reminderQueue')
    const { fake, id } = await seeded()
    fake.tables.scheduled_reminders[0].status = 'sent'

    expect(await claimReminder(fake.supabase, id)).toEqual({ kind: 'lost' })
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 4. finishReminder: a run that sent nothing must SAY it sent nothing.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('finishReminder', () => {
  async function row(attempts = 0) {
    const fake = db()
    fake.tables.scheduled_reminders.push({
      id: 'aaaaaaaa-0000-4000-8000-000000000001',
      contact_id: CONTACT_ID, reminder_type: 'booking_sms_1day', reference_type: 'booking',
      reference_id: 'HH-2026-0976', scheduled_for: '2026-10-01T14:00:00.000Z',
      channel: 'sms', status: 'sending', attempts,
    })
    return fake
  }

  it('delivered → sent, with a sent_at and the provider id', async () => {
    const { finishReminder } = await import('@/lib/reminderQueue')
    const fake = await row()
    await finishReminder(fake.supabase, { id: 'aaaaaaaa-0000-4000-8000-000000000001', attempts: 0 }, {
      kind: 'delivered', detail: 'quo:SM123',
    })
    const r = fake.tables.scheduled_reminders[0]
    expect(r.status).toBe('sent')
    expect(r.sent_at).toBeTruthy()
    expect(r.last_outcome).toBe('quo:SM123')
  })

  it('skipped → cancelled AND names the reason — never "sent"', async () => {
    const { finishReminder } = await import('@/lib/reminderQueue')
    const fake = await row()
    await finishReminder(fake.supabase, { id: 'aaaaaaaa-0000-4000-8000-000000000001', attempts: 0 }, {
      kind: 'skipped', reason: 'opted_out: sms_opt_in is not true',
    })
    const r = fake.tables.scheduled_reminders[0]
    expect(r.status).toBe('cancelled')
    expect(r.last_outcome).toContain('opted_out')
    expect(r.sent_at).toBeUndefined()
  })

  it('retry → back to pending and UNCLAIMED, so the next tick can read it', async () => {
    const { finishReminder } = await import('@/lib/reminderQueue')
    const fake = await row()
    fake.tables.scheduled_reminders[0].claimed_at = '2026-10-01T14:00:00.000Z'
    await finishReminder(fake.supabase, { id: 'aaaaaaaa-0000-4000-8000-000000000001', attempts: 0 }, {
      kind: 'retry', reason: 'resend rejected: 429',
    })
    const r = fake.tables.scheduled_reminders[0]
    expect(r.status).toBe('pending')
    expect(r.claimed_at).toBeNull()
    expect(r.attempts).toBe(1)
    expect(r.last_error).toContain('429')
  })

  it('retry gives up after MAX_ATTEMPTS rather than looping forever', async () => {
    const { finishReminder, MAX_ATTEMPTS } = await import('@/lib/reminderQueue')
    const fake = await row(MAX_ATTEMPTS - 1)
    await finishReminder(
      fake.supabase,
      { id: 'aaaaaaaa-0000-4000-8000-000000000001', attempts: MAX_ATTEMPTS - 1 },
      { kind: 'retry', reason: 'still down' }
    )
    expect(fake.tables.scheduled_reminders[0].status).toBe('failed')
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 5. Marketing vs transactional, declared once.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('isMarketingReminder', () => {
  it('classes both birthday nudges as marketing', async () => {
    const { isMarketingReminder } = await import('@/lib/reminderQueue')
    expect(isMarketingReminder('birthday_rebook_email')).toBe(true)
    expect(isMarketingReminder('birthday_rebook_sms')).toBe(true)
  })

  it('classes party and event reminders as transactional', async () => {
    const { isMarketingReminder } = await import('@/lib/reminderQueue')
    for (const t of [
      'booking_email_7day', 'booking_email_1day', 'booking_sms_1day',
      'event_email_3day', 'event_email_dayof', 'event_sms_1day',
      'party_balance_t1', 'party_balance_t2', 'party_thank_you_t1',
      'checkin_link_36hr', 'checkin_link_dayof', 'review_request_sms',
    ]) {
      expect(isMarketingReminder(t)).toBe(false)
    }
  })

  it('covers every reminder_type the live CHECK constraint allows', async () => {
    const { isMarketingReminder } = await import('@/lib/reminderQueue')
    const allowed = scheduledRemindersSpec().checks!.find(c => c.column === 'reminder_type')!.allowed
    // Not an assertion about the answer — an assertion that the question can be
    // asked of every type, so a new type added to the CHECK is a decision
    // somebody has to make rather than a silent default.
    for (const t of allowed) expect(typeof isMarketingReminder(t)).toBe('boolean')
    expect(allowed).toHaveLength(16)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 6. The ledger's uuid column vs a booking_ref.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('asLedgerEntityId', () => {
  it('passes a uuid through and nulls a booking_ref', async () => {
    const { asLedgerEntityId } = await import('@/lib/reminderQueue')
    expect(asLedgerEntityId(EVENT_ID)).toBe(EVENT_ID)
    expect(asLedgerEntityId('HH-2026-0976')).toBeNull()
    expect(asLedgerEntityId(null)).toBeNull()
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 7. The carrier's arithmetic, on the real templates.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('smsCost', () => {
  it('bills the birthday nudge as the three segments its emoji makes it', async () => {
    const { smsCost } = await import('@/lib/reminderQueue')
    const { smsBirthdayRebook } = await import('@/lib/sms-templates')
    const body = smsBirthdayRebook({ firstName: 'Sarah', childName: 'Emma', nextAge: 7 })
    expect(body).toContain('🎉')
    expect(smsCost(body)).toBeGreaterThan(1)
  })

  it('bills a plain GSM-7 reminder as one', async () => {
    const { smsCost } = await import('@/lib/reminderQueue')
    const { smsBookingReminder1Day } = await import('@/lib/sms-templates')
    expect(smsCost(smsBookingReminder1Day({ firstName: 'Sarah', partyTime: '2:00 PM' }))).toBe(1)
  })
})

/* ───────────────────────────────────────────────────────────────────────────
 * 8. Case-sensitivity — the bug that hid in `.eq('email', …)`.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('contact lookup against a store that models Postgres collation', () => {
  it('.eq() MISSES a mixed-case stored address — this is the defect, pinned', async () => {
    const { supabase } = db({ contactEmail: 'Parent@Example.com' })
    const { data } = await supabase.from('contacts').select('id').eq('email', 'parent@example.com')
    expect(data).toHaveLength(0)
  })

  it('findContactsByEmail finds it', async () => {
    const { findContactsByEmail } = await import('@/lib/contactLookup')
    const { supabase } = db({ contactEmail: 'Parent@Example.com' })
    const res = await findContactsByEmail(supabase, 'parent@example.com')
    expect(res.kind).toBe('found')
  })

  it("does NOT return a stranger matched by ilike's `_` wildcard", async () => {
    const { findContactsByEmail } = await import('@/lib/contactLookup')
    const { supabase } = db({ contactEmail: 'firstXlast@gmail.com' })
    const res = await findContactsByEmail(supabase, 'first_last@gmail.com')
    expect(res.kind).toBe('absent')
  })

  it('reports a failed read as unavailable, not as absent (rule 12)', async () => {
    const { findContactsByEmail } = await import('@/lib/contactLookup')
    const fake = db()
    fake.failReads('contacts')
    const res = await findContactsByEmail(fake.supabase, 'parent@example.com')
    expect(res.kind).toBe('unavailable')
  })
})
