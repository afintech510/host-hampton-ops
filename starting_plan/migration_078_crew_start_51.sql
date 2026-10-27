-- Migration 078 — crew start rate $51 a party (Adam, 2026-10-26).
--
-- 077 seeded `crew_settings.pay.crew_start_cents = 5000`. Adam moved it to
-- 5100 so a typical 3-hour party pays $17.00/hr at step 0, the 2026 Long
-- Island minimum ($50 was $16.67). Crew now run $51 → $71; the Lead stays
-- $70 → $90. `rules.ts` DEFAULT_SETTINGS says 5100 to match.
--
-- Data, not schema. It changes the value ONLY while it is still the 077 seed,
-- so it can never overwrite a rate Allie has since set in /admin/crew/rules.
-- Safe to re-run.

BEGIN;

UPDATE public.crew_settings
   SET value = jsonb_set(value, '{crew_start_cents}', '5100'::jsonb),
       description = 'Flat pay per party. Rate = start + steps x step_cents. Crew start $51 (Adam, 2026-10-26: $17/hr for a 3-hour party). Tips are topped up to tip_floor_cents per person (a Host Hampton cost). max_steps cannot exceed 8.'
 WHERE key = 'pay' AND (value->>'crew_start_cents')::int = 5000;

COMMIT;

SELECT value->>'crew_start_cents' AS crew_start_cents, value->>'lead_start_cents' AS lead_start_cents
  FROM public.crew_settings WHERE key = 'pay';
