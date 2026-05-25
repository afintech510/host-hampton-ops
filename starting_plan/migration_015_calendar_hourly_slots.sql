-- Migration 015: Party planner calendar — 11am-7pm hourly slots, all days.
-- Applies to both studio (Host Hampton) and mobile parties — the planner uses
-- the single 'kids-party' booking_type regardless of location.
--
-- Effect: customers see selectable start times at 11:00, 12:00, 13:00, 14:00,
-- 15:00, 16:00, 17:00, 18:00 (last slot ends 19:00 = 7pm). All 7 days of the
-- week are bookable unless blocked via Google Calendar.
--
-- Idempotent — safe to re-run. No data loss.

-- Preview current config
SELECT slug, label, open_time, close_time, slot_duration_min, buffer_min, allowed_days, min_advance_days
FROM booking_types
WHERE slug = 'kids-party';

-- Update to hourly windows, full week, 11am–7pm
UPDATE booking_types
SET
  open_time = '11:00',
  close_time = '19:00',
  slot_duration_min = 60,
  buffer_min = 0,
  allowed_days = ARRAY[0,1,2,3,4,5,6]
WHERE slug = 'kids-party';

-- Verify
SELECT slug, label, open_time, close_time, slot_duration_min, buffer_min, allowed_days, min_advance_days
FROM booking_types
WHERE slug = 'kids-party';
