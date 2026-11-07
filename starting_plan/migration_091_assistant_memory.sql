-- Migration 091 — Manager assistant memory: preferences the assistant keeps
-- between chats ("show times in 12-hour New York time").
--
-- One short sentence per row, two scopes:
--   personal  one admin's own preference; `owner` is their actor id
--             ('admin:<email>' or the historical 'ADMIN'), so nobody else sees it.
--   business  a studio-wide rule everyone using the assistant gets; `owner` is NULL.
--
-- Rows are written ONLY by /api/admin/assistant/memory, which the assistant's
-- "Remember" card replays after a person presses Confirm (and which the Memory
-- panel calls directly from a person's own click). The model never writes here.
-- A memory is a style preference: it can never switch off a confirmation card or
-- change what a customer is sent, and the route refuses text that tries.
--
-- Service-role only (RLS on, no policies, anon and authenticated revoked), like
-- migration 084. Additive and safe to re-run.

CREATE TABLE IF NOT EXISTS public.assistant_memories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope       text NOT NULL CHECK (scope IN ('personal', 'business')),
  owner       text,
  body        text NOT NULL CHECK (char_length(body) BETWEEN 3 AND 300),
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- A personal memory has an owner; a business one has none.
  CONSTRAINT assistant_memories_owner_matches_scope
    CHECK ((scope = 'personal' AND owner IS NOT NULL) OR (scope = 'business' AND owner IS NULL))
);

-- The same sentence is not stored twice for the same person (or twice as a business rule).
CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_memories_scope_owner_body
  ON public.assistant_memories (scope, COALESCE(owner, ''), lower(body));

CREATE INDEX IF NOT EXISTS idx_assistant_memories_owner ON public.assistant_memories (owner);

ALTER TABLE public.assistant_memories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_memories FROM anon, authenticated;
