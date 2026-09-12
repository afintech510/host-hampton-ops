# The non-plan `/api/webhook` branches — attack and repair

**Link 16 of the build chain. 2026-09-12.** Worktree `gliding-spark`.
Main was `0bfa98b` at the start; the code landed as `1ed2260`.
**Migration 046 taken — 047 is next.**
Suite **2191 → 2260 green**, 0 app `tsc` errors, `/book` still `○ Static` 7.15 kB
and serving 52,742 bytes in production.

Scope: event tickets, the multi-session bundle, the cart, gift cards, the vendor
registration, the party builder and the legacy party-booking tail — every branch
of the single Stripe webhook this business has, except the plan pay-link path the
Phase 5 review already covered.

---

## 1. What was measured first

The brief said these branches are live, not dead, and that is right. Every one of
them has really run:

| branch | financial rows it wrote | first | last |
|---|---|---|---|
| `event_ticket` | 56 | 2026-03-05 | 2026-09-10 |
| `cart_checkout` | 11 | 2026-04-02 | 2026-09-05 |
| legacy party tail | 10 | 2026-03-23 | 2026-08-20 |
| `event_ticket_multi` | 10 | 2026-04-03 | 2026-04-08 |
| `pay_link` | 5 | 2026-03-28 | 2026-09-11 |
| `vendor_registration` | 2 | 2026-03-10 | 2026-03-11 |
| `gift_card` | 1 | 2026-03-19 | 2026-03-19 |
| `party_builder` | 1 | 2026-05-24 | 2026-05-24 |
| the unclaimed net (link 2) | 1 | 2026-09-12 | 2026-09-12 |

`event_tickets` holds **94** rows, `gift_cards` **1**, `booking_payments` **18**,
`financial_transactions` **1601**, `bookings` **61**.

The schema was read before anything was concluded (rule 13), and it decided the
shape of the fix:

- **`event_tickets` has a UNIQUE on `ticket_ref` and NOTHING ELSE.** No unique
  index on `stripe_session_id` or `stripe_payment_intent_id`. Migration 040 gave
  `booking_payments` exactly that protection; the ticket branches never got it.
- `gift_cards.stripe_session_id` **is** unique — which turns out to make the gift
  card branch *worse*, not better (§4).
- `financial_transactions` has `UNIQUE (source, reference) WHERE reference IS NOT
  NULL`, so that table is idempotent **if and only if** the reference is stable
  per payment. Three of the references were not.
- `bookings` had no unique on `stripe_session_id`, so the vendor branch and the
  legacy tail could both be run twice.

### Then Stripe was asked what it thought — and that is where the session turned

Link 15's lesson, applied: when the database is empty or looks odd, ask the
**provider**.

```
GET /v1/webhook_endpoints  →  1 endpoint, created 2026-03-05, status enabled
                              enabled_events: [ "checkout.session.completed" ]
```

**One event type.** The handler's first branch — 390 lines of it — is
`payment_intent.succeeded`, and Stripe has never sent one. Corroborated from
Stripe's own event log: 13 `payment_intent.succeeded` events in the retention
window, **two of them `type: party_builder`**, every one with
`pending_webhooks: 0`.

That matters because the in-page Payment Element is not a side path. It is:

- `/api/portal/pay` — **every** party-planner deposit, partial and final payment;
- `/api/studio-rental/checkout` — **every** studio-rental deposit.

Both create a PaymentIntent, not a Checkout Session. And both
`confirm-session` routes — the browser-side reconciliation — carry a comment
saying, in as many words, that the webhook is *"sole sender of emails +
financials + audit log + portal token regen + reminder enqueue"*.

So, measured on the live database, for the six planner payments made through the
Payment Element this year:

| date | booking | type | amount | financial row | audit | portal token minted by the webhook | GCal |
|---|---|---|---|---|---|---|---|
| 2026-06-08 | `HH-PTY-BVLMX` | deposit | $238.00 | **none** | — | — | no |
| 2026-07-11 | `HH-PTY-6GGMB` | partial | $813.00 | **none** | — | — | no |
| 2026-08-23 | `HH-PTY-F47YW` | partial | $300.00 | **none** | — | — | no |
| 2026-09-04 | `HH-PTY-PF3LJ` | final | **$1,711.00** | **none** | — | — | no |
| 2026-09-06 | `HH-2026-2800` | partial | $534.50 | **none** | — | — | no |

**$3,596.50 of real card payments are in `booking_payments` and in no
`financial_transactions` row at all** — and `financial_transactions` is what the
admin Financials tab reads. Not one `HH-PTY-*` booking has a stripe financial row
against it. No customer got our "Payment Received" email with their portal link,
Adam got no owner notification for any of them, no deposit put a block on the
Google Calendar, and no balance reminders were enqueued.

(The customers were not left with nothing: `/api/portal/pay` sets
`receipt_email`, so **Stripe's own receipt** went out. That is the difference
between an annoyance and an incident, and it is luck rather than design.)

The money is not lost — `booking_payments` has every row, because the browser
coming back is what writes it. But **the backstop a webhook exists to be has
never existed on this path.** A customer who closes the tab on the Stripe
confirmation screen is recorded nowhere.

The single `party_builder` financial row, from 2026-05-24, carries the reference
`stripe-pb-HH-PTY-E8H64-deposit` — the `-deposit` suffix that only the
PaymentIntent branch writes. So that branch *has* run, exactly once, months ago,
and the endpoint's subscription has changed since. **`HH-PTY-E8H64` has no row in
`bookings`** — a seventh deleted booking with money recorded against it, the same
shape as link 15's six `HH-STU-*`.

---

## 2. A second lost payment

Cross-checking all 97 settled Checkout Sessions since 2026-01-01 against
`booking_payments`, `event_tickets`, `gift_cards`, `bookings` and the unclaimed
net left six with no row anywhere. Five are `pay_link` and are accounted for —
that branch writes a `financial_transactions` row and deliberately no
`booking_payments` row, which is the untraceable pay link migration 035 exists to
replace. All five were found by their `stripe-pl-<pi>` reference.

The sixth was not.

```
cs_live_a1fdSySMJJecxuxH…   2026-07-22   $250.00   live, complete, paid
metadata: { customerName: "…", type: "invoice_deposit" }
payment link: plink_1TuPlY02uXWznKaWp6pKa5Xm
```

**`invoice_deposit` is a value nothing in this codebase has ever written.** It is
a hand-made dashboard Payment Link, like the $927 one. There is no financial row
at that amount within three days of that date, no booking, no booking payment.
A real customer paid $250 and this business has no record of it — **two months
before** the $927 incident that got a net built for it. needs-Adam 28.

And the net as link 2 built it would still have missed a payment of that shape if
the link had carried a contact email, which brings us to the rule-14 finding.

---

## 3. Rule 14: the net asked the wrong question

`isUnclaimableSession()` is documented as *"deliberately phrased as 'does the
legacy booking fallthrough have what it needs', not 'is the metadata empty'"* —
and it returns true only when there is neither a `contactEmail` nor a
`contactPhone`.

That is not the same question as *"did any branch claim this"*. A session naming a
type nobody handles but carrying a customer email passed straight through the net
into the legacy party-booking tail, which:

- inserts a `bookings` row with `status: 'deposit_paid'`, `event_type:
  'kid-party'`, a party date of `undefined` and a fresh `HH-2026-nnnn` ref;
- then emails whoever paid **"You're booked! … at Host Hampton 🎉"**.

A phantom kids party, in the live pipeline, with a confirmation email attached —
for a payment that might have been anything.

The gate is now `!isHandledSessionType(m.type) && !isLegacyBookingSession(m)`,
where the list of handled types lives in **one** place (rule 11) and the legacy
tail is reachable only for a session naming **no** type at all, which is what it
was written for. Driven in production in §5, both directions.

---

## 4. Everything else that was live on these branches

**Stripe redelivers, and nothing stopped it being paid for twice.** With no
unique index on `event_tickets.stripe_session_id`, a redelivered
`checkout.session.completed` inserted a *second* ticket under a fresh ref,
decremented inventory again, wrote a second financial row (under a new reference,
so the unique index could not catch it), ran `upsertContact` again — which
**mirrors into Brevo and Quo and enrols a sequence** — and sent a second
"You're in!" email.

**The gift card branch was worse for having a unique index.** `gift_cards.
stripe_session_id` is unique, so a redelivery *always* failed that insert — and
the email block sat outside the insert's `else`, so the recipient was emailed the
**freshly generated code**, which had never been written to the table. A second
gift-card email, from us, quoting a code that redeems nothing, for a card the
customer already holds under a different code.

**Three other branches had that same shape**: `event_ticket`,
`vendor_registration` and the legacy tail all logged a failed insert and then
sent the confirmation email anyway. Rule 10's expensive half — *it must not say
it stopped something it did not*, and its inverse, *it must not say it did
something it did not*.

**`nextval_event_ticket_seq()` had never existed.** Five call sites in
`cart-checkout` and `events/checkout` call that RPC. `event_ticket_seq` was
created by migration 005; the wrapper the app calls was not. Every call returned
a PostgREST "could not find the function" error, every caller discarded it
(`const { data: seqData } = …`), and every ref silently fell back to
`HH-EVT-${Date.now().toString().slice(-4)}`. Rules 13 and 19 in one place.

That fallback is a **ten-second-wide ref space against a UNIQUE column**, and the
webhook used it directly too. Two purchases landing on the same
millisecond-mod-10000 meant the second insert was refused — and, per the
paragraph above, that customer was emailed "You're in!" naming a ticket that does
not exist. In `cart_checkout` it was not even a coincidence: the ref was computed
**inside a tight loop** as `Date.now().slice(-4)` plus the event id prefix, so
two cart lines for the same event were guaranteed to collide and the second was
always silently refused.

**Gift-card redemption existed four times**, as four copies of the same
read-modify-write with the read error and the write error both discarded:

- twice in `/api/webhook` (the ticket branch and the legacy tail);
- in `/api/gift-cards/redeem`;
- in `/api/events/checkout` — and that one **hands over a whole ticket**: the
  ticket was inserted and inventory decremented *before* the balance was
  deducted, so two requests racing meant one card paid for two tickets.

All four wrote `redeemed_at: newBal === 0 ? now : null`, which **clears the
timestamp** on a card that had already been spent.

**Inventory declined silently.** `decrement_event_tickets` is `WHERE
available_tickets >= qty` and returned `void`, so an oversold event took the
money, issued the ticket, left stock untouched and told nobody.

**A failed read became a balance.** Four branches did `bkRow?.total_cents || 0`
over a `.single()` whose error was discarded. A Supabase blip therefore read the
booking's total as **zero**, which makes the balance zero, which writes
`status: 'paid_in_full'` and stamps `paid_in_full_at`. The Phase 5 review found
exactly that shape on the plan path and fixed it there; the non-plan branches
kept it. Rule 12, in its money form.

**`checkout.session.completed` does not mean paid**, and the file's own comment
said so — over branches that all issued immediately regardless. Only the plan
path checked. Measured on the live account: `klarna` is enabled on 63 of the last
93 sessions, `cashapp` on 64, `amazon_pay` on 62 — the delayed-notification
methods that complete `unpaid`. It has not bitten yet (all 97 settled sessions in
history were `paid`), and there was nothing to catch it if it did:
`checkout.session.async_payment_failed` was neither subscribed nor handled, and
`async_payment_succeeded` dumped a non-plan session into the unclaimed net rather
than issuing the ticket — so a customer whose Klarna payment settled two minutes
late would have paid in full, received nothing, and appeared in Adam's Financials
tab as an anonymous sum needing attribution.

**`JSON.parse(m.cartItems)` and `JSON.parse(m.sessionIds)` were bare.** A
malformed value throws out of the handler, which Stripe reads as a 500 and
retries until it gives up — the exact failure mode that lost $927.

**And the cart could not create the cart it advertises.** Stripe caps a single
metadata value at 500 characters. Measured against the live API rather than taken
from the docs: a 500-character value is accepted, a 600-character one is refused
with *"Metadata values can have up to 500 characters"*. `/api/cart-checkout`
packs every line into `metadata.cartItems` as JSON, permits **10 items**, and has
no try/catch around `sessions.create`. Real carts have already reached **303
characters at three items**. A six-item cart is an unhandled 500 on the checkout
button. Nobody had hit it because the largest real cart was three items.

**`event_ticket_multi` could email a receipt for nothing.** If the
`event_sessions` read failed, the loop had nothing to iterate, **zero** tickets
were inserted — and the financial row, the contact upsert and both confirmation
emails all went ahead.

**`recordFinancialTransaction` decided "duplicate" from the error message**
(`.includes('duplicate')`) while `isUniqueViolation` — which reads SQLSTATE 23505
first — sat two imports away. It also swallowed every other error, on the write
that is the only reason five planner payments' absence is visible at all.

---

## 5. What was fixed, and how each fix was proved

All of it is deployed. Everything below was driven against **production** with
synthetic `checkout.session.*` and `payment_intent.succeeded` events **signed
with the real `STRIPE_WEBHOOK_SECRET`** read from inside the container — every DB
write, status transition and email for real, and no charge created at Stripe.

**New: `lib/stripeSettlement.ts`** — one place for each concept the branches had
been answering differently: `sessionSettlement` (is the money there),
`claimBySessionId` (has this delivery already happened — three outcomes),
`nextTicketRef`, `decrementInventory`, `redeemGiftCard`, `parseJsonMetadata`,
`HANDLED_SESSION_TYPES` / `HANDLED_PAYMENT_INTENT_TYPES`, and the measured
`STRIPE_METADATA_VALUE_LIMIT`.

**Migration 046** adds the two unique indexes (`uniq_event_ticket_per_session_line`
with `NULLS NOT DISTINCT`, and `uniq_bookings_stripe_session`), creates the
`nextval_event_ticket_seq` the app had been calling for months, sets that sequence
to **10000** so new refs are five digits and structurally disjoint from the legacy
four-digit space (max 9932), makes both decrement functions return the new count
(NULL = declined), and adds `redeem_gift_card` — one statement under
`SELECT … FOR UPDATE`, the deduction clamped with `LEAST`, and `redeemed_at`
preserved with `COALESCE`. Applied, and **re-run to prove idempotency**.

**The idempotency marker is the financial row, not the payment row.** This is the
one design decision worth stating: the Payment-Element branches have two writers —
the browser (`confirm-session`) and this webhook — and both insert into
`booking_payments`. So "my insert was a duplicate" cannot mean "the side effects
are done", because the browser does none of them. Only the webhook writes
`financial_transactions`, `(source, reference)` is unique, and it is a row Adam
can see. A *fresh* insert there is what now gates the receipt, the owner email,
the calendar block, the portal token and the reminders. The references were also
changed to carry the Stripe object id, because `pb-<ref>-partial` is the same
string for a customer's *second* partial payment and would have read as a
redelivery.

### Production evidence, both directions

| probe | result |
|---|---|
| forged signature | **400** — "No signatures found matching the expected signature" |
| valid signature, $0 session | `200 {"unclaimed":true,"recorded":false}` — *"nothing settled, not recording"* |
| `event_ticket`, `payment_status: unpaid` | `200 {"settled":false,"reason":"payment_status=unpaid"}` — **no ticket, no email** |
| the same session, `async_payment_succeeded`, paid | `200 {"ticketRef":"HH-EVT-10000"}` — issued, once, late |
| **the identical delivery again** | `200 {"duplicate":true}` — **no second row, no second email, no second decrement** |
| 3 tickets against 1 remaining | `200` + `OVERSOLD: HH-EVT-10002 (3) … inventory NOT decremented` |
| ticket paying 5000c with a 5000c card | card → `balance 0, status redeemed, redeemed_at` stamped |
| another ticket quoting the **same, now-spent** card | `GIFT CARD NOT REDEEMED: … has no ACTIVE row — 2500c of discount was given … and not deducted` — balance stayed 0, **`redeemed_at` not cleared** |
| `type: "invoice_deposit"` **with a contactEmail** | `200 {"unclaimed":true,"unknownType":"invoice_deposit"}` — **`bookings` still 61** |
| `payment_intent.succeeded`, party_builder partial | `200` — one payment row, one financial row, one audit row, one portal token |
| **the same PaymentIntent again** | `200` — *"already handled — side effects skipped"*: still **one** of each |
| `async_payment_failed` | `200 {"failed":true}` + `DELAYED STRIPE PAYMENT FAILED … nothing was issued for it` |

Inventory started at 3 and finished at 1: decremented **exactly once**, by the one
delivery that was neither a redelivery nor an oversell. The log says what happened
in both directions, every time (rule 10):

```
stripe session cs_live_PROBE046_unpaid is not settled (payment_status=unpaid) — nothing issued; waiting for checkout.session.async_payment_succeeded
Ticket created: HH-EVT-10000 for adam@easternbuilding.supply
stripe session cs_live_PROBE046_unpaid already has rows in event_tickets — redelivery; side effects suppressed
OVERSOLD: HH-EVT-10002 (3) issued for event 0de0b6b3-… — inventory NOT decremented, it did not have 3 left.
GIFT CARD NOT REDEEMED: HH-PROBE-046 has no ACTIVE row — 2500c of discount was given on HH-EVT-10004 and not deducted.
UNHANDLED STRIPE SESSION TYPE "invoice_deposit" on cs_live_PROBE046_invoice — no branch claims it; recording as unclaimed rather than guessing it is a party booking.
Party builder PI processed: HH-TEST-PAY8 partial $50 | first record
Party builder PI processed: HH-TEST-PAY8 partial $50 | already handled — side effects skipped
DELAYED STRIPE PAYMENT FAILED: session cs_live_PROBE046_failed (event_ticket, 1123c) — nothing was issued for it.
```

### The root cause, fixed

The endpoint was **updated in place** — not recreated, because recreating it
rotates `STRIPE_WEBHOOK_SECRET` and every delivery would 400 until the box caught
up:

```
endpoint we_1T7ckv02uXWznKaWMiPeXCCf   status enabled
BEFORE: checkout.session.completed
AFTER : checkout.session.completed, checkout.session.async_payment_succeeded,
        checkout.session.async_payment_failed, payment_intent.succeeded
```

Re-read afterwards to confirm, because a write that is not re-read is a claim
(rule 8). Stripe's update response carries no `secret` field, so nothing was
printed — link 15's lesson about the last line of a registration script.

**Deliberately in this order:** the PaymentIntent branch was made idempotent and
proved idempotent in production *before* the event was subscribed. Turning it on
first would have double-emailed and double-calendared every payment
`confirm-session` had already recorded, because that branch guarded nothing —
it merely did `void alreadyRecorded` to silence the unused-variable warning,
forty lines below a studio branch that guarded properly. Rule 11, deciding
whether a real customer gets two receipts.

---

## 6. What HELD

Reporting only what broke would overstate the state of this surface.

- **Amounts are computed server-side everywhere.** `cart-checkout` and
  `events/checkout` both load the event, the session and the variant from the
  database and derive the price there; nothing takes a figure from the client.
  The webhook's `event_ticket` branch derives its unit price from
  `session.amount_total`, which is Stripe's number, not ours.
- **Signature verification was already right.** `constructEvent` with a 400 on
  failure, fail-closed, and the forged-signature probe confirms it.
- **The plan pay-link path is sound**, and the Phase 5 review's three-outcome
  `matchPlanPayLink` still answers 500 on "could not tell" so Stripe redelivers.
  It runs ahead of every legacy branch, and the settlement gate did not change
  that.
- **`publicOrigin(req)` and `lib/contactLookup.ts` are intact** across the
  surface; link 13's and link 14's tripwires still pass.
- **The unclaimed net itself works.** Link 2 built it correctly for the shape it
  was built for, it caught the $927, and the production probe shows it catching a
  fresh unattributable payment and emailing Adam about it. The change is to
  *which* sessions reach it, not to what it does.
- **`booking_payments`' two unique indexes from migration 040 held**, and are why
  the browser/webhook race on the Payment-Element path has never produced a
  duplicate payment row.
- **Stripe holds no payment this database has lost besides the two named** —
  102 succeeded PaymentIntents since 2026-01-01, and every one not belonging to a
  Checkout Session is accounted for in a table.

---

## 7. The tripwire, and attacking it

`src/__tests__/lib/stripeWebhookSurface.test.ts` reads the sources off disk in the
shape `portalAuthSurface.test.ts` and `signwellSurface.test.ts` established: a
deny-list of shapes, a positive convention check, a staleness walker, every
exemption scoped to a named file with a written reason. Ten rule groups — a
settlement gate ahead of every branch (R1); no ref from the clock and one
allocator (R2); one implementation each of inventory and redemption (R3);
duplicates by SQLSTATE not message text (R4); every write reads its result (R5);
one list of handled types, checked in **both** directions (R6); no bare
`JSON.parse` on metadata and a cart that respects the 500-character ceiling (R7);
a claim before any issuing, with three outcomes (R8); the migration agreeing with
the code (R9); and no unlisted file creating a Stripe object (R0).

Beside it, `src/__tests__/api/webhookMoneyBranches.test.ts` drives the real route
against **`helpers/fakeMoneyDb.ts`** — a fake that refuses what Postgres refuses:
the real NOT NULLs, the real CHECKs, the real unique indexes including migration
046's `NULLS NOT DISTINCT` one, and RPCs that behave like the real functions
(`decrement_*` returns NULL when it declines; `redeem_gift_card` clamps and
preserves). The existing `buildChain` mock accepts every insert and answers
`{data: null, error: null}` to every RPC — against which a double-issued ticket
looks fine, a missing RPC looks fine, and a card spent twice looks fine. Rule 8's
mock form, for the fifth session running.

**Then the tripwire was attacked**, with `scripts/attack-stripe-tripwire.js`:
twenty-seven defects reintroduced one at a time into the real sources, the suite
run against each, the source restored. Every mutation verifies it landed on disk
before jest runs, and anchors are matched against both LF and CRLF.

**Six of the twenty-seven got through the first run**, and they are two families —
both of them families link 15 had already named, in a tripwire written after
reading about them:

1. **A whole-file match satisfied by a different occurrence than the one
   mutated**, four times over:
   - R7b asked only whether `cart-checkout` *mentions* `STRIPE_METADATA_VALUE_LIMIT`
     — and the import line mentions it, so replacing the ceiling with `99999`
     passed. It now checks the comparison.
   - R8c asked whether the whole guards file contains `'unavailable'` — and
     `decrementInventory` and `redeemGiftCard` each have one, so renaming the
     *claim's* outcome passed. It is now scoped to the `Claim` union.
   - R9a and R9b read the migration **including its comments**, and that
     migration's header explains what each clause is for, quoting `NULLS NOT
     DISTINCT` and `COALESCE(redeemed_at, now())` in prose. Deleting them from the
     actual SQL left both rules green, satisfied by the paragraph describing
     them. SQL comments are now stripped first. *A well-commented migration is a
     hazard to a rule that greps it.*
2. **A rule that matched nothing at all, and therefore passed.** R6b extracted
   metadata types with `[a-z_]+`; the attack added `cart_checkout_v2`, the digit
   ended the match early, the regex failed, no type was extracted, and the
   comparison ran over an empty set. **A rule that silently matches nothing is
   the quietest kind of hole** — it does not even look wrong.

And a sixth, which is the one I would not have found by re-reading:

3. **R8b: a behaviour test that passed for the wrong reason.** The test broke
   reads on `event_tickets` and asserted 500. With the claim's `unavailable`
   branch disabled it *still* returned 500 — because the ticket INSERT then hit
   the same broken table. Green, for a completely different reason. It now breaks
   `gift_cards`, which only the claim reads, so a dead claim means the handler
   sails on and issues the ticket. A shape rule forbidding `if (false && …)`
   anywhere on the surface was added beside it.

Two deliberate **negative** cases are included, so the narrowings cannot quietly
become escape hatches: R5 asserts it can still tell a checked write from an
unchecked one, and `signwellSurface.test.ts` R3 — which had to be taught that a
TypeScript type annotation is not a write — asserts that `agreement_pdf_url:
null,` is *still* caught, because writing NULL is a write. **That negative case
caught a hole in my own first draft**, which excused it.

**27/27 after the fixes**, and the suite on the restored tree is green.

---

## 8. What I could NOT verify

- **Whether a delayed-notification payment has ever actually completed `unpaid`.**
  All 97 settled sessions in Stripe's history are `paid`, so the settlement gate
  is proved by synthetic event only. The exposure is real (klarna/cashapp/
  amazon_pay are enabled on ~two thirds of our sessions) but the incident has not
  happened yet.
- **Whether the $250 `invoice_deposit` payment corresponds to a real booking.**
  Stripe says it is live, complete and paid; our database has never heard of it.
  That is everything that can be established from here. needs-Adam 28.
- **`HH-PTY-E8H64`.** A `financial_transactions` row from 2026-05-24 names a
  booking ref that has no row in `bookings`. Like link 15's six `HH-STU-*`, the
  row was deleted and nothing records by whom.
- **Nothing was tested in Stripe TEST mode**, because the container holds only
  `sk_live` (confirmed via the API: `livemode: true`). Every payment-path probe
  was a signed synthetic event, which exercises the whole handler and creates no
  charge. No Payment Link was minted, no card was charged, no hold was placed.
- **The `event_ticket_multi` and `cart_checkout` branches were exercised by unit
  test, not by production probe.** Driving them needs multiple live
  `event_sessions` rows; the single-ticket, gift-card, oversell, unknown-type,
  redelivery and PaymentIntent paths were all driven for real.
- **Whether `upsertContact`'s Brevo/Quo mirror was ever double-fired** by a
  historical redelivery. `contacts` is upsert-keyed by email so a duplicate is
  invisible after the fact; the only evidence would be in Brevo's activity log.

---

## 9. Needs Adam

**28. A second lost customer payment: $250.00, 2026-07-22.**
Stripe session `cs_live_a1fdSySMJJecxuxH…`, live, complete, paid, from payment
link `plink_1TuPlY02uXWznKaWp6pKa5Xm`, metadata `{customerName, type:
"invoice_deposit"}`. **It is in no table in this database** — no booking, no
booking payment, no financial row. `invoice_deposit` is not a value this codebase
writes, so the link was made by hand in the Stripe dashboard. Which booking was
it a deposit for? Once that is known it can be attached; until then it is revenue
the books do not show. (The handler would now catch this shape and put it in the
Financials tab under *Unmatched Stripe Payment* — this one predates the net.)

**29. $3,596.50 of planner payments are missing from the Financials tab.**
Five payments — `HH-PTY-BVLMX` $238.00, `HH-PTY-6GGMB` $813.00, `HH-PTY-F47YW`
$300.00, `HH-PTY-PF3LJ` **$1,711.00**, `HH-2026-2800` $534.50 — are in
`booking_payments` with real PaymentIntent ids and in **no** `financial_transactions`
row, because Stripe was never sending the event that writes one. Going forward
this is fixed. **Whether to backfill the five historical rows is Adam's call**,
not a build session's: if he has already reconciled those months by hand, adding
them now double-counts. I have the exact list and references ready; say the word
and it is one statement.

**30. Those same five customers never got our payment receipt**, and Adam never
got the owner notification. Stripe's own receipt did go out (`receipt_email` is
set), so nobody was left in the dark about the charge itself — but nobody got the
portal link, and `HH-PTY-PF3LJ`'s **final** payment of $1,711 closed a booking
with no "paid in full" acknowledgement from us. Sending anything retroactively is
a customer-touching send and is deliberately not being done by a build session.

*Not blocking, and already actioned:* the Stripe endpoint's event subscription
needed no decision and was fixed — it now carries all four event types the
handler has branches for.

---

## 10. Housekeeping

- **Every probe row deleted, every invariant back to baseline exactly**:
  94 `event_tickets`, 1 `gift_cards`, 61 `bookings`, 18 `events`,
  1601 `financial_transactions`, 18 `booking_payments`, 230 `portal_tokens`.
  The throwaway event (`zz-probe-046`, `is_active = false`, a past date so it
  could not render publicly) and the throwaway gift card (`HH-PROBE-046`) are
  gone.
- **`HH-TEST-PAY8` restored** with a conditional `UPDATE … WHERE balance_due_cents
  = 55000`: back to `cancelled / total 60000 / balance NULL / paid_in_full_at
  NULL / party_tags {}`, with its probe payment row, audit row and portal token
  deleted. It holds 0 payments, 0 modifications and 0 tokens, as it did before.
- **`event_ticket_seq` is at 10004, not 10000.** Sequences ignore transactions
  (rule 9), so the five numbers the probes consumed are a permanent gap. That is
  by design — the sequence exists to be gap-tolerant — and it is recorded here so
  nobody reads `HH-EVT-10005` as evidence of five missing tickets.
- **No charge, no card hold, no Payment Link, no Stripe object created** beyond
  two disposable `Product`s used to measure the metadata limit, both deleted in
  the same script.
- **Emails sent:** the production probes sent ticket confirmations and a payment
  receipt to `adam@easternbuilding.supply` (the designated test address), owner
  notifications to `hosthampton295@gmail.com`, and one *"Unmatched Stripe payment:
  $1.23"* alert to Adam — that last one is the net's alert working, and is worth
  him seeing once. **No real customer was emailed or texted.**
- **Nothing was written to `marketing_ledger`.** No model call, no SMS.
- `audit_scratch/` and `services/website/scripts/attack-stripe-tripwire.js` are
  untracked on purpose, per the do-not-commit list.

---

## 11. The secondary: the duplicate plan `9fedd91` was supposed to stop

The main scope closed cleanly, so the brief's secondary item was taken.

`/api/party-builder/save` looked a returning customer's prior plans up with
`.eq('contact_email', normalizedEmail)` where `normalizedEmail` is lowercased.
`bookings.contact_email` is plain `text` holding whatever the customer typed, and
**9 of 61 live rows are not lowercase** — six of them `kid-party` plans. For those
customers the lookup returned nothing and a **brand new plan was created on every
save**, which is exactly the behaviour commit `9fedd91` ("one plan per customer,
not one per save") was written to remove.

Measured on the live database, the two filters disagree by six rows:

```
old  .eq('contact_email', lower(input))   →  19 of 25 kid-party plans reachable
new  case-insensitive exact re-compare    →  25
                                             6 plans a mixed-case customer could never find
```

`refBelongsToCustomer`, **fifteen lines above it in the same file**, compares the
same two addresses case-insensitively and is correct. Rule 11 again, and link 14
found the identical pair forty lines apart in `/api/portal/my-bookings`.

Now `findBookingsByContactEmail` — candidates by `ilike`, then an exact
re-compare, so a `_` in a real address cannot wildcard onto somebody else's plan
— and a **failed** lookup answers 503 rather than silently creating the duplicate
it exists to prevent (rule 12). Four tests, and the fix was reverted to confirm
they go red.

### And measuring that turned up one more thing, for link 17

`upsertContact` (`lib/contacts.ts`) has the same `.eq('email', …)`, and
`contacts_email_key` is unique on the **raw** value. So a returning customer who
capitalises differently misses the lookup, the insert succeeds, and the person is
duplicated. It has happened **eight times**:

```
haleybelmonte94@…   jeberhardt517@…   jessica.lindstrand4@…   aled5290@…
meganpastier97@…    michaela.j.manning@…   nitai.finkelstein@…   jgilde711@…
```

Sixteen of the 21 mixed-case addresses are one half of such a pair. And
`upsertContact` **mirrors into Brevo and Quo**, so those eight are probably
duplicated in the 944-person marketing list too, with opt-out state written to
one row and not the other — link 9's unsubscribe finding with a second door.
Recorded as needs-Adam 31, because the *lookup* is a technical fix and the
*merge* is a decision about real people and an external list.

Five `.eq('email', …)` sites remain and are handed to link 17:
`lib/contacts.ts`, `lib/sequences.ts`, `lib/agent/draftInquiry.ts`,
`/api/admin/photos/backfill-reminders` and `/api/cron/gmail-sync`. (The two in
`/api/admin/auth/*` are `admin_users`, a column we write, and the three in
`/api/portal/email-auth/*` are `email_auth_codes.email`, which link 14 measured
and cleared.)
