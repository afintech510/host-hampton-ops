-- ══════════════════════════════════════════════════════════════
-- Migration 034: Booking agent Phase 2 — SMS review loop + real send.
-- Run in Supabase SQL Editor (migrations are applied manually). Idempotent.
-- See docs/booking-agent-plan.md §2 and §3 "Phase 2".
-- Depends on: migration_028 (inquiry_drafts), 032 (ingested_messages status),
--             033 (drafts for any channel).
--
-- RENUMBERING (2026-09-11, second time): Phase 2 ships before the planner work,
-- so it takes 034. party-plan-as-lead moves to 035 and the learning loop to 036.
-- Migrations stay in the order they are actually applied.
--
-- What Phase 2 needs from the schema is small — the status machine from 028
-- already has every state the review loop uses (sent_for_review →
-- revision_requested → approved → sent | cancelled). These columns are the
-- bookkeeping that makes the loop auditable and the nudge exactly-once.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.inquiry_drafts
  ADD COLUMN IF NOT EXISTS sent_for_review_at TIMESTAMPTZ,
    -- when the draft was last texted to the reviewers. The 2-hour nudge clock
    -- reads this, NOT created_at (a revision restarts the clock) and NOT
    -- updated_at (the 028 trigger bumps that on every write).
  ADD COLUMN IF NOT EXISTS nudged_at TIMESTAMPTZ,
    -- set when the single "this has been sitting for 2 hours" SMS goes out.
    -- Non-null = never nudge this draft again. At most one per draft, ever.
  ADD COLUMN IF NOT EXISTS approved_by TEXT,
    -- WHO approved: the E.164 reviewer phone, or 'admin:<email>' from the Inbox
    -- tab. approved_phrase (028) already records WHAT they said.
  ADD COLUMN IF NOT EXISTS send_error TEXT,
    -- last customer-send failure, kept separate from `error` (which holds
    -- guardrail holds) so a send retry does not erase the guardrail history.
  ADD COLUMN IF NOT EXISTS customer_email_message_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_sms_message_id TEXT;
    -- Resend / Quo ids for the messages the customer actually received.
    -- Paired with customer_email_sent_at / customer_sms_sent_at from 028, these
    -- make the send idempotent per channel: a retry skips a stamped channel, so
    -- a half-failed send can be re-run without texting anyone twice.

-- Existing live drafts pre-date the column; give them a clock so the nudge
-- sweep does not ignore them forever.
UPDATE public.inquiry_drafts
   SET sent_for_review_at = created_at
 WHERE sent_for_review_at IS NULL
   AND status IN ('sent_for_review', 'revision_requested');

-- The nudge sweep's whole query, as an index.
CREATE INDEX IF NOT EXISTS idx_inquiry_drafts_nudge_due
  ON public.inquiry_drafts (sent_for_review_at)
  WHERE status = 'sent_for_review' AND nudged_at IS NULL;

-- Finding the open draft a reviewer's text refers to.
CREATE INDEX IF NOT EXISTS idx_inquiry_drafts_open
  ON public.inquiry_drafts (created_at)
  WHERE status NOT IN ('sent', 'cancelled');

-- Verify
SELECT 'inquiry_drafts.sent_for_review_at' AS col,
       count(*) FILTER (WHERE sent_for_review_at IS NOT NULL) AS populated,
       count(*) AS total
  FROM public.inquiry_drafts
UNION ALL
SELECT 'new columns present',
       count(*),
       6
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'inquiry_drafts'
   AND column_name IN ('sent_for_review_at', 'nudged_at', 'approved_by',
                       'send_error', 'customer_email_message_id',
                       'customer_sms_message_id');
