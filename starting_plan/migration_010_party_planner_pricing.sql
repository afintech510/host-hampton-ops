-- Migration 010: Party Planner pricing updates
-- - Move Photobooth and Soft Play to party-add-on (Extras), highlight Photobooth as popular
-- - Remove "Leaning" from Balloon Tower w/ Number
-- - Move "Double Arch" under balloon decor category (if applicable)
-- - Update Face Painter to $325, Character Visit "starting at $395"
-- - Deactivate "Additional Party Guest" pricing item (handled by guest count)

-- 1. Photobooth → party-add-on, $125, mark popular
UPDATE pricing_items
SET category = 'party-add-on',
    price_cents = 12500,
    is_popular = true,
    sort_order = 1
WHERE LOWER(name) LIKE '%photobooth%' OR LOWER(name) LIKE '%photo booth%';

-- 2. Soft Play → party-add-on
UPDATE pricing_items
SET category = 'party-add-on'
WHERE LOWER(name) LIKE '%soft play%';

-- 3. Remove "Leaning" prefix from Balloon Tower
UPDATE pricing_items
SET name = 'Balloon Tower w/ Number'
WHERE name = 'Leaning Balloon Tower w/ Number';

-- 4. Make sure Double Arch is in decor-add-on category (balloon decor)
UPDATE pricing_items
SET category = 'decor-add-on'
WHERE LOWER(name) LIKE 'double arch%' AND category <> 'decor-add-on';

-- 5. Face Painter → $325
UPDATE pricing_items
SET price_cents = 32500,
    price_label = NULL
WHERE LOWER(name) LIKE '%face paint%';

-- 6. Character Visit → "starting at $395", flat price for display
UPDATE pricing_items
SET price_cents = 39500,
    price_label = 'Starting at $395',
    description = COALESCE(description, '') || CASE WHEN COALESCE(description, '') = '' THEN '' ELSE ' ' END || 'Subject to availability.'
WHERE LOWER(name) LIKE '%character visit%' OR LOWER(name) LIKE '%character appear%';

-- 7. Deactivate "Additional Party Guest" item (guest count handles this now)
UPDATE pricing_items
SET is_active = false
WHERE LOWER(name) LIKE '%additional%guest%' OR LOWER(name) LIKE '%extra guest%';

-- Verify
SELECT category, name, price_cents, price_label, is_popular, is_active
FROM pricing_items
WHERE LOWER(name) IN ('photobooth','photo booth','soft play','face painter','character visit','additional party guest','extra guest','balloon tower w/ number','double arch')
   OR LOWER(name) LIKE '%photobooth%'
   OR LOWER(name) LIKE '%soft play%'
   OR LOWER(name) LIKE '%face paint%'
   OR LOWER(name) LIKE '%character%'
   OR LOWER(name) LIKE '%balloon tower%'
   OR LOWER(name) LIKE '%double arch%'
ORDER BY category, sort_order, name;
