-- Migration 075 — a troop schedule item may have no start time yet.
--
-- Allie's first real schedule (2026-10-22) had three dates whose time is not
-- known yet: the Rockettes show, the gingerbread house competition and the
-- Islanders game. Inventing a time for a page parents plan around is worse than
-- saying so, so a NULL start_time now reads "Time TBA" on /troop2514 and the
-- calendar link becomes an all-day entry.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.troop_schedule ALTER COLUMN start_time DROP NOT NULL;

-- An end time without a start time says nothing.
ALTER TABLE public.troop_schedule DROP CONSTRAINT IF EXISTS troop_schedule_end_needs_start_check;
ALTER TABLE public.troop_schedule ADD CONSTRAINT troop_schedule_end_needs_start_check
  CHECK (end_time IS NULL OR start_time IS NOT NULL);

COMMIT;
