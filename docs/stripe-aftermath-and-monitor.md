# Money going back out, and the watchman — `/api/webhook` link 21

**2026-09-21.** Started from a one-line request: *"let's setup a webhook to Stripe
so we know when payments are submitted and confirm."*

The webhook already existed. This is what was actually missing.

---

## 1. What was measured first

The endpoint was read from Stripe, not from the docs:

```
GET /v1/webhook_endpoints
  we_1T7ckv02uXWznKaWMiPeXCCf   enabled   livemode
  https://www.hosthampton.com/api/webhook
  enabled_events: checkout.session.completed,
                  checkout.session.async_payment_succeeded,
                  checkout.session.async_payment_failed,
                  payment_intent.succeeded
```

All four events link 16 subscribed are still there, and **it is delivering**.
`docker logs hampton_nginx` over its ten-day window shows **51 × 200** on
`POST /api/webhook`. Every non-200 in the log — 9 × 400, 3 × 500 — is dated
2026-09-12 with a `curl` or `node` user agent: link 16's own forged-signature
probes. **No real Stripe delivery has failed since the fix.**

And the money reconciles exactly. Eleven succeeded PaymentIntents since
2026-09-15, eleven `financial_transactions` rows:

| day | Stripe succeeded | books | rows |
|---|---|---|---|
| 09-15 | $1,100.27 | $1,100.27 | 7 |
| 09-16 | $28.01 | $28.01 | 1 |
| 09-17 | $309.00 | $309.00 | 1 |
| 09-18 | $28.01 | $28.01 | 1 |
| 09-21 | $89.61 | $89.61 | 1 |

That is the same check that found $3,596.50 missing in link 16, and it now comes
back clean. **The payment-confirmation path asked for is built, live and
correct.**

Note on method: `pending_webhooks: 0` on Stripe's event log was NOT taken as
proof of delivery. Stripe sets it to 0 both when an event was delivered and when
it gave up retrying — rule 17's shape exactly. The nginx status codes are the
evidence; the event log is the corroboration.

---

## 2. What was missing: every event in which money goes the other way

`grep` across `/api/webhook/route.ts` and `lib/stripeSettlement.ts` for `refund`,
`dispute` and `payment_failed` returned **nothing**. Every branch the handler had
was a payment arriving. Measured against the live event log over six days, Stripe
was generating events nobody was subscribed to and nothing had code for:

| event | in 6 days | what it meant |
|---|---|---|
| `charge.refunded` | — | a refund reached the books **never** |
| `charge.dispute.created` | — | a chargeback with a ~10-day deadline arrived nowhere |
| `payment_intent.payment_failed` | 2 | a declined card was invisible |
| `charge.failed` | 2 | as above |
| `checkout.session.expired` | 5 | abandoned checkouts (deliberately still not handled — noise) |

The refund hole is not hypothetical: link 18 measured **$312.01** of admin
refunds — 3 tickets and 1 booking — that had reached no ledger row, and a refund
issued from the **Stripe dashboard**, which is how Adam issues them, was recorded
in no table at all. The Financials tab overstates revenue by every dollar ever
sent back.

---

## 3. What was built

**`lib/stripeAftermath.ts`** — the three branches, and the alerting for them.

Two design decisions worth stating:

1. **A reversal is a NEGATIVE ledger row, keyed on the REFUND, not the charge.**
   `financial_transactions.amount_cents` is a plain integer with no CHECK and
   `lib/financialLedger.ts` already documented negatives as the refund
   representation. Keying on the charge would have recorded the first refund and
   silently swallowed every later one, because `charge.refunded` fires on each
   one and carries the *cumulative* `amount_refunded` — the same defect shape as
   the `pb-<ref>-partial` reference link 16 had to change because a customer's
   second partial payment produced the same string as the first.

2. **A dispute moves the books when it CLOSES, not when it opens.** Stripe
   withdraws the funds immediately but returns them if we win. Booking every
   chargeback as a loss would understate revenue by every dispute ever
   successfully contested. `charge.dispute.created` alerts (email **and** SMS —
   it is the only event on this surface with a deadline attached);
   `charge.dispute.closed` records, and only when `status === 'lost'`.

A declined card writes nothing — no money moved — but it is logged either way and
**emails Adam only when the decline carries a `booking_ref`**. An anonymous
ticket decline is routine and mailing about each one trains a human to ignore the
category, which is the failure mode `UNCLAIMED_CATEGORY` was careful to avoid. A
decline against a known booking is a real customer paying a real balance,
believing it went through.

The refund list is **fetched from the API**, not read off the webhook payload: a
payload does not reliably expand `charge.refunds`, and "this charge has no
refunds" must never be a serialisation artefact read as fact. A failed fetch is a
500 so Stripe redelivers (rule 12).

**`lib/stripeReconcile.ts` + `/api/cron/stripe-reconcile`** — the watchman.

Two questions per run:

- **Is the endpoint still subscribed to everything the handler handles?** This is
  the cheap one and it is the one that would have caught link 16's incident in a
  day instead of six months. `EXPECTED_WEBHOOK_EVENTS` is the git half; the live
  endpoint is the other.
- **Is there money at Stripe that is not in the books?** A one-directional
  **total** comparison, not a per-payment match. Measured on the live ledger a
  Stripe reference is one of at least four shapes — `stripe-pb-<ref>-final-<pi>`,
  `stripe-cs_live_…`, `stripe-tk-HH-EVT-10017`, `stripe-tk-CART-1789949196313` —
  and only some carry a Stripe object id, so per-object matching would report
  every ticket row as missing. Amount+date matching was considered and rejected:
  link 18 measured that heuristic and it matched **two** rows for two of the four
  re-typed $99 deposits. *A heuristic that is right by coincidence is not a
  reconciliation.*

The route **writes nothing** — not to Stripe, not to the ledger. A monitor that
repairs what it finds cannot be trusted to report honestly about it. It answers
200 even when it finds a problem, so cron-job.org's own failure count does not
become the thing that is wrong; the `ok` field is the answer.

---

## 4. The bug this session nearly shipped

**Admin refunds already wrote a ledger row.** `lib/adminRefund.ts` →
`recordAdminRefund` writes `source: 'other'`, reference
`admin-refund-ticket-<id>`. Adding a `charge.refunded` branch that writes
`source: 'stripe'`, reference `stripe-refund-<re_id>` would have produced **two
negative rows for one refund** — a double-count in the direction that understates
revenue, and invisible, because both rows look correct on their own.

It was caught by widening R0's detector (§5), not by reading the code.

The fix uses the guarantee the database already provides: **both writers now
produce the same reference.** `stripeRefunder()` returns the `re_…` id it had
been discarding, `refundTicket` and the booking refund route pass it through, and
`recordAdminRefund` keys on it when it is present — so whichever of the two
arrives second is a `(source, reference)` unique-index no-op. A **books-only**
reversal, with no Stripe charge behind it, keeps the old `admin-refund-…`
reference and `source: 'other'`: there is no webhook delivery coming that it
could collide with.

`stripeRefundReference()` has exactly one definition, and R11 enforces that.

---

## 5. The tripwire, and what widening it found

Three rules added to `stripeWebhookSurface.test.ts`, and R0's detector widened.

**R0 was blind to money leaving.** Its three clauses all described money coming
IN (`checkout.sessions.create`, `constructEvent`, `checkout.session.*`), so a file
that only refunds or reads a dispute could join this surface unaudited. It now
also matches `stripe.(refunds|disputes|charges|webhookEndpoints).` and the
aftermath event names.

Widening it immediately caught two things:

- `app/api/cron/stripe-reconcile/route.ts` — **my own new file**, which the
  original detector would have let through.
- **`lib/adminRefund.ts`** — which calls `stripe.refunds.create`, predates this
  session, and **had never been on this list.** A file that moves real money out
  of this business was not under the review that covers money coming in. That is
  what led to §4.

**R10 — the subscription and the branches are one fact.** Every `event.type ===`
in the route must appear in `EXPECTED_WEBHOOK_EVENTS`, and every entry in that
list must have a branch. Both directions, because the list may not promise what
nothing handles. It carries a floor assertion (`>= 8` branches found) because R6b
was once defeated by a regex that matched nothing and compared two empty sets —
*a rule that silently matches nothing is the quietest kind of hole.*

**R11 — a reversal subtracts, and one writer owns its reference.** Scoped to the
`recordLedgerEntry` call sites, **not** to every `amountCents:` in the file: the
first draft matched the type annotations and the `summarizeDispute` object
literal — both legitimately positive — and so failed on correct code. A rule that
fires on the wrong occurrence is the same family as one satisfied by the wrong
occurrence.

Two other staleness walkers also demanded registration and got it:
`outboundSendSurface` (the new cron route sends owner email and SMS, so
`NOT_A_SENDER` would have been a false statement) and `emailTemplateEscaping`
(both new files build markup inline; everything interpolated comes from Stripe —
a billing name, a decline message, a dispute reason — so all of it is escaped).

### Attacking it

Six defects reintroduced one at a time into the real sources, suite run against
each, source restored. **All six go red:**

| mutation | result |
|---|---|
| refund recorded POSITIVE (sign flipped) | 3 failed |
| `disputeWasLost` returns true for a WON dispute | 2 failed |
| admin refund stops sharing the Stripe reference | 4 failed |
| an event type dropped from `EXPECTED_WEBHOOK_EVENTS` | 1 failed |
| refund-list failure 200s instead of 500 | 1 failed |
| anonymous declines start emailing Adam too | 1 failed |

Suite **3,585 → 3,589 green**, 0 app/lib `tsc` errors.

---

## 6. What I could NOT verify

- **No refund, dispute or declined-card branch has been driven in production.**
  They are proved by unit test against `fakeMoneyDb` (which refuses what Postgres
  refuses, including `idx_fin_txn_source_ref`) and by mutation. Driving the
  dispute branch for real sends Adam a chargeback email **and an SMS**, and
  driving `charge.refunded` for real needs a real refund. Link 16's discipline —
  prove idempotency in production *before* subscribing the event — is therefore
  only half-met here, and that is the honest state.
- **No real chargeback has ever occurred on this account**, so the deadline
  arithmetic is exercised by synthetic dispute only.
- **Whether the historical $312.01 of admin refunds should be backfilled.** They
  are in the books under `admin-refund-…` / `source: 'other'` where link 18 put
  them; nothing here moves them.

---

## 7. Needs Adam

**A6 — schedule `/api/cron/stripe-reconcile` at cron-job.org.** The scheduler is
cron-job.org, not the box, and a build session has no login. Daily is right.
Until it is scheduled the monitor exists and never runs — which is exactly the
state `booking-locks` and the three reminder crons are already in, and exactly
the failure mode this whole file is about.

---

## 8. Housekeeping

- **Nothing was written to the production database**, and no Stripe object was
  created, modified or deleted while measuring. Every Stripe call in §1 was a
  `GET`.
- Two pre-existing modified files in the working tree (`mobile-craft-party`,
  `craftParties.ts`) are **not** this session's and were not committed.
