-- Migration 054 — home delivery on a fundraiser order.
--
-- The Eastport-Tuttle PTO offers ESM Sharks buyers a choice: the order is handed
-- to the child in class (free, and what every order on this table has been until
-- now), or it is dropped at the family's door for $7 that goes to the PTO whole.
--
-- Three columns, and two CHECKs that make the undeliverable row impossible:
--
--   1. `delivery_method` — defaulted and backfilled to 'classroom'. Every one of
--      the existing rows was handed over in person, so the default is the truth
--      about them, not a placeholder. `/cm-cheer` and `/li-high` do not send the
--      field and keep working unchanged.
--   2. `delivery_address` — NULL unless the order is being delivered. A home
--      order with no address is REFUSED by the database: the $7 is already paid
--      at that point, so a row nobody can act on is the expensive failure here.
--      A classroom order with an address is refused too — that is a child's home
--      address sitting in a CSV that parent volunteers download, for an order
--      that is never leaving the school.
--   3. `delivery_fee_cents` — the fee as a fact, so the dashboard and the CSV can
--      show it without parsing `items`. It is ALSO carried as a line item inside
--      `items` (that is what makes it flow into subtotal/profit and into the
--      confirmation email); `lib/fundraiserDelivery.ts` is what keeps the two
--      copies in step, and the CHECK below stops them contradicting each other
--      at the extremes.
--
-- Safe to re-run.

BEGIN;

ALTER TABLE public.cm_cheer_orders
  ADD COLUMN IF NOT EXISTS delivery_method text NOT NULL DEFAULT 'classroom';

ALTER TABLE public.cm_cheer_orders
  ADD COLUMN IF NOT EXISTS delivery_address text;

ALTER TABLE public.cm_cheer_orders
  ADD COLUMN IF NOT EXISTS delivery_fee_cents integer NOT NULL DEFAULT 0;

-- Belt-and-braces for a re-run against a table where the column arrived some
-- other way and left NULLs behind.
UPDATE public.cm_cheer_orders
   SET delivery_method = 'classroom'
 WHERE delivery_method IS NULL OR btrim(delivery_method) = '';

-- The API's copy of this list is lib/fundraiserDelivery.ts. The database keeps
-- its own, for the same reason it keeps one for `team`: a value that passes the
-- route but not the constraint would be an order in a state no screen renders.
ALTER TABLE public.cm_cheer_orders
  DROP CONSTRAINT IF EXISTS cm_cheer_orders_delivery_method_check;
ALTER TABLE public.cm_cheer_orders
  ADD CONSTRAINT cm_cheer_orders_delivery_method_check
  CHECK (delivery_method IN ('classroom', 'home'));

-- An address exactly when there is a delivery, and never otherwise.
ALTER TABLE public.cm_cheer_orders
  DROP CONSTRAINT IF EXISTS cm_cheer_orders_delivery_address_check;
ALTER TABLE public.cm_cheer_orders
  ADD CONSTRAINT cm_cheer_orders_delivery_address_check
  CHECK (
    (delivery_method = 'home'      AND delivery_address IS NOT NULL AND btrim(delivery_address) <> '')
    OR
    (delivery_method = 'classroom' AND delivery_address IS NULL)
  );

-- A classroom order is free; a delivered one is not free. The exact rate lives
-- in the application (the PTO can change $7 without a migration), so this bounds
-- the fee rather than pinning it.
ALTER TABLE public.cm_cheer_orders
  DROP CONSTRAINT IF EXISTS cm_cheer_orders_delivery_fee_check;
ALTER TABLE public.cm_cheer_orders
  ADD CONSTRAINT cm_cheer_orders_delivery_fee_check
  CHECK (
    (delivery_method = 'classroom' AND delivery_fee_cents = 0)
    OR
    (delivery_method = 'home'      AND delivery_fee_cents > 0 AND delivery_fee_cents <= 10000)
  );

-- "Which orders am I driving out this week" is the delivery run, and it is the
-- one query this feature adds.
CREATE INDEX IF NOT EXISTS cm_cheer_orders_team_delivery_idx
  ON public.cm_cheer_orders (team, delivery_method)
  WHERE delivery_method = 'home';

COMMIT;
