-- ===========================================================================
-- Migration 037 — plan_content: the invoice's prose, per party type
--
-- Phase 5 item 1 of docs/booking-agent-plan.md. The summary page reproduces
-- `invoices/_template.html` from the DB, and that template carries copy as well
-- as numbers: "What's Included" (studio only), the good-to-know paragraph, the
-- policy bullets, the deposit note and the add-ons intro. Until now that copy
-- lived in `.claude/skills/party-quote-invoice/SKILL.md` — a document only a
-- human (or Claude) reads, which is fine for a hand-built one-off and useless
-- to a server component.
--
-- Why a table rather than a TS constant, which the plan offered as the cheaper
-- first step: the identical argument as migration 036. Prices moved into
-- `pricing_items` so Adam could change one without a deploy, and policy copy is
-- edited far more often than a price. A constant file would have had to be
-- migrated here later anyway, and the seed is the same work either way.
--
-- Same conventions as 036:
--   * rows are identified by (party_type, slot, sort_order), never by body text;
--   * DATA is seeded here rather than by a hand-run script, so it is reproducible;
--   * every block UPDATEs matching rows and INSERTs only absent ones, so the
--     whole file is idempotent and was verified by re-running it.
--
-- The loader (`lib/planContent.ts`) keeps a compiled fallback equal to this
-- seed, for exactly the reason `pricingCatalog.ts` does: an unapplied migration
-- or an unreachable Supabase must render today's invoice, not a blank one.
-- Missing policy copy on a quote is not cosmetic — the setup/cleanup and
-- sweep-clean bullets are what we point at when a client leaves the room dirty.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.plan_content (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Matches bookings.party_type, plus 'all' for copy shared by every product.
  party_type  TEXT NOT NULL,
  -- Which part of the invoice this is.
  slot        TEXT NOT NULL,
  body        TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_content_party_type_chk CHECK (
    party_type IN ('in_studio_theme', 'mobile_party', 'studio_rental', 'unknown', 'all')
  ),
  CONSTRAINT plan_content_slot_chk CHECK (
    slot IN ('whats_included', 'good_to_know', 'policy', 'deposit_note', 'deposit_label', 'addons_intro', 'balance_note')
  )
);

-- The identity of a row, and what makes the seed below idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_content_slot
  ON public.plan_content (party_type, slot, sort_order);

CREATE INDEX IF NOT EXISTS idx_plan_content_lookup
  ON public.plan_content (party_type, slot) WHERE is_active;

-- RLS: service_role only, the same posture as 031/032/028. Nothing client-side
-- reads this directly; the summary page renders on the server.
ALTER TABLE public.plan_content ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS plan_content_service_role ON public.plan_content;
CREATE POLICY plan_content_service_role ON public.plan_content
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────
-- Seed. Copy is lifted verbatim from SKILL.md so the DB-rendered invoice and
-- the hand-built files say the same thing during the changeover.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TEMP TABLE _seed (party_type TEXT, slot TEXT, body TEXT, sort_order INT) ON COMMIT DROP;

INSERT INTO _seed (party_type, slot, body, sort_order) VALUES
  -- What's Included — Studio Rental ONLY. SKILL.md is explicit that this block
  -- is omitted for a mobile party, where inclusions live in the featured line
  -- item's description instead.
  ('studio_rental', 'whats_included', 'Tables', 1),
  ('studio_rental', 'whats_included', 'Chairs', 2),
  ('studio_rental', 'whats_included', 'Dessert cart', 3),
  ('studio_rental', 'whats_included', 'WiFi', 4),
  ('studio_rental', 'whats_included', 'Bluetooth speakers', 5),
  ('studio_rental', 'whats_included', 'Retail items removed & furniture consolidated to maximize your usable party space', 6),

  -- The two studio policy bullets SKILL.md says to include VERBATIM, every time.
  ('studio_rental', 'policy',
   '**Setup & cleanup time is included in your rental window** — plan to arrive early enough to set up and leave enough time at the end to clean up within your booked hours (or add Additional Hours if you need more time).', 1),
  ('studio_rental', 'policy',
   '**Please leave the room sweep-clean and take your garbage with you** when you go, unless you''ve added the Garbage Service or Full Clean-up Service add-on.', 2),

  ('studio_rental', 'good_to_know',
   'Your rental is the whole studio, privately yours for the booked window. Tell us your setup plans ahead of time and we''ll have the room arranged before you arrive.', 1),
  ('studio_rental', 'deposit_label', 'Security Deposit — Required to Book', 1),
  ('studio_rental', 'deposit_note',
   'Separate from your Total, due now to reserve the date, and fully refundable after the event assuming no damage.', 1),
  -- The studio rule the plan calls out twice: Balance Due is the FULL total,
  -- the deposit is not subtracted from it.
  ('studio_rental', 'balance_note', 'Your deposit is separate and is not deducted from this total.', 1),

  -- Mobile: no What's Included block; the policy bullets above are off-site
  -- irrelevant (SKILL.md says to skip them), so it gets its own good-to-know.
  ('mobile_party', 'good_to_know',
   'We come to you — our host brings every supply, apron and surface cover, runs the activity start to finish, and leaves your space as we found it.', 1),
  ('mobile_party', 'deposit_label', 'Reservation Deposit — Required to Book', 1),
  ('mobile_party', 'deposit_note',
   'Separate from your Total and due now to reserve the date. It comes off your balance on the day.', 1),

  ('in_studio_theme', 'good_to_know',
   'Your party is hosted at the studio with everything set up before your guests arrive. Tell us your theme and we''ll take it from there.', 1),
  ('in_studio_theme', 'deposit_label', 'Reservation Deposit — Required to Book', 1),
  ('in_studio_theme', 'deposit_note',
   'Separate from your Total and due now to reserve the date. It comes off your balance on the day.', 1),

  -- Shared. 'all' is the fallback the loader uses when a party type has no row
  -- of its own, so a lead still classified 'unknown' renders a complete page.
  ('all', 'deposit_label', 'Reservation Deposit — Required to Book', 1),
  ('all', 'deposit_note',
   'Separate from your Total and due now to reserve the date.', 1),
  ('all', 'addons_intro',
   'Popular additions for this party — ask us to add any of these and we''ll send an updated quote.', 1),
  ('all', 'good_to_know',
   'Everything above is a quote, not a charge. Nothing is booked until the deposit is paid, and we''ll confirm every detail with you first.', 1);

-- UPDATE first, INSERT only what is absent. The INSERT's NOT EXISTS reads the
-- pre-statement snapshot, so it cannot race the UPDATE in its own CTE — the
-- same shape migration 036 used.
UPDATE public.plan_content p
   SET body = s.body, is_active = TRUE, updated_at = NOW()
  FROM _seed s
 WHERE p.party_type = s.party_type AND p.slot = s.slot AND p.sort_order = s.sort_order;

INSERT INTO public.plan_content (party_type, slot, body, sort_order)
SELECT s.party_type, s.slot, s.body, s.sort_order
  FROM _seed s
 WHERE NOT EXISTS (
   SELECT 1 FROM public.plan_content p
    WHERE p.party_type = s.party_type AND p.slot = s.slot AND p.sort_order = s.sort_order
 );

COMMIT;

-- Verify: re-running this file must insert 0 the second time.
SELECT party_type, slot, count(*) AS rows
  FROM public.plan_content
 GROUP BY 1, 2
 ORDER BY 1, 2;
