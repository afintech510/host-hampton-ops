-- Migration 090 — equitable scheduling: staff say what they want, the manager picks (2026-11-06).
--
-- Today a crew member who taps "Commit to Work" takes the spot at once, so whoever
-- is quickest (or watching the app) can take every party. The new flow (Adam,
-- 2026-11-06): when a party goes out each crew member answers one of
--     work         "I want to work this party"
--     unavailable  "Unavailable to work"
--     standby      "Add me as standby"
-- and nothing is locked. The system ranks the people who asked to work by who
-- worked least recently, the manager approves (one tap on the recommendation, or
-- someone else), and the others become standbys.
--
--   crew_parties.selection_mode   'first_come' (every party until now, and any party
--                                 published while CREW_PICK_FLOW is off) | 'pick'.
--                                 Set when the party is published and never changed
--                                 under people's feet: existing claims stay as they are.
--   crew_party_responses          one row per (party, member): their latest answer.
--   crew_pick_log                 what the manager approved, what the system had
--                                 recommended, and whether they differed.
--
-- Additive. Nothing is sent. RLS on, no policies, service role only, like the rest of crew.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run.

BEGIN;

ALTER TABLE public.crew_parties ADD COLUMN IF NOT EXISTS selection_mode text NOT NULL DEFAULT 'first_come';
ALTER TABLE public.crew_parties DROP CONSTRAINT IF EXISTS crew_parties_selection_mode_check;
ALTER TABLE public.crew_parties ADD CONSTRAINT crew_parties_selection_mode_check CHECK (selection_mode IN ('first_come', 'pick'));
COMMENT ON COLUMN public.crew_parties.selection_mode IS 'first_come = Commit to Work takes the spot at once; pick = crew say what they want and the manager approves (migration 090).';

CREATE TABLE IF NOT EXISTS public.crew_party_responses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id   uuid NOT NULL REFERENCES public.crew_parties(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  response   text NOT NULL CHECK (response IN ('work', 'unavailable', 'standby')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (party_id, member_id)
);
CREATE INDEX IF NOT EXISTS idx_crew_party_responses_party  ON public.crew_party_responses(party_id, response);
CREATE INDEX IF NOT EXISTS idx_crew_party_responses_member ON public.crew_party_responses(member_id);

CREATE TABLE IF NOT EXISTS public.crew_pick_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id              uuid NOT NULL REFERENCES public.crew_parties(id) ON DELETE CASCADE,
  slot_id               uuid REFERENCES public.crew_slots(id) ON DELETE SET NULL,
  member_id             uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  recommended_member_id uuid REFERENCES public.crew_members(id) ON DELETE SET NULL,
  overridden            boolean NOT NULL DEFAULT false,
  decided_by            text NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crew_pick_log_party ON public.crew_pick_log(party_id, created_at DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crew_party_responses', 'crew_pick_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

COMMIT;
