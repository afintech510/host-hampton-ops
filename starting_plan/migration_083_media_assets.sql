-- Migration 083 — the photo library (media_assets).
--
-- One table behind three readers: the MCP `find_photos` tool, the website Host
-- Assistant's photo carousel, and the admin "send photos" action. Rows come
-- from three places — the curated /gallery photos, the Instagram index that
-- Muse tags, and anything an admin adds.
--
-- ── WHAT IS DELIBERATE ──
--
--   1. THE ONLY ROWS EVER SERVED ARE `approved AND no_identifiable_faces`.
--      Both default FALSE. An imported row is a CANDIDATE until a human has
--      looked at it; `lib/media.ts findPhotos` is the one reader that enforces
--      both, and a test fails the suite if another file selects this table.
--   2. Instagram CDN URLs EXPIRE (the `oe=` query parameter), so the importer
--      downloads each image, strips EXIF/GPS, converts it to WebP and stores it
--      in the public `media` bucket. `url` is OUR copy, never Instagram's.
--   3. `source_key` is unique: re-running an import updates tags and never
--      duplicates a photo or resets a human's approval.
--   4. RLS on, no policies, anon/authenticated revoked — service role only,
--      like every table whose rows a customer must not read directly.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.media_assets (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source                text NOT NULL DEFAULT 'instagram',
  source_key            text NOT NULL,
  url                   text NOT NULL,
  alt                   text NOT NULL DEFAULT '',
  w                     integer,
  h                     integer,
  party_type            text,
  venue                 text,
  theme_slug            text,
  activities            text[] NOT NULL DEFAULT '{}',
  decor_tags            text[] NOT NULL DEFAULT '{}',
  description           text,
  ig_permalink          text,
  posted_at             date,
  quality               smallint,
  tag_confidence        text,
  notes                 text,
  no_identifiable_faces boolean NOT NULL DEFAULT false,
  approved              boolean NOT NULL DEFAULT false,
  approved_by           text,
  approved_at           timestamptz,
  sort                  integer NOT NULL DEFAULT 0,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS media_assets_source_check;
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_source_check CHECK (source IN ('instagram', 'gallery', 'admin'));
-- Approval without a face check is the one state that must be impossible.
ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS media_assets_approved_needs_faces_check;
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_approved_needs_faces_check CHECK (NOT approved OR no_identifiable_faces);

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_source_key ON public.media_assets(source_key);
CREATE INDEX IF NOT EXISTS idx_media_assets_servable ON public.media_assets(party_type, theme_slug) WHERE approved AND no_identifiable_faces;
CREATE INDEX IF NOT EXISTS idx_media_assets_activities ON public.media_assets USING gin (activities);

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.media_assets FROM anon, authenticated;
GRANT ALL ON public.media_assets TO service_role;

COMMIT;
