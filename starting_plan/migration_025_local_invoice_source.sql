-- ══════════════════════════════════════════════════════════════
-- Migration 025: allow 'local_invoice' as an ingested_messages source
--
--   The historical-mining plan only anticipated gmail|grasshopper.
--   Adam also has a local folder of AI-generated invoice HTML/PDF
--   files (services/website is unrelated to these — they live at
--   repo root in /invoices) that predate/parallel the Gmail sweep.
--   Each is keyed by filename as external_id (stable, idempotent).
--
-- Run via Supabase SQL editor. Idempotent. Run by hand — do NOT
-- auto-apply.
-- ══════════════════════════════════════════════════════════════

ALTER TABLE public.ingested_messages
  DROP CONSTRAINT IF EXISTS ingested_messages_source_check;

ALTER TABLE public.ingested_messages
  ADD CONSTRAINT ingested_messages_source_check
    CHECK (source IN ('gmail', 'grasshopper', 'local_invoice'));
