-- ══════════════════════════════════════════════════════════════
-- Migration 005: Event Ticketing System
-- Run in Supabase SQL Editor (after migration_004)
-- ══════════════════════════════════════════════════════════════

-- ── events table ──────────────────────────────────────────────
CREATE TABLE events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT UNIQUE NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  short_description TEXT,

  category          TEXT NOT NULL DEFAULT 'workshop',
    -- workshop | class | reading | market | drop-off | recurring

  image_url         TEXT,

  -- Pricing (in cents)
  price_cents       INT NOT NULL DEFAULT 0,
  sibling_price_cents INT,
  has_variants      BOOLEAN NOT NULL DEFAULT false,
  variants          JSONB DEFAULT '[]',
    -- e.g. [{"label":"Bring your own garment","priceCents":4000},{"label":"Napkin provided","priceCents":4500}]

  -- Scheduling
  event_date        DATE,
  event_time        TEXT,
  event_end_time    TEXT,
  location          TEXT NOT NULL DEFAULT 'Host Hampton, 295 Montauk Hwy Suite 7, Speonk NY',

  -- Capacity
  max_tickets       INT NOT NULL DEFAULT 30,
  available_tickets INT NOT NULL DEFAULT 30,

  -- Multi-session support (for recurring events)
  has_sessions      BOOLEAN NOT NULL DEFAULT false,

  -- Status
  is_active         BOOLEAN NOT NULL DEFAULT true,
  is_featured       BOOLEAN NOT NULL DEFAULT false,

  google_calendar_event_id TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_events_slug     ON events(slug);
CREATE INDEX idx_events_date     ON events(event_date);
CREATE INDEX idx_events_active   ON events(is_active);
CREATE INDEX idx_events_category ON events(category);

CREATE OR REPLACE FUNCTION update_events_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER events_updated_at
  BEFORE UPDATE ON events
  FOR EACH ROW EXECUTE FUNCTION update_events_updated_at();


-- ── event_sessions table (for recurring / multi-date events) ──
CREATE TABLE event_sessions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  session_date      DATE NOT NULL,
  session_time      TEXT NOT NULL,
  session_end_time  TEXT,
  price_cents       INT,
  max_tickets       INT NOT NULL DEFAULT 30,
  available_tickets INT NOT NULL DEFAULT 30,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_event_sessions_event ON event_sessions(event_id);
CREATE INDEX idx_event_sessions_date  ON event_sessions(session_date);


-- ── event_tickets table ──────────────────────────────────────
CREATE TABLE event_tickets (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_ref               TEXT UNIQUE NOT NULL,
  event_id                 UUID NOT NULL REFERENCES events(id),
  session_id               UUID REFERENCES event_sessions(id),

  customer_name            TEXT NOT NULL,
  customer_email           TEXT NOT NULL,
  customer_phone           TEXT,

  quantity                 INT NOT NULL DEFAULT 1,
  variant_label            TEXT,
  unit_price_cents         INT NOT NULL,
  total_cents              INT NOT NULL,

  stripe_payment_intent_id TEXT,
  stripe_session_id        TEXT,

  status                   TEXT NOT NULL DEFAULT 'confirmed',
    -- confirmed | cancelled | refunded
  refund_amount_cents      INT,
  refund_reason            TEXT,

  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE SEQUENCE IF NOT EXISTS event_ticket_seq START 1;

CREATE INDEX idx_event_tickets_event  ON event_tickets(event_id);
CREATE INDEX idx_event_tickets_session ON event_tickets(session_id);
CREATE INDEX idx_event_tickets_email  ON event_tickets(customer_email);
CREATE INDEX idx_event_tickets_status ON event_tickets(status);

CREATE OR REPLACE FUNCTION update_event_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER event_tickets_updated_at
  BEFORE UPDATE ON event_tickets
  FOR EACH ROW EXECUTE FUNCTION update_event_tickets_updated_at();


-- ── Seed the 7 live events from Squarespace ──────────────────
INSERT INTO events (slug, title, short_description, description, category, price_cents, has_variants, variants, event_date, event_time, max_tickets, available_tickets, is_active, is_featured) VALUES
  ('embroidery-workshop',
   'Embroidery Workshop',
   'Custom embroidery on garments or provided napkins.',
   'Join us for a fun, beginner-friendly embroidery workshop! Choose to bring your own garment or accessory, or use our provided cocktail napkins. All materials and instruction included.',
   'workshop', 4000, true,
   '[{"label":"Bring your own garment","priceCents":4000},{"label":"Cocktail napkin provided","priceCents":4500}]'::jsonb,
   NULL, '6:00 PM', 20, 20, true, true),

  ('sourdough-101-st-patricks',
   'Sourdough 101 — St. Patrick''s Twist',
   'Learn sourdough from scratch with a festive Irish twist.',
   'Master the art of sourdough baking with a St. Patrick''s Day theme! Includes Irish soda bread tasting. You''ll take home your own starter and shaped dough. Limited spots available.',
   'class', 5500, false, '[]'::jsonb,
   '2026-03-12', '6:00 PM', 15, 15, true, true),

  ('spirit-medium-kayla',
   'Spirit Medium Kayla — Group Reading',
   'An intimate group reading with spirit medium Kayla.',
   'Join medium Kayla for an evening of spirit communication and connection. This intimate group setting allows for personal messages and shared healing energy. Light refreshments included.',
   'reading', 5000, false, '[]'::jsonb,
   NULL, '6:00 PM', 27, 27, true, false),

  ('doormat-workshop',
   'Doormat Workshop',
   'Design and create your own custom spring doormat.',
   'Create a one-of-a-kind custom doormat! All materials provided. Choose from spring-themed stencils including "Welcome" with bunny ears design. Perfect for freshening up your front door!',
   'workshop', 6000, false, '[]'::jsonb,
   NULL, '6:00 PM', 20, 20, true, false),

  ('february-break-drop-offs',
   'February Break Drop-Offs',
   'Drop-off activities for kids during February break.',
   'Keep the kids entertained during February break! Drop them off for supervised crafts, games, and activities. Ages 5–12 welcome. Snacks provided.',
   'drop-off', 4500, false, '[]'::jsonb,
   NULL, '10:00 AM', 20, 20, true, false),

  ('open-soft-play-moms-morning',
   'Open Soft Play / Moms in the Morning',
   'Soft play for little ones + coffee & community for moms.',
   'A recurring open play session for toddlers and young children with a soft play area including ball pit, rockers, and climbers. Moms enjoy coffee, connection, and community. Multiple dates available — select your preferred session.',
   'recurring', 1000, false, '[]'::jsonb,
   NULL, '9:00 AM', 25, 25, true, true),

  ('spring-market',
   'Spring Market at Host Hampton',
   'Free community spring market with local vendors.',
   'Browse local vendors, enjoy family activities, and get complimentary Easter Bunny photos at Host Hampton! Free admission — RSVP to save your spot. Saturday, March 15 from 10am–1pm.',
   'market', 0, false, '[]'::jsonb,
   '2026-03-15', '10:00 AM', 100, 100, true, true);

-- Add sessions for "Open Soft Play" recurring event
WITH soft_play AS (SELECT id FROM events WHERE slug = 'open-soft-play-moms-morning')
INSERT INTO event_sessions (event_id, session_date, session_time, max_tickets, available_tickets)
SELECT id, d::date, '9:00 AM', 25, 25
FROM soft_play, unnest(ARRAY['2026-03-04','2026-03-11','2026-03-18','2026-03-25']::date[]) AS d;

UPDATE events SET has_sessions = true WHERE slug = 'open-soft-play-moms-morning';


-- ── RPC functions for atomic ticket count updates ─────────────

CREATE OR REPLACE FUNCTION decrement_event_tickets(eid UUID, qty INT)
RETURNS void AS $$
BEGIN
  UPDATE events
    SET available_tickets = available_tickets - qty
    WHERE id = eid AND available_tickets >= qty;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION decrement_session_tickets(sid UUID, qty INT)
RETURNS void AS $$
BEGIN
  UPDATE event_sessions
    SET available_tickets = available_tickets - qty
    WHERE id = sid AND available_tickets >= qty;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_event_tickets(eid UUID, qty INT)
RETURNS void AS $$
BEGIN
  UPDATE events
    SET available_tickets = LEAST(available_tickets + qty, max_tickets)
    WHERE id = eid;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_session_tickets(sid UUID, qty INT)
RETURNS void AS $$
BEGIN
  UPDATE event_sessions
    SET available_tickets = LEAST(available_tickets + qty, max_tickets)
    WHERE id = sid;
END;
$$ LANGUAGE plpgsql;
