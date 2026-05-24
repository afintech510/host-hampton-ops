-- Migration 011: Food/Desserts/Beverages/Entertainment/Extras updates for Party Planner
-- Run via Supabase SQL editor.

-- 1. Remove "Pizza - Assorted Pies (per person)" (pizza/bagels now handled by selector)
UPDATE pricing_items
SET is_active = false
WHERE LOWER(name) LIKE '%pizza%assorted pies%' OR LOWER(name) LIKE '%pizza - assorted%';

-- 2. Update Sodas & Seltzers to $50 with proper description
UPDATE pricing_items
SET price_cents = 5000,
    price_label = NULL,
    description = 'Choose up to 4 types served in a bucket over ice for your guests.',
    name = 'Sodas & Seltzers'
WHERE LOWER(name) LIKE '%sodas%seltzer%' OR LOWER(name) LIKE '%seltzer%soda%';

-- 3. Update Character Visit to start at $435
UPDATE pricing_items
SET price_cents = 43500,
    price_label = 'Starting at $435',
    description = COALESCE(description, '') ||
      CASE WHEN COALESCE(description, '') LIKE '%vailability%' THEN '' ELSE ' Subject to availability.' END
WHERE LOWER(name) LIKE '%character visit%' OR LOWER(name) LIKE '%character appear%';

-- 4. Move Photobooth to party-add-on (Extras), $119, mark popular
UPDATE pricing_items
SET category = 'party-add-on',
    price_cents = 11900,
    is_popular = true,
    sort_order = 1
WHERE LOWER(name) LIKE '%photobooth%' OR LOWER(name) LIKE '%photo booth%';

-- 5. Move Soft Play to party-add-on (Extras)
UPDATE pricing_items
SET category = 'party-add-on',
    sort_order = 2
WHERE LOWER(name) LIKE '%soft play%';

-- 6. Deactivate "Additional Party Guest" / "Extra Guest" item
UPDATE pricing_items
SET is_active = false
WHERE LOWER(name) LIKE '%additional%guest%' OR LOWER(name) LIKE '%extra guest%';

-- Verify
SELECT category, name, price_cents, price_label, is_popular, is_active, sort_order
FROM pricing_items
WHERE LOWER(name) LIKE '%pizza%'
   OR LOWER(name) LIKE '%seltzer%'
   OR LOWER(name) LIKE '%character%'
   OR LOWER(name) LIKE '%photobooth%'
   OR LOWER(name) LIKE '%soft play%'
   OR LOWER(name) LIKE '%additional%guest%'
   OR LOWER(name) LIKE '%extra guest%'
ORDER BY category, sort_order, name;
