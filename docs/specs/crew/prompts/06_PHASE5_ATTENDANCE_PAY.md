# Phase 5 — Attendance, tips, pay

**Read first:** spec §3.1–§3.2, §3.9; `rules.ts` (`partyRateCents`, `stepAfter`, `tipTopupCents`).

## 1. Attendance (`/admin/crew/parties/[id]`, `POST /api/admin/crew/parties/[id]/attendance`)

- **When:** the button is enabled once `now ≥ ends_at`.
- **The form, one row per assigned slot:**
  - worked (the default) or no-show;
  - **tip ($)**, with the top-up preview (`tipTopupCents`);
  - method (Venmo / Zelle / cash / check / other) plus a note;
  - shift start/end, defaulting to party ± setup/clean-up.
- **The server builds each outcome:**
  - with `rules.ts`: `pay_cents = partyRateCents(role, steps) + extra_flat_cents`, `step_at_pay = steps`, `tip_topup_cents`, `steps_after = stepAfter(worked | worked_covered | no_show)`;
  - **grace** waives a no-show reset;
  - then it calls `crew_mark_attendance(party_id, outcomes, actor)`.
- **Inside that function, in one transaction:**
  - a compare-and-swap on each member's steps; any `stale` means re-read and retry once;
  - the owner is unpaid and keeps her steps.
- **A no-show** sets `needs_review` and sends Allie `noShowReview`.
- **Editing:**
  - the server computes from the steps with the prior outcome's delta **reverted**;
  - the function appends `admin_adjustment` (`voids_event_id`) plus the new outcome at `attendance_seq + 1`;
  - it deletes nothing.

## 2. Pay (`/admin/crew/pay`)

- **The records:** date, member, party, spot, pay, extra, tip, top-up, total paid, method, note, `paid_at`.
- **Filters:** date range, member, method.
- **CSV export:** RFC 4180, with formula-injection-safe cells (prefix `'` to `= + - @`).
- **Year-end:** one row per member per calendar year with pay, tips, top-ups, and total. This is the 1099 worksheet; the app files nothing.
- **Crew side:** `/crew/pay` lists their own worked parties with pay, tip, top-up, and paid status.

## Acceptance (prod, throwaway rows)

- Step 3 working crew is paid **$58.50**, and leading at step 3 **$77.50**.
- A $12 tip records an **$8 top-up**, and steps go 3 → 4.
- A covered party worked: +2.
- A no-show resets to 0 (recorded, not applied, inside grace) and sets `needs_review`.
- Editing a no-show to worked appends a void plus the new row, and steps are correct.
- The CSV opens cleanly in Sheets.

Update docs, **STOP**.
