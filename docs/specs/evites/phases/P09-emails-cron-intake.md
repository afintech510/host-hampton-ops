# P09 — Emails, sends ledger, suppression, `evite-sends` cron, retention, intake wiring

**Branch:** `feat/evites`. **Spec:** §2.1, §9 (all), §12. HANDOFF D16, D17, D18, §4.

This is the biggest phase. The orchestrator may split it into **P09a** (mail, sends, suppression, templates, inline sends) and **P09b** (the cron, retention, intake wiring).

## Read first
- `app/api/cron/send-reminders/route.ts` and `lib/reminderQueue.ts` (claim, finish, outcomes).
- `lib/cronAuth.ts`, `lib/scheduleFreshness.ts`, `lib/partyTime.ts`.
- `lib/emailSafety.ts`, `lib/email-templates/reminders.ts` (house style, signed as Allie), `lib/unsubscribeLink.ts`, `lib/portalLinkMint.ts`.
- `lib/contactLookup.ts` (`findContactsByEmail` outcomes: `found` / `absent` / `unavailable`).
- `cronSurface.test.ts`, `outboundSendSurface.test.ts`, `emailTemplateEscaping.test.ts`.
- `lib/plan.ts` L16–26 (ordering), and the IntakeRecord rule in AGENTS.md.

## Tasks
1. **`lib/evites/mail.ts`:** `sendEviteEmail`. One Resend call; reads `{data, error}`; supports `attachments` and `headers` (`List-Unsubscribe`).
2. **`lib/evites/sends.ts`:** `claimSend`, `reclaimFailed`, `finishSend` per spec. `finishSend` is the only writer of `status`.
3. **`lib/evites/suppression.ts`:** `emailSuppressed` per §9.2 (interactions `email_unsubscribed`, and `email_bounced` with `bounce_type = 'hard'`).
4. **`lib/email-templates/evites.ts`:** `lead_preview`, `invite_ready`, `new_rsvp`, `rsvp_changed`, `rsvp_confirmed`, `week_before`, `day_before`, `details_changed`, `final_headcount`, `party_cancelled`.
   - Each has HTML and text versions. `escapeFields` comes first; URLs go through `mailHref`.
   - Explicit dates ("Saturday, Nov 14"), never just "tomorrow". Signed "Allie & the Host Hampton team".
   - The day-before note comes from a constant `STUDIO_ARRIVAL_NOTE` in `lib/studioLocation.ts`, worded `TODO(Adam)` and not shipped live until worded.
   - Register the file in `emailTemplateEscaping.test.ts`.
5. **Inline sends:** fill in P06's hooks. `onRsvpCreated` → `new_rsvp` + `rsvp_confirmed`; `onRsvpChanged` → `rsvp_changed`. Fire-and-forget with `.catch(log)`, claimed. Guest `.ics` sends set `cal_version_seen`. P08's `notify_cancelled` → `party_cancelled`.
6. **`app/api/cron/evite-sends/route.ts`:** steps 1–9 of §9.3, exactly. Every send type follows the §9.1 table: due time, sendable-until, ref_version, skip rules. Per-tick bounds. Counts-only response. Gated by `eviteSendsMode()` (steps 4–9) and `evitePagesMode()` (steps 1–3).
7. **Retention** (§12) as cron step 8.
8. **Intake wiring** (§2.1): call `ensureEviteForBooking`, then `queueRender` on `created`, in each listed route. **Non-fatal**: wrap so a failure is logged and never changes the response. Place it after the booking write and `recordInboundEvent`.
   Plus the intake fixes:
   - `quote/save` writes `child_name` (from `quoteData.childName`, screened by `boundedIntakeText`)
   - optional `childName` on `/api/lead` and `/api/mobile-party-inquiry` (server side, screened; add the field to the forms that post there)
9. **Surface suites:** register `evite-sends` in `cronSurface` (known jobs) and in `outboundSendSurface` (`SEND_ROUTES`, the module list, `ALL.length`).

## Tests
- **Cron timeline:** a fixture party on a Saturday in November with a fake clock stepping every 15 minutes across 16 days. Assert:
  - each guest gets `week_before` and `day_before` exactly once, the parent gets `invite_ready` once and `final_headcount` once, after all `day_before`s
  - a No RSVP gets nothing; an RSVP changed to No before the week-before gets nothing after
  - an RSVP created after the week-before due time gets no `week_before`
  - moving the date after `day_before` re-sends `day_before` at the new `cal_version` and sends one `details_changed`
  - a late RSVP created after the change gets no `details_changed`
  - day-before is never sent on the party day
  - a cancelled party sends `party_cancelled` once, after the 30-minute grace
  - a failed send retries up to 4 times; a stuck `sending` is reclaimed
  - flags off → nothing
- **lead_preview:** sent only for an intake-created evite, within the window and hours; suppressed when unsubscribed or hard-bounced; `unavailable` → deferred; the reserve button is omitted when the mint fails.
- **Retention:** day +7 purges allergies; +30 purges non-club contacts and archives; a dead lead at +60 is archived.
- **Intake:** each route still returns its old status when `ensure` throws or fails.
- **Escaping:** the templates suite passes; the text versions are unescaped.

## Acceptance checks
- [ ] Jest is green, including `cronSurface`, `outboundSendSurface`, `emailTemplateEscaping`, `publicIntakeSurface`, `attributionSurface` and `contactIdentitySurface`. `tsc` is clean. `next build` passes.
