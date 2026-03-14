-- migration_009: Coupons table for tracking promo codes
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.coupons (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text UNIQUE NOT NULL,
  contact_id    uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  discount_pct  smallint NOT NULL DEFAULT 10,
  source        text NOT NULL DEFAULT 'signup_sheet',
  redeemed      boolean NOT NULL DEFAULT false,
  redeemed_at   timestamptz,
  booking_id    uuid,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Index for quick lookup by code
CREATE INDEX idx_coupons_code ON public.coupons(code);

-- RLS: only service_role can access
ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on coupons"
  ON public.coupons
  FOR ALL
  USING (true)
  WITH CHECK (true);
