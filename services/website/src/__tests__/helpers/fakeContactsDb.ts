/**
 * The `contacts` table as Postgres really holds it, for tests about IDENTITY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY. The tests around `upsertContact` passed for months against a mock built
 * like this:
 *
 *     buildChain({ data: { id: 'c-1' }, error: null })
 *
 * — a fixed row for every read, and an `upsert` that accepted anything. Against
 * that, `upsert(record, { onConflict: 'email' })` looks correct, because the
 * mock has no unique index to be case-sensitive about. Production had one:
 * `contacts_email_key UNIQUE (email)` on the **RAW** value. On 2026-09-12 there
 * were 1217 contacts with an email, **1209 distinct addresses, and eight real
 * people with two rows each.** A green suite agreed with code the database had
 * been quietly duplicating people through for six months. Rule 8's mock form,
 * for the sixth session running.
 *
 * Everything here was read out of `information_schema`, `pg_constraint`,
 * `pg_indexes`, `pg_trigger` and `pg_enum` on production on 2026-09-12:
 *
 *   - `contacts_email_key`  UNIQUE (email)               — on the raw value
 *   - `uq_contacts_phone_when_no_email`  UNIQUE (phone) WHERE email IS NULL
 *   - `status`  NOT NULL DEFAULT 'lead'::contact_status, 7 labels
 *   - `email_opt_in` / `sms_opt_in`  NOT NULL DEFAULT false
 *   - one trigger, `trg_contacts_updated_at` (BEFORE UPDATE)
 *
 * There is **no** functional index on `lower(email)`, and adding one is not a
 * build-session decision: eight pairs would collide (needs-Adam 31).
 */

import { makeFakeDb, type TableSpec } from './fakeReminderDb'

/** `pg_enum` for `contact_status`, read live. */
export const CONTACT_STATUS_LABELS = [
  'lead',
  'warm_lead',
  'hot_lead',
  'customer',
  'vip',
  'inactive',
  'unsubscribed',
]

export function contactsSpec(): TableSpec {
  return {
    columns: {
      id: 'uuid',
      email: 'text',
      phone: 'text',
      first_name: 'text',
      last_name: 'text',
      full_name: 'text',
      status: 'text',
      source: 'text',
      source_detail: 'text',
      zip_code: 'text',
      city: 'text',
      service_interests: 'text',
      email_opt_in: 'bool',
      sms_opt_in: 'bool',
      email_opt_in_at: 'timestamptz',
      sms_opt_in_at: 'timestamptz',
      lifetime_value: 'int',
      booking_count: 'int',
      notes: 'text',
      created_at: 'timestamptz',
      updated_at: 'timestamptz',
      brevo_synced_at: 'timestamptz',
      quo_contact_id: 'text',
      quo_synced_at: 'timestamptz',
      sync_error: 'text',
    },
    defaults: { status: 'lead', email_opt_in: false, sms_opt_in: false },
    checks: [{ name: 'contact_status', column: 'status', allowed: CONTACT_STATUS_LABELS }],
    uniques: [
      // THE ONE THAT MATTERS: the raw value, so `Foo@x.com` and `foo@x.com`
      // are two different rows and no `onConflict: 'email'` can see that.
      { name: 'contacts_email_key', columns: ['email'], where: r => r.email != null },
      {
        name: 'uq_contacts_phone_when_no_email',
        columns: ['phone'],
        where: r => r.email == null && r.phone != null,
      },
    ],
  }
}

export function contactSequenceEnrollmentsSpec(): TableSpec {
  return {
    columns: {
      id: 'uuid',
      contact_id: 'uuid',
      sequence_id: 'uuid',
      status: 'text',
      current_step: 'int',
      metadata: 'text',
      enrolled_at: 'timestamptz',
      last_sent_at: 'timestamptz',
      created_at: 'timestamptz',
    },
    defaults: { status: 'active', current_step: 0 },
    uniques: [{ name: 'uniq_enrollment', columns: ['contact_id', 'sequence_id'] }],
  }
}

export function contactInteractionsSpec(): TableSpec {
  return {
    columns: {
      id: 'uuid',
      contact_id: 'uuid',
      type: 'text',
      summary: 'text',
      metadata: 'text',
      created_at: 'timestamptz',
    },
    // `contact_interactions_type_check`, read live 2026-09-12. Link 8 found the
    // app writing a label this CHECK forbids for five months.
    checks: [
      {
        name: 'contact_interactions_type_check',
        column: 'type',
        allowed: [
          'email_sent', 'email_opened', 'email_clicked', 'email_unsubscribed', 'email_bounced',
          'sms_sent', 'sms_replied', 'sms_received', 'sms_unsubscribed',
          'ig_dm', 'fb_dm', 'phone_call', 'in_person',
          'booking_inquiry', 'booking_confirmed', 'review_requested', 'review_left',
          'ad_click', 'form_submission', 'other',
        ],
      },
    ],
  }
}

export function bookingsSpec(): TableSpec {
  return {
    columns: {
      id: 'uuid',
      booking_ref: 'text',
      contact_email: 'text',
      contact_id: 'uuid',
      status: 'text',
      party_date: 'text',
      created_at: 'timestamptz',
    },
  }
}

export function scheduledRemindersLiteSpec(): TableSpec {
  return {
    columns: {
      id: 'uuid',
      contact_id: 'uuid',
      channel: 'text',
      status: 'text',
      reminder_type: 'text',
      reference_type: 'text',
      reference_id: 'text',
      scheduled_for: 'timestamptz',
      created_at: 'timestamptz',
    },
    defaults: { status: 'pending' },
  }
}

/**
 * The eight real duplicate pairs, in the shape production holds them — the
 * measured spelling, the measured order, and the measured disagreement about
 * consent. Two of them are why a test can assert what a duplicate COSTS
 * rather than only that one exists.
 */
export function seedDuplicatePair(opts: {
  lower: string
  mixed: string
  /** The older row's spelling — which the canonical rule must pick. */
  olderIsMixed?: boolean
  olderOptIn?: boolean
  newerOptIn?: boolean
  olderStatus?: string
  newerStatus?: string
}): Record<string, any>[] {
  const older = opts.olderIsMixed ? opts.mixed : opts.lower
  const newer = opts.olderIsMixed ? opts.lower : opts.mixed
  return [
    {
      id: '00000000-0000-4000-8000-00000000d001',
      email: older,
      status: opts.olderStatus ?? 'customer',
      email_opt_in: opts.olderOptIn ?? true,
      sms_opt_in: false,
      created_at: '2026-03-07T18:13:00.000Z',
    },
    {
      id: '00000000-0000-4000-8000-00000000d002',
      email: newer,
      status: opts.newerStatus ?? 'lead',
      email_opt_in: opts.newerOptIn ?? false,
      sms_opt_in: false,
      created_at: '2026-08-05T01:06:00.000Z',
    },
  ]
}

export function makeContactsDb(seed: Record<string, any[]> = {}) {
  return makeFakeDb(
    {
      contacts: contactsSpec(),
      contact_sequence_enrollments: contactSequenceEnrollmentsSpec(),
      contact_interactions: contactInteractionsSpec(),
      bookings: bookingsSpec(),
      scheduled_reminders: scheduledRemindersLiteSpec(),
    },
    seed
  )
}
