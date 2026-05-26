-- Migration 016: Hide "Build a Bear" activity from the planner.
-- Sets is_active = false so it stops appearing in any catalog view (planner,
-- admin party detail, kids-party-menu, etc.) without deleting the row —
-- existing bookings that reference it still resolve via pricing_item_id.
--
-- Idempotent. Safe to re-run.

-- Preview which rows will be touched
SELECT id, name, category, price_cents, is_active
FROM pricing_items
WHERE name ILIKE '%build a bear%' OR name ILIKE '%build-a-bear%' OR name ILIKE '%buildabear%';

-- Deactivate
UPDATE pricing_items
SET is_active = false
WHERE name ILIKE '%build a bear%' OR name ILIKE '%build-a-bear%' OR name ILIKE '%buildabear%';

-- Verify
SELECT id, name, category, price_cents, is_active
FROM pricing_items
WHERE name ILIKE '%build a bear%' OR name ILIKE '%build-a-bear%' OR name ILIKE '%buildabear%';
