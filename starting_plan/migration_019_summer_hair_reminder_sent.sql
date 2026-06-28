-- Add reminder_sent flag to summer_hair_bookings
-- Tracks whether the 1-hour-before SMS reminder has been sent

ALTER TABLE summer_hair_bookings
  ADD COLUMN IF NOT EXISTS reminder_sent boolean NOT NULL DEFAULT false;
