-- ============================================================
-- migration_006: Series events support
-- Adds multi-session booking, bundle pricing, session labels
-- ============================================================

-- 1. Events: allow multi-session selection + bundle pricing tiers
ALTER TABLE events ADD COLUMN IF NOT EXISTS allow_multi_session BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN IF NOT EXISTS bundle_pricing JSONB DEFAULT '[]';
-- bundle_pricing format: [{"minSessions":1,"pricePerSessionCents":3500},{"minSessions":3,"pricePerSessionCents":3000}]

-- 2. Sessions: add label for subject/theme (e.g. "Art Camp", "Science Week")
ALTER TABLE event_sessions ADD COLUMN IF NOT EXISTS label TEXT;

-- 3. Tickets: group_ref links multi-session tickets from a single purchase
ALTER TABLE event_tickets ADD COLUMN IF NOT EXISTS group_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_event_tickets_group ON event_tickets(group_ref);
