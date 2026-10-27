-- Migration 080 — crew admin (Phase 3): who changed it.
--
-- Every /api/admin/crew/* write records `adminActorId(req)` (prompt 04): the
-- signed-in admin's `admin:<email>`, or the historical `ADMIN` on the shared
-- password. Three of the crew tables Allie edits from /admin/crew had nowhere
-- to put that:
--
--   crew_parties   publish / unpublish, extra pay, notes, spot count, Sync now
--   crew_members   the roster form (steps themselves are in crew_events.created_by)
--   crew_settings  the rules editor
--
-- `crew_slots.assigned_by` and `crew_events.created_by` already exist (077).
-- The reconcile writes `system:crew-sync`, or the admin who pressed Sync now.
--
-- Additive, nullable, no default, no backfill: an existing row's actor is
-- genuinely unknown, and NULL says so.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run.

BEGIN;

ALTER TABLE public.crew_parties  ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE public.crew_members  ADD COLUMN IF NOT EXISTS updated_by text;
ALTER TABLE public.crew_settings ADD COLUMN IF NOT EXISTS updated_by text;

COMMENT ON COLUMN public.crew_parties.updated_by  IS 'adminActorId of the last admin write, or system:crew-sync (migration 080).';
COMMENT ON COLUMN public.crew_members.updated_by  IS 'adminActorId of the last admin write (migration 080).';
COMMENT ON COLUMN public.crew_settings.updated_by IS 'adminActorId of the last rules edit (migration 080).';

COMMIT;

-- Proof.
SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'updated_by' AND table_name IN ('crew_parties', 'crew_members', 'crew_settings')
 ORDER BY table_name;
