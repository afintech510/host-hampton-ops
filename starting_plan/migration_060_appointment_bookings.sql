-- Migration 060 — generic appointment bookings, and the end of summer_hair_bookings.
--
-- ── WHY THIS TABLE EXISTS ──
--
-- `summer_hair_bookings` was built for ONE DAY: Friday 3 July 2026. It worked —
-- 16 real bookings — and then the event passed. Three months later the table was
-- still holding 16 people's names, emails and phone numbers, the admin sidebar
-- still said "Summer Hair", and running the same day again meant a
-- find-and-replace across six source files.
--
-- Adam wants Halloween Hair, Christmas Hair and Permanent Jewelry next, and more
-- after that. So the event stops being the table's name and becomes a COLUMN —
-- `event_slug`, resolved against `services/website/src/lib/appointmentEvents.ts`
-- the way `market_vendors.market_slug` resolves against `lib/christmasMarket.ts`.
-- Adding an event is a config entry and a deploy. Not a migration.
--
-- ── THE DROP, AND WHAT CAME BEFORE IT ──
--
-- This answers docs/NEEDS-ADAM.md B10 ("retire summer_hair_bookings?"): yes.
-- All 16 rows were exported first, with Supabase MCP, to
--
--     audit_scratch/summer_hair_bookings_export_2026-09-24.csv
--
-- which is gitignored and must never be committed — it is 16 customers' contact
-- details. Adam confirmed the export before this statement was run. Nothing in
-- the codebase reads the table after this migration: the route, the admin tab,
-- the cron job, the email template and the public banner are all deleted in the
-- same commit.
--
-- migration_018 and migration_019 stay on disk unchanged as the historical
-- record of what the table was.
--
-- ── WHAT IS DELIBERATE HERE ──
--
--   1. `slot_index` is CANONICAL and `time_slot` is a rendering of it. The old
--      table stored only the human label ('10:20 AM'), so every consumer had to
--      keep its own copy of the 18-slot grid and `indexOf` into it to find out
--      when a booking actually was — which is how the grid came to be written
--      out in three files. An integer makes the holds table below joinable and
--      turns the cron's `slotToMinutesSinceMidnight` into arithmetic.
--
--   2. `appointment_slot_holds` with a COMPOSITE PRIMARY KEY is the whole
--      double-booking fix, and it is worth being precise about what it replaces.
--      The old route read every confirmed row into a `Set` of occupied indices,
--      checked membership, and then inserted unconditionally. There was no
--      unique constraint and no index on `time_slot`, so two concurrent requests
--      for the same slot both read an empty set and both succeeded. Measured:
--      20 simultaneous POSTs for one start time produced 20 bookings.
--
--      No RPC, no btree_gist, no extension. A multi-row INSERT is atomic, so
--      either every slot a booking needs is claimed or none is, and a concurrent
--      overlap gets 23505 — which the route matches BY CODE and turns into a
--      409. `services/website/src/lib/planPayment.ts` already has
--      `isUniqueViolation` for exactly this; matching on the message text is how
--      a guard stops working when a driver changes its wording.
--
--   3. `expires_at` on a hold is for the `pending_payment` path. A customer who
--      opens a Stripe checkout and closes the tab would otherwise hold a slot
--      for the rest of the day, silently. It is NULLed when the booking
--      confirms — a confirmed booking's hold does not expire.
--
--   4. `contact_id` and `phone_e164`. The old public POST never called
--      `upsertContact`, so a Summer Hair booker never landed in `contacts` at
--      all and the reminder cron had to hunt for them by phone to check consent.
--      Both columns are nullable: a contacts outage must not cost us the
--      appointment, which is the customer's actual intent.
--
--   5. `paid_at` is the webhook's idempotency signal, following migration 059.
--      The row is written BEFORE Stripe, so "does a row exist" proves nothing;
--      "has it been paid" is the question, and the update is `.is('paid_at',
--      null)` so two redeliveries cannot both win.
--
-- Safe to re-run.

BEGIN;

-- ── The drop ────────────────────────────────────────────────────────────────
-- FIRST statement, and exported first. See the header.
DROP TABLE IF EXISTS public.summer_hair_bookings;

-- ── The bookings ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.appointment_bookings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which event. Resolved against lib/appointmentEvents.ts, not an FK: the
  -- registry is code, the same way market_vendors.market_slug is.
  event_slug            text NOT NULL,

  -- Who. `phone` is the display form exactly as typed, because that is what an
  -- admin reads back to a customer; `phone_e164` is the normalised key.
  name                  text NOT NULL,
  email                 text NOT NULL,
  phone                 text NOT NULL,
  phone_e164            text,
  contact_id            uuid REFERENCES public.contacts(id),

  -- When. `slot_index` is the truth; `time_slot` is its label, kept so the admin
  -- list and the confirmation email do not have to re-derive it from config that
  -- may have moved since the booking was taken.
  slot_index            integer NOT NULL,
  time_slot             text NOT NULL,
  slots_needed          integer NOT NULL DEFAULT 1,

  -- What. Service IDS, verbatim from the registry.
  services              jsonb NOT NULL DEFAULT '[]',
  party_size            integer NOT NULL DEFAULT 1,
  notes                 text,

  status                text NOT NULL DEFAULT 'confirmed',

  -- Money. What they were quoted, as a FACT, so an admin screen never has to
  -- recompute a historical price from today's config (migration 059, note 3).
  estimated_total_cents integer,
  amount_paid_cents     integer NOT NULL DEFAULT 0,
  paid_at               timestamptz,
  stripe_session_id     text,

  reminder_sent         boolean NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz
);

-- The route's copy of this list is APPOINTMENT_STATUSES in lib/appointmentEvents.ts.
-- The database keeps its own for the same reason migration 054 and 059 do: a
-- value that passes the route but not the constraint is a row no screen knows
-- how to render.
ALTER TABLE public.appointment_bookings
  DROP CONSTRAINT IF EXISTS appointment_bookings_status_check;
ALTER TABLE public.appointment_bookings
  ADD CONSTRAINT appointment_bookings_status_check
  CHECK (status IN ('pending_payment', 'confirmed', 'cancelled'));

-- A booking occupies at least one slot, starting somewhere in the day. The
-- upper bound is the event's `slotCount` and lives in the route, because it
-- differs per event and the database has no registry.
ALTER TABLE public.appointment_bookings
  DROP CONSTRAINT IF EXISTS appointment_bookings_slot_bounds_check;
ALTER TABLE public.appointment_bookings
  ADD CONSTRAINT appointment_bookings_slot_bounds_check
  CHECK (slot_index >= 0 AND slots_needed >= 1 AND party_size >= 1);

-- ── The slot holds — THE double-booking fix ─────────────────────────────────
--
-- One row per (event, slot). The PRIMARY KEY is the mechanism; see header note 2.
CREATE TABLE IF NOT EXISTS public.appointment_slot_holds (
  event_slug   text NOT NULL,
  slot_index   integer NOT NULL,
  booking_id   uuid NOT NULL REFERENCES public.appointment_bookings(id) ON DELETE CASCADE,
  -- Set while a booking is pending_payment; NULLed when it confirms.
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_slug, slot_index)
);

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- The admin list and the availability read: "everything for this event".
CREATE INDEX IF NOT EXISTS idx_appointment_bookings_event
  ON public.appointment_bookings (event_slug, status);

-- The reminder cron's exact predicate.
CREATE INDEX IF NOT EXISTS idx_appointment_bookings_reminders
  ON public.appointment_bookings (event_slug, status, reminder_sent);

-- Cancel, restore and adjust_duration all reach the holds by booking.
CREATE INDEX IF NOT EXISTS idx_appointment_slot_holds_booking
  ON public.appointment_slot_holds (booking_id);

-- The abandoned-checkout sweep: "which holds have expired?"
CREATE INDEX IF NOT EXISTS idx_appointment_slot_holds_expiry
  ON public.appointment_slot_holds (expires_at)
  WHERE expires_at IS NOT NULL;

-- Stripe redelivers. PARTIAL, because every in-person booking has a NULL
-- session id and several NULLs are not a collision.
CREATE UNIQUE INDEX IF NOT EXISTS idx_appointment_bookings_stripe_session
  ON public.appointment_bookings (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- Case-insensitive, because `contacts.email` being raw `text` is how 8 real
-- people ended up duplicated. "Has this person already booked?" must not depend
-- on capitals.
CREATE INDEX IF NOT EXISTS idx_appointment_bookings_email_lower
  ON public.appointment_bookings (event_slug, lower(email));

-- ── updated_at ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_appointment_bookings_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointment_bookings_updated_at ON public.appointment_bookings;
CREATE TRIGGER appointment_bookings_updated_at
  BEFORE UPDATE ON public.appointment_bookings
  FOR EACH ROW EXECUTE FUNCTION public.touch_appointment_bookings_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
--
-- There is NO public read policy on either table. An appointment list is real
-- customers' names, emails and mobile numbers; the only readers are the service
-- role (the API routes) and an admin. The availability endpoint returns
-- BOOLEANS per slot and never a row, which is why a public read policy is not
-- needed to make the public form work.

ALTER TABLE public.appointment_bookings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'appointment_bookings'
      AND policyname = 'Service role full access on appointment_bookings'
  ) THEN
    CREATE POLICY "Service role full access on appointment_bookings"
      ON public.appointment_bookings
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'appointment_bookings'
      AND policyname = 'Admin full access appointment_bookings'
  ) THEN
    CREATE POLICY "Admin full access appointment_bookings"
      ON public.appointment_bookings
      USING (is_owner_or_admin())
      WITH CHECK (is_owner_or_admin());
  END IF;
END $$;

ALTER TABLE public.appointment_slot_holds ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'appointment_slot_holds'
      AND policyname = 'Service role full access on appointment_slot_holds'
  ) THEN
    CREATE POLICY "Service role full access on appointment_slot_holds"
      ON public.appointment_slot_holds
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'appointment_slot_holds'
      AND policyname = 'Admin full access appointment_slot_holds'
  ) THEN
    CREATE POLICY "Admin full access appointment_slot_holds"
      ON public.appointment_slot_holds
      USING (is_owner_or_admin())
      WITH CHECK (is_owner_or_admin());
  END IF;
END $$;

COMMIT;
