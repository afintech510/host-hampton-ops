# Crew Scheduling — Master Build Prompt (v1.1)

You are building the **Host Hampton Crew** feature in `afintech510/host-hampton-ops`: a crew-facing scheduling portal plus admin tools. It stops party crew cancelling on Allie by combining:

- self-scheduling;
- **flat per-party pay that rises $2.50 a step**, reset by a late cancel without cover;
- **standbys** for private cover;
- availability;
- confirmations.

Run the phase prompts in this folder in order. **Stop at every STOP gate and wait for Adam.**

## Source of truth, read in this order

1. `docs/specs/crew/CREW_SPEC.md` (v1.1). §3 is binding. It supersedes the v1 package in `starting_plan/Staffing-app/` wherever they disagree.
2. `services/website/src/lib/crew/rules.ts` plus `src/__tests__/lib/crew/rules.test.ts`.
   - **These are the only implementation of the rules.** If a rule changes, change it there, update the tests, and note it in the spec changelog.
   - The SQL functions apply a step change by compare-and-swap. They never re-derive it.
3. `services/website/src/lib/crew/templates.ts`: all crew copy. Every message signs **"— Allie, Host Hampton"**, and none mentions a level, tier, or points.
4. `starting_plan/migration_077_crew_scheduling.sql`: tables, enums, SQL functions, the settings seed, and Allie's owner row.
5. **AGENTS.md** (repo root), especially §7, §8, and §11. Every surface/tripwire test it names must stay green.

## Non-negotiables

- **Fit the platform; never re-implement it.** Reuse these:

  | Need | Reuse |
  |---|---|
  | DB client | `getSupabase()` |
  | Admin auth | `isAdminAuthorized` / `adminActorId` |
  | Signing secret | `portalSigningSecret()` |
  | Cron auth | `isCronAuthorized` |
  | Rate limits | `guardRate`, `plannerRule`, `webhookRule`, `guardRecipient` |
  | SMS | `sendSMSViaQuo`, `checkSmsQuietHours`, `recordSmsOptOut`, `normalizePhoneKey`, `lib/smsSegments.ts` |
  | Email | `escapeFields`, `mailHref` |
  | Time | `partyWindow`, `etToUtc`, `shiftEtDate` |
  | Bookings | `bookingStage`, `STUDIO_ADDRESS_LINE`, `mobileAddressOf` |
  | Noindex | `NOINDEX` |
  | Links | `CANONICAL_ORIGIN`, `publicOrigin` |
- **There is no staging.** `staging.hosthampton.com` is the same container and the same database.
  - Everything ships to `main` behind `CREW_ENABLED=false`.
  - Test in production with throwaway rows, probing the **container IP** and not Cloudflare. Clean up afterwards.
- **A push to `main` is a production deploy.** Watch it with `gh run watch`, verify the site, and never also run `scripts/deploy.sh`.
- **Working tree:**
  - Local `main` holds other sessions' uncommitted work. Build in a worktree off `origin/main`.
  - Stage explicit files only.
  - Rebase a rejected push in a temp worktree.
- **Migrations:**
  - Ask `information_schema` and `git fetch` for the next free number. Never trust a written-down number.
  - Apply with `ssh hampton-vps "/root/pg.sh -v ON_ERROR_STOP=1 -f /tmp/x.sql"`, BEFORE deploying the code that needs it.
  - **Re-run it once** to prove it is re-runnable.
- **Authorization:**
  - Crew tables have RLS on with no policies.
  - Crew routes use `requireCrewMember(req)` and return only `lib/crew/view.ts` projections.
  - **A crew member never receives another member's phone, email, pay, tips, steps, notes, or reasons.**
- **Atomicity:** claims, cover claims, releases, drops, attendance and step overrides go through the SQL functions. App code never does read-then-write for them.
- **Time:** store `timestamptz`; compute in `America/New_York`. The box is UTC.
- **SMS:** goes out on the Quo line, behind `CREW_SMS_ENABLED` and the member's `sms_opt_in`.
  - Quiet hours defer and never cancel.
  - Every flow still works with SMS off.
- **Idempotency:** every send writes `crew_notifications` with a `dedupe_key`.
- **PII:** never write customer or crew PII into the repo. No roster file, no fixtures with real names, numbers, or emails.
- **Docs:** at the end of each phase, update `SESSION_LOG.md` (shipped vs in progress, never rounded up) and AGENTS.md where it documents env vars, crons, and rules.

## Environment variables

| Var | Purpose |
|---|---|
| `CREW_ENABLED` | Off unless exactly `true` (§10). |
| `CREW_SMS_ENABLED` | Off unless exactly `true`. |
| `CREW_ADMIN_EMAIL` | Optional. Admin alerts; falls back to `ownerEmail()`. |

Each one is added to `docker-compose.yml` `environment:` and to `/opt/hosthampton/.env`, then deployed with `up -d --build`. There is no `.env.example`; compose plus AGENTS.md is the convention.

## Phases

| # | File | Outcome | Gate |
|---|---|---|---|
| 0 | `01_PHASE0_PACKAGE.md` | v1.1 package written (this folder) | — |
| 1 | `02_PHASE1_DATA.md` | Migration 077 applied; `rules.ts` + Jest; `lib/crew/{db,view,settings}.ts`; `findCrewMembersByEmail`; a race script in prod | **STOP** |
| 2 | `03_PHASE2_CREW_APP.md` | Code login, shell, home, party detail, standby toggle, availability, skills, My pay | STOP |
| 3 | `04_PHASE3_ADMIN.md` | Reconcile + Sync now, schedule + alerts, party detail, roster, rules editor | STOP |
| 4 | `05_PHASE4_CANCEL_NOTIFY.md` | Notifications, confirmations, early release, late cancel → standbys → Allie, drop anyway, cron, Quo inbound | STOP |
| 5 | `06_PHASE5_ATTENDANCE_PAY.md` | Attendance RPC wiring, tips + top-up, Pay screen, CSV, year-end, crew earnings | STOP |
| 6 | `07_PHASE6_QA.md` | Playwright, security review, walkthrough, launch checklist | STOP (Adam flips `CREW_ENABLED`) |
