-- ===========================================================================
-- Migration 039 — seed the admin accounts 038 was missing
--
-- 038 created `admin_users` and seeded exactly one row,
-- `adam@easternbuilding.supply`. That leaves the feature unable to do the thing
-- plan §11.1 says it exists for: **Allie has no account.** The ledger gains
-- per-person attribution only if the second person can sign in, so with one row
-- every approval would still land as the anonymous 'ADMIN' or as Adam.
--
-- This adds the two addresses per-user login was actually specified for:
--
--   * hosthampton295@gmail.com — Allie / the business account
--   * adam@benchworksai.com    — Adam
--
-- `adam@easternbuilding.supply` from 038 is deliberately LEFT ACTIVE. It is a
-- real address of Adam's and deactivating a working admin account is his call,
-- not a migration's. Note it is also the address used for TEST LEADS, so a
-- `bookings` row and an `admin_users` row can share it — they are unrelated
-- tables and neither reads the other.
--
-- ── Unclaimed, like 038 ──────────────────────────────────────────────────
--
-- No `password_hash`, for 038's reason: a hash committed to the repo is a
-- credential in git history, and this repo has had secrets scrubbed out of it
-- once already. Each row is claimed at first sign-in, which requires the shared
-- ADMIN_PASSWORD as proof — so this widens nobody's access. Whoever could claim
-- one of these rows could already sign in with the shared password today.
--
-- Idempotent: the UNIQUE index on `email` makes the upsert repeatable, and the
-- DO UPDATE deliberately never touches `password_hash`, so re-running this
-- after Allie has set her password does not reset it and lock her out.
-- ===========================================================================

BEGIN;

INSERT INTO public.admin_users (email, display_name)
VALUES
  ('hosthampton295@gmail.com', 'Allie'),
  ('adam@benchworksai.com',    'Adam')
ON CONFLICT (email) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      is_active    = TRUE;

COMMIT;
