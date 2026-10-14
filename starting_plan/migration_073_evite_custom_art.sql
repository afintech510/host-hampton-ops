-- Migration 073: a host's own finished invitation
--
-- SCHEMA. Adam, 2026-10-14: a host (HH-2026-2515) made her own invitation, a
-- portrait of the birthday child on a unicorn, and it should BE the party's
-- EVITE, for that party only, with RSVPs and reminders working around it.
--
-- WHY A COLUMN AND NOT A TEMPLATE FILE. Every other design is art in
-- services/website/public/evites/<slug>/ plus a template in the registry. This
-- one cannot be: the repository is PUBLIC and the art is a real child's face
-- (and her mother's phone number). So the art lives in Supabase Storage, in
-- the `evites` bucket at `<image_key>/<custom_art>` - the same folder as the
-- party's rendered invitation, exactly as public as that already is and no
-- more - and this column names it. lib/evites/customArt.ts is the reader; the
-- `custom` template slug is not in the registry, so no gallery, picker or
-- admin override can reach it.
--
-- WHAT. One nullable column. NULL = draw the normal template, which is every
-- existing row, so nothing that exists changes. The CHECK screens the SHAPE of
-- the object name; `image_key` (32 hex) supplies the folder.
--
-- Additive and nullable: code deployed before this migration never selects it.
-- Code deployed AFTER it selects it, so apply this FIRST.

ALTER TABLE evites
  ADD COLUMN IF NOT EXISTS custom_art text
  CONSTRAINT evites_custom_art_shape CHECK (custom_art ~ '^custom-[0-9a-f]{8,32}\.jpg$');

COMMENT ON COLUMN evites.custom_art IS
  'The host''s own finished invitation: an object in the evites bucket at <image_key>/<custom_art>, '
  'drawn as the whole picture for this party only. NULL = the normal template (migration 073).';

-- Proof: the column exists, is nullable, and every existing row is NULL.
SELECT column_name, data_type, is_nullable,
       (SELECT count(*) FROM evites WHERE custom_art IS NOT NULL) AS rows_with_custom_art
  FROM information_schema.columns
 WHERE table_name = 'evites' AND column_name = 'custom_art';
