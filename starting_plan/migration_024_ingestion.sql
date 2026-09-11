-- ══════════════════════════════════════════════════════════════
-- Migration 024: Historical message ingestion staging table
--
--   `ingested_messages` is a staging table for the Gmail/Grasshopper
--   historical mine (see plan doc "Data ingestion — historical
--   mining"). Raw message bodies stay server-side; RLS is owner/admin
--   only, matching the pattern on agent_credentials/contacts. Nothing
--   here feeds public content directly — reconciliation into
--   `contacts`/`bookings` happens app-side, and ambiguous extractions
--   land in `marketing_tasks` (migration_021) for review, not a
--   silent write.
--
--   external_id is UNIQUE so re-running an import pass is idempotent
--   (ON CONFLICT DO NOTHING at the insert site).
--
--   ingestion-run summaries (counts, errors) are NOT a separate table
--   — they're logged as rows in marketing_ledger (migration_021) with
--   entity_type = 'ingestion_run'.
--
--   Does NOT include prospect_orgs — that's separate scope (local
--   org/business prospecting), not part of this ingestion pass.
--
-- Run via Supabase SQL editor. Idempotent. Run by hand — do NOT
-- auto-apply. Depends on migration_021 (marketing_ledger) for run
-- logging and on public.contacts (reconciliation FK).
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.ingested_messages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  source       TEXT NOT NULL CHECK (source IN ('gmail', 'grasshopper')),

  -- Gmail message id / Grasshopper record id. UNIQUE = re-run safety.
  external_id  TEXT NOT NULL UNIQUE,

  direction    TEXT NOT NULL CHECK (direction IN ('in', 'out')),

  from_address TEXT,
  to_address   TEXT,
  sent_at      TIMESTAMPTZ,

  subject      TEXT,
  body         TEXT,
  thread_id    TEXT,

  -- Extracted fields (child_name, party_date, phone, etc.) pending
  -- reconciliation. Free-form so extraction logic can evolve.
  parsed       JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Set once reconciled into contacts (email/phone match, create-or-enrich).
  contact_id   UUID REFERENCES public.contacts(id) ON DELETE SET NULL,

  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingested_messages_source    ON public.ingested_messages(source);
CREATE INDEX IF NOT EXISTS idx_ingested_messages_contact   ON public.ingested_messages(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ingested_messages_sent_at   ON public.ingested_messages(sent_at);
CREATE INDEX IF NOT EXISTS idx_ingested_messages_thread    ON public.ingested_messages(thread_id) WHERE thread_id IS NOT NULL;

-- Raw bodies stay server-side. Owner/admin only, matching agent_credentials.
ALTER TABLE public.ingested_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS only_owner_manages_ingested_messages ON public.ingested_messages;
CREATE POLICY only_owner_manages_ingested_messages
  ON public.ingested_messages
  FOR ALL
  USING (current_user_role() = ANY (ARRAY['owner', 'admin']))
  WITH CHECK (current_user_role() = ANY (ARRAY['owner', 'admin']));

DROP POLICY IF EXISTS service_role_full_access_ingested_messages ON public.ingested_messages;
CREATE POLICY service_role_full_access_ingested_messages
  ON public.ingested_messages
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Verify
SELECT 'ingested_messages' AS table_name, count(*) AS rows FROM public.ingested_messages;
