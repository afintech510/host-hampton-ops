# Inquiry → Draft Response — Phase 0 (schema, config, classifier)

Phase 0 lays the foundation with **no send code and no LLM calls** — just the
data model, config, and the pure decision logic that later phases build on.
See `docs/inquiry-response-flow.md` for the full flow and
`docs/inquiry-response-workflow.md` for the source business rules.

## What shipped in Phase 0

| Artifact | Path | Purpose |
|---|---|---|
| Migration | `starting_plan/migration_028_inquiry_drafts.sql` | The `inquiry_drafts` table + status state machine. **Apply manually** in the Supabase SQL editor (repo convention). |
| Classifier + gate | `services/website/src/lib/inquiryDrafts.ts` | Pure logic: party-type classification and the required-info gate (quote vs. info-gather). No DB/LLM/send. |
| Tests | `services/website/src/__tests__/lib/inquiryDrafts.test.ts` | 24 unit tests covering classification, gating, and edge cases. |

## Trigger (confirmed)

New inbound inquiries are rows in **`bookings`** with **`status = 'pending_review'`**,
created by `POST /api/checkout` for deposit-required party requests. Free
bookings insert as `confirmed` and are out of scope. The Phase 1 cron will poll
for `pending_review` bookings that have no live `inquiry_drafts` row yet.

## Config to add before Phase 2 (the send/loop phase)

`ALLIE_PHONE` — Allie's mobile number in E.164 (e.g. `+16315550123`). Set it in
the box `.env` / `services/website/.env.local` (not committed). It is the number
the review SMS is sent to, and the number `/api/webhooks/quo` matches inbound
replies against to tell Allie apart from customers. **Not needed for Phase 0/1.**

Existing env already in place and reused (no new setup): `CRON_SECRET`,
`RESEND_API_KEY` / `RESEND_FROM_EMAIL`, `QUO_API_KEY` / `QUO_PHONE_NUMBER`,
`ADMIN_PASSWORD` (pay-link), `STRIPE_SECRET_KEY`.

## Known gaps surfaced during Phase 0 (decide before Phase 1/2)

1. **Mobile Party rarely enters `bookings` via a form.** `/mobile-party` is
   "Get a Custom Quote" — it has no dedicated `booking_type` and every Mobile
   session in the workflow doc started from Adam pasting details, not a form
   submission. So the `pending_review` trigger reliably fires for **Studio
   Rental** and **In-Studio Theme** only. Decision needed: does Mobile need its
   own intake path (a form that inserts a `pending_review` booking), or does the
   agent also accept a manual "draft for this inquiry" kickoff?
2. **`event_type` is inconsistent** — sometimes a slug (`studio-rental`),
   sometimes a label (`Kids Birthday Party`). The classifier is keyword-tolerant
   and falls back to `unknown` → **human review, never auto-quote**.
3. **No dedicated `rental_duration` column.** `hasStudioDuration()` is
   best-effort (reads `party_tags` or parses `party_time`). If Studio Rental
   duration should be a first-class field, add it to the booking form + schema.
4. **Venue address** for Mobile isn't a column either; `hasVenueAddress()` reads
   `party_tags`. Ties into gap #1.

## The state machine (enforced by the schema)

```
drafted → sent_for_review ⇄ revision_requested → approved → sent
                                                          ↘ (cancelled)
```

The **only** path to the customer is `approved → sent`, and nothing advances
past `sent_for_review` without Allie's explicit approval phrase. A partial
unique index (`uq_inquiry_drafts_active_booking`) allows just one live draft per
booking while keeping `sent`/`cancelled` history.

## Next: Phase 1 — superseded by `docs/booking-agent-plan.md` (2026-09-10)

The original Phase 1 (cron polls `pending_review` bookings → draft → text
Allie) is still step 5 of the new Phase 1, but the scope is now the full
booking agent: website forms, Gmail, and Quo SMS all become `ingested_messages`
events handled by one dispatcher, every lead becomes a Party Plan, and the
planner ends on a DB-rendered invoice page with embedded payment. Follow the
new document from here; this file stays as the Phase 0 record.
