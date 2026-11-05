-- Migration 084 — the admin chat overlay: persisted threads, durable single-use
-- proposals, and the photo sets an admin sends to a family.
--
-- Three tables, all service-role only (RLS on, no policies, anon and
-- authenticated revoked — like migration 083). Nothing here is readable from a
-- browser with the anon key.
--
-- ── WHAT IS DELIBERATE ──
--
--   1. assistant_threads: ONE thread per admin per context. `context_key` is
--      'general' (the full-screen view and the dashboard) or 'booking:<ref>'
--      (opened from a party / the invoice page), so "add a balloon garland to
--      this" resumes the conversation that is about this party. `messages` is
--      the model-facing history; `lines` is what the UI draws (text + cards).
--
--   2. assistant_used_proposals: the single-use store for confirm cards. It used
--      to be a Map in the container's memory, so a deploy emptied it and a
--      30-minute-old card became replayable (a second "send the links" = a
--      second text to a family). The PRIMARY KEY on proposal_id is the claim:
--      the second INSERT of the same id fails with 23505, atomically, even
--      across two containers. A claim is released (row deleted) only when the
--      replayed route refused with a 4xx BEFORE anything happened.
--
--   3. photo_sets: the chosen photos behind a /p/<token> link. The SMS carries a
--      short link, never MMS. Only the photo IDS are stored; the page re-reads
--      them through lib/media.ts findPhotos on every view, so a photo that is
--      un-approved later disappears from a link already sent. Links expire.
--
-- Apply: additive and safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.assistant_threads (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       text NOT NULL,
  context_key text NOT NULL DEFAULT 'general',
  booking_ref text,
  messages    jsonb NOT NULL DEFAULT '[]'::jsonb,
  lines       jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_threads_actor_context
  ON public.assistant_threads (actor, context_key);

CREATE TABLE IF NOT EXISTS public.assistant_used_proposals (
  proposal_id uuid PRIMARY KEY,
  actor       text NOT NULL,
  kind        text NOT NULL,
  claimed_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_used_proposals_expires
  ON public.assistant_used_proposals (expires_at);

CREATE TABLE IF NOT EXISTS public.photo_sets (
  code        text PRIMARY KEY,
  booking_id  uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  photo_ids   uuid[] NOT NULL,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  CONSTRAINT photo_sets_nonempty CHECK (cardinality(photo_ids) BETWEEN 1 AND 12)
);

CREATE INDEX IF NOT EXISTS idx_photo_sets_booking ON public.photo_sets (booking_id);

ALTER TABLE public.assistant_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_used_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_sets ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.assistant_threads FROM anon, authenticated;
REVOKE ALL ON public.assistant_used_proposals FROM anon, authenticated;
REVOKE ALL ON public.photo_sets FROM anon, authenticated;

GRANT ALL ON public.assistant_threads TO service_role;
GRANT ALL ON public.assistant_used_proposals TO service_role;
GRANT ALL ON public.photo_sets TO service_role;

COMMIT;
