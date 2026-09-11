-- ══════════════════════════════════════════════════════════════
-- Migration 033: Booking agent Phase 1 — drafts for any channel.
-- Run in Supabase SQL Editor (migrations are applied manually). Idempotent.
-- See docs/booking-agent-plan.md §2 and §3 "Phase 1".
-- Depends on: migration_028 (inquiry_drafts), migration_032 (ingested_messages
--             status/claim columns).
--
-- WHY NOW (this content was originally parked in the plan's "034"):
-- Phase 1 drafts a reply to a WEBSITE FORM LEAD. Most lead forms (lead,
-- contact, mobile-party-inquiry, quote/save, fundraiser, trucker, canvas bag)
-- create NO `bookings` row today — a plan row per lead is Phase 4 work. But
-- migration_028 made inquiry_drafts.booking_id NOT NULL, so without this
-- migration the agent could only ever draft for the four booking-creating
-- routes. Relaxing it here is the minimum that lets Phase 1 hit its exit
-- criterion ("a test lead through /mobile-party produces one draft row").
--
-- The plan's later migrations shift up by one: party-plan-as-lead is now 034,
-- agent_learnings + draft_feedback is now 035.
--
-- NOTE: the dispatcher does NOT use a SQL claim function. It claims each event
-- with a compare-and-swap UPDATE (`set status='claimed' where id=? and
-- status='new'` returning the row), which is atomic per row in Postgres and
-- needs no extra DB surface. See app/api/cron/agent-dispatch/route.ts.
-- ══════════════════════════════════════════════════════════════

-- ─── 1. A draft no longer requires a booking ────────────────────────────────
ALTER TABLE public.inquiry_drafts ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE public.inquiry_drafts
  ADD COLUMN IF NOT EXISTS contact_id       UUID REFERENCES public.contacts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inbound_event_id UUID REFERENCES public.ingested_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS channel          TEXT NOT NULL DEFAULT 'both',
    -- email | sms | both — which channels this draft covers.
  ADD COLUMN IF NOT EXISTS draft_kind       TEXT NOT NULL DEFAULT 'info_gather',
    -- info_gather | quote | reply | follow_up
  ADD COLUMN IF NOT EXISTS subject          TEXT,
    -- email subject line for the draft (the SMS draft has no subject)
  ADD COLUMN IF NOT EXISTS reviewer_note    TEXT;
    -- last free-text note a reviewer sent back (Phase 2 revision loop)

ALTER TABLE public.inquiry_drafts DROP CONSTRAINT IF EXISTS inquiry_drafts_channel_chk;
ALTER TABLE public.inquiry_drafts
  ADD CONSTRAINT inquiry_drafts_channel_chk CHECK (channel IN ('email', 'sms', 'both'));

ALTER TABLE public.inquiry_drafts DROP CONSTRAINT IF EXISTS inquiry_drafts_draft_kind_chk;
ALTER TABLE public.inquiry_drafts
  ADD CONSTRAINT inquiry_drafts_draft_kind_chk
  CHECK (draft_kind IN ('info_gather', 'quote', 'reply', 'follow_up'));

-- A draft must be attached to SOMETHING addressable, or nobody could ever send
-- it. (booking_id was the only anchor before; now any one of the three.)
ALTER TABLE public.inquiry_drafts DROP CONSTRAINT IF EXISTS inquiry_drafts_anchor_chk;
ALTER TABLE public.inquiry_drafts
  ADD CONSTRAINT inquiry_drafts_anchor_chk
  CHECK (booking_id IS NOT NULL OR contact_id IS NOT NULL OR inbound_event_id IS NOT NULL);

-- ─── 2. One live draft per inbound event (mirrors the per-booking index) ────
-- Together with the dispatcher's compare-and-swap claim, this is the second
-- half of "an event claimed twice produces one draft, not two".
CREATE UNIQUE INDEX IF NOT EXISTS uq_inquiry_drafts_active_event
  ON public.inquiry_drafts (inbound_event_id)
  WHERE inbound_event_id IS NOT NULL AND status NOT IN ('sent', 'cancelled');

CREATE INDEX IF NOT EXISTS idx_inquiry_drafts_contact
  ON public.inquiry_drafts (contact_id) WHERE contact_id IS NOT NULL;

-- Verify
SELECT 'inquiry_drafts' AS t, count(*) AS rows FROM public.inquiry_drafts
UNION ALL
SELECT 'inquiry_drafts_booking_id_nullable',
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'inquiry_drafts'
           AND column_name = 'booking_id' AND is_nullable = 'YES');
