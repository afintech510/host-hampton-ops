-- Migration 035 — party plan as lead (Phase 4)
--
-- "Every lead is a Party Plan": one `bookings` row from the first touch, able to
-- hold any of the three products. Today `bookings` is shaped for a *booked*
-- party — party_date, party_time, contact_email and event_type are all NOT NULL
-- — so a lead that arrives as "hi, do you do mobile parties?" cannot be stored
-- at all. This migration makes the row able to start empty and fill in.
--
-- Apply:
--   ssh hampton-vps "/root/pg.sh -v ON_ERROR_STOP=1 --single-transaction -f -" < this file
--
-- Idempotent: safe to re-run.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. status — a real CHECK, with 'lead' and 'quoted' added
-- ─────────────────────────────────────────────────────────────────────────
-- The set is what PartiesTab.tsx:42-51 already renders plus the two new
-- pipeline entry states. 'confirmed' is in the set because 2 live rows use it
-- (api/checkout writes it); dropping it would fail the constraint on add.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_status_check CHECK (
  status IN (
    'lead', 'quoted',
    'pending_review', 'awaiting_deposit', 'deposit_paid', 'confirmed',
    'approved', 'modifications_locked', 'paid_in_full',
    'completed', 'cancelled'
  )
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. party_type — replaces relying on the inconsistent `event_type`
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS party_type TEXT;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_party_type_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_party_type_check CHECK (
  party_type IS NULL OR party_type IN
    ('in_studio_theme', 'mobile_party', 'studio_rental', 'unknown')
);

-- Backfill mirrors lib/inquiryDrafts.ts classifyPartyType(): same hint lists,
-- same precedence (explicit event_type slug, then mobile, then studio rental,
-- then in-studio theme, then the child-details fallback, else unknown).
-- Kept as SQL rather than a script so the migration is self-contained; the
-- canonical implementation stays the TS one, which every writer calls.
WITH hay AS (
  SELECT
    id,
    lower(regexp_replace(coalesce(event_type, ''), '[_-]+', ' ', 'g')) AS et,
    lower(regexp_replace(
      concat_ws(' ',
        coalesce(event_type, ''), coalesce(package_type, ''),
        coalesce(notes, ''), coalesce(party_tags::text, '')),
      '[_-]+', ' ', 'g')) AS h,
    child_name, child_age, package_type
  FROM public.bookings
)
UPDATE public.bookings b
SET party_type = CASE
  WHEN btrim(hay.et) IN ('studio rental', 'room rental') THEN 'studio_rental'
  WHEN hay.h ~ '(mobile|at home|at your home|come to|off site|craft party)' THEN 'mobile_party'
  WHEN hay.h ~ '(studio rental|room rental|rent the|private rental|venue rental)' THEN 'studio_rental'
  WHEN hay.h ~ '(kids party|kids birthday|birthday party|theme party|themed party|team party|communion|first birthday|toddler party|glow party|slime party|party package)' THEN 'in_studio_theme'
  WHEN (hay.child_age IS NOT NULL OR hay.child_name IS NOT NULL) AND hay.package_type IS NOT NULL THEN 'in_studio_theme'
  ELSE 'unknown'
END
FROM hay
WHERE b.id = hay.id AND b.party_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_party_type ON public.bookings (party_type);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. provenance — where the plan came from, and the event that started it
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_source_check CHECK (
  source IS NULL OR source IN
    ('website_form', 'email', 'sms', 'admin', 'phone', 'walk_in')
);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS first_touch_event_id UUID REFERENCES public.ingested_messages(id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. invoice_number — one sequence, the locked 444124-NNNNNN format
-- ─────────────────────────────────────────────────────────────────────────
-- Starts at 116: the hand-built files in invoices/ run up to 444124-000115,
-- so the sequence continues where the grep left off and can never collide
-- with one of Adam's existing PDFs.
CREATE SEQUENCE IF NOT EXISTS public.invoice_number_seq START WITH 116;
-- A freshly created sequence reports last_value=116 with is_called=false, which
-- would make the FIRST nextval return 117 and silently skip 116. Park it on
-- 115/is_called so the first number issued is exactly 444124-000116. On re-run
-- after numbers have been issued this is a no-op — it must never rewind.
SELECT CASE WHEN NOT is_called OR last_value < 115
            THEN setval('public.invoice_number_seq', 115, true) END
FROM public.invoice_number_seq;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS invoice_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_invoice_number
  ON public.bookings (invoice_number) WHERE invoice_number IS NOT NULL;

-- Assigned on first invoice/summary render (Phase 5), not at insert — a lead
-- that never quotes should not burn an invoice number.
CREATE OR REPLACE FUNCTION public.next_invoice_number() RETURNS TEXT
LANGUAGE sql VOLATILE AS $$
  SELECT '444124-' || lpad(nextval('public.invoice_number_seq')::text, 6, '0');
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. a lead can start almost empty
-- ─────────────────────────────────────────────────────────────────────────
-- An SMS-only lead has a phone and nothing else; a "do you do mobile parties?"
-- email has no date. These four NOT NULLs are what made a lead unstorable.
ALTER TABLE public.bookings ALTER COLUMN contact_email DROP NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN party_date   DROP NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN party_time   DROP NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN contact_name DROP NOT NULL;

-- ...but we must still be reachable. At least one of email/phone, always.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_contact_reachable_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_contact_reachable_check CHECK (
  nullif(btrim(coalesce(contact_email, '')), '') IS NOT NULL
  OR nullif(btrim(coalesce(contact_phone, '')), '') IS NOT NULL
);

-- The relaxation is scoped to the pipeline's front end. Once a plan is past
-- 'quoted' it is a real party and must have a date, a time and a name again —
-- this keeps every downstream consumer (calendar sync, reminders, the portal)
-- as safe as it was before this migration.
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_scheduled_fields_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_scheduled_fields_check CHECK (
  status IN ('lead', 'quoted', 'cancelled')
  OR (party_date IS NOT NULL AND party_time IS NOT NULL AND contact_name IS NOT NULL)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 6. booking_line_items — what the invoice template needs to render
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.booking_line_items ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.booking_line_items ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.booking_line_items ADD COLUMN IF NOT EXISTS is_optional BOOLEAN NOT NULL DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. booking_pay_links — today's Stripe pay links are untraceable
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_pay_links (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id              UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  purpose                 TEXT NOT NULL CHECK (purpose IN ('deposit', 'balance', 'custom')),
  amount_cents            INTEGER NOT NULL,
  fee_cents               INTEGER NOT NULL DEFAULT 0,
  stripe_payment_link_id  TEXT,
  stripe_price_id         TEXT,
  url                     TEXT NOT NULL,
  created_by              TEXT NOT NULL DEFAULT 'system',
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_bpl_booking ON public.booking_pay_links (booking_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bpl_stripe_link
  ON public.booking_pay_links (stripe_payment_link_id) WHERE stripe_payment_link_id IS NOT NULL;

ALTER TABLE public.booking_pay_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role full access" ON public.booking_pay_links;
CREATE POLICY "Service role full access" ON public.booking_pay_links
  USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────────────────────────────────────
-- 8. booking_payments — the admin dropdown already offers these two
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.booking_payments DROP CONSTRAINT IF EXISTS booking_payments_payment_method_check;
ALTER TABLE public.booking_payments ADD CONSTRAINT booking_payments_payment_method_check CHECK (
  payment_method IN ('card', 'cash', 'venmo', 'zelle', 'check', 'other')
);

COMMIT;
