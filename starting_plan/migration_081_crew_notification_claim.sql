-- Migration 081 — crew notifications (Phase 4): a claim status for the sender.
--
-- `crew_notifications` is both the log and the queue. A row is QUEUED by the
-- booking reconcile (`partyCancelled`, Phase 3) or by a text that quiet hours
-- held back to 8am (Phase 4), and `/api/cron/crew` delivers it. Two ticks can
-- overlap, so delivery CLAIMS the row first — `queued` → `sending`, one
-- conditional UPDATE read back — and only the winner calls Resend or Quo. There
-- is no way to un-send a text (AGENTS.md "Claim before send").
--
-- 077's enum had no state between "waiting" and "done", so this adds one, plus
-- `claimed_at` so a row stuck in `sending` (a crash between claim and send)
-- shows when it was taken. A stuck row is LEFT for a human, never re-sent: a
-- crash after the provider accepted it and before the write-back would
-- otherwise send it twice.
--
-- ALTER TYPE … ADD VALUE runs outside the transaction: the new value may not be
-- used in the transaction that adds it.
--
-- Apply:  ssh hampton-vps "/root/pg.sh -P pager=off -v ON_ERROR_STOP=1 -f -" < this file
-- Safe to re-run.

ALTER TYPE public.crew_notification_status ADD VALUE IF NOT EXISTS 'sending';

BEGIN;

ALTER TABLE public.crew_notifications ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

COMMENT ON COLUMN public.crew_notifications.claimed_at IS
  'When /api/cron/crew claimed a queued row (status sending) before delivering it (migration 081).';

COMMIT;

-- Proof.
SELECT enum_range(NULL::public.crew_notification_status)::text AS statuses,
       (SELECT data_type FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'crew_notifications' AND column_name = 'claimed_at') AS claimed_at_type;
