-- ══════════════════════════════════════════════════════════════
-- Migration 023: Birthday rebooking reminder types + dedup constraint
--
--   Adds two AUTO_EXECUTE reminder types (birthday_rebook_email/_sms)
--   that the birthday-rebooking cron enqueues into scheduled_reminders,
--   delivered by the existing send-reminders cron.
--
--   Dedup is enforced as a CONSTRAINT, not a query: a PARTIAL UNIQUE
--   index on (contact_id, reminder_type, reference_id) scoped to the
--   birthday types. Re-running the scanner inserts with ON CONFLICT DO
--   NOTHING and never double-enqueues.
--
--   Also reconciles the reminder_type CHECK with reality: the live
--   constraint was missing several types the app already inserts
--   (party_balance_t1/t2, party_admin_unpaid_dayof, party_thank_you_t1,
--   review_request_sms) — those inserts were silently failing the check.
--   This migration rebuilds the check to include them plus the new
--   birthday types. See the note in the session summary.
--
-- Run via Supabase SQL editor. Idempotent. Run by hand — do NOT
-- auto-apply.
-- ══════════════════════════════════════════════════════════════

-- ── 1. Reconcile the reminder_type CHECK ───────────────────────
ALTER TABLE public.scheduled_reminders
  DROP CONSTRAINT IF EXISTS scheduled_reminders_reminder_type_check;

ALTER TABLE public.scheduled_reminders
  ADD CONSTRAINT scheduled_reminders_reminder_type_check
    CHECK (reminder_type = ANY (ARRAY[
      -- events
      'event_email_3day', 'event_email_dayof', 'event_sms_1day', 'event_sms_2hr',
      -- bookings
      'booking_email_7day', 'booking_email_1day', 'booking_sms_1day',
      -- party planner balance / thank-you (already used by src/lib/reminders.ts)
      'party_balance_t2', 'party_balance_t1', 'party_admin_unpaid_dayof', 'party_thank_you_t1',
      -- post-event review ask (already used by enqueueReviewRequest)
      'review_request_sms',
      -- NEW: birthday rebooking (this migration)
      'birthday_rebook_email', 'birthday_rebook_sms'
    ]::text[]));

-- ── 2. Partial unique index = dedup as a constraint ────────────
-- Scoped to the birthday types so it never constrains other reminders
-- (which may legitimately repeat across bookings). reference_id holds
-- the source booking's UUID (bookings.id).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_birthday_rebook_reminder
  ON public.scheduled_reminders(contact_id, reminder_type, reference_id)
  WHERE reminder_type IN ('birthday_rebook_email', 'birthday_rebook_sms');

-- Verify
SELECT conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'public.scheduled_reminders'::regclass
  AND conname = 'scheduled_reminders_reminder_type_check';
