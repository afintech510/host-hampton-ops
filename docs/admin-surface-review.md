# The admin surface — attack and repair

**Link 18 of the build chain. 2026-09-12 → 2026-09-13.** Worktree `humble-flame`.
Main was `2f02733` at the start and `ea93755` by the time the work landed (a
sibling Slack session pushed in between); the code landed as `f4d9a3b`.
**Migration 047 taken and applied. 048 and 049 were taken by the Slack session
while this one was paused, so the next free number is 050 — ask the database,
not a handover note.**
Suite **2387 → 2602 green**, 0 app `tsc` errors, `/book` still `○ Static`
7.15 kB and serving **52,742 bytes** in production.

Scope: the 63 route files and 95 handlers under `src/app/api/admin/**` — the
surface Allie and Adam actually run the business from, which no link had audited
as a whole, and where `adminActorId` had been patched in nine separate times by
nine separate sessions. That last fact is the signature of a rule nothing was
checking.

---

## 1. What was measured first

The schema was read out of `information_schema`, `pg_constraint`, `pg_indexes`,
`pg_trigger` and `pg_proc` before anything was concluded (rule 13), and two of
those reads decided the shape of the work.

```
booking_payments_recorded_by_check       CHECK (recorded_by IN ('system','admin'))
booking_modifications_modified_by_check  CHECK (modified_by IN ('customer','admin','system'))
financial_transactions_source_check      CHECK (source IN ('stripe','godaddy','squarespace',
                                                           'honeybook','cash','other'))
idx_fin_txn_source_ref                   UNIQUE (source, reference) WHERE reference IS NOT NULL
triggers on either money table           NONE
```

The first two are why `adminActorId(req)` could not simply be dropped in: it
returns `admin:<email>` from a signed session or the historical **`'ADMIN'`**
on the shared password, and *both* spellings violate those CHECKs — the
capitalised one included. Writing the real actor without migration 047 would
have been a 23514 on every admin payment and every audit row.

The third is the whole story of §2.

### The surface, walked

```
route files under app/api/admin            63
exported handlers                          95   (GET 32, POST 41, PATCH 12, DELETE 7, PUT 3)
handlers with NO isAdminAuthorized          7   → 3 legitimate, 4 not (§3)
literal 'admin'/'ADMIN' actor strings      12
writes whose error was discarded           47
UPDATEs with no .select()                  45
```

### The money, measured exactly rather than by the handover's heuristic

The brief carried an amount-and-date heuristic from link 16. It was replaced
with an exact reference join, and the answer changed:

```
booking_payments                       18 rows, $6,498.50
  recorded_by = 'admin'                12 rows, $2,652.00   (7 card, 2 venmo, 2 zelle, 1 cash)
  recorded_by = 'system'                6 rows, $3,846.50   (needs-Adam 29, link 16)

of the 12 admin rows:
  carrying ANY Stripe id                 0
  with a financial_transactions row       4   — $396, all $99, all matched EXACTLY by
                                              reference `stripe-bk-<booking_ref>`
  with NO financial row at all            8   — $2,256.00
     …of which not a card                 5   — $1,608.00  (cash $813, venmo $376, zelle $419)

financial_transactions rows with source in ('cash','other'), EVER:  0
```

**The heuristic was wrong in both directions.** A ±3-day window at the same
amount matched *two* rows for two of the four genuinely-recorded payments —
because $99 is the default deposit and several land in the same week — and it
missed the exact reference match that settles all four. A match that is right
by coincidence is not a reconciliation, and on an accounting question the wrong
answer is worse than no answer.

**And the refunds are the other half, which nobody had counted:**

```
event_tickets with status='refunded'    3, $112.01
bookings with refund_amount_cents       1, $200.00
booking_payments of type 'refund'       0        ← so no balance reflects a refund
financial_transactions rows that are negative, or reference a refund:  0
```

So the Financials tab **understates** by $2,256 and **overstates** by $312.01,
and has never once shown a cash, Venmo, Zelle or cheque payment.

### Rule 17, asked properly

`source` has permitted `'cash'` and `'other'` since the table was created, there
is no trigger on it, and the unique index is only on `(source, reference)`. So
the table would always have accepted these rows. This is not link 10's dead
queue ("could not have run") and not link 15's unregistered webhook ("never
ran"): **the code path did not exist.** `recordFinancialTransaction` was a
`function` declared *inside* `src/app/api/webhook/route.ts` — private to the
Stripe webhook, unreachable from any other surface. The admin panel had no way
to write the books even if somebody had thought to.

---

## 2. The headline: the books were reachable from exactly one place

`lib/financialLedger.ts` now holds that writer, and the webhook calls it with
`source: 'stripe'` and its own `stripe-…` reference prefix — which is what makes
that the webhook's reference space and nothing else's.

`lib/adminMoney.ts` is the admin side: `recordAdminPayment`,
`recordAdminRefund`, `ledgerSourceForMethod` (only literal cash is `cash`; a
card typed in by hand is **not** `stripe`, because `stripe` means "Stripe told
us about this" and the entire reason these rows exist is that it did not), and
`findCoveringLedgerRow`.

**The duplicate problem is why this is not a one-liner.** Four of the twelve
admin rows are a human re-typing a Stripe deposit the webhook already recorded
(`notes` like *"Paid via Stripe Aug 19"*). Recording every admin payment blindly
would overstate revenue. So before writing, `recordAdminPayment` looks for a
ledger row whose reference *names this booking* at *exactly this amount*, and
declines with `already-in-books` rather than double-counting — by reference and
exact cents, never by the proximity heuristic that was wrong above. A failed
coverage read does **not** record (rule 12: the collapse that double-counts).

`describeLedgerOutcome()` turns all four outcomes into a sentence the panel
shows and the audit line carries, because when the output is a sentence somebody
will repeat, the sentence is the artefact (rule 10).

---

## 3. Four admin doors with a copy of the credential check

Seven handlers had no `isAdminAuthorized`. Three are the sign-in surface itself
and are exempt with written reasons (`auth/login`, `auth/logout`,
`auth/session`). The other four — `gift-cards` GET and PATCH,
`gift-cards/send-promo`, and **`pay-link`, which mints Stripe Payment Links** —
carried this instead:

```ts
const token = req.headers.get('authorization')?.replace('Bearer ', '')
if (token !== process.env.ADMIN_PASSWORD) return 401
```

Two defects, and the first is rule 11's sharpest form yet. `isAdminAuthorized`
contains the guard, *with a comment explaining it*:

```ts
// An unset ADMIN_PASSWORD must not make `Bearer undefined` a valid login.
if (!expected) return false
```

The four copies are missing exactly that. With `ADMIN_PASSWORD` unset,
`undefined !== undefined` is false and **the check passes** — on a route that
creates Stripe objects. `adminAuth.test.ts` has asserted the correct behaviour
since migration 038; the copies were never in its reach. The concept was defined
twice and only one of them was being checked.

The second defect is the one with a live victim. **The copies reject the
`hh_admin` session cookie outright**, so Allie — signed in as herself, as
migration 039 exists to let her be — could not use the gift-cards tab or the
pay-link tool at all. Measured in production before and after (§5).

---

## 4. Everything else that was live

**`recalcTotals` wrote `total_cents: 0` over a real customer's invoice.** It
discarded both read errors, so a failed `booking_line_items` read left `items`
null, the loop added nothing, and it then *wrote the zero* and answered
`{ok: true}`. Link 16 found the read-becomes-a-balance shape on four webhook
branches; this is the same rule-12 defect with an **overwrite** behind it, on
the function every line-item edit and every studio re-price calls.

**`record_payment` had four separate failures in sixty lines.** The INSERT's
error was discarded and the customer was then emailed *"Payment Received —
$X, balance $Y"* over a write that may have been refused. The balance came from
`(booking.total_cents || 0) - paid` over a read whose error was also discarded,
so an **unquoted lead** — most of the pipeline since Phase 4 — was marked
`paid_in_full` by its first deposit. `recorded_by` was the literal `'admin'`.
And `amount_cents` reached an integer column with no validation at all.

**The one read that gates twelve admin actions answered 404 for a blip.**
`const { data: booking } = await supabase.from('bookings')…single()` — error
discarded — is the entry gate for approve, cancel, record a payment, send a
portal link, edit a line item, and seven more. A transient Supabase failure
produced a confident *"Not found"* about a party sitting right there.

**Two near-identical refund implementations, both able to spend twice.** Both
did `if (ticket.status === 'refunded') return 400` → `stripe.refunds.create(…)`
→ **unchecked** UPDATE. The guard depended on a write whose failure was
discarded, so a second click issued a second real Stripe refund. Stripe refuses
a second *full* refund of a charge, so the exposure is partial refunds: two $50
refunds against a $200 ticket both succeed. `lib/adminRefund.ts` now takes the
claim **first**, conditionally and read back, and releases it if Stripe declines.

**And the copy in `/api/admin/events/[id]/tickets/[ticketId]/refund` restored
inventory for the event named in the URL** (`params.id`) rather than the
ticket's own `event_id`, and never checked the two agreed — so refunding ticket
B through event A's URL gave A a free seat and left B oversold. Now a 404.

**Seven copies of mint-token-then-email discarded the token insert error**, and
`parties/create` was the most explicit about it: it read the error, logged it
`(non-fatal)`, and mailed the link anyway. A token row that was refused means
the URL in that email cannot work. Non-fatal to the booking; fatal to the email.
`lib/portalLinkMint.ts` has three outcomes and the send is gated on it.

**Thirteen copies of the audit insert discarded their error** — on the table
whose entire job is to say what happened. `lib/bookingAudit.ts` reports and
returns, deliberately non-fatal: losing the audit line for a payment that really
was recorded is a smaller problem than refusing the payment because the audit
line failed.

**The admin SMS campaign was the fifth reader of "may we market to this
person"** and read `sms_opt_in` alone. Link 17 measured this and left it named
as a known exception because nothing carries `status = 'unsubscribed'` today.
`optedOutReason()` now takes a channel and is the one definition — and the
status half is channel-independent by design, because somebody an admin marks
unsubscribed has not asked to stop receiving email and keep receiving texts.

**The same route collapsed "the contacts table could not be read" into "nobody
has opted in"**, marked the campaign `failed`, and answered
*"No SMS-opted-in contacts found"* — a confident, wrong sentence about 944 real
people, over a blip. Now a 503 with the claim released so it is retryable.

**`approve` emailed "Your Party is Confirmed!" over an unchecked status write**;
`cancel` reported success over one, and then cancelled the check-in reminders on
the strength of it; `remove_line_item` deleted by id **without scoping to the
booking**, so a `line_item_id` belonging to another party would have been
removed by a caller who could not even see it; and the `events/[id]` session
loop could silently fail to create a showing the admin believed they had opened.

---

## 5. What was fixed, and how each fix was proved

All of it is deployed (`f4d9a3b`, image
`sha256:7437eec0…` confirmed equal to the running container's). Everything below
was driven against **production** with a real `hh_admin` session minted inside
the container, against `HH-TEST-PAY8` — link 2's cancelled throwaway plan, whose
contact is the designated test address and which holds no Stripe PaymentIntent,
so the refund path took its books-only branch and **no card was charged**.

### Probe 1 — authorization, both directions and both before and after

| route | `none` | cookie BEFORE | cookie AFTER | bearer |
|---|---|---|---|---|
| `GET /api/admin/gift-cards` | 401 | **401** | **200** | 200 |
| `PATCH /api/admin/gift-cards` | 401 | **401** | **400** | 400 |
| `POST /api/admin/gift-cards/send-promo` | 401 | **401** | **400** | 400 |
| `POST /api/admin/pay-link` | 401 | **401** | **400** | 400 |
| `GET /api/admin/financials` *(control)* | 401 | 200 | 200 | 200 |

400 means the gate passed and the deliberately-empty body was rejected. The
control route has always used `isAdminAuthorized` and always accepted the
cookie, which is what makes the other four rows a finding rather than a quirk.
**`none` stayed 401 everywhere** — the legitimate direction survived.

### Probe 2 — the money reaches the books

```
POST record_payment venmo $1.63
  -> 200 {"ledger":"recorded","ledgerReference":"admin-bp-a26f47e4-…",
          "message":"Payment of $1.63 recorded. Recorded in the Financials tab."}

financial_transactions:
  date        description                    amount  source  category     reference
  2026-09-13  Venmo payment — HH-TEST-PAY8      163  other   Room Rental  admin-bp-a26f47e4-…

booking_payments.recorded_by = 'admin:adam@benchworksai.com'
```

That is **the first `source = 'other'` row this database has ever held**, and the
first time a money row has named the human who entered it. Migration 047's
relaxed CHECK accepted it.

### Probe 3 — and it must not double-count

A `stripe-bk-HH-TEST-PAY8` row at 213c was seeded directly by SQL to reproduce
the live shape, then the same amount was recorded by hand:

```
POST record_payment card $2.13
  -> 200 {"ledger":"already-in-books", …
      "message":"Payment of $2.13 recorded. NOT added to the Financials tab —
                 stripe/stripe-bk-HH-TEST-PAY8 already records this amount for
                 this booking (\"LINK18 PROBE seed — pretend Stripe deposit\")."}
```

`financial_transactions` gained **no** second row; `booking_payments` still
gained its row, because the human really did see that money.

### Probe 4 — the unquoted lead

`total_cents` set to NULL, a $5.00 payment recorded:

```
BEFORE  status cancelled, total NULL, paid_in_full_at NULL
AFTER   status cancelled, total NULL, paid_in_full_at NULL
```

Under the old statement, `Math.max(0, (null || 0) - 876)` is 0, `newBalance === 0`
is true, and that plan is written **`paid_in_full`** with a timestamp.

### Probe 5 — a refund is taken once

```
POST /orders/<id>/refund  $1.63  (first)   -> 200 {"refunded":true,"ledger":"recorded"}
POST /orders/<id>/refund  $1.63  (second)  -> 400 {"error":"Already refunded"}
POST /orders/<id>/refund  $999,999.99      -> 400 {"error":"Already refunded"}

financial_transactions:  other  -163  "Refund — Room Rental (HH-TEST-PAY8)"
                                       admin-refund-booking-3432e726-…
booking_payments:        refund / other / 163 / admin:adam@benchworksai.com
```

The **first negative ledger row** and the **first `payment_type = 'refund'` row**
this database has ever held.

### Probe 6 — validation

| input | result |
|---|---|
| `amount_cents: -500` | 400 — "must be a positive whole number of cents" |
| `amount_cents: 12.5` | 400 |
| `amount_cents: "100"` | 400 |
| `payment_method: "bitcoin"` | 400 — names the six permitted values |
| `payment_method: "CASH"` | 400 |

### A transient failure proved the guardrail, by accident

During probe 2 the audit row was refused by a live Supabase `Gateway Timeout`,
and the log said so:

```
BOOKING AUDIT ROW NOT WRITTEN for 3432e726-… ("venmo payment of $1.63 recorded.
Balance: $598.37. Recorded in the Financials tab."): Gateway Timeout
— the change happened but the history will not show it.
```

The next probe's audit row wrote normally (`booking_modifications` 151 → 152),
which is what distinguishes "transient" from "always fails". Under the old code
this would have been a silent hole in the history that nobody could ever have
explained. Rule 10, demonstrated by an outage rather than by a test.

### Everything restored

`booking_payments` 18, `financial_transactions` 1601, `booking_modifications`
151, `portal_tokens` 230, `bookings` 61, `contacts` 1220,
`invoice_number_seq` still `118 / t`. `HH-TEST-PAY8` back to
`cancelled / 60000 / balance NULL / paid_in_full_at NULL / refund NULL` with its
one line item and zero children. No Stripe object was created, no card was
charged, nothing was written to `marketing_ledger`, and no model call was made.

---

## 6. The tripwire, and attacking it

`src/__tests__/lib/adminSurface.test.ts` (30 checks) reads the sources off disk
in the shape `portalAuthSurface` / `signwellSurface` / `stripeWebhookSurface` /
`contactIdentitySurface` established. Ten rule groups: a staleness walker that
fails if any route file yields no recognised handler (R0); every handler gated,
with three named exemptions carrying written reasons (R1); no second
implementation of the credential check, and the fail-closed guard pinned against
the source (R2); no literal actor, with migration 047 read off disk to prove the
CHECK permits the real one (R3); the books reachable from one writer and every
direct writer listed with a reason (R4); a refund claims before it spends,
asserted **by index** (R5); no route mints a portal token by hand (R6); one
definition of consent (R7); the money writes read their results and
`recalcTotals` cannot write a total it could not read (R8); one balance, and no
`total_cents || 0` (R9); no interpolated `.or()` (R10). **Comments are stripped
before every rule.**

Beside it, `adminRecordPayment.test.ts` (23) and a rewritten `refund.test.ts`
(14) drive the real routes against **`fakeMoneyDb`**, extended here with real
`neq` / `is` / `like` / `ilike` / `in` predicates (they were **no-ops returning
the chain**, which would have made every conditional-claim test pass for
entirely the wrong reason), inserts that return the stored rows with generated
ids, the `increment_*` RPCs, and migration 047's CHECKs.

The old `refund.test.ts` drove `buildChain({data: sampleTicket()})` — a mock that
accepts every write and answers every read with the same fixed row. Against it a
double refund, a cross-event refund and a missing ledger row all look fine.
Rule 8's mock form, for the seventh session running.

### The attack: 26 defects, and the harness caught itself first

`scripts/attack-admin-tripwire.js` reintroduces each defect into the real
sources, verifies the mutation **landed** (both CRLF and LF anchors), runs the
suites, and restores on **every** path. It refuses to run at all unless the
clean tree is green — link 17's harness could not spawn its runner, returned
false for every input, and reported all 34 mutations "caught".

That refusal earned itself immediately: after the first round of fixes it
**refused to run**, because my own repair to the migration rule had sliced the
`DROP CONSTRAINT` line instead of the `ADD` and turned the tripwire red. A
detector that checks itself is the only kind worth having.

**The first run: 2 real holes, and they are the same family.**

> **A whole-file match satisfied by a different occurrence than the one
> mutated** — link 16 named this family after it cost four of its twenty-seven,
> and it cost three of twenty-six here.
>
> 1. **R3** asked whether migration 047 contains `LIKE 'admin:%'` *anywhere*.
>    The attack blanked one of the two clauses; the surviving one kept the rule
>    green. Now each `ADD CONSTRAINT` block is sliced and checked individually,
>    and a clause neutered to `OR FALSE` is caught explicitly.
> 2. **R8** asked whether `recalcTotals` has a `return { ok: false` before the
>    update. The attack deleted the line-items guard; the **payments** guard
>    satisfied it. Scoping the search per-error-variable was not enough either —
>    `indexOf` from one guard still found the other's return — so the guard's
>    own block is now **brace-matched**. That third instance is the reason this
>    rule is the shape it is.

Three further mutations I had predicted would be MISSED were **caught**, by the
behaviour tests rather than the shape rules — the ledger short-circuit, the
renamed claim status, and a stray literal on a non-actor key. Those predictions
were wrong and the notes now say so; a shape rule and a behaviour test covering
each other is the point of having both.

**26/26 after the fixes**, tree restored green.

---

## 7. What HELD

Reporting only what broke would overstate the state of this surface.

- **`/api/admin/campaigns/[id]` is the best-maintained route on the surface.**
  Its claim on `scheduled_campaigns` is correct, conditional and read back; it
  distinguishes a race from a stuck `sending` row and tells the operator what to
  do about each; and it already refuses to record a Brevo campaign as `sent`
  when Brevo created but did not send it. Its unchecked post-send status writes
  fail in the **safe** direction — the row stays `sending`, which the route
  itself refuses to re-send — so they are reported, not restructured.
- **`increment_event_tickets` and `increment_session_tickets` both exist** in
  `pg_proc`, unlike `nextval_event_ticket_seq`, which link 16 found had never
  been created despite five call sites.
- **`/api/admin/financials` and its CSV import read every error** and answer 500,
  and the importer de-duplicates per source. The Financials tab's own writes
  were never the problem; what reached it was.
- **Amounts on this surface are admin-supplied by design and now bounded**: the
  refund cap is what was actually *paid* (not `deposit_amount`, which is what the
  deposit was *set* to and says nothing about whether it arrived).
- **`marketing_ledger`'s gated edges are untouched.** Nothing in this change adds
  or removes a gated edge; `approved`/`sent`/`published` still require
  `actor.isAdmin`, and there are still six.
- **Link 13's, 14's, 15's, 16's and 17's tripwires all still pass**, including
  `publicOrigin`, `contactLookup`, the escaping walker and the Stripe surface.
- **The booking funnel is unchanged**: all thirteen pages 200 after deploy, and
  `/book` serves **52,742 bytes**, the pinned value to the byte.

---

## 8. What I could NOT verify

- **Whether the four hand-rolled auth checks were ever actually bypassed.**
  `ADMIN_PASSWORD` has been set in the container throughout, so the fail-open
  branch has never been reachable in production. The exposure was real and
  conditional; the incident did not happen.
- **Whether a double refund has ever been issued.** Only four refunds exist in
  the whole database and none is duplicated. The race needs two clicks inside
  one request's latency and Stripe refuses a second *full* refund, so the
  exposure was partial refunds specifically — and only one of the four was
  partial.
- **The ticket refund path was exercised by unit test, not in production.**
  Driving it means refunding a real ticket belonging to a real customer; the
  booking refund path was driven for real instead, on a cancelled throwaway with
  no PaymentIntent, which exercises the same shared `claim → spend → books`
  sequence minus the Stripe call.
- **No Stripe refund API call was made at all**, deliberately. The container
  holds only `sk_live`, and a refund is not a synthetic-event-able operation the
  way a webhook delivery is.
- **The remaining ~30 unchecked writes** (campaigns' post-send status writes,
  `sequences/[id]/steps` counters, `events/route.ts`'s calendar-id write,
  `auth/login`'s `last_login_at`, `run-pricing-migration`) are reported and not
  fixed. Each fails in a direction that is either safe or cosmetic, and a
  tripwire rule broad enough to cover them would have to be suppressed on day
  one — a rule that is suppressed is a rule nobody reads. R8 is scoped to the
  writes whose failure changes what a human or a customer is told.
- **Whether the four re-typed Stripe deposits are genuinely duplicates** rather
  than a second $99 payment that coincidentally matches. The reference join says
  the webhook recorded $99 for each of those four bookings and the admin later
  recorded $99 against the same booking; the notes (*"Paid via Stripe Aug 19"*,
  *"online booking, stripe"*) say the same thing. It is Adam's books either way.

---

## 9. Needs Adam

**33. $2,256.00 of hand-entered customer payments are not in the Financials
tab.** Eight `booking_payments` rows — `HH-PTY-6GGMB` $99 card and $813 cash,
`HH-PTY-JQTVX` $163 venmo, `HH-PTY-7XCD8` $238 zelle, `HH-PTY-3ZPMH` $213 venmo,
`HH-PTY-Q8FKB` $181 zelle, `HH-PTY-PF3LJ` $99 card, `HH-2026-1418` $450 card.
**$1,608 of that is cash, Venmo and Zelle, and the tab has never shown a single
row of any of them.** Going forward this is fixed and every hand-entered payment
writes its ledger row. **Whether to backfill the eight is Adam's accounting
call** — exactly the shape of needs-Adam 29 — because if those months have
already been reconciled by hand, adding them now double-counts. The exact list
and references are ready; it is one statement.

**34. $312.01 of refunds were issued and never deducted from the books.** Three
event tickets ($112.01) and one booking ($200). The Financials tab therefore
*overstates* by that much, independently of the understatement above. Same
decision, same reason.

*Not blocking, and already actioned:* the authorization gap, the double-refund
window, the cross-event inventory bug, the zeroed invoice, the paid-in-full lead
and the twelve literal actors needed no decision and are fixed and deployed.

---

## 10. Housekeeping

- **Migration 047 applied and re-applied clean**, with `pg_constraint` read back
  rather than trusted. All 18 existing `booking_payments` rows and all 151
  `booking_modifications` rows still satisfy the relaxed CHECKs.
- **047 also took `agent_learnings.source_memory_id`** (`docs/phase-5-memory-learning.md`
  §11.13), and `promoteMemory` no longer UPDATEs `agent_memory` — so promoting a
  row can no longer stamp `updated_at` and destroy the evidence that those 44
  rows are dead. Verified: `agent_memory.updated_at` still spans
  **2026-02-18 … 2026-04-22**. A source-reading test now forbids the UPDATE
  coming back, because the evidence it destroys is not recoverable.
- **048 and 049 were taken by the Slack session while this one was paused.**
  A handover note that names "the next free number" is a snapshot, not a fact —
  ask `information_schema`. **050 is next.**
- **No new environment variable.**
- **Emails sent:** payment receipts and one refund notice to
  `adam@easternbuilding.supply`, the designated test address. **No real customer
  was emailed or texted.** No Brevo campaign, no SMS.
- **Nothing written to `marketing_ledger`** — no model call, $0 spent.
- **`invoice_number_seq` untouched** — still `118 / t`, next issued number
  `444124-000119`.
- `audit_scratch/` and `services/website/scripts/attack-admin-tripwire.js` are
  untracked on purpose, per the do-not-commit list.
- **A note for whoever edits the attack harness:** the Bash tool ate backticks
  inside a double-quoted `node -e`, silently corrupting a codemod — the trap the
  standing rules warn about, hit again. Write the script to a file and run it.
