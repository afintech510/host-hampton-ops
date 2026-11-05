-- Migration 084 — crew autopilot (launch MVP, 2026-11-05): the settings it reads.
--
-- Data, not schema: one new `crew_settings` key, because the rules editor
-- updates a row and an update that matches nothing is "missing from the
-- database" (api/admin/crew/settings). Without this row the code falls back to
-- its own defaults (auto-publish OFF, 10/5/5 days) and publishes nothing.
--
--   auto_publish            publish the reconcile's new booked parties by themselves
--   auto_publish_from       only parties CREATED on or after this Eastern date, so the
--                           drafts that already exist stay drafts until Adam publishes them
--   nudge_first_days_before / nudge_second_days_before
--                           free crew are asked again about a party with open spots
--   understaffed_days_before
--                           the one manager touch: Allie is told a party is still short
--
-- Everything autopilot does runs only with CREW_ENABLED=true; this row alone
-- sends nothing and publishes nothing.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run (ON CONFLICT DO NOTHING keeps any value Allie has since set).

BEGIN;

INSERT INTO public.crew_settings (key, value, description) VALUES
  ('autopilot',
   '{"auto_publish": true, "auto_publish_from": "2026-11-04", "nudge_first_days_before": 10, "nudge_second_days_before": 5, "understaffed_days_before": 5}',
   'Autopilot. New booked parties are published by themselves (only those created on or after auto_publish_from). Free crew are re-asked about open spots at the two nudge marks. Allie is emailed once if a party is still short of crew understaffed_days_before days out (a missing Lead at the Lead alert days if earlier).')
ON CONFLICT (key) DO NOTHING;

SELECT key, value FROM public.crew_settings WHERE key = 'autopilot';

COMMIT;
