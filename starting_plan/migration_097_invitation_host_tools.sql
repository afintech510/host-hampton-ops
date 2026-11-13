-- Migration 097: host tools for an invitation (appearance, second contact, registry, guest list, manual RSVPs)
--
-- First asked for by Adam, 2026-11-12, for the outside-venue baby shower (HH-PTY-WQ3TC):
--   - the host picks the page colour and a sparkle / drift motion
--   - a second person guests can ask questions
--   - a registry link and/or a short message at the bottom of the page
--   - a guest list the host pastes or uploads (names, optional phone numbers)
--   - RSVPs the host adds by hand (a guest who answered by phone or text)
--
-- All additive and nullable / defaulted: code deployed before this migration never selects them.
-- The palette and motion VALUES live in code (lib/evites/pageTheme.ts); the CHECKs screen shape only.

ALTER TABLE evites
  ADD COLUMN IF NOT EXISTS page_color          text CONSTRAINT evites_page_color_shape CHECK (page_color ~ '^[a-z]{3,20}$'),
  ADD COLUMN IF NOT EXISTS page_motion         text CONSTRAINT evites_page_motion_check CHECK (page_motion IN ('none','sparkle','drift')),
  ADD COLUMN IF NOT EXISTS host_contact2_name  text CONSTRAINT evites_host_contact2_name_len CHECK (char_length(host_contact2_name) BETWEEN 1 AND 40),
  ADD COLUMN IF NOT EXISTS host_contact2_phone text CONSTRAINT evites_host_contact2_phone_shape CHECK (host_contact2_phone ~ '^[2-9][0-9]{2}-[0-9]{3}-[0-9]{4}$'),
  ADD COLUMN IF NOT EXISTS registry_url        text CONSTRAINT evites_registry_url_shape CHECK (registry_url ~ '^https://[^[:space:]]{3,290}$'),
  ADD COLUMN IF NOT EXISTS registry_note       text CONSTRAINT evites_registry_note_len CHECK (char_length(registry_note) <= 300);

COMMENT ON COLUMN evites.page_color IS 'Page colour key from lib/evites/pageTheme.ts; NULL = the default (migration 097).';
COMMENT ON COLUMN evites.page_motion IS 'none | sparkle | drift; NULL = none (migration 097).';

-- An RSVP the host typed in, not one a guest sent. Such a row has no reminder and no edit link.
ALTER TABLE evite_rsvps
  ADD COLUMN IF NOT EXISTS added_by_host boolean NOT NULL DEFAULT false;

-- The host's guest list: who they mean to invite. Never emailed or texted BY US: the page offers the host
-- a text link that opens their own messaging app. Phones are stored as +1XXXXXXXXXX.
CREATE TABLE IF NOT EXISTS evite_guests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evite_id   uuid NOT NULL REFERENCES evites(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  phone_e164 text CHECK (phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evite_guests_evite_idx ON evite_guests (evite_id);
ALTER TABLE evite_guests ENABLE ROW LEVEL SECURITY;
