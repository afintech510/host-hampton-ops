-- Migration 056 — staff follow-up reminders.
--
-- WHY:
--
-- Every reminder table that already exists is CUSTOMER-facing:
-- `scheduled_reminders` (migration 044) nudges a contact about their own
-- upcoming party. There was nowhere to put "call Megan back on the 22nd, she
-- hasn't picked a date yet" — the only place that existed was free-text in
-- `bookings.admin_notes`, which nothing reads on a schedule and nothing ever
-- reminds a human to reopen.
--
-- This table is that place. It is deliberately NOT wired into the customer
-- reminder engine's channel/provider machinery — it has exactly one job, texting
-- and/or emailing the owner (via lib/ownerNotify.ts + lib/brevo.ts) when a
-- follow-up comes due, checked once a day by /api/cron/staff-reminders.

CREATE TABLE IF NOT EXISTS staff_reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Nullable: not every follow-up is tied to a booking row (some are "call
  -- this person back" leads still living only in an email thread).
  booking_id    uuid REFERENCES bookings(id) ON DELETE SET NULL,
  contact_name  text NOT NULL,

  -- What to do, e.g. "Follow up again via email thread — hasn't selected a
  -- date yet. Address: 76 Jennings Ave, Southampton."
  message       text NOT NULL,
  due_date      date NOT NULL,

  channel       text NOT NULL DEFAULT 'both'
               CHECK (channel IN ('email', 'sms', 'both')),

  status        text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'sent', 'cancelled')),
  sent_at       timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    text
);

COMMENT ON TABLE staff_reminders IS
  'Internal follow-up reminders for Adam/staff (not customer-facing). /api/cron/staff-reminders emails and/or texts the owner once a row''s due_date has arrived, then marks it sent — never auto-recurs, never contacts the customer.';

COMMENT ON COLUMN staff_reminders.due_date IS
  'Date only, no time-of-day: the cron runs once daily and fires anything due today or earlier that has not already been sent, so a reminder created after today''s run still fires the same calendar day it is due.';

COMMENT ON COLUMN staff_reminders.status IS
  'pending = not yet due or not yet sent; sent = the owner was notified; cancelled = a human decided it is no longer needed (e.g. the lead closed before the date arrived). Only the cron sets sent; only a human sets cancelled.';

-- The one read the cron does: everything due and not yet resolved.
CREATE INDEX IF NOT EXISTS staff_reminders_due_idx
  ON staff_reminders (due_date)
  WHERE status = 'pending';

ALTER TABLE staff_reminders ENABLE ROW LEVEL SECURITY;
