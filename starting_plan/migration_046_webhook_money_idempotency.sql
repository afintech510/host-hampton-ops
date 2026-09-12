-- Migration 046 — idempotency and honest answers on the non-plan Stripe webhook branches
--
-- Link 16 of the build chain, 2026-09-12. See docs/stripe-webhook-branches-review.md.
--
-- What this exists for, measured before it was written:
--
--   * `event_tickets` (94 live rows) had a UNIQUE only on `ticket_ref`. Nothing
--     stopped a Stripe redelivery of one `checkout.session.completed` from
--     inserting a SECOND ticket for the same payment, decrementing inventory a
--     second time and emailing the customer a second confirmation. Migration 040
--     gave `booking_payments` exactly this protection; the ticket branches — which
--     have really run, 77 times — never got it.
--
--   * `nextval_event_ticket_seq()` is called from FIVE places in
--     `cart-checkout` and `events/checkout` and HAS NEVER EXISTED. The sequence
--     `event_ticket_seq` was created by migration 005; the RPC wrapper the app
--     calls was not. Every call returned a PostgREST error that the callers
--     discard, and they silently fell back to `HH-EVT-${Date.now().slice(-4)}` —
--     a ref space that repeats every ten seconds against a UNIQUE column.
--
--   * `decrement_event_tickets` / `decrement_session_tickets` return void and
--     no-op when `available_tickets < qty`. An oversold event took the money,
--     issued the ticket, left inventory untouched and told nobody (rule 10).
--
--   * Gift-card redemption was read-then-write in TWO copies of the same code,
--     with both the read error and the write error discarded, and it reset
--     `redeemed_at` to NULL on a partial redemption of a card that had already
--     been fully redeemed.
--
-- Idempotent: re-running this file is a no-op. Verified by running it twice.

BEGIN;

-- ── 1. Ticket idempotency ───────────────────────────────────────────────────
-- One Checkout Session may legitimately produce MANY ticket rows (a cart, or a
-- multi-session bundle), so the key is the whole line, not the session alone.
-- NULLS NOT DISTINCT (PG15+, this box is 17.6) is what makes it bind for the
-- single-event case where `session_id` and `variant_label` are both NULL —
-- without it a redelivery would slip straight through the index.
-- Verified against live data before creation: 0 groups violate it.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_event_ticket_per_session_line
  ON public.event_tickets (stripe_session_id, event_id, session_id, variant_label)
  NULLS NOT DISTINCT
  WHERE stripe_session_id IS NOT NULL;

-- A vendor registration and the legacy party-booking tail both INSERT into
-- `bookings` keyed on nothing. A redelivery made a second booking with a fresh
-- ref. Verified: 0 duplicates today on either column.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bookings_stripe_session
  ON public.bookings (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

-- ── 2. The ticket-ref sequence the app has been calling all along ───────────
-- `HH-EVT-nnnn` legacy refs top out at 9932, so the sequence starts at 10000 and
-- new refs are five digits: structurally disjoint from everything already in the
-- table, so turning this on cannot collide with history.
DO $$
BEGIN
  IF (SELECT last_value FROM public.event_ticket_seq) < 10000 THEN
    PERFORM setval('public.event_ticket_seq', 10000, false);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.nextval_event_ticket_seq()
RETURNS bigint
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$ SELECT nextval('public.event_ticket_seq') $$;

GRANT EXECUTE ON FUNCTION public.nextval_event_ticket_seq() TO service_role;

-- ── 3. Inventory that says when it refused ──────────────────────────────────
-- Returns the new available count, or NULL when it declined to decrement
-- (oversold). The old signature returned void, so "sold out and did nothing"
-- and "decremented" were the same answer. Callers that ignore the result are
-- unaffected; the webhook now reads it and logs an OVERSOLD line.
DROP FUNCTION IF EXISTS public.decrement_event_tickets(uuid, integer);
CREATE FUNCTION public.decrement_event_tickets(eid uuid, qty integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE remaining integer;
BEGIN
  UPDATE events
     SET available_tickets = available_tickets - qty
   WHERE id = eid AND available_tickets >= qty
  RETURNING available_tickets INTO remaining;
  RETURN remaining;   -- NULL when the row was missing or there was not enough
END $$;

DROP FUNCTION IF EXISTS public.decrement_session_tickets(uuid, integer);
CREATE FUNCTION public.decrement_session_tickets(sid uuid, qty integer)
RETURNS integer
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE remaining integer;
BEGIN
  UPDATE event_sessions
     SET available_tickets = available_tickets - qty
   WHERE id = sid AND available_tickets >= qty
  RETURNING available_tickets INTO remaining;
  RETURN remaining;
END $$;

GRANT EXECUTE ON FUNCTION public.decrement_event_tickets(uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrement_session_tickets(uuid, integer) TO service_role;

-- ── 4. Gift-card redemption, atomically, once ───────────────────────────────
-- `SELECT … FOR UPDATE` is what stops two concurrent redemptions both reading
-- the same balance. `LEAST` is what stops a redemption larger than the card.
-- `COALESCE(redeemed_at, now())` is what stops a later partial redemption
-- CLEARING the timestamp that says the card was spent.
-- Returns zero rows when there is no ACTIVE card by that code — which the caller
-- must be able to tell apart from a database failure (rule 12).
CREATE OR REPLACE FUNCTION public.redeem_gift_card(p_code text, p_deduct integer)
RETURNS TABLE (redeemed_cents integer, new_balance_cents integer, card_status text)
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE v_id uuid; v_bal integer;
BEGIN
  SELECT id, balance_cents INTO v_id, v_bal
    FROM gift_cards
   WHERE code = p_code AND status = 'active'
     FOR UPDATE;
  IF v_id IS NULL THEN
    RETURN;                                  -- 0 rows: no active card by that code
  END IF;

  redeemed_cents    := LEAST(GREATEST(COALESCE(p_deduct, 0), 0), v_bal);
  new_balance_cents := v_bal - redeemed_cents;
  card_status       := CASE WHEN new_balance_cents = 0 THEN 'redeemed' ELSE 'active' END;

  UPDATE gift_cards
     SET balance_cents = new_balance_cents,
         status        = card_status,
         redeemed_at   = CASE WHEN new_balance_cents = 0 THEN COALESCE(redeemed_at, now())
                              ELSE redeemed_at END
   WHERE id = v_id;

  RETURN NEXT;
END $$;

GRANT EXECUTE ON FUNCTION public.redeem_gift_card(text, integer) TO service_role;

COMMIT;
