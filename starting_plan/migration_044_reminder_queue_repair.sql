-- migration_044_reminder_queue_repair.sql
--
-- Repairs `scheduled_reminders`, the Phase 3B reminder queue.
--
-- WHY. Measured in production on 2026-09-12: the table held **zero rows, ever**.
-- Every writer in `lib/reminders.ts` and `lib/checkinReminders.ts` was rejected
-- by this table's own schema and none of them looked at the insert's error:
--
--   * `reference_id` was `uuid`, but four of the five enqueue functions write a
--     booking_ref ('HH-2026-0976'). Postgres answers 22P02 — invalid input
--     syntax for type uuid. `lib/checkinReminders.ts` even carries a comment
--     saying the column is "keyed by reference_id = booking_ref", which is
--     hard-won rule 13: a constraint asserted in a comment and contradicted by
--     the schema.
--   * `reference_type` CHECK allowed ('event_ticket','booking'), but the event
--     enqueuer writes 'event' and the sender branches on 'event'. 23514.
--     'event_ticket' has never been written by anything and has zero rows.
--
-- So: widen `reference_id` to text (it holds a business key by design), make the
-- CHECK say what the code means, and add the three things the sender needed and
-- did not have:
--
--   * status 'sending' — a CLAIM, taken before the send, so two overlapping cron
--     ticks cannot both text the same customer (the same shape Phase 4 needed
--     for `email_sequence_sends`);
--   * attempts / last_outcome / last_error — so a run that sent nothing can SAY
--     it sent nothing (hard-won rule 10) and a transient failure is not terminal
--     (rule 3);
--   * ONE unique index instead of two partial ones (rule 11), so every reminder
--     type is enqueue-once-per (contact, type, reference). Partial on
--     status <> 'cancelled' so the check-in reschedule path — which cancels the
--     old rows and inserts new ones — still works.
--
-- Idempotent: safe to re-run.

BEGIN;

-- ── 1. reference_id: uuid → text ─────────────────────────────────────────────
-- The table is empty in production, so the USING cast is a formality; it is
-- written anyway so this migration is correct against any environment that does
-- have rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'scheduled_reminders'
      AND column_name = 'reference_id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE scheduled_reminders
      ALTER COLUMN reference_id TYPE text USING reference_id::text;
  END IF;
END $$;

-- ── 2. reference_type CHECK: say what the code means ─────────────────────────
ALTER TABLE scheduled_reminders
  DROP CONSTRAINT IF EXISTS scheduled_reminders_reference_type_check;
ALTER TABLE scheduled_reminders
  ADD CONSTRAINT scheduled_reminders_reference_type_check
  CHECK (reference_type = ANY (ARRAY['event'::text, 'booking'::text]));

-- ── 3. status CHECK: add the claim state ─────────────────────────────────────
ALTER TABLE scheduled_reminders
  DROP CONSTRAINT IF EXISTS scheduled_reminders_status_check;
ALTER TABLE scheduled_reminders
  ADD CONSTRAINT scheduled_reminders_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'sending'::text,   -- claimed by a cron tick, send in flight
    'sent'::text,
    'failed'::text,
    'cancelled'::text
  ]));

-- ── 4. Columns that let a run say what it actually did ───────────────────────
ALTER TABLE scheduled_reminders ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
ALTER TABLE scheduled_reminders ADD COLUMN IF NOT EXISTS last_outcome text;
ALTER TABLE scheduled_reminders ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE scheduled_reminders ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMENT ON COLUMN scheduled_reminders.reference_id IS
  'Business key of the thing being reminded about: bookings.booking_ref when reference_type=''booking'', events.id when reference_type=''event''. TEXT, not uuid — see migration 044.';
COMMENT ON COLUMN scheduled_reminders.status IS
  'pending → sending (claimed) → sent | failed | cancelled. ''cancelled'' means a guardrail deliberately stopped the send; last_outcome/last_error say which.';
COMMENT ON COLUMN scheduled_reminders.last_outcome IS
  'Why this row is in its current status — ''delivered'', ''opted_out'', ''no_phone'', ''provider_rejected'', ''balance_paid'', ''unconfigured'', … A run that sent nothing must be able to say so.';

-- ── 5. One dedup constraint, not two partial ones ────────────────────────────
-- The two pre-existing partial indexes covered only birthday and check-in rows,
-- so every other reminder type could be enqueued twice — and once
-- /api/cron/event-reminders started enqueueing rather than sending, the same
-- person would have had an `event_sms_1day` from their ticket purchase AND one
-- from the nightly scan. One index, every type.
DROP INDEX IF EXISTS uniq_birthday_rebook_reminder;
DROP INDEX IF EXISTS uniq_checkin_link_reminder;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_scheduled_reminder_once
  ON scheduled_reminders (contact_id, reminder_type, reference_id)
  WHERE status <> 'cancelled';

-- Claim scan: pending rows in due order.
CREATE INDEX IF NOT EXISTS idx_reminders_claimable
  ON scheduled_reminders (scheduled_for)
  WHERE status = 'pending';

COMMIT;
