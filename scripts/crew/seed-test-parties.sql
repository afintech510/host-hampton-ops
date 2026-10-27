-- Six THROWAWAY crew parties for clicking through the crew app (Phase 2).
--
-- There is no admin UI until Phase 3, so this gives the test crew (migration
-- 079, `is_test`) something to see: open spots, a full party to stand by on,
-- "My parties", teammates and a confirm prompt.
--
--   * party_kind 'manual', booking_id NULL: no customer booking behind any of them;
--   * every title starts "TEST — " and the location says it is not a real booking;
--   * published, over the next ~3 weeks, dated from TODAY in Eastern time;
--   * spots = slotRolesFor(slotsForParty({ guestCount })) at the default settings
--     (lib/crew/rules.ts: max(3, ceil(kids/4)), capped at 10, one Lead):
--       10 kids → 3, 14 → 4, 18 → 5, unknown → 3, 8 → 3, 22 → 6;
--   * some spots already held by TEST members only (assigned_via 'admin', i.e.
--     "Allie put you on it", so Undo is not offered on those; claim one yourself
--     to see Undo).
--
-- RE-RUNNABLE: a party whose title already exists is skipped whole, so a second
-- run changes nothing and keeps whatever you clicked in between.
--
-- Apply:   ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < scripts/crew/seed-test-parties.sql
--
-- REMOVE (before launch; cascades their spots, standbys and cover requests):
--   DELETE FROM public.crew_parties
--    WHERE party_kind = 'manual' AND booking_id IS NULL AND title LIKE 'TEST — %';

BEGIN;

DO $$
DECLARE
  r        record;
  v_party  uuid;
  v_today  date := (now() AT TIME ZONE 'America/New_York')::date;
  v_start  timestamptz;
  v_slot   uuid;
  v_member uuid;
  i        int;
  v_name   text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- title,                         day, start,   hours, kids, spots, lead,     crew,                          confirmed,               standbys,  notes
      ('TEST — Glow Party',              5, '13:00'::time, 3, 10,   3,     'Ava',    ARRAY['Mia'],                  ARRAY['Ava'],            ARRAY['Grace'], 'Test party. Bring the UV wristbands.'),
      ('TEST — Mermaid Party',           6, '11:00'::time, 3, 14,   4,     'Sophia', ARRAY['Emma', 'Isabella'],     ARRAY['Sophia', 'Emma'], ARRAY[]::text[], NULL),
      ('TEST — Spa Party',              12, '14:00'::time, 3, 18,   5,     NULL,     ARRAY['Chloe'],                ARRAY[]::text[],         ARRAY[]::text[], 'Test party. Robes are in the back closet.'),
      ('TEST — Taylor Swift Party',     13, '10:00'::time, 3, NULL, 3,     'Olivia', ARRAY['Grace', 'Lily'],        ARRAY['Olivia', 'Lily'], ARRAY['Zoe', 'Mia'], NULL),
      ('TEST — Slime Party',            19, '13:30'::time, 3, 8,    3,     NULL,     ARRAY[]::text[],               ARRAY[]::text[],         ARRAY[]::text[], NULL),
      ('TEST — Sleep Under',            20, '18:00'::time, 3, 22,   6,     NULL,     ARRAY['Mia'],                  ARRAY[]::text[],         ARRAY[]::text[], 'Test party. Late finish.')
    ) AS t(title, day_offset, start_time, hours, kids, spots, lead_name, crew_names, confirmed_names, standby_names, notes)
  LOOP
    IF EXISTS (SELECT 1 FROM public.crew_parties p
                WHERE p.title = r.title AND p.booking_id IS NULL AND p.party_kind = 'manual') THEN
      CONTINUE;
    END IF;

    -- An Eastern wall-clock time on an Eastern date, as an instant.
    v_start := ((v_today + r.day_offset) + r.start_time) AT TIME ZONE 'America/New_York';

    INSERT INTO public.crew_parties (party_kind, booking_id, title, theme, starts_at, ends_at, guest_count, location,
                                     notes_for_crew, status, published_at)
    VALUES ('manual', NULL, r.title, NULL, v_start, v_start + make_interval(hours => r.hours), r.kids,
            'Test party (not a real booking)', r.notes, 'published', now())
    RETURNING id INTO v_party;

    INSERT INTO public.crew_slots (party_id, role) VALUES (v_party, 'lead');
    FOR i IN 2..r.spots LOOP
      INSERT INTO public.crew_slots (party_id, role) VALUES (v_party, 'crew');
    END LOOP;

    -- Test members only: `is_test` is part of every lookup below.
    IF r.lead_name IS NOT NULL THEN
      SELECT id INTO STRICT v_member FROM public.crew_members WHERE is_test AND first_name = r.lead_name;
      UPDATE public.crew_slots
         SET status = 'assigned', member_id = v_member, assigned_at = now(), assigned_via = 'admin',
             assigned_by = 'seed:test-parties',
             confirmed_at = CASE WHEN r.lead_name = ANY (r.confirmed_names) THEN now() END
       WHERE party_id = v_party AND role = 'lead';
    END IF;

    FOREACH v_name IN ARRAY r.crew_names LOOP
      SELECT id INTO STRICT v_member FROM public.crew_members WHERE is_test AND first_name = v_name;
      SELECT id INTO v_slot FROM public.crew_slots
       WHERE party_id = v_party AND role = 'crew' AND status = 'open' ORDER BY created_at, id LIMIT 1;
      UPDATE public.crew_slots
         SET status = 'assigned', member_id = v_member, assigned_at = now(), assigned_via = 'admin',
             assigned_by = 'seed:test-parties',
             confirmed_at = CASE WHEN v_name = ANY (r.confirmed_names) THEN now() END
       WHERE id = v_slot;
    END LOOP;

    FOREACH v_name IN ARRAY r.standby_names LOOP
      INSERT INTO public.crew_standbys (party_id, member_id)
      SELECT v_party, m.id FROM public.crew_members m WHERE m.is_test AND m.first_name = v_name;
    END LOOP;
  END LOOP;
END $$;

COMMIT;

-- What is there now (run twice: the counts must not move).
SELECT p.title,
       to_char(p.starts_at AT TIME ZONE 'America/New_York', 'Dy Mon DD HH24:MI') AS starts_et,
       p.guest_count AS kids,
       count(s.id) AS spots,
       count(s.id) FILTER (WHERE s.status = 'assigned') AS taken,
       count(s.id) FILTER (WHERE s.role = 'lead') AS leads,
       (SELECT count(*) FROM public.crew_standbys sb WHERE sb.party_id = p.id AND sb.withdrawn_at IS NULL) AS standbys
  FROM public.crew_parties p
  LEFT JOIN public.crew_slots s ON s.party_id = p.id
 WHERE p.party_kind = 'manual' AND p.booking_id IS NULL AND p.title LIKE 'TEST — %'
 GROUP BY p.id
 ORDER BY p.starts_at;

-- Nobody but a test member holds a spot on a TEST party (expect 0).
SELECT count(*) AS non_test_holders
  FROM public.crew_slots s
  JOIN public.crew_parties p ON p.id = s.party_id
  JOIN public.crew_members m ON m.id = s.member_id
 WHERE p.title LIKE 'TEST — %' AND NOT m.is_test;
