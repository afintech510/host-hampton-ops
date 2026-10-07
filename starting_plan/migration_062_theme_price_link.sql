-- Migration 062 — one price per party theme.
--
-- WHY. Theme prices lived in TWO tables that nothing kept in agreement:
--   party_themes.price_cents   → homepage tiles, /llms.txt, /api/themes, admin Themes tab
--   pricing_items (party-theme) → party planner, /party-packages, /party-menu (what CHARGES)
-- On 2026-10-04 they disagreed on Slime/K-Pop ($900 vs $950) and Sweets & Treats
-- ($800 vs $950); ChatGPT's blind audit read both and reported the site as
-- contradicting itself. Adam ruled pricing_items correct and asked for one list.
--
-- WHAT. party_themes keeps everything it is good at (name, images, copy, sort)
-- and gains a link to the pricing_items row that holds its PRICE. Readers use
-- the linked price (lib/themePricing.ts); the admin Themes tab writes a price
-- edit to the linked row. party_themes.price_cents stays as the price for a
-- theme with no pricing row (Sleep Under, today) and is mirrored on every edit.
--
-- Additive and nullable: code deployed before this migration keeps working, and
-- code deployed after it treats a missing link as "use party_themes.price_cents".

ALTER TABLE party_themes
  ADD COLUMN IF NOT EXISTS pricing_item_id uuid REFERENCES pricing_items(id) ON DELETE SET NULL;

-- Backfill by exact name pairs (the two tables spell three themes differently).
UPDATE party_themes t
SET pricing_item_id = p.id
FROM pricing_items p,
     (VALUES
       ('Glow Party',       'Glow Party'),
       ('Swiftie Party',    'Swiftie Party'),
       ('Spa Party',        'Spa Party'),
       ('Slime Party',      'Slime Party'),
       ('K-Pop Party',      'K-Pop Demon Hunter Party'),
       ('Barbie Party',     'Barbie Party'),
       ('Sweets & Treats',  'Sweets-n-Treats Party'),
       ('Toddler Party',    'Toddler Party')
     ) AS m(theme_name, item_name)
WHERE t.name = m.theme_name
  AND p.name = m.item_name
  AND p.category = 'party-theme'
  AND t.pricing_item_id IS NULL;

-- Bring the mirror into line with the linked price.
UPDATE party_themes t
SET price_cents = p.price_cents
FROM pricing_items p
WHERE t.pricing_item_id = p.id
  AND t.price_cents IS DISTINCT FROM p.price_cents;

COMMENT ON COLUMN party_themes.pricing_item_id IS
  'The pricing_items row that holds this theme''s price (migration 062). When set, '
  'readers use that row''s price_cents and party_themes.price_cents is only a mirror.';
