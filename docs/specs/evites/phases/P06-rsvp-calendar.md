# P06 — RSVP API, edit token, 3-screen UI, calendar

**Branch:** `feat/evites`. **Spec:** §7.1 (rsvp/[token], cal), §7.5, §8. HANDOFF §3 and D11/D16/D17.

## Read first
- `lib/portalAuth.ts` (`portalSigningSecret`, constant-time compare).
- `lib/unsubscribeLink.ts` (the signed-token pattern).
- `lib/publicIntake.ts` (`boundedIntakeText`; note `screenPublicCount` refuses 0).
- `lib/contactLookup.ts` (`isPlausibleEmailAddress`).
- `app/api/checkin/[token]/route.ts` (public write discipline).

## Tasks
1. **`lib/evites/rsvpToken.ts`:** `signEditToken(rsvp, exp)`, `verifyEditToken(token, eviteId)` → `{ok, rsvpId} | {ok:false}`, `editLink(slug, token)`, `cookieName(eviteId)`.
2. **`lib/evites/screens.ts`:** RSVP field screens, including a 0..N count screen.
3. **`app/api/i/[slug]/rsvp/route.ts`:** POST and PATCH exactly per §7.5:
   - gate order: rate limit → Origin → resolve → live and before start → honeypot → per-evite cap
   - the DB recipient cap via `rpc('evite_reminder_email_recent')`
   - the cookie at `Path=/`
   - own-row-only responses via `PUBLIC_RSVP_SELF_COLUMNS`
   - `revision` bump on a material change
   - club fields stored on the RSVP; call `recordClubOptIn` **only through an injected function that is a no-op until P10**
   - side-effect sends are stubbed hooks (`onRsvpCreated`, `onRsvpChanged`) that P09 fills in
4. **`app/i/[slug]/rsvp/[token]/route.ts`:** verify the token, set the cookie, 303; `?stop=1` records the reminder opt-out.
5. **RSVP UI** (client island on `/i/[slug]`):
   - Screen 1: Yes / Can't make it.
   - Screen 2: Yes → child first name (+ Add sibling, max 6), parent name, adults 0 / 1 / 2+, allergy No/Yes → details, one optional "Want a reminder?" box (email or mobile). No → parent name only.
   - Screen 3: "You're on the list!", Add to calendar, note to the birthday child, and below a divider the Birthday Club card (unchecked; exact `club-v1` wording loaded from the server; email prefilled; optional birthday month; "Unsubscribe anytime.").
   - Reload with the cookie → shows your RSVP with an Edit option.
   - Client state only, never URL changes. Fires the `rsvp_started` beacon. Works at 375 px.
   - **Screens 1–2 contain no marketing words.**
6. **`lib/evites/ics.ts`:** `buildIcs` (PUBLISH and CANCEL) and `googleCalendarUrl` per §8.
7. **`app/i/[slug]/cal/route.ts`** per §7.1.
8. **`publicIntakeSurface`:** add the rsvp route to `DELIBERATELY_PUBLIC`.

## Tests
- Token: sign/verify, wrong evite, expired, nonce rotated, tampered.
- RSVP route:
  - every gate (including a wrong Origin → 403, honeypot → fake 200 with no insert, cap → 429)
  - yes needs ≥ 1 child; no forces children and adults to zero; allergy note dropped when `hasAllergy=false`
  - email vs phone detection; recipient cap → stored without the reminder
  - **the response never contains another RSVP** (seed two, assert the shape)
  - PATCH without a token → 401; PATCH on another evite's RSVP → 401
  - revision bump rules
- ICS:
  - a golden file (UTC times for a 2 PM ET Saturday in November and in June)
  - escaping of `,;\` and newlines; 75-octet folding with a multi-byte emoji
  - two VALARMs each carrying a DESCRIPTION; CANCEL has `STATUS:CANCELLED` and SEQUENCE+1
- Cal route: iPhone UA → `text/calendar`; Android → 302 to google with a correct `dates`; `?format=ics`; non-live → 404.
- UI: an RTL test walks Yes in 3 screens and No in 2; Screen 1–2 text contains none of `club|offer|discount|ideas`.

## Acceptance checks
- [ ] Jest is green, including `publicIntakeSurface`. `tsc` is clean. `next build` passes.
