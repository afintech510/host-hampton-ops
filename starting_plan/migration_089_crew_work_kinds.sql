-- Migration 089 — crew work that is not a party (2026-11-05).
--
-- Adam: "load other work scenarios besides parties: Clean Floor, Drop-off Event,
-- Balloon Decor, Party Setup, Retail Shift." They are crew_parties rows by hand
-- (no booking), so the only change is the list of kinds the CHECK allows.
-- lib/crew/workTypes.ts holds the same five names and must stay in step.
--
-- Additive: every existing row is one of the old four kinds. Nothing is sent.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run.

BEGIN;

ALTER TABLE public.crew_parties DROP CONSTRAINT IF EXISTS crew_parties_kind_check;
ALTER TABLE public.crew_parties ADD CONSTRAINT crew_parties_kind_check
  CHECK (party_kind IN (
    'in_studio_theme', 'mobile_party', 'studio_rental', 'manual',
    'clean_floor', 'dropoff_event', 'balloon_decor', 'party_setup', 'retail_shift'
  ));

COMMIT;
