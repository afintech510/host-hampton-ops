-- Migration 077 — crew scheduling (v1.1). Spec: docs/specs/crew/CREW_SPEC.md
--
-- Party crew pick their own parties, get paid a flat rate PER PARTY that rises
-- $2.50 a step, and cover each other's late cancels through standbys. Allie
-- staffs, pays and edits the rules from /admin/crew. Everything a crew member
-- sees is behind CREW_ENABLED; the admin side and the booking reconcile are not,
-- so the roster can be set up first.
--
-- ── WHAT IS DELIBERATE ──
--
--   1. RLS is ON with NO policies, and table privileges are revoked from anon
--      and authenticated. Every read and write is server code on the service
--      role (`getSupabase()`), which bypasses RLS. The crew never talk to
--      PostgREST themselves — there is no Supabase Auth in this app.
--
--   2. THE RULES ARE NOT HERE. How many steps a party, a cancel or a no-show is
--      worth lives in `src/lib/crew/rules.ts` and nowhere else. Every function
--      below that moves `crew_members.steps` takes the `expected_steps` the app
--      read and the `steps_after` it computed, and applies it as a
--      COMPARE-AND-SWAP under `FOR UPDATE`: a mismatch answers 'stale' (or, in
--      the multi-row attendance function, raises `crew_stale` and rolls the
--      whole party back) and the app re-reads and retries. A second copy of the
--      step arithmetic in plpgsql would be a second answer to the same question.
--
--   3. What the database DOES enforce, whatever path writes the row:
--        - first claim wins (`FOR UPDATE` on the slot, then a status check);
--        - one live Lead spot per party, one live spot per member per party;
--        - a Lead spot is held only by a `can_lead` member or the owner
--          (trigger `trg_crew_slots_guard`, checked when the holder or role
--          CHANGES, so revoking `can_lead` later never breaks marking
--          attendance on a party they already worked);
--        - the owner (Allie) is never paid, tipped or topped up by the app;
--        - steps stay within 0..8.
--
--   4. `email_key` is GENERATED (lower(btrim(email))) and unique, the
--      migration 076 pattern: two spellings of one address cannot become two
--      crew members, and no route ever has to filter an email column itself —
--      lookups go through `findCrewMembersByEmail` in lib/contactLookup.ts.
--      Login codes are keyed by `member_id`, not by an address.
--
--   5. The ledger (`crew_events`) is append-only. Correcting attendance appends
--      an `admin_adjustment` that names the row it voids (`voids_event_id`)
--      and then the new outcome at `attendance_seq + 1`; the unique index is on
--      (slot_id, attendance_seq), so a correction does not collide with the
--      outcome it corrects. A step loss inside the launch grace period is
--      written with `waived_grace = true` and `step_after = step_before`.
--
--   6. No default location. v1 defaulted to a "Suite 7" that does not exist;
--      the app fills `location` from STUDIO_ADDRESS_LINE or the mobile
--      party's address.
--
--   7. Allie is seeded as the one `is_owner` row: no email, no phone, no PII.
--      She can be assigned as Lead and counts toward crew needed.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run (verified by running it twice).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── ENUMS ───────────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE public.crew_member_status AS ENUM ('active', 'paused', 'removed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.crew_slot_role AS ENUM ('lead', 'crew');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.crew_slot_status AS ENUM ('open', 'assigned', 'completed', 'no_show', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.crew_party_status AS ENUM ('draft', 'published', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.crew_day_part AS ENUM ('all_day', 'before_noon', 'after_noon');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- open → claimed | cancelled (withdrawn) | dropped_uncovered | expired
-- open → escalated (no standby claimed; Allie alerted) → claimed | dropped_uncovered | expired
DO $$ BEGIN CREATE TYPE public.crew_swap_status AS ENUM ('open', 'claimed', 'cancelled', 'dropped_uncovered', 'escalated', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.crew_event_type AS ENUM (
  'worked',                 -- attendance: +1, or +2 when the slot was a cover (covered_swap_id)
  'no_show',                -- attendance: reset to 0
  'early_release',          -- cancelled 7+ days out: -1
  'late_cancel_covered',    -- cancelled < 7 days, a standby took it: 0
  'late_cancel_uncovered',  -- "drop anyway": reset to 0
  'cover_claimed',          -- claimed someone's late cancel: 0 now, +2 when worked
  'admin_adjustment'        -- step override, or a void of a prior attendance row
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.crew_channel AS ENUM ('in_app', 'email', 'sms');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.crew_notification_status AS ENUM ('queued', 'sent', 'failed', 'skipped');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.crew_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ── SETTINGS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
DROP TRIGGER IF EXISTS trg_crew_settings_updated_at ON public.crew_settings;
CREATE TRIGGER trg_crew_settings_updated_at BEFORE UPDATE ON public.crew_settings
  FOR EACH ROW EXECUTE FUNCTION public.crew_set_updated_at();

-- ── MEMBERS ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_members (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name         text NOT NULL,
  last_name          text,
  email              text,
  email_key          text GENERATED ALWAYS AS (lower(btrim(email))) STORED,
  phone              text,                                  -- E.164, never shown to other crew
  steps              int NOT NULL DEFAULT 0,
  can_lead           boolean NOT NULL DEFAULT false,
  is_owner           boolean NOT NULL DEFAULT false,
  skills             text[] NOT NULL DEFAULT '{}',          -- self-reported, informational only
  status             public.crew_member_status NOT NULL DEFAULT 'active',
  needs_review       boolean NOT NULL DEFAULT false,        -- set on a no-show
  sms_opt_in         boolean NOT NULL DEFAULT false,
  sms_opt_in_at      timestamptz,
  email_opt_in       boolean NOT NULL DEFAULT true,
  admin_notes        text,
  job_application_id uuid REFERENCES public.job_applications(id) ON DELETE SET NULL,
  joined_on          date NOT NULL DEFAULT current_date,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crew_members DROP CONSTRAINT IF EXISTS crew_members_steps_check;
ALTER TABLE public.crew_members ADD CONSTRAINT crew_members_steps_check CHECK (steps BETWEEN 0 AND 8);
ALTER TABLE public.crew_members DROP CONSTRAINT IF EXISTS crew_members_phone_check;
ALTER TABLE public.crew_members ADD CONSTRAINT crew_members_phone_check CHECK (phone IS NULL OR phone ~ '^\+1[2-9][0-9]{9}$');
ALTER TABLE public.crew_members DROP CONSTRAINT IF EXISTS crew_members_skills_check;
ALTER TABLE public.crew_members ADD CONSTRAINT crew_members_skills_check CHECK (cardinality(skills) <= 30);
ALTER TABLE public.crew_members DROP CONSTRAINT IF EXISTS crew_members_owner_steps_check;
ALTER TABLE public.crew_members ADD CONSTRAINT crew_members_owner_steps_check CHECK (NOT is_owner OR steps = 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_members_email_key ON public.crew_members(email_key) WHERE email_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_members_phone ON public.crew_members(phone) WHERE phone IS NOT NULL AND status <> 'removed';
CREATE INDEX IF NOT EXISTS idx_crew_members_status ON public.crew_members(status);

DROP TRIGGER IF EXISTS trg_crew_members_updated_at ON public.crew_members;
CREATE TRIGGER trg_crew_members_updated_at BEFORE UPDATE ON public.crew_members
  FOR EACH ROW EXECUTE FUNCTION public.crew_set_updated_at();

-- ── LOGIN CODES (6-digit email code; hashed; keyed by member) ───────────────
CREATE TABLE IF NOT EXISTS public.crew_login_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crew_login_codes_member ON public.crew_login_codes(member_id, created_at DESC);

-- ── PARTIES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_parties (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id           uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  party_kind           text NOT NULL DEFAULT 'manual',
  title                text NOT NULL,
  theme                text,
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  guest_count          int,
  location             text NOT NULL,
  notes_for_crew       text,
  slots_override       int,
  extra_flat_cents     int NOT NULL DEFAULT 0,               -- flat extra per person (holiday weekend)
  status               public.crew_party_status NOT NULL DEFAULT 'draft',
  published_at         timestamptz,
  attendance_marked_at timestamptz,
  cancelled_at         timestamptz,
  sync_flags           text[] NOT NULL DEFAULT '{}',          -- e.g. over_staffed, per_hour_helper
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crew_parties DROP CONSTRAINT IF EXISTS crew_parties_kind_check;
ALTER TABLE public.crew_parties ADD CONSTRAINT crew_parties_kind_check
  CHECK (party_kind IN ('in_studio_theme', 'mobile_party', 'studio_rental', 'manual'));
ALTER TABLE public.crew_parties DROP CONSTRAINT IF EXISTS crew_parties_time_order;
ALTER TABLE public.crew_parties ADD CONSTRAINT crew_parties_time_order CHECK (ends_at > starts_at);
ALTER TABLE public.crew_parties DROP CONSTRAINT IF EXISTS crew_parties_published_has_time;
ALTER TABLE public.crew_parties ADD CONSTRAINT crew_parties_published_has_time
  CHECK (status <> 'published' OR published_at IS NOT NULL);
ALTER TABLE public.crew_parties DROP CONSTRAINT IF EXISTS crew_parties_guest_count_check;
ALTER TABLE public.crew_parties ADD CONSTRAINT crew_parties_guest_count_check CHECK (guest_count IS NULL OR guest_count >= 0);
ALTER TABLE public.crew_parties DROP CONSTRAINT IF EXISTS crew_parties_slots_override_check;
ALTER TABLE public.crew_parties ADD CONSTRAINT crew_parties_slots_override_check
  CHECK (slots_override IS NULL OR slots_override BETWEEN 1 AND 10);
ALTER TABLE public.crew_parties DROP CONSTRAINT IF EXISTS crew_parties_extra_check;
ALTER TABLE public.crew_parties ADD CONSTRAINT crew_parties_extra_check CHECK (extra_flat_cents BETWEEN 0 AND 100000);
ALTER TABLE public.crew_parties DROP CONSTRAINT IF EXISTS crew_parties_location_check;
ALTER TABLE public.crew_parties ADD CONSTRAINT crew_parties_location_check CHECK (length(btrim(location)) > 0);

CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_parties_booking ON public.crew_parties(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_crew_parties_status ON public.crew_parties(status, starts_at);

DROP TRIGGER IF EXISTS trg_crew_parties_updated_at ON public.crew_parties;
CREATE TRIGGER trg_crew_parties_updated_at BEFORE UPDATE ON public.crew_parties
  FOR EACH ROW EXECUTE FUNCTION public.crew_set_updated_at();

-- ── SWAP (COVER) REQUESTS — created before slots reference them ─────────────
CREATE TABLE IF NOT EXISTS public.crew_swap_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slot_id               uuid NOT NULL,                        -- FK added below (circular with crew_slots)
  requester_id          uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  slot_role             public.crew_slot_role NOT NULL,       -- snapshot: a Lead spot goes only to can_lead
  reason                text NOT NULL,
  reason_note           text,                                 -- Allie only, never in a crew projection
  status                public.crew_swap_status NOT NULL DEFAULT 'open',
  notice_hours          numeric(8,2) NOT NULL,
  standbys_notified_at  timestamptz,
  escalated_at          timestamptz,
  offered_to_all_at     timestamptz,                          -- Allie: "offer to everyone free that day"
  warned_at             timestamptz,                          -- the 48-hour warning
  claimed_by            uuid REFERENCES public.crew_members(id) ON DELETE SET NULL,
  claimed_at            timestamptz,
  resolved_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crew_swap_requests DROP CONSTRAINT IF EXISTS crew_swap_reason_check;
ALTER TABLE public.crew_swap_requests ADD CONSTRAINT crew_swap_reason_check
  CHECK (reason IN ('sick', 'family', 'school', 'other'));

DROP TRIGGER IF EXISTS trg_crew_swap_updated_at ON public.crew_swap_requests;
CREATE TRIGGER trg_crew_swap_updated_at BEFORE UPDATE ON public.crew_swap_requests
  FOR EACH ROW EXECUTE FUNCTION public.crew_set_updated_at();

-- ── SLOTS ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_slots (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id         uuid NOT NULL REFERENCES public.crew_parties(id) ON DELETE CASCADE,
  role             public.crew_slot_role NOT NULL DEFAULT 'crew',
  status           public.crew_slot_status NOT NULL DEFAULT 'open',
  member_id        uuid REFERENCES public.crew_members(id) ON DELETE SET NULL,
  assigned_at      timestamptz,
  assigned_via     text,                                      -- claim | admin | cover
  assigned_by      text,                                      -- adminActorId for admin assigns
  confirmed_at     timestamptz,
  covered_swap_id  uuid REFERENCES public.crew_swap_requests(id) ON DELETE SET NULL,
  -- pay snapshot, written by crew_mark_attendance
  pay_cents        int,
  step_at_pay      int,
  extra_cents      int,
  tip_cents        int,
  tip_topup_cents  int,                                       -- Host Hampton's cost: max(0, floor - tip)
  paid_method      text,
  paid_note        text,
  paid_at          timestamptz,
  shift_started_at timestamptz,                               -- hours on record only; never changes pay
  shift_ended_at   timestamptz,
  hours_worked     numeric(5,2),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crew_slots DROP CONSTRAINT IF EXISTS crew_slots_assigned_has_member;
ALTER TABLE public.crew_slots ADD CONSTRAINT crew_slots_assigned_has_member
  CHECK (status NOT IN ('assigned', 'completed', 'no_show') OR member_id IS NOT NULL);
ALTER TABLE public.crew_slots DROP CONSTRAINT IF EXISTS crew_slots_assigned_via_check;
ALTER TABLE public.crew_slots ADD CONSTRAINT crew_slots_assigned_via_check
  CHECK (assigned_via IS NULL OR assigned_via IN ('claim', 'admin', 'cover'));
ALTER TABLE public.crew_slots DROP CONSTRAINT IF EXISTS crew_slots_paid_method_check;
ALTER TABLE public.crew_slots ADD CONSTRAINT crew_slots_paid_method_check
  CHECK (paid_method IS NULL OR paid_method IN ('venmo', 'zelle', 'cash', 'check', 'other'));
ALTER TABLE public.crew_slots DROP CONSTRAINT IF EXISTS crew_slots_money_check;
ALTER TABLE public.crew_slots ADD CONSTRAINT crew_slots_money_check CHECK (
  (pay_cents IS NULL OR pay_cents BETWEEN 0 AND 100000) AND
  (extra_cents IS NULL OR extra_cents BETWEEN 0 AND 100000) AND
  (tip_cents IS NULL OR tip_cents BETWEEN 0 AND 100000) AND
  (tip_topup_cents IS NULL OR tip_topup_cents BETWEEN 0 AND 100000) AND
  (step_at_pay IS NULL OR step_at_pay BETWEEN 0 AND 8) AND
  (hours_worked IS NULL OR hours_worked BETWEEN 0 AND 24)
);

-- one live Lead spot per party; one live spot per member per party
CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_slots_one_lead ON public.crew_slots(party_id)
  WHERE role = 'lead' AND status <> 'cancelled';
CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_slots_member_party ON public.crew_slots(party_id, member_id)
  WHERE member_id IS NOT NULL AND status IN ('assigned', 'completed', 'no_show');
CREATE INDEX IF NOT EXISTS idx_crew_slots_member ON public.crew_slots(member_id, status);
CREATE INDEX IF NOT EXISTS idx_crew_slots_party ON public.crew_slots(party_id);

DROP TRIGGER IF EXISTS trg_crew_slots_updated_at ON public.crew_slots;
CREATE TRIGGER trg_crew_slots_updated_at BEFORE UPDATE ON public.crew_slots
  FOR EACH ROW EXECUTE FUNCTION public.crew_set_updated_at();

ALTER TABLE public.crew_swap_requests DROP CONSTRAINT IF EXISTS crew_swap_slot_fk;
ALTER TABLE public.crew_swap_requests ADD CONSTRAINT crew_swap_slot_fk
  FOREIGN KEY (slot_id) REFERENCES public.crew_slots(id) ON DELETE CASCADE;
-- at most one live cover request per slot
CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_swap_active_slot ON public.crew_swap_requests(slot_id)
  WHERE status IN ('open', 'escalated');
CREATE INDEX IF NOT EXISTS idx_crew_swap_status ON public.crew_swap_requests(status, created_at);

-- The Lead rule and the unpaid-owner rule, enforced on every write path.
CREATE OR REPLACE FUNCTION public.crew_slots_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_can_lead boolean;
  v_owner    boolean;
BEGIN
  IF NEW.member_id IS NULL OR NEW.status NOT IN ('assigned', 'completed', 'no_show') THEN
    RETURN NEW;
  END IF;
  SELECT can_lead, is_owner INTO v_can_lead, v_owner FROM public.crew_members WHERE id = NEW.member_id;

  IF NEW.role = 'lead'
     AND (TG_OP = 'INSERT' OR NEW.member_id IS DISTINCT FROM OLD.member_id OR NEW.role IS DISTINCT FROM OLD.role)
     AND NOT (coalesce(v_can_lead, false) OR coalesce(v_owner, false)) THEN
    RAISE EXCEPTION 'crew_lead_requires_can_lead' USING ERRCODE = 'check_violation';
  END IF;

  IF coalesce(v_owner, false) AND (
       coalesce(NEW.pay_cents, 0) > 0 OR coalesce(NEW.extra_cents, 0) > 0 OR
       coalesce(NEW.tip_cents, 0) > 0 OR coalesce(NEW.tip_topup_cents, 0) > 0) THEN
    RAISE EXCEPTION 'crew_owner_unpaid' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_crew_slots_guard ON public.crew_slots;
CREATE TRIGGER trg_crew_slots_guard BEFORE INSERT OR UPDATE ON public.crew_slots
  FOR EACH ROW EXECUTE FUNCTION public.crew_slots_guard();

-- ── STANDBYS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_standbys (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id     uuid NOT NULL REFERENCES public.crew_parties(id) ON DELETE CASCADE,
  member_id    uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  withdrawn_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_standbys_live ON public.crew_standbys(party_id, member_id)
  WHERE withdrawn_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_crew_standbys_member ON public.crew_standbys(member_id);

-- ── AVAILABILITY ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_unavailability (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  day        date NOT NULL,
  part       public.crew_day_part NOT NULL DEFAULT 'all_day',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, day, part)
);
CREATE INDEX IF NOT EXISTS idx_crew_unavail_day ON public.crew_unavailability(day);

CREATE TABLE IF NOT EXISTS public.crew_recurring_blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  dow        smallint NOT NULL CHECK (dow BETWEEN 0 AND 6),  -- 0 = Sunday
  part       public.crew_day_part NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, dow, part)
);

-- ── LEDGER (append-only) ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crew_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id      uuid NOT NULL REFERENCES public.crew_members(id) ON DELETE CASCADE,
  type           public.crew_event_type NOT NULL,
  step_before    int NOT NULL,
  step_delta     int NOT NULL DEFAULT 0,
  step_after     int NOT NULL,
  waived_grace   boolean NOT NULL DEFAULT false,
  party_id       uuid REFERENCES public.crew_parties(id) ON DELETE SET NULL,
  slot_id        uuid REFERENCES public.crew_slots(id) ON DELETE SET NULL,
  swap_id        uuid REFERENCES public.crew_swap_requests(id) ON DELETE SET NULL,
  attendance_seq int,
  voids_event_id uuid REFERENCES public.crew_events(id) ON DELETE SET NULL,
  metadata       jsonb NOT NULL DEFAULT '{}',
  created_by     text NOT NULL DEFAULT 'system',              -- system | crew | admin:<email> | ADMIN
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.crew_events DROP CONSTRAINT IF EXISTS crew_events_delta_check;
ALTER TABLE public.crew_events ADD CONSTRAINT crew_events_delta_check CHECK (step_after - step_before = step_delta);

CREATE INDEX IF NOT EXISTS idx_crew_events_member ON public.crew_events(member_id, occurred_at DESC);
-- one attendance outcome per slot per sequence number; a correction takes the next number
CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_events_attendance ON public.crew_events(slot_id, attendance_seq)
  WHERE type IN ('worked', 'no_show');

-- ── NOTIFICATIONS (+ admin in-app alerts with member_id NULL) ───────────────
CREATE TABLE IF NOT EXISTS public.crew_notifications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid REFERENCES public.crew_members(id) ON DELETE CASCADE,
  channel       public.crew_channel NOT NULL,
  template      text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}',
  status        public.crew_notification_status NOT NULL DEFAULT 'queued',
  dedupe_key    text NOT NULL,
  provider_id   text,
  error         text,
  read_at       timestamptz,
  resolved_at   timestamptz,
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (dedupe_key, channel)
);
CREATE INDEX IF NOT EXISTS idx_crew_notif_member ON public.crew_notifications(member_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crew_notif_queue ON public.crew_notifications(status, scheduled_for) WHERE status = 'queued';

-- ── ACCESS: RLS on, no policies, no anon/authenticated table privileges ─────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['crew_settings', 'crew_members', 'crew_login_codes', 'crew_parties',
    'crew_swap_requests', 'crew_slots', 'crew_standbys', 'crew_unavailability',
    'crew_recurring_blocks', 'crew_events', 'crew_notifications']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- FUNCTIONS. Every one locks the row it changes (FOR UPDATE) before deciding,
-- and every step change is a compare-and-swap on a value rules.ts computed.
-- ════════════════════════════════════════════════════════════════════════════

-- Internal. Locks the member; true when steps = p_expected (then sets p_after).
CREATE OR REPLACE FUNCTION public.crew__cas_steps(p_member uuid, p_expected int, p_after int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v int;
BEGIN
  SELECT steps INTO v FROM public.crew_members WHERE id = p_member FOR UPDATE;
  IF NOT FOUND OR v IS DISTINCT FROM p_expected THEN RETURN false; END IF;
  IF p_after IS DISTINCT FROM v THEN
    UPDATE public.crew_members SET steps = p_after WHERE id = p_member;
  END IF;
  RETURN true;
END;
$$;

-- A crew member claims an open spot on a published, upcoming party.
-- Returns: assigned | unavailable | party_closed | not_lead | already_on_party | inactive
CREATE OR REPLACE FUNCTION public.crew_claim_slot(p_slot_id uuid, p_member_id uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slot  public.crew_slots%ROWTYPE;
  v_party public.crew_parties%ROWTYPE;
  v_m     public.crew_members%ROWTYPE;
BEGIN
  SELECT * INTO v_m FROM public.crew_members WHERE id = p_member_id;
  IF NOT FOUND OR v_m.status <> 'active' OR v_m.is_owner THEN RETURN 'inactive'; END IF;

  SELECT * INTO v_slot FROM public.crew_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR v_slot.status <> 'open' THEN RETURN 'unavailable'; END IF;

  SELECT * INTO v_party FROM public.crew_parties WHERE id = v_slot.party_id;
  IF v_party.status <> 'published' OR v_party.starts_at <= now() THEN RETURN 'party_closed'; END IF;

  IF v_slot.role = 'lead' AND NOT v_m.can_lead THEN RETURN 'not_lead'; END IF;

  IF EXISTS (SELECT 1 FROM public.crew_slots s WHERE s.party_id = v_slot.party_id
             AND s.member_id = p_member_id AND s.status IN ('assigned', 'completed', 'no_show')) THEN
    RETURN 'already_on_party';
  END IF;

  BEGIN
    UPDATE public.crew_slots
       SET status = 'assigned', member_id = p_member_id, assigned_at = now(), assigned_via = 'claim',
           assigned_by = NULL, confirmed_at = NULL, covered_swap_id = NULL
     WHERE id = p_slot_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN 'already_on_party';   -- a concurrent claim of a second spot on the same party
  END;

  UPDATE public.crew_standbys SET withdrawn_at = now()
   WHERE party_id = v_slot.party_id AND member_id = p_member_id AND withdrawn_at IS NULL;
  RETURN 'assigned';
END;
$$;

-- Allie assigns a member (including herself, as Lead) to an open spot. No
-- publish requirement; the Lead rule still holds.
-- Returns: assigned | unavailable | party_closed | not_lead | already_on_party | inactive
CREATE OR REPLACE FUNCTION public.crew_admin_assign(p_slot_id uuid, p_member_id uuid, p_actor text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slot  public.crew_slots%ROWTYPE;
  v_party public.crew_parties%ROWTYPE;
  v_m     public.crew_members%ROWTYPE;
BEGIN
  SELECT * INTO v_m FROM public.crew_members WHERE id = p_member_id;
  IF NOT FOUND OR v_m.status <> 'active' THEN RETURN 'inactive'; END IF;

  SELECT * INTO v_slot FROM public.crew_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR v_slot.status <> 'open' THEN RETURN 'unavailable'; END IF;

  SELECT * INTO v_party FROM public.crew_parties WHERE id = v_slot.party_id;
  IF v_party.status IN ('cancelled', 'completed') THEN RETURN 'party_closed'; END IF;

  IF v_slot.role = 'lead' AND NOT (v_m.can_lead OR v_m.is_owner) THEN RETURN 'not_lead'; END IF;

  IF EXISTS (SELECT 1 FROM public.crew_slots s WHERE s.party_id = v_slot.party_id
             AND s.member_id = p_member_id AND s.status IN ('assigned', 'completed', 'no_show')) THEN
    RETURN 'already_on_party';
  END IF;

  BEGIN
    UPDATE public.crew_slots
       SET status = 'assigned', member_id = p_member_id, assigned_at = now(), assigned_via = 'admin',
           assigned_by = p_actor, covered_swap_id = NULL,
           -- the owner receives no notifications, so she can never be "unconfirmed"
           confirmed_at = CASE WHEN v_m.is_owner THEN now() ELSE NULL END
     WHERE id = p_slot_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN 'already_on_party';
  END;

  UPDATE public.crew_standbys SET withdrawn_at = now()
   WHERE party_id = v_slot.party_id AND member_id = p_member_id AND withdrawn_at IS NULL;
  RETURN 'assigned';
END;
$$;

-- "Can't make it". p_kind = 'early_release' (7+ days: the spot reopens and the
-- step change is applied) or 'late_cancel' (under 7 days: a cover request
-- opens, the member stays on the party, no step change yet).
-- Returns: released | requested | already_requested | not_yours | started | stale | invalid
CREATE OR REPLACE FUNCTION public.crew_release_slot(
  p_slot_id uuid, p_member_id uuid, p_kind text, p_reason text, p_note text,
  p_notice_hours numeric, p_expected_steps int, p_steps_after int, p_waived_grace boolean,
  p_meta jsonb DEFAULT '{}'
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_slot  public.crew_slots%ROWTYPE;
  v_party public.crew_parties%ROWTYPE;
  v_owner boolean;
BEGIN
  -- coalesce: `NULL NOT IN (…)` is NULL, which an IF reads as false and lets through.
  IF coalesce(p_kind, '') NOT IN ('early_release', 'late_cancel')
     OR coalesce(p_reason, '') NOT IN ('sick', 'family', 'school', 'other') THEN
    RETURN 'invalid';
  END IF;

  SELECT * INTO v_slot FROM public.crew_slots WHERE id = p_slot_id FOR UPDATE;
  IF NOT FOUND OR v_slot.status <> 'assigned' OR v_slot.member_id IS DISTINCT FROM p_member_id THEN
    RETURN 'not_yours';
  END IF;
  SELECT * INTO v_party FROM public.crew_parties WHERE id = v_slot.party_id;
  IF v_party.starts_at <= now() THEN RETURN 'started'; END IF;

  IF p_kind = 'late_cancel' THEN
    IF EXISTS (SELECT 1 FROM public.crew_swap_requests WHERE slot_id = p_slot_id AND status IN ('open', 'escalated')) THEN
      RETURN 'already_requested';
    END IF;
    INSERT INTO public.crew_swap_requests (slot_id, requester_id, slot_role, reason, reason_note, notice_hours)
    VALUES (p_slot_id, p_member_id, v_slot.role, p_reason, nullif(btrim(coalesce(p_note, '')), ''), p_notice_hours);
    RETURN 'requested';
  END IF;

  -- early release
  SELECT is_owner INTO v_owner FROM public.crew_members WHERE id = p_member_id;
  IF NOT coalesce(v_owner, false) THEN
    IF NOT public.crew__cas_steps(p_member_id, p_expected_steps, p_steps_after) THEN RETURN 'stale'; END IF;
  END IF;

  UPDATE public.crew_slots
     SET status = 'open', member_id = NULL, assigned_at = NULL, assigned_via = NULL, assigned_by = NULL,
         confirmed_at = NULL, covered_swap_id = NULL
   WHERE id = p_slot_id;

  INSERT INTO public.crew_events (member_id, type, step_before, step_delta, step_after, waived_grace,
                                  party_id, slot_id, metadata, created_by)
  VALUES (p_member_id, 'early_release', p_expected_steps,
          CASE WHEN coalesce(v_owner, false) THEN 0 ELSE p_steps_after - p_expected_steps END,
          CASE WHEN coalesce(v_owner, false) THEN p_expected_steps ELSE p_steps_after END,
          coalesce(p_waived_grace, false), v_slot.party_id, p_slot_id,
          coalesce(p_meta, '{}') || jsonb_build_object('reason', p_reason, 'notice_hours', p_notice_hours),
          'crew');
  RETURN 'released';
END;
$$;

-- A standby (or, once Allie offered it to everyone, any eligible member; or
-- Allie herself via p_by_admin) takes a late cancel. The person cancelling
-- gets no step change; the claimer's +2 is applied when the party is WORKED
-- (crew_slots.covered_swap_id), never at claim time — see spec §3.2.
-- Returns: claimed | unavailable | own_request | party_closed | not_lead | not_standby | already_on_party | inactive
CREATE OR REPLACE FUNCTION public.crew_claim_swap(
  p_swap_id uuid, p_member_id uuid, p_by_admin boolean DEFAULT false, p_actor text DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_swap  public.crew_swap_requests%ROWTYPE;
  v_slot  public.crew_slots%ROWTYPE;
  v_party public.crew_parties%ROWTYPE;
  v_m     public.crew_members%ROWTYPE;
  v_req_steps int;
BEGIN
  SELECT * INTO v_m FROM public.crew_members WHERE id = p_member_id;
  IF NOT FOUND OR v_m.status <> 'active' OR (v_m.is_owner AND NOT coalesce(p_by_admin, false)) THEN
    RETURN 'inactive';
  END IF;

  SELECT * INTO v_swap FROM public.crew_swap_requests WHERE id = p_swap_id FOR UPDATE;
  IF NOT FOUND OR v_swap.status NOT IN ('open', 'escalated') THEN RETURN 'unavailable'; END IF;
  IF v_swap.requester_id = p_member_id THEN RETURN 'own_request'; END IF;

  SELECT * INTO v_slot FROM public.crew_slots WHERE id = v_swap.slot_id FOR UPDATE;
  IF v_slot.status <> 'assigned' OR v_slot.member_id IS DISTINCT FROM v_swap.requester_id THEN
    RETURN 'unavailable';
  END IF;

  SELECT * INTO v_party FROM public.crew_parties WHERE id = v_slot.party_id;
  IF v_party.status <> 'published' OR v_party.starts_at <= now() THEN RETURN 'party_closed'; END IF;

  IF v_slot.role = 'lead' AND NOT (v_m.can_lead OR v_m.is_owner) THEN RETURN 'not_lead'; END IF;

  IF NOT coalesce(p_by_admin, false) AND v_swap.offered_to_all_at IS NULL AND NOT EXISTS (
       SELECT 1 FROM public.crew_standbys sb WHERE sb.party_id = v_slot.party_id
          AND sb.member_id = p_member_id AND sb.withdrawn_at IS NULL) THEN
    RETURN 'not_standby';
  END IF;

  IF EXISTS (SELECT 1 FROM public.crew_slots s WHERE s.party_id = v_slot.party_id
             AND s.member_id = p_member_id AND s.status IN ('assigned', 'completed', 'no_show')) THEN
    RETURN 'already_on_party';
  END IF;

  UPDATE public.crew_slots
     SET member_id = p_member_id, assigned_at = now(),
         assigned_via = CASE WHEN coalesce(p_by_admin, false) THEN 'admin' ELSE 'cover' END,
         assigned_by = CASE WHEN coalesce(p_by_admin, false) THEN p_actor ELSE NULL END,
         confirmed_at = now(),          -- claiming a cover at short notice IS the confirmation
         covered_swap_id = p_swap_id
   WHERE id = v_slot.id;

  UPDATE public.crew_swap_requests
     SET status = 'claimed', claimed_by = p_member_id, claimed_at = now(), resolved_at = now()
   WHERE id = p_swap_id;

  UPDATE public.crew_standbys SET withdrawn_at = now()
   WHERE party_id = v_slot.party_id AND member_id = p_member_id AND withdrawn_at IS NULL;

  SELECT steps INTO v_req_steps FROM public.crew_members WHERE id = v_swap.requester_id;
  INSERT INTO public.crew_events (member_id, type, step_before, step_delta, step_after, party_id, slot_id, swap_id, created_by)
  VALUES
    (v_swap.requester_id, 'late_cancel_covered', v_req_steps, 0, v_req_steps, v_slot.party_id, v_slot.id, p_swap_id, 'system'),
    (p_member_id, 'cover_claimed', v_m.steps, 0, v_m.steps, v_slot.party_id, v_slot.id, p_swap_id,
     CASE WHEN coalesce(p_by_admin, false) THEN coalesce(p_actor, 'ADMIN') ELSE 'crew' END);
  RETURN 'claimed';
END;
$$;

-- "Drop anyway": the person cancelling leaves a late cancel nobody claimed.
-- Returns: dropped | unavailable | stale
CREATE OR REPLACE FUNCTION public.crew_drop_uncovered(
  p_swap_id uuid, p_member_id uuid, p_expected_steps int, p_steps_after int, p_waived_grace boolean,
  p_meta jsonb DEFAULT '{}'
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_swap public.crew_swap_requests%ROWTYPE;
  v_slot public.crew_slots%ROWTYPE;
BEGIN
  SELECT * INTO v_swap FROM public.crew_swap_requests WHERE id = p_swap_id FOR UPDATE;
  IF NOT FOUND OR v_swap.status NOT IN ('open', 'escalated') OR v_swap.requester_id <> p_member_id THEN
    RETURN 'unavailable';
  END IF;
  SELECT * INTO v_slot FROM public.crew_slots WHERE id = v_swap.slot_id FOR UPDATE;
  IF v_slot.status <> 'assigned' OR v_slot.member_id IS DISTINCT FROM p_member_id THEN RETURN 'unavailable'; END IF;

  IF NOT public.crew__cas_steps(p_member_id, p_expected_steps, p_steps_after) THEN RETURN 'stale'; END IF;

  UPDATE public.crew_slots
     SET status = 'open', member_id = NULL, assigned_at = NULL, assigned_via = NULL, assigned_by = NULL,
         confirmed_at = NULL, covered_swap_id = NULL
   WHERE id = v_slot.id;
  UPDATE public.crew_swap_requests SET status = 'dropped_uncovered', resolved_at = now() WHERE id = p_swap_id;

  INSERT INTO public.crew_events (member_id, type, step_before, step_delta, step_after, waived_grace,
                                  party_id, slot_id, swap_id, metadata, created_by)
  VALUES (p_member_id, 'late_cancel_uncovered', p_expected_steps, p_steps_after - p_expected_steps, p_steps_after,
          coalesce(p_waived_grace, false), v_slot.party_id, v_slot.id, p_swap_id, coalesce(p_meta, '{}'), 'crew');
  RETURN 'dropped';
END;
$$;

-- Attendance, pay, tips and steps for a whole party in ONE transaction.
-- p_outcomes: [{ slot_id, outcome: 'worked'|'no_show', expected_steps, base_steps,
--   steps_after, waived_grace, pay_cents, step_at_pay, extra_cents, tip_cents,
--   tip_topup_cents, paid_method, paid_note, paid_at, shift_started_at,
--   shift_ended_at, hours_worked, meta }]
-- base_steps = expected_steps unless this CORRECTS an earlier outcome, in which
-- case it is expected_steps with that outcome's change reverted (rules.ts).
-- Raises crew_stale (and rolls everything back) on any compare-and-swap miss.
CREATE OR REPLACE FUNCTION public.crew_mark_attendance(p_party_id uuid, p_outcomes jsonb, p_actor text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_party  public.crew_parties%ROWTYPE;
  v_slot   public.crew_slots%ROWTYPE;
  v_owner  boolean;
  v_prior  public.crew_events%ROWTYPE;
  v_o      jsonb;
  v_kind   text;
  v_exp    int;
  v_base   int;
  v_after  int;
  v_seq    int;
  v_marked int := 0;
  v_voided int := 0;
BEGIN
  IF jsonb_typeof(p_outcomes) <> 'array' THEN RAISE EXCEPTION 'crew_invalid_outcomes'; END IF;

  SELECT * INTO v_party FROM public.crew_parties WHERE id = p_party_id FOR UPDATE;
  IF NOT FOUND OR v_party.status = 'cancelled' THEN RAISE EXCEPTION 'crew_party_not_markable'; END IF;

  FOR v_o IN SELECT * FROM jsonb_array_elements(p_outcomes) LOOP
    v_kind := v_o->>'outcome';
    IF v_kind NOT IN ('worked', 'no_show') THEN RAISE EXCEPTION 'crew_invalid_outcome'; END IF;

    SELECT * INTO v_slot FROM public.crew_slots WHERE id = (v_o->>'slot_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_slot.party_id <> p_party_id OR v_slot.member_id IS NULL
       OR v_slot.status NOT IN ('assigned', 'completed', 'no_show') THEN
      RAISE EXCEPTION 'crew_slot_not_markable';
    END IF;
    SELECT is_owner INTO v_owner FROM public.crew_members WHERE id = v_slot.member_id;

    v_exp   := (v_o->>'expected_steps')::int;
    v_base  := coalesce((v_o->>'base_steps')::int, v_exp);
    v_after := (v_o->>'steps_after')::int;
    IF coalesce(v_owner, false) THEN v_base := v_exp; v_after := v_exp; END IF;

    -- The live outcome this one replaces, if any: the newest attendance row nobody has voided.
    SELECT e.* INTO v_prior FROM public.crew_events e
     WHERE e.slot_id = v_slot.id AND e.type IN ('worked', 'no_show')
       AND NOT EXISTS (SELECT 1 FROM public.crew_events x WHERE x.voids_event_id = e.id)
     ORDER BY e.attendance_seq DESC LIMIT 1;
    v_seq := CASE WHEN FOUND THEN v_prior.attendance_seq + 1 ELSE 1 END;

    IF NOT public.crew__cas_steps(v_slot.member_id, v_exp, v_after) THEN
      RAISE EXCEPTION 'crew_stale' USING DETAIL = v_slot.member_id::text;
    END IF;

    IF v_seq > 1 THEN
      INSERT INTO public.crew_events (member_id, type, step_before, step_delta, step_after, party_id, slot_id,
                                      voids_event_id, metadata, created_by)
      VALUES (v_slot.member_id, 'admin_adjustment', v_exp, v_base - v_exp, v_base, p_party_id, v_slot.id,
              v_prior.id, jsonb_build_object('kind', 'attendance_void'), coalesce(p_actor, 'ADMIN'));
      v_voided := v_voided + 1;
    END IF;

    IF v_kind = 'worked' THEN
      UPDATE public.crew_slots SET
        status           = 'completed',
        pay_cents        = CASE WHEN v_owner THEN NULL ELSE (v_o->>'pay_cents')::int END,
        step_at_pay      = CASE WHEN v_owner THEN NULL ELSE (v_o->>'step_at_pay')::int END,
        extra_cents      = CASE WHEN v_owner THEN NULL ELSE (v_o->>'extra_cents')::int END,
        tip_cents        = CASE WHEN v_owner THEN NULL ELSE (v_o->>'tip_cents')::int END,
        tip_topup_cents  = CASE WHEN v_owner THEN NULL ELSE (v_o->>'tip_topup_cents')::int END,
        paid_method      = CASE WHEN v_owner THEN NULL ELSE v_o->>'paid_method' END,
        paid_note        = CASE WHEN v_owner THEN NULL ELSE nullif(v_o->>'paid_note', '') END,
        paid_at          = CASE WHEN v_owner THEN NULL ELSE coalesce((v_o->>'paid_at')::timestamptz, now()) END,
        shift_started_at = (v_o->>'shift_started_at')::timestamptz,
        shift_ended_at   = (v_o->>'shift_ended_at')::timestamptz,
        hours_worked     = (v_o->>'hours_worked')::numeric
      WHERE id = v_slot.id;
    ELSE
      UPDATE public.crew_slots SET
        status = 'no_show', pay_cents = NULL, step_at_pay = NULL, extra_cents = NULL, tip_cents = NULL,
        tip_topup_cents = NULL, paid_method = NULL, paid_note = NULL, paid_at = NULL,
        shift_started_at = NULL, shift_ended_at = NULL, hours_worked = NULL
      WHERE id = v_slot.id;
      IF NOT coalesce(v_owner, false) THEN
        UPDATE public.crew_members SET needs_review = true WHERE id = v_slot.member_id;
      END IF;
    END IF;

    INSERT INTO public.crew_events (member_id, type, step_before, step_delta, step_after, waived_grace,
                                    party_id, slot_id, swap_id, attendance_seq, metadata, created_by)
    VALUES (v_slot.member_id, v_kind::public.crew_event_type, v_base, v_after - v_base, v_after,
            coalesce((v_o->>'waived_grace')::boolean, false), p_party_id, v_slot.id, v_slot.covered_swap_id,
            v_seq, coalesce(v_o->'meta', '{}'), coalesce(p_actor, 'ADMIN'));
    v_marked := v_marked + 1;
  END LOOP;

  UPDATE public.crew_parties SET status = 'completed', attendance_marked_at = now() WHERE id = p_party_id;
  RETURN jsonb_build_object('marked', v_marked, 'voided', v_voided);
END;
$$;

-- Allie sets a member's step, with a required reason.
-- Returns: set | stale | owner | invalid
CREATE OR REPLACE FUNCTION public.crew_admin_set_steps(
  p_member_id uuid, p_expected_steps int, p_steps_after int, p_reason text, p_actor text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_owner boolean;
BEGIN
  IF btrim(coalesce(p_reason, '')) = '' OR p_steps_after IS NULL OR p_steps_after NOT BETWEEN 0 AND 8 THEN
    RETURN 'invalid';
  END IF;
  SELECT is_owner INTO v_owner FROM public.crew_members WHERE id = p_member_id;
  IF NOT FOUND THEN RETURN 'invalid'; END IF;
  IF v_owner THEN RETURN 'owner'; END IF;
  IF NOT public.crew__cas_steps(p_member_id, p_expected_steps, p_steps_after) THEN RETURN 'stale'; END IF;
  INSERT INTO public.crew_events (member_id, type, step_before, step_delta, step_after, metadata, created_by)
  VALUES (p_member_id, 'admin_adjustment', p_expected_steps, p_steps_after - p_expected_steps, p_steps_after,
          jsonb_build_object('kind', 'step_override', 'reason', btrim(p_reason)), coalesce(p_actor, 'ADMIN'));
  RETURN 'set';
END;
$$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'crew_set_updated_at()',
    'crew_slots_guard()',
    'crew__cas_steps(uuid, int, int)',
    'crew_claim_slot(uuid, uuid)',
    'crew_admin_assign(uuid, uuid, text)',
    'crew_release_slot(uuid, uuid, text, text, text, numeric, int, int, boolean, jsonb)',
    'crew_claim_swap(uuid, uuid, boolean, text)',
    'crew_drop_uncovered(uuid, uuid, int, int, boolean, jsonb)',
    'crew_mark_attendance(uuid, jsonb, text)',
    'crew_admin_set_steps(uuid, int, int, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM public, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- ── SEED ────────────────────────────────────────────────────────────────────
INSERT INTO public.crew_settings (key, value, description) VALUES
  ('pay', '{"crew_start_cents": 5000, "lead_start_cents": 7000, "step_cents": 250, "max_steps": 8, "tip_floor_cents": 2000}',
   'Flat pay per party. Rate = start + steps x step_cents. Tips are topped up to tip_floor_cents per person (a Host Hampton cost). max_steps cannot exceed 8.'),
  ('steps', '{"worked": 1, "covered": 2, "early_release": -1}',
   'Step changes. A late cancel with no cover and a no-show reset to 0. A covered party counts as covered in place of worked.'),
  ('slots_by_guests', '{"min_slots": 3, "kids_per_crew": 4, "max_slots": 10}',
   'Crew needed, including the Lead = max(min_slots, ceil(kids / kids_per_crew)), capped at max_slots.'),
  ('shift', '{"setup_minutes": 30, "cleanup_minutes": 30}',
   'Hours on record only (overlap checks and the time record). Never changes pay.'),
  ('drops', '{"late_drop_days": 7, "standby_window_hours": 2, "unclaimed_warning_hours": 48}',
   'Under late_drop_days notice is a late cancel. Standbys get standby_window_hours before it escalates to Allie.'),
  ('confirmations', '{"request_hours_before": 120, "reminder_hours_before": 96, "due_hours_before": 72, "day_before_hours": 24}',
   'Confirmation timing relative to party start.'),
  ('launch', '{"launch_date": null, "grace_days": 60}',
   'Step losses and resets are recorded but not applied until launch_date + grace_days (ET). Unset = not launched.'),
  ('lead', '{"alert_days_before": 7}',
   'Alert Allie if a published party has no Lead this many days before it starts.'),
  ('availability', '{"due_day_of_month": 15, "reminder_day_of_month": 10}',
   'Next month''s availability is due on this day of the current month.'),
  ('attendance', '{"alert_hours_after_end": 12}',
   'Alert Allie if attendance is not marked this long after a party ends.')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.crew_members (first_name, is_owner, can_lead, status, email_opt_in, sms_opt_in)
SELECT 'Allie', true, true, 'active', false, false
WHERE NOT EXISTS (SELECT 1 FROM public.crew_members WHERE is_owner);

COMMIT;

-- Proof.
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'crew\_%' AND rowsecurity) AS crew_tables_rls_on,
  (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'crew\_%')            AS crew_policies,
  (SELECT count(*) FROM public.crew_settings)                                                           AS settings_rows,
  (SELECT count(*) FROM public.crew_members WHERE is_owner)                                             AS owner_rows,
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'crew\_%' AND has_function_privilege('anon', p.oid, 'EXECUTE')) AS fns_anon_can_execute;
