# Host Hampton Crew Scheduling — Feature Spec v1.1

**Status:** v1.1, approved by Adam 2026-10-26. It supersedes v1 (the package in
`starting_plan/Staffing-app/`, kept local and untracked) everywhere they disagree.
**Owner:** Adam Larkin · **Repo:** afintech510/host-hampton-ops
**Plan of record:** the "Staffing app plan review" planning session (the finalized
plan, "v1.1 of the Staffing-app package").

> [!NOTE]
> **Minimum wage — ruled by Adam, 2026-10-26: crew start at $51 a party** (migration 078).
> - $51 for a typical 3-hour party is **$17.00/hr**, the 2026 Long Island minimum. v1.1 first said $50 ($16.67/hr).
> - A party whose clean-up runs long still works out under $17/hr. Pay stays flat by design; the app records hours (start/end, plus setup and clean-up) so the evidence exists.
> - The contractor agreement and W-9 are still to be reviewed with Christine Parisi before launch (§11).

---

## Changelog

| Version | Date | Change |
|---|---|---|
| v1 | 2026-10-25 | Original package: tiers, hourly rates, points, early-access windows, swap waves. |
| **v1.1** | 2026-10-26 | Adam's model: **flat pay per party with $2.50 steps**, step resets, standbys, a guaranteed $20 tip floor, and Allie as an unpaid Lead. About 25 platform corrections (§12). |
| v1.1 ruling | 2026-10-27 | Adam: a **studio rental is a room rental, not a party**. With a Party Helper booked, crew are needed **only for the helper's stated time** (read from the helper line item), and each spot may be taken by a Lead or a helper — a rental has **no Lead spot**. |
| Phase 4 | 2026-10-27 | Built: §3.7 and §6–§7 as written, plus three choices the spec left open. **Allie's "Assign" on a late cancel uses `crew_claim_swap` as admin**, not `crew_admin_assign` (which takes an OPEN spot; a late cancel's is still held). **Every cron message has a window, not only a start** (request until the start; reminder only before the deadline and ≥12 h after the request; Allie's overdue alert ≥12 h after the request; "tomorrow" only within 6 h of the 24 h mark; availability from the 10th to the due day, after 9am ET). **Queued rows past 48 h are skipped, not sent** (`REMINDER_MAX_LATENESS_HOURS`). Migration 081. |
| v1.1 rulings | 2026-10-26 | Adam: crew start **$51** (was $50; migration 078); the +2 for covering applies when the cover is **worked**; the per-hour Party Helper item is **one helper**; standby window **2 h**; Quo registration covers staff texts; careers-page wording **unchanged**. |

## 1. Problem and goal

Host Hampton runs kids' parties with about 10 independent-contractor party crew, at least 3 per party. When crew cancel, Allie scrambles. The crew portal has five jobs:

1. Crew pick their own parties, because choosing a party makes people more committed to it.
2. **Reliability is paid, in plain dollars.** Every party worked raises your per-party rate a step, and cancelling late without cover resets it.
3. Covering a late cancel is easy and private, through **standbys**. Nobody's phone number is shared.
4. Availability is collected ahead of time, so a known conflict never turns into a call-out.
5. Allie gets one screen for staffing, alerts, pay, and rules.

**Out of scope for v1:**
- Executing payroll. Money still moves by Venmo, Zelle, cash, or check; the app records it.
- A client-facing "tip your crew" ask. That is a later phase on the money path.
- Any tier, level, or points system.
- Early access to new parties.

## 2. Vocabulary

| Term | Meaning |
|---|---|
| Crew member | A party worker (1099 contractor). A `crew_members` row. |
| Party Lead | The one Lead spot per party. Only `can_lead` members, or Allie (`is_owner`), may hold it. |
| Crew spot | Any spot that is not the Lead. |
| Step | An integer from 0 to 8 on each member. It sets their per-party rate. **The word "step" is used in crew copy only as "a step" / "$2.50 a step". Crew never see a level, tier, or points.** |
| Standby | A member who has said "I can cover" on an upcoming published party they are not working. Unlimited, no obligation. |
| Early release | Cancelling with **7 or more days'** notice. The spot reopens immediately. −1 step. |
| Late cancel | Cancelling with **less than 7 days'** notice. Opens a cover request to the standbys. The person cancelling stays on the party until someone claims. |
| Covered | A standby (or anyone, once Allie widens it) claimed a late cancel. No change for the person cancelling. |
| Drop anyway | The person cancelling leaves a late cancel that nobody claimed. **Reset to step 0.** |
| No-show | Assigned and did not come. **Reset to step 0**, and Allie is flagged to talk to them. |
| Owner | Allie, as a `crew_members` row with `is_owner = true`. She can lead and counts toward crew needed. Her spot is unpaid, and she gets no steps, tips, top-ups, or notifications. |

## 3. Business rules

Every number below lives in `crew_settings` and is editable by Allie in `/admin/crew/rules`. **`src/lib/crew/rules.ts` is the only implementation of these rules.** The SQL functions apply the result with a compare-and-swap on `crew_members.steps`, so they never re-derive it (§4).

### 3.1 Pay: flat per party, never hourly

| Spot | Step 0 | Each step | Step 8 (max) |
|---|---|---|---|
| Crew | $51.00 | +$2.50 | $71.00 |
| Party Lead | $70.00 | +$2.50 | $90.00 |

Settings key `pay`: `{crew_start_cents:5100, lead_start_cents:7000, step_cents:250, max_steps:8, tip_floor_cents:2000}`. `max_steps` cannot exceed 8, because the DB checks `steps BETWEEN 0 AND 8`.

- **Pay per party is fixed.** It does not change when clean-up runs long or short. A party is typically about 3 hours.
- **Extra pay:** a party can carry a flat `extra_flat_cents` per person, for example on a holiday weekend. It is added to everyone paid for that party.
- **Pay is snapshotted at attendance.** It uses the step the member had **before** that party's step change. A member at step 3 working crew is paid $58.50, then moves to step 4. Leading at step 3 pays $77.50.
- The owner is never paid by the app.

### 3.2 How steps move

Settings key `steps`: `{worked:1, covered:2, early_release:-1}`.

| Event | Effect | Recorded when |
|---|---|---|
| Worked a party | **+1** | Attendance marked |
| Worked a party **they claimed as cover for a late cancel** | **+2** (that party counts double, so +2 in place of the +1, never on top of it) | Attendance marked |
| Cancelled 7+ days ahead (early release) | **−1**, never below 0 | At release |
| Cancelled under 7 days, and a standby took it | **No change** | At claim |
| Cancelled under 7 days, nobody took it, "drop anyway" | **Reset to 0** | At drop |
| No-show | **Reset to 0**, plus `needs_review` | Attendance marked |

> [!NOTE]
> **The +2 for covering is applied when the cover is WORKED, not when it is claimed.** If it were applied at claim time, two members could earn it in a loop: A late-cancels, B claims (+2), B late-cancels, A claims back (+2), forever, without anyone working. Applied at attendance, only the person who actually works the party is credited, and a cover followed by a no-show is a reset like any other. **Confirmed by Adam, 2026-10-26.**

- **Launch grace:** for `launch.grace_days` (60) after `launch.launch_date`, every step **loss or reset** is recorded in the ledger with `waived_grace = true` and **not applied**. Gains are always applied. While `launch_date` is unset (before launch), losses are waived too. The launch date is an ET calendar date, and grace starts at ET midnight (`etToUtc`).
- **Starting step:** Allie sets each member's starting step when she adds them.
- **Step override:** Allie may set a member's step with a required reason. This writes an `admin_adjustment` ledger row.

### 3.3 What crew see

- On login, a member sees **their own rate per party**, for crew and for Lead if they `can_lead`, and how far they are from the next step, written in plain words.
  - "You're at $58.50 a party ($77.50 leading). One more party makes it $61.00."
  - At the top: "You're at the top rate: $71.00 a party."
- **No levels, no points, no tier titles.** A test fails the suite if crew-facing copy contains `tier`, `level`, `captain`, `points`, or `pro`.
- **No early access.** A published party goes to everyone at once.
- Crew see their own tips once paid.

### 3.4 Party Lead

- Every party has **exactly one Lead spot** — except a studio rental, which has none (its spots are open to a Lead or a helper; Adam, 2026-10-27). The DB enforces at most one live Lead spot per party.
- Only `can_lead` members or the owner may hold it. **The database enforces this with a trigger on `crew_slots`, whatever path writes the row.** The claim RPC answers `not_lead` before the trigger would fire.
- There is no approval queue.
- **Allie can be assigned as Lead.** She counts toward crew needed, is unpaid, and gets no steps, tips, top-ups, or notifications.
- If a published party still has no Lead `lead.alert_days_before` (7) days before it starts, Allie is alerted.

### 3.5 Staffing

- **Crew needed = `max(min_slots, ceil(kids / kids_per_crew))`, capped at `max_slots`, including the Lead.**
  - 3 up to 12 kids, 4 up to 16, then one more per 4 kids.
  - Settings key `slots_by_guests`: `{min_slots:3, kids_per_crew:4, max_slots:10}`.
- An unknown kid count means `min_slots`. Mobile parties use the same count.
- Allie can override the count per party (`slots_override`, 1–10).
- **Studio rentals** get crew only if the Party Helper add-on was bought, and then **spots = helpers bought** (§9).

### 3.6 Claiming

A member can claim an open spot when all of these hold:
- the party is published and has not started;
- they are `active`;
- they are not already on that party;
- they have no overlapping party, counting setup and clean-up buffers;
- they have not blocked that date or part of day;
- for the Lead spot, they are `can_lead`.

Claims are atomic, so the first claim wins (`crew_claim_slot`). A member can undo a claim while `now < confirmationSchedule().requestAt`. That counts as never claimed: no ledger event and no step change.

### 3.7 Confirmations, cancelling, standbys

**Confirmation** (settings key `confirmations`, unchanged from v1):
- The request goes out 120 h before; a reminder at 96 h; it is due at 72 h.
- Still unconfirmed at 72 h means an alert to Allie.
- A day-before reminder goes out at 24 h.
- Members confirm in the app, or by replying **Y / YES** to the SMS.

**Cancelling ("Can't make it")**, classified by `classifyDrop` against `drops.late_drop_days` (7):
- **7 or more days out: early release.** The spot reopens immediately to everyone, the member loses 1 step (waived in grace), and Allie is notified.
- **Under 7 days: late cancel.** A cover request opens (`crew_swap_requests.status = open`), and **every standby on that party is texted at once**. The first to claim wins.
  - A Lead spot goes only to `can_lead` standbys.
  - The person cancelling **stays on the party** until someone claims. Before that they can **withdraw** the request (`cancelled`) or **drop anyway**.
  - **No standby claims within `drops.standby_window_hours` (2), or there are no standbys at all:** the request is `escalated` and Allie is alerted. Her alert offers **"Offer to everyone free that day"** (sets `offered_to_all_at`, after which any eligible member may claim) or **"Assign"**.
  - **48 hours before the start** (`drops.unclaimed_warning_hours`), an unclaimed request warns both the person cancelling ("you're still on") and Allie.
  - **Drop anyway:** the member is unassigned, reset to step 0 (waived in grace), the request becomes `dropped_uncovered`, and Allie gets an urgent alert.
  - When the party starts with the request unresolved, it is `expired` with no ledger event. Attendance decides.
- **After the start:** "the party already started, call Allie".
- A reason is required: Sick, Family, School, or Other, with an optional note. **Only Allie sees the reason.**
- **Privacy:** crew never see each other's phone numbers, emails, pay, tips, steps, notes, or reasons.

### 3.8 Availability (unchanged from v1)

- Crew block dates on a month calendar: `all_day`; `before_noon` (blocks parties starting before 12:00 ET); or `after_noon` (blocks parties ending after 12:00 ET).
- Weekly recurring blocks are supported.
- Blocking never costs a step. A member cannot block a day they are already working; they must use "Can't make it".
- Next month's availability is due on the 15th, with a reminder on the 10th.

### 3.9 Attendance, tips and pay (same day)

After the party, Allie marks attendance (`crew_mark_attendance`, one transaction):

- Each slot is **worked** (the default) or **no-show**.
- **Worked:**
  - `pay_cents = partyRateCents(role, steps) + extra_flat_cents`
  - `step_at_pay = steps` (before the change)
  - the step change from §3.2
- **Tips:** Allie types **each person's tip**. Host Hampton tops it up to the floor: `tip_topup_cents = max(0, tip_floor_cents − tip_cents)`. The top-up is recorded separately because it is a Host Hampton cost. A $12 tip records an $8 top-up.
- **Paid the same day:** the payment method is recorded (Venmo / Zelle / cash / check / other, plus a note) along with `paid_at`.
- **Hours on record only:** shift start and end are recorded, defaulting to party start − setup and party end + clean-up. They never change pay.
- **Editing attendance afterwards:** append an `admin_adjustment` row with `voids_event_id`, then the new outcome with `attendance_seq + 1`. Ledger rows are never deleted.
- An unmarked party alerts Allie `attendance.alert_hours_after_end` (12) h after it ends.
- The owner's slot records `worked` for history, with no pay and no step change.

## 4. Data model — `starting_plan/migration_077_crew_scheduling.sql`

| Table | Purpose |
|---|---|
| `crew_settings` | key → jsonb config (§3) |
| `crew_members` | roster: `steps`, `can_lead`, `is_owner`, `skills text[]`, `email` + generated `email_key` (unique, lowercase), E.164 `phone`, opt-ins, `needs_review`, `job_application_id` |
| `crew_login_codes` | 6-digit email login codes, **keyed by `member_id`**, hashed |
| `crew_parties` | one staffing record per party: `booking_id` FK → `bookings(id)` (unique), `party_kind`, times, `guest_count`, `location`, `slots_override`, `extra_flat_cents`, `sync_flags`, status |
| `crew_slots` | spots: role `lead`/`crew`, status, member, `covered_swap_id`, and the pay snapshot (`pay_cents`, `step_at_pay`, `extra_cents`, `tip_cents`, `tip_topup_cents`, `paid_method`, `paid_note`, `paid_at`, shift times, `hours_worked`) |
| `crew_standbys` | `(party_id, member_id, created_at, withdrawn_at)`; one live row per pair |
| `crew_swap_requests` | late-cancel cover lifecycle: `open` → `claimed` / `cancelled` / `dropped_uncovered` / `escalated` / `expired` |
| `crew_unavailability`, `crew_recurring_blocks` | availability |
| `crew_events` | append-only ledger: `step_before`, `step_delta`, `step_after`, `waived_grace`, `attendance_seq`, `voids_event_id` |
| `crew_notifications` | outbound log plus admin in-app alerts (`member_id` null), unique `(dedupe_key, channel)` |

**Access:**
- RLS is on with no policies, and table privileges are revoked from `anon` and `authenticated`. Every read goes through server code using `getSupabase()` (service role).
- **SQL functions:**
  - `crew_claim_slot`
  - `crew_admin_assign`
  - `crew_release_slot`
  - `crew_claim_swap`
  - `crew_drop_uncovered`
  - `crew_mark_attendance`
  - `crew_admin_set_steps`
- **How they work:**
  - All of them are `SECURITY DEFINER`, revoked from `public`, `anon` and `authenticated`, and granted to `service_role`.
  - Every one claims first, with `FOR UPDATE` on the row it changes, and acts second.
  - **A step change is a compare-and-swap.** The app computes `steps_after` with `rules.ts` and passes the `expected_steps` it read. A mismatch returns `stale`, the app re-reads and retries once, and the SQL never re-implements a rule.

## 5. Auth and roles

- **Admin:** `isAdminAuthorized(req)` / `adminActorId(req)`, the existing `ADMIN_PASSWORD` bearer or `hh_admin` cookie.
- **Crew login** works like the portal's 6-digit code:
  - **Request:** `POST /api/crew/auth/request {email}` always answers `{ok:true}`. When `findCrewMembersByEmail` finds an active member, it mails a code, capped per address by `guardRecipient`.
  - **Verify:** `POST /api/crew/auth/verify {email, code}` checks the code with the five-attempt claim pattern from `/api/portal/email-auth/verify`.
- **The session:**
  - It is the `hh_crew` cookie, `<memberId>:<issuedAtMs>:<sig>`, signed with `portalSigningSecret()`.
  - The cookie is HttpOnly, SameSite=Lax, and lasts 30 days. It is Secure except when `isLocalRequest`.
  - **There is no Supabase Auth in this app**, so there is no `auth_user_id`.
- `requireCrewMember(req)` re-reads the member on every request and rejects anyone `paused` or `removed`.
- Crew can read only their own data, plus the projections in `lib/crew/view.ts`.

## 6. Notifications

| Channel | When it is used |
|---|---|
| `in_app` | Always |
| `email` | Via Resend (`lib/crew/mail.ts`), when `email_opt_in` |
| `sms` | Via **Quo** (`sendSMSViaQuo`), only when `CREW_SMS_ENABLED=true` **and** the member's `sms_opt_in` |

- **SMS rules:**
  - Quiet hours, 8am–9pm ET (`checkSmsQuietHours`), **defer** a text to the next 8am and never cancel it.
  - Text is made GSM-7 safe and counted with `lib/smsSegments.ts`.
  - A member's first SMS carries the disclosure ("Msg freq varies. Reply STOP to opt out, HELP for help.").
- **Inbound** goes through a crew branch in `/api/webhooks/quo`. It runs **after** signature verification and the rate limit, and **before** keyword routing and contact lookup.
  - `Y` / `YES` confirms the sender's next due party. YES is also a START keyword, so the crew branch must win.
  - `STOP` sets crew `sms_opt_in = false` **and** still calls `recordSmsOptOut`.
  - **A crew phone never becomes a customer `contacts` row.**
- **Admin alerts** are emailed to `CREW_ADMIN_EMAIL || ownerEmail()` and also written as an in-app `crew_notifications` row with `member_id` null.
- **Every send writes `crew_notifications` with a unique `dedupe_key`** (e.g. `confirm_request:{slot_id}`), so the cron is idempotent.
- **Every message signs "— Allie, Host Hampton".** Copy lives in `src/lib/crew/templates.ts`.
- **The owner row never receives a notification.**

## 7. Scheduled job

`GET /api/cron/crew`:
- It is guarded by `isCronAuthorized` and scheduled by the `scripts/cron/jobs.tsv` row `crew|*/5 * * * *|/api/cron/crew|15|box`.
- It always answers `{ok: …}`, and `{ok:true, skipped:'disabled'}` while `CREW_ENABLED` is not `true`.
- **Exception:** the booking reconcile runs regardless, so Allie can set up beforehand (§9).

Each tick runs, in order:

1. `reconcileCrewParties()` (§9).
2. Confirmation requests, reminders and overdue alerts; day-before reminders.
3. Cover requests:
   - escalate to Allie after the standby window, or at once when there are no standbys;
   - the 48-hour warning;
   - expire at the start.
4. The attendance-not-marked alert.
5. The no-Lead alert, 7 days out.
6. The availability reminder, on the 10th.

All times are computed in `America/New_York` and stored as `timestamptz`. The box is UTC, so the cron never uses `setHours()`.

## 8. Screens

### Crew app (`/crew`, mobile-first, noindex, its own shell)

| Route | Content |
|---|---|
| `/crew/login` | Email → 6-digit code |
| `/crew` | Rate card (my rate per party, crew and Lead, plus the next step in plain words), confirm prompts, My parties, Open parties, "I'm a standby" toggle |
| `/crew/parties/[id]` | Theme, date/time, location, setup time, kids, my spot, my pay for it, the team (first names and confirmed state only), notes from Allie, confirm, "Can't make it" |
| `/crew/parties/[id]/cant-make-it` | Notice classification and what it costs in plain words, reason, then live status: the standbys asked, withdraw, drop anyway, "You're covered" |
| `/crew/availability` | Month calendar, weekly toggles, due-date card |
| `/crew/skills` | Self-reported skills (informational only) |
| `/crew/pay` | My rates, the step ladder in dollars, how cancelling works, my parties, tips and earnings |

Bottom nav: **Parties · Availability · My pay**.

### Admin (`/admin/crew/*`)

These are standalone pages following `admin/applications/page.tsx`, linked from `/admin` → manage → "Crew".

| Route | Content |
|---|---|
| `/admin/crew` | "Sync now", alerts, upcoming parties (when, theme, kids, staffed x/y including the Lead, available count, crew, status) |
| `/admin/crew/parties/[id]` | Publish; assign (including Allie as Lead); conflict warnings; extra pay; notes; standby list; mark attendance (tips, top-ups, method) |
| `/admin/crew/members` | Roster: steps and rate; step override with a reason; `can_lead`; skills; invite; pause/remove; "Add to crew" from a hired `job_applications` row |
| `/admin/crew/rules` | Every `crew_settings` value |
| `/admin/crew/pay` | Payment records, filters, CSV, year-end totals per person (pay, tips, top-ups) for the 1099s |

### Design tokens (from the v1 mockup)

| Token | Value |
|---|---|
| Fonts | Bricolage Grotesque for display, Plus Jakarta Sans for body, both via `next/font` |
| Ink | `#1E1B3A` |
| Berry | `#C2185B` (hover `#8E1043`) |
| Surface | `#F5F3FA` |
| Cards | `#FFFFFF` |
| Muted | `#5B5873` |
| Border | `#E6E3EF` |
| Gold | `#F4B740` |

- **Status colours** are unchanged from v1: success `#E3F4EA`/`#145236`, warn `#FFF1DB`/`#6E3C00`, alert `#FCE4EE`/`#8E1043`, info `#E8EEFF`/`#1D3F9E`. **The tier chips are gone.**
- **Accessibility:** touch targets ≥ 44 px, real `<button>`/`<a>` elements, WCAG AA contrast, and it must work at 360 px wide.
- The v1 HTML mockups stay in the local package. They are not committed, because this repository is public and the mockups carry first names.

## 9. Integration with bookings: a reconcile, not hooks

There is no single "booking confirmed" function. There are about 12 payment paths, including the tripwire-heavy Stripe webhook. So `lib/crew/sync.ts reconcileCrewParties()` runs every cron tick, and also from Allie's "Sync now" button.

**What it reads:**

| | Rule |
|---|---|
| Scope | Bookings with `party_date >= today` (ET) |
| Trigger | `bookingStage() === 'booked'`, and an eligible type: `in_studio_theme` (including Sleep Under and minis), `mobile_party`, or `studio_rental` **only when a Party Helper line item exists** |
| Party window | `partyWindow()`. For a studio rental, the **Party Helper's own time**, parsed from the helper line item's name, then its description ("Party Helper 1–5 PM …"); the end must carry AM/PM. No stated time = "needs a time", never the whole rental (Adam, 2026-10-27). |
| Theme | The existing fallback order |
| Location | `mobileAddressOf()` for mobile parties, otherwise `STUDIO_ADDRESS_LINE`. **Never "Suite 7".** |

**What it does:**

| Situation | Result |
|---|---|
| No usable time | No crew party. The booking is flagged "needs a time" in the admin view. |
| New party | Created as a **draft**, with `slotsForParty` spots: exactly one `lead` and the rest `crew`. |
| Booking cancelled or lost | The crew party is `cancelled`, the crew are notified, and there are no step changes. |
| Guest count changed | Spots are **added, never removed**. Over-staffing is flagged in `sync_flags`. |

Allie can also create crew parties by hand (`booking_id` null).

**The Party Helper add-on, as found in live data on 2026-10-26:**
- It appears **only as a hand-typed line item**: category `service-add-on`, `pricing_item_id` NULL, name beginning "Party Helper" (e.g. "Party Helper 1–5 PM + Full Clean-up & Garbage Disposal", quantity 1, $250). One such row exists, on one upcoming studio rental.
- The catalogue holds two items, "Party Helper" and "Party Helper (per hour)", both $30. **No line item references either.**

**v1 match rule:**
- A studio-rental line item that is not `is_optional`, and either references one of those two `pricing_items`, or has category `service-add-on` and a name starting `Party Helper` (case-insensitive).
- **Spots = sum of quantity**, except for the per-hour item. For that one, quantity is hours, so it counts as **one helper** (Adam, 2026-10-26).
- **Every rental spot is a crew spot**: a Lead or a helper may take it, there is no Lead spot, and no "no Lead" alert (Adam, 2026-10-27).

## 10. Environment

| Var | Meaning |
|---|---|
| `CREW_ENABLED` | **Off unless exactly `true`.** Off: `/crew` 404s, crew login refuses, the cron skips (except the reconcile), nothing is sent. Mapped in `docker-compose.yml` with default `false`. |
| `CREW_SMS_ENABLED` | Off unless exactly `true`. Quo SMS to opted-in crew. |
| `CREW_ADMIN_EMAIL` | Optional. Admin alert address; falls back to `ownerEmail()`. |

`CREW_CRON_SECRET` and `CREW_APP_URL` from v1 are dropped. The cron uses `CRON_SECRET` via `isCronAuthorized`, and links use `CANONICAL_ORIGIN` / `publicOrigin(req)`.

## 11. Still needs Adam (non-blocking, before launch)

1. A contractor agreement and W-9, reviewed with Christine Parisi.
2. **The roster** for about 10 people (name, email, phone, starting step, `can_lead`). **Adam enters it in the admin form** once Phase 3 ships. **No roster file is ever committed.**

Resolved 2026-10-26 (Adam): crew start $51 (§3.1, migration 078); +2 applied when the cover is worked (§3.2); the per-hour Party Helper item counts as one helper (§9); standby window 2 h; the Quo A2P registration covers staff texts; **the careers page wording stays as it is** — nothing in this build changes `/join-the-team`.

## 12. Corrections from v1 (platform)

| v1 assumed | v1.1 |
|---|---|
| A staging environment | None. `staging.` is the same container and DB. Everything sits behind `CREW_ENABLED=false`. |
| Supabase Auth magic link, `auth_user_id` | 6-digit email code and a signed `hh_crew` cookie. |
| `supabase/migrations/…` | `starting_plan/migration_077_crew_scheduling.sql`, applied with `/root/pg.sh` on the box. BEGIN/COMMIT, re-runnable. |
| Vitest | Jest, in `src/__tests__/lib/crew/`. Playwright for e2e. |
| `POST /api/crew/cron`, `CREW_CRON_SECRET`, a cron container | `GET /api/cron/crew`, `isCronAuthorized`, a `jobs.tsv` row. |
| Twilio | Quo. Twilio's webhook points at another project. |
| A hook on the booking confirmation path | A reconcile every cron tick (§9). |
| `roster.json` seed script | The admin form, plus "Add to crew" from applications. No PII near the repo. |
| "Suite 7" default location | `STUDIO_ADDRESS_LINE`. |
| Server actions | Route handlers: `/api/crew/*` (`requireCrewMember` + `guardRate`) and `/api/admin/crew/*` (`isAdminAuthorized`). |
| `email` unique on the raw value | A generated `email_key = lower(btrim(email))` that is unique. Lookups go through `findCrewMembersByEmail` in `lib/contactLookup.ts` (`contactIdentitySurface` R1). |
| `HostHampton_ClaudeCode_TODO.md` | `SESSION_LOG.md`, plus AGENTS.md §7/§8/§11. |
| Tiers, points, early access, waves, anchor approval | Removed (§3). |

## 13. Acceptance (feature-level)

- Two members claiming the same spot at once: exactly one wins.
- A non-`can_lead` member is refused the Lead spot **by the database**.
- Allie as Lead counts toward crew needed and is unpaid.
- A late cancel texts only the standbys. A standby's claim leaves the person cancelling unchanged. With no claim, Allie gets the alert.
- Drop anyway resets to step 0; an early release costs 1 step. During grace, both are recorded and not applied.
- Attendance: step 3 crew is paid $58.50, step 3 Lead $77.50. A $12 tip records an $8 top-up, and steps go to 4.
- No crew-facing response ever includes another member's phone, email, pay, tips, steps, notes, or reason.
- Running the cron twice sends nothing twice.
- With SMS disabled, every flow still works through in-app and email.
