-- migration_045_content_experiments.sql
--
-- Phase 5, second half: A/B content testing. The tables that record a variant,
-- who was shown it, and what they did.
--
-- ── WHY THESE TABLES AND NOT THE ONES THAT ALREADY EXIST ────────────────────
--
-- Measured in production on 2026-09-12, before a line of this was written:
--
--   * `analytics_events` — 0 rows, and **zero references anywhere in the repo**.
--     The table designed for content attribution (campaign / content / medium /
--     source / session_id) has never had a writer.
--   * `content_library.performance` jsonb — 20 rows, `{}` on **all twenty**.
--   * `scheduled_campaigns` — 7 rows `sent` to **2,160 recipients** with
--     `opened = 0`, `clicked = 0`, `bounced = 0`.
--   * `contact_interactions` — 142 rows, and only **two** of the CHECK's twenty
--     labels have ever been written: `form_submission` (109) and `sms_received`
--     (33). Zero `email_sent`, zero `email_opened`, zero `email_clicked`.
--
-- So this system has never recorded a single content-outcome datum. "INTEL
-- tracks performance" had nothing to track. That is why Phase 5 builds the
-- MEASUREMENT before the generator, and why none of the existing columns is
-- reused as the substrate: a jsonb blob on `content_library` cannot carry a
-- UNIQUE index, and a unique index is the only thing that makes an assignment a
-- claim rather than a wish.
--
-- ── THE FOUR TABLES ─────────────────────────────────────────────────────────
--
--   content_experiments      one named test. status DEFAULTS to 'draft'.
--   content_variants         the copy. Model-written, screened both ways.
--   variant_assignments      THE CLAIM about a person. UNIQUE (experiment, contact).
--   variant_events           the outcome. UNIQUE (assignment, event_type).
--
-- ── THE SAFETY PROPERTIES, AS SCHEMA RATHER THAN AS CONVENTION ──────────────
--
-- 1. `content_experiments.status` DEFAULTS to 'draft' and only an `active`
--    experiment assigns anybody. Same reasoning as `agent_learnings.is_active`
--    defaulting FALSE (plan §23 layer 1) and `social_posts.status` defaulting
--    'draft' (migration 043): the chain from model-written copy to a customer
--    terminates at a human, and a future writer that forgets to set a status
--    fails SAFE rather than mailing 944 people.
--
-- 2. `UNIQUE (experiment_id, contact_id)` on `variant_assignments` is what makes
--    an A/B assignment a fact about a person rather than a coin flip repeated
--    every tick. Two overlapping cron runs cannot assign two variants: the
--    second gets 23505 and reads back the first. Exactly the shape migration 043
--    needed for `email_sequence_sends` and 044 for `scheduled_reminders`.
--
-- 3. `UNIQUE (assignment_id, event_type)` on `variant_events`. A redelivered
--    click is not a second click. Idempotency is in the index, and 23505 is
--    handled by CODE, never by message text.
--
-- 4. `min_per_arm` is a COLUMN, not a constant in a prompt. The rule that
--    decides "not enough data" has to be readable by the person reading the
--    result (hard-won rule 15: an A/B test with too little data must say so
--    rather than pick a winner).
--
-- 5. Every text column that a model writes is length-capped in the DATABASE.
--    Migration 042 learned this the expensive way: `draft_feedback`'s uncapped
--    body columns returned 2,000,000 characters from one probe row, and the
--    weekly cron selects forty.
--
-- Idempotent: safe to re-run.

BEGIN;

-- ── 1. content_experiments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_experiments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Human-readable name. Unique so a second run of the same weekly job names
  -- the existing experiment rather than making a rival one.
  name            text NOT NULL,

  -- Which sender reads this experiment. A surface the code does not know about
  -- is a row nothing will ever act on, so the CHECK is the allowlist and
  -- `lib/experiments/types.ts` holds the same list ONCE (hard-won rule 11).
  surface         text NOT NULL
                  CHECK (surface IN ('sequence_step', 'campaign_subject')),

  -- Which step / campaign category this test binds to. Interpreted per surface;
  -- NULL means "any", which is deliberately allowed so a subject-line test can
  -- span a sequence.
  target_key      text,

  -- The outcome that decides the test. One metric per experiment: a test that
  -- can choose its winner after the fact from three metrics has no significance
  -- level at all.
  metric          text NOT NULL DEFAULT 'clicked'
                  CHECK (metric IN ('clicked', 'converted', 'replied')),

  -- The refusal rule, stated in the row. See note 4 above.
  min_per_arm     integer NOT NULL DEFAULT 30 CHECK (min_per_arm >= 2),
  -- Two-sided alpha for the two-proportion test. 0.05 default; a caller may
  -- tighten it, never loosen past 0.2 (past that it is not a test).
  alpha           numeric NOT NULL DEFAULT 0.05
                  CHECK (alpha > 0 AND alpha <= 0.2),

  hypothesis      text CHECK (hypothesis IS NULL OR length(hypothesis) <= 1000),

  -- DEFAULT 'draft'. See note 1. `active` is a GATED edge in
  -- lib/marketing/graph.ts and requires an authenticated admin.
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'active', 'paused', 'concluded', 'archived')),

  -- The conclusion, written by the analysis run. NULL until then; a non-null
  -- value here is a PROPOSAL a human reads, never something the app applies.
  outcome         text CHECK (outcome IS NULL OR outcome IN ('winner', 'no_difference', 'not_enough_data', 'unavailable')),
  outcome_note    text CHECK (outcome_note IS NULL OR length(outcome_note) <= 2000),
  winning_variant uuid,
  concluded_at    timestamptz,

  created_by      text,
  activated_by    text,
  activated_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_experiments_name_uniq
  ON content_experiments (lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_content_experiments_active
  ON content_experiments (surface, status) WHERE status = 'active';

-- ── 2. content_variants ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS content_variants (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id   uuid NOT NULL REFERENCES content_experiments(id) ON DELETE CASCADE,

  -- 'A', 'B', 'C'. Short and human, because it appears in a ledger row and in a
  -- conversation about which one won.
  label           text NOT NULL CHECK (label ~ '^[A-Z]$'),

  -- Exactly one control per experiment (partial unique index below). The control
  -- is the copy that is live today; without one a "winner" is a comparison
  -- against nothing.
  is_control      boolean NOT NULL DEFAULT false,

  -- The copy. Capped in the database (note 5). `subject` is a mail HEADER, so
  -- it is flattened by the writer before it gets here; the cap is the backstop.
  subject         text CHECK (subject IS NULL OR length(subject) <= 300),
  body_html       text CHECK (body_html IS NULL OR length(body_html) <= 20000),
  body_text       text CHECK (body_text IS NULL OR length(body_text) <= 20000),

  -- What the write-time screen trimmed or flattened. Rule 10: a guardrail that
  -- changed something has to say it changed it.
  screen_notes    text[] NOT NULL DEFAULT '{}',
  generation_meta jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_content_variants_label_uniq
  ON content_variants (experiment_id, label);
-- At most one control per experiment.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_variants_one_control
  ON content_variants (experiment_id) WHERE is_control;

-- The winner reference, added after content_variants exists so the FK is real
-- rather than a uuid nobody checks.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_experiments_winning_variant_fkey'
  ) THEN
    ALTER TABLE content_experiments
      ADD CONSTRAINT content_experiments_winning_variant_fkey
      FOREIGN KEY (winning_variant) REFERENCES content_variants(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ── 3. variant_assignments — THE CLAIM ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS variant_assignments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  experiment_id   uuid NOT NULL REFERENCES content_experiments(id) ON DELETE CASCADE,
  variant_id      uuid NOT NULL REFERENCES content_variants(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,

  -- What the assignment was made FOR, so a second send of a different step to
  -- the same person is traceable. Not part of the unique key on purpose: an
  -- experiment assigns a PERSON to an arm once and keeps them there, which is
  -- what makes the arms comparable.
  context         jsonb NOT NULL DEFAULT '{}'::jsonb,

  assigned_by     text,
  assigned_at     timestamptz NOT NULL DEFAULT now()
);

-- Note 2. This index IS the guarantee.
CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_assignments_once
  ON variant_assignments (experiment_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_variant_assignments_variant
  ON variant_assignments (variant_id);

-- ── 4. variant_events — THE OUTCOME ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS variant_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id   uuid NOT NULL REFERENCES variant_assignments(id) ON DELETE CASCADE,

  -- `sent` and `clicked` are facts we cause and record directly.
  -- `converted` is attributed within a stated window by the analysis run.
  -- There is deliberately NO `opened`: Apple Mail Privacy Protection pre-fetches
  -- every tracking pixel, so an open count is a number that looks like evidence
  -- and is not one. Fabricated signal is worse than none (hard-won rule 15).
  event_type      text NOT NULL
                  CHECK (event_type IN ('sent', 'clicked', 'replied', 'converted', 'unsubscribed', 'bounced')),

  -- Where the destination of a tracked click went, for the click events. Capped.
  detail          text CHECK (detail IS NULL OR length(detail) <= 500),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);

-- Note 3. A redelivered click is not a second click.
CREATE UNIQUE INDEX IF NOT EXISTS idx_variant_events_once
  ON variant_events (assignment_id, event_type);

-- ── 5. unattributed_signals — rule 14's final branch ─────────────────────────
--
-- `lib/unclaimedPayment.ts` exists because an unattributable payment is a
-- bookkeeping problem and an INVISIBLE one is a lost payment. The same shape
-- applies here: a tracked link whose token verifies but whose assignment row is
-- gone, or an outcome that arrives for an experiment that has been deleted, is
-- a real signal we cannot attribute. It goes SOMEWHERE A HUMAN LOOKS rather
-- than into a counter that reads as "this variant lost".
CREATE TABLE IF NOT EXISTS unattributed_signals (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  kind            text NOT NULL CHECK (length(kind) <= 60),
  reason          text NOT NULL CHECK (length(reason) <= 500),
  meta            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_unattributed_signals_created
  ON unattributed_signals (created_at DESC);

-- ── 6. agent_memory: mark it retired, do not delete it ───────────────────────
--
-- Measured 2026-09-12: `agent_memory` holds 44 rows. 43 were written between
-- 2026-02-18 and 2026-02-21 by `scripts/seed_agent_memory.js` and never touched
-- again; the 44th, `analytics.last_report`, was overwritten by INTEL 78 times
-- daily and stopped on **2026-04-22**. `services/website` — the only Host
-- Hampton system still deployed — references the table **zero times**, and
-- `/opt/hosthampton/docker-compose.yml` defines only `nginx` and `website`:
-- the orchestrator and all seven agent services are gone, and
-- `app.hosthampton.com` answers 520.
--
-- So this is dead data belonging to a decommissioned system, and it holds
-- February prices, a `services.packages` tier list and HoneyBook booking links.
-- Plan §24's headline defect was a hand-written store that had never been
-- screened feeding prices into a prompt that forbids prices. Wiring 44 rows of
-- this in blind would reproduce that at scale.
--
-- It is NOT dropped: 44 rows of hand-curated brand knowledge and 89 rows of
-- `agent_memory_history` provenance are worth keeping, and some of the rows are
-- still true and still useful to the booking agent. `lib/agent/memoryImport.ts`
-- is the one door from here into the LIVE loop (`agent_learnings`), screened on
-- the way in, inactive on arrival, screened again on the way out.
--
-- ── How the judgement is recorded, and why it is NOT a per-row column ───────
--
-- The first draft of this migration added `retired_note text` and set it on all
-- 44 rows. `agent_memory` carries two BEFORE UPDATE triggers, read out of
-- `pg_trigger` rather than assumed (hard-won rule 13):
--
--   trg_memory_version   → log_memory_change(), which inserts into
--                          agent_memory_history ONLY when `value` changes. A
--                          note-only UPDATE is invisible to it. Fine.
--   trg_memory_updated_at → handle_updated_at(), which fires UNCONDITIONALLY.
--
-- So a 44-row note UPDATE would have stamped today's date on `updated_at` for
-- every row — and `updated_at` is currently the evidence that 43 of them have
-- not been touched since February and the 44th stopped in April. A migration
-- that makes dead rows look freshly maintained destroys the measurement that
-- justifies calling them dead. It is the same shape as rule 10's other half: it
-- would have said something happened that did not.
--
-- The judgement goes in a COMMENT, which triggers nothing, and
-- `promoted_learning_id` is a real column because it is written one row at a
-- time by the promote path — where bumping `updated_at` is correct, since that
-- row really did change.
COMMENT ON TABLE agent_memory IS
  'RETIRED 2026-09-12 (migration 045). The HAMPTON orchestrator and its seven '
  'agent services are decommissioned: /opt/hosthampton/docker-compose.yml '
  'defines only nginx and website, app.hosthampton.com answers 520, and '
  'services/website references this table zero times. 43 rows were seeded '
  '2026-02-18..21; analytics.last_report was written daily by INTEL until '
  '2026-04-22. Kept, not dropped: the rows are hand-curated brand knowledge and '
  'agent_memory_history is their provenance. Some hold February prices and '
  'HoneyBook links, so nothing reads this into a prompt. The one door into the '
  'live learning loop is lib/agent/memoryImport.ts, which screens on the way '
  'in, lands the row in agent_learnings INACTIVE, and is screened again on read '
  'by loadActiveLearnings. See docs/phase-5-memory-learning.md.';

ALTER TABLE agent_memory ADD COLUMN IF NOT EXISTS promoted_learning_id uuid;
COMMENT ON COLUMN agent_memory.promoted_learning_id IS
  'Set when a human promoted this row into agent_learnings. The learning is '
  'still INACTIVE on arrival — promoting is not activating.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agent_memory_promoted_learning_fkey'
  ) THEN
    ALTER TABLE agent_memory
      ADD CONSTRAINT agent_memory_promoted_learning_fkey
      FOREIGN KEY (promoted_learning_id) REFERENCES agent_learnings(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
