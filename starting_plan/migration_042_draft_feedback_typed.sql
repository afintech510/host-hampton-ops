-- ════════════════════════════════════════════════════════════════════════════
-- Migration 042 — draft_feedback reads a revision body ONLY when it is a string
-- (Phase 6 review; 041 built the view)
--
-- ── The fifth malformed shape ─────────────────────────────────────────────
--
-- 041 was hardened against four malformed `revisions` values — a bare string,
-- an object, an array of junk, and `[]` — and it degrades correctly on six more
-- probed by this review (JSON `null`, `true`, `123`, an array of arrays, an
-- entry whose bodies are explicit JSON nulls, and a note-only entry).
--
-- It does NOT degrade on this one:
--
--   [{"email_draft": {"a": 1}, "sms_draft": [1, 2]}]
--
-- `r.value->>'email_draft'` is the ->> operator, which does not require the
-- value to be a JSON string: on an object it returns that object SERIALISED,
-- the six characters `{"a": 1}`. So the lateral finds a "first bodied
-- revision", `has_first_version` reads TRUE, the serialised JSON compares
-- unequal to the sent text, and `was_edited` reads TRUE.
--
-- Verified against production inside BEGIN … ROLLBACK, 2026-09-12:
--
--   revisions_shape                            | has_first_version | was_edited
--   [[{"email_draft": "nested"}]]              | f                 | f
--   [{"note":"x","actor":"reviewer",...}]      | f                 | f
--   [{"sms_draft":[1,2],"email_draft":{"a":1}}]| t                 | t   ← this
--   123 / null / true                          | f                 | f
--
-- ── Why a wrong flag here is the expensive kind ───────────────────────────
--
-- This is the bug 041 fixed, in the form 041 left behind. `buildCorpus` would
-- hand the distiller `agentWrote: '{"a": 1}'` beside `humanSent:` the real sent
-- email — a "correction" in which the assistant wrote a JSON fragment and a
-- human replaced it with prose. The distiller's entire output is rules derived
-- from corrections, so it would faithfully learn a rule about a correction that
-- never happened, and that rule is then one click from the trusted half of
-- every future draft prompt.
--
-- Hard-won rule 15: when a pipeline's output is "what we learned", an input it
-- cannot interpret must be DROPPED, never guessed at. `->>` guesses. The fix is
-- to ask what the value actually IS: `jsonb_typeof(...) = 'string'`.
--
-- The same treatment for `note`, which `string_agg`s into `reviewer_notes` and
-- goes into the prompt as "what the owner asked for" — an object there becomes
-- a line of serialised JSON presented to the model as Allie's instruction.
--
-- ── And a bound on how much text one row can drag out of the database ─────
--
-- The view's body columns were uncapped. A single draft with a 2MB body and a
-- 100,000-element revisions array produced `final_email` at 2,000,000 chars and
-- `reviewer_notes` at 688,894 chars (measured, same probe) — and the weekly
-- cron selects FORTY rows. `clip()` in lib/agent/distill.ts trims every field
-- to 1200 characters, but it does so in Node, AFTER the whole thing has crossed
-- PostgREST. Capping the OUTPUT columns at 8000 costs the distiller nothing it
-- was going to keep and turns an unbounded transfer into a bounded one.
--
-- `was_edited` and `has_first_version` are deliberately computed on the FULL
-- text, before the cap: two drafts differing only after character 8000 are
-- still different drafts, and a truncation that silently made them equal would
-- be a new way to report a correction that did not happen.
--
-- Idempotent: DROP VIEW IF EXISTS … / CREATE VIEW. Safe to re-run, and it was.
-- ════════════════════════════════════════════════════════════════════════════

-- DROP then CREATE, not CREATE OR REPLACE: replacing a view may only APPEND
-- columns and this changes existing ones. Nothing depends on the view but the
-- weekly cron, which reads it by name.
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
  left(first_agent.email_draft, 8000)         AS first_email,
  left(first_agent.sms_draft, 8000)           AS first_sms,
  d.subject                                   AS final_subject,
  left(d.email_draft, 8000)                   AS final_email,
  left(d.sms_draft, 8000)                     AS final_sms,
  left(notes.reviewer_notes, 8000)            AS reviewer_notes,
  notes.note_count,
  revs.revision_count,
  -- Is there anything to compare against at all? Three outcomes, not two
  -- (rule 12): "unchanged", "changed", and "we do not know what it started as".
  (first_agent.email_draft IS NOT NULL OR first_agent.sms_draft IS NOT NULL) AS has_first_version,
  -- Did a human change the words before they went to a customer? Computed on
  -- the untruncated text on purpose — see the header.
  (
    (first_agent.email_draft IS NOT NULL OR first_agent.sms_draft IS NOT NULL)
    AND (
      COALESCE(first_agent.email_draft, '') IS DISTINCT FROM COALESCE(d.email_draft, '')
      OR COALESCE(first_agent.sms_draft, '') IS DISTINCT FROM COALESCE(d.sms_draft, '')
    )
  )                                           AS was_edited
FROM public.inquiry_drafts d
LEFT JOIN LATERAL (
  -- The first revision that carries a body that is ACTUALLY A STRING. `->>` on
  -- an object or an array returns its serialisation, which is not a draft and
  -- must not be read as one (042, rule 15).
  SELECT CASE WHEN jsonb_typeof(r.value->'email_draft') = 'string' THEN r.value->>'email_draft' END AS email_draft,
         CASE WHEN jsonb_typeof(r.value->'sms_draft')   = 'string' THEN r.value->>'sms_draft'   END AS sms_draft
  FROM jsonb_array_elements(
         CASE WHEN jsonb_typeof(d.revisions) = 'array' THEN d.revisions ELSE '[]'::jsonb END
       ) WITH ORDINALITY AS r(value, ord)
  WHERE jsonb_typeof(r.value) = 'object'
    AND (jsonb_typeof(r.value->'email_draft') = 'string' OR jsonb_typeof(r.value->'sms_draft') = 'string')
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
    -- Same reasoning as the bodies: a note that is an object becomes a line of
    -- serialised JSON handed to the model as what the owner asked for.
    AND jsonb_typeof(r.value->'note') = 'string'
    AND NULLIF(btrim(r.value->>'note'), '') IS NOT NULL
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
  'Phase 6 (041, retyped in 042). Per SENT draft: the first agent version vs '
  'what actually went out, plus the reviewer instructions in between. A body or '
  'a note is read only when it is a JSON STRING — ->> serialises an object '
  'instead of returning NULL, and a serialised object read as a draft is a '
  'correction that never happened. Body columns capped at 8000 chars; the flags '
  'are computed on the full text.';
