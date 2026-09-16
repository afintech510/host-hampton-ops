-- Migration 055 — the Venmo receipt, kept where a question can be asked of it.
--
-- WHY:
--
-- Every `event_tickets` row and every ticket's `financial_transactions` row is
-- written by `/api/webhook` (Stripe) or the cart checkout. Nothing else writes
-- one. A customer who pays by Venmo therefore exists NOWHERE: not on the roster
-- Allie reads at the door, not in the books, and not in `available_tickets` —
-- so the event looks emptier than it is and can be oversold underneath her.
--
-- Measured 2026-09-13 against thirty days of hosthampton295@gmail.com: the 9/25
-- squishy night read "2 orders, 3 people" in the admin while five more children
-- had been paid for, and ~$2,186 of Venmo across ten days was in no table at
-- all. On 2026-09-16 a second sweep found five more event payments the same
-- way — three Bingo seats and three squishy seats.
--
-- Venmo has no API for an individual account's incoming payments. The
-- notification email is the only machine-readable trace there is, and the agent
-- already reads that mailbox every three minutes. This table is where it puts
-- what it read.
--
-- A PROPOSAL, NOT A TICKET. Kyra Possin paid $45 for the squishy night and
-- cancelled two minutes later in the payment's comment thread; the refund went
-- out four minutes after that. A row here is "this money arrived and here is
-- what it looks like" — a human turns it into a ticket through
-- POST /api/admin/venmo-payments, which is also the first writer of an offline
-- ticket this codebase has ever had.

CREATE TABLE IF NOT EXISTS venmo_payments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The dedupe. gmail-sync re-reads a message whenever a poll fails midway and
  -- the checkpoint does not advance, so the SECOND sighting of a receipt must
  -- be a no-op rather than a second $45.
  gmail_message_id  text NOT NULL UNIQUE,
  transaction_id    text,

  paid_at           timestamptz NOT NULL,
  payer_name        text NOT NULL,
  amount_cents      integer NOT NULL CHECK (amount_cents > 0),
  -- Verbatim, decoded. This is the only thing that says what the money was for,
  -- and it is frequently the only thing that names the child attending.
  note              text NOT NULL DEFAULT '',
  subject           text,

  status            text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'recorded', 'ignored')),

  -- What the matcher thought, kept alongside the answer a human gave. When the
  -- two disagree that is the training signal for the next guess.
  suggested_event_id uuid REFERENCES events(id) ON DELETE SET NULL,
  match_confidence   text NOT NULL DEFAULT 'none'
                     CHECK (match_confidence IN ('title', 'amount', 'none')),
  suggested_seats    jsonb,
  match_reason       text,

  resolved_at       timestamptz,
  resolved_by       text,
  resolution_note   text,
  -- The refs actually issued, so a row can be traced to the seats it became.
  ticket_refs       text[],

  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE venmo_payments IS
  'Inbound Venmo notification emails parsed into proposed payments. A row is evidence that money arrived, never a ticket: /api/admin/venmo-payments turns an accepted one into event_tickets + financial_transactions + an inventory decrement. Written by /api/cron/gmail-sync via lib/venmoReconcile.ts.';

COMMENT ON COLUMN venmo_payments.gmail_message_id IS
  'Gmail message id, UNIQUE — the idempotency key. gmail-sync deliberately does not advance its checkpoint past a failed batch, so a receipt can be read more than once.';

COMMENT ON COLUMN venmo_payments.status IS
  'pending = nobody has ruled on it; recorded = it became the tickets in ticket_refs; ignored = deliberately not a ticket (a refund, a tip, a party deposit, a personal payment). Never auto-set to recorded.';

COMMENT ON COLUMN venmo_payments.match_confidence IS
  'title = the note named the event; amount = the note did not, and exactly one upcoming event explains the amount; none = unknown. Only a human promotes any of these to a ticket.';

-- The two reads: the admin queue (pending, newest first) and "did we already
-- see this transaction".
CREATE INDEX IF NOT EXISTS venmo_payments_status_paid_at_idx
  ON venmo_payments (status, paid_at DESC);

CREATE INDEX IF NOT EXISTS venmo_payments_transaction_id_idx
  ON venmo_payments (transaction_id)
  WHERE transaction_id IS NOT NULL;

ALTER TABLE venmo_payments ENABLE ROW LEVEL SECURITY;
