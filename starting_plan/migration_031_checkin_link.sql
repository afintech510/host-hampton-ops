-- ══════════════════════════════════════════════════════════════
-- Migration 031: Pre-Arrival Check-In Link (Phase 1)
-- Run in Supabase SQL Editor — MANUAL, not applied automatically.
--
-- Adds:
--   1. checkin_tokens       — hashed, expiring magic-link tokens (mirrors portal_tokens)
--   2. bookings.checkin_*   — check-in state + collected address + SignWell doc refs
--
-- Phase 1 scope: contact details, marketing consent, SignWell agreement.
-- NO card / Stripe columns here — that is Phase 2 by design.
--
-- Marketing opt-in is deliberately NOT stored on bookings. It is written
-- through lib/contacts.ts upsertContact(), which sets email_opt_in/sms_opt_in
-- with timestamps and source attribution on the contact record. Do not add a
-- boolean here. (Note: lib/marketing/consent.ts is a different thing — it
-- handles signed MEDIA releases, not marketing opt-in.)
-- ══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. checkin_tokens
-- ═══════════════════════════════════════════════════════════════
-- One row per link we mint. A booking gets several over its life (the 36hr
-- send, the 6am send, plus any admin resends), and ALL of them must keep
-- working — a customer who opens yesterday's text should not hit a dead link.
-- That is why this is a table and not a column on bookings.
--
-- Only the HMAC hash is stored; the raw token exists solely in the SMS.

CREATE TABLE IF NOT EXISTS public.checkin_tokens (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id  UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ct_booking    ON public.checkin_tokens(booking_id);
-- Validation looks the token up by hash, so this is the hot path.
CREATE INDEX IF NOT EXISTS idx_ct_token_hash ON public.checkin_tokens(token_hash);

ALTER TABLE public.checkin_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.checkin_tokens
  FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════
-- 2. Extend bookings
-- ═══════════════════════════════════════════════════════════════

-- Check-in lifecycle. 'pending' until the customer submits the form.
--   pending   — no submission yet (default for every booking, incl. backfill)
--   started   — details saved, agreement not yet signed
--   complete  — details saved AND agreement signed
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_status TEXT NOT NULL DEFAULT 'pending';

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_started_at   TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_completed_at TIMESTAMPTZ;

-- Address collected at check-in. The existing contact_name / contact_email /
-- contact_phone columns are reused for the other three fields — check-in
-- updates them in place rather than duplicating the customer's identity.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_address_line1 TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_address_line2 TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_city          TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_state         TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_postal_code   TEXT;

-- SignWell rental agreement + liability waiver.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_signwell_document_id TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_agreement_signed_at  TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS checkin_agreement_pdf_url    TEXT;

-- The webhook correlates a completed SignWell document back to a booking by
-- document id, so this needs to be fast and is effectively unique.
CREATE INDEX IF NOT EXISTS idx_bookings_checkin_signwell_doc
  ON public.bookings(checkin_signwell_document_id)
  WHERE checkin_signwell_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_checkin_status ON public.bookings(checkin_status);

-- Guard against a typo'd status writing a value nothing downstream understands.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_checkin_status_check'
  ) THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_checkin_status_check
      CHECK (checkin_status IN ('pending', 'started', 'complete'));
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. Allow the two check-in reminder types
-- ═══════════════════════════════════════════════════════════════
-- REQUIRED. scheduled_reminders has a CHECK on reminder_type; inserting an
-- unlisted type fails with 23514. Migration 023 documents this exact trap —
-- several types were silently failing their inserts because the check was
-- never updated. The constraint must be DROPped and rebuilt in full; a bare
-- ADD CONSTRAINT on an existing name fails.
--
-- This list is migration 023's array plus the two new check-in types. If any
-- other migration has added types since 023, merge them in before running.

ALTER TABLE public.scheduled_reminders
  DROP CONSTRAINT IF EXISTS scheduled_reminders_reminder_type_check;

ALTER TABLE public.scheduled_reminders
  ADD CONSTRAINT scheduled_reminders_reminder_type_check
    CHECK (reminder_type = ANY (ARRAY[
      -- events
      'event_email_3day', 'event_email_dayof', 'event_sms_1day', 'event_sms_2hr',
      -- bookings
      'booking_email_7day', 'booking_email_1day', 'booking_sms_1day',
      -- party planner balance / thank-you
      'party_balance_t2', 'party_balance_t1', 'party_admin_unpaid_dayof', 'party_thank_you_t1',
      -- post-event review ask
      'review_request_sms',
      -- birthday rebooking (migration 023)
      'birthday_rebook_email', 'birthday_rebook_sms',
      -- NEW: pre-arrival check-in link (this migration)
      'checkin_link_36hr', 'checkin_link_dayof'
    ]::text[]));

-- ═══════════════════════════════════════════════════════════════
-- 4. Dedup the check-in reminders as a constraint
-- ═══════════════════════════════════════════════════════════════
-- Same technique as uniq_birthday_rebook_reminder (migration 023 §2). The
-- enqueue runs on booking creation, on admin resend, and again whenever the
-- party date changes, so "insert twice" is a matter of when, not if. Scoped
-- to the two check-in types so other reminders are unaffected.
-- reference_id here holds bookings.booking_ref (what the cron looks up by).

CREATE UNIQUE INDEX IF NOT EXISTS uniq_checkin_link_reminder
  ON public.scheduled_reminders(contact_id, reminder_type, reference_id)
  WHERE reminder_type IN ('checkin_link_36hr', 'checkin_link_dayof');

-- ═══════════════════════════════════════════════════════════════
-- 5. Fix: allow 'sms_unsubscribed' in contact_interactions
-- ═══════════════════════════════════════════════════════════════
-- PRE-EXISTING BUG, fixed here because the check-in flow depends on it.
--
-- The STOP handlers (app/api/webhooks/twilio, app/api/webhooks/quo) insert a
-- contact_interactions row with type='sms_unsubscribed'. That value is not in
-- the table's CHECK constraint, and the insert's error is never checked — so
-- every SMS opt-out since those handlers shipped has silently failed to write
-- its audit row. (The sms_opt_in flag itself IS set correctly, so opt-outs
-- were still honoured; only the audit trail was lost.)
--
-- The check-in link is transactional and therefore does NOT gate on the
-- marketing sms_opt_in flag, so it needs a trustworthy record of real STOPs.
-- Also adds 'email_unsubscribed' for symmetry with the Brevo webhook.

ALTER TABLE public.contact_interactions
  DROP CONSTRAINT IF EXISTS contact_interactions_type_check;

ALTER TABLE public.contact_interactions
  ADD CONSTRAINT contact_interactions_type_check
    CHECK (type = ANY (ARRAY[
      'email_sent', 'email_opened', 'email_clicked',
      'sms_sent', 'sms_replied',
      'ig_dm', 'fb_dm',
      'phone_call', 'in_person',
      'booking_inquiry', 'booking_confirmed',
      'review_requested', 'review_left',
      'ad_click', 'form_submission', 'other',
      -- NEW: opt-out audit rows the webhook handlers already try to write
      'sms_unsubscribed', 'email_unsubscribed'
    ]::text[]));
