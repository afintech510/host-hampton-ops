-- Migration 051 — whose fundraiser order is this?
--
-- `cm_cheer_orders` has carried 21 real orders with no column saying which team
-- they belong to, because there has only ever been one real team on it. The ESM
-- Sharks are the second. Without this column their orders would land in the CM
-- Cheer organizer dashboard, be exported in the CM Cheer CSV, and be counted in
-- the CM Cheer "total raised" figure — three wrong numbers in front of two
-- different sets of parent volunteers.
--
-- Two halves:
--   1. `team`, defaulted and backfilled to 'cm-cheer' so every existing row is
--      labelled correctly and the two pages that do not send the field keep
--      working unchanged.
--   2. The order-ref trigger learns a second prefix. It is REPLACED rather than
--      dropped, and the 'cm-cheer' branch is byte-identical to what is live, so
--      an existing order's numbering is untouched: CMC-0022 still follows
--      CMC-0021. The Sharks get their own sequence starting at ESM-0001 — a
--      shared sequence would leak how many orders the other team has taken.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.cm_cheer_orders
  ADD COLUMN IF NOT EXISTS team text NOT NULL DEFAULT 'cm-cheer';

-- The DEFAULT above already backfilled the existing rows; this is belt-and-braces
-- for a re-run against a table where the column was added some other way.
UPDATE public.cm_cheer_orders
   SET team = 'cm-cheer'
 WHERE team IS NULL OR btrim(team) = '';

-- An unknown team is a row that appears in NO dashboard, which is the failure
-- this migration exists to prevent — so the database refuses it outright rather
-- than trusting the API's allow-list to be the only gate (the API's copy is
-- lib/fundraiserTeams.ts).
ALTER TABLE public.cm_cheer_orders
  DROP CONSTRAINT IF EXISTS cm_cheer_orders_team_check;
ALTER TABLE public.cm_cheer_orders
  ADD CONSTRAINT cm_cheer_orders_team_check
  CHECK (team IN ('cm-cheer', 'esm-sharks'));

-- Every dashboard read is `where team = ? order by created_at desc`.
CREATE INDEX IF NOT EXISTS cm_cheer_orders_team_created_idx
  ON public.cm_cheer_orders (team, created_at DESC);

CREATE SEQUENCE IF NOT EXISTS public.esm_sharks_order_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_cm_cheer_order_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.order_ref IS NULL OR NEW.order_ref = '' THEN
    IF NEW.team = 'esm-sharks' THEN
      NEW.order_ref := 'ESM-' || LPAD(nextval('esm_sharks_order_seq')::text, 4, '0');
    ELSE
      NEW.order_ref := 'CMC-' || LPAD(nextval('cm_cheer_order_seq')::text, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;
