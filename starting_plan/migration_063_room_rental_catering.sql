-- Migration 063: the room-rental catering menu mirrors /party-packages
--
-- DATA, not schema. /party-room-rental and the /studio-rental checkout read
-- `pricing_items` rows tagged `studio-rental`; /party-packages reads the
-- untagged rows. The studio menu carried 4 foods, 1 drink and 6 desserts
-- against the party menu's 14, 3 and 9, so the room-rental page could only
-- show a fraction of what we cater. This adds the 15 missing items as
-- `studio-rental` rows at the party-menu price, so every item the room-rental
-- page shows is one the checkout can actually sell, and re-orders the studio
-- rows to follow the party menu (Pizza Party Spread kept first).
--
-- Idempotent: an item is inserted only if no active studio-rental row of the
-- same category and name exists. To withdraw one, set is_active = false.

BEGIN;

INSERT INTO pricing_items (name, description, category, price_cents, price_type, event_types, sort_order, emoji)
SELECT v.name, v.description, v.category, v.price_cents, 'flat', ARRAY['studio-rental'], v.sort_order, v.emoji
FROM (VALUES
  ('Chicken Fingers & French Fries', 'Full tray of chicken fingers with plenty of fries.', 'food-add-on', 10000,  2, '🍗'),
  ('Chicken Parmigiana',             'Full tray.',                                         'food-add-on', 12500,  3, '🍗'),
  ('Pasta Tray',                     'Full tray of assorted pasta.',                       'food-add-on', 12000,  4, '🍝'),
  ('Mozzarella Sticks',              'Full tray.',                                         'food-add-on',  5000,  8, '🧀'),
  ('Popcorn Bar',                    'A popcorn station for guests to help themselves.',   'food-add-on',  8500,  9, '🍿'),
  ('Fruit Platter',                  'Assorted fresh fruit tray.',                         'food-add-on',  7500, 10, '🍓'),
  ('Bagel Platter',                  'Includes cream cheese & butter.',                    'food-add-on',  5000, 11, '🥯'),
  ('Specialty Pizza',                'Large pie with specialty toppings.',                 'food-add-on',  3500, 12, '🍕'),
  ('Large Cheese Pizza',             'Large cheese pie.',                                  'food-add-on',  2500, 13, '🍕'),
  ('GF Personal Pizza',              'Personal gluten-free pizza.',                        'food-add-on',  1500, 14, '🍕'),
  ('Sodas & Seltzers',               'Choose up to 4 types served in a bucket over ice for your guests.', 'beverage-add-on', 5000, 2, '🥤'),
  ('Coffee Bar',                     'Coffee station setup.',                              'beverage-add-on', 7500, 3, '☕'),
  ('Macarons (per dozen)',           'Per dozen.',                                         'dessert-add-on',  4500, 6, '🍪'),
  ('Dunkin'' Donuts (per dozen)',    'Assorted Dunkin'' donuts.',                          'dessert-add-on',  2500, 8, '🍩'),
  ('Dunkin'' Munchkins (50 count)',  'A 50-count bucket of Dunkin'' Munchkins.',           'dessert-add-on',  2500, 9, '🍩')
) AS v(name, description, category, price_cents, sort_order, emoji)
WHERE NOT EXISTS (
  SELECT 1 FROM pricing_items p
  WHERE p.is_active AND p.category = v.category AND p.name = v.name
    AND p.event_types @> ARRAY['studio-rental']
);

-- Existing studio rows, slotted into the party-menu order.
UPDATE pricing_items SET sort_order = v.sort_order
FROM (VALUES
  ('food-add-on',    'Pizza Party Spread (per person)',         1),
  ('food-add-on',    'Antipasto Salad',                         5),
  ('food-add-on',    'Salad Tray',                              6),
  ('food-add-on',    'Garlic Knots (per tray)',                 7),
  ('dessert-add-on', 'Chocolate Covered Pretzels (per dozen)',  7)
) AS v(category, name, sort_order)
WHERE pricing_items.category = v.category AND pricing_items.name = v.name
  AND pricing_items.event_types @> ARRAY['studio-rental'];

COMMIT;
