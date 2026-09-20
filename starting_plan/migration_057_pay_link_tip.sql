-- Migration 057 — a tip on an invoice pay link
--
-- Adam, 2026-09-20: the invoice view needs to state the recommended 10% tip and
-- offer a way to add one to the FINAL payment. The party-builder portal has had
-- a tip jar for a while (Payment Element, tip folded into the PaymentIntent
-- amount); the invoice pays by Stripe Payment Link, which is a different path
-- with its own persisted row, so the tip needs somewhere to live on that row.
--
-- ── Why a column and not just Stripe metadata ──────────────────────────────
--
-- `recordPlanPayment` credits `session.amount_total` minus the fee. A tip that
-- the webhook cannot see is therefore a tip that PAYS DOWN THE BALANCE — the
-- customer tips $125 and the plan reports $125 less owing, with the money
-- booked as party fees. The webhook already prefers the `booking_pay_links`
-- row over metadata (metadata is the fallback for a deleted row), so the tip
-- has to be readable from both or the two paths disagree about how much of a
-- charge was actually a payment.
--
-- NOT NULL DEFAULT 0 so every link minted before today reads as "no tip",
-- which is what they were.

ALTER TABLE public.booking_pay_links
  ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0;

-- A tip is a gratuity, never a credit and never a refund. The ceiling matches
-- `MAX_TIP_CENTS` in lib/partyPricing.ts; it is restated here because the DB is
-- the last line and a bad write should be refused even if it never went through
-- the route (an admin in the SQL console, a future writer that forgets).
ALTER TABLE public.booking_pay_links
  DROP CONSTRAINT IF EXISTS booking_pay_links_tip_cents_check;
ALTER TABLE public.booking_pay_links
  ADD CONSTRAINT booking_pay_links_tip_cents_check
  CHECK (tip_cents >= 0 AND tip_cents <= 100000);

COMMENT ON COLUMN public.booking_pay_links.tip_cents IS
  'Optional gratuity for the party team, charged on top of amount_cents. NEVER credited against the plan balance — see recordPlanPayment.';
