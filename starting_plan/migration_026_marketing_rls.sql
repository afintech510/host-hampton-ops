-- ══════════════════════════════════════════════════════════════
-- migration_026_marketing_rls.sql
--
--   SECURITY FIX. Migrations 020/021 created four marketing tables in the
--   PUBLIC schema (exposed to PostgREST) WITHOUT enabling Row Level Security.
--   Supabase's own security advisor flags this ERROR-level (rule 0013): the
--   anon and authenticated API keys can currently read/write these tables
--   directly via /rest/v1. This migration closes that hole by enabling RLS
--   and attaching owner/admin + service_role policies IDENTICAL to the ones
--   migration_024 already put on public.ingested_messages.
--
--   Tables fixed:
--     consent_releases, marketing_tasks, marketing_ledger, marketing_budget
--
--   Policy model (mirrors ingested_messages):
--     - only_owner_manages_<t>: ALL, USING/WITH CHECK current_user_role() IN ('owner','admin')
--     - service_role_full_access_<t>: ALL, USING/WITH CHECK auth.role() = 'service_role'
--   The server (service-role key) keeps full access; admin UI sessions
--   (current_user_role owner/admin) keep full access; anon/authenticated get none.
--
--   NOTE on marketing_ledger: it also has a BEFORE UPDATE/DELETE append-only
--   trigger (migration_021). RLS is orthogonal — the trigger still blocks
--   mutation of existing rows; these policies only govern row visibility and
--   INSERT. No conflict.
--
--   Idempotent: ENABLE RLS is a no-op if already on; policies are dropped
--   IF EXISTS then recreated. Apply BY HAND in the Supabase SQL editor.
--
--   ⚠️ AFTER APPLYING: load the admin Marketing tab and confirm the approval
--   queue, budget, and ledger still render (i.e. the admin session resolves to
--   current_user_role() IN ('owner','admin')). If the tab goes blank, the app
--   is reading these tables with a key that isn't owner/admin/service_role —
--   do NOT drop RLS; fix the read path. Re-run `get_advisors(security)` after:
--   the four rls_disabled_in_public ERRORs should be gone.
-- ══════════════════════════════════════════════════════════════

-- ── consent_releases ──────────────────────────────────────────
ALTER TABLE public.consent_releases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS only_owner_manages_consent_releases ON public.consent_releases;
CREATE POLICY only_owner_manages_consent_releases ON public.consent_releases
  FOR ALL TO public
  USING (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]));

DROP POLICY IF EXISTS service_role_full_access_consent_releases ON public.consent_releases;
CREATE POLICY service_role_full_access_consent_releases ON public.consent_releases
  FOR ALL TO public
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- ── marketing_tasks ───────────────────────────────────────────
ALTER TABLE public.marketing_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS only_owner_manages_marketing_tasks ON public.marketing_tasks;
CREATE POLICY only_owner_manages_marketing_tasks ON public.marketing_tasks
  FOR ALL TO public
  USING (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]));

DROP POLICY IF EXISTS service_role_full_access_marketing_tasks ON public.marketing_tasks;
CREATE POLICY service_role_full_access_marketing_tasks ON public.marketing_tasks
  FOR ALL TO public
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- ── marketing_ledger ──────────────────────────────────────────
ALTER TABLE public.marketing_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS only_owner_manages_marketing_ledger ON public.marketing_ledger;
CREATE POLICY only_owner_manages_marketing_ledger ON public.marketing_ledger
  FOR ALL TO public
  USING (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]));

DROP POLICY IF EXISTS service_role_full_access_marketing_ledger ON public.marketing_ledger;
CREATE POLICY service_role_full_access_marketing_ledger ON public.marketing_ledger
  FOR ALL TO public
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- ── marketing_budget ──────────────────────────────────────────
ALTER TABLE public.marketing_budget ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS only_owner_manages_marketing_budget ON public.marketing_budget;
CREATE POLICY only_owner_manages_marketing_budget ON public.marketing_budget
  FOR ALL TO public
  USING (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]));

DROP POLICY IF EXISTS service_role_full_access_marketing_budget ON public.marketing_budget;
CREATE POLICY service_role_full_access_marketing_budget ON public.marketing_budget
  FOR ALL TO public
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- ── Verify (run after) ────────────────────────────────────────
-- SELECT tablename, rowsecurity FROM pg_tables
--   WHERE schemaname='public'
--     AND tablename IN ('consent_releases','marketing_tasks','marketing_ledger','marketing_budget');
--   -- expect rowsecurity = true for all four
-- SELECT tablename, count(*) FROM pg_policies
--   WHERE schemaname='public'
--     AND tablename IN ('consent_releases','marketing_tasks','marketing_ledger','marketing_budget')
--   GROUP BY tablename;  -- expect 2 each
