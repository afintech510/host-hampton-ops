-- ══════════════════════════════════════════════════════════════
-- Migration 017: Studio Rental self-serve flow
--   1. Agreement (SignWell) + security-deposit columns on bookings
--   2. Studio-rental add-on menu seeded into pricing_items
-- Run via Supabase MCP / SQL editor. Idempotent.
-- ══════════════════════════════════════════════════════════════

-- ── 1. bookings: agreement + security-deposit tracking ─────────
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS signwell_document_id    TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS agreement_signed_at     TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS agreement_pdf_url       TEXT;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS security_deposit_pi_id  TEXT;
-- security_deposit_status: none | authorized | captured | released | expired
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS security_deposit_status TEXT DEFAULT 'none';

CREATE INDEX IF NOT EXISTS idx_bookings_signwell_doc
  ON public.bookings(signwell_document_id) WHERE signwell_document_id IS NOT NULL;

-- ── 2. Studio-rental add-on menu ───────────────────────────────
-- Fully self-serve, fully priced. price_type drives the math:
--   flat       → unit_price × quantity
--   per_person → unit_price × guest_count   (guest_multiplied)
--   per_hour   → unit_price × hours         (quantity = # hours)
-- Tagged event_types = {studio-rental} so the page query is isolated
-- from the kids-party / room-rental menus.

-- Idempotent: clear any prior studio-rental-tagged rows before seeding.
DELETE FROM public.pricing_items
WHERE event_types @> ARRAY['studio-rental']::text[]
  AND event_types <@ ARRAY['studio-rental']::text[];

INSERT INTO public.pricing_items
  (name, description, category, price_cents, price_label, price_type, is_popular, sort_order, emoji, event_types, is_active)
VALUES
  -- Decor
  ('Double Arch Backdrop & Balloon Arches', 'A modern, fully customizable double arch backdrop with a coordinated balloon garland — pick your colors, theme, and wording.', 'decor-add-on', 25000, NULL, 'flat', true,  1, '🎈', ARRAY['studio-rental'], true),
  ('Room Setup & Décor',                     'Let us set up the room and decorate to match your theme.',                                                                       'decor-add-on', 12500, NULL, 'flat', false, 2, '✨', ARRAY['studio-rental'], true),
  ('Barbie Box',            'A life-size Barbie box photo moment - step in for picture-perfect party photos.', 'decor-add-on', 10000, NULL, 'flat', false, 3, '🎀', ARRAY['studio-rental'], true),
  ('Balloon Garland 6 ft.', 'A 6-foot organic balloon garland in your colors.',                               'decor-add-on', 15000, NULL, 'flat', false, 4, '🎈', ARRAY['studio-rental'], true),
  ('Balloon Tower 6 ft.',   'A 6-foot balloon tower centerpiece in your colors.',                             'decor-add-on', 12500, NULL, 'flat', false, 5, '🎈', ARRAY['studio-rental'], true),

  -- Services
  ('Party Helper (per hour)',  'A professional party server who handles setup, keeps food stations stocked, assists guests, and manages cleanup throughout the event.', 'service-add-on', 3000, NULL, 'per_hour', false, 1, '🙋‍♀️', ARRAY['studio-rental'], true),
  ('Full Clean-up Service',    'Just walk away. Leave the clean-up and garbage disposal to us.',                                                                          'service-add-on', 12500, NULL, 'flat', true,  2, '🧹', ARRAY['studio-rental'], true),
  ('Photo Booth',              'Open-air photo booth with props for your guests.',                                                                                       'service-add-on', 11900, NULL, 'flat', true,  3, '📸', ARRAY['studio-rental'], true),
  ('Linen Rentals',            'For all tables during your party room rental.',                                                                                          'service-add-on', 9500, NULL, 'flat', false, 4, '🧺', ARRAY['studio-rental'], true),
  ('Garbage Service',          'Leave your garbage, let us take care of it.',                                                                                            'service-add-on', 3500, NULL, 'flat', false, 5, '🗑️', ARRAY['studio-rental'], true),

  -- Food
  ('Pizza Party Spread (per person)', 'A snack station of assorted pizzas, pepperoni rolls, pinwheels, and stuffed knots — served hot and ready.', 'food-add-on', 1000, NULL, 'per_person', true,  1, '🍕', ARRAY['studio-rental'], true),
  ('Salad Tray',           'Full tray. Choose type: Caesar or Tossed Garden.',          'food-add-on', 6000, NULL, 'flat', false, 3, '🥗', ARRAY['studio-rental'], true),
  ('Antipasto Salad',      'Full tray.',                                                'food-add-on', 8500, NULL, 'flat', false, 4, '🥗', ARRAY['studio-rental'], true),
  ('Garlic Knots (per tray)', 'Per tray.',                                              'food-add-on', 3500, NULL, 'flat', false, 5, '🧄', ARRAY['studio-rental'], true),

  -- Desserts / treats
  ('Custom Treat Table',   'Styled to match your party theme and filled with delicious, eye-catching treats — the perfect centerpiece.', 'dessert-add-on', 49500, NULL, 'flat', true,  1, '🍭', ARRAY['studio-rental'], true),
  ('Candy Wall',           'Choose any 8 candies for guests to enjoy and take home in the bags provided.',                                'dessert-add-on', 20000, NULL, 'flat', true,  2, '🍬', ARRAY['studio-rental'], true),
  ('Sheet Cake',           'Full sheet, filled — choose filling & theme. Serves 50–70. Final price confirmed after we review your theme.', 'dessert-add-on', 11000, 'From $110', 'flat', false, 3, '🎂', ARRAY['studio-rental'], true),
  ('Half Sheet Cake',      '½ sheet, filled — choose filling & theme. Serves 25–30. Final price confirmed after we review your theme.',   'dessert-add-on',  8000, 'From $80',  'flat', false, 4, '🎂', ARRAY['studio-rental'], true),
  ('Cake Pops (per dozen)','Per dozen.',                                                'dessert-add-on', 6000, NULL, 'flat', false, 5, '🍡', ARRAY['studio-rental'], true),
  ('Chocolate Covered Pretzels (per dozen)', 'Per dozen.',                              'dessert-add-on', 3000, NULL, 'flat', false, 6, '🥨', ARRAY['studio-rental'], true),

  -- Beverages
  ('Open Fridge', 'Your favorite canned and bottled non-alcoholic drinks, fully stocked and chilled — grab and enjoy.', 'beverage-add-on', 12500, NULL, 'flat', false, 1, '🥤', ARRAY['studio-rental'], true);

-- Verify
SELECT category, name, price_cents, price_type, is_popular, sort_order
FROM public.pricing_items
WHERE event_types @> ARRAY['studio-rental']::text[]
ORDER BY category, sort_order, name;
