-- ══════════════════════════════════════════════════════════════
-- Migration 022: website_content publishing pipeline + consent gate
--
--   Extends the existing (previously unused) website_content table into
--   a DB-driven content pipeline the app/[...slug] renderer reads from,
--   and installs the child-media CONSENT HARD GATE as a BEFORE UPDATE
--   trigger (layer 1 of 2; src/lib/marketing/consent.ts is the friendly
--   app-side pre-check, layer 2).
--
--   The trigger survives app bugs, direct SQL, and any future agent: a
--   row that references child media cannot move to approved/published
--   unless EVERY attached consent_release (migration_020) is 'signed'.
--
-- Run via Supabase SQL editor. Idempotent. Run by hand — do NOT
-- auto-apply. Depends on migration_020 (consent_releases).
-- ══════════════════════════════════════════════════════════════

-- ── 1. New pipeline columns ────────────────────────────────────
-- Publishing lifecycle. Existing rows are 'draft' (unchanged).
ALTER TABLE public.website_content
  ADD COLUMN IF NOT EXISTS references_child_media BOOLEAN NOT NULL DEFAULT false;

-- Attached consent releases (uuid[] into consent_releases.id).
ALTER TABLE public.website_content
  ADD COLUMN IF NOT EXISTS consent_release_ids UUID[] NOT NULL DEFAULT '{}'::uuid[];

-- Locale for bilingual pages. Default 'en'.
ALTER TABLE public.website_content
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'en'
    CHECK (locale IN ('en', 'es'));

-- Structured content: { sections: [...], faq: [...], jsonLd: {...}, ... }.
-- The renderer prefers this over body_html when present.
ALTER TABLE public.website_content
  ADD COLUMN IF NOT EXISTS structured JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.website_content
  ADD COLUMN IF NOT EXISTS reviewed_by TEXT;
ALTER TABLE public.website_content
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- ── 2. Widen the status set ────────────────────────────────────
-- Was effectively draft|published|archived (no constraint). Add the
-- review states used by the graph. Drop any prior copy of the check
-- first so this is re-runnable.
ALTER TABLE public.website_content
  DROP CONSTRAINT IF EXISTS website_content_status_check;
ALTER TABLE public.website_content
  ADD CONSTRAINT website_content_status_check
    CHECK (status IN ('draft', 'pending_review', 'approved', 'published', 'archived'));

-- ── 3. Unique (slug, locale) instead of unique (slug) ──────────
-- Lets an 'en' and 'es' page share a slug. Existing rows are all 'en'
-- with already-unique slugs, so this is safe.
ALTER TABLE public.website_content
  DROP CONSTRAINT IF EXISTS website_content_slug_key;
DROP INDEX IF EXISTS public.website_content_slug_key;
CREATE UNIQUE INDEX IF NOT EXISTS website_content_slug_locale_key
  ON public.website_content(slug, locale);

-- ── 4. Consent HARD GATE (structural) ──────────────────────────
-- Blocks any transition into approved/published for child-media content
-- unless every attached release exists and is 'signed'. Default-deny:
-- references_child_media = true with no releases is refused.
CREATE OR REPLACE FUNCTION enforce_consent_gate()
RETURNS TRIGGER AS $$
DECLARE
  bad_count INT;
BEGIN
  IF NEW.references_child_media = true
     AND NEW.status IN ('approved', 'published') THEN

    IF NEW.consent_release_ids IS NULL
       OR array_length(NEW.consent_release_ids, 1) IS NULL THEN
      RAISE EXCEPTION
        'Consent gate: content "%" references child media but has no signed release attached (target status=%)',
        NEW.slug, NEW.status;
    END IF;

    -- Any attached id that is missing OR not signed blocks the transition.
    SELECT count(*) INTO bad_count
    FROM unnest(NEW.consent_release_ids) AS rid
    LEFT JOIN public.consent_releases cr ON cr.id = rid
    WHERE cr.id IS NULL OR cr.status <> 'signed';

    IF bad_count > 0 THEN
      RAISE EXCEPTION
        'Consent gate: content "%" has % attached release(s) that are missing or not signed (target status=%)',
        NEW.slug, bad_count, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS website_content_consent_gate ON public.website_content;
CREATE TRIGGER website_content_consent_gate
  BEFORE UPDATE ON public.website_content
  FOR EACH ROW EXECUTE FUNCTION enforce_consent_gate();

-- Verify: show the new columns + constraints.
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'website_content'
  AND column_name IN ('status','references_child_media','consent_release_ids','locale','structured','reviewed_by','reviewed_at')
ORDER BY column_name;
