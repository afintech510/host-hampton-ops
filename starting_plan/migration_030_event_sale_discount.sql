-- ══════════════════════════════════════════════════════════════
-- Migration 030: Sale becomes an AMOUNT OFF (not a fixed price)
-- Run in Supabase SQL Editor (after migration_029)
--
-- The flash sale now subtracts a flat dollar amount from EVERY price
-- point on the event — the base price and each per-option variant —
-- clamped so nothing drops below $0. This renames the column added in
-- migration_029; no data is lost. Postgres updates the partial index
-- predicate automatically on rename.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE events RENAME COLUMN sale_price_cents TO sale_discount_cents;
