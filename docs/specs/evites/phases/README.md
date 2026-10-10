# Host Hampton EVITE — Build Plan (Stage 3)

The MVP (HANDOFF §10 item 1) broken into small, testable phases. Each `P##-*.md` file is a **self-contained operator prompt**: hand it to a builder agent as-is.

**Source of truth, in order:** `../03-architecture-spec.md` (LOCKED v1.0) → `../02-SOW.md` → `../01-codebase-review.md` §6b → `../handoff/HANDOFF.md`. If a phase prompt and the spec disagree, **the spec wins**. The operator stops and reports the conflict; it does not improvise.

## Order and dependencies

| Phase | Title | Depends on | Touches production? |
|---|---|---|---|
| P00 | `/my-booking` card-payment fix (Q12) | — | Deploy needs Adam's OK |
| P01 | Render spike: Satori + sharp, no network | — | Throwaway container on the box (`--rm --network none`), no prod containers |
| P02 | Migration 068 file, flags, slug, eligibility, ensure | P01 go | **No.** The migration file is written, NOT applied |
| P03 | Facts, themes, party window, state, hashes, glyphs, fit | P02 | No |
| P04 | Templates, InviteCanvas, render pipeline, fonts and assets | P01, P03 | No |
| P05 | Public page `/i/[slug]`, chrome gating, GA/Meta, beacon | P04 | No |
| P06 | RSVP API, edit token, 3-screen UI, calendar | P05 | No |
| P07 | Host page `/my-booking/invitation` | P06 | No |
| P08 | Admin card + API | P06 | No |
| P09 | Emails, sends ledger, suppression, `evite-sends` cron, retention, intake wiring | P06, P07 | No |
| P10 | Birthday Club, copy rename, `eviteSurface` tripwire, suite updates, e2e | P09 | No |
| P11 | Pilot on production + link-preview matrix | all | **Yes.** Each step gated on Adam |

P07 and P08 can run in parallel once P06 is merged into the branch. Everything else is sequential.

## Rules for every operator

1. **Branch:** all evite work goes on `feat/evites`, one commit per phase (message `feat(evites): P0X <title>`). P00 goes on its own branch, `fix/my-booking-card-pay`.
2. **A push to `main` is a production deploy** (`.github/workflows/deploy.yml`). Operators never push to `main`, never merge, never run `scripts/deploy.sh`, never apply a migration and never change the box. Those belong to the orchestrator, after Adam says yes.
3. **Read before writing.** Each prompt names the spec sections and existing files to read first. AGENTS.md §11 holds hard-won rules that apply:
   - Read every write's `{error}`.
   - Use three-outcome reads.
   - Match email and phone only through `lib/contactLookup.ts`.
   - Build URLs with `publicOrigin` / `CANONICAL_ORIGIN`, never from headers.
   - Never call `setHours` (the box is UTC).
   - No `select('*')` toward customers.
   - CRLF-tolerant regexes in tripwires.
   - No `.skip`.
4. **Tests are part of the phase.** `cd services/website && npx jest <touched suites>` must be green, and on the phases that say so, `npx tsc --noEmit` and `npx next build` as well. Report the exact counts.
5. **Stay in scope.** Don't fix unrelated things you notice; list them in the report instead.
6. **Done report** (the last message, under 300 words):
   - files changed
   - tests run with pass/fail counts
   - acceptance checks, one by one: ✅ / ❌ with evidence
   - deviations from the spec, and why
   - open questions

## Rules for the orchestrator

- Hand each phase to a **Sonnet** builder agent. The orchestrator reviews the result before the next phase starts: read the diff, re-run the acceptance commands, spot-check against the spec. A phase is merged into the branch only when its checks are green and match the spec.
- Ask Adam before:
  - applying migration 068
  - creating the storage bucket or Brevo list
  - any deploy or merge to `main`
  - setting env flags on the box
  - the crontab line
  - the Cloudflare rule
  - any `hampton_nginx` change (fleet-wide)
- Keep `SESSION_LOG.md` current: one entry per phase.
- After P10, run `/code-review` (or an equivalent adversarial review agent) over `feat/evites` before asking to deploy.
