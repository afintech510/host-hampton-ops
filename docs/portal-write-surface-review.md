# The portal write surface — what the customer side can change about its own booking

**Link 21 of the autonomous build chain. 2026-09-13.**
Scope: `/api/portal/*` plus the two token-gated `/api/checkin/[token]` routes — everything the
customer side of this business can change about its own booking, its own money and its own consent.

Link 14 audited what these routes **authenticate**, found an `ilike()` authorization filter that
handed a `%` session 34 real bookings with the children's names on them, and said in its own
write-up that it had not audited what they **write**. Link 20 put them inside its walker and
deliberately outside every behavioural rule, named in the source, so the gap would be visible rather
than quietly skipped. This is that gap closed.

---

## 1. What was measured first

Nothing below was reasoned from source. Every finding was driven against live production with a
minted `hh_portal` cookie on throwaway bookings before a line was changed, and driven again after.

**The surface, walked rather than listed.** The brief named eleven portal routes; the directory
holds eleven portal `route.ts` files and two check-in ones, yielding **19 handlers**. That is the
first brief in four links whose route list survived the directory — but it was checked, not assumed,
and the walker is now a test (`portalWriteSurface` R0) so the next change to the surface has to be
accounted for.

**Real traffic, from the ten-day nginx window (2 – 13 September):**

| route | requests | note |
|---|---|---|
| `GET /api/portal/auth` | 140 | magic-link front door |
| `POST /api/portal/email-auth/verify` | 100 | **all on 12 Sep, all 400/429** — link 14's own concurrency probe, not an attack |
| `POST /api/portal/resend-link` | 16 | |
| `GET /api/portal/my-bookings` | 16 | |
| `GET /api/portal/booking` | 14 | |
| `POST /api/portal/email-auth/request` | 7 | |
| `POST /api/portal/notify-payment` | 4 | all real customers, all 200 |
| `POST /api/portal/pay` | 2 | both from `/party-planner` |
| `POST /api/portal/send-message` | **0** | |
| `POST /api/checkin/…` | 1 | `curl/8.19.0`, 32 `a`s, 404 — somebody probing |

Those numbers are what sized every rate limit below. Link 20's lesson — its first sizing would have
refused a real paying customer's fifth save — is the reason they were measured before being chosen
rather than after.

**Database facts, read from the catalogue (rule 13), not from a comment:**

- `booking_payments_payment_type_check` → `CHECK (payment_type = ANY (ARRAY['deposit','partial','final','refund']))`
- `booking_modifications_modified_by_check` → `customer | admin | system | ADMIN | admin:%`, and `old_data`/`new_data` are `jsonb`
- Status distribution: **10 `awaiting_deposit`, 8 of them with a positive balance**; **16 `cancelled`, 4 with a positive balance** totalling **$47,470**
- **5 bookings carry guest-multiplied line items** (`HH-2026-2926`, `HH-PTY-F47YW`, `HH-PTY-ZPDJQ`, `HH-PTY-BVLMX`, `HH-PTY-JQTVX`); per-head component $0–$200 each
- Largest booking total: **$2,919**. Largest real `guest_count_approx`: **65**. Zero rows with `guest_count_approx = 0`
- **3 bookings have `party_date IS NULL`**, one of them a live `lead` (`HH-PTY-S4RMC`)
- `booking_payments` holds **no row with `amount_cents = 0`**

That last line is rule 17 asked properly, and it answers in the harmless direction: the headline
defect below has **never fired**. It is live on the page today.

---

## 2. The headline: `/my-booking`'s "Pay Deposit" button charged the card and recorded $0

`/api/portal/pay` takes `paymentType` from the request body — the UI really does send it — and
copies it into the PaymentIntent's `metadata.payment_type`. The webhook's
`payment_intent.succeeded` / `party_builder` branch reads the credited figure as

```js
const amountCents = paymentType === 'deposit'
  ? parseInt(m.depositCents || '0', 10)      // ← portal/pay never set this
  : parseInt(m.amountCents  || '0', 10)
```

`/api/checkout` sets `depositCents`. **`/api/portal/pay` sets `amountCents` and never has.**

And `MyBookingContent.tsx:323` **defaults `paymentType` to `'deposit'`** for any `awaiting_deposit`
booking, of which 8 carry a live balance. So the branch the UI selects by default:

- charges the card for real;
- writes `booking_payments.amount_cents = 0` with `total_charged_cents` set to the real figure;
- recomputes the balance as `total − paidSum` with this payment worth **nothing**, so the customer
  pays and still owes the whole amount;
- forces `status` to `pending_review` (demoting an approved party) and sets `party_tags.date_locked`;
- emails the customer **"Deposit Received … $0.00"**;
- emails Adam "Deposit paid".

**Measured in live production before the fix**, on a real PaymentIntent created by the real route:

```
pi_3UFBu502uXWznKaW16Tlhgt4
   status: requires_payment_method | amount: 10197 | livemode: true
   payment_type: deposit
   amountCents : 9900
   depositCents: ABSENT
   WOULD CREDIT: 0   <-- $0 against a real charge
```

`requires_payment_method` means no money moved and none could; it was cancelled immediately
afterwards. Creating an unconfirmed PaymentIntent is exactly what happens when a customer opens the
pay panel and walks away.

**And the second writer is worse.** `/api/party-builder/confirm-session` accepts a `payment_intent`
and reads the same metadata, and it runs **first** — the browser calls it the moment the Payment
Element confirms. A $0 row written there takes the UNIQUE `stripe_payment_intent_id`, so the
webhook's corrected insert is then swallowed as a redelivery and the right figure never lands.

### The fix

`/api/portal/pay` now writes **both** keys with the same figure, and both readers fall back to
whichever key is present rather than crediting zero — belt and braces, because a PaymentIntent
created before the deploy may still succeed. If **neither** key names an amount, the readers now
**refuse** rather than writing a $0 row: the unique index means a $0 row permanently swallows the
correction, which is rule 14's invisible loss rather than an unattributable one.

Re-measured in production after the deploy:

```
pi_3UFBxH02uXWznKaW1GSThPUF
   payment_type: deposit | amountCents: 9900 | depositCents: 9900
   WOULD CREDIT: 9900
```

---

## 3. The shape underneath it: the payment type was never validated

`paymentType` went from the body to Stripe metadata to `booking_payments.payment_type` with no
screen at all. Two consequences, both measured:

**`"not-a-type"` → HTTP 200 and a live PaymentIntent.** Its ledger row would fail
`booking_payments_payment_type_check` (23514) → the webhook returns 500 → Stripe retries forever →
**the card is charged and the payment is recorded nowhere.** Proven twice: once against production
(a live `sk_live` PaymentIntent carrying `payment_type: not-a-type`, since cancelled), and once
against `fakeMoneyDb`, which refuses what Postgres refuses and returned the real SQLSTATE.

**`"refund"` → HTTP 200 and a live PaymentIntent.** This one is sharper because the CHECK *accepts*
it, so nothing downstream would have complained — and `sumPayments()` **subtracts** a `refund` row.
A customer could have paid us and raised their own balance.

The vocabulary now lives once, in `lib/portalWrite.ts`, derived from the constraint text and with
the customer-choosable subset (`deposit | partial | final`) deliberately excluding `refund`. A
present-but-unrecognised value is a 400; an **absent** one is not an error, because
`/my-booking/pay` posts no `paymentType` at all and the route must still derive it.

After: both return `400 {"error":"Unknown payment type. Expected one of: deposit, partial, final."}`
and create nothing at Stripe.

---

## 4. Four cancelled bookings were still taking money

`/api/portal/pay` selected `status` and never read it. Production holds **four real `cancelled`
bookings with a positive `balance_due_cents`** — `HH-PTY-47WQF` ($277), `HH-PTY-29FN9`,
`HH-PTY-AH4AW`, `HH-PTY-N6L8Q` ($1,490 each) — **$47,470 between them**. A customer holding a cookie
for any of them saw a live Pay button, and `/my-booking` would render it.

`recordPlanPayment` at least logs `payment received on CANCELLED plan`. The webhook branch this
route feeds does not, so the charge would have been silent as well as wrong.

Measured before: `POST /api/portal/pay` on a cancelled booking → **200, PaymentIntent created**.
After: **409**, nothing created, on the card branch *and* the Venmo/Zelle branch — a guard on one of
two paths is a guard on nothing. `notify-payment` refuses too: telling a customer "we'll expect your
Venmo" for a party that is not happening is the worst version of that route's failure.

The other direction was checked as well, and it is the expensive one: every status a live booking
actually holds (`awaiting_deposit`, `deposit_paid`, `approved`, `modifications_locked`, …) still
takes money.

---

## 5. The guest count was a money input the customer chose

Link 20's headline was that `unit_price_cents` arrived in the request body. **The multiplier still
did** — through the one route link 20 deliberately left out of its rules.

`loadPlanInvoice()` computes a guest-multiplied line item as
`unit_price_cents × quantity × guest_count_approx`. `/api/plan/[ref]/pay-link` accepts a **portal
cookie** for `purpose: 'deposit' | 'balance'` and derives the Stripe charge from that invoice, as
does `recordPlanPayment`'s `newBalanceCents`. So the chain was:

```
PATCH /api/portal/booking { guest_count_approx: 1 }   →  invoice total drops
POST  /api/plan/<ref>/pay-link { purpose: 'balance' } →  the charge follows it
pay                                                    →  invoice.totalCents − paid === 0 → paid_in_full
```

The bound was `0 ≤ n ≤ 10_000`. **Zero removes every per-head charge from the invoice**; ten thousand
multiplies a $20/head item into a $200,000 one. Measured before the fix: `guest_count_approx: 0` →
**200, written**; `10000` → **200, written**.

The codebase already knew what a guest count is — `lib/plan.ts`, `lib/inquiryDrafts.ts` and
`screenPublicGuestCount` each treat it as a positive number, in three separate places — and this
route, the only one a customer drives, was asking none of them. It now uses
`screenPublicGuestCount` (1…500, seven times the largest real party). Legitimate headcount changes
still work: 1, 6, 19, 65 and 500 all return 200, and the T-7 guest cutoff and T-14 full cutoff still
own the rest of the decision.

**What this deliberately does NOT do** is re-derive `total_cents` / `balance_due_cents` after the
change. Those columns go stale against the invoice, so `/api/portal/pay` (which reads
`balance_due_cents`) and the plan pay link (which reads the invoice) can disagree about what is
owed — by an amount the customer chose. That is the same disagreement as **needs-Adam 41** and it is
a business decision, not a bug to fix silently. See needs-Adam 44.

---

## 6. Nine more findings

1. **A plan with no date answered 500 from its own portal.** `isModificationAllowed` takes
   `partyDateStr: string` and immediately runs `partyDateStr.split('-')`; `bookings.party_date` is
   nullable (3 rows, one a live `lead`) and both handlers passed the column in behind an
   `as string` cast. Rule 8: the cast asserted what the column denies. Measured: `GET
   /api/portal/booking` → **500** before, **200** after.

2. **A cancelled booking was editable.** The date cutoff does not catch it — a booking cancelled six
   months before its date is inside every modification window. Measured: `PATCH` on a cancelled
   booking → 200 before, 409 after. The GET now reports `canEditFull: false` too, because a page
   that offers an editor the server will reject is rule 10 in miniature.

3. **`booking_modifications.old_data` was the literal `null` on every customer edit**, so the audit
   trail recorded that something changed and never what it changed *from*. It now carries the
   before-values, and a guest-count move is named in the `change_summary` a human actually reads:
   `guest count 19 → 23; notes updated (customer, via portal — per-head pricing follows this number)`.
   **My first version of this was wrong**: it built `old_data` *after* the UPDATE. Against a real
   PostgREST client that would have been correct by accident (the read result is a fresh object);
   against the fake, which returns live row references, it recorded the new value as the old one and
   printed `guest count 2 → 2`. The route-level test caught it. Capturing before the write is the
   only ordering that does not depend on knowing which.

4. **Nothing on this surface counted anything.** `send-message` and `notify-payment` each send Adam
   an email **and a billed SMS** on a cookie alone — an unbounded text-bomb for anyone holding a
   stolen or shared cookie. `pay` created unbounded PaymentIntents. `auth` did two reads and a write
   per call. All are now bounded through the one limiter, sized from the traffic table in §1:
   `ownerNotifyRule` (8/caller/hour, 60/route/hour) on the two notification routes, `plannerRule`
   (30/caller/10min) on the interactive ones, `intakeRule` on the two public mailers.

5. **`resend-link` carried a second rate limiter** — a private `Map<string, number[]>` with its own
   window constants and **no eviction**, so every string any caller ever submitted stayed in memory
   for the life of the container. An unbounded memory leak keyed by attacker-chosen input, inside a
   rate limiter. It is now `guardRecipient` in `lib/rateLimit.ts`, sharing that module's swept and
   capped store. The recipient axis is genuinely a different question from the caller axis and both
   are kept: the recipient bucket stops forty texts to one customer from forty proxies, the route
   bucket stops one caller walking forty addresses.

6. **`/api/checkin/[token]` could move `bookings.contact_email`.** That column is exactly what
   `/api/portal/email-auth/request` and `/api/portal/my-bookings` authorize on — sign in with an
   address, receive every booking carrying it. A check-in token is a link in a text message and is
   deliberately not a login, so it could have moved a real booking onto an attacker's address,
   handing over the portal, the receipts, the reminders and every future magic link while the real
   customer silently lost all four. It now only ever **sets** an absent address; a requested change
   is refused, logged, and written to `booking_modifications` where Adam reads it. Consent is
   recorded against the address we already hold, so a rejected change cannot become a new `contacts`
   row claiming an opt-in that person never gave. **This is a judgement call** — a customer
   correcting a typo'd address at check-in now has to ring up. That trade is made deliberately: the
   token was sent *to* that address, so it is the one field on the form that is already known-good.

7. **No bound on any check-in form field.** Every one was `String(body.x ?? '').trim()` straight
   into a `text` column and then into the SignWell agreement. Bounded now.

8. **A pledge was `body.amount_cents as number` with a `> 0` check**, and that figure goes through
   `formatMoney()` into Adam's inbox and into `booking_modifications.new_data` as the record he
   reconciles a real bank transfer against. `0.5` printed as `$0.01`; `1e308` printed as a sentence.
   Now `screenPledgeCents`: a whole number of cents, ceiling $100,000 (34× the largest booking).

9. **Three copies of `(total_cents || 0) − paidSum` in the webhook**, which marks an unpriced lead
   `paid_in_full` — the shape link 18 extracted `computeBalance` to kill. All three now use it.
   **The third was found by this session's own tripwire while the rule was aimed at the other two**:
   I wrote the rule as "neither party_builder branch" and scanned the whole file anyway, and it
   turned up a copy in the studio-rental PaymentIntent branch I was not looking for. The narrower
   rule I meant to write would have passed. It is kept file-wide on purpose.

---

## 7. The tripwire, and what my own attack found in it

`src/__tests__/lib/portalWriteSurface.test.ts` — 34 rules in ten groups, reading the surface off
disk. It follows the house shape: comments stripped before any rule runs (this file's own header
names every defect it tests for, so an un-stripped scan would match its own paragraphs), handler
bodies sliced to the **next handler** rather than by a fixed width, and every anchor tolerating CRLF
because this repo is `core.autocrlf=true`.

There is deliberately **no `.skip` rule** in it: `publicIntakeSurface` R10 already walks every
`*Surface.test.ts` and fails on `.skip` / `xit` / `.todo`, and this file matches that glob. Rule 11 —
the concept has an owner.

R0 classifies by whether a handler **refuses**, not by which helper it imports, and holds the
open list exact in both directions (a stale entry means every rule below is reasoning about a route
nobody can reach). R1 pins the payment-type vocabulary to the constraint. R2 asserts the metadata
keys agree **as values, in a driven request**, because the defect was two keys naming one figure and
only one written — which reads perfectly in the source. R3–R9 cover the cancelled-booking refusals,
the guest-count screen, the nullable date, the `contact_email` move, the single limiter and the
pledge bound.

**Three of its own rules were wrong on the first honest run, and all three were the same family
link 20 named — the rule matched, but not the occurrence that mattered:**

1. **R4 anchored on the wrong occurrence.** Searching for `body.guest_count_approx !== undefined`
   found the **cutoff check** forty lines earlier — the same expression, a different block, nothing
   to do with the screen. It failed here for the right reason and would have passed for the wrong
   one the moment the cutoff check moved. Now anchored on the `if (…)` that opens the assignment
   block, and it asserts the block it found actually assigns the field.
2. **R7 forbade a substring rather than a use.** It banned `${identifier}` anywhere in
   `guardRecipient` and matched it in the **bucket key**, which is the one place it has to appear —
   failing over the only correct line in the function. Now scoped to the log call.
3. **R2's third rule found a real defect the rule was not aimed at** (§6.9), which is the good
   direction of the same phenomenon.

Beyond the tripwire: `portalWrite.test.ts` (18 tests) exercises the screens rather than reading
them — link 17's attack harness had a detector that could not run at all, so all 34 of its mutations
reported "caught". `portalPayRoute.test.ts` (13) and `portalBookingRoute.test.ts` (14) drive the
**real handlers** against `fakeMoneyDb`, which carries the real CHECKs, unique indexes and
SQLSTATEs. Both spread the real `@/lib/portalAuth` in their mocks (rule 7).

**`DEFERRED_TO_NEXT_LINK` is deleted from `publicIntakeSurface.test.ts`.** `/api/portal/*` is now
governed by all 41 of link 20's rules like any other route. One of those rules (R1) was widened to
accept `checkRateLimit` as well as `guardRate`, because `/api/portal/auth` must answer a **redirect**
rather than a JSON 429 — every other exit from that handler lands the browser on a page, and a raw
429 body on a magic link is a dead end for a customer who double-clicked. The widening is paired
with a negative test asserting that route really does redirect and really is counted, so the wider
regex cannot quietly cover for a route that stops calling the limiter.

---

## 8. Every production probe

Three throwaway bookings created by SQL with `invoice_number` left NULL (link 2's trick, so the
sequence is never touched): `HH-PROBE-L21A` (`approved`, $850 balance, one $20/head line item),
`HH-PROBE-L21B` (`cancelled`, $250 balance), `HH-PROBE-L21C` (`lead`, `party_date` NULL). Cookies
minted inside the container with the real `PORTAL_LINK_SIGNING_SECRET` (64 characters — length
printed, never the value).

**Note on method:** the first run went through `https://www.hosthampton.com` and every request came
back **403 with a non-JSON body** — Cloudflare, not the app. Forging `cf-connecting-ip` is what
tripped it. The probe calls the container on its own address (`http://172.18.0.3:3002`, found via
`os.networkInterfaces()`) instead, which is also the honest test: it exercises the app rather than
the edge.

| # | probe | before | after |
|---|---|---|---|
| 1 | `pay` `paymentType=deposit` | **200**, PI `amount 10197`, `depositCents` **ABSENT**, would credit **0** | 200, `depositCents: 9900`, would credit **9900** |
| 2 | `pay` `paymentType=not-a-type` | **200**, live PI created | **400**, nothing created |
| 3 | `pay` `paymentType=refund` | **200**, live PI created | **400**, nothing created |
| 4 | `pay` on a `cancelled` booking | **200**, live PI created | **409**, nothing created |
| 5 | `PATCH guest_count_approx: 0` | **200**, written | **400** |
| 6 | `PATCH guest_count_approx: 10000` | **200**, written | **400** |
| 7 | `GET booking` with `party_date` NULL | **500** | **200** |
| 8 | `PATCH guest_count_approx: 19` (legitimate) | 200 | **200** — the expensive direction still works |
| 9 | `PATCH` on a `cancelled` booking | **200**, written | **409** |
| 10 | audit row after a real edit | `guest_count_approx updated`, `old_data` NULL | `guest count 19 → 23; notes updated (…)`, `old_data {"notes": null, "guest_count_approx": 19}` |

**Five live-mode PaymentIntents were created across the two runs and all five were cancelled.** Every
one was `requires_payment_method` — no payment method attached, so no money could move. They are the
same object a customer creates by opening the pay panel and walking away.

**`/api/portal/notify-payment` and `/api/portal/send-message` were deliberately NOT driven.** Both
email and text Adam on every call, and a probe there is a real interruption on his real phone. They
are covered by the tripwire and by unit tests instead, and that limitation is stated rather than
papered over.

**Cleanup:** all probe rows deleted in FK order. Every count back to the exact pre-probe baseline —
`bookings 61, booking_line_items 206, booking_payments 18, booking_modifications 151, portal_tokens
230, contacts 1220, contact_interactions 143, financial_transactions 1601, probe rows left 0`.
`invoice_number_seq` still `118 / is_called = t`. `agent_memory.updated_at` still spans
`2026-02-18 .. 2026-04-22`.

**Post-deploy funnel:** all 13 pages 200. `/book` still `○ Static`, **52,742 bytes measured three
times**. `docker inspect hampton_website` image id equals `docker images hosthampton-website` id, so
the deploy took; `RestartCount=0`.

---

## 9. What HELD

Worth recording, because most of this surface was already right and three prior links are why.

- **Link 14's authentication work holds completely.** `getPortalBookingRef` and `getEmailFromCookie`
  both carry the expiry inside the signature; the legacy two-part form is honoured only until
  `LEGACY_SUNSET_MS` (2026-10-20); `findBookingsByContactEmail` fetches candidates with `ilike` and
  re-compares in JS. The 100 `email-auth/verify` requests in the nginx window are link 14's own
  concurrency probe and the 429s in them are the claim-first attempt counter working.
- **The five-attempt code lock claims before it compares**, with a conditional UPDATE that both
  increments and enforces. Twelve concurrent guesses now cost twelve attempts.
- **`/api/portal/session-status` checks that the Stripe session belongs to *this* booking**, and
  answers the same 404 for a bogus id as for someone else's session.
- **`/api/portal/booking` GET is an allow-list of columns**, not `select('*')` over a 62-column table
  holding `admin_notes` and payment ids.
- **Rule 12 is applied thoroughly across the surface.** Every read on every handler distinguishes
  "could not read" from "not found", and says so with a 503 rather than a confident false statement.
  I found no missing third outcome on this surface — the first link in eight that can say that.
- **Rule 10's expensive half is already honoured** on `send-message` and `notify-payment`: both
  return 502 with a recorded-but-not-delivered message when neither the email nor the SMS landed.
- **`escapeHtml` is the shared one**, and the customer's free text goes through it before reaching
  Adam's inbox.
- **`/api/portal/auth` gives one answer to every kind of bad link**, closing the ref-enumeration
  oracle, and stamps `portal_tokens.used_at`.
- **`PayPanel.tsx` still posts a `purpose` and never an amount**, and `/api/plan/[ref]/pay-link`
  still refuses `purpose: 'custom'` without an admin credential. Verified.

---

## 10. What I could NOT verify

- **The end-to-end $0 receipt was never driven to completion**, because that needs a real card
  charge against a live key and the money rules forbid it. What was proven is the PaymentIntent's
  metadata in production and the webhook's arithmetic over it, in both directions. The synthetic
  signed-event harness could close this and was not built — the metadata proof is stronger evidence
  than a synthetic event would be, since the real route produced it.
- **`notify-payment` and `send-message` were not driven in production** (they interrupt Adam). Their
  rate limits, status refusal and pledge bound are proven by unit tests and the tripwire only.
- **Whether the rate-limit sizings are right under real load.** They are 2×–150× the measured
  ten-day traffic, but that window is ten days of one small business, and the limiter is in-memory
  in one container and resets on every deploy. A durable limiter is still needs-Adam.
- **Whether `guest_count_approx` moving the invoice without moving `total_cents` has already
  happened on a real booking.** `booking_modifications` holds 45 `customer` rows, but until today
  none of them recorded an old value, so the history cannot answer it. From now on it can.
- **`modifications_locked` as a label.** I concluded the T-14 **date** enforces it and the label
  merely records it, so checking both would be one rule defined twice — but `/api/cron/booking-locks`
  has never run successfully (needs-Adam 35), so no booking has ever received that status from the
  job. The five rows holding it were set by hand. If Adam ever wants a manual lock that is *not*
  date-derived, the label will need enforcing and that is a business decision.

---

## 11. Needs Adam

Carried forward: **41** (`bookings.balance_due_cents` and `loadPlanInvoice` disagree about what a
studio rental owes, by exactly the $250 deposit, on both live rentals). Confirmed again this session:
`HH-STU-ZVM4U` total $475 / balance $225, `HH-STU-2CTJ3` total $1,100 / balance $850 — both exactly
$250 short of the studio rule's "Balance Due = the FULL total". `/api/portal/pay` clamps to
`balance_due_cents`, so a studio customer paying their balance through the portal is charged $250
less than the invoice says. Not fixed, because picking a side is an accounting decision.

**New:**

- **44. The guest count moves the invoice but not the stored columns.** A customer changing
  `guest_count_approx` changes what `loadPlanInvoice()` (and therefore `/api/plan/[ref]/pay-link`
  and the plan summary page) says the party costs, while `bookings.total_cents` and
  `balance_due_cents` stay where they were. `/api/portal/pay` reads the stored column and the pay
  link reads the invoice, so after a headcount change the two disagree. The change is now bounded
  (1…500) and named in the audit trail, but **which number is authoritative is the same question as
  needs-Adam 41** and should be answered once, for both. Affects the 5 bookings with per-head items.
- **45. Four cancelled bookings carry a live balance.** `HH-PTY-47WQF` ($277), `HH-PTY-29FN9`,
  `HH-PTY-AH4AW`, `HH-PTY-N6L8Q` ($1,490 each) — **$47,470**. The routes now refuse to charge them,
  but the column still says money is owed, which means they appear in any future "outstanding
  balance" report. Should a cancellation zero the balance, and do any of these four represent a real
  debt or a real refund owed?
- **46. A customer correcting their email address at check-in now has to ring up.** §6.6 — the
  refusal is the safe direction and the change is recorded for Adam, but if typo corrections turn out
  to be common the alternative is a confirmation step rather than a flat refusal.

---

## 12. Migrations

**None taken.** Nothing in this work needed a schema change; every constraint it relies on already
existed and was read from `pg_constraint` rather than assumed.

`starting_plan/` holds up to **`migration_049_slack_inbound_source.sql`** as of this session's last
`git fetch`, so **050 is the next free number** — and the next link should ask
`information_schema` / `pg_indexes` / `ls starting_plan/` after its own `git fetch` rather than
believing this sentence, which is exactly the mistake link 18 made.
