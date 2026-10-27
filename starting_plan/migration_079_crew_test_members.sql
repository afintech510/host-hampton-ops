-- Migration 079 — ten made-up crew members for testing (Adam, 2026-10-26).
--
-- Adam: "populate with random 10 women for testing, just let me click a person
-- to login." These are invented people, not the real crew: no phone numbers
-- (so nothing can ever text a stranger), and every email is a plus-address on
-- the business test inbox (hosthampton295+crew-<name>@gmail.com).
--
-- `is_test` marks them. It is what the Phase 2 click-to-log-in picker is
-- allowed to act as, and NOTHING ELSE — a password-free login on a public site
-- must never be able to become a real crew member. A test row can never be the
-- owner. Delete them before launch:
--   DELETE FROM public.crew_members WHERE is_test;   (cascades their slots' events etc.)
--
-- Safe to re-run: each row is inserted only if its email_key is absent.

BEGIN;

ALTER TABLE public.crew_members ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
ALTER TABLE public.crew_members DROP CONSTRAINT IF EXISTS crew_members_test_not_owner_check;
ALTER TABLE public.crew_members ADD CONSTRAINT crew_members_test_not_owner_check CHECK (NOT (is_test AND is_owner));

INSERT INTO public.crew_members (first_name, last_name, email, steps, can_lead, skills, email_opt_in, sms_opt_in, is_test)
SELECT v.first_name, v.last_name, v.email, v.steps, v.can_lead, v.skills, false, false, true
FROM (VALUES
  ('Ava',      'Martinez', 'hosthampton295+crew-ava@gmail.com',      6, true,  ARRAY['Hair (braids/tinsel/styling)', 'Nails', 'Has a car']),
  ('Mia',      'Thompson', 'hosthampton295+crew-mia@gmail.com',      3, false, ARRAY['Arts & crafts', 'Face painting']),
  ('Sophia',   'Nguyen',   'hosthampton295+crew-sophia@gmail.com',   8, true,  ARRAY['Hair (braids/tinsel/styling)', 'POS/card machine', 'Balloon arch/garland', 'Has a car']),
  ('Isabella', 'Rossi',    'hosthampton295+crew-isabella@gmail.com', 0, false, ARRAY['Nails']),
  ('Emma',     'Walsh',    'hosthampton295+crew-emma@gmail.com',     2, false, ARRAY['Photo booth setup', 'Deep clean floors']),
  ('Olivia',   'Brennan',  'hosthampton295+crew-olivia@gmail.com',   5, true,  ARRAY['Arts & crafts', 'Hair (braids/tinsel/styling)', 'Has a car']),
  ('Chloe',    'Patel',    'hosthampton295+crew-chloe@gmail.com',    1, false, ARRAY['Face painting', 'Arts & crafts']),
  ('Grace',    'Kowalski', 'hosthampton295+crew-grace@gmail.com',    4, false, ARRAY['Balloon arch/garland', 'Deep clean floors']),
  ('Lily',     'Okafor',   'hosthampton295+crew-lily@gmail.com',     7, false, ARRAY['Nails', 'Hair (braids/tinsel/styling)', 'POS/card machine']),
  ('Zoe',      'Haddad',   'hosthampton295+crew-zoe@gmail.com',      0, false, ARRAY[]::text[])
) AS v(first_name, last_name, email, steps, can_lead, skills)
WHERE NOT EXISTS (SELECT 1 FROM public.crew_members m WHERE m.email_key = lower(btrim(v.email)));

COMMIT;

SELECT count(*) FILTER (WHERE is_test) AS test_members,
       count(*) FILTER (WHERE is_test AND can_lead) AS test_leads,
       count(*) FILTER (WHERE is_owner) AS owner_rows,
       count(*) FILTER (WHERE is_test AND phone IS NOT NULL) AS test_with_phone
  FROM public.crew_members;
