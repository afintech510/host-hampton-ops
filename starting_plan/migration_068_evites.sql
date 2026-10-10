-- Migration 068 — EVITE: shareable birthday invitations + RSVPs (2026-10-10)
--
-- Source of truth: docs/specs/evites/03-architecture-spec.md (LOCKED v1.1) §1, amended in place before it was ever
-- applied by the adversarial-review fixes (spec v1.2): evite_rsvps.reminder_set_at + rsvp_reminder_email_has_set_at,
-- evite_reminder_email_recent() counting reminder_set_at, and evite_reminder_email_on_evite().
-- Additive only. No existing table, column or row is changed. The one change
-- outside the five new tables is the `lead_source` enum gaining 'evite', and the
-- one new storage object is the public `evites` bucket.
--
-- NOT APPLIED BY DEPLOY. Apply by hand, with Adam's OK, BEFORE deploying code
-- that reads these tables (AGENTS.md §6). Until it is applied the app must run
-- with EVITES_PAGES=off (the default), which reads nothing here.
--
-- Postgres version. `uniq_evite_send_once` uses NULLS NOT DISTINCT, which needs
-- PG15+. The live database is PG 17.6 (same note as migration 046, which made
-- the same call for `uniq_event_ticket_per_session_line`). Here it is what makes
-- the claim bind for sends with no RSVP (rsvp_id IS NULL): without it, a
-- redelivered `lead_preview` / `invite_ready` would slip straight past the index.
--
-- Transaction boundary. Everything except the enum change is inside one
-- transaction. `ALTER TYPE ... ADD VALUE` cannot run inside a transaction block
-- on older Postgres, so it sits after COMMIT on purpose; `IF NOT EXISTS` makes it
-- safe to re-run. The storage bucket insert is inside the transaction.
--
-- Constraint names. `evites.booking_id UNIQUE` and `evites.slug UNIQUE` are left
-- unnamed so Postgres names them `evites_booking_id_key` and `evites_slug_key`.
-- lib/evites/ensure.ts tells the two 23505s apart by those names; its test pins
-- them. Do not rename either.
--
-- RLS is enabled on all five tables with NO policies: service role only.
--
-- ROLLBACK (manual, in this order; the enum value stays, it is harmless).
-- Empty the bucket through the Storage API first (SQL deletes of storage.objects
-- leave the files behind), then:
--
--   BEGIN;
--   DROP TABLE IF EXISTS evite_events, evite_sends, evite_rsvps, evite_consent_texts, evites CASCADE;
--   DROP FUNCTION IF EXISTS evite_reminder_email_recent(text);
--   DROP FUNCTION IF EXISTS evite_reminder_email_on_evite(uuid, text);
--   DROP FUNCTION IF EXISTS touch_evites_updated_at();
--   DELETE FROM storage.buckets WHERE id = 'evites';
--   COMMIT;

BEGIN;

CREATE TABLE evites (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,  -- one evite per booking, ever
  slug                  text NOT NULL UNIQUE
                        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*-[0-9a-hjkmnp-tv-z]{4}$' AND char_length(slug) BETWEEN 9 AND 48),
  previous_slugs        text[] NOT NULL DEFAULT '{}',    -- re-minted before go-live; resolve → 308 to slug
  template_slug         text NOT NULL DEFAULT 'glow',
  theme_word            text CHECK (char_length(theme_word) BETWEEN 1 AND 12),
  theme_sub             text CHECK (char_length(theme_sub)  BETWEEN 1 AND 12),
  host_contact_name     text CHECK (char_length(host_contact_name) BETWEEN 1 AND 40),          -- NULL = studio default
  host_contact_phone    text CHECK (host_contact_phone ~ '^[2-9][0-9]{2}-[0-9]{3}-[0-9]{4}$'),  -- NULL = studio default
  show_host_contact     boolean NOT NULL DEFAULT true,
  host_note             text CHECK (char_length(host_note) <= 140),
  gift_note             text CHECK (char_length(gift_note) <= 140),
  rsvp_deadline         date,
  -- render bookkeeping
  render_version        integer NOT NULL DEFAULT 0,
  render_inputs_hash    text,
  image_key             text UNIQUE,                     -- 32 hex, random, independent of slug
  invite_object         text,                            -- e.g. invite-v3-9f2c.jpg (random suffix per attempt)
  og_object             text,
  rendered_at           timestamptz,
  render_claim          uuid,                            -- claim token
  render_claimed_at     timestamptz,
  render_error          text,
  -- calendar bookkeeping (independent of rendering)
  cal_version           integer NOT NULL DEFAULT 0,      -- ICS SEQUENCE; bumps only after go-live
  cal_inputs_hash       text,
  cal_changed_at        timestamptz,
  -- lifecycle
  went_live_at          timestamptz,                     -- stamped by cron when first seen live; never cleared
  cancelled_notice_at   timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evite_consent_texts (
  version     text PRIMARY KEY,
  channel     text NOT NULL CHECK (channel IN ('email')),
  wording     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO evite_consent_texts VALUES ('club-v1','email','Send me party & craft ideas from Host Hampton', now());

CREATE TABLE evite_rsvps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evite_id             uuid NOT NULL REFERENCES evites(id) ON DELETE CASCADE,
  status               text NOT NULL CHECK (status IN ('yes','no')),
  revision             integer NOT NULL DEFAULT 1,       -- +1 on every material change
  parent_name          text NOT NULL CHECK (char_length(parent_name) BETWEEN 1 AND 120),
  children             jsonb NOT NULL DEFAULT '[]'       -- [{"first_name": "Ava"}], siblings included
                       CHECK (jsonb_typeof(children) = 'array' AND jsonb_array_length(children) <= 6),
  child_count          integer GENERATED ALWAYS AS (jsonb_array_length(children)) STORED,
  adult_count          smallint NOT NULL DEFAULT 0 CHECK (adult_count BETWEEN 0 AND 2),   -- 2 = "2+"
  has_allergy          boolean,
  allergy_note         text CHECK (char_length(allergy_note) <= 300),
  note_to_honoree      text CHECK (char_length(note_to_honoree) <= 500),
  reminder_email       text CHECK (char_length(reminder_email) <= 254),
  reminder_set_at      timestamptz,                      -- when reminder_email was last set or CHANGED (POST or PATCH); the cap counts THIS, not created_at
  reminder_phone_e164  text CHECK (reminder_phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  reminder_opt_out_at  timestamptz,
  cal_version_seen     integer NOT NULL DEFAULT 0,       -- highest cal_version this guest was sent
  club_email           text CHECK (char_length(club_email) <= 254),
  club_opt_in_at       timestamptz,
  opt_in_text_version  text REFERENCES evite_consent_texts(version),
  club_opted_out_at    timestamptz,
  birthday_month       smallint CHECK (birthday_month BETWEEN 1 AND 12),
  contact_id           uuid REFERENCES contacts(id) ON DELETE SET NULL,
  consent_ip           inet,
  edit_nonce           text NOT NULL CHECK (char_length(edit_nonce) = 16),   -- in the signed edit token; change to revoke
  allergy_purged_at    timestamptz,
  contacts_purged_at   timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rsvp_no_has_no_party CHECK (status = 'yes' OR (jsonb_array_length(children) = 0 AND adult_count = 0)),
  CONSTRAINT rsvp_yes_has_a_child CHECK (status = 'no'  OR jsonb_array_length(children) >= 1),
  CONSTRAINT rsvp_club_is_complete CHECK (club_opt_in_at IS NULL OR (club_email IS NOT NULL AND opt_in_text_version IS NOT NULL)),
  CONSTRAINT rsvp_one_reminder_channel CHECK (reminder_email IS NULL OR reminder_phone_e164 IS NULL),
  CONSTRAINT rsvp_reminder_email_has_set_at CHECK (reminder_email IS NULL OR reminder_set_at IS NOT NULL)
);
CREATE INDEX idx_evite_rsvps_evite ON evite_rsvps (evite_id);
CREATE INDEX idx_evite_rsvps_reminder_email ON evite_rsvps (lower(reminder_email), reminder_set_at) WHERE reminder_email IS NOT NULL;

-- DB-backed per-recipient caps (the in-memory limiter forgets after an hour and on deploy).
-- Both count the address as it is HELD NOW. The 24-hour one counts reminder_set_at, not created_at: a PATCH that
-- sets the address on an older row is a new "ask to mail this stranger" and must count (v1.2).
CREATE FUNCTION evite_reminder_email_recent(p_email text) RETURNS integer
  LANGUAGE sql STABLE SECURITY INVOKER AS
$$ SELECT count(*)::int FROM evite_rsvps
   WHERE lower(reminder_email) = lower(btrim(p_email)) AND reminder_set_at > now() - interval '24 hours' $$;

-- Per-evite cap: how many RSVPs on ONE invitation hold this address (a link holder cannot aim one address at a
-- stranger from fifty RSVPs on one party).
CREATE FUNCTION evite_reminder_email_on_evite(p_evite_id uuid, p_email text) RETURNS integer
  LANGUAGE sql STABLE SECURITY INVOKER AS
$$ SELECT count(*)::int FROM evite_rsvps
   WHERE evite_id = p_evite_id AND lower(reminder_email) = lower(btrim(p_email)) $$;

CREATE TABLE evite_sends (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evite_id     uuid NOT NULL REFERENCES evites(id) ON DELETE CASCADE,
  rsvp_id      uuid REFERENCES evite_rsvps(id) ON DELETE CASCADE,
  send_type    text NOT NULL CHECK (send_type IN ('lead_preview','invite_ready','new_rsvp','rsvp_changed','rsvp_confirmed',
                                                  'week_before','day_before','details_changed','final_headcount','party_cancelled')),
  ref_version  integer NOT NULL DEFAULT 0,
  channel      text NOT NULL CHECK (channel IN ('email','sms')),
  status       text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed','skipped')),
  attempts     integer NOT NULL DEFAULT 1,
  outcome      text,
  provider_id  text,
  last_error   text,
  claimed_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE UNIQUE INDEX uniq_evite_send_once
  ON evite_sends (evite_id, rsvp_id, send_type, ref_version, channel) NULLS NOT DISTINCT;

CREATE TABLE evite_events (               -- analytics; no PII
  id          bigserial PRIMARY KEY,
  evite_id    uuid NOT NULL REFERENCES evites(id) ON DELETE CASCADE,
  event       text NOT NULL CHECK (event IN ('invite_viewed','share_clicked','rsvp_started','rsvp_completed',
                                             'club_opted_in','birthday_month_saved','calendar_added')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_evite_events ON evite_events (evite_id, event);

CREATE FUNCTION touch_evites_updated_at() RETURNS trigger LANGUAGE plpgsql AS
$$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER evites_updated_at      BEFORE UPDATE ON evites      FOR EACH ROW EXECUTE FUNCTION touch_evites_updated_at();
CREATE TRIGGER evite_rsvps_updated_at BEFORE UPDATE ON evite_rsvps FOR EACH ROW EXECUTE FUNCTION touch_evites_updated_at();

ALTER TABLE evites              ENABLE ROW LEVEL SECURITY;
ALTER TABLE evite_rsvps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE evite_sends         ENABLE ROW LEVEL SECURITY;
ALTER TABLE evite_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE evite_consent_texts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON FUNCTION evite_reminder_email_recent(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION evite_reminder_email_on_evite(uuid, text) FROM anon, authenticated;
-- No policies: service role only.

-- Public storage bucket for the rendered invitation and OG card (spec §1 Storage).
-- 2 MB limit, JPEG only. No list policy: objects are fetched by their random
-- <image_key>/<object> path, never enumerated. There was no earlier
-- storage.buckets insert in starting_plan/ to copy; the columns are the spec's
-- plus `name`, which storage.buckets requires.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('evites', 'evites', true, 2097152, '{image/jpeg}')
ON CONFLICT DO NOTHING;

COMMIT;
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'evite';
