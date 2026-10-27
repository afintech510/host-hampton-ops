# Phase 2 — Crew app (mobile-first)

**Read first:** spec §3.3–§3.8, §5, §8.

## Gate and shell

- `CREW_ENABLED !== 'true'`:
  - every `/crew` page `notFound()`s;
  - `/api/crew/*` answers 404;
  - crew login refuses.
- **The shell:**
  - `isCrewPath()` in `lib/crewChrome.ts`, used by Nav, Footer, and BenchworksAttribution. Call it **after the hooks**, because a hook-order crash took the planner down on mobile once.
  - Add `/crew` to both banners' `HIDDEN_PREFIXES`, to Crisp, and to the MetaPixel/Attribution blocklist.
  - Use `-mt-20` plus a body-background override.
- **Noindex:** `NOINDEX` in `app/crew/layout.tsx`, the layout added to `seo.test.ts` `MUST_NOINDEX`, and an `X-Robots-Tag: noindex` header for `/crew/:path*` in `next.config.js`.
- **Fonts and colours:** Bricolage Grotesque and Plus Jakarta Sans via `next/font`, with tokens scoped to the crew UI.

## Auth

- **`POST /api/crew/auth/request {email}`:**
  - `guardRate(intakeRule('crew/auth/request'))` plus `guardRecipient` per address.
  - Always answers `{ok:true}`.
  - For an active member found by `findCrewMembersByEmail`, mails a 6-digit code (`generateEmailLoginCode`, hashed) stored in `crew_login_codes` against `member_id`.
- **`POST /api/crew/auth/verify {email, code}`:**
  - `plannerRule`, plus the five-attempt **claim** pattern from `/api/portal/email-auth/verify`.
  - Sets the `hh_crew` cookie `<memberId>:<issuedAtMs>:<sig>`: HttpOnly, SameSite=Lax, 30 days, Secure unless `isLocalRequest`.
- `POST /api/crew/auth/logout`.
- `requireCrewMember(req)`, and its server-component twin over `cookies()`, re-read the member and reject `paused` or `removed`.
- **Register every new route** where the surface tests require it. `publicIntakeSurface.test.ts` gets a new `gateOf` branch for `requireCrewMember`.

## Pages

These are server components reading only `view.ts` projections. Writes go through `/api/crew/*` route handlers (`requireCrewMember` + `guardRate(plannerRule('crew'))`).

1. **`/crew`:**
   - Rate card from `partyRateCents` and `nextStepLabel`: "You're at $58.50 a party ($77.50 leading). One more party makes it $61.00."
   - Confirm prompts.
   - **My parties.**
   - **Open parties:** published, upcoming, with open spots. Each shows staffed x/y, kids, and **my pay for that spot**. A Lead spot shows only for `can_lead` members.
   - **The standby toggle**, on parties I'm not on.
   - Claim through `crew_claim_slot`, after re-checking §3.6 server-side with `rules.ts`.
   - Undo while `now < requestAt`.
2. **`/crew/parties/[id]`:** spec §8. The team shows first names and confirmed state only. A party the member isn't on and can't currently see is a 404.
3. **`/crew/availability`:** as in v1. The server refuses blocking a day the member is working.
4. **`/crew/skills`:**
   - The checkboxes: Hair (braids/tinsel/styling), Nails, Arts & crafts, Photo booth setup, POS/card machine, Deep clean floors, Balloon arch/garland, Face painting, Has a car.
   - Free-text extras, trimmed, ≤ 40 characters each, ≤ 10 entries.
   - Informational only.
5. **`/crew/pay`:**
   - My rates, and the ladder in dollars (step 0 → 8 for crew and, if `can_lead`, Lead).
   - "How cancelling works", generated from settings in plain words. **No tier, level, or points words.**
   - My worked parties: pay, tip, top-up, paid method and date.

## Acceptance

- With the flag off, `/crew` 404s.
- With it on (a throwaway member in prod), login → claim → undo works.
- A non-`can_lead` member never sees a claim button on a Lead spot, and the RPC refuses it anyway.
- The projection tests are green, and the RSC payload is grepped for another member's email and phone: zero hits.
- Build, typecheck, tests, and the surface suites all pass.

Update docs, **STOP**.
