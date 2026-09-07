-- ══════════════════════════════════════════════════════════════
-- Migration 031: Pre-Arrival Check-In Link (Phase 1)
-- Run in Supabase SQL Editor — MANUAL, not applied automatically.
-- Safe to re-run. APPLIED TO PRODUCTION 2026-09-07.
--
-- Adds:
--   1. checkin_tokens       — hashed, expiring magic-link tokens (mirrors portal_tokens)
--   2. bookings.checkin_*   — check-in state + collected address + SignWell doc refs
--   3. the two check-in reminder types on scheduled_reminders
--   4. a partial unique index deduping them
--   5. nothing — see the note at the bottom of this file
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

-- CREATE POLICY has no IF NOT EXISTS, so guard it to keep this file re-runnable.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'checkin_tokens'
      AND policyname = 'Service role full access'
  ) THEN
    CREATE POLICY "Service role full access" ON public.checkin_tokens
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

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
-- 5. (REMOVED) contact_interactions type CHECK
-- ═══════════════════════════════════════════════════════════════
-- An earlier draft of this migration rebuilt contact_interactions_type_check
-- to add 'sms_unsubscribed', on the theory that the STOP handlers' audit-row
-- inserts were silently failing the constraint.
--
-- That was rebuilt from starting_plan/HostHampton_Supabase_Schema.sql, which
-- is STALE. The live table has been altered since: the app also writes
-- 'sms_received' and 'sequence_email_sent', neither of which appears in that
-- file, and those rows exist. Rebuilding from the stale list therefore failed
-- with 23514 (existing rows violate it) and, had it succeeded, would have
-- outlawed values in active use.
--
-- It is also not needed here. hasExplicitSmsOptOut() in lib/checkinLink.ts
-- checks sms_opt_in=false AND sms_opt_in_at IS NOT NULL first, which detects a
-- real STOP without reading the audit row at all. The audit-row lookup is a
-- secondary signal only.
--
-- Whether the constraint genuinely rejects 'sms_unsubscribed' is unverified
-- against production. To find out, run:
--
--   SELECT type, count(*) FROM public.contact_interactions GROUP BY type ORDER BY 2 DESC;
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--     WHERE conname = 'contact_interactions_type_check';
--
-- If 'sms_unsubscribed' is absent from the constraint, fix it in its own
-- migration built from the LIVE definition, not from the schema file.
