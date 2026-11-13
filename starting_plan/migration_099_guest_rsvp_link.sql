-- Migration 099: a host can say which RSVP answers for a guest on their list.
-- The automatic match is by name (lib/evites/guestList.ts); this overrides it when a guest answered under
-- another name ("Mike" for "Michael"). Nullable; ON DELETE SET NULL so removing the RSVP unlinks the guest.
ALTER TABLE evite_guests
  ADD COLUMN IF NOT EXISTS rsvp_id uuid REFERENCES evite_rsvps(id) ON DELETE SET NULL;
