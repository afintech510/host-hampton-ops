-- ════════════════════════════════════════════════════════════════════════════
-- Migration 040 — the two idempotency guarantees the code already assumed
--
-- Both of these were found by the Phase 5 review pass (plan §22) by EXERCISING
-- production, not by reading the comments that claimed them.
--
-- 1. booking_pay_links: "there is never a window with two payable links"
--    (plan §21) is FALSE under concurrency. `createPlanPayLink` voids the
--    previous link, then creates the new one at Stripe, then inserts the row —
--    three round trips with nothing serialising them. Six concurrent mints of
--    the same (booking, purpose) produced SIX simultaneously live, payable
--    Stripe links, each with `completed_sessions.limit = 1`, and paying two of
--    them charged the same $250 deposit twice. The session-id unique index
--    cannot help: those are two genuinely different sessions.
--
--    A partial unique index makes the DB the serialisation point. The losing
--    racer's insert then fails, and `createPlanPayLink` ALREADY handles a failed
--    insert by deactivating the Stripe link it just made — so the index alone
--    turns the race into the safe outcome it was documented as having.
--
-- 2. booking_payments: three places in api/webhook/route.ts say a duplicate
--    `stripe_payment_intent_id` "fails silently" on "the unique constraint".
--    There is no such constraint — only `idx_bp_stripe_session`, which is
--    partial on `stripe_session_id IS NOT NULL`, and every payment_intent path
--    inserts `stripe_session_id: null`. So the planner deposit and studio
--    rental paths have NEVER been idempotent: a redelivered
--    `payment_intent.succeeded` (which Stripe does as a matter of course) would
--    insert a second deposit row, double the paid sum, halve the balance and
--    can mark a plan paid_in_full. It has not fired yet only by luck — checked
--    2026-09-11: 18 payment rows, 5 with a PI, 0 duplicates.
--
--    A constant declared in two files is a constant nothing is checking
--    (hard-won rule 11); a constraint asserted in three comments and declared
--    nowhere is the same bug with worse consequences.
--
-- Idempotent: every statement is IF NOT EXISTS or guarded. Safe to re-run.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. One live pay link per (booking, purpose)
-- ─────────────────────────────────────────────────────────────────────────
-- Repair first: if several live links already exist for one (booking, purpose),
-- keep the NEWEST and void the rest. Newest is the right survivor — it is the
-- one the minting caller handed to whoever asked, and it is priced against the
-- most recent state of the plan. Voiding here only closes our books; the Stripe
-- links themselves are deactivated by the operator, because a migration cannot
-- call Stripe.
UPDATE public.booking_pay_links l
   SET voided_at = now()
 WHERE l.voided_at IS NULL
   AND EXISTS (
     SELECT 1 FROM public.booking_pay_links newer
      WHERE newer.booking_id = l.booking_id
        AND newer.purpose    = l.purpose
        AND newer.voided_at IS NULL
        AND (newer.created_at, newer.id) > (l.created_at, l.id)
   );

CREATE UNIQUE INDEX IF NOT EXISTS idx_bpl_one_live_per_purpose
  ON public.booking_pay_links (booking_id, purpose)
  WHERE voided_at IS NULL;

COMMENT ON INDEX public.idx_bpl_one_live_per_purpose IS
  'Phase 5 review (040). Makes "never two payable links for one purpose" true: '
  'void-then-create-then-insert has no serialisation of its own, and six '
  'concurrent mints produced six live payable links. The losing insert fails '
  'with 23505 and createPlanPayLink deactivates the Stripe link it just made.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. One payment row per Stripe PaymentIntent
-- ─────────────────────────────────────────────────────────────────────────
-- Partial, matching idx_bp_stripe_session's shape, because most rows are
-- hand-entered cash/venmo/check with no PI at all.
--
-- If this ever fails to create, production already HAS a phantom duplicate
-- payment and that is the thing to look at, not this index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bp_stripe_pi
  ON public.booking_payments (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

COMMENT ON INDEX public.idx_bp_stripe_pi IS
  'Phase 5 review (040). The constraint three webhook comments claimed existed '
  'and that nothing declared: every payment_intent.succeeded path inserts '
  'stripe_session_id NULL, so idx_bp_stripe_session (partial) never applied and '
  'a redelivered PI event would have inserted a second deposit row.';
