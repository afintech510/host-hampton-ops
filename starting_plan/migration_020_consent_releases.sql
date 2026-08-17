-- ══════════════════════════════════════════════════════════════
-- Migration 020: Consent Releases (child-media hard gate, layer 1)
--   Signed photo/video release per child, tracked via SignWell.
--   Reuses the SignWell integration already used for rental
--   agreements (src/lib/signwell.ts) with a new release template.
--
--   The consent HARD GATE itself lives on website_content in
--   migration_022 (a BEFORE UPDATE trigger that blocks publishing
--   child-media content unless every referenced release here is
--   'signed'). This table is the source of truth it checks against.
--
-- Run via Supabase SQL editor. Idempotent. Run by hand — do NOT
-- auto-apply.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.consent_releases (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Either or both may be set. booking_id ties a release to a party;
  -- contact_id ties it to the guardian who signs.
  booking_id           UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  contact_id           UUID REFERENCES public.contacts(id) ON DELETE SET NULL,

  child_name           TEXT,

  signwell_document_id TEXT,

  -- pending → sent → signed  (revoked is terminal, set by guardian request)
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'sent', 'signed', 'revoked')),

  signed_pdf_url       TEXT,
  signed_at            TIMESTAMPTZ,

  -- Free-form: guardian name/email, scope of consent, revocation notes, etc.
  notes                TEXT,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_releases_booking
  ON public.consent_releases(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consent_releases_contact
  ON public.consent_releases(contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_consent_releases_status
  ON public.consent_releases(status);
CREATE INDEX IF NOT EXISTS idx_consent_releases_signwell_doc
  ON public.consent_releases(signwell_document_id) WHERE signwell_document_id IS NOT NULL;

-- Auto-update updated_at (matches the pattern in migration_004).
CREATE OR REPLACE FUNCTION update_consent_releases_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS consent_releases_updated_at ON public.consent_releases;
CREATE TRIGGER consent_releases_updated_at
  BEFORE UPDATE ON public.consent_releases
  FOR EACH ROW EXECUTE FUNCTION update_consent_releases_updated_at();

-- Verify
SELECT 'consent_releases' AS table_name, count(*) AS rows FROM public.consent_releases;
