# Phase 6 — QA, security review, walkthrough, launch

## 1. Automated

- **Jest:**
  - rules, projections, jobs (fake notifier, injectable `now`), sync, attendance outcome building;
  - every surface suite: inbound, outboundSend, publicIntake, contactIdentity, emailTemplateEscaping, seo, cronManifest.
- **Mutation-check each new tripwire.** Put the defect back and count the reds. Anchors must tolerate CRLF, and the harness must refuse to run on a red tree.
- **Playwright** `e2e/crew.spec.ts`, with `E2E_FAKE_SENDERS=1`:
  - login → claim → confirm;
  - late cancel → standby claim → covered;
  - drop anyway;
  - block a day;
  - admin publish / assign Allie as Lead / attendance / pay CSV.

## 2. `docs/specs/crew/SECURITY_REVIEW.md`

- **Route-guard table:** every `/crew/*` page and `/api/crew/*` route against `requireCrewMember`; every `/admin/crew/*` and `/api/admin/crew/*` against `isAdminAuthorized`; the cron against `isCronAuthorized`; the Quo crew branch against signature verification.
- **Leakage:**
  - grep every crew response **and the RSC payload** for another member's email, phone, pay, tips, steps, notes, and reasons;
  - only `view.ts` shapes may appear.
- **RLS and grants:**
  - no `anon`/`authenticated` policies, and table privileges revoked;
  - functions revoked from `public`/`anon`/`authenticated` and granted to `service_role`;
  - query `pg_proc.proacl` and `information_schema.role_table_grants` to prove it.
- **Input:** server-side validation everywhere, and ownership checks by id. Never trust a client-sent member id, step, or pay figure.
- **Rate limits:** login request (per caller and per recipient), verify, and the claim/standby/release routes.
- **Test-only code:** any `now` override is unreachable in production.

## 3. `docs/specs/crew/WALKTHROUGH.md`

- The click-path for Adam and Allie through every feature, using throwaway members (test inbox only, never a real crew phone).
- Each step marked done or in progress, never rounded up.

## 4. Launch checklist (Adam)

- [ ] The contractor agreement and W-9 ready, reviewed with Christine (crew start is $51 = $17/hr for 3 hours; spec, top).
- [ ] The roster entered in `/admin/crew/members`, with starting steps, `can_lead`, and skills.
- [ ] `launch.launch_date` set, which starts the 60-day grace.
- [ ] `CREW_SMS_ENABLED=true` (the Quo A2P registration covers staff texts — Adam, 2026-10-26).
- [ ] The `crew` row in `jobs.tsv` installed on the box.
- [ ] Throwaway crew rows deleted.
- [ ] **`CREW_ENABLED=true`** in `.env` and `docker-compose.yml`, then `up -d --build website`.
- [ ] Crew invited from the roster.

Update `SESSION_LOG.md` with a final shipped / not-shipped table, **STOP** for Adam's sign-off.
