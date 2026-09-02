-- ══════════════════════════════════════════════════════════════
-- Migration 029: Flash sale price for events
-- Run in Supabase SQL Editor (after migration_028)
--
-- Adds a per-event, time-boxed sale price. A sale is ACTIVE when
--   sale_price_cents IS NOT NULL AND sale_ends_at > now()
-- so it auto-expires with no cron — prices revert on their own.
--
-- The fixed sale price overrides the event's BASE price (price_cents).
-- Variant/session prices keep their own explicit values.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE events
  ADD COLUMN IF NOT EXISTS sale_price_cents INT,          -- NULL = no sale
  ADD COLUMN IF NOT EXISTS sale_ends_at     TIMESTAMPTZ;  -- NULL = no sale

-- Fast filter for "which events are on sale right now"
CREATE INDEX IF NOT EXISTS idx_events_sale_ends ON events(sale_ends_at)
  WHERE sale_price_cents IS NOT NULL;
