-- Migration 085 — website Host Assistant chat sessions (chat_sessions).
--
-- One row per website chat. It is BOTH the server-side history the model is
-- re-fed each turn (the browser holds only an HMAC-signed session token, never
-- the conversation) AND the transcript Allie reads later, linked to the booking
-- when the visitor clicks "Book it & see my invoice".
--
-- ── WHAT IS DELIBERATE ──
--
--   1. SERVICE ROLE ONLY. RLS on, no policies, anon/authenticated revoked — the
--      same posture as media_assets (083). A transcript carries whatever a
--      stranger typed, including a child's name, an email and a phone number.
--   2. NOTHING IN HERE IS A CARD. The chat never takes payment (the deposit is
--      paid on our own Stripe page), so there is no card number, no CVC and no
--      Stripe id on this table, and the model is told never to ask for one.
--      `contact_*` hold only what the visitor typed to be contacted.
--   3. `messages` is the provider-neutral model history (user text fenced as
--      visitor data, assistant text, tool calls and tool results), thinking
--      blocks stripped. Capped in code (turn count and bytes); a chat that
--      outgrows the cap is closed with a "text us" hand-off, not truncated —
--      truncating a tool-use transcript produces an orphaned tool_result.
--   4. `turn_count` is a compare-and-swap: a turn writes only if it still holds
--      the count it read, so two tabs on one session cannot interleave and
--      lose a turn.
--   5. `claimed_card_id` is the DURABLE single-use claim for a booking card
--      (the in-memory set in lib/assistant/proposals.ts resets on deploy). It
--      is set only while a confirm is in flight and while it stands as the
--      booking's proof; `booking_ref` non-null means this session has booked.
--   6. `inquiry_sent_at` caps the start_inquiry lead tool at one per session.
--   7. RETENTION: `expires_at` defaults to 90 days. Nothing purges yet — a
--      purge is a one-line DELETE (see the comment at the bottom) that belongs in
--      scripts/cron/jobs.tsv once Adam decides the number. A session linked to a
--      booking is evidence of what was promised; delete it with the booking, not
--      before.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz,
  expires_at       timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  status           text NOT NULL DEFAULT 'active',
  -- Cloudflare Turnstile passed for this session (first message only).
  verified_at      timestamptz,
  -- A truncated keyed hash of the caller address (never the address itself).
  caller_hash      text,
  -- The path the chat was opened on, query string stripped.
  page_path        text,
  turn_count       integer NOT NULL DEFAULT 0,
  spent_usd        numeric(10,4) NOT NULL DEFAULT 0,
  messages         jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- What the visitor typed to be contacted (set at confirm / start_inquiry).
  contact_name     text,
  contact_email    text,
  -- Set when the visitor books.
  booking_id       uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  booking_ref      text,
  claimed_card_id  text,
  inquiry_sent_at  timestamptz
);

ALTER TABLE public.chat_sessions DROP CONSTRAINT IF EXISTS chat_sessions_status_check;
ALTER TABLE public.chat_sessions ADD CONSTRAINT chat_sessions_status_check
  CHECK (status IN ('active', 'booked', 'inquiry', 'closed'));

CREATE INDEX IF NOT EXISTS idx_chat_sessions_created ON public.chat_sessions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_booking_ref ON public.chat_sessions(booking_ref) WHERE booking_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_expires ON public.chat_sessions(expires_at);

ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_sessions FROM anon, authenticated;
GRANT ALL ON public.chat_sessions TO service_role;

COMMENT ON TABLE public.chat_sessions IS
  'Website Host Assistant chats: server-side history + transcript. Service role only. Retained 90 days (expires_at); purge: DELETE FROM chat_sessions WHERE expires_at < now() AND booking_ref IS NULL.';

COMMIT;
