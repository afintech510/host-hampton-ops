# P10 — Birthday Club, copy rename, `eviteSurface` tripwire, e2e

**Branch:** `feat/evites`. **Spec:** §10, §15. SOW S18. Review C15 (the copy locations).

## Read first
- `lib/brevo.ts` (`brevoAddress`, `addToList`, `removeFromList`, the contacts POST upsert); memory notes: Brevo list adds are case-sensitive; `PUT` is update-only; a list add doesn't clear the blacklist.
- `lib/contacts.ts` (understand `upsertContact` in order to **avoid** it).
- `contactIdentitySurface.test.ts`, and existing `*Surface.test.ts` files for tripwire conventions (decomment, CRLF tolerance, brace-matching, counting examined sites).

## Tasks
1. **`lib/evites/club.ts`:** `recordClubOptIn` / `recordClubOptOut` exactly per §10:
   - no contacts consent writes; no name writes on found
   - the INSERT branch with `source:'evite'` and 23505 re-find
   - the Brevo POST with `updateEnabled:true` and `listIds:[BREVO_BIRTHDAY_CLUB_LIST_ID]`, address lowercased, never `emailBlacklisted`
   - unset list id → skip and log
   Wire it into the RSVP PATCH (replace the P06 no-op). Add the cron retry for `club_opt_in_at IS NOT NULL AND contact_id IS NULL`.
2. **Copy:** replace "Digital EVITE invitation" / "digital EVITE" wording with **"Host Hampton EVITE"** (adjust the grammar per sentence) at the 10 places in review C15. List any DB-held copy (`pricing_items` / `party_themes` descriptions) for the orchestrator. **Do not write the DB.**
3. **`__tests__/lib/eviteSurface.test.ts`:** rules E1–E10 from spec §15.
   - Each rule is scoped to the specific site (slice the guard, brace-match from the end of the parameter list).
   - Every rule asserts an examined count.
   - CRLF-tolerant.
4. **Mutation self-check** (run it, don't commit it): for each rule, temporarily break the guarded code and confirm the rule turns red. Report a table of rule → mutation → caught. Distinguish NOT_APPLIED from CAUGHT. Restore on every path. Refuse to run on a red tree.
5. **Playwright e2e** (`services/website/e2e/evite-rsvp.spec.ts`) at a 375×812 viewport against `next start`, with the network to Supabase mocked or a seeded local fixture route (follow the existing e2e config). Yes in 3 screens, No in 2.

## Tests
- `recordClubOptIn`: found → only `contact_id` linked, zero contact UPDATEs; absent → INSERT with both opt-ins false; 23505 → re-find; Brevo body lowercased with no `emailBlacklisted` key; list id unset → no call.
- Opt-out removes from the list with a lowercased address.

## Acceptance checks
- [ ] **The full `npx jest` suite is green.** Report the total count before and after P10.
- [ ] `tsc` is clean. `next build` passes. `npm run test:e2e -- evite` passes locally (or explain an environment blocker).
- [ ] The mutation table shows every E rule CAUGHT.
