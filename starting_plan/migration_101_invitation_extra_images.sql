-- Migration 101: extra pictures on an invitation page
--
-- A host may add up to four extra pictures to their invitation PAGE (/i/<slug>), shown below the
-- invitation image and details and above the RSVP form: "Bring diapers to be entered into the
-- raffle", "Bring a book instead of a card". Page-only: nothing is printed on the invitation image,
-- so adding one never re-renders it.
--
-- Each element is { "object": "extra-<16 hex>.jpg", "alt": "<= 120 chars" }; the picture lives in
-- Supabase Storage, bucket `evites`, at <image_key>/<object> (the party's own folder, exactly as
-- public as the invitation itself). lib/evites/extraImages.ts is the reader and the screen.
--
-- Additive, NOT NULL with a default of an empty array, so every existing row is unchanged.
-- Code deployed after this selects the column, so apply this FIRST.

ALTER TABLE evites
  ADD COLUMN IF NOT EXISTS extra_images jsonb NOT NULL DEFAULT '[]'::jsonb
  CONSTRAINT evites_extra_images_shape CHECK (jsonb_typeof(extra_images) = 'array' AND jsonb_array_length(extra_images) <= 4);

COMMENT ON COLUMN evites.extra_images IS
  'Up to four extra pictures for the invitation page: [{object, alt}], objects in the evites bucket at <image_key>/<object> (migration 101).';

-- Proof: the column exists, is NOT NULL, and every existing row is an empty array.
SELECT column_name, data_type, is_nullable,
       (SELECT count(*) FROM evites WHERE extra_images <> '[]'::jsonb) AS rows_with_pictures
  FROM information_schema.columns
 WHERE table_name = 'evites' AND column_name = 'extra_images';