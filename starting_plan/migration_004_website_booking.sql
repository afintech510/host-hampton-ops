-- ══════════════════════════════════════════════════════════════
-- Migration 004: Website Booking + Agent Content Tables
-- Run in Supabase SQL Editor
-- ══════════════════════════════════════════════════════════════

-- Drop existing tables if they were partially created
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS website_content CASCADE;
DROP SEQUENCE IF EXISTS booking_seq;

-- ── bookings table ──────────────────────────────────────────────
CREATE TABLE bookings (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ref               TEXT UNIQUE NOT NULL,
    -- Human-readable ref: HH-2026-0042
    -- Generate on insert: 'HH-' || to_char(NOW(), 'YYYY') || '-' || lpad(nextval('booking_seq')::text, 4, '0')
  status                    TEXT NOT NULL DEFAULT 'deposit_paid',
    -- deposit_paid | confirmed | cancelled | refunded

  event_type                TEXT NOT NULL DEFAULT 'kid-party',
    -- kid-party | room-rental | adult-event | communion | fundraiser | cheer | other

  party_date                DATE NOT NULL,
  party_time                TEXT NOT NULL,
    -- e.g. '2:00 PM'

  package_type              TEXT,
    -- e.g. 'Glow Party', 'Swiftie Party', 'Room Rental - Weekend'

  guest_count_approx        INT,
  child_name                TEXT,
  child_age                 INT,

  contact_name              TEXT NOT NULL,
  contact_email             TEXT NOT NULL,
  contact_phone             TEXT,

  deposit_amount            INT NOT NULL DEFAULT 250,
    -- in cents? No — store as dollars (250 = $250)

  stripe_payment_intent_id  TEXT,
  stripe_session_id         TEXT,
  google_calendar_event_id  TEXT,

  party_tags                JSONB NOT NULL DEFAULT '{}',
    -- Flexible preferences bag. Example:
    -- {
    --   "theme": "Swiftie",
    --   "decor": ["balloon arch", "photo booth"],
    --   "food": ["pizza", "custom cake"],
    --   "activity": ["karaoke", "friendship bracelets"],
    --   "dessert": ["cupcake tower"],
    --   "balloons": ["gold", "pink"],
    --   "beverage_package": "coffee bar",
    --   "add_ons": ["character visit", "face painter"],
    --   "dietary_notes": "2 guests nut allergy"
    -- }

  notes                     TEXT,
    -- Free-form notes from customer at booking time

  options_locked_by         DATE,
    -- Computed on insert: party_date - INTERVAL '7 days'
    -- Customer can update party_tags until this date

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sequence for human-readable booking refs
CREATE SEQUENCE IF NOT EXISTS booking_seq START 1;

-- Index for common lookups
CREATE INDEX IF NOT EXISTS idx_bookings_party_date   ON bookings(party_date);
CREATE INDEX IF NOT EXISTS idx_bookings_status       ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_event_type   ON bookings(event_type);
CREATE INDEX IF NOT EXISTS idx_bookings_email        ON bookings(contact_email);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION update_bookings_updated_at();


-- ── website_content table ───────────────────────────────────────
-- Agents write content here; Next.js site fetches and renders it.

CREATE TABLE website_content (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             TEXT UNIQUE NOT NULL,
    -- Full path slug, e.g. 'blog/first-birthday-party-hamptons'
    -- For theme pages: 'themes/glow-party'
    -- For landing pages: 'first-birthday-parties'

  page_type        TEXT NOT NULL,
    -- 'blog_post' | 'theme_page' | 'faq' | 'landing' | 'event'

  title            TEXT NOT NULL,
  meta_description TEXT,
    -- 150-160 chars for SEO

  body_html        TEXT,
    -- Rendered HTML or Markdown (Next.js renders either)

  featured_image   TEXT,
    -- URL to image (Cloudflare R2 or external)

  keywords         TEXT[],
    -- Target keywords for SEO tracking

  status           TEXT NOT NULL DEFAULT 'draft',
    -- 'draft' | 'published' | 'archived'

  published_at     TIMESTAMPTZ,
  created_by       TEXT NOT NULL DEFAULT 'COPY',
    -- Agent name or 'manual'

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_website_content_slug       ON website_content(slug);
CREATE INDEX IF NOT EXISTS idx_website_content_page_type  ON website_content(page_type);
CREATE INDEX IF NOT EXISTS idx_website_content_status     ON website_content(status);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_website_content_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER website_content_updated_at
  BEFORE UPDATE ON website_content
  FOR EACH ROW EXECUTE FUNCTION update_website_content_updated_at();


-- ── Seed initial website_content rows for known pages ───────────
-- These are placeholder rows so COPY agent knows what pages exist.
-- Body content will be written by COPY agent.

INSERT INTO website_content (slug, page_type, title, meta_description, status, created_by) VALUES
  ('first-birthday-parties', 'landing', 'First Birthday Party Venue | Host Hampton, Long Island', 'Looking for a first birthday party venue on Long Island or in the Hamptons? Host Hampton in Speonk, NY offers magical first birthday celebrations. Reserve your date today.', 'draft', 'manual'),
  ('communion-party', 'landing', 'First Communion Party Venue | Host Hampton, Speonk NY', 'Celebrate your child''s First Communion at Host Hampton. Private party room, full catering, and customizable themes in the Hamptons. Reserve with a $250 deposit.', 'draft', 'manual'),
  ('fundraiser', 'landing', 'Fundraiser Events at Host Hampton | Speonk, NY', 'Host your next fundraiser or community event at Host Hampton. Private venue rental with flexible setup, catering, and event support in Speonk, NY.', 'draft', 'manual'),
  ('cm-cheer', 'landing', 'CM Cheer Events | Host Hampton', 'CM Cheer at Host Hampton — details coming soon.', 'draft', 'manual')
ON CONFLICT (slug) DO NOTHING;
