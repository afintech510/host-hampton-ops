-- ══════════════════════════════════════════════════════════════
-- migration_027_voice_profile.sql
--
--   Operator voice profile (Allie's language), consumed by the LLM drafting
--   nodes (generate-draft, future fb_reply / inquiry-response drafts) so drafts
--   sound like her. Versioned: each refinement is a new row; exactly one row is
--   is_active = true at a time. The human-readable twin lives at
--   docs/marketing/voice-profile.md (what Allie edits directly).
--
--   RLS is enabled here from birth with owner/admin + service_role policies
--   (same pattern as ingested_messages / migration_026) — this table is never
--   exposed to anon/authenticated.
--
--   Idempotent. Apply BY HAND in the Supabase SQL editor. Not auto-applied.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.voice_profile (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version      integer NOT NULL,
  is_active    boolean NOT NULL DEFAULT false,
  -- structured profile: tone_rules[], greeting, signoff, pricing_style,
  -- dos[], donts[], exemplars[] {context, text}, plus free-form fields
  profile      jsonb   NOT NULL,
  doc_path     text,                    -- pointer to the markdown twin
  corpus_notes text,                    -- provenance + confidence caveat
  confidence   text    NOT NULL DEFAULT 'low',  -- low | medium | high
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- exactly one active profile at a time
CREATE UNIQUE INDEX IF NOT EXISTS voice_profile_one_active
  ON public.voice_profile (is_active) WHERE is_active;

-- version is unique
CREATE UNIQUE INDEX IF NOT EXISTS voice_profile_version_uniq
  ON public.voice_profile (version);

ALTER TABLE public.voice_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS only_owner_manages_voice_profile ON public.voice_profile;
CREATE POLICY only_owner_manages_voice_profile ON public.voice_profile
  FOR ALL TO public
  USING (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]));

DROP POLICY IF EXISTS service_role_full_access_voice_profile ON public.voice_profile;
CREATE POLICY service_role_full_access_voice_profile ON public.voice_profile
  FOR ALL TO public
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);
