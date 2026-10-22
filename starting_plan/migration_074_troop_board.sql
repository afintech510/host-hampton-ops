-- Migration 074 — the troop family board at /troop2514.
--
-- Allie's Girl Scouts troop. An unlisted, noindex page she shares with the
-- troop's families: announcements, the meeting schedule, snack sign-ups, and
-- three private forms (can't make it, ideas, contact the leaders). Leaders
-- manage it from a Leaders tab, signed in with TROOP_LEADER_PASSWORD or an
-- ordinary Host Hampton admin session (lib/troopAuth.ts).
--
-- ── NOT A LEAD, NOT A CONTACT ──
--
-- Nothing here touches `contacts`, Brevo, Quo, sequences or the booking agent.
-- A troop parent signing up for snacks is not a party enquiry, and these rows
-- are about children. The only outbound mail is the leaders' own notification
-- and the optional absence confirmation (lib/email-templates/troop.ts).
--
-- ── WHAT IS DELIBERATE ──
--
--   1. Every table carries `troop` so a second troop is a row in lib/troop.ts,
--      not another migration. The CHECK is the shape, not the list.
--   2. `troop_snack_claims` is keyed by the schedule row. Two families pressing
--      "Sign up" for the same date is a 23505 for the second one — the claim is
--      the primary key, not a read-then-write.
--   3. The public board reads a parent's name and the snack, never the scout's
--      name (lib/troop.ts `publicSnack`). The scout's name is for the leaders.
--   4. No public RLS policy. There is no browser Supabase client on this site;
--      the API routes use the service role.
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.troop_settings (
  troop          text PRIMARY KEY,
  welcome        text,
  leader_names   text[] NOT NULL DEFAULT '{}',
  leader_emails  text[] NOT NULL DEFAULT '{}',
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.troop_posts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  troop       text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL,
  post_date   date NOT NULL,
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.troop_schedule (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  troop        text NOT NULL,
  title        text NOT NULL,
  kind         text NOT NULL DEFAULT 'meeting',
  event_date   date NOT NULL,
  start_time   time NOT NULL,
  end_time     time,
  location     text,
  notes        text,
  needs_snack  boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.troop_snack_claims (
  schedule_id  uuid PRIMARY KEY REFERENCES public.troop_schedule (id) ON DELETE CASCADE,
  troop        text NOT NULL,
  parent_name  text NOT NULL,
  scout_name   text NOT NULL,
  item         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Absence notes, ideas and messages. One table, `kind` says which; the columns a
-- kind does not use stay NULL.
CREATE TABLE IF NOT EXISTS public.troop_inbox (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  troop        text NOT NULL,
  kind         text NOT NULL,
  scout_name   text,
  parent_name  text,        -- absence: the parent; idea/message: the sender
  email        text,        -- absence: optional, for a confirmation
  reply_to     text,        -- message: email or phone, as typed
  missed_date  date,        -- absence
  idea_kind    text,        -- idea
  body         text,        -- absence note / idea / message
  anonymous    boolean NOT NULL DEFAULT false,
  done         boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.troop_settings DROP CONSTRAINT IF EXISTS troop_settings_troop_check;
ALTER TABLE public.troop_settings ADD CONSTRAINT troop_settings_troop_check CHECK (troop ~ '^[0-9]{3,6}$');
ALTER TABLE public.troop_posts DROP CONSTRAINT IF EXISTS troop_posts_troop_check;
ALTER TABLE public.troop_posts ADD CONSTRAINT troop_posts_troop_check CHECK (troop ~ '^[0-9]{3,6}$');
ALTER TABLE public.troop_schedule DROP CONSTRAINT IF EXISTS troop_schedule_troop_check;
ALTER TABLE public.troop_schedule ADD CONSTRAINT troop_schedule_troop_check CHECK (troop ~ '^[0-9]{3,6}$');
ALTER TABLE public.troop_snack_claims DROP CONSTRAINT IF EXISTS troop_snack_claims_troop_check;
ALTER TABLE public.troop_snack_claims ADD CONSTRAINT troop_snack_claims_troop_check CHECK (troop ~ '^[0-9]{3,6}$');
ALTER TABLE public.troop_inbox DROP CONSTRAINT IF EXISTS troop_inbox_troop_check;
ALTER TABLE public.troop_inbox ADD CONSTRAINT troop_inbox_troop_check CHECK (troop ~ '^[0-9]{3,6}$');

ALTER TABLE public.troop_schedule DROP CONSTRAINT IF EXISTS troop_schedule_kind_check;
ALTER TABLE public.troop_schedule ADD CONSTRAINT troop_schedule_kind_check CHECK (kind IN ('meeting', 'event'));

ALTER TABLE public.troop_inbox DROP CONSTRAINT IF EXISTS troop_inbox_kind_check;
ALTER TABLE public.troop_inbox ADD CONSTRAINT troop_inbox_kind_check CHECK (kind IN ('absence', 'idea', 'message'));

CREATE INDEX IF NOT EXISTS idx_troop_posts_troop ON public.troop_posts (troop, post_date DESC);
CREATE INDEX IF NOT EXISTS idx_troop_schedule_troop ON public.troop_schedule (troop, event_date);
CREATE INDEX IF NOT EXISTS idx_troop_inbox_troop ON public.troop_inbox (troop, created_at DESC);

INSERT INTO public.troop_settings (troop) VALUES ('2514') ON CONFLICT (troop) DO NOTHING;

-- ── RLS: service role only (see header, point 4) ────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['troop_settings', 'troop_posts', 'troop_schedule', 'troop_snack_claims', 'troop_inbox'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Service role full access on %s" ON public.%I', t, t);
    EXECUTE format('CREATE POLICY "Service role full access on %s" ON public.%I USING (auth.role() = ''service_role'') WITH CHECK (auth.role() = ''service_role'')', t, t);
  END LOOP;
END $$;

COMMIT;
