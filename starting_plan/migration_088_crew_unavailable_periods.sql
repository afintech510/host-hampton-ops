-- Migration 088 — crew unavailable periods (2026-11-05).
--
-- The crew availability page is now "pick a start and an end (date and time) and add it".
-- A period is a real interval, so it cannot be stored as the day / part-of-day rows in
-- crew_unavailability. Those tables are left in place and still enforced (both held zero
-- rows when this was written); this is the one the page writes.
--
-- A party is blocked for a member when a period overlaps the party's own window:
--   starts_at < party.ends_at AND ends_at > party.starts_at
--
-- Additive. Nothing is sent.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.crew_unavailable_periods (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  starts_at  timestamptz NOT NULL,
  ends_at    timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_unavailable_periods_order_check CHECK (ends_at > starts_at)
);
CREATE INDEX IF NOT EXISTS idx_crew_unavail_periods_member ON public.crew_unavailable_periods(member_id, ends_at);
CREATE INDEX IF NOT EXISTS idx_crew_unavail_periods_range  ON public.crew_unavailable_periods(starts_at, ends_at);

ALTER TABLE public.crew_unavailable_periods ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_unavailable_periods FROM anon, authenticated;
GRANT ALL ON public.crew_unavailable_periods TO service_role;

COMMENT ON TABLE public.crew_unavailable_periods IS 'A member''s "I can''t work" windows, start to end (migration 088). Overlap with a party window blocks it.';

COMMIT;
