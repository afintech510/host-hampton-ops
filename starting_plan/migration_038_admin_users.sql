-- ===========================================================================
-- Migration 038 — admin_users: per-person admin login
--
-- Plan §11.1 of docs/booking-agent-plan.md, and the prerequisite it names for
-- Phase 4.5. Today there is ONE shared ADMIN_PASSWORD and every admin approval
-- lands in `marketing_ledger` as the anonymous actor 'ADMIN'. With Adam and
-- Allie both working leads daily the ledger cannot say who approved a message
-- to a customer — which is the one thing the ledger exists to record.
--
-- It also unblocks Phase 5's `/plan/[ref]/summary`: that is a server component
-- gated on the `hh_portal` cookie, and a Bearer header held in localStorage is
-- invisible to a server render. A signed session cookie is something a server
-- component CAN see, so an admin stops having to open a plan through its
-- customer portal link.
--
-- ── What this migration deliberately does NOT contain ────────────────────
--
-- **No password hash.** A hash committed to the repo is a credential in git
-- history, and this repo has already had secrets scrubbed out of it once. So
-- rows are seeded UNCLAIMED (`password_hash IS NULL`) and the hash is set out
-- of band, by first login:
--
--   * an unclaimed row cannot be logged into with a personal password alone.
--     Claiming it REQUIRES the shared ADMIN_PASSWORD as proof, because /admin
--     is a public URL and anyone who could guess `allie@…` would otherwise be
--     able to claim her account before she does. Requiring the shared password
--     means this widens nobody's access: whoever can claim a row could already
--     sign in as the shared admin.
--   * on a successful claim the submitted personal password is hashed with
--     scrypt (Node's built-in KDF — no new dependency, and never a bare SHA)
--     and written to `password_hash`. Subsequent logins verify against it.
--
-- The shared password keeps working as a login on its own, forever. That is
-- deliberate and is the lockout guard: this change must never be the reason
-- Adam cannot get into the admin panel, which is how he runs the business.
--
-- `last_login_at` is the audit breadcrumb — it is how you notice a claimed
-- account being used by someone who should not have it.
-- ===========================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored lowercase; the app lowercases before every read and write. The
  -- UNIQUE index is what makes the seed below idempotent.
  email         TEXT NOT NULL UNIQUE,
  -- NULL = unclaimed. See the header: the hash is never committed to the repo.
  -- Format is scrypt$N$r$p$<salt-hex>$<derived-hex>, written by lib/adminAuth.ts.
  password_hash TEXT,
  display_name  TEXT NOT NULL,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);

-- Lookup is always "this email, if active".
CREATE INDEX IF NOT EXISTS idx_admin_users_active
  ON public.admin_users (email) WHERE is_active;

-- RLS: service_role only, the same posture as 028/031/032/037. Nothing
-- client-side reads this — login is a server route and the session is an
-- HttpOnly cookie, so an anon key must never see a password hash.
ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_users_service_role ON public.admin_users;
CREATE POLICY admin_users_service_role ON public.admin_users
  FOR ALL TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────
-- Seed. Unclaimed rows only — no hashes here, by design (see header).
-- Re-running updates display_name/is_active and never clobbers a hash that
-- first login has since set, which is what makes this file idempotent.
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO public.admin_users (email, display_name)
VALUES
  ('adam@easternbuilding.supply', 'Adam')
ON CONFLICT (email) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      is_active    = TRUE;

COMMIT;
