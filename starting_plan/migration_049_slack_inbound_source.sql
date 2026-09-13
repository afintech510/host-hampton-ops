-- ===========================================================================
-- Migration 049 — 'slack' as an ingested_messages source
--
-- Plan §25.8 steps 4-5 of docs/booking-agent-plan.md.
--
-- ── Why this migration exists, and why it nearly did not ─────────────────
--
-- §25.7 specified migration 048 and listed everything Slack needs: the two
-- `inquiry_drafts` columns, `admin_users.slack_user_id`, `short_links`. All of
-- it is applied and correct. It missed ONE thing, and the thing it missed is
-- the one that would have failed silently.
--
-- The Slack handlers record a reviewer's button press as an `ingested_messages`
-- row with `source = 'slack'`, exactly as /api/webhooks/quo records an inbound
-- text with `source = 'quo'`. But `ingested_messages_source_check` (written in
-- migration 032, verified in production before this file was numbered) allows
-- only:
--
--   gmail | grasshopper | local_invoice | quo | website_form | system
--
-- So every Slack insert would have been refused with **23514**. And
-- `recordInboundEvent` is non-fatal by contract — it logs, returns null, and
-- never throws at the route. The route would have answered Slack 200, the
-- reviewer would have seen "Sending HH-2026-0042", and nothing whatsoever would
-- have happened to the draft.
--
-- That is the reminder engine, precisely: a table that refused every insert for
-- five months while the writer never read the error, and "never ran" looked
-- identical to "could not have run" from outside (rule 17, migration 044). It
-- would have been found on the first real approval, by a customer not getting
-- an answer.
--
-- The lesson that generalises: a plan section can enumerate the columns a
-- feature needs and still miss a CONSTRAINT on a table it is only writing a row
-- to. Grep for CHECK on every table a new code path writes to, not just the
-- ones it alters.
--
-- ── Why 049 ──────────────────────────────────────────────────────────────
--
-- Asked of the database, not of this directory — 048's header makes the case
-- for why that is the only reliable source, and it is the same reason here.
-- `short_links`, `inquiry_drafts.slack_channel/slack_ts` and
-- `admin_users.slack_user_id` are all present in production, so 048 is applied;
-- nothing above it is. 049 is next.
-- ===========================================================================

BEGIN;

ALTER TABLE public.ingested_messages DROP CONSTRAINT IF EXISTS ingested_messages_source_check;
ALTER TABLE public.ingested_messages
  ADD CONSTRAINT ingested_messages_source_check
  CHECK (source IN ('gmail', 'grasshopper', 'local_invoice', 'quo', 'slack', 'website_form', 'system'));

COMMIT;
