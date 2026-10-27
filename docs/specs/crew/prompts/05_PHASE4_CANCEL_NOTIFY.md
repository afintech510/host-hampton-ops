# Phase 4 — Notifications, confirmations, cancelling, standbys, cron, Quo inbound

**Read first:** spec §3.7, §6, §7, `templates.ts`, AGENTS.md (the outbound send path and inbound message surface lessons).

## 1. `lib/crew/notify.ts`

- **`notifyMember(member, template, rendered, dedupeKey)`:**
  1. Return without doing anything for the owner row.
  2. Insert one `crew_notifications` row per channel. A conflict on `(dedupe_key, channel)` means **skip**.
  3. `in_app` is always written.
  4. `email` goes through `lib/crew/mail.ts`, a typed Resend helper modelled on `lib/evites/mail.ts`, when `email_opt_in`. Templates use `escapeFields` + `mailHref` and are registered in `emailTemplateEscaping.test.ts`.
  5. `sms` goes through `sendSMSViaQuo`, only if `CREW_SMS_ENABLED === 'true'` and `sms_opt_in`; otherwise the row is `skipped` with a reason.
     - `checkSmsQuietHours` defers to the next 8am, rescheduling the row and **never cancelling** it.
     - Text is made GSM-7 safe and counted in segments.
     - The first SMS to a member carries the disclosure (dedupe `sms_disclosure:{member}`).
  6. Record `provider_id` / `error` / `status`.
- **`notifyAdmin(template, {subject,text}, dedupeKey)`:** an email to `CREW_ADMIN_EMAIL || ownerEmail()`, plus an in-app row with `member_id` null.
- **Links** use `CANONICAL_ORIGIN`; labels are in ET ("Sat Oct 31", "1:30–4:30 PM").

## 2. Confirmations

- "I'm in" sets `confirmed_at`. It sends `confirmed` and changes no step.
- **Quo inbound:** a crew branch in `/api/webhooks/quo`, placed **after** `verifyQuoSignature` and the rate limit, and **before** keyword routing and contact lookup.
  - **Matching the sender:** match `crew_members.phone` by `normalizePhoneKey`, ignoring the owner and removed members.
  - **`Y` / `YES`:** confirms the sender's earliest assigned, unconfirmed slot whose `requestAt` has passed. Otherwise the reply is "Nothing to confirm right now."
  - **YES is also a START keyword, so the crew branch must return before keyword routing.**
  - **`STOP` family:** sets crew `sms_opt_in=false` **and** calls `recordSmsOptOut`, because a STOP is about the number.
  - **`HELP`:** replies `smsHelp`.
  - **A crew phone never creates a `contacts` row**, and never reaches the booking agent's `recordInboundEvent`.
  - Update `inboundSurface.test.ts`.
- **A2P:** Adam confirmed 2026-10-26 that the Quo registration covers staff texts, so SMS ships in this phase (still behind `CREW_SMS_ENABLED` and each member's `sms_opt_in`).

## 3. "Can't make it" (`/crew/parties/[id]/cant-make-it`, `POST /api/crew/slots/[id]/release`)

- **Early release (≥ 7 days):**
  - `crew_release_slot(kind:'early_release')` with `stepAfter('early_release')` (waived in grace);
  - the spot reopens;
  - Allie gets `spotReleased`.
- **Late cancel (< 7 days):**
  - `crew_release_slot(kind:'late_cancel')` opens the request;
  - text **every live standby** on the party that passes availability/overlap and, for a Lead spot, `can_lead`, with dedupe `cover:{swap}:{member}`;
  - Allie gets `coverRequested`, with the reason.
- **Status view:**
  - who was asked (a count, no names), and time left before it escalates;
  - **Withdraw** (→ `cancelled`);
  - **Drop anyway**, behind a dialog in dollars ("you'll go back to $51 a party"), through `crew_drop_uncovered` with `stepAfter('late_cancel_uncovered')`.
- **Claiming** (`/crew/cover/[id]`):
  - re-check eligibility, then `crew_claim_swap`;
  - on `claimed`: `coveredRequester` + `coverClaimed`, and both notified;
  - on `not_standby` / `taken`: "Someone just took it."
- **Allie's escalation actions:**
  - "Offer to everyone free that day" sets `offered_to_all_at` and texts every eligible active member free that day;
  - "Assign" uses `crew_admin_assign`.

## 4. `GET /api/cron/crew`

- **Wiring:**
  - `isCronAuthorized`;
  - always `{ok:…}`;
  - `{ok:true, skipped:'disabled'}` unless `CREW_ENABLED`, **except** that `reconcileCrewParties` always runs.
- **The jobs:** in `lib/crew/jobs.ts`, each returning counts, with an injectable `now` and notifier:
  1. reconcile;
  2. confirmation requests, reminders, the overdue alert, and the day-before reminder;
  3. cover requests: escalate (window passed, or zero standbys), warn at 48 h, expire at start;
  4. the attendance-not-marked alert;
  5. the no-Lead alert;
  6. the availability reminder.
- **Schedule:** `jobs.tsv` row `crew|*/5 * * * *|/api/cron/crew|15|box`, then `sh scripts/cron/install.sh` on the box.
- **Surface tests:**
  - an `outboundSendSurface.test.ts` `SEND_ROUTES` entry, with the `ALL.length` pin bumped;
  - `cronManifest.test.ts` stays green.

## Acceptance (prod, throwaway rows, SMS to Adam's test number only)

- Early release: the spot is freed and −1 is recorded (waived in grace).
- Late cancel: only the standbys are texted. A claim leaves the canceller unchanged. With no claim, Allie is alerted after the window.
- Drop anyway resets to 0, or is recorded-not-applied in grace.
- **The cron run twice sends nothing new** (count `crew_notifications`).
- Quo inbound:
  - a signed `Y` confirms;
  - an unsigned request is a 401;
  - no `contacts` row is created for a crew phone.

Update docs, **STOP**.
