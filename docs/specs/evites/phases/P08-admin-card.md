# P08 — Admin "Invitation & RSVPs" card

**Branch:** `feat/evites` (can run in parallel with P07). **Spec:** §7.3. HANDOFF §5.

## Read first
- `app/admin/PartiesTab.tsx` (the detail drawer from L843; the Actions card near L1130; check-in near L1266).
- `app/api/admin/parties/[id]/route.ts` (the action pattern).
- `lib/adminAuth.ts` (`isAdminAuthorized`, `adminActorId`), `logBookingChange`, `adminSurface.test.ts`.

## Tasks
1. **`app/api/admin/parties/[id]/invitation/route.ts`:**
   - **GET:** evite, state, facts, links, render_error, the latest send per type (including `failed`/stuck `sending`), `ADMIN_RSVP_COLUMNS` rows, summary.
   - **GET `?reveal=<rsvpId>`:** the raw reminder contact for one RSVP, logged via `logBookingChange`.
   - **POST actions:** `ensure`, `rerender`, `archive`, `unarchive`, `set_theme` (validated against the template registry; `theme_word`/`theme_sub` ≤ 12 characters), `reslug` (refused once `went_live_at` is set), `notify_cancelled` (calls the P09 hook; a stub until then).
   - `isAdminAuthorized` plus `adminActorId` on every write; every write reads `{error}`.
2. **`components/admin/InvitationCard.tsx`**, mounted in the PartiesTab drawer:
   - state chip; links (public invite, host page)
   - a "Needs a start time" warning; a "No parent email: share manually" warning
   - headcount vs cap; allergy roll-up; notes to the birthday child
   - the send ledger
   - buttons for each action, plus **Print RSVP sheet** (`window.print()` with a `@media print` stylesheet that prints only this card's sheet: party header, kids list, adults, allergies, notes)
3. Only show the card for eligible bookings.

## Tests
- Every handler is gated (`adminSurface` rules pass). `reslug` is refused after go-live. `set_theme` rejects an unknown template. `reveal` writes an audit row. GET never selects `*`.
- Card renders with a fixture (RTL smoke test).

## Acceptance checks
- [ ] Jest is green, including `adminSurface`. `tsc` is clean. `next build` passes.
