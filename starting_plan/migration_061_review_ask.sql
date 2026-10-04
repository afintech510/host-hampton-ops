-- Migration 061 — the past-client review ask.
--
-- WHY:
--
-- Measured 2026-10-04 on the live DB: no review request has EVER been sent.
-- `marketing_ledger` holds zero `review_request` send rows, `scheduled_reminders`
-- holds five `review_request_sms` rows (all for ticketed events, none for a
-- party) and zero `party_thank_you_t1` rows, against 30 past parties since
-- March, 87 past event-ticket buyers and 430 imported 2025 customers.
--
-- The existing review types are keyed to ONE booking or ONE event, so they
-- cannot address an imported 2025 customer who has no row in either table. The
-- ask is a statement about a PERSON ("you celebrated with us"), asked once, so
-- it is keyed to the contact:
--
--   reference_type = 'contact'
--   reference_id   = 'review-ask'   (constant — one ask per person, ever)
--
-- and `uniq_scheduled_reminder_once (contact_id, reminder_type, reference_id)`
-- then makes "asked twice" a constraint violation rather than a policy.
--
-- Both new types are MARKETING (lib/reminderQueue.ts MARKETING_REMINDER_TYPES):
-- consent is re-read at send time by /api/cron/send-reminders, like the
-- birthday nudge. Enqueued by /api/cron/review-asks.

BEGIN;

ALTER TABLE scheduled_reminders DROP CONSTRAINT IF EXISTS scheduled_reminders_reminder_type_check;
ALTER TABLE scheduled_reminders ADD CONSTRAINT scheduled_reminders_reminder_type_check
  CHECK (reminder_type = ANY (ARRAY[
    'event_email_3day', 'event_email_dayof', 'event_sms_1day', 'event_sms_2hr',
    'booking_email_7day', 'booking_email_1day', 'booking_sms_1day',
    'party_balance_t2', 'party_balance_t1', 'party_admin_unpaid_dayof',
    'party_thank_you_t1', 'review_request_sms',
    'birthday_rebook_email', 'birthday_rebook_sms',
    'checkin_link_36hr', 'checkin_link_dayof',
    'review_ask_email', 'review_ask_sms'
  ]::text[]));

ALTER TABLE scheduled_reminders DROP CONSTRAINT IF EXISTS scheduled_reminders_reference_type_check;
ALTER TABLE scheduled_reminders ADD CONSTRAINT scheduled_reminders_reference_type_check
  CHECK (reference_type = ANY (ARRAY['event', 'booking', 'contact']::text[]));

COMMIT;
