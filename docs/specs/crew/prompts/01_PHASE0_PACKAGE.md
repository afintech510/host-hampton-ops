# Phase 0 — Package rewrite (done 2026-10-26)

v1's Phase 0 was a read-only discovery pass. The planning session did that discovery and produced about 25 corrections (spec §12), so Phase 0 became **rewriting the package to v1.1**.

## Delivered

| Path | What |
|---|---|
| `docs/specs/crew/CREW_SPEC.md` | Spec v1.1 |
| `docs/specs/crew/prompts/00–07` | These prompts |
| `starting_plan/migration_077_crew_scheduling.sql` | Schema, functions, seed |
| `services/website/src/lib/crew/rules.ts` | Rules v1.1 |
| `services/website/src/__tests__/lib/crew/rules.test.ts` | Jest suite for the rules |
| `services/website/src/lib/crew/templates.ts` | Copy, signed "— Allie, Host Hampton" |

## Not carried over from v1

- **`design/*.dc.html` mockups.** They stay in the local package, because the repository is public and they carry first names. Their tier ladder, early-access labels, and anchor approval are superseded.
- **`crew_tier`, points, `evaluateTier`, `swapClaimRule` waves, `anchorRequiresApproval`, `crew_approve_swap`, the `roster.json` seed.**

## Discovery facts the later phases rely on

- `bookings.id` is a `uuid`.
- The Party Helper add-on is a hand-typed line item (spec §9).
- `email_auth_codes` is the portal's code table. Crew get their own `crew_login_codes`, keyed by member.
- There are no `crew*` tables, routes, or env vars before 077.
