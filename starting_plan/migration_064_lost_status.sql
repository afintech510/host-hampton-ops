-- Migration 064 — `lost` booking status (2026-10-07)
--
-- A lead that told us no ("you can release the date") is not a cancelled
-- booking: nobody booked, nothing is owed, and it must not later be treated as
-- a past client (review asks, birthday rebooking). Until now the only exit from
-- the pipeline was `cancelled`, so lost leads either sat at `lead` forever or
-- were filed as cancellations.
--
-- `lost` joins `lead`/`quoted`/`cancelled` in the scheduled-fields exemption: a
-- lost lead often never had a date or time.
--
-- Additive only. No existing row changes here.

BEGIN;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status = ANY (ARRAY[
  'lead', 'quoted', 'pending_review', 'awaiting_deposit', 'deposit_paid', 'confirmed',
  'approved', 'modifications_locked', 'paid_in_full', 'completed', 'cancelled', 'lost'
]::text[]));

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_scheduled_fields_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_scheduled_fields_check CHECK (
  status = ANY (ARRAY['lead', 'quoted', 'cancelled', 'lost']::text[])
  OR (party_date IS NOT NULL AND party_time IS NOT NULL AND contact_name IS NOT NULL)
);

COMMIT;
