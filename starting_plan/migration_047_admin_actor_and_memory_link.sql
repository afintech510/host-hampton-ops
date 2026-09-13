-- ============================================================================
-- Migration 047 — name the human on the money, and stop destroying the evidence
--                 that 44 memory rows are dead.
--
-- Link 18 of the build chain, 2026-09-12. Two unrelated concerns, both small,
-- both blocking a code change that is already written.
--
-- Re-runnable: every statement is guarded, and this file has been applied twice
-- in a row against production to prove it.
-- ============================================================================


-- ── 1. `booking_payments.recorded_by` and `booking_modifications.modified_by` ─
--
-- `adminActorId(req)` returns `admin:<email>` when a signed `hh_admin` session
-- names the human, and the historical anonymous `'ADMIN'` on the shared
-- password. Nine sessions have had to remove a hardcoded `'ADMIN'`/`'admin'`
-- from somewhere in this codebase; link 18 removed the last of them, including
-- the one on the row that records A CUSTOMER'S MONEY.
--
-- But both of these columns carry a CHECK that permits neither spelling:
--
--   booking_payments_recorded_by_check      IN ('system','admin')
--   booking_modifications_modified_by_check IN ('customer','admin','system')
--
-- So writing the real actor would have been refused 23514 on every admin
-- payment and every audit row — and note that the SHARED-PASSWORD path breaks
-- too, because `adminActorId` returns `'ADMIN'` in capitals and the CHECK is
-- lower case. Read out of `pg_constraint` before the code was written, not
-- after it failed in production (hard-won rule 13).
--
-- The old labels stay valid: 12 `booking_payments` rows and 151
-- `booking_modifications` rows already hold them, and a migration that
-- invalidates existing rows is a migration that will not apply.

ALTER TABLE booking_payments DROP CONSTRAINT IF EXISTS booking_payments_recorded_by_check;
ALTER TABLE booking_payments
  ADD CONSTRAINT booking_payments_recorded_by_check
  CHECK (
    recorded_by IN ('system', 'admin', 'ADMIN')
    OR recorded_by LIKE 'admin:%'
  );

ALTER TABLE booking_modifications DROP CONSTRAINT IF EXISTS booking_modifications_modified_by_check;
ALTER TABLE booking_modifications
  ADD CONSTRAINT booking_modifications_modified_by_check
  CHECK (
    modified_by IN ('customer', 'admin', 'system', 'ADMIN')
    OR modified_by LIKE 'admin:%'
  );


-- ── 2. `agent_learnings.source_memory_id` ───────────────────────────────────
--
-- Recorded by link 12 (`docs/phase-5-memory-learning.md` §11.13) and deliberately
-- left unexercised, because proving the finding destroys the evidence.
--
-- `promoteMemory()` writes the link between a promoted `agent_memory` row and the
-- `agent_learnings` row it became by UPDATEing `agent_memory.promoted_learning_id`.
-- `agent_memory` carries `trg_memory_updated_at`, an UNCONDITIONAL trigger, so
-- that UPDATE stamps `updated_at` with today's date — and `updated_at` is the
-- single column proving those 44 rows are dead (43 seeded 2026-02-18…21 and never
-- touched since, the 44th last written 2026-04-22). Migration 045 anticipated
-- this and argued the row "really did change"; link 12 reversed that call and it
-- is the right reversal: the row changed, the KNOWLEDGE did not, and making one
-- column carry both facts is rule 11's sharpest form.
--
-- The clean fix is the FK on the other side, which also makes the link readable
-- from either direction — which is what the code comment said it wanted all
-- along. `promoted_learning_id` is KEPT (it holds no rows today, but dropping a
-- column is not reversible and this migration is about preserving evidence).

ALTER TABLE agent_learnings
  ADD COLUMN IF NOT EXISTS source_memory_id uuid
  REFERENCES agent_memory(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agent_learnings_source_memory
  ON agent_learnings (source_memory_id)
  WHERE source_memory_id IS NOT NULL;

COMMENT ON COLUMN agent_learnings.source_memory_id IS
  'The retired agent_memory row a human promoted into this learning. Written at '
  'INSERT time so that promoting a memory never UPDATEs agent_memory, whose '
  'unconditional updated_at trigger would destroy the evidence that those rows '
  'are dead. See docs/phase-5-memory-learning.md §11.13 and migration 047.';


-- ── Verification (read-only; safe to re-run) ────────────────────────────────
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conname IN ('booking_payments_recorded_by_check', 'booking_modifications_modified_by_check')
     AND pg_get_constraintdef(oid) LIKE '%admin:%';
  IF n <> 2 THEN
    RAISE EXCEPTION 'migration 047: expected 2 relaxed actor CHECKs, found %', n;
  END IF;

  SELECT count(*) INTO n FROM information_schema.columns
   WHERE table_name = 'agent_learnings' AND column_name = 'source_memory_id';
  IF n <> 1 THEN
    RAISE EXCEPTION 'migration 047: agent_learnings.source_memory_id missing';
  END IF;

  RAISE NOTICE 'migration 047 OK: actor CHECKs relaxed, source_memory_id present';
END $$;
