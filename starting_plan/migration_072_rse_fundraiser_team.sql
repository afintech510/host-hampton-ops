-- Migration 072 — a third fundraiser on `cm_cheer_orders`: RSE merch.
--
-- Remsenburg-Speonk Elementary (`/rse-merch`) is the third storefront on the
-- table, after CM Cheer and the ESM Sharks. Migration 051 is the template, and
-- the same two halves apply:
--   1. The `team` CHECK learns 'rse'. An unknown team is a row that appears in
--      no dashboard, so the database refuses it rather than trusting the API's
--      allow-list (lib/fundraiserTeams.ts) to be the only gate.
--   2. The order-ref trigger learns a third prefix, 'RSE-', from its own
--      sequence — a shared one would tell one school how many orders the other
--      has taken. The 'esm-sharks' and default branches are byte-identical to
--      what is live (checked with pg_get_functiondef on 2026-10-13), so the next
--      CMC- and ESM- numbers are untouched.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.cm_cheer_orders
  DROP CONSTRAINT IF EXISTS cm_cheer_orders_team_check;
ALTER TABLE public.cm_cheer_orders
  ADD CONSTRAINT cm_cheer_orders_team_check
  CHECK (team IN ('cm-cheer', 'esm-sharks', 'rse'));

CREATE SEQUENCE IF NOT EXISTS public.rse_order_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_cm_cheer_order_ref()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.order_ref IS NULL OR NEW.order_ref = '' THEN
    IF NEW.team = 'esm-sharks' THEN
      NEW.order_ref := 'ESM-' || LPAD(nextval('esm_sharks_order_seq')::text, 4, '0');
    ELSIF NEW.team = 'rse' THEN
      NEW.order_ref := 'RSE-' || LPAD(nextval('rse_order_seq')::text, 4, '0');
    ELSE
      NEW.order_ref := 'CMC-' || LPAD(nextval('cm_cheer_order_seq')::text, 4, '0');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

COMMIT;

-- Proof: the CHECK names all three teams and the trigger mints RSE-.
SELECT pg_get_constraintdef(oid) AS team_check
  FROM pg_constraint WHERE conname = 'cm_cheer_orders_team_check';
SELECT position('RSE-' IN pg_get_functiondef('public.generate_cm_cheer_order_ref'::regproc)) > 0 AS trigger_mints_rse;
