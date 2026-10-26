# Phase 1 — Data layer, rules, race proof

**Read first:** spec §3–§4, the migration, `rules.ts`, AGENTS.md §6/§11.

## Tasks

1. **Migration 077.**
   - Re-check the next free number on `origin/main` and in `information_schema`.
   - Push the file, then apply it with `/root/pg.sh` and **re-run it once**.
   - It must leave every crew table with RLS on, functions revoked from `public`/`anon`/`authenticated`, the settings seeded, and Allie's owner row present, exactly once.
2. **`rules.ts` v1.1 + Jest:**
   - `partyRateCents`, `stepAfter`, `tipTopupCents`, `requiredSlots`, `slotsForParty`, `isInGracePeriod` (ET midnight via `etToUtc`), `nextStepLabel`;
   - kept from v1: `classifyDrop`, `confirmationSchedule`, `isBlockedByAvailability`, `shiftsOverlap`;
   - `settingsFromRows`, which clamps `max_steps` ≤ 8 to match the DB check.
3. **`lib/crew/settings.ts`:** `loadCrewSettings(supabase)` → `{ kind:'ok', settings } | { kind:'unavailable', error }`. A failed read is never "the defaults".
4. **`lib/crew/db.ts`:**
   - typed reads (members, parties with slots, a member's slots, events, availability);
   - `insertNotification` (insert, then on `(dedupe_key, channel)` conflict report `duplicate`);
   - RPC wrappers. Each step-changing wrapper reads the member and settings, computes with `rules.ts`, and passes `expected_steps` / `steps_after`. On `stale` it retries once.
5. **`lib/crew/view.ts`:** the only shapes a crew route returns, with tests proving another member's phone, email, pay, tips, steps, notes, and reasons never appear.
6. **`findCrewMembersByEmail`** in `lib/contactLookup.ts`:
   - `ilike` on `email_key` for candidates, then an exact JS re-compare;
   - `found` | `absent` | `unavailable`.
7. **Race script** `scripts/crew/race-test.mjs`, against production on throwaway rows:
   - concurrent claims on one open spot → exactly one `assigned`;
   - a non-`can_lead` member refused the Lead spot by the RPC **and** by the trigger on a direct write;
   - a stale `expected_steps` → `stale`;
   - clean-up verified by count.
8. **Discovery:** how the Party Helper add-on appears in `booking_line_items` (spec §9).

## Acceptance

- `npm test` is green, including every surface test.
- `npx tsc --noEmit` and `npx next build` pass.
- Pushed to `main`, `gh run watch` is green, and the site answers 200.
- `SESSION_LOG.md` is updated.

**STOP** and report to Adam.
