-- ══════════════════════════════════════════════════════════════
-- Migration 021: Marketing Graph — "graph as data, not as runtime"
--
--   State lives in Postgres rows; the ONLY way status changes is the
--   advance() transition function in src/lib/marketing/graph.ts, which
--   writes one append-only marketing_ledger row per transition.
--
--   Three tables:
--     marketing_tasks   — checkpointed work items (lean re-cut of the
--                         dormant agent_tasks: task_type + JSONB context
--                         /output + approval_tier + status).
--     marketing_ledger  — append-only audit log: every transition, send,
--                         and LLM call (with cost/tokens). UPDATE/DELETE
--                         are blocked by a trigger.
--     marketing_budget  — per-month LLM spend + SMS send counters and
--                         caps. Incremented BEFORE every gated action.
--
-- Salvaged from the dormant HAMPTON stack: the approval-tier taxonomy
-- (AUTO_EXECUTE / DRAFT_AND_SHOW / ALWAYS_ASK) and the task-manifest
-- JSONB shape. NOT salvaged: the Redis/worker runtime.
--
-- Run via Supabase SQL editor. Idempotent. Run by hand — do NOT
-- auto-apply.
-- ══════════════════════════════════════════════════════════════

-- ── marketing_tasks ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- e.g. 'landing_page', 'newsletter', 'fb_reply', 'directory_listing',
  -- 'prospecting', 'consent_release'. Free-form so new workstreams don't
  -- need a migration.
  task_type        TEXT NOT NULL,
  title            TEXT NOT NULL,

  -- AUTO_EXECUTE  — owner-pre-approved template, merge fields only
  -- DRAFT_AND_SHOW— draft surfaced but NOT auto-executed (timeout dropped)
  -- ALWAYS_ASK    — requires an authenticated admin to advance
  approval_tier    TEXT NOT NULL DEFAULT 'ALWAYS_ASK'
                     CHECK (approval_tier IN ('AUTO_EXECUTE', 'DRAFT_AND_SHOW', 'ALWAYS_ASK')),

  -- Lifecycle. advance() is the only writer; illegal transitions throw.
  status           TEXT NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft', 'pending_review', 'approved',
                                       'rejected', 'executing', 'done', 'escalated')),

  -- Inputs/params for the node that produces this task's output.
  context          JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Produced artifact (draft copy, reply text, listing payload, ...).
  output           JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Optional link to the entity this task acts on (e.g. a website_content
  -- row). entity_type is a plain label, not an FK, so any table qualifies.
  entity_type      TEXT,
  entity_id        UUID,

  reviewed_by      TEXT,
  reviewed_at      TIMESTAMPTZ,
  rejection_reason TEXT,

  created_by       TEXT NOT NULL DEFAULT 'system',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_tasks_status    ON public.marketing_tasks(status);
CREATE INDEX IF NOT EXISTS idx_marketing_tasks_type      ON public.marketing_tasks(task_type);
CREATE INDEX IF NOT EXISTS idx_marketing_tasks_tier      ON public.marketing_tasks(approval_tier);
CREATE INDEX IF NOT EXISTS idx_marketing_tasks_entity    ON public.marketing_tasks(entity_type, entity_id);

CREATE OR REPLACE FUNCTION update_marketing_tasks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS marketing_tasks_updated_at ON public.marketing_tasks;
CREATE TRIGGER marketing_tasks_updated_at
  BEFORE UPDATE ON public.marketing_tasks
  FOR EACH ROW EXECUTE FUNCTION update_marketing_tasks_updated_at();


-- ── marketing_ledger (append-only) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_ledger (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- What this row is about (e.g. 'marketing_task', 'website_content',
  -- 'consent_release', 'reminder', 'budget', 'ingestion_run').
  entity_type  TEXT NOT NULL,
  entity_id    UUID,

  -- 'transition' | 'send' | 'llm_call' | 'note'
  action       TEXT NOT NULL,

  -- Who caused it: an admin identifier, 'cron', 'system', an LLM node name.
  actor        TEXT NOT NULL DEFAULT 'system',

  -- For transitions.
  from_status  TEXT,
  to_status    TEXT,

  -- For llm_call rows (nullable elsewhere).
  cost_usd     NUMERIC(12,6),
  tokens       INTEGER,

  meta         JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketing_ledger_entity  ON public.marketing_ledger(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_marketing_ledger_action  ON public.marketing_ledger(action);
CREATE INDEX IF NOT EXISTS idx_marketing_ledger_created ON public.marketing_ledger(created_at DESC);

-- Enforce append-only at the DB layer: block UPDATE and DELETE.
CREATE OR REPLACE FUNCTION marketing_ledger_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'marketing_ledger is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS marketing_ledger_no_update ON public.marketing_ledger;
CREATE TRIGGER marketing_ledger_no_update
  BEFORE UPDATE ON public.marketing_ledger
  FOR EACH ROW EXECUTE FUNCTION marketing_ledger_append_only();

DROP TRIGGER IF EXISTS marketing_ledger_no_delete ON public.marketing_ledger;
CREATE TRIGGER marketing_ledger_no_delete
  BEFORE DELETE ON public.marketing_ledger
  FOR EACH ROW EXECUTE FUNCTION marketing_ledger_append_only();


-- ── marketing_budget ───────────────────────────────────────────
-- One row per calendar month (UTC), keyed 'YYYY-MM'. budget.ts upserts
-- the current month, increments the counter, THEN checks the cap.
CREATE TABLE IF NOT EXISTS public.marketing_budget (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month          TEXT NOT NULL UNIQUE,               -- 'YYYY-MM'

  llm_usd_spent  NUMERIC(12,6) NOT NULL DEFAULT 0,
  llm_usd_cap    NUMERIC(12,6) NOT NULL DEFAULT 25,  -- monthly LLM ceiling ($)

  sms_sent       INTEGER NOT NULL DEFAULT 0,
  sms_cap        INTEGER NOT NULL DEFAULT 500,       -- monthly marketing-SMS ceiling

  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_marketing_budget_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS marketing_budget_updated_at ON public.marketing_budget;
CREATE TRIGGER marketing_budget_updated_at
  BEFORE UPDATE ON public.marketing_budget
  FOR EACH ROW EXECUTE FUNCTION update_marketing_budget_updated_at();

-- Verify
SELECT 'marketing_tasks'  AS table_name, count(*) AS rows FROM public.marketing_tasks
UNION ALL SELECT 'marketing_ledger', count(*) FROM public.marketing_ledger
UNION ALL SELECT 'marketing_budget', count(*) FROM public.marketing_budget;
