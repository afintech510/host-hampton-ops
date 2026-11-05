-- Migration 082 — crew onboarding: private profile + agreement record.
--
-- Staff sign in by phone, then give their legal name, email, birthday, home
-- address and an emergency contact, and sign the subcontractor agreement.
--
-- ── WHAT IS DELIBERATE ──
--
--   1. A SEPARATE TABLE, not columns on crew_members. Every crew-facing route
--      selects from crew_members; putting a home address and a date of birth
--      there would make "one careless select('*')" a leak. Reads of this table
--      happen in exactly two places (/api/crew/me/profile — the member's own
--      row — and the audited admin profile route). RLS is on with no policies
--      and anon/authenticated are revoked, as for every crew table.
--
--   2. NO TAX IDS. No SSN/EIN/W-9 columns, ever. W-9s are handled at year end.
--
--   3. `crew_login_codes` gains `purpose` ('login' | 'email_confirm') and
--      `target_email`, so confirming a typed email address reuses the proven
--      code table without a login code being usable for it or the reverse.
--      Existing rows are logins.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run.

BEGIN;

ALTER TABLE public.crew_login_codes ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'login';
ALTER TABLE public.crew_login_codes ADD COLUMN IF NOT EXISTS target_email text;
ALTER TABLE public.crew_login_codes DROP CONSTRAINT IF EXISTS crew_login_codes_purpose_check;
ALTER TABLE public.crew_login_codes ADD CONSTRAINT crew_login_codes_purpose_check CHECK (purpose IN ('login', 'email_confirm'));

CREATE TABLE IF NOT EXISTS public.crew_member_profiles (
  member_id               uuid PRIMARY KEY REFERENCES public.crew_members(id) ON DELETE CASCADE,
  legal_first_name        text,
  legal_last_name         text,
  preferred_name          text,
  date_of_birth           date,
  address_line1           text,
  address_line2           text,
  city                    text,
  state                   text,
  zip                     text,
  emergency_name          text,
  emergency_relationship  text,
  emergency_phone         text,
  onboarding_completed_at timestamptz,
  agreement_document_id   text,
  agreement_version       text,
  agreement_sent_at       timestamptz,
  agreement_signed_at     timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crew_member_profiles DROP CONSTRAINT IF EXISTS crew_member_profiles_state_check;
ALTER TABLE public.crew_member_profiles ADD CONSTRAINT crew_member_profiles_state_check CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');
ALTER TABLE public.crew_member_profiles DROP CONSTRAINT IF EXISTS crew_member_profiles_zip_check;
ALTER TABLE public.crew_member_profiles ADD CONSTRAINT crew_member_profiles_zip_check CHECK (zip IS NULL OR zip ~ '^[0-9]{5}$');

CREATE UNIQUE INDEX IF NOT EXISTS uq_crew_member_profiles_agreement_doc
  ON public.crew_member_profiles(agreement_document_id) WHERE agreement_document_id IS NOT NULL;

ALTER TABLE public.crew_member_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crew_member_profiles FROM anon, authenticated;
GRANT ALL ON public.crew_member_profiles TO service_role;

COMMENT ON TABLE public.crew_member_profiles IS 'Private crew onboarding data (migration 082). Service role only; never selected by a crew-facing route except the member''s own row.';

COMMIT;
