-- Migration 036 — pricing catalog: Mobile, Studio Rental and guest rules as data
--
-- Phase 4 item 4 of docs/booking-agent-plan.md. Until now the numbers below
-- lived in three different places in TypeScript:
--   - `lib/mobilePricing.ts`          the published two-tier mobile anchor
--   - `lib/studioRental.ts`           the studio block-rental rate engine
--   - `PartyBuilderContent.tsx:17-40` the planner's own inline constants
-- which is why the planner's mobile ladder ($400 + surcharges) and the
-- published anchor ($500 / $750) could drift apart without anyone noticing:
-- nothing compared them, because they were never in the same place.
--
-- This migration is DATA ONLY — no DDL. `pricing_items` already has every
-- column needed (`metadata jsonb` carries the structure). The four new
-- categories are:
--
--   mobile-package      published tiers + the planner's guest bands + policy
--   mobile-station      the curated station list for the invoice menu appendix
--   studio-rental-rate  base / additional-hour / full-day-cap per day type
--   guest-overage       included-guest count, per-extra-guest, mini party
--
-- `metadata->>'catalog_key'` is the stable identity `lib/pricingCatalog.ts`
-- looks rows up by. The NAME is display copy and may be re-worded; the
-- catalog_key may not. Every money figure is in CENTS, matching the column.
--
-- NUMBERING NOTE: 036 was reserved in plan §2 for the Phase 6 learning loop.
-- Phase 4 shipped first and the repo numbers migrations in the order they are
-- actually applied (the same reason 033/034 were renumbered twice), so the
-- learning loop is now 037. Plan §2 has been updated.
--
-- Apply:
--   ssh hampton-vps "/root/pg.sh -v ON_ERROR_STOP=1 --single-transaction -f -" < this file
--
-- Idempotent: safe to re-run. `pricing_items` has no unique constraint on
-- (category, name), so each block UPDATEs matching rows and INSERTs only the
-- ones that are absent. The INSERT's NOT EXISTS reads the pre-statement
-- snapshot, so it cannot race the UPDATE in its own CTE.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. mobile-package
-- ─────────────────────────────────────────────────────────────────────────
-- Two kinds of row live here, and they are NOT alternatives to each other:
--   'published_tier' — what /mobile-party and the 26 town pages advertise.
--                      Both tiers work out to $62.50/child on purpose; the
--                      Signature tier buys time and stations, not a higher
--                      per-head rate. Worth keeping true if these move.
--   'planner_band'   — what the party planner charges when someone builds a
--                      mobile party themselves: a flat base by guest band,
--                      with craft stations priced separately per person.
-- `includes` is the bullet list rendered on the tier card.

WITH v(name, description, category, price_cents, price_label, price_type, sort_order, emoji, metadata) AS (
  VALUES
    ('Mobile Party — Entry', 'One craft, start to finish', 'mobile-package', 50000, NULL, 'flat', 1, '🎨',
     '{"catalog_key":"mobile_tier_entry","kind":"published_tier","tier":"Entry","minutes":60,"kids":8,
       "tagline":"One craft, start to finish","popular":false,
       "includes":["One craft station of your choice",
                   "A dedicated host who runs the whole activity",
                   "All supplies, aprons and surface covers brought in",
                   "A finished keepsake for every child",
                   "Full setup and cleanup — we leave it as we found it"]}'::jsonb),

    ('Mobile Party — Signature', 'Our most-booked mobile party', 'mobile-package', 75000, NULL, 'flat', 2, '✨',
     '{"catalog_key":"mobile_tier_signature","kind":"published_tier","tier":"Signature","minutes":90,"kids":12,
       "tagline":"Our most-booked mobile party","popular":true,
       "includes":["Hair tinsel for every guest",
                   "Glitter tattoos",
                   "Your choice of craft station",
                   "A dedicated host running every station",
                   "All supplies, aprons and surface covers brought in",
                   "A finished keepsake for every child",
                   "Full setup and cleanup — we leave it as we found it"]}'::jsonb),

    ('Mobile Party Base (up to 18 guests)', 'Planner base rate for an at-home party', 'mobile-package', 40000, NULL, 'flat', 10, NULL,
     '{"catalog_key":"mobile_planner_base","kind":"planner_band","band":"base","max_guests":18}'::jsonb),

    ('Mobile Party — 19–27 guests surcharge', 'Added to the base for 19–27 guests', 'mobile-package', 15000, NULL, 'flat', 11, NULL,
     '{"catalog_key":"mobile_planner_tier2","kind":"planner_band","band":"tier2","guest_threshold":18}'::jsonb),

    ('Mobile Party — 28+ guests surcharge', 'Added again for 28 guests and up', 'mobile-package', 15000, NULL, 'flat', 12, NULL,
     '{"catalog_key":"mobile_planner_tier3","kind":"planner_band","band":"tier3","guest_threshold":27}'::jsonb),

    ('Mobile Party — Additional Child', 'Per additional child beyond the tier''s included count', 'mobile-package', 3500, NULL, 'flat', 20, NULL,
     '{"catalog_key":"mobile_extra_child","kind":"policy"}'::jsonb),

    ('Mobile Party — Minimum Guests', 'Fewest guests we will run a mobile party for', 'mobile-package', 0, '6 guest minimum', 'flat', 21, NULL,
     '{"catalog_key":"mobile_min_guests","kind":"policy","value":6}'::jsonb),

    ('Mobile Party — Free Travel Radius', 'Free travel from the Speonk studio; a modest fee past it', 'mobile-package', 0, 'Free within 20 miles', 'flat', 22, NULL,
     '{"catalog_key":"mobile_free_travel_miles","kind":"policy","value":20}'::jsonb)
),
upd AS (
  UPDATE public.pricing_items p SET
    description = v.description, price_cents = v.price_cents, price_label = v.price_label,
    price_type = v.price_type, sort_order = v.sort_order, emoji = v.emoji,
    metadata = v.metadata, is_active = true
  FROM v WHERE p.category = v.category AND p.name = v.name
  RETURNING p.id
)
INSERT INTO public.pricing_items (name, description, category, price_cents, price_label, price_type, sort_order, emoji, metadata, is_active)
SELECT v.name, v.description, v.category, v.price_cents, v.price_label, v.price_type, v.sort_order, v.emoji, v.metadata, true
FROM v
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_items p WHERE p.category = v.category AND p.name = v.name
);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. studio-rental-rate
-- ─────────────────────────────────────────────────────────────────────────
-- The rate engine in lib/studioRental.ts: a 3-hour minimum block, additional
-- hours on top, and a full-day cap the fee never exceeds no matter how long
-- the window. The customer's chosen window includes their own setup and
-- cleanup. The $500 security hold is a refundable card auth placed day-of, NOT
-- the booking deposit (which is a flat $250 for every party type — see
-- BOOKING_DEPOSIT_CENTS in lib/partyPricing.ts and do not duplicate it here).

WITH v(name, description, category, price_cents, price_label, price_type, sort_order, metadata) AS (
  VALUES
    ('Studio Rental — Weekend 3 hr base', 'Saturday or Sunday, first 3 hours', 'studio-rental-rate', 60000, NULL, 'flat', 1,
     '{"catalog_key":"studio_weekend_base","kind":"base","day":"weekend"}'::jsonb),
    ('Studio Rental — Weekday 3 hr base', 'Monday–Friday, first 3 hours', 'studio-rental-rate', 47500, NULL, 'flat', 2,
     '{"catalog_key":"studio_weekday_base","kind":"base","day":"weekday"}'::jsonb),
    ('Studio Rental — Weekend additional hour', 'Each hour beyond the 3-hour base', 'studio-rental-rate', 15000, NULL, 'per_hour', 3,
     '{"catalog_key":"studio_weekend_addl_hour","kind":"addl_hour","day":"weekend"}'::jsonb),
    ('Studio Rental — Weekday additional hour', 'Each hour beyond the 3-hour base', 'studio-rental-rate', 10000, NULL, 'per_hour', 4,
     '{"catalog_key":"studio_weekday_addl_hour","kind":"addl_hour","day":"weekday"}'::jsonb),
    ('Studio Rental — Weekend full-day cap', 'The weekend fee never exceeds this', 'studio-rental-rate', 97500, NULL, 'flat', 5,
     '{"catalog_key":"studio_weekend_full_day","kind":"full_day_cap","day":"weekend"}'::jsonb),
    ('Studio Rental — Weekday full-day cap', 'The weekday fee never exceeds this', 'studio-rental-rate', 70000, NULL, 'flat', 6,
     '{"catalog_key":"studio_weekday_full_day","kind":"full_day_cap","day":"weekday"}'::jsonb),
    ('Studio Rental — Minimum block', 'Shortest billable rental', 'studio-rental-rate', 0, '3 hour minimum', 'flat', 7,
     '{"catalog_key":"studio_min_hours","kind":"policy","value":3}'::jsonb),
    ('Studio Rental — Refundable security hold', 'Card authorisation placed on arrival, released after the event', 'studio-rental-rate', 50000, NULL, 'flat', 8,
     '{"catalog_key":"studio_security_hold","kind":"security_hold"}'::jsonb)
),
upd AS (
  UPDATE public.pricing_items p SET
    description = v.description, price_cents = v.price_cents, price_label = v.price_label,
    price_type = v.price_type, sort_order = v.sort_order, metadata = v.metadata, is_active = true
  FROM v WHERE p.category = v.category AND p.name = v.name
  RETURNING p.id
)
INSERT INTO public.pricing_items (name, description, category, price_cents, price_label, price_type, sort_order, metadata, is_active)
SELECT v.name, v.description, v.category, v.price_cents, v.price_label, v.price_type, v.sort_order, v.metadata, true
FROM v
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_items p WHERE p.category = v.category AND p.name = v.name
);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. guest-overage
-- ─────────────────────────────────────────────────────────────────────────
-- Guest-count-driven money rules for an in-studio theme party. The mini-party
-- discount is stored as a POSITIVE magnitude — the loader negates it — because
-- a negative price_cents in a price catalog reads as a data error at a glance.

WITH v(name, description, category, price_cents, price_label, price_type, sort_order, metadata) AS (
  VALUES
    ('Theme Party — Included Guests', 'Guests covered by every theme party price', 'guest-overage', 0, 'Included', 'flat', 1,
     '{"catalog_key":"theme_included_guests","kind":"policy","value":10}'::jsonb),
    ('Theme Party — Additional Guest', 'Per guest beyond the included count', 'guest-overage', 3500, NULL, 'flat', 2,
     '{"catalog_key":"theme_extra_guest","kind":"overage"}'::jsonb),
    ('Mini Party Discount', 'Taken off the theme price for a 1.5-hour mini party', 'guest-overage', 20000, '-$200', 'flat', 3,
     '{"catalog_key":"mini_party_discount","kind":"discount","duration_hours":1.5}'::jsonb),
    ('Mini Party — Maximum Guests', 'Guest ceiling for the mini-party format', 'guest-overage', 0, 'Max 6 guests', 'flat', 4,
     '{"catalog_key":"mini_party_max_guests","kind":"policy","value":6}'::jsonb)
),
upd AS (
  UPDATE public.pricing_items p SET
    description = v.description, price_cents = v.price_cents, price_label = v.price_label,
    price_type = v.price_type, sort_order = v.sort_order, metadata = v.metadata, is_active = true
  FROM v WHERE p.category = v.category AND p.name = v.name
  RETURNING p.id
)
INSERT INTO public.pricing_items (name, description, category, price_cents, price_label, price_type, sort_order, metadata, is_active)
SELECT v.name, v.description, v.category, v.price_cents, v.price_label, v.price_type, v.sort_order, v.metadata, true
FROM v
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_items p WHERE p.category = v.category AND p.name = v.name
);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. mobile-station — the curated invoice menu
-- ─────────────────────────────────────────────────────────────────────────
-- Lifted verbatim from the master list in
-- `.claude/skills/party-quote-invoice/SKILL.md`, which is deliberately NOT a
-- mirror of /mobile-party's menu: it reflects what has actually been run as a
-- mobile station. Construction Hat Craft and Life Size Barbie Box are on the
-- website but were deliberately cut from THIS list — do not re-add them
-- without being asked.
--
-- No station has a published price. `/mobile-party` has never carried
-- per-station pricing, and every dollar figure in past mobile invoices was
-- quoted by hand, so `price_cents = 0` with `price_label = 'Ask'` is the
-- honest shape: the invoice menu appendix renders the chip without a price,
-- and anything actually being billed becomes a real line item instead.

WITH v(name, category, price_cents, price_label, price_type, sort_order, emoji, metadata) AS (
  VALUES
    ('Mobile Spa Party',                  'mobile-station', 0, 'Ask', 'flat',  1, '🧖', '{"catalog_key":"station_mobile_spa"}'::jsonb),
    ('Hair Tinsel',                       'mobile-station', 0, 'Ask', 'flat',  2, '✨', '{"catalog_key":"station_hair_tinsel"}'::jsonb),
    ('Glitter Freckles',                  'mobile-station', 0, 'Ask', 'flat',  3, '💫', '{"catalog_key":"station_glitter_freckles"}'::jsonb),
    ('Canvas Bag Bar',                    'mobile-station', 0, 'Ask', 'flat',  4, '👜', '{"catalog_key":"station_canvas_bag_bar"}'::jsonb),
    ('Manicures',                         'mobile-station', 0, 'Ask', 'flat',  5, '💅', '{"catalog_key":"station_manicures"}'::jsonb),
    ('Glitter Tattoos',                   'mobile-station', 0, 'Ask', 'flat',  6, '🦋', '{"catalog_key":"station_glitter_tattoos"}'::jsonb),
    ('Slime',                             'mobile-station', 0, 'Ask', 'flat',  7, '🟢', '{"catalog_key":"station_slime"}'::jsonb),
    ('Bracelet Making',                   'mobile-station', 0, 'Ask', 'flat',  8, '📿', '{"catalog_key":"station_bracelet_making"}'::jsonb),
    ('Drip Paint Balloon Dogs',           'mobile-station', 0, 'Ask', 'flat',  9, '🐩', '{"catalog_key":"station_balloon_dogs"}'::jsonb),
    ('Lip-Gloss Charms',                  'mobile-station', 0, 'Ask', 'flat', 10, '💋', '{"catalog_key":"station_lip_gloss_charms"}'::jsonb),
    ('Trucker Hat Bar',                   'mobile-station', 0, 'Ask', 'flat', 11, '🧢', '{"catalog_key":"station_trucker_hat_bar"}'::jsonb),
    ('Sand Art',                          'mobile-station', 0, 'Ask', 'flat', 12, '🏖️', '{"catalog_key":"station_sand_art"}'::jsonb),
    ('Canvas Painting',                   'mobile-station', 0, 'Ask', 'flat', 13, '🎨', '{"catalog_key":"station_canvas_painting"}'::jsonb),
    ('Photobooth',                        'mobile-station', 0, 'Ask', 'flat', 14, '📸', '{"catalog_key":"station_photobooth"}'::jsonb),
    ('Adopt a Puppy',                     'mobile-station', 0, 'Ask', 'flat', 15, '🐶', '{"catalog_key":"station_adopt_a_puppy"}'::jsonb),
    ('KPop Backdrop',                     'mobile-station', 0, 'Ask', 'flat', 16, '🎤', '{"catalog_key":"station_kpop_backdrop"}'::jsonb),
    ('Sunglass Craft',                    'mobile-station', 0, 'Ask', 'flat', 17, '🕶️', '{"catalog_key":"station_sunglass_craft"}'::jsonb),
    ('Decoden Crafts',                    'mobile-station', 0, 'Ask', 'flat', 18, '🎀', '{"catalog_key":"station_decoden_crafts"}'::jsonb),
    ('Seashell Decorating',               'mobile-station', 0, 'Ask', 'flat', 19, '🐚', '{"catalog_key":"station_seashell_decorating"}'::jsonb),
    ('Perfume Making',                    'mobile-station', 0, 'Ask', 'flat', 20, '🌸', '{"catalog_key":"station_perfume_making"}'::jsonb),
    ('Hair Brush Decorating',             'mobile-station', 0, 'Ask', 'flat', 21, '💇', '{"catalog_key":"station_hair_brush_decorating"}'::jsonb),
    ('Glam Makeup',                       'mobile-station', 0, 'Ask', 'flat', 22, '💄', '{"catalog_key":"station_glam_makeup"}'::jsonb),
    ('Jelly Tote Decorating',             'mobile-station', 0, 'Ask', 'flat', 23, '👛', '{"catalog_key":"station_jelly_tote_decorating"}'::jsonb),
    ('Beaded Braids',                     'mobile-station', 0, 'Ask', 'flat', 24, '🪢', '{"catalog_key":"station_beaded_braids"}'::jsonb),
    ('Decorate-Your-Own Microphone',      'mobile-station', 0, 'Ask', 'flat', 25, '🎙️', '{"catalog_key":"station_diy_microphone"}'::jsonb),
    ('Pirate Sword Decorating',           'mobile-station', 0, 'Ask', 'flat', 26, '⚔️', '{"catalog_key":"station_pirate_sword_decorating"}'::jsonb)
),
upd AS (
  UPDATE public.pricing_items p SET
    price_cents = v.price_cents, price_label = v.price_label, price_type = v.price_type,
    sort_order = v.sort_order, emoji = v.emoji, metadata = v.metadata, is_active = true
  FROM v WHERE p.category = v.category AND p.name = v.name
  RETURNING p.id
)
INSERT INTO public.pricing_items (name, category, price_cents, price_label, price_type, sort_order, emoji, metadata, is_active)
SELECT v.name, v.category, v.price_cents, v.price_label, v.price_type, v.sort_order, v.emoji, v.metadata, true
FROM v
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_items p WHERE p.category = v.category AND p.name = v.name
);

COMMIT;
