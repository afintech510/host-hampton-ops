-- ════════════════════════════════════════════════════════════════════════════
-- Migration 041 — the learning loop (plan §2 "041", Phase 6)
--
-- Allie and Adam already correct the agent's drafts by hand. `inquiry_drafts
-- .revisions[]` records every one of those corrections and nothing has ever
-- read them back. This migration is the substrate for feeding that signal into
-- the draft prompt:
--
--   1. `agent_learnings` — the rules the draft prompt loads.
--   2. `draft_feedback`  — a VIEW, not a table: for every SENT draft, the first
--      agent version next to the version that actually went out.
--
-- ── Why draft_feedback is a view and there is no new capture writer ────────
--
-- Phase 4.5 (§20) refused to add a sixth table for the thread and the reasoning
-- applies here unchanged: a `draft_feedback` TABLE would be a row written by
-- the approve path, agreeing with `revisions[]` only as long as somebody
-- remembered to keep the two in step, and it would be the one row whose
-- provenance nobody could explain. As a view there is no third state — if the
-- feedback is wrong, `revisions[]` is wrong, and fixing the array fixes both.
--
-- ── Why is_active DEFAULTS TO FALSE, which is the load-bearing line here ───
--
-- `agent_learnings.text` is interpolated into the TRUSTED half of the draft
-- prompt, and the rows are distilled from draft text that was itself written in
-- response to a stranger's email. Hard-won rule 5: a field is hostile because
-- of who can WRITE it, not which block it prints in. So nothing this table
-- receives is trusted until a human says so: the weekly distiller may only ever
-- PROPOSE (is_active = false, inert), and `activated_by` records the admin who
-- let a row into the prompt. A future writer that forgets to set is_active
-- fails safe — its row simply never reaches a prompt.
--
-- The unique index on the normalised text is not tidiness: without it the
-- weekly cron re-proposes the same rule every Monday and the review queue is
-- worthless by November. A rule a human has already seen and retired stays
-- retired, because the re-proposal collides with the retired row.
--
-- Idempotent: every statement is IF NOT EXISTS / OR REPLACE / guarded. Safe to
-- re-run, and it was re-run to prove it.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- 1. agent_learnings
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_learnings (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- style   : how she writes (openings, sign-offs, register)
  -- rule    : something the agent must always/never do
  -- fact    : a true thing about the studio it kept getting wrong
  -- pricing : how to TALK about money — never a figure; figures come from
  --           lib/pricingCatalog.ts and the plan, never from a learned row.
  kind             text NOT NULL CHECK (kind IN ('style','rule','fact','pricing')),
  text             text NOT NULL CHECK (length(btrim(text)) BETWEEN 8 AND 400),
  source_draft_id  uuid REFERENCES public.inquiry_drafts(id) ON DELETE SET NULL,
  source_event_id  uuid REFERENCES public.ingested_messages(id) ON DELETE SET NULL,
  confidence       numeric CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  -- FALSE by default. See the header — this is the fence.
  is_active        boolean NOT NULL DEFAULT false,
  created_by       text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  -- Who let this row into the draft prompt, and when. On the row rather than
  -- only in the ledger because this is the one fact a reviewer needs without
  -- running a join: an active learned rule changes every future draft.
  activated_by     text,
  activated_at     timestamptz,
  deactivated_by   text,
  deactivated_at   timestamptz
);

COMMENT ON TABLE public.agent_learnings IS
  'Phase 6 (041). Learned rules loaded into the draft prompt. is_active DEFAULTS '
  'FALSE: the weekly distiller may only propose, never activate. activated_by is '
  'the admin who let the row into a trusted prompt section.';

-- The read the draft node does, every draft: active rows, best first.
CREATE INDEX IF NOT EXISTS idx_agent_learnings_active
  ON public.agent_learnings (is_active, confidence DESC NULLS LAST, created_at DESC);

-- The Inbox review queue: proposals, newest first.
CREATE INDEX IF NOT EXISTS idx_agent_learnings_created
  ON public.agent_learnings (created_at DESC);

-- One row per distinct rule, whatever its state. Stops the weekly cron from
-- re-proposing what a human already judged. The writer treats 23505 as
-- "already proposed" and moves on.
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_learnings_text_uniq
  ON public.agent_learnings (md5(lower(btrim(text))));

COMMENT ON INDEX public.idx_agent_learnings_text_uniq IS
  'Phase 6 (041). A weekly distiller with no dedupe re-proposes the same rule '
  'every Monday until the review queue is unusable. A retired rule stays retired '
  'because the re-proposal collides with it.';

ALTER TABLE public.agent_learnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS only_owner_manages_agent_learnings ON public.agent_learnings;
CREATE POLICY only_owner_manages_agent_learnings ON public.agent_learnings
  FOR ALL TO public
  USING (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]))
  WITH CHECK (current_user_role() = ANY (ARRAY['owner'::text, 'admin'::text]));

DROP POLICY IF EXISTS service_role_full_access_agent_learnings ON public.agent_learnings;
CREATE POLICY service_role_full_access_agent_learnings ON public.agent_learnings
  FOR ALL TO public
  USING (auth.role() = 'service_role'::text)
  WITH CHECK (auth.role() = 'service_role'::text);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. draft_feedback — the training signal that was already being thrown away
-- ─────────────────────────────────────────────────────────────────────────
-- One row per SENT draft: what the agent wrote first, what actually went out,
-- and every instruction a human gave in between.
--
-- Three things in here are defensive rather than decorative:
--
--   * `jsonb_typeof(revisions) = 'array'` — `jsonb_array_elements` RAISES on a
--     scalar or an object. `revisions` is JSONB NOT NULL DEFAULT '[]' so today
--     every row is an array, but one hand-edited row would otherwise take the
--     whole view down, and the view is what the weekly cron reads. A malformed
--     array degrades to "no feedback for this draft", never to an error.
--   * `jsonb_typeof(value) = 'object'` — same reasoning one level in.
--   * the first BODIED revision, not revisions[0] and not the row's own
--     columns. `inquiry_drafts.email_draft` holds the LATEST text (§20), so
--     using it as v1 would make every diff read "nothing changed"; and a
--     note-only entry is an instruction, not a version.
--
-- COALESCE on the final bodies: a draft whose last revision carries the bodies
-- and whose columns were later edited still compares like-for-like, because
-- both sides come from the same place they are displayed from.
-- DROP then CREATE, not CREATE OR REPLACE: replacing a view may only APPEND
-- columns, and `has_first_version` belongs next to the flag it qualifies rather
-- than orphaned at the end. Nothing depends on this view but the weekly cron,
-- which reads it by name.
DROP VIEW IF EXISTS public.draft_feedback;

CREATE VIEW public.draft_feedback AS
SELECT
  d.id                                        AS draft_id,
  d.review_code,
  d.party_type,
  d.draft_kind,
  d.contact_path,
  d.booking_id,
  d.contact_id,
  d.inbound_event_id,
  d.created_at,
  d.sent_at,
  first_agent.email_draft                     AS first_email,
  first_agent.sms_draft                       AS first_sms,
  d.subject                                   AS final_subject,
  d.email_draft                               AS final_email,
  d.sms_draft                                 AS final_sms,
  notes.reviewer_notes,
  notes.note_count,
  revs.revision_count,
  -- Is there anything to compare against at all? Three outcomes, not two
  -- (rule 12): "unchanged", "changed", and "we do not know what it started as".
  (first_agent.email_draft IS NOT NULL OR first_agent.sms_draft IS NOT NULL) AS has_first_version,
  -- The whole point of the view: did a human change the words before they went
  -- to a customer?
  --
  -- The `has_first_version` guard is not defensive tidiness, it is a bug this
  -- view shipped with for about an hour. Without it a draft whose revisions[]
  -- records no bodies compares NULL against the sent text and reads as EDITED —
  -- and the distiller would then be handed "the agent wrote nothing, the human
  -- wrote all of this" as evidence, and learn a correction that never happened.
  -- Fabricated training signal is worse than none, because it becomes a
  -- standing rule. Found by exercising the view against a malformed row rather
  -- than by reading this comment's first draft, which claimed the opposite.
  (
    (first_agent.email_draft IS NOT NULL OR first_agent.sms_draft IS NOT NULL)
    AND (
      COALESCE(first_agent.email_draft, '') IS DISTINCT FROM COALESCE(d.email_draft, '')
      OR COALESCE(first_agent.sms_draft, '') IS DISTINCT FROM COALESCE(d.sms_draft, '')
    )
  )                                           AS was_edited
FROM public.inquiry_drafts d
LEFT JOIN LATERAL (
  SELECT r.value->>'email_draft' AS email_draft,
         r.value->>'sms_draft'   AS sms_draft
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(d.revisions) = 'array' THEN d.revisions ELSE '[]'::jsonb END
       ) WITH ORDINALITY AS r(value, ord)
  WHERE jsonb_typeof(r.value) = 'object'
    AND (r.value ? 'email_draft' OR r.value ? 'sms_draft')
  ORDER BY r.ord
  LIMIT 1
) first_agent ON true
LEFT JOIN LATERAL (
  SELECT string_agg(r.value->>'note', E'\n' ORDER BY r.ord) AS reviewer_notes,
         count(*)                                          AS note_count
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(d.revisions) = 'array' THEN d.revisions ELSE '[]'::jsonb END
       ) WITH ORDINALITY AS r(value, ord)
  WHERE jsonb_typeof(r.value) = 'object'
    AND COALESCE(r.value->>'actor', '') IN ('reviewer', 'admin')
    AND NULLIF(btrim(COALESCE(r.value->>'note', '')), '') IS NOT NULL
) notes ON true
LEFT JOIN LATERAL (
  SELECT count(*) AS revision_count
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(d.revisions) = 'array' THEN d.revisions ELSE '[]'::jsonb END
       ) AS r(value)
  WHERE jsonb_typeof(r.value) = 'object'
) revs ON true
WHERE d.status = 'sent';

COMMENT ON VIEW public.draft_feedback IS
  'Phase 6 (041). Per SENT draft: the first agent version vs what actually went '
  'out, plus the reviewer instructions in between. A VIEW and not a table for '
  'the same reason §20 refused a thread table — a second copy of revisions[] '
  'agrees with it only while somebody remembers to keep it in step.';
