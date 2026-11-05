-- Migration 087 — the photo library learns what KIND of thing a row is, and
-- where it came from when that is a phone album rather than Instagram.
--
-- ── WHAT IS DELIBERATE ──
--
--   1. `media_kind` is 'photo' | 'reel' | 'video_still'.
--        photo        a still picture (an Instagram post slide, an album photo)
--        reel         the THUMBNAIL of an Instagram reel; `ig_permalink` is the
--                     reel's own URL, which is what a click-to-load embed needs
--                     later. Nothing here loads Instagram's script.
--        video_still  a poster frame of a video from a phone album. There is no
--                     public URL to embed, so it is only ever a still.
--      Until now a reel thumbnail and a photo were indistinguishable in this
--      table (the permalink was the only trace), so a reel could not be offered
--      as a reel. Backfilled below from the permalink.
--   2. `source` gains 'icloud': a photo taken from a shared phone album, imported
--      from local files. Those pictures were taken at CLIENTS' HOMES, so the row
--      never stores the album's share link (`ig_permalink` stays NULL — it is
--      returned to customers by find_photos), and the importer re-encodes every
--      file to WebP with all metadata, GPS included, dropped.
--   3. `review_flag` is a short reason a human should look twice before approving
--      (for example a letterboard that may show a child's name). NULL = nothing
--      noted. It never approves or blocks anything by itself; the face check and
--      the approval remain the only gates.
--
-- APPLIED 2026-11-05 through the Supabase MCP, registered there under the name
-- migration_086_media_kind (the crew session took file number 086 in the same hour;
-- the registry name is cosmetic, this file is the record).
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
--         (or the Supabase MCP). Safe to re-run.

BEGIN;

ALTER TABLE public.media_assets ADD COLUMN IF NOT EXISTS media_kind text NOT NULL DEFAULT 'photo';
ALTER TABLE public.media_assets ADD COLUMN IF NOT EXISTS review_flag text;

ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS media_assets_media_kind_check;
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_media_kind_check CHECK (media_kind IN ('photo', 'reel', 'video_still'));

ALTER TABLE public.media_assets DROP CONSTRAINT IF EXISTS media_assets_source_check;
ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_source_check CHECK (source IN ('instagram', 'gallery', 'admin', 'icloud'));

UPDATE public.media_assets SET media_kind = 'reel' WHERE ig_permalink LIKE 'https://www.instagram.com/reel/%' AND media_kind <> 'reel';

CREATE INDEX IF NOT EXISTS idx_media_assets_candidates ON public.media_assets(source, media_kind) WHERE NOT approved;

COMMIT;
