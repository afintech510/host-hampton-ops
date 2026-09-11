-- ══════════════════════════════════════════════════════════════
-- Migration 028: Inquiry Drafts  (Inquiry → Draft Response feature, Phase 0)
-- Run in Supabase SQL Editor (migrations are applied manually).
--
-- Backs the "Inquiry → Draft Response" agent: when a new party REQUEST lands
-- in `bookings` (status='pending_review', created by POST /api/checkout), the
-- draft engine writes one row here, then drives the conversational SMS review
-- loop with Allie. See docs/inquiry-response-workflow.md and
-- docs/inquiry-response-flow.md.
--
-- HARD RULE encoded by the status machine: the ONLY transition that reaches the
-- customer is 'approved' -> 'sent'. Nothing auto-advances past sent_for_review
-- without an explicit approval phrase from Allie.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS inquiry_drafts (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  booking_id           UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,

  party_type           TEXT NOT NULL,
    -- studio_rental | mobile_party | in_studio_theme | unknown
    -- 'unknown' means the classifier could not confidently identify the type;
    -- such rows must be routed to a human, never auto-quoted.
  contact_path         TEXT NOT NULL,
    -- info_gather | quote
    -- info_gather = first contact asks for missing required fields, NO pricing.
    -- quote       = all required fields present, a priced quote may be drafted.

  status               TEXT NOT NULL DEFAULT 'drafted',
    -- drafted | sent_for_review | revision_requested | approved | sent | cancelled

  missing_fields       TEXT[] NOT NULL DEFAULT '{}',
    -- required fields absent at draft time (drove the info_gather path)

  review_code          TEXT NOT NULL UNIQUE,
    -- short human code shown in the SMS review thread (e.g. 'HH-2026-0042'),
    -- used to disambiguate which draft Allie's reply refers to.

  reviewer_phone       TEXT,
    -- E.164 snapshot of ALLIE_PHONE for this thread (who review SMS went to).

  preview_token_hash   TEXT,
    -- hash of the tokenized /review/<token> preview link (email + invoice PDF).
    -- Store only the hash, never the raw token (mirrors portal_token_hash).

  email_draft          TEXT,
  sms_draft            TEXT,

  revisions            JSONB NOT NULL DEFAULT '[]',
    -- append-only history:
    -- [{ at, actor:'agent'|'allie', note, email_draft, sms_draft }]

  approved_at          TIMESTAMPTZ,
  approved_phrase      TEXT,
    -- the exact inbound text that satisfied the approval gate (audit trail)

  customer_email_sent_at TIMESTAMPTZ,
  customer_sms_sent_at   TIMESTAMPTZ,
  sent_at                TIMESTAMPTZ,

  error                TEXT,
    -- last failure (send error, classifier note) for observability

  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT inquiry_drafts_party_type_chk
    CHECK (party_type IN ('studio_rental','mobile_party','in_studio_theme','unknown')),
  CONSTRAINT inquiry_drafts_contact_path_chk
    CHECK (contact_path IN ('info_gather','quote')),
  CONSTRAINT inquiry_drafts_status_chk
    CHECK (status IN ('drafted','sent_for_review','revision_requested','approved','sent','cancelled'))
);

-- Only one live draft per booking; historical rows (sent/cancelled) don't block
-- a fresh draft if the booking is ever re-opened.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inquiry_drafts_active_booking
  ON inquiry_drafts (booking_id)
  WHERE status NOT IN ('sent','cancelled');

CREATE INDEX IF NOT EXISTS idx_inquiry_drafts_status      ON inquiry_drafts (status);
-- (review_code is UNIQUE above, which already builds its own index.)
CREATE INDEX IF NOT EXISTS idx_inquiry_drafts_booking     ON inquiry_drafts (booking_id);

-- RLS: service_role only. Drafts hold customer contact details, reviewer phone
-- numbers and preview-token hashes; nothing client-side should read them.
-- Same pattern as migration_031 / migration_032 (NOT 009's USING (true)).
ALTER TABLE public.inquiry_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_full_access_inquiry_drafts ON public.inquiry_drafts;
CREATE POLICY service_role_full_access_inquiry_drafts
  ON public.inquiry_drafts FOR ALL
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- Auto-update updated_at on row changes (same pattern as bookings/website_content)
CREATE OR REPLACE FUNCTION update_inquiry_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inquiry_drafts_updated_at ON inquiry_drafts;
CREATE TRIGGER inquiry_drafts_updated_at
  BEFORE UPDATE ON inquiry_drafts
  FOR EACH ROW EXECUTE FUNCTION update_inquiry_drafts_updated_at();
