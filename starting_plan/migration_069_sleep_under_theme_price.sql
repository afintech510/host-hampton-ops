-- Migration 069: Sleep Under becomes a party-planner theme at $950
--
-- DATA, not schema. Adam, 2026-10-11: "add [Sleep Under] to the party plan
-- available themes for $950".
--
-- WHY IT WAS MISSING. /party-planner, /party-builder, /party-quote and the menus
-- list themes from `pricing_items` (category `party-theme`). Sleep Under existed
-- only in `party_themes` (homepage tiles, /party-packages copy, /llms.txt), with
-- no `pricing_items` row, so the planner never offered it. Migration 062 named it
-- as the one theme with no price link and left `party_themes.price_cents` at
-- $900 as its only price.
--
-- WHAT. One `pricing_items` row in the same shape as every other theme (flat,
-- kids-party, sort_order after the twelve that exist), then link the
-- `party_themes` row to it and bring its mirrored price into line, as 062 did for
-- the other eight. Re-runnable: the insert skips an existing name and the link
-- only fills an empty one.
--
-- The EVITE side needs no data: `lib/evites/themes.ts` maps the party_themes slug
-- `sleep-under-party` to the `sleepunder` invitation template, and resolves a
-- planner line item to that slug through this very `pricing_item_id`.

BEGIN;

INSERT INTO pricing_items (name, description, category, price_cents, price_type, is_popular, is_active, sort_order, event_types)
SELECT 'Sleep Under Party', 'Cozy styled tents, sleepover-style themed party', 'party-theme', 95000, 'flat', false, true, 13, ARRAY['kids-party']
WHERE NOT EXISTS (
  SELECT 1 FROM pricing_items WHERE category = 'party-theme' AND name = 'Sleep Under Party'
);

UPDATE party_themes t
SET pricing_item_id = p.id
FROM pricing_items p
WHERE t.slug = 'sleep-under-party'
  AND p.category = 'party-theme'
  AND p.name = 'Sleep Under Party'
  AND t.pricing_item_id IS NULL;

UPDATE party_themes t
SET price_cents = p.price_cents
FROM pricing_items p
WHERE t.pricing_item_id = p.id
  AND t.slug = 'sleep-under-party'
  AND t.price_cents IS DISTINCT FROM p.price_cents;

COMMIT;
