-- Migration 009: Party Builder Flow
-- Adds booking_payments, booking_line_items, booking_modifications tables
-- Extends bookings and pricing_items for the party builder / invoicing system

-- ═══════════════════════════════════════════════════════════════
-- 1. New table: booking_line_items (itemized charges per booking)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.booking_line_items (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  pricing_item_id UUID REFERENCES public.pricing_items(id),
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,
  quantity        INT NOT NULL DEFAULT 1,
  unit_price_cents INT NOT NULL,
  price_type      TEXT NOT NULL DEFAULT 'flat',
  guest_multiplied BOOLEAN NOT NULL DEFAULT false,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bli_booking ON public.booking_line_items(booking_id);

-- ═══════════════════════════════════════════════════════════════
-- 2. New table: booking_payments (payment ledger per booking)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.booking_payments (
  id                        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id                UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  payment_type              TEXT NOT NULL CHECK (payment_type IN ('deposit', 'partial', 'final', 'refund')),
  payment_method            TEXT NOT NULL DEFAULT 'card' CHECK (payment_method IN ('card', 'cash', 'venmo', 'zelle')),
  amount_cents              INT NOT NULL,
  card_fee_cents            INT NOT NULL DEFAULT 0,
  total_charged_cents       INT NOT NULL,
  stripe_payment_intent_id  TEXT,
  stripe_session_id         TEXT,
  recorded_by               TEXT NOT NULL DEFAULT 'system' CHECK (recorded_by IN ('system', 'admin')),
  notes                     TEXT,
  paid_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bp_booking ON public.booking_payments(booking_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bp_stripe_session ON public.booking_payments(stripe_session_id) WHERE stripe_session_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 3. New table: booking_modifications (audit log)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.booking_modifications (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  modified_by     TEXT NOT NULL CHECK (modified_by IN ('customer', 'admin', 'system')),
  change_summary  TEXT NOT NULL,
  old_data        JSONB,
  new_data        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bm_booking ON public.booking_modifications(booking_id, created_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 4. New table: portal_tokens (magic link auth for customer portal)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.portal_tokens (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id  UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pt_booking ON public.portal_tokens(booking_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. Extend bookings table
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS total_cents INT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS balance_due_cents INT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS card_fee_rate NUMERIC(4,4) DEFAULT 0.03;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS paid_in_full_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS modification_cutoff DATE;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS guest_count_cutoff DATE;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS portal_token_hash TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS quote_snapshot JSONB;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS payment_method_preference TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS admin_notes TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS final_balance_notified BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════
-- 6. Extend pricing_items table
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.pricing_items ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE public.pricing_items ADD COLUMN IF NOT EXISTS is_upsell BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════
-- 7. Enable RLS on new tables
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.booking_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_modifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.booking_line_items
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON public.booking_payments
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON public.booking_modifications
  FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Service role full access" ON public.portal_tokens
  FOR ALL USING (true) WITH CHECK (true);
