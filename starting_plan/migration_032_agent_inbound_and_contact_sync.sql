-- ══════════════════════════════════════════════════════════════
-- Migration 032: Booking agent — inbound events, Gmail sync state,
--                contact-sync bookkeeping, deposit_amount default fix.
-- Run in Supabase SQL Editor (migrations are applied manually). Idempotent.
-- See docs/booking-agent-plan.md §2.
-- Depends on: migration_024 (ingested_messages), migration_025,
--             migration_028 (inquiry_drafts), migration_004/009 (bookings).
-- ══════════════════════════════════════════════════════════════

-- ─── 1. ingested_messages becomes the unified inbound-event store ──────────
-- Website forms, Quo SMS and Gmail all land here; the dispatcher claims rows
-- with status='new'. external_id stays UNIQUE (idempotent inserts).

ALTER TABLE public.ingested_messages DROP CONSTRAINT IF EXISTS ingested_messages_source_check;
ALTER TABLE public.ingested_messages
  ADD CONSTRAINT ingested_messages_source_check
  CHECK (source IN ('gmail', 'grasshopper', 'local_invoice', 'quo', 'website_form', 'system'));

ALTER TABLE public.ingested_messages
  ADD COLUMN IF NOT EXISTS status              TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS claimed_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS handled_at          TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS classification      TEXT,
    -- lead | customer_reply | booking_admin | reviewer_reply | vendor | marketing | spam | other
  ADD COLUMN IF NOT EXISTS classification_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS booking_id          UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS draft_id            UUID REFERENCES public.inquiry_drafts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS error               TEXT;

ALTER TABLE public.ingested_messages DROP CONSTRAINT IF EXISTS ingested_messages_status_check;
ALTER TABLE public.ingested_messages
  ADD CONSTRAINT ingested_messages_status_check
  CHECK (status IN ('new', 'claimed', 'handled', 'ignored', 'error'));

-- Historical rows (the Gmail/invoice mine) must never trigger the agent.
UPDATE public.ingested_messages SET status = 'handled', handled_at = COALESCE(handled_at, created_at)
 WHERE status = 'new' AND created_at < NOW();

CREATE INDEX IF NOT EXISTS idx_ingested_messages_dispatch
  ON public.ingested_messages (status, created_at) WHERE status IN ('new', 'claimed');
CREATE INDEX IF NOT EXISTS idx_ingested_messages_booking
  ON public.ingested_messages (booking_id) WHERE booking_id IS NOT NULL;

-- ─── 2. Gmail sync cursor (single row) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.gmail_sync_state (
  id                INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  mailbox           TEXT NOT NULL DEFAULT 'hosthampton295@gmail.com',
  history_id        TEXT,
  last_full_sync_at TIMESTAMPTZ,
  last_poll_at      TIMESTAMPTZ,
  last_error        TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO public.gmail_sync_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.gmail_sync_state ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_role_full_access_gmail_sync_state ON public.gmail_sync_state;
CREATE POLICY service_role_full_access_gmail_sync_state
  ON public.gmail_sync_state FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- ─── 3. Contact sync bookkeeping (Supabase ↔ Brevo ↔ Quo) ───────────────────
-- lib/contactSync.ts writes these after each successful external upsert so the
-- admin can see which contacts are out of sync and a backfill can target them.
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS brevo_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quo_contact_id  TEXT,
  ADD COLUMN IF NOT EXISTS quo_synced_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_error      TEXT;

-- SMS-only leads have no email yet. contacts.email is already nullable+unique;
-- this keeps phone unique among email-less rows so an unknown texter is one row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_phone_when_no_email
  ON public.contacts (phone) WHERE email IS NULL AND phone IS NOT NULL;

-- ─── 4. bookings.deposit_amount is CENTS (fix the default + document it) ────
-- migration_004 said "store as dollars (250 = $250)" and defaulted to 250, but
-- every writer in the app stores cents (25000 = $250) and every reader divides
-- by 100. The default was the only place still in dollars: an insert that
-- omitted the column would have recorded a $2.50 deposit.
ALTER TABLE public.bookings ALTER COLUMN deposit_amount SET DEFAULT 25000;
COMMENT ON COLUMN public.bookings.deposit_amount IS
  'Deposit in CENTS (25000 = $250). All writers/readers use cents; see lib/partyPricing.ts BOOKING_DEPOSIT_CENTS.';

-- Any legacy rows that were written in dollars (< 1000 means "< $10", which
-- never happens for a real deposit) are normalised to cents.
UPDATE public.bookings SET deposit_amount = deposit_amount * 100
 WHERE deposit_amount > 0 AND deposit_amount < 1000;

-- Verify
SELECT 'ingested_messages' AS t, count(*) FROM public.ingested_messages
UNION ALL SELECT 'gmail_sync_state', count(*) FROM public.gmail_sync_state
UNION ALL SELECT 'bookings_deposit_lt_1000', count(*) FROM public.bookings WHERE deposit_amount > 0 AND deposit_amount < 1000;
