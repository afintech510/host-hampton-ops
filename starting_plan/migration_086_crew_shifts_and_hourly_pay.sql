-- Migration 086 — crew shifts and hourly pay (launch MVP follow-up, 2026-11-05).
--
-- Adam: pay is set PER PERSON, PER HOUR, and is never shown openly on the roster; the
-- shift on a party is adjustable and defaults to 30 minutes before the party to 30
-- after, with the Party Lead arriving an hour before.
--
--   crew_members.hourly_rate_cents   private, per person; read only by the admin member
--                                    editor (as a yes/no) and never by a crew route.
--   crew_parties.shift_starts_at     crew start override (NULL = party start - shift.setup_minutes)
--   crew_parties.shift_ends_at       shift end override  (NULL = party end + shift.cleanup_minutes)
--   crew_parties.lead_starts_at      Party Lead start override (NULL = party start - shift.lead_setup_minutes)
--   crew_settings 'shift'            gains lead_setup_minutes = 60
--
-- Additive and nullable. Nothing is sent. The old step columns are left alone.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run.

BEGIN;

ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS hourly_rate_cents integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'crew_members_hourly_rate_check') THEN
    ALTER TABLE public.crew_members ADD CONSTRAINT crew_members_hourly_rate_check
      CHECK (hourly_rate_cents IS NULL OR (hourly_rate_cents >= 0 AND hourly_rate_cents <= 20000));
  END IF;
END $$;

ALTER TABLE public.crew_parties ADD COLUMN IF NOT EXISTS shift_starts_at timestamptz;
ALTER TABLE public.crew_parties ADD COLUMN IF NOT EXISTS shift_ends_at   timestamptz;
ALTER TABLE public.crew_parties ADD COLUMN IF NOT EXISTS lead_starts_at  timestamptz;

COMMENT ON COLUMN public.crew_members.hourly_rate_cents IS 'Private pay per hour, in cents. Admin-only (migration 086).';
COMMENT ON COLUMN public.crew_parties.shift_starts_at IS 'Crew shift start override; NULL = the default from crew_settings.shift (migration 086).';
COMMENT ON COLUMN public.crew_parties.shift_ends_at   IS 'Shift end override; NULL = party end + cleanup (migration 086).';
COMMENT ON COLUMN public.crew_parties.lead_starts_at  IS 'Party Lead start override; NULL = party start - lead_setup_minutes (migration 086).';

UPDATE public.crew_settings
   SET value = value || '{"lead_setup_minutes": 60}'::jsonb
 WHERE key = 'shift' AND NOT (value ? 'lead_setup_minutes');

SELECT key, value FROM public.crew_settings WHERE key = 'shift';

COMMIT;
