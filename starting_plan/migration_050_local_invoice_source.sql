-- Migration 050: `local_invoice_import` is a real provenance for a booking
--
-- `invoices/` holds 20 hand-built HTML quotes for parties sold entirely outside
-- the app — mobile parties and studio rentals, quoted in a file and paid by
-- Venmo. Six of them have Gmail receipts behind them and are being brought into
-- `bookings` (scripts/import_booked_invoices.mjs).
--
-- `bookings_source_check` (migration 035) allows six values, and the closest is
-- `admin`. Using it would work and would be wrong: `admin` means "Adam keyed
-- this in from a phone call", and these rows are a different thing with a
-- different level of confidence — their totals come from a file, their payments
-- from a mail receipt, and their line items are a single flat amount rather than
-- an itemised plan. Collapsing the two makes it impossible to ask "which parties
-- did we back-fill?", which is exactly the question somebody reconciling the
-- books will ask first.
--
-- Note that `ingested_messages.source` already carries a `local_invoice` value
-- (migration 025) for the mail side of the same files. The two are deliberately
-- spelled differently: that one records a MESSAGE we generated, this one records
-- where a BOOKING came from.
--
-- Safe to re-run. Widening a CHECK cannot fail on existing rows.

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_source_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_source_check CHECK (
  source IS NULL OR source IN
    ('website_form', 'email', 'sms', 'admin', 'phone', 'walk_in', 'local_invoice_import')
);

-- Verify
SELECT pg_get_constraintdef(oid) AS bookings_source_check
FROM pg_constraint
WHERE conname = 'bookings_source_check';
