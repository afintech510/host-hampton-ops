# The plan money path — attack and repair (link 23)

*2026-09-13. Worktree `fierce-wolf`. Scope: `/plan/[ref]/summary`, `/api/plan/[ref]/**`,
`lib/planInvoice.ts`, `lib/planPayLinks.ts`, `lib/planPayment.ts`, `lib/plan.ts`,
`lib/partyPricing.ts`, `lib/bookingBalance.ts`, `/api/portal/pay`, and every writer of
`bookings.total_cents` / `balance_due_cents`. Main was `c7eda5f` at the start and `e160980`
when this was written. **No migration was taken.**

---

## 1 · What was measured first

Nothing was changed until every booking with money on it had been reconciled. The
question asked of all **62** bookings was: what does `loadPlanInvoice()` compute, what do
`total_cents` / `deposit_amount` / `balance_due_cents` say, and what does the payment
ledger make of it?

The brief said the defect was "$250 on two real bookings". It is bigger than that, and it
is a different defect from the one that was documented.

| | rows | dollars |
|---|---|---|
| `balance_due_cents` disagrees with `total − paid` | **21 of 62** | **$3,168.00** across 13 real bookings (the rest are `HH-TEST-PAY*` with a NULL column) |
| …of which the disagreement OVERCHARGES | **0** | — |
| `/plan/[ref]/summary` disagrees with what is outstanding | **27 of 35** live priced plans | **overstates $3,569.50** on 5, **understates $4,071.00** on 22 |
| `total_cents` disagrees with the invoice total | 0 real rows | — |

`total_cents` is fine everywhere. **The balance is not**, and the two customer-facing
surfaces disagree with each other as well as with the truth.

Supporting measurements, all from production:

* **`booking_payments` holds 18 rows. Exactly 2 are typed `deposit`.** Every hand-entered
  deposit — Venmo, Zelle, cash, "online booking, stripe" — was recorded as `partial`. That
  single fact is what turned a cosmetic display bug into a chargeable one.
* **`booking_payments` has never held an `amount_cents = 0` row**, so link 21's $0-swallows-
  the-unique-key hazard still has not fired.
* **Only ONE real booking has ever been issued an invoice number** (`HH-2026-8060`,
  `444124-000117`), and numbers are issued on first render — so exactly one real plan
  summary has ever been opened. `booking_pay_links` holds no `portal:`-minted row for any
  real booking. **The customer-facing defects below are live and reachable, and no real
  customer has walked into one yet.** Both halves belong here (rule 17).
* 20 of 62 bookings have no line items at all; **none of them carries a positive balance.**

---

## 2 · THE HEADLINE — the invoice's "Balance Due" was a quote-time figure that no payment ever moved

`loadPlanInvoice().balanceDueCents` was:

```ts
const balanceDueCents = depositIsSeparate ? totalCents : Math.max(0, totalCents - depositCents)
```

`depositCents` there is the **notional** $250, not what anyone has paid. The function did
not read `booking_payments` at all. So the number printed beside **"Balance Due"** on the
customer's invoice was fixed at quote time and stayed there for the life of the plan.

It is the number on `/plan/[ref]/summary`, **and** the number in the emailed and texted
summary (`lib/planShare.ts` line 114) — a sentence a customer repeats. Hard-won rule 10.

Two real customers, both **paid in full**:

| ref | total | paid | what the page said |
|---|---|---|---|
| `HH-PTY-6GGMB` | $1,725.00 | $1,725.00 | **Balance Due: $1,475.00** |
| `HH-PTY-PF3LJ` | $1,810.00 | $1,810.00 | **Balance Due: $1,560.00** |

And **rule 8 in its sharpest form yet** — the `?paid=1` banner, which is what Stripe
redirects a paying customer to, says:

> *"your receipt will arrive by email, and **the balance below updates once Stripe confirms
> it** (usually within a minute)."*

The balance below **structurally could not update**. It was not derived from anything a
payment touches. A sentence that is not merely wrong but is a promise about a number that
cannot keep it.

### Reproduced in production before a line changed

Neither paid-in-full customer's page could be opened without burning them an invoice
number, so a throwaway was seeded with the same shape (`HH-TEST-MONEY1`: a $600.00 party
paid $600.00 as a `partial` row, `invoice_number` pre-set to `TEST-MONEY1` so
`ensureInvoiceNumber` would not draw from the sequence). Driven with a real minted
`hh_portal` cookie against the container's own IP:

```
===== HH-TEST-MONEY1 =====        (BEFORE)
Total          : $600.00
Balance Due    : $350.00
pay buttons    : ["Pay $250.00 deposit"]
fee lines      : ["$250.00 + $7.50 card fee = $257.50 charged"]
```

---

## 3 · A live, chargeable $257.50 on a plan that owed nothing

That "Pay $250.00 deposit" button is not decoration. `quoteFor('deposit')` was bounded
only by `depositOwedCents`, which asked one question: *has a row with
`payment_type = 'deposit'` been recorded?* With 16 of 18 real payments typed `partial`,
the answer is no on almost every booking in the business — **including both paid-in-full
ones.**

The route agreed:

```
POST /api/plan/HH-TEST-MONEY1/pay-link  {"purpose":"deposit"}     (BEFORE)
→ 200 {"ok":true,"payUrl":"…","amountCents":25000,"feeCents":750,"chargeCents":25750}
```

A **real, live, chargeable Stripe Payment Link for $257.50 against a plan with a zero
balance.** It was deactivated within the same script (`plink_1UFD9r… active=false`).

`quoteFor('balance')` refused correctly (`409 This plan is paid in full.`) — which is why
this survived: the obviously-dangerous purpose was guarded and the innocuous-sounding one
was not. `custom` was capped at `remaining + depositOwed`; `deposit` was capped by nothing.

**A deposit is part of the price, so it can never exceed the price that is left.** That is
not an accounting decision, it is arithmetic, and it is now enforced —
`depositOwedCents = min(rawDepositOwed, outstandingCents)`.

The half that must NOT fire: a **studio security deposit is genuinely separate from the
total**, so a fully-paid rental still owes its refundable $250. It is deliberately
uncapped, and that branch has its own test.

---

## 4 · needs-Adam 41, confirmed, quantified, and recorded for the THIRD time

This is the item the session was convened for, and it is **not fixed, on purpose.**

`bookings.balance_due_cents` and `loadPlanInvoice()` describe two different commercial
deals for a studio rental:

* **The invoice's model** (`lib/planInvoice.ts`, stated in its header since Phase 5): the
  $250 is a **security deposit held against damage and refunded afterwards**. Balance Due
  is the FULL total. `HH-STU-ZVM4U` pays **$475 + $250 refundable = $725 out, $250 back.**
* **The column's model** (written by `/api/studio-rental/checkout`): the $250 is a
  **reservation payment** and comes off the total. `HH-STU-ZVM4U` pays **$475 in all.**

| ref | party | total | column says | invoice says |
|---|---|---|---|---|
| `HH-STU-ZVM4U` | **2026-09-30** | $475.00 | **$225.00** | $475.00 |
| `HH-STU-2CTJ3` | 2026-12-05 | $1,100.00 | **$850.00** | $1,100.00 |

`/api/portal/pay` clamps its charge to the column. Measured, asking it for the full
invoice amount:

```
POST /api/portal/pay {"amountCents":47500, "paymentMethod":"venmo"}
→ 200 {"amount":"$225","instructions":"Send $225 via Venmo to @hosthampton … Note: HH-STU-…"}
```

**Which model is right is an accounting decision worth $250 on each of two live bookings,
one of them in 17 days. It is Adam's and nobody else's**, and the third time it has been
written down (link 16 as needs-Adam 41, link 21 as 44, and here). What this session did
instead:

1. **Reduced the whole ruling to two booleans**, side by side in `lib/planBalance.ts`:
   * `STUDIO_DEPOSIT_IS_SEPARATE` — what the **document** says (today `true`).
   * `COLUMN_FOLLOWS_INVOICE` — whether the **stored column** agrees (today `false`).

   Set both to the same reading and the surface agrees with itself end to end. Every
   writer is routed through them **at today's values**, so nothing moved.
2. **Made the divergence impossible to ship silently.** `planMoneySurface.test.ts` fails if
   a writer sets `balance_due_cents` by arithmetic the invoice would not agree with, and
   `planBalance.test.ts` asserts the exact figures both columns hold today — so flipping
   either switch turns the suite red and names the rows it moves.
3. **Stopped either surface being able to overcharge while the question is open.**
   `/api/portal/pay`'s ceiling is now the **lower** of the column and the invoice. That is
   a no-op on every row in production (the column is never the higher of the two), and it
   means a stale column can never authorise a charge the invoice would not justify.
4. **Made it announce itself.** Verified in the production log after deploy:

   ```
   portal pay: HH-TEST-MONEY2 balance disagreement — balance_due_cents=22500c,
   invoice outstanding=47500c; charging against 22500c (needs-Adam 41)
   ```

---

## 5 · The other seven findings

**5.1 · `is_optional` was honoured by ONE of five totals.** An optional line item is
quoted and not charged — `loadPlanInvoice` excluded it and nothing else did.
`recalcTotals` did not even SELECT the column; `calculateLineItemTotal` (behind
`buildPlanSnapshot` → `bookings.total_cents`, the studio checkout, the studio edit route
and the kids-menu summary) looped every row. Rule 11: a concept defined twice, honoured
once. Only the cancelled `HH-TEST-PAY1/PAY2` carry optional items today, so **no real
booking has been inflated** — but the next one to gain an add-on would have had a stored
total the invoice disagreed with. `calculateLineItemTotal` now delegates to
`billedTotalCents`, which fixed every caller at once and left one implementation.

**5.2 · The document and the charge were priced from different reads.** The page and the
pay-link route each read `booking_payments` **separately** from the invoice they priced
against — three reads of the same rows, any of which could be stale or fail alone.
`loadPlanInvoice` now reads them itself and carries them on the invoice; `quoteFor` no
longer takes a payments array at all, so the two cannot be given different inputs.

**5.3 · …and it now fails closed on that read** (rule 12), exactly as it already did for
the line items. Discarding a payments error would reproduce the $1,475.00 statement on a
DB blip rather than by design, and would price the pay buttons as if nothing had been
paid. `notFound: false`, so the page renders "we couldn't load this plan" (which states no
balance and offers no button) and the pay route answers 503.

**5.4 · `/api/plan/[ref]/pay-link` had no rate limit at all.** Every accepted call mints
three to five Stripe objects (product, price, fee product, fee price, Payment Link) plus
an update per voided link, on nothing but a portal cookie. Its neighbour
`/api/plan/[ref]/email-me` is bounded — **13 real 429s from it in the current nginx
window** — so the omission was an oversight, not a policy. Now `plannerRule('plan/pay-link')`.

**5.5 · Link 21's third copy of `(total_cents || 0) - paid` was still in the webhook**
(`route.ts` party-builder payment branch). It carries the exact defect `computeBalance`
was extracted to stop: an unpriced lead — most of the pipeline since Phase 4 — clamps to a
balance of 0 and gets stamped `paid_in_full`. Routed through `computeBalance`, which
reports `paidInFull: false` when there is no total to be paid in full against.

**5.6 · The pay section invited money on plans that owed none.** "Reserve Your Date", the
deposit callout and the Venmo prompt were all gated on `invoice.depositCents > 0` — a
constant for the life of the plan. A paid-in-full plan was asked for $250 by Venmo as well
as by card. The callout now prints what is still **owed** on the deposit (or "Paid"), the
Venmo figure follows it, and a settled plan renders a **"Paid in Full"** block instead.

**5.7 · The invariant the document's own layout promises now holds.**
`depositOwedCents + balanceDueCents === outstandingCents` for every product whose deposit
comes off the total, for every payment shape in production. It did not hold before, which
is why the callout and the balance line could add up to something that was neither the
total nor what was owed.

---

## 6 · The one that is Adam's, not mine, and is NOT fixed

**The 3% card fee is charged on deposits, against a rule the docs mark locked.**
`docs/inquiry-response-flow.md` §4.4 says it twice, once with a padlock:

> 🔒 *fee on BALANCE only, never deposit* … **"3% card fee on the balance only, never on
> the deposit."**

Three code sites charge it on the deposit anyway: `quoteFor` (all purposes),
`/api/studio-rental/checkout` (`calculateCardFee(depositCents)`), and `/api/portal/pay`
(which also applies it to the tip). The summary page's own copy contradicts the locked
rule too — *"A 3% processing fee applies to card payments"*, unqualified.

It is **realised, once**: `HH-PTY-BVLMX` paid a $238.00 deposit plus a **$7.14** card fee.

Not changed in either direction. Removing the fee from deposits reduces what the business
collects; leaving it contradicts a locked document. That is a pricing decision. Recorded
as **needs-Adam 50**.

---

## 7 · The tripwire, and the two holes my own attack found

`src/__tests__/lib/planMoneySurface.test.ts` — **32 rules**, R0–R11, comment-stripped,
CRLF-tolerant, bodies sliced to the next declaration rather than by a fixed width, and
**every rule asserts how many sites it examined** (link 22's R9 examined 7 of 23 writes and
found its offender by luck). It inherits `publicIntakeSurface` R10's `.skip`/`xit`/`.todo`
ban for free by matching the `*Surface.test.ts` glob.

Plus `src/__tests__/lib/planBalance.test.ts` (**24** behavioural tests, including both
switches and the exact figures both live studio rows hold).

`services/website/scripts/attack-money-tripwire.js` (untracked, per the do-not-commit
list) reintroduces **34** defects one at a time. It refuses to run on a red tree, verifies
each mutation landed and reports `NOT_APPLIED` rather than counting it caught, and
restores on every path including SIGINT.

**First run: 6 NOT_APPLIED and 2 THROUGH.**

* The **6 NOT_APPLIED were CRLF** — literal `\n` in a multi-line `find` matches nothing in
  this repo. They would have been silently scored as catches by a harness that did not
  distinguish the two, which is link 17's exact failure. Fixed by matching on `\r?\n`.
* **Hole 1 — R8 matched the wrong `return null` of two.** The rule asserted that
  `derivedOutstandingCents` *contains* `return null`; it does, in the "no line items"
  branch. So turning the **read-failure** branch into `return 0` — which would refuse a
  real customer's payment on a DB blip — went straight through. **This is link 22's
  wrong-occurrence family, in my own new code, found the only way it ever is: by
  reintroducing the defect and watching the rule stay green.** The rule is now anchored on
  the failure branch itself and asserts the absence of `return 0` inside it.
* **Hole 2 — R3 asserted one phrase of a comment.** The comment IS the deliverable for
  needs-Adam 41, and a rule that checks a single sentence lets the surrounding explanation
  be tidied away. It now asserts the substance: the ticket number, the instruction, both
  booking refs, the dollar figure, and what each reading of the switch means. *(The
  mutation that exposed this was itself mis-aimed — it replaced a sentence that carried no
  safety-critical fact, so its passing was arguably correct. The rule was sharpened anyway
  and the mutation re-pointed at the booking refs, which it now catches.)*

**Final run: 34 applied, 34 caught, 0 through.**

---

## 8 · Every production probe

All against the container's own IP (`http://172.18.0.3:3002`) with a real minted
`hh_portal` cookie — Cloudflare 403s a probe through `www.hosthampton.com`.

| # | probe | before | after |
|---|---|---|---|
| 1 | `GET /plan/HH-TEST-MONEY1/summary` (paid in full) | Balance Due **$350.00**, "Pay $250.00 deposit" | Balance Due **$0.00**, heading **"Paid in Full"**, deposit callout "Paid", **no buttons** |
| 2 | `POST /api/plan/HH-TEST-MONEY1/pay-link {"purpose":"deposit"}` | **200, live $257.50 Payment Link** | **409 "This plan is paid in full."** |
| 3 | same, `"purpose":"balance"` | 409 paid in full | 409 paid in full *(control — unchanged)* |
| 4 | same, with `amountDollars: 1` in the body | 409 | 409 *(the body figure is ignored)* |
| 5 | `"purpose":"custom"` on a portal cookie | 403 | 403 *(held)* |
| 6 | MONEY2's cookie against MONEY1 | 403 | 403 *(held)* |
| 7 | `GET /plan/HH-TEST-MONEY2/summary` (studio, unpaid) | Total $475, Balance $475, both buttons | **identical** — the accounting question is untouched |
| 8 | `POST /api/portal/pay` asking $475 on the studio plan | `"Send $225 via Venmo"` | `"Send $225"` **+ a `balance disagreement … (needs-Adam 41)` warning in the log** |
| 9 | mint deposit link on MONEY2 (the expensive direction) | — | **200**, $250.00 + $7.50 = $257.50, deactivated |
| 10 | mint balance link on MONEY2 | — | **200**, $475.00 + $14.25 = $489.25, deactivated |
| 11 | `POST /api/portal/pay` card, $100 | — | **200**, PaymentIntent `amount=10300`, `requires_payment_method`, **cancelled** |

Probes 9–11 are the expensive direction, driven deliberately: **a change that stops the
pay path working is an outage nobody notices for days.** No charge was created — an
unconfirmed PaymentIntent has no payment method attached and was cancelled, and every
Payment Link was deactivated in the same script.

**Cleanup.** Two throwaway bookings, their line items, payment and pay-link rows deleted in
FK order. Every table verified back to its exact pre-probe baseline: `bookings` 62,
`booking_line_items` 206, `booking_payments` 18, `booking_pay_links` 19,
`booking_modifications` 151, `financial_transactions` 1601, `contacts` 1220,
`portal_tokens` 230. **`invoice_number_seq` still `last_value 118, is_called t`** — no
number was burned, because both throwaways had `invoice_number` pre-set.
`agent_memory.updated_at` still spans 2026-02-18 … 2026-04-22 across 44 rows.

**Three `marketing_ledger` rows cannot be cleaned up** (migration 021's trigger raises on
DELETE and UPDATE) and are named here: one `pay_link_created` for `HH-TEST-MONEY1`
(actor `portal:HH-TEST-MONEY1`) and two for `HH-TEST-MONEY2` (actor
`portal:HH-TEST-MONEY2`), all 2026-09-13 ~13:39Z. Their `entity_id`s now point at deleted
bookings. Ledger moved 443 → 446.

**The four real bookings this review is about were read and never written**:
`HH-STU-ZVM4U`, `HH-STU-2CTJ3`, `HH-PTY-6GGMB`, `HH-PTY-PF3LJ` all still hold their
original `total_cents` / `balance_due_cents` and still have **no invoice number**.

---

## 9 · What HELD

Saying "I looked and it held" is a finding.

* **Authorization.** `planAccess` is shared by the page and the pay route by design, and
  it holds: a portal cookie for one plan gets **403** on another's pay link; a customer
  asking for a `custom` amount gets **403**. Neither could be talked out of it.
* **The amount never comes from the client.** The only body fields the pay-link route
  reads are `purpose` and the admin-gated `amountDollars`. `PayPanel` contains no
  arithmetic at all — it receives pre-formatted strings. R6 now enforces both.
* **Rule 19 held completely on the arithmetic modules.** Every `insert` / `update` on
  `lib/plan*.ts` destructures and reads its error. This is the second surface in the chain
  where it held, and the first version of my own rule that checked it reported three false
  positives because it sliced away the `const { error } =` prefix — the code was right and
  the rule was wrong.
* **Idempotency.** `isUniqueViolation` checks SQLSTATE `23505` first; the `$0` and
  `payment_status: 'unpaid'` refusals in `recordPlanPayment` are intact and now tested
  from the surface file as well.
* **`total_cents` is correct on every real booking.** For all the ways this surface can
  answer "what is owed", it has never disagreed with itself about what a party costs.
* **The cancelled-plan refusal** in `createPlanPayLink` still refuses and still writes the
  ledger note saying it refused.
* **`/book` still `○ Static`, 7.15 kB, 52,742 bytes served** (measured twice).
  `/plan/[ref]/summary` still `ƒ`. All 13 smoke pages 200.

---

## 10 · What I could NOT verify

* **No end-to-end payment.** The container holds `sk_live` only (`STRIPE_SECRET_KEY`
  prefix `sk_live`, confirmed by key name, not value). Recording a payment against the new
  arithmetic was therefore exercised by unit tests and by the signed-synthetic-event
  harness, not by a real card. This remains the standing needs-Adam for a test key pair.
* **The receipt email.** `sendPlanPaymentReceipt` now reports a balance derived the new
  way, but sending one requires a recorded payment, which requires the above.
* **Whether any customer ever saw the wrong Balance Due.** Only one real plan summary has
  ever been rendered (one invoice number issued), and nginx's window is ten days and shared
  with the whole fleet. The exposure is established from the code and the data; the
  history is not recoverable.
* **The 3% fee question** (§6) — I can state what the code does and what the doc says. I
  cannot state which is intended.

---

## 11 · needs Adam

* **41 — the studio deposit. THIRD recording, and the only one with both numbers and a
  one-line answer.** Is a studio rental's $250 a refundable security deposit held against
  damage (the invoice, `STUDIO_DEPOSIT_IS_SEPARATE = true`) or a reservation payment that
  comes off the total (the column, `COLUMN_FOLLOWS_INVOICE = false`)? It is **$250 on
  `HH-STU-ZVM4U` (party 2026-09-30) and $250 on `HH-STU-2CTJ3`**. Both switches are in
  `lib/planBalance.ts`; setting them to the same reading settles it, and the suite will
  name every row that moves. **Nothing else in this session is blocked on it.**
* **50 — the 3% card fee on deposits.** §6. The locked rule says never; three code sites
  do; one real customer has paid $7.14 of it.
* **51 — 13 real bookings hold a stale `balance_due_cents`, $3,168.00 low.** They are rows
  nobody has paid against, whose column was written as `total − deposit_amount` at quote
  time (with `deposit_amount` itself a mix of the retired 25% rule and the current flat
  $250). Nothing recomputes them until a payment lands, at which point they self-correct.
  Backfilling them is a bulk write over real customers' money and was not done. It is one
  UPDATE once 41 is settled, and it should be done **after**, not before.
* Carried forward, unchanged: a Stripe **test** key pair in the container; what a `refund`
  row reverses.

---

## 12 · Files

**New** — `src/lib/planBalance.ts`, `src/__tests__/lib/planMoneySurface.test.ts`,
`src/__tests__/lib/planBalance.test.ts`.

**Changed** — `src/lib/planInvoice.ts`, `planPayLinks.ts`, `planPayment.ts`, `plan.ts`,
`partyPricing.ts`, `src/types/booking-flow.ts`, `src/app/plan/[ref]/summary/page.tsx`,
`src/app/api/plan/[ref]/pay-link/route.ts`, `src/app/api/portal/pay/route.ts`,
`src/app/api/admin/parties/[id]/route.ts`, `src/app/api/studio-rental/checkout/route.ts`,
`src/app/api/webhook/route.ts`, and four test files.

**Suite 2918 → 2983 green. 0 app `tsc` errors. `npx next build` clean. Deployed
`e160980`; image digest on the box matches the built image.**
