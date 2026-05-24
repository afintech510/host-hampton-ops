-- Migration 013: Move Dunkin Donuts + Munchkins from Food to Desserts.
-- Safe to run anytime; only updates category on matching pricing_items.
-- Idempotent: re-running has no effect once items are in dessert-add-on.

-- Preview which rows will be touched
SELECT id, name, category, price_cents
FROM pricing_items
WHERE category = 'food-add-on'
  AND (name ILIKE '%dunkin%' OR name ILIKE '%munchkin%' OR name ILIKE '%donut%');

-- Move them to desserts
UPDATE pricing_items
SET category = 'dessert-add-on'
WHERE category = 'food-add-on'
  AND (name ILIKE '%dunkin%' OR name ILIKE '%munchkin%' OR name ILIKE '%donut%');

-- Verify
SELECT id, name, category, price_cents
FROM pricing_items
WHERE name ILIKE '%dunkin%' OR name ILIKE '%munchkin%' OR name ILIKE '%donut%'
ORDER BY category, name;
