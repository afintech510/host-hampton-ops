-- Migration 012: Photo gallery URL + post-party thank-you email
-- Safe to run anytime — only adds nullable column. No data loss risk.
-- Apply via Supabase SQL editor or psql.

-- 1. Add photo_gallery_url column to bookings (nullable, free-text)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS photo_gallery_url TEXT;

COMMENT ON COLUMN bookings.photo_gallery_url IS
  'Optional URL to photo gallery (Google Photos, Dropbox, Pic-Time, etc.) shown in post-party thank-you email if present.';

-- 2. (No backfill needed — existing bookings get NULL, email handler skips photo block.)

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'bookings' AND column_name = 'photo_gallery_url';
