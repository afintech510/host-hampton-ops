-- migration_043_campaign_automation.sql
-- Phase 4: Campaign Automation — the buildable half.
--
-- Two tables, one per surface:
--
--   1. email_sequence_sends — the idempotency ledger the sequencer never had.
--      /api/cron/process-sequences has been check-then-act since 2026-03-10:
--      it read current_step, sent, then wrote current_step back. Two overlapping
--      ticks (or one cron redelivery) both read the same step and both send.
--      Two marketing emails to a real customer is not a rounding error, and the
--      route ran on a 15-minute schedule until 2026-08-16 with nothing stopping
--      that. The UNIQUE index below is the claim: the row is inserted BEFORE the
--      send, so the second caller gets 23505 and stops. Handled by CODE, not by
--      message text — the pattern booking_payments already uses (migration 040).
--
--   2. social_posts — the social content calendar. Model-written copy going out
--      under Host Hampton's name, so `status` DEFAULTS to the safe value and the
--      chain terminates at a human: `approved` and `published` are GATED edges
--      in lib/marketing/graph.ts requiring actor.isAdmin. Nothing here posts to
--      any external platform — Instagram/Meta and Google Business Profile are
--      blocked on credentials the container does not have.
--
-- Idempotent: safe to re-run.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. email_sequence_sends
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS email_sequence_sends (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- The claim key. enrollment_id already implies (contact, sequence), and it is
  -- the column the processor actually holds, so the unique index is on the pair
  -- the processor can build without a second read.
  enrollment_id   uuid NOT NULL REFERENCES contact_sequence_enrollments(id) ON DELETE CASCADE,
  step_number     integer NOT NULL,

  -- Denormalised for the admin surfaces and for forensics after an enrollment
  -- is deleted. Not part of the key.
  contact_id      uuid REFERENCES contacts(id) ON DELETE SET NULL,
  sequence_id     uuid REFERENCES email_sequences(id) ON DELETE SET NULL,

  -- claimed → the row exists and a send is in flight or was abandoned mid-flight
  -- sent    → the provider accepted it
  -- failed  → give-up state after MAX attempts; the enrollment is paused, loudly
  -- skipped → deliberately not sent (opted out between claim and send)
  status          text NOT NULL DEFAULT 'claimed'
                    CHECK (status IN ('claimed', 'sent', 'failed', 'skipped')),

  attempts        integer NOT NULL DEFAULT 1,
  provider        text,
  provider_id     text,
  last_error      text,
  to_email        text,

  claimed_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- THE guarantee. One row per (enrollment, step), forever. A second concurrent
-- tick gets 23505 and treats it as "somebody else owns this step".
CREATE UNIQUE INDEX IF NOT EXISTS email_sequence_sends_step_uniq
  ON email_sequence_sends (enrollment_id, step_number);

-- The processor's recovery scan: claimed rows older than the stale window.
CREATE INDEX IF NOT EXISTS email_sequence_sends_status_claimed_idx
  ON email_sequence_sends (status, claimed_at);

CREATE INDEX IF NOT EXISTS email_sequence_sends_contact_idx
  ON email_sequence_sends (contact_id);

COMMENT ON TABLE email_sequence_sends IS
  'One row per (enrollment, step). Claimed BEFORE the send; the unique index is what stops a double-send when two cron ticks overlap. 23505 on insert = already claimed.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. social_posts — EXTENDED, not created.
--
-- `social_posts` ALREADY EXISTS. It was written in the original Supabase schema
-- for the orchestrator's SOC agent, it has **zero rows**, and **nothing in any
-- service writes to it** (grepped across services/{soc,hampton,copy,outbound,
-- intel,list,image} and services/website/src). A first attempt at this migration
-- said `CREATE TABLE IF NOT EXISTS` and Postgres answered
-- `relation "social_posts" already exists, skipping` — which would have left the
-- app inserting columns that do not exist, against enums it does not know.
-- Measured before it was trusted, which is the only reason it is written this
-- way (hard-won rule 8).
--
-- So: EXTEND the table rather than add a second one. Two tables for one concept
-- is a concept nothing is checking (rule 11), and the existing columns
-- (`platform`, `status`, `caption`, `hashtags`, `scheduled_for`, `published_at`)
-- mean exactly what the calendar means by them.
--
-- Two consequences the app code has to respect, both from the existing enums:
--   * `platform` is `social_platform`, whose label is `facebook_page`, not
--     `facebook`.
--   * `status` is `content_status` = draft | approved | scheduled | published |
--     archived. There is NO `pending_review`, so the social_post graph does not
--     have one — a draft goes straight to `approved`, which is GATED anyway.
--     Widening a live enum to add a label the graph could have done without is
--     not worth the ALTER TYPE.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE social_posts
  ADD COLUMN IF NOT EXISTS post_type       text,
  -- What a human would need to shoot or pick. We generate no images here: the
  -- IMAGE agent is a separate surface, and an auto-generated image attached to
  -- unapproved copy is one more thing nobody reviewed.
  ADD COLUMN IF NOT EXISTS image_idea      text,
  ADD COLUMN IF NOT EXISTS call_to_action  text,
  ADD COLUMN IF NOT EXISTS link_url        text,
  ADD COLUMN IF NOT EXISTS source_event_id uuid,
  ADD COLUMN IF NOT EXISTS reviewed_by     text,
  ADD COLUMN IF NOT EXISTS reviewed_at     timestamptz,
  -- Every screen that fired on the way in, named. A guardrail that stops
  -- something must say that it stopped it (hard-won rule 10), and the panel
  -- renders these next to the draft.
  ADD COLUMN IF NOT EXISTS screen_notes    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS generation_meta jsonb  NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_posts'::regclass AND conname = 'social_posts_post_type_check'
  ) THEN
    ALTER TABLE social_posts ADD CONSTRAINT social_posts_post_type_check
      CHECK (post_type IS NULL OR post_type IN
        ('event', 'evergreen', 'seasonal', 'behind_the_scenes', 'community'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'social_posts'::regclass AND conname = 'social_posts_source_event_fkey'
  ) THEN
    ALTER TABLE social_posts ADD CONSTRAINT social_posts_source_event_fkey
      FOREIGN KEY (source_event_id) REFERENCES events(id) ON DELETE SET NULL;
  END IF;
END $$;

-- One live post per platform per DAY. `scheduled_for` is a timestamptz on this
-- table, so the index is over the UTC calendar day rather than the instant —
-- otherwise two drafts four hours apart would both be "the Tuesday slot".
--
-- Partial on `status <> 'archived'`, so archiving a draft frees the slot for a
-- re-generation rather than poisoning it forever. This is also the generator's
-- idempotency backstop: a second cron tick for the same week gets 23505 on every
-- slot it already filled and inserts nothing.
DROP INDEX IF EXISTS social_posts_slot_uniq;
CREATE UNIQUE INDEX social_posts_slot_uniq
  ON social_posts (((scheduled_for AT TIME ZONE 'UTC')::date), platform)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS social_posts_status_date_idx
  ON social_posts (status, scheduled_for);

COMMENT ON TABLE social_posts IS
  'Model-written social calendar drafts (Phase 4). status DEFAULTS to draft; approved/published are GATED graph edges in lib/marketing/graph.ts requiring an admin. Nothing in this table posts anywhere by itself — there are no Meta or Google Business credentials in the container.';

COMMIT;
