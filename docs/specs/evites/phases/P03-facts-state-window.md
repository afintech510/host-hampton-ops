# P03 — Facts, themes, party window, state, hashes, glyphs, fit

**Branch:** `feat/evites`. **Spec:** §2 (themes, partyWindow, facts, state, hash, glyphs, fit), §3, §4.

## Read first
- `lib/bookingStatus.ts` (`bookingStage`, `partyStatuses`), `lib/bookingBalance.ts` (`sumPayments`).
- `lib/partyTime.ts` (`parseTime`, `etToUtc`, `shiftEtDate`, `etDateString`).
- `lib/partyAddress.ts` (`isProvisionalAddress`), `lib/studioLocation.ts`, `lib/paymentContacts.ts` (must NOT be used).
- `lib/pricingCatalog.ts` (mobile tiers, mini party).
- Table `party_themes` columns: review §1.2. Live slugs: `glow-party, swiftie-party, spa-party, slime-party, kpop-party, barbie-party, sweets-treats, sleep-under-party, toddler-party`.

## Tasks
1. `lib/evites/themes.ts`: `resolveTheme(booking, lineItems, partyThemes)`. It is pure: the caller passes `party_themes` rows. Replace the P02 stub in `ensure.ts` (ensure reads `party_themes` and line items).
2. `lib/evites/partyWindow.ts`: 08:00–21:00 ET acceptance; durations per spec. **No `setHours`, no `new Date(x + 'T…')`.**
3. `lib/evites/state.ts`: `inviteState(booking, payments, evite, now, flags)` returns `disabled | unavailable | closed | live | needs_time | preview`, in the spec §4 order. "Booked" comes **only** from `bookingStage()`.
4. `lib/evites/facts.ts`: `inviteFacts(booking, evite, lineItems, partyThemes, state)` per spec §3, including `shareText`, `reshareText`, `title`, `description`, and both place lines (mobile town extraction).
5. `lib/evites/hash.ts`: `renderInputsHash`, `calInputsHash` over canonical JSON (sorted keys).
6. `lib/evites/glyphs.ts`: load each bundled `.woff` (from P01, `public/evites/fonts/`) with `opentype.js`. `fitsFont(text, font)` and `screenForImage(text, font)` (NFKD-fold, then drop unsupported characters). Memoise the font loads.
7. `lib/evites/fit.ts`: `fitFontSize({text, font, size, minSize, maxWidth, letterSpacingEm, uppercase})`.

## Tests
- **partyWindow:** `14:00`, `2:00 PM`, `12:00 PM`, `10:30`, `Evening`, `TBD`, `2:00` (→ null), `23:00` (→ null), a DST-boundary Saturday in November and in March, mini party 90, mobile 60/90, theme 120.
- **state:**
  - one case per writer: Payment Element `pending_review` + payment row; plan pay-link `deposit_paid`; admin cash on `awaiting_deposit`; admin `confirmed` with no payment;
  - admin refund row bringing net to 0 on `awaiting_deposit` → preview;
  - `deposit_paid` with net 0 → still live (legacy, pinned);
  - cancelled / lost / archived → unavailable;
  - past end → closed;
  - booked with `Evening` → needs_time;
  - flags off / pilot.
- **facts:** name / no name ("BIRTHDAY", `hasName=false`); `quote_snapshot.childName` fallback; preview dateLine "Pick your date"; studio lines come from `studioLocation` constants; mobile town for three address shapes plus "Long Island" fallback; provisional address → "Location to be confirmed"; the host contact default is never the payments number.
- **glyphs:** "·" and "–" are kept where the font has them (assert per font); "Łucja" folds; an emoji is dropped.
- **fit:** a long name shrinks to ≤ maxWidth and ≥ minSize.
- **hash:** stable across key order; changes when the date changes; `calInputsHash` does not change on a theme change.

## Acceptance checks
- [ ] Jest is green. `tsc` is clean. A source grep finds no `setHours` and no `T12:00` concatenation in `lib/evites/`.
