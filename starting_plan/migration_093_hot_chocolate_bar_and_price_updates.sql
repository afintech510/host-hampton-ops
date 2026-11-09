-- Migration 093 — Hot Chocolate Bar added; Coffee Bar and Fruit Platter repriced.
--
-- Owner request 2026-11-09:
--   Hot Chocolate Bar   NEW          $150
--   Coffee Bar          $75 -> $150
--   Fruit Platter       $75 ->  $85
--
-- One price list (migration 092): each item is ONE active row, read by the kids planner,
-- /party-menu, the room-rental and studio-rental pages, the Host Assistant and the ChatGPT
-- connector. So this is the only place a price changes.
--
-- Existing quotes are not touched: a booking_line_items row keeps the unit price it was
-- quoted at (HH-PTY-TS75M holds both at $75 and stays that way unless re-quoted by hand).
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
--         (or the Supabase MCP). Safe to re-run.

BEGIN;

UPDATE pricing_items
   SET price_cents = 15000
 WHERE category = 'beverage-add-on' AND name = 'Coffee Bar' AND is_active;

UPDATE pricing_items
   SET price_cents = 8500
 WHERE category = 'food-add-on' AND name = 'Fruit Platter' AND is_active;

-- Same channels, type and place as the Coffee Bar it sits beside.
INSERT INTO pricing_items (name, description, category, price_cents, price_type, emoji, sort_order, is_active, is_popular, is_upsell, event_types)
SELECT 'Hot Chocolate Bar', 'Hot chocolate station setup.', 'beverage-add-on', 15000, 'flat', '🍫', 4, true, false, false,
       '{kids-party,room-rental,studio-rental}'
 WHERE NOT EXISTS (
   SELECT 1 FROM pricing_items WHERE category = 'beverage-add-on' AND lower(name) = 'hot chocolate bar' AND is_active
 );

COMMIT;
