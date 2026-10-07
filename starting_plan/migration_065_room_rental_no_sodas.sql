-- Migration 065: Sodas & Seltzers ($50) comes off the room-rental menu
--
-- DATA, not schema. Adam, 2026-10-07: remove it from the room rental menu.
-- Migration 063 had added it as a `studio-rental` row, which is what
-- /party-room-rental and the /studio-rental checkout read. Deactivated rather
-- than deleted, because booking_line_items may reference it by
-- pricing_item_id. The untagged row that /party-packages shows is untouched.
--
-- Same day, same ruling: the Party Helper is $30/hr on both rows. The
-- room-rental row already read 3000 / '$30/hr' when this was written, so
-- the UPDATE below is a no-op that keeps the ruling written down.

BEGIN;

UPDATE pricing_items SET is_active = false
WHERE category = 'beverage-add-on' AND name = 'Sodas & Seltzers'
  AND event_types @> ARRAY['studio-rental'];

UPDATE pricing_items SET price_cents = 3000, price_label = '$30/hr'
WHERE category = 'service-add-on' AND name = 'Party Helper'
  AND event_types @> ARRAY['room-rental'];

COMMIT;
