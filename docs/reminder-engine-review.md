# Phase 3B's reminder engine — review, and the five months it never ran

**Link 10 of the build chain. 2026-09-12. Migration 044. Suite 1573 → 1646 green.**

Scope: `/api/cron/send-reminders`, `/api/cron/event-reminders`,
`/api/cron/birthday-rebooking`, `lib/reminders.ts`, and the two modules they
pull in (`lib/checkinReminders.ts`, `lib/checkinLink.ts`). Phase 4 rewrote the
*sequencer* and left these alone.

---

## 1. The measurement, before anything else

Rule 17 says a log is a window and a count over a window is not a statement
about history — so the first question was not "how many times did these routes
run" but "what does the table that would hold the evidence say".

**`scheduled_reminders` held ZERO rows. Not one, ever.** No `created_at`, no
`sent_at`, nothing — in a database with 1219 contacts, 60 bookings, 109 form
submissions and 94 event tickets, five months after the phase shipped.

The nginx window agreed for once, and for the wrong reason. Filtering
`docker logs hampton_nginx` (02/Sep–12/Sep) by route **and** status gives zero
hits on all three routes. The 16 hits on `/api/cron/reminders` are
`?key=elm-cron-…` — a different business on the same nginx, hitting a route
this repo does not have.

But the database knew something the log could not: `marketing_ledger` holds
**exactly one** `entity_type='reminder'` note, from **2026-08-17**, saying
`birthday_rebooking` scanned 0 bookings in the window `2025-10-17 … 2025-12-17`.
So birthday-rebooking *has* run in production, once, outside the log window —
and found nothing, because no booking was old enough. It still isn't: there are
**0 bookings in the 8–10-month window today**.

---

## 2. Why the queue was empty — two SQLSTATEs, thrown away every time

The table refused every insert the code made, and not one writer read the error.

### 2.1 `reference_id` was `uuid`; four of the five enqueuers write a booking_ref

```
INSERT … reference_id = 'HH-2026-0976'
→ 22P02  invalid input syntax for type uuid: "HH-2026-0976"
```

Proven in production against the live table before changing anything.

`enqueueBookingReminders`, `enqueuePartyReminders`, `enqueueReviewRequest` (for
bookings) and `enqueueCheckinReminders` all write a booking_ref. Three of them
did `await supabase.from('scheduled_reminders').insert(rows)` without reading
`.error` at all; the fourth logged it into a stream nobody reads.

`lib/checkinReminders.ts` carried this comment:

> Both are `channel: 'sms'`, `reference_type: 'booking'`, and keyed by
> `reference_id = booking_ref` (what the cron looks bookings up by).

That is **hard-won rule 13 in its purest form** — a constraint asserted in a
comment and contradicted by the schema. `cancelCheckinReminders` was broken the
same way: `.eq('reference_id', bookingRef)` against a uuid column is a 22P02 at
*query* time, so the "cancel the old rows before rescheduling" step never
cancelled anything either. `checkin_tokens` holds **zero rows** in production,
which is the downstream proof: not one pre-arrival check-in link has ever been
texted on a schedule.

### 2.2 `reference_type` CHECK allowed `('event_ticket','booking')`; the code writes `'event'`

```
INSERT … reference_type = 'event'
→ 23514  violates check constraint "scheduled_reminders_reference_type_check"
```

`'event_ticket'` has no writer anywhere in the app and zero rows. The sender
branches on `reference_type === 'event'`. So the event side was dead twice over.

### 2.3 Why a green suite agreed with all of it

```js
c.insert = jest.fn((rows) => Promise.resolve({ error: null }))
```

The mock accepted anything. It modelled no column type, no CHECK, no unique
index and no collation, so it could not possibly disagree with the code. **Rule
8's third form: a test that passes is not behaviour the database agrees with.**

**What this cost, concretely.** 18 real upcoming bookings, and every booking for
five months, got: no 7-day reminder, no day-before reminder, no T-2/T-1 balance
chase, no day-of unpaid-balance alert to Adam, no thank-you, no review request,
and no pre-arrival check-in text.

---

## 3. The sender had no claim, and lied about what it had done

### 3.1 No claim (read → send → mark)

`send-reminders` selected 50 pending rows, sent each one, then wrote
`status: 'sent'`. Two overlapping ticks both read the same rows and both sent.
A cron redelivery re-sent everything. There is no way to un-send an SMS.

Fixed with the same discipline Phase 4 needed for `email_sequence_sends`: an
atomic `UPDATE … SET status='sending' WHERE id = ? AND status = 'pending'` with
`.select()`, taken **before** the send. Zero rows back means another tick won.

A row left in `'sending'` by a crashed tick is not retried — under-sending is
the safe direction — but it is *visible* as `'sending'` for a human to find.

### 3.2 `status = 'sent'` was written over sends that never happened

The processors returned `void`, and the caller marked `sent` unconditionally
after they returned. So a reminder was recorded as delivered when:

| situation | what really happened | what the row said |
|---|---|---|
| `RESEND_API_KEY` unset | `processEmailReminder` returned on line 1 | `sent` |
| Resend rejected the message | the SDK resolves `{data, error}`, it does not throw; the return value was discarded | `sent` |
| `sendSMSVia` returned `null` | provider rejected; return value discarded | `sent` |
| `sendCheckinLinkSms` returned `{sent:false}` | `console.warn` only | `sent` |
| booking/event row could not be read | `.single()` error swallowed → treated as "not found" | `sent` |
| reminder type matched no branch | `subject`/`html` stayed empty | `sent` |

That is **the expensive half of rule 10** — the same shape as the unsubscribe
endpoint answering 200 over a write that never happened (§11.1 of the Phase 4
doc), on the surface where being wrong means a customer never hears from us
about a party they have paid for.

Every path now ends at `finishReminder` with a named outcome — `delivered`,
`skipped`, `retry`, `failed` — written to `last_outcome` / `last_error`, with a
bounded retry budget (`attempts`, `MAX_ATTEMPTS = 4`) so a transient failure is
not terminal (rule 3).

### 3.3 Consent was never re-read at send time for email

The join asked for `contacts(email, phone, first_name, sms_opt_in)` — **no
`email_opt_in`, no `status`**. SMS had a send-time check; email had none.

`birthday_rebook_email` is, by its own route's doc comment, *promotional*. It is
enqueued today and delivered tomorrow at 10am, and `email_opt_in` was checked
only at enqueue. Somebody who unsubscribed overnight got the marketing email
anyway. `contacts.status = 'unsubscribed'` — the label link 9 established is
read by the opt-out check — was never consulted at all.

Marketing vs transactional is now **one exported set** in `lib/reminderQueue.ts`
(rule 11), read at send time. Transactional reminders deliberately do *not* gate
on marketing consent: a party that is booked and deposited is not a
solicitation, and gating on a box most customers never tick would silently
disable the feature for them. Both directions are exercised in production in §6.

---

## 4. `event-reminders` was the only route that worked, and it was the dangerous one

It bypassed `scheduled_reminders` entirely and texted from `event_tickets`
directly. Three things followed:

1. **It never looked at consent.** It joined nothing to `contacts`, so
   `sms_opt_in` was never read and neither was a STOP. Measured: **93 confirmed
   ticket holders have a phone number and 85 are opted in** — eight real people
   were in line for a text they never agreed to.
2. **It had no cross-run idempotency.** Nothing recorded that a reminder had
   gone out. It deduped by phone *within* one run and not at all *between* runs.
   A redelivery, a retry or two ticks texted everybody again.
3. **It duplicated the queue.** `enqueueEventReminders` already schedules an
   `event_sms_1day` at ticket purchase. The moment the queue started working,
   the same person would have had two texts the day before every event, from two
   code paths (rule 11).

It now **enqueues instead of sending**. The queue already has the consent
re-check, the claim, the retry budget and the audit trail; the answer to "this
sender has none of those" is to use the one that does, not to build a second.
`uniq_scheduled_reminder_once` makes the overlap with the purchase-time enqueue
a no-op rather than a duplicate text, and it keeps its safety-net role for
tickets bought before the buyer had a contact row or before they opted in.

**It also computed the wrong day.** `new Date(); setDate(+1);
toISOString().split('T')[0]` is a UTC date on a UTC box, so it rolls over at 8pm
Eastern — an evening run looked at the day *after* tomorrow. Now
`etDateString()` in `lib/partyTime.ts`, beside its counterpart `etToUtc`.

---

## 5. The rest

**`.eq('email', …)` in seven places** — `lib/reminders.ts` ×5,
`lib/checkinReminders.ts` ×1, `birthday-rebooking` ×1. Case-sensitive against a
raw `text` column, exactly the §11.1 defect: for the **21 of 1219 contacts whose
stored address carries capitals**, every one of these took the "no such contact"
branch and no reminder was ever enqueued. All now go through
`findContactsByEmail`.

**Eight lookups collapsed "could not read" into "not found" (rule 12).** Each
destructured only `data`; `.single()` returns an *error* on zero rows, so a
Supabase blip and a genuine absence produced identical silence, and the
reminders were dropped with no retry. Notably, a failed contacts read in
`enqueueCheckinReminders` would previously have fallen through to
`cancelCheckinReminders` — disarming a customer's existing pre-arrival texts
because of a timeout. Pinned by a test.

**`birthday-rebooking` nudged cancelled parties.** No `status` filter, so every
cancelled booking in the window — including the eight `HH-TEST-PAY*` throwaway
rows — was a candidate for "another birthday is coming up!". Now excluded.

**The SMS budget was charged 1 for a 3-segment message.** `smsBirthdayRebook`
contains a 🎉. One character outside GSM-03.38 flips the whole body to UCS-2 and
drops the per-segment limit from 153 to 67, so a 140-unit message is **three**
texts. `checkSmsBudget(supabase, 1)` / `recordSmsSent({count: 1})` understated
the monthly marketing cap by 3× on the only template that has an emoji.
`lib/smsSegments.ts` already did the carrier's arithmetic — the budget just
wasn't asking it (rule 11). Now `smsCost()`.

**One em dash was costing every check-in text two extra segments.** Measured:

| body | encoding | units | segments |
|---|---|---|---|
| check-in link, with `—` | UCS-2 | 224 | **4** |
| check-in link, with `:` | GSM-7 | 224 | **2** |

The separator is a colon now, and `reminderTemplates.test.ts` asserts the body
stays GSM-7 so it cannot drift back. (The birthday 🎉 stays — that is voice, and
Adam and Allie's call. What is fixed is the budget being told the truth about
it. Noted for the record: the live event title `Bitchy Bingo 🎃` makes *its*
reminder 2 segments — data, not template, and nothing to fix.)

**Reminder templates interpolated customer-written data into HTML raw.**
`customerName`, `childName`, `partyTime`, `packageName`, and admin-written
`eventTitle` / `location`. Most of these emails go to the person who typed the
value, so the blast radius is their own inbox — but `partyAdminUnpaidDayOfHtml`
renders customer-written name and phone into **Adam's** inbox, which does cross
a trust boundary. The six reminder templates are escaped. **`lib/emailTemplates.ts`
has ~25 other templates with the same pattern and zero `escapeHtml` — that is a
pre-existing gap recorded here, not rewritten in a cron review, because they are
live revenue-path emails.**

**`marketing_ledger.entity_id` is `uuid`.** Once `reference_id` became `text`,
passing a booking_ref to `writeLedger` would have been a 22P02 that `writeLedger`
**logs and swallows** — an audit row that silently never lands. Guarded by
`asLedgerEntityId()`, with the raw value kept in `meta`. This one was a bug I was
about to introduce, caught by reading the column type rather than assuming it.

---

## 6. Driven against production

Deployed at `65b7178`; image id on the box matches the built image. The queue
was empty and `send-reminders` is not scheduled, so **no real customer row was
ever in the scan** — proven by reading the scan before firing anything:

```
 reminder_type         | reference_id                         | scheduled_for
 event_email_3day      | d3c283f4-…(the live Squishy event)   | 2000-01-01
 birthday_rebook_email | HH-PROBE-NONE                        | 2000-01-02
 booking_email_7day    | HH-PROBE-NONE                        | 2000-01-03
 event_sms_1day        | d3c283f4-…                           | 2000-01-04

 real_rows_that_would_be_read: 0
```

The probe contact was created with a **mixed-case** address
(`Adam+ReminderProbe@EasternBuilding.supply`) and both opt-ins `false`.

### The reminder engine delivered its first email in production, ever

```
GET /api/cron/send-reminders?limit=1
→ {"due":1,"delivered":1,…}

event_email_3day | sent | attempts 1 | resend:140c6b60-894e-44fe-bef8-ac6577fb6f29 | sent_at set
```

`?limit=1` took exactly the oldest row and left the other three `pending`.

### Every guardrail fired, and every one named its reason

| fire | outcome | `last_outcome` |
|---|---|---|
| `birthday_rebook_email`, marketing, `email_opt_in=false` | `cancelled` | `opted_out: email_opt_in is not true` |
| `booking_email_7day`, transactional, reference does not exist | **`failed`** | `no booking HH-PROBE-NONE` |
| `event_sms_1day`, `sms_opt_in=false` | `cancelled` | `opted_out: sms_opt_in is not true` |

The middle row is the point: the old code would have written **`sent`**. And it
got as far as the booking lookup *despite the contact being opted out of email* —
which is the marketing/transactional distinction working, not an accident.

### …and a transactional email to an opted-out contact still went out

`event_email_dayof` to the same `email_opt_in = false` contact: **delivered**,
`resend:089b1250-…`. Both directions, on the same row.

### Five concurrent ticks, one email

```
tick1  due=1 delivered=0 lost=1      ← read the row, LOST the claim
tick2  due=0 "no reminders due"
tick3  due=0 "no reminders due"
tick4  due=0 "no reminders due"
tick5  due=1 delivered=1             ← won the claim, sent once
```

### `event-reminders`, both directions, on a throwaway event

A probe event dated tomorrow with `available_tickets = 0` (sold out, so nothing
could be bought against it in the ~2 minutes it existed) and one confirmed
ticket whose `customer_email` was written **lowercase** against the mixed-case
contact:

```
opt-in FALSE → {"tickets":1,"queued":0,"notOptedIn":1,"noContact":0}
opt-in TRUE  → {"tickets":1,"queued":1,"alreadyQueued":0}
run again    → {"tickets":1,"queued":0,"alreadyQueued":1}
run again    → {"tickets":1,"queued":0,"alreadyQueued":1}
```

`noContact: 0` proves the case-insensitive lookup matched a lowercase ticket
address to a mixed-case contact. **Three runs, one row** — the old route would
have sent three texts, to somebody who hadn't consented to the first.

### The dedup constraint, and the three idle paths

The same row inserted twice → `23505` from `uniq_scheduled_reminder_once`.
`?limit=0`, `?limit=999`, `?limit=all` → **400**. No secret → **401**. And rule
10 on the idle paths — three different runs, three different answers:

```
send-reminders    {"ok":true,"due":0,"message":"no reminders due","configured":{"resend":true,"sms":true}}
event-reminders   {"ok":true,"message":"no active events tomorrow","date":"2026-09-13","events":0,"queued":0}
birthday-rebooking{"ok":true,"scanned":0,"emailQueued":0,"smsQueued":0,"noContact":0,"lookupFailed":0}
```

### Everything restored

`scheduled_reminders` back to **0**; 1219 contacts (21 still mixed-case, not
bulk-lowercased); 18 events / 3 active; 91 confirmed + 3 refunded tickets; 44
active enrollments; `invoice_number_seq` **118/t**; 60 bookings; 3 social
drafts. Probe event, ticket, contact and reminder rows deleted. Funnel checked
live: `/`, `/book` (52 kB, still `○ Static` at 7.15 kB in the build table),
`/party-planner`, `/studio-rental`, `/events`, `/party-packages` and
`/es/party-room-rental` all 200.

**One thing could not be cleaned up:** `marketing_ledger` is append-only
(migration 021 raises on DELETE), so the `birthday_rebooking` `note` rows my
runs wrote are permanent. They record `scanned: 0` and are harmless, but they
are there.

---

## 7. The probe that found a bug in my own fix

The first version of the birthday scanner could not tell which of its two rows
the unique index had just accepted, so it re-read the table and treated "created
in the last 60 seconds" as "created by this run". A test that ran the route twice
inside one second duly reported *two nudges queued* when the table had not gained
a row — and would have charged the SMS budget twice.

A time window is not a fact. `enqueueReminders` now returns a per-row outcome
(`outcomes[]`, `byType`) straight from the insert, and the re-read is gone.

---

## 8. Tests

`src/__tests__/helpers/fakeReminderDb.ts` — a fake Supabase that models the
**database**: column types (uuid rejecting a booking_ref with 22P02), CHECK
constraints (23514), the partial unique index (23505), `update … where`
returning only the rows it really updated, and — the distinction that hid
§11.1 — `.eq()` being case-**sensitive** while `.ilike()` is not. It is
configurable, so tests can pin the **pre-044 schema refusing the pre-044 rows**.

| file | what it holds |
|---|---|
| `lib/reminderEngine.test.ts` (24) | the two SQLSTATEs, per-row enqueue, the cancelled-row reschedule, 5-way claim race, every `finishReminder` outcome, the marketing list covering all 16 CHECK labels, `asLedgerEntityId`, `smsCost`, ilike's `_` not matching a stranger |
| `api/sendReminders.test.ts` (23) | every "must NOT say sent" case, consent at send time both directions, the claim, `?limit` bounds and ordering |
| `lib/reminderTemplates.test.ts` (10) | STOP language on every SMS, **no template publishes a price**, check-in body stays GSM-7, HTML escaping incl. the owner-facing alert |
| `api/birthdayRebooking.test.ts` (11, rebuilt) | mixed-case contact found, cancelled party excluded, segment budget, a second run charging nothing, rule 12 |
| `lib/checkinReminders.test.ts` (18, rebuilt) | the pre-044 refusal pinned, reschedule, and a failed read leaving an existing schedule alone |

`npx jest` → **1646/1646**. `npx tsc --noEmit` → 0 errors in app code.
`npx next build` → compiled successfully, `/book` unchanged at `○ Static` 7.15 kB.

---

## 9. What bounds these routes — the plain statement the brief asked for

Reminders are the one designed exception to "nothing auto-sends to a customer".
So, exactly:

- **Who.** Only a contact with a row in `scheduled_reminders`. Rows are written
  by exactly four things: a confirmed ticket purchase, a confirmed booking, the
  birthday scanner, and the nightly event sweep. There is no "send to
  everyone" path, and no admin free text or model output can create one.
- **What.** Only the 16 `reminder_type` values in the table's CHECK constraint,
  each rendering a fixed template with merge fields. `reminderTemplates.test.ts`
  asserts none of them publishes a price and all of them carry STOP language.
- **How often.** Once. `uniq_scheduled_reminder_once` makes
  (contact, type, reference) unique; the claim makes a second concurrent tick
  lose rather than duplicate.
- **Consent.** Re-read at send time. Marketing needs `email_opt_in = true` and
  `status <> 'unsubscribed'`, or `sms_opt_in = true`. Transactional SMS needs
  `sms_opt_in`, except the check-in link, which is gated on an explicit STOP
  (`hasExplicitSmsOptOut`, which fails **closed**).
- **Volume.** 50 rows per tick, oldest first, `?limit=1..50` for a bounded
  manual run. Marketing SMS additionally passes `marketing_budget`'s monthly cap,
  now charged in segments.
- **And the largest bound of all, today:** *none of these three routes is
  scheduled at cron-job.org.* Nothing fires until Adam adds them. See §10.

---

## 10. Needs Adam

1. **Schedule the three cron jobs.** They have never been scheduled and the
   engine does nothing without them. Suggested:
   `/api/cron/send-reminders` every 15 min; `/api/cron/event-reminders` daily
   ~09:00 ET; `/api/cron/birthday-rebooking` weekly. Requires the cron-job.org
   account. **Note the ordering dependency: `event-reminders` now enqueues, so
   `send-reminders` must be scheduled too or event reminders never go out.**
   Also note two existing jobs (`draft-newsletter`, `booking-locks`) hold a
   stale `CRON_SECRET` and 401 daily — same login, same visit.
2. **The backlog question, and it is the same shape as the sequencer's.**
   Turning `send-reminders` on does *not* retroactively mail anybody: the queue
   is empty and reminders are only enqueued going forward, with every send time
   in the past filtered out at enqueue. But **18 real upcoming bookings** have
   had no reminders scheduled at all, because the enqueue happened (and failed)
   when the booking was made. Whether to backfill their reminders — which would
   mail and text real customers about parties that are days away — is a business
   call, not a technical one. The code is ready; the decision is Adam's.
3. **The Twilio inbound webhook still points at another project** (carried
   forward, PLAN.md needs-Adam 11). Until it is repointed, a customer's STOP is
   honoured by Twilio at the carrier level but never reaches our `contacts`
   table. What that costs the reminder engine, specifically: for **marketing**
   SMS nothing, because `sms_opt_in` must be explicitly `true` and a STOP that
   never lands simply leaves it true — so we keep *queueing* birthday nudges
   Twilio then silently drops, burning budget on undelivered messages. For the
   **transactional** check-in text it is worse: `hasExplicitSmsOptOut` reads
   `sms_opt_in_at` and a `contact_interactions` row of type `sms_unsubscribed`,
   and the STOP handler that writes both is on the webhook that points
   elsewhere. Measured today: **0 contacts have `sms_opt_in = false` with an
   `sms_opt_in_at` set, and 0 `sms_unsubscribed` interactions exist.** So the
   guardrail is correct and has simply never had an input. Nothing to change on
   our side short of repointing the number.
4. **`lib/emailTemplates.ts` has ~25 templates interpolating customer-written
   data into HTML with no escaping.** Six are fixed here. The rest are live
   revenue-path emails and worth a dedicated pass.

---

## 11. Not touched

Mobile pricing (rate card, `MobilePriceBlock`, planner bands,
`pricingCatalog.ts`). The 21 mixed-case addresses — matched case-insensitively,
**not** bulk-lowercased, which would risk a `contacts_email_key` collision and
would do nothing about the 22nd address somebody types tomorrow. The 44 active
enrollments, the 103 draft campaigns, the Brevo list, the three `draft`
`social_posts`, the real open customer drafts, the `HH-TEST-PAY*` plans, the
`agent_learnings` proposals and voice profile v2, the four `pending_review` town
drafts, the four dead English drafts. `process-sequences` was not run.
No Stripe object was created and no charge of any kind was made.
