-- Migration 071 — job applications from /join-the-team.
--
-- (The careers plan, docs/careers-page-plan.md, calls this "migration 070". 070
-- was taken the same day by the evite template choice — `evites.template_choice`,
-- applied live — so this is 071. The plan's number was a reservation nobody made.)
--
-- ── WHY A TABLE OF ITS OWN ──
--
-- An applicant is NOT a lead. Every other public form on this site goes through
-- `upsertContact`, which mirrors the person into Brevo (the marketing list), into
-- Quo (the SMS contacts), enrols them in a sequence, and — through
-- `recordInboundEvent` — hands their message to the booking agent to draft a
-- reply about a party. A job applicant who landed there would be marketed party
-- packages and answered by a model that thinks they want to book a birthday.
-- So `/api/careers/apply` writes here and nowhere else, and the tripwire in
-- publicIntakeSurface.test.ts fails if it ever reaches for the lead machinery.
--
-- ── WHAT IS DELIBERATE ──
--
--   1. Every enumerated answer has a CHECK. The route has its own copy of each
--      list (lib/careers.ts) for the same reason migration 059 does: a value that
--      passes the route but not the constraint is a row no screen knows how to
--      render, and the constraint is what holds when the route is wrong.
--
--   2. `is_18_plus` is NOT NULL and CHECKed TRUE. Adam, 2026-10-11: 18+ for both
--      roles. The form refuses an under-18 answer before it submits anything, and
--      the route refuses it again; the database is the third door, so a row in
--      this table is a statement that the applicant said they are 18 or older.
--
--   3. "Willing to learn hair tinsel, braiding and nail painting" is the one hard
--      requirement for a Helper (every party has them; we train). It is a CHECK
--      too: a Helper or Either row with `will_learn_beauty` not true cannot exist.
--
--   4. `portfolio_url` must be https. The route screens it with the same parser
--      every outbound mail link goes through (lib/content/contentSafety.ts) before
--      it is stored or mailed; the CHECK is the shape, not the screen.
--
--   5. `reviewed_at` is stamped by the trigger the first time `status` leaves
--      'new', so "how long did this applicant wait" is a fact on the row rather
--      than something the admin route has to remember to write.
--
-- Safe to re-run.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.job_application_ref_seq START 1;

CREATE TABLE IF NOT EXISTS public.job_applications (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_ref         text NOT NULL DEFAULT ('HHJ-' || lpad(nextval('public.job_application_ref_seq')::text, 4, '0')),

  -- Everyone.
  role_interest           text NOT NULL,          -- lead | helper | either
  name                    text NOT NULL,
  email                   text NOT NULL,
  phone                   text NOT NULL,
  is_18_plus              boolean NOT NULL,
  weekend_availability    text NOT NULL,          -- every | most | occasional
  weekday_availability    text,                   -- yes | sometimes | no
  has_car                 boolean,                -- asked, NOT required (Adam, 2026-10-11)
  heard_about             text,
  heard_about_detail      text,                   -- free text when heard_about = 'other'
  why_us                  text,

  -- Party Lead (and Either).
  hospitality_experience  text,
  lead_comfort_rating     smallint,               -- managing parents, directing a team, 1–5
  decorating_experience   text,
  balloon_experience      text,                   -- yes | some | no
  portfolio_url           text,

  -- Party Helper (and Either).
  kids_experience         text,
  activity_comfort_rating smallint,               -- leading group activities, 1–5
  crafts_experience       text,                   -- yes | some | no
  braiding_experience     text,
  tinsel_experience       text,
  nails_experience        text,
  will_learn_beauty       boolean,

  -- First touch, screened at entry by lib/attribution.ts — which job board
  -- actually produces applicants is the question the ad spend will ask.
  attribution             jsonb,

  -- Adam's side.
  status                  text NOT NULL DEFAULT 'new',
  admin_notes             text,
  reviewed_at             timestamptz,

  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_ref_key;
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_ref_key UNIQUE (application_ref);

ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_role_interest_check;
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_role_interest_check
  CHECK (role_interest IN ('lead', 'helper', 'either'));

ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_is_18_plus_check;
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_is_18_plus_check
  CHECK (is_18_plus);

ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_weekend_check;
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_weekend_check
  CHECK (weekend_availability IN ('every', 'most', 'occasional'));

ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_weekday_check;
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_weekday_check
  CHECK (weekday_availability IS NULL OR weekday_availability IN ('yes', 'sometimes', 'no'));

ALTER TABLE public.job_applications
  DROP CONSTRAINT IF EXISTS job_applications_heard_about_check;
ALTER TABLE public.job_applications
  ADD CONSTRAINT job_applications_heard_about_check
  CHECK (heard_about IS NULL OR heard_about IN ('indeed', 'instagram', 'facebook', 'friend', 'been_to_party', 'other'));

-- Every yes / some / no answer, one constraint each so a refusal names the column.
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_balloon_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_balloon_check
  CHECK (balloon_experience IS NULL OR balloon_experience IN ('yes', 'some', 'no'));
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_crafts_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_crafts_check
  CHECK (crafts_experience IS NULL OR crafts_experience IN ('yes', 'some', 'no'));
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_braiding_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_braiding_check
  CHECK (braiding_experience IS NULL OR braiding_experience IN ('yes', 'some', 'no'));
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_tinsel_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_tinsel_check
  CHECK (tinsel_experience IS NULL OR tinsel_experience IN ('yes', 'some', 'no'));
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_nails_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_nails_check
  CHECK (nails_experience IS NULL OR nails_experience IN ('yes', 'some', 'no'));

-- Both 1–5 ratings.
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_lead_rating_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_lead_rating_check
  CHECK (lead_comfort_rating IS NULL OR lead_comfort_rating BETWEEN 1 AND 5);
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_activity_rating_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_activity_rating_check
  CHECK (activity_comfort_rating IS NULL OR activity_comfort_rating BETWEEN 1 AND 5);

-- The Helper must-have (see header, point 3).
ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_will_learn_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_will_learn_check
  CHECK (role_interest = 'lead' OR will_learn_beauty IS TRUE);

ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_portfolio_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_portfolio_check
  CHECK (portfolio_url IS NULL OR portfolio_url ~ '^https://');

ALTER TABLE public.job_applications DROP CONSTRAINT IF EXISTS job_applications_status_check;
ALTER TABLE public.job_applications ADD CONSTRAINT job_applications_status_check
  CHECK (status IN ('new', 'contacted', 'interviewing', 'hired', 'declined'));

CREATE INDEX IF NOT EXISTS idx_job_applications_created
  ON public.job_applications (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_applications_role_status
  ON public.job_applications (role_interest, status);

-- "Has this person applied before?" must not depend on capitals (link 30).
CREATE INDEX IF NOT EXISTS idx_job_applications_email_lower
  ON public.job_applications (lower(email));

-- ── updated_at, and reviewed_at on the first move off 'new' ─────────────────
CREATE OR REPLACE FUNCTION public.touch_job_applications()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  IF NEW.status <> 'new' AND OLD.reviewed_at IS NULL AND NEW.reviewed_at IS NULL THEN
    NEW.reviewed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS job_applications_touch ON public.job_applications;
CREATE TRIGGER job_applications_touch
  BEFORE UPDATE ON public.job_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_job_applications();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Copied from migration 059 (market_vendors). There is NO public policy: these
-- rows are strangers' names, phone numbers and work histories, and there is no
-- browser Supabase client on this site — the only readers are the service role
-- (the API routes) and an admin.
ALTER TABLE public.job_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on job_applications" ON public.job_applications;
CREATE POLICY "Service role full access on job_applications"
  ON public.job_applications
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin full access job_applications" ON public.job_applications;
CREATE POLICY "Admin full access job_applications"
  ON public.job_applications
  USING (is_owner_or_admin())
  WITH CHECK (is_owner_or_admin());

COMMIT;
