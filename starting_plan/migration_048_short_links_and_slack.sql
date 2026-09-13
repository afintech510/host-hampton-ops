-- ===========================================================================
-- Migration 048 — short links, and the columns Slack needs
--
-- Plan §21.7 of docs/booking-agent-plan.md.
--
-- ── Why 048 and not 047 ──────────────────────────────────────────────────
--
-- §21.7 originally reserved 047. That reservation was wrong the day it was
-- written: another session applied its own 047 to production the same
-- afternoon (`agent_learnings.source_memory_id`, verified present in
-- information_schema before this file was numbered). A reservation in a
-- document is not a reservation in Postgres.
--
-- Note also that 040-047 exist in the DATABASE but not as files, here or on
-- the box — the repo's record of the schema stops at 039. So the only honest
-- way to pick a number is to ask the database, which is what was done.
--
-- ── What this is for ─────────────────────────────────────────────────────
--
-- Quo bills $0.01 per SMS SEGMENT. §21.2 took the reviewer text from 11
-- segments to 3; what is left is mostly the link, because a preview URL is
-- 112 characters:
--
--   https://www.hosthampton.com/review/HH-2026-0042.<64 hex chars>
--
-- 64 hex characters carry 256 bits — hex spends 8 bits of string on 4 bits of
-- entropy, so half of that URL is waste. `short_links` plus a /r/<code> route
-- gets it to 48 characters, which is the difference between a 2-segment and a
-- 3-segment text on every draft, forever.
--
-- ── The security shape, which is NOT new ─────────────────────────────────
--
-- A short code is a bearer credential in a URL, exactly like the preview token
-- it replaces, so it is stored the same way lib/reviewLink.ts and
-- lib/portalAuth.ts already store theirs: **only the HMAC is persisted**. A
-- read of this table cannot reconstruct a working link. The raw code exists
-- only in the SMS.
--
-- `code_hash` is the PRIMARY KEY rather than a surrogate id with a unique
-- index, because a lookup is always "resolve this hash" and never "fetch row
-- 41". There is no id to leak and no sequence to enumerate.
--
-- 128 bits of entropy (16 random bytes, base64url) replaces 256. That is a
-- deliberate trade and it is safe here only because of the two things beside
-- it: `expires_at` is enforced on read, and the route rate-limits. A bearer
-- link with no TTL would not earn this.
--
-- `used_count` is not a limit, it is evidence. A preview link is forwardable
-- by design — an SMS screenshot in a group chat is a working link — and §20
-- added a TTL for exactly that reason. A count that climbs past 1 is how you
-- notice it happening.
--
-- ── The Slack columns ────────────────────────────────────────────────────
--
-- Added here rather than in a later migration because they are the same
-- phase and both additive. They are unused until §21.8 step 3 ships; a NULL
-- slack_ts simply means "this draft was never posted to Slack", which is also
-- the correct reading for every row that predates the feature.
--
-- `slack_ts` is TEXT, not a timestamp. Slack's `ts` is an opaque message
-- IDENTIFIER that happens to look like an epoch ("1789266286.113400"); it is
-- the thread key, and parsing it as a time would both lose precision and
-- misrepresent what it is.
-- ===========================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- Short links
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.short_links (
  -- HMAC-SHA256 of the raw code, hex. The raw code is never stored.
  code_hash   TEXT PRIMARY KEY,
  -- Where it redirects. Validated against an allowlist of our own origins at
  -- write time AND re-parsed at read time — a stored URL is not trusted just
  -- because we put it there. See lib/shortLink.ts.
  target      TEXT NOT NULL,
  -- 'review' | 'slack' | 'portal'. What KIND of thing this points at, for
  -- logging and for expiring a class of links without touching the rest.
  kind        TEXT NOT NULL DEFAULT 'review',
  -- Optional back-reference, so a draft's links can be found without holding
  -- the raw codes. No FK: a link may outlive or precede its subject, and a
  -- dangling reference here must never block a delete elsewhere.
  entity_type TEXT,
  entity_id   UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- NOT NULL on purpose: an immortal bearer link is the thing §20 removed.
  expires_at  TIMESTAMPTZ NOT NULL,
  used_count  INTEGER NOT NULL DEFAULT 0,
  last_used_at TIMESTAMPTZ
);

-- The only two queries: resolve-by-hash (the PK) and sweep-the-expired.
CREATE INDEX IF NOT EXISTS idx_short_links_expires
  ON public.short_links (expires_at);

CREATE INDEX IF NOT EXISTS idx_short_links_entity
  ON public.short_links (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

-- Same posture as 028/031/032/037/038: service_role only. The /r/ route is a
-- server route; nothing client-side may read this table, because the target
-- of a link is the thing the code is protecting.
ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS short_links_service_role ON public.short_links;
CREATE POLICY short_links_service_role ON public.short_links
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────
-- Prefix-free preview-token lookup (§21.3)
-- ─────────────────────────────────────────────────────────────────────────
-- The token currently carries its review code as a prefix ONLY so the page can
-- find the row without a lookup. That prefix costs 13 characters of every SMS
-- and leaks the review code to anyone who sees the URL. With this index the
-- lookup is by hash directly and the prefix can go.
CREATE INDEX IF NOT EXISTS idx_inquiry_drafts_preview_token_hash
  ON public.inquiry_drafts (preview_token_hash)
  WHERE preview_token_hash IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- Slack (§21.4, §21.5) — additive, unused until step 3
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.inquiry_drafts
  ADD COLUMN IF NOT EXISTS slack_channel TEXT,
  ADD COLUMN IF NOT EXISTS slack_ts      TEXT;

-- Finding a lead's existing thread to reply into.
CREATE INDEX IF NOT EXISTS idx_inquiry_drafts_slack_ts
  ON public.inquiry_drafts (slack_ts)
  WHERE slack_ts IS NOT NULL;

-- The actor mapping §11.1 has been missing: a verified Slack user_id resolves
-- to a person, so an approval stops being the anonymous 'ADMIN'.
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS slack_user_id TEXT;

-- Partial, so the many NULLs (nobody has linked Slack yet) do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_users_slack_user_id
  ON public.admin_users (slack_user_id)
  WHERE slack_user_id IS NOT NULL;

COMMIT;
