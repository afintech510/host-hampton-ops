-- 094: crew time clock (punch in / punch out) for the members Adam switches it on for (Lexi first).
--
-- crew_time_clock_members : WHO has a time clock. A row here is the whole switch; nobody else
--                           sees the card or can call the punch API. notice_accepted_at is the
--                           one-time "your time and location are recorded" acknowledgement.
-- crew_time_punches       : one row per shift. Time is the SERVER's clock. Location is recorded
--                           with the punch and never blocks it (denied / far away / off-network
--                           are all FLAGS for the admin, not refusals).
-- crew_time_config        : one row: the studio's public IP(s) (the "on studio Wi-Fi" check; a web
--                           page cannot read the SSID, only the network address the request came
--                           from) and the studio's coordinates + radius for the on-site check.
--
-- Idempotent. RLS on, service role only, like every crew table.

CREATE TABLE IF NOT EXISTS public.crew_time_clock_members (
  member_id          uuid PRIMARY KEY REFERENCES public.crew_members(id) ON DELETE CASCADE,
  enabled            boolean NOT NULL DEFAULT true,
  notice_version     text,
  notice_accepted_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.crew_time_punches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id           uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  punched_in_at       timestamptz NOT NULL DEFAULT now(),
  punched_out_at      timestamptz,
  in_lat              double precision,
  in_lng              double precision,
  in_accuracy_m       int,
  in_location_status  text NOT NULL DEFAULT 'unavailable' CHECK (in_location_status IN ('ok', 'denied', 'unavailable')),
  in_distance_m       int,
  in_ip               text,
  in_on_studio_network boolean,
  out_lat             double precision,
  out_lng             double precision,
  out_accuracy_m      int,
  out_location_status text CHECK (out_location_status IN ('ok', 'denied', 'unavailable')),
  out_distance_m      int,
  out_ip              text,
  out_on_studio_network boolean,
  edited_by           text,
  edited_at           timestamptz,
  admin_note          text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT crew_time_punches_order CHECK (punched_out_at IS NULL OR punched_out_at >= punched_in_at)
);
-- One open shift per person, whatever path writes the row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_time_one_open ON public.crew_time_punches (member_id) WHERE punched_out_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crew_time_member ON public.crew_time_punches (member_id, punched_in_at DESC);

CREATE TABLE IF NOT EXISTS public.crew_time_config (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  studio_ips  text[] NOT NULL DEFAULT '{}',
  studio_lat  double precision NOT NULL,
  studio_lng  double precision NOT NULL,
  radius_m    int NOT NULL DEFAULT 150 CHECK (radius_m BETWEEN 25 AND 2000),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text
);
-- 295 Montauk Hwy, Speonk NY 11972 (OpenStreetMap). studio_ips stays empty until Adam records it
-- from the studio Wi-Fi on the admin Staff page.
INSERT INTO public.crew_time_config (id, studio_lat, studio_lng) VALUES (1, 40.8187586, -72.7044091)
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crew_time_clock_members', 'crew_time_punches', 'crew_time_config']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- Lexi (the only member with a time clock at launch). By name, active, non-test, non-owner.
INSERT INTO public.crew_time_clock_members (member_id)
SELECT id FROM public.crew_members
WHERE first_name ILIKE 'lexi' AND NOT is_owner AND NOT is_test AND status = 'active'
ON CONFLICT (member_id) DO NOTHING;
