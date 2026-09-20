-- Migration 058 — the tip becomes a number you can query
--
-- Adam, 2026-09-20, on being told tips were unqueryable: "yes let's put them in
-- the DB."
--
-- ── What was wrong ─────────────────────────────────────────────────────────
--
-- Two surfaces charge a gratuity — the party-builder portal (Payment Element,
-- since before migration 057) and the invoice's pay link (057) — and NEITHER
-- recorded it as a number. `booking_payments` has `amount_cents` (party fees),
-- `card_fee_cents` and `total_charged_cents`, and the tip was simply the
-- difference between them, described in an English sentence in `notes`:
--
--     'Includes $50.00 tip for party helpers'
--
-- So "how much did the team earn in tips this season" was a question you could
-- only answer by parsing prose, and 1099-NEC-adjacent money (see the host-pay
-- note in the CY2025 books) had no column. Migration 057 put `tip_cents` on the
-- pay LINK; this puts it on the PAYMENT, which is the row the books read.
--
-- ── Backfill ───────────────────────────────────────────────────────────────
--
-- Historic rows are set from the arithmetic that was always implied:
-- total_charged − amount − card_fee. This is exact, not a guess: those three
-- columns are written together by the same statement in every writer, and the
-- only thing that has ever occupied the gap is a tip. Rows where the gap is
-- zero or negative (rounding, a refund, a legacy hand-entered row) stay 0.
--
-- The backfill is restricted to rows whose `notes` actually mention a tip, so a
-- pre-existing arithmetic discrepancy from some other cause is NOT relabelled
-- as a gratuity. Anything the filter misses stays 0 and is visible as a row
-- where the three columns do not reconcile — which is a question worth asking
-- rather than an answer worth inventing.

ALTER TABLE public.booking_payments
  ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.booking_payments
  DROP CONSTRAINT IF EXISTS booking_payments_tip_cents_check;
ALTER TABLE public.booking_payments
  ADD CONSTRAINT booking_payments_tip_cents_check
  CHECK (tip_cents >= 0 AND tip_cents <= 100000);

UPDATE public.booking_payments
SET tip_cents = GREATEST(
      0,
      LEAST(
        100000,
        COALESCE(total_charged_cents, 0)
          - COALESCE(amount_cents, 0)
          - COALESCE(card_fee_cents, 0)
      )
    )
WHERE tip_cents = 0
  AND notes ILIKE '%tip%'
  AND COALESCE(total_charged_cents, 0)
      - COALESCE(amount_cents, 0)
      - COALESCE(card_fee_cents, 0) > 0;

COMMENT ON COLUMN public.booking_payments.tip_cents IS
  'Gratuity for the party team, included in total_charged_cents and NEVER in amount_cents. Not revenue against the booking balance.';

-- A gratuity is not a refund and not a credit. Stated once, here, so a reader
-- of the schema learns it without reading three TypeScript files.
COMMENT ON COLUMN public.booking_payments.amount_cents IS
  'What this payment credits against the plan. Excludes card_fee_cents and tip_cents; total_charged_cents is the sum of all three.';
