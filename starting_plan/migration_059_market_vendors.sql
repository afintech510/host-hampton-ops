-- Migration 059 — a real table for market vendors, and the Christmas Market event row.
--
-- ── WHY THIS TABLE EXISTS ──
--
-- Vendor registrations already happen on this site. `/vendor-registration` has
-- been live since the Spring Market and **two real vendors paid through it**.
-- Their rows went into `bookings`:
--
--     event_type   = 'vendor_registration'
--     party_date   = the day they signed up (NOT the market date)
--     party_time   = 'TBD'
--     notes        = '{"businessName":"…","igHandle":"@…"}'   ← a JSON STRING
--
-- and then both admin list routes filtered them straight back out again:
--
--     app/api/admin/parties/route.ts:33   NON_PARTY_EVENT_TYPES = ['vendor_registration']
--     app/api/admin/booked/route.ts:46    (the same constant, same effect)
--
-- So the money landed in `financial_transactions` under 'Vendor Fee', the person
-- landed in `contacts`, and the REGISTRATION — who is coming, what they sell,
-- whether they need power — was visible on no screen at all. It was only ever
-- readable by hand-parsing a JSON string out of a party booking's notes field.
--
-- That is the same shape as the bug in link 33: a writer existed, a reader did
-- not, and nobody noticed because the ledger looked right. A vendor is not a
-- party booking and storing it as one is what made it invisible.
--
-- ── WHAT IS DELIBERATE HERE ──
--
--   1. `market_slug`, not a christmas-specific table. This is the THIRD annual
--      market and there was a spring one; the next registration surface should
--      cost a config entry, not a migration. It is plain text rather than an FK
--      to `events` because the vendor form must work before anyone has created
--      the event row, and a vendor is not a ticket holder.
--
--   2. `status = 'pending_payment'` is the DEFAULT, and the row is written
--      BEFORE Stripe is called — not from the webhook the way
--      `vendor_registration` does it. The ask was "collects their info AND
--      payment", and a row created only on `checkout.session.completed` loses
--      every vendor who fills the form and then abandons the card page. Those
--      are exactly the people worth a follow-up text. The webhook flips the row
--      to 'paid'; it does not create it.
--
--   3. `paid_at` is the idempotency signal for the webhook's side effects.
--      Stripe redelivers, and the second delivery must not send a second
--      confirmation email or write a second ledger row. The partial unique index
--      on `stripe_session_id` is the database's half of the same guarantee.
--
--   4. The Venmo path writes a row too, at 'pending_payment', and is what the
--      API returns the payment credentials in response TO. The reveal is
--      therefore SERVER-gated: the information is captured before the handle is
--      handed over, which a client-side `classList.toggle` (the /esm-sharks
--      reveal, lines 316-323) cannot promise.
--
-- Safe to re-run.

BEGIN;

-- ── Vendor reference numbers ────────────────────────────────────────────────
-- A sequence rather than `Date.now().toString().slice(-4)`, which is what
-- `booking_ref` does for vendors today: a ten-second-wide space against a UNIQUE
-- column. Note the accepted cost (link 54): a request that fails after this
-- default fires still burns its number, so the refs have gaps. Gaps are fine;
-- collisions are not.
CREATE SEQUENCE IF NOT EXISTS public.market_vendor_ref_seq START 1;

CREATE TABLE IF NOT EXISTS public.market_vendors (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_ref        text NOT NULL DEFAULT ('HHM-' || lpad(nextval('public.market_vendor_ref_seq')::text, 4, '0')),

  -- Which market. See lib/christmasMarket.ts for the registry of slugs.
  market_slug       text NOT NULL,

  -- Who they are.
  contact_name      text NOT NULL,
  business_name     text NOT NULL,
  ig_handle         text,
  email             text NOT NULL,
  phone             text NOT NULL,

  -- What they sell. `product_category` is the field that makes the "no
  -- duplicates, and nothing that competes with the studio's own services"
  -- door-policy answerable on a screen instead of from memory.
  product_category  text NOT NULL,
  product_description text,

  -- Booth logistics. Vendors bring their own table; power is available but
  -- finite, so who asked for it has to be a column and not a note.
  needs_electricity boolean NOT NULL DEFAULT false,
  booth_note        text,

  -- Money. Every amount the vendor was actually charged, as a fact, so the
  -- admin screen never has to recompute a historical fee from today's config.
  payment_method    text NOT NULL,
  booth_fee_cents   integer NOT NULL,
  service_fee_cents integer NOT NULL DEFAULT 0,
  total_cents       integer NOT NULL,

  status            text NOT NULL DEFAULT 'pending_payment',
  status_note       text,
  notes             text,                     -- Adam's own notes, admin-editable

  stripe_session_id        text,
  stripe_payment_intent_id text,
  paid_at           timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.market_vendors
  ADD CONSTRAINT market_vendors_vendor_ref_key UNIQUE (vendor_ref);

-- The route's copy of these lists is lib/christmasMarket.ts. The database keeps
-- its own for the same reason migration 054 does: a value that passes the route
-- but not the constraint is a row no screen knows how to render.
ALTER TABLE public.market_vendors
  DROP CONSTRAINT IF EXISTS market_vendors_payment_method_check;
ALTER TABLE public.market_vendors
  ADD CONSTRAINT market_vendors_payment_method_check
  CHECK (payment_method IN ('card', 'venmo'));

ALTER TABLE public.market_vendors
  DROP CONSTRAINT IF EXISTS market_vendors_status_check;
ALTER TABLE public.market_vendors
  ADD CONSTRAINT market_vendors_status_check
  CHECK (status IN ('pending_payment', 'paid', 'cancelled', 'waitlist', 'refunded'));

-- A paid row must say when, and an unpaid row must not claim to have been paid.
-- This is the constraint that makes `paid_at` usable as the webhook's
-- idempotency signal rather than merely a display field.
ALTER TABLE public.market_vendors
  DROP CONSTRAINT IF EXISTS market_vendors_paid_at_check;
ALTER TABLE public.market_vendors
  ADD CONSTRAINT market_vendors_paid_at_check
  CHECK ((status = 'paid') = (paid_at IS NOT NULL));

-- The totals have to agree with themselves. A row whose parts do not add up is
-- one the Financials tab and the vendor's own receipt will disagree about.
ALTER TABLE public.market_vendors
  DROP CONSTRAINT IF EXISTS market_vendors_total_check;
ALTER TABLE public.market_vendors
  ADD CONSTRAINT market_vendors_total_check
  CHECK (total_cents = booth_fee_cents + service_fee_cents);

-- ── Idempotency ─────────────────────────────────────────────────────────────
-- Stripe redelivers `checkout.session.completed`. PARTIAL, because every Venmo
-- row has a NULL session id and several NULLs are not a collision.
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_vendors_stripe_session
  ON public.market_vendors (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_market_vendors_market
  ON public.market_vendors (market_slug, status);

CREATE INDEX IF NOT EXISTS idx_market_vendors_created
  ON public.market_vendors (created_at DESC);

-- Case-insensitive, because `contacts.email` being raw `text` is how 8 people
-- ended up duplicated (link 30). "Has this business already signed up?" is a
-- question the admin screen will ask, and it must not depend on capitals.
CREATE INDEX IF NOT EXISTS idx_market_vendors_email_lower
  ON public.market_vendors (market_slug, lower(email));

-- ── updated_at ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_market_vendors_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS market_vendors_updated_at ON public.market_vendors;
CREATE TRIGGER market_vendors_updated_at
  BEFORE UPDATE ON public.market_vendors
  FOR EACH ROW EXECUTE FUNCTION public.touch_market_vendors_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- There is NO public read policy. A vendor list is 9 local business owners'
-- email addresses and mobile numbers; the only readers are the service role
-- (the API routes) and an admin. This is the opposite of `events`, which has a
-- public-read policy because a public event listing is the point.
ALTER TABLE public.market_vendors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role full access on market_vendors" ON public.market_vendors;
CREATE POLICY "Service role full access on market_vendors"
  ON public.market_vendors
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Admin full access market_vendors" ON public.market_vendors;
CREATE POLICY "Admin full access market_vendors"
  ON public.market_vendors
  USING (is_owner_or_admin())
  WITH CHECK (is_owner_or_admin());

-- ── The event row that carries attendee RSVPs ───────────────────────────────
--
-- Deliberately an `events` row and not a new rsvp table. `price_cents = 0` is
-- already the RSVP path end-to-end in this codebase: app/api/events/checkout
-- skips Stripe entirely, writes an `event_tickets` row at 0/0, upserts the
-- contact and sends an "RSVP confirmed" email; EventFilters.tsx renders the CTA
-- as "RSVP →" rather than "Get Tickets →" off the same zero. A separate table
-- would have meant a second admin screen and a second email template to say the
-- same thing worse.
--
-- `max_tickets` is 500, not the table default of 30. This is a free walk-in
-- market on a public road — the number is a sanity ceiling, not a fire code, and
-- a market that "sells out" of free RSVPs at 30 would turn people away from an
-- open door. `available_tickets` is decremented by the checkout route.
--
-- is_active = TRUE, and that is a decision rather than a default.
--
-- It was written `false` first, on the reasoning that Adam should read the copy
-- before it appears on /events. But app/events/[slug]/page.tsx filters
-- `is_active = true` (three times — the page, the sessions, the schema), so an
-- inactive row makes /events/christmas-market-2026 a 404 — and that URL is the
-- target of the site-wide banner and of the RSVP button on /christmas-market.
-- Inactive would have shipped a promotion pointing at a dead link, which is
-- worse than shipping copy that needs an edit. The copy is editable in
-- admin → Events at any time; a 404 under a banner is not a state anyone
-- notices until a customer does.
INSERT INTO public.events (
  slug, title, short_description, description, category,
  price_cents, event_date, event_time, event_end_time,
  location, max_tickets, available_tickets,
  is_active, is_featured
) VALUES (
  'christmas-market-2026',
  '3rd Annual Host Hampton Christmas Market',
  'Free admission, free pictures with Santa, and local vendors — Saturday, December 5th, 10am-1pm.',
  E'Our third annual Christmas Market is back at the studio in Speonk.\n\nShop a curated group of local makers, grab a free photo with Santa, and kick off the holidays with us. Admission is free and everyone is welcome — RSVP so we know how many to expect (and so we can tell you if anything changes).\n\nSaturday, December 5th · 10:00am – 1:00pm\nHost Hampton · 295 Montauk Hwy, Suite 7, Speonk NY',
  'market',
  0,
  '2026-12-05',
  '10:00 AM',
  '1:00 PM',
  'Host Hampton, 295 Montauk Hwy Suite 7, Speonk NY',
  500, 500,
  true, true
)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
