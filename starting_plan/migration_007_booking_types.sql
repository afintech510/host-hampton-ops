-- ══════════════════════════════════════════════════════════════
-- Migration 007: Booking Types for Universal Calendar
-- Configures event type rules: allowed days, slot duration,
-- deposit requirements, tags for filtering
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS booking_types (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT UNIQUE NOT NULL,
  label             TEXT NOT NULL,
  description       TEXT,
  allowed_days      INT[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  slot_duration_min INT NOT NULL DEFAULT 60,
  buffer_min        INT NOT NULL DEFAULT 0,
  open_time         TEXT,
  close_time        TEXT,
  requires_deposit  BOOLEAN NOT NULL DEFAULT true,
  deposit_cents     INT NOT NULL DEFAULT 25000,
  min_advance_days  INT NOT NULL DEFAULT 1,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  sort_order        INT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_types_slug ON booking_types(slug);
CREATE INDEX IF NOT EXISTS idx_booking_types_tags ON booking_types USING GIN(tags);

-- ── Seed booking types ────────────────────────────────────────
INSERT INTO booking_types (slug, label, description, allowed_days, slot_duration_min, buffer_min, open_time, close_time, requires_deposit, deposit_cents, min_advance_days, tags, sort_order) VALUES
  ('kids-party',
   'Kids Birthday Party',
   'Private themed birthday party in our studio. 2-hour exclusive use.',
   '{0,6}', 120, 30, '10:00', '18:00', true, 25000, 7,
   '{private,childrens,kids-party,family}', 1),

  ('team-party',
   'Team Party',
   'Cheer, sports, dance team celebrations in our private studio.',
   '{0,6}', 120, 30, '10:00', '18:00', true, 25000, 7,
   '{private,childrens,family}', 2),

  ('room-rental',
   'Room Rental',
   'Rent the full studio for your own event — bring your own everything.',
   '{0,1,2,3,4,5,6}', 180, 30, NULL, NULL, true, 25000, 3,
   '{private,room-rental}', 3),

  ('private-catered',
   'Private Catered Lunch or Dinner',
   'An intimate catered dining experience in our studio.',
   '{0,1,2,3,4,5,6}', 120, 30, '11:00', '20:00', true, 25000, 3,
   '{private,adult}', 4),

  ('perm-jewelry',
   'Permanent Jewelry Appointment',
   'Walk-in or appointment for permanent bracelets, anklets, and necklaces.',
   '{1,2,3,4,5}', 30, 0, '12:00', '19:00', false, 0, 1,
   '{private,perm-jewelry}', 10),

  ('custom-trucker-hat',
   'Custom Trucker Hat',
   'Design your own trucker hat with iron-on patches.',
   '{1,2,3,4,5}', 30, 0, '12:00', '19:00', false, 0, 1,
   '{private}', 11),

  ('custom-canvas-bag',
   'Custom Canvas Bag',
   'Create a custom canvas tote bag with embroidery or patches.',
   '{1,2,3,4,5}', 30, 0, '12:00', '19:00', false, 0, 1,
   '{private}', 12),

  ('canvas-zipper-bag',
   'Canvas Zipper Makeup Bag',
   'Personalize a canvas zipper pouch — great for gifts.',
   '{1,2,3,4,5}', 30, 0, '12:00', '19:00', false, 0, 1,
   '{private}', 13),

  ('hair-tinsel',
   'Hair Tinsel',
   'Sparkly hair tinsel application — walk-in or by appointment.',
   '{1,2,3,4,5}', 30, 0, '12:00', '19:00', false, 0, 1,
   '{private}', 14),

  ('retail-shopping',
   'Retail Shopping',
   'Browse our retail area by appointment.',
   '{1,2,3,4,5}', 30, 0, '12:00', '19:00', false, 0, 1,
   '{private}', 15),

  ('see-the-room',
   'See the Room',
   'Schedule a walkthrough of our studio before booking.',
   '{1,2,3,4,5}', 30, 0, '12:00', '19:00', false, 0, 1,
   '{private}', 16),

  ('photo-shoot',
   'Photography Shoot',
   'Use our beautifully decorated studio for professional photos.',
   '{0,1,2,3,4,5,6}', 60, 15, NULL, NULL, true, 5000, 2,
   '{private}', 20),

  ('private-spray-tan',
   'Private Spray Tan',
   'Professional spray tan in our private studio.',
   '{1,2,3,4,5}', 30, 0, '12:00', '19:00', false, 0, 1,
   '{private,adult}', 21),

  ('private-meeting',
   'Private Meeting',
   'Book our studio for a private meeting or small group session.',
   '{1,2,3,4,5}', 60, 0, '12:00', '19:00', false, 0, 1,
   '{private}', 30),

  ('book-club',
   'Book Club',
   'Host your book club meeting in our cozy studio.',
   '{1,2,3,4,5}', 120, 0, '12:00', '19:00', false, 0, 1,
   '{private,adult}', 31),

  ('scouts-meeting',
   'Scouts Meeting',
   'Perfect space for scout troop meetings and badge activities.',
   '{1,2,3,4,5}', 120, 0, '12:00', '19:00', false, 0, 1,
   '{private,family}', 32),

  ('pop-up',
   'Pop-Up Event',
   'Host a pop-up shop or market event in our studio.',
   '{0,1,2,3,4,5,6}', 120, 30, NULL, NULL, false, 0, 3,
   '{public,market}', 40),

  ('your-event',
   'Your Event — Let Us Host',
   'Have something else in mind? Tell us your vision and we''ll make it happen.',
   '{0,1,2,3,4,5,6}', 60, 0, NULL, NULL, false, 0, 1,
   '{private}', 50);
