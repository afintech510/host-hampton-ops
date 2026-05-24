-- Migration 014: Email-based login for the party planner.
-- Stores hashed 6-digit codes with attempt tracking. Safe to re-run.

CREATE TABLE IF NOT EXISTS email_auth_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Lookup pattern: find the newest unconsumed unexpired code for an email
CREATE INDEX IF NOT EXISTS email_auth_codes_email_active_idx
  ON email_auth_codes (email, expires_at DESC)
  WHERE consumed_at IS NULL;

-- Rate-limit pattern: count recent requests per email
CREATE INDEX IF NOT EXISTS email_auth_codes_email_created_idx
  ON email_auth_codes (email, created_at DESC);

COMMENT ON TABLE email_auth_codes IS
  'Short-lived 6-digit codes for passwordless email login on the party planner. Codes expire in 15 minutes and allow up to 5 verify attempts.';

-- Verify
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'email_auth_codes'
ORDER BY ordinal_position;
