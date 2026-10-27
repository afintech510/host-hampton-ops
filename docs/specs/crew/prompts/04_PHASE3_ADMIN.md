# Phase 3 — Admin: reconcile, schedule, roster, rules

**Read first:** spec §3.4–§3.5, §8 (Admin), §9.

The pages are standalone `/admin/crew/*` pages modelled on `admin/applications/page.tsx`, with its auth and the admin CSS classes. Add a **"Crew"** link to `/admin`'s `manage` group. The APIs live at `/api/admin/crew/*` behind `isAdminAuthorized`, and every write records `adminActorId(req)`. **Admin pages work whether or not `CREW_ENABLED` is on**, so Allie can set up beforehand.

## 1. `lib/crew/sync.ts` — `reconcileCrewParties({ now, supabase })`

- **What it reads, and how:** follow spec §9 exactly: scope, trigger, eligible types, Party Helper match, window, theme, location, and the "needs a time" flag.
- **Idempotency:** guaranteed by `uq_crew_parties_booking`. A conflict on insert means another tick created it, which is fine.
- **Guest-count changes:** add open `crew` spots only. Never remove an assigned spot. Over-staffing goes in `sync_flags`.
- **Cancelled or lost booking:** cancel the party and its open/assigned spots, queue `partyCancelled` to the assigned crew (excluding the owner), and record no step change.
- **Return value:** a summary `{created, updated, cancelled, needsTime:[booking_ref…], flagged}`.
- **Triggers:** "Sync now" runs the same function.

## 2. `/admin/crew`

- **Alerts:**
  - unconfirmed past due;
  - spots released;
  - open, escalated, and 48-hour-unclaimed cover requests;
  - drops;
  - attendance not marked;
  - no Lead within 7 days;
  - `needs_review` members;
  - "needs a time" bookings.
- **Upcoming parties** (6 weeks; filters for all / needs crew / unconfirmed / drafts), with these columns:
  - when, party, kids;
  - staffed x/y, including the Lead;
  - **available**: active, not blocked, no overlap, not on it;
  - crew, as first names with `(Lead)`;
  - status.

## 3. `/admin/crew/parties/[id]`

- Facts and the booking link.
- **Publish:** `status=published`, `published_at=now()`. **Unpublish** only while nobody is assigned.
- **Spots:**
  - assign or unassign through `crew_admin_assign`, **including Allie as Lead**;
  - warn on availability or overlap conflicts;
  - add or remove an open spot;
  - override the count.
- **Party-level fields:** extra pay per person (`extra_flat_cents`), notes for crew, and the standby list.
- **Attendance** is wired in Phase 5.

## 4. `/admin/crew/members`

- **Roster:** name, steps → rate (crew / Lead), `can_lead`, skills, parties worked, late cancels uncovered, no-shows, flags.
- **Add and edit:**
  - name, email, phone (stored E.164 as `+1` + `normalizePhoneKey`), starting step, `can_lead`, skills, opt-ins, notes, status;
  - **step override with a required reason**, through `crew_admin_set_steps`;
  - invite by email, with a code-login link;
  - **"Add to crew" on a hired `job_applications` row**, which pre-fills the form and sets `job_application_id`.
- **The owner row** cannot be removed, paid, or given steps.

## 5. `/admin/crew/rules`

- One section per `crew_settings` key, validated:
  - no negatives;
  - `max_steps` ≤ 8;
  - `min_slots` ≤ `max_slots`;
  - `reminder_hours_before` < `request_hours_before`, and so on.
- **The launch date** is a date picker with "Set to today", plus helper text on the 60-day grace.
- Saves round-trip through `settingsFromRows`.

## 6. `/join-the-team` — no change

Adam, 2026-10-26: **leave the careers-page wording as it is.** This phase does not touch `/join-the-team`, `lib/careers.ts` or its JobPosting.

## Acceptance

- `reconcileCrewParties` against prod creates draft parties for eligible upcoming booked bookings, run twice. **The second run creates 0.**
- Raising a guest count adds a spot; lowering it removes nothing and flags it.
- Allie assigned as Lead counts toward staffed.
- Build, typecheck, tests, and surface suites all pass.

Update docs, **STOP**.
