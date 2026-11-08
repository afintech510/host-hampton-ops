-- Migration 092 — one price list: one `pricing_items` row per thing we sell.
--
-- ── WHY ──
--
-- Every food, dessert, drink and decor add-on existed TWICE: an untagged row
-- (event_types NULL — the kids-party planner, /party-menu, /party-room-rental's
-- decor list) and a `{studio-rental}` row (/studio-rental, /party-room-rental's
-- catering list, the Manager assistant's studio builder). Same price today, but
-- two rows means a price change is two edits, and nothing noticed when only one
-- was made. The names had already drifted ("Garlic Knots" / "Garlic Knots (per
-- tray)", "Dunkin Donuts Donuts" / "Dunkin' Donuts (per dozen)").
--
-- Measured 2026-11-07 on the live site: /party-menu printed every food, dessert
-- and drink item twice, because it reads those categories with no channel
-- filter. And the website Host Assistant and the ChatGPT connector quote from
-- the same rows, so "pricing on web and MCP linked" needs ONE row to link to.
--
-- ── WHAT THIS DOES ──
--
--   1. For each of 31 duplicate pairs (same category, same price), KEEP the row
--      most booking line items point at, give it the better-written name and
--      description, take the emoji and price label from the other row when it
--      has none, and list every channel the pair was sold on in `event_types`. NULL used to mean "every reader that says OR NULL", which
--      for these rows was the kids planner and the room-rental decor list, so
--      the merged row says so explicitly: {kids-party, room-rental, studio-rental}.
--      (The two service pairs were room-rental + studio-rental only.)
--   2. DEACTIVATE the other row (never delete: 2 booking line items and any
--      studio-rental page still open point at it), and record
--      `metadata.merged_into` = the kept id. Kids-planner links minted earlier
--      keep working, because the kids rows are the ones kept.
--   3. Repoint the line items on the deactivated rows to the kept row, so the
--      studio-rental manage page finds them in its menu.
--   4. A partial UNIQUE index on (category, lower(name)) WHERE is_active, so the
--      same item cannot be listed twice in one category again.
--   5. Seeds the `mobile_quote_from` row, INACTIVE (see step 5 below).
--
-- ── WHAT IT DOES NOT DO ──
--
--   - No price changes. Every pair is checked equal before it is merged; a pair
--     whose prices differ aborts the whole migration.
--   - Same-named items in DIFFERENT categories are left alone (Photo Booth and
--     Soft Play Setup are a party-add-on for kids and a service-add-on for
--     rentals; Linen Rentals and Room Setup are decor on one page and a service
--     on another). The planner groups by category, so merging those is a page
--     change, not a data change.
--   - sort_order and is_popular are the kept row's. /studio-rental does not draw
--     is_popular, so copying it over would only add badges to the kids planner.
--     /studio-rental's food list does take the planner's order, which moves
--     Pizza Party Spread from first to last there.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
--         (or the Supabase MCP). Safe to re-run: a pair already merged is skipped.

BEGIN;

CREATE TEMP TABLE _merge (keep_id uuid, drop_id uuid, new_name text, new_description text, channels text[]) ON COMMIT DROP;

INSERT INTO _merge VALUES
  -- food-add-on
  ('1a877f34-d469-4dc4-a4c4-b489dcd80922', '7a98874e-7575-44f7-92f0-16f1fdb9c6bb', 'Chicken Parmigiana', 'Full tray.', '{kids-party,room-rental,studio-rental}'),
  ('037fb558-b3f3-49ec-82ce-e0c1c1433881', 'ed975eeb-9c26-4779-9e60-eaea7845b7fe', 'Pasta Tray', 'Full tray of assorted pasta.', '{kids-party,room-rental,studio-rental}'),
  ('67d02d91-5deb-41af-a532-6e58700edd10', '4141aa2c-b0fd-40cb-86ad-e30cda71291e', 'Chicken Fingers & French Fries', 'Full tray of chicken fingers with plenty of fries.', '{kids-party,room-rental,studio-rental}'),
  ('79c6d2db-fe85-49d6-91a0-27a959f2c78a', 'efbb8582-379b-465d-b0a6-f953e0d62e23', 'Antipasto Salad', 'Full tray.', '{kids-party,room-rental,studio-rental}'),
  ('b42efb4f-bf60-46df-87ce-4cd6ba7a21f7', '342a063b-5a66-41dd-9890-5a7fce651af3', 'Popcorn Bar', 'A popcorn station for guests to help themselves.', '{kids-party,room-rental,studio-rental}'),
  ('c03e686d-4892-4dda-8846-47cbe301202c', '61a12ada-3497-4997-8311-155c3bc9d596', 'Fruit Platter', 'Assorted fresh fruit tray.', '{kids-party,room-rental,studio-rental}'),
  ('a1653c17-ff50-440d-8e4a-9079fa37b15a', 'c78acc80-8d08-4d8c-bd1f-959c871c1d87', 'Salad Tray', 'Full tray. Choose type: Caesar or Tossed Garden.', '{kids-party,room-rental,studio-rental}'),
  ('06dd0327-2c70-434d-b450-dfad46622bf5', 'b1091d8f-fe05-4348-8f0e-565e988f241b', 'Mozzarella Sticks', 'Full tray.', '{kids-party,room-rental,studio-rental}'),
  ('9da62c1e-39a4-4a1b-a947-4cba51d55aa7', '5bbab488-b36f-40fd-90e9-4280f1e6ce57', 'Bagel Platter', 'Includes cream cheese & butter.', '{kids-party,room-rental,studio-rental}'),
  ('1fb65f02-d3b4-4bf3-80f4-e00ae49d5708', '077efb11-429f-413c-8c35-191813ab1437', 'Specialty Pizza', 'Large pie with specialty toppings.', '{kids-party,room-rental,studio-rental}'),
  ('540ca4bf-5187-421f-ad26-00910cae7de7', 'f0f8291c-ddb9-4127-b529-1cf19cfff6e7', 'Garlic Knots (per tray)', 'Per tray.', '{kids-party,room-rental,studio-rental}'),
  ('fd1cdab8-0b8a-4352-8f1b-87b45d0f280d', '9176a418-b10d-447c-83d6-a55f868a8c46', 'Large Cheese Pizza', 'Large cheese pie.', '{kids-party,room-rental,studio-rental}'),
  ('09339c8e-babe-43e5-83d0-fb02f7bd55a8', '785b9f41-3c51-47ce-bb22-39d5d17e68b5', 'GF Personal Pizza', 'Personal gluten-free pizza.', '{kids-party,room-rental,studio-rental}'),
  ('9dc1135c-d678-4977-9689-b28c2bb8c407', '9dff1742-a5f6-46e1-99c6-d2ec68f6b588', 'Pizza Party Spread (per person)', 'A snack station of assorted pizzas, pepperoni rolls, pinwheels, and stuffed knots — served hot and ready.', '{kids-party,room-rental,studio-rental}'),
  -- dessert-add-on
  ('3eaeca69-cbb7-4c28-933c-b0082779e2f9', '324b8e7d-b824-4357-aa44-69e0a55568ff', 'Custom Treat Table', 'Styled to match your party theme and filled with delicious, eye-catching treats — the perfect centerpiece.', '{kids-party,room-rental,studio-rental}'),
  ('a4b2b404-2caa-4474-8db7-a90c64f4d92a', '477601f3-e64a-4a56-9032-bd2b133ceabc', 'Candy Wall', 'Choose any 8 candies for guests to enjoy and take home in the bags provided.', '{kids-party,room-rental,studio-rental}'),
  ('21ba8102-b202-43d0-aea0-cdbf39b3302b', '20add6cd-49bd-4755-b529-69018e62f2bc', 'Sheet Cake', 'Full sheet, filled — choose filling & theme. Serves 50–70. Final price confirmed after we review your theme.', '{kids-party,room-rental,studio-rental}'),
  ('944ee6cd-37db-4b50-8629-1af1f8cf8a37', '000d8f46-f90e-49b5-87ea-ad7ffd5849ce', 'Half Sheet Cake', '½ sheet, filled — choose filling & theme. Serves 25–30. Final price confirmed after we review your theme.', '{kids-party,room-rental,studio-rental}'),
  ('310a6a5c-5f41-43e1-9aee-084839aa8fba', 'd2ae9260-6b24-49df-a5c4-35ae37d6df28', 'Cake Pops (per dozen)', 'Per dozen.', '{kids-party,room-rental,studio-rental}'),
  ('f4146d8d-149b-406c-9021-fa029ed95bc6', '6b0884d8-f23b-4b55-b648-8208f7281207', 'Macarons (per dozen)', 'Per dozen.', '{kids-party,room-rental,studio-rental}'),
  ('106d3f3c-d452-4428-aada-68dfbd66208c', 'eda58cd0-c867-4649-a616-5baa0f45a222', 'Chocolate Covered Pretzels (per dozen)', 'Per dozen.', '{kids-party,room-rental,studio-rental}'),
  ('c17cdf9a-0943-4437-ad63-03dd65e12063', 'c784cb5a-4e3a-4681-b26a-9ef20e4ffdac', 'Dunkin'' Munchkins (50 count)', 'A 50-count bucket of Dunkin'' Munchkins.', '{kids-party,room-rental,studio-rental}'),
  ('7fa0195a-792c-4da8-af3d-fd7f40bc9b99', 'e04adf35-87dc-4c05-8666-39e98036dab1', 'Dunkin'' Donuts (per dozen)', 'Assorted Dunkin'' donuts.', '{kids-party,room-rental,studio-rental}'),
  -- beverage-add-on
  ('1711856a-8830-492e-85eb-d26f684d8574', 'd8ddc4ba-1f48-4cff-92e7-ba95ad675ff0', 'Open Fridge', 'Your favorite canned and bottled non-alcoholic drinks, fully stocked and chilled - grab and enjoy.', '{kids-party,room-rental,studio-rental}'),
  ('294c7e8d-9a00-4ff2-ab30-fc6f1c25124a', '4d7a2242-ff2f-4062-873f-b8eb4d219205', 'Coffee Bar', 'Coffee station setup.', '{kids-party,room-rental,studio-rental}'),
  -- decor-add-on
  ('c8606a86-7be6-423c-9896-04a1a427ad2b', 'd4e16bea-d295-49b7-a19f-113ef7144b14', 'Double Arch Backdrop & Balloon Arches', 'A modern, fully customizable double arch backdrop with a coordinated balloon garland — pick your colors, theme, and wording.', '{kids-party,room-rental,studio-rental}'),
  ('06303028-ceb0-4276-899d-8f8e158aa1af', '99397a64-ceda-4666-9924-62962c298e3b', 'Balloon Garland 6 ft.', 'A 6-foot organic balloon garland in your colors.', '{kids-party,room-rental,studio-rental}'),
  ('582ccf95-050e-446b-a90e-8276ffd0a03e', '3d1e5cbd-4213-4262-9f25-de78f4466312', 'Balloon Tower 6 ft.', 'A 6-foot balloon tower centerpiece in your colors.', '{kids-party,room-rental,studio-rental}'),
  ('2c5152d6-e634-4e1f-8add-66c265444962', '212e864a-0460-446b-af9c-d9e0f1ae1eb9', 'Barbie Box', 'A life-size Barbie box photo moment - step in for picture-perfect party photos.', '{kids-party,room-rental,studio-rental}'),
  -- service-add-on (room-rental + studio-rental; the studio row carries the line items)
  ('0895d53d-217b-413a-9f8d-8ea49d9ec909', '9d7e6885-3e61-4030-8a7f-f437157f8d88', 'Full Clean-up Service', 'Just walk away. Leave the clean-up and garbage disposal to us.', '{room-rental,studio-rental}'),
  ('c3ac5546-bd5b-4ddb-811a-b2ed5ee94b72', 'a16b629a-4d05-4056-9fff-7fac4f9c781d', 'Garbage Service', 'Leave your garbage, let us take care of it.', '{room-rental,studio-rental}');

-- Re-run: drop pairs already merged.
DELETE FROM _merge m USING public.pricing_items d
 WHERE d.id = m.drop_id AND d.is_active = false AND d.metadata->>'merged_into' = m.keep_id::text;

-- Refuse to merge anything that is not a true duplicate.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(k.name || ' / ' || d.name, '; ') INTO bad
    FROM _merge m
    JOIN public.pricing_items k ON k.id = m.keep_id
    JOIN public.pricing_items d ON d.id = m.drop_id
   WHERE k.category <> d.category
      OR k.price_cents <> d.price_cents
      OR coalesce(k.price_type, '') <> coalesce(d.price_type, '')
      OR NOT k.is_active OR NOT d.is_active;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 092: not a duplicate pair (category, price, type or active differs): %', bad;
  END IF;
  IF (SELECT count(*) FROM _merge m WHERE NOT EXISTS (SELECT 1 FROM public.pricing_items k WHERE k.id = m.keep_id)
                                    OR NOT EXISTS (SELECT 1 FROM public.pricing_items d WHERE d.id = m.drop_id)) > 0 THEN
    RAISE EXCEPTION 'migration 092: a listed row does not exist';
  END IF;
END $$;

UPDATE public.booking_line_items l
   SET pricing_item_id = m.keep_id
  FROM _merge m
 WHERE l.pricing_item_id = m.drop_id;

UPDATE public.pricing_items d
   SET is_active = false,
       metadata = coalesce(d.metadata, '{}'::jsonb) || jsonb_build_object('merged_into', m.keep_id::text, 'merged_by', 'migration_092')
  FROM _merge m
 WHERE d.id = m.drop_id;

UPDATE public.pricing_items k
   SET name = m.new_name,
       description = m.new_description,
       event_types = m.channels,
       emoji = coalesce(k.emoji, d.emoji),
       price_label = coalesce(k.price_label, d.price_label),
       -- What this overwrote, so it can be put back without a backup.
       metadata = coalesce(k.metadata, '{}'::jsonb) || jsonb_build_object('before_092', jsonb_build_object(
         'name', k.name, 'description', k.description, 'event_types', k.event_types, 'emoji', k.emoji, 'price_label', k.price_label))
  FROM _merge m
  JOIN public.pricing_items d ON d.id = m.drop_id
 WHERE k.id = m.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pricing_items_active_category_name
  ON public.pricing_items (category, lower(name))
  WHERE is_active;

-- 5. The switch for a mobile "starts at" figure on the website chat and the ChatGPT
--    connector. Nothing charges from it: `lib/pricingCatalog.ts` reads it by key as
--    `mobileQuoteFrom`, outside REQUIRED_KEYS, and the planner's mobile ladder is
--    untouched. INACTIVE: Adam chose no mobile figure on the agents, same as the
--    website (2026-11-08), so they say "quoted individually". Set is_active = true
--    and they say "starts at $850 for 10 kids". It was applied active for a few
--    hours that day and deactivated before any code read it.
INSERT INTO public.pricing_items (name, description, category, price_cents, price_type, is_active, sort_order, metadata)
SELECT 'Mobile Party — starting price (quoted individually)',
       'The starting figure the website chat and the ChatGPT connector give for a mobile party while this row is active. Not charged by anything.',
       'mobile-package', 85000, 'flat', false, 90,
       '{"catalog_key": "mobile_quote_from", "kids": 10}'::jsonb
 WHERE NOT EXISTS (SELECT 1 FROM public.pricing_items WHERE metadata->>'catalog_key' = 'mobile_quote_from');

COMMIT;
