-- Migration 008: Financial Transactions
-- Unified sales data from all revenue sources (Stripe, GoDaddy, Squarespace, HoneyBook, Cash)

CREATE TABLE IF NOT EXISTS financial_transactions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  date DATE NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('stripe', 'godaddy', 'squarespace', 'honeybook', 'cash', 'other')),
  category TEXT NOT NULL DEFAULT 'Other',
  customer_name TEXT,
  reference TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for fast filtering by source and date
CREATE INDEX IF NOT EXISTS idx_fin_txn_source ON financial_transactions(source);
CREATE INDEX IF NOT EXISTS idx_fin_txn_date ON financial_transactions(date DESC);

-- Unique constraint on source + reference to prevent duplicate imports
CREATE UNIQUE INDEX IF NOT EXISTS idx_fin_txn_source_ref ON financial_transactions(source, reference) WHERE reference IS NOT NULL;

-- Enable RLS
ALTER TABLE financial_transactions ENABLE ROW LEVEL SECURITY;

-- Allow service_role full access
CREATE POLICY "service_role_full_access" ON financial_transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);
