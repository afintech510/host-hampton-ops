# The public intake surface — attack and repair

**Link 20 of the build chain. 2026-09-13.** Worktree `singing-dawn`.
Main was `91ce257` at the start; the code landed as `d611eef` and `5a96cf8`.
**No migration taken — 049 is the highest applied, so 050 is still free.**
Suite **2666 → 2750 green**, 0 app `tsc` errors, `npx next build` clean,
`/book` still `○ Static` 7.15 kB and serving **52,742 bytes** in production.

Scope: every unauthenticated door a stranger can push a row through, and what
those rows then make every other subsystem do.

---

## 1. What was measured first, and how the brief's list of routes did not survive

The brief named about ten routes. `src/app/api` holds **130 `route.ts` files**, of
which **52** are outside `admin/`, `cron/`, `webhooks/` and `slack/`. Walking the
directory rather than trusting the list is the whole of §1, and it is where four of
the five sharpest findings came from — `boggle-ocr`, `cm-cheer-orders`,
`cm-cheer-order` and `gift-cards/redeem` appear in no prior brief or doc.

The gate on each was then read, and **my first classification was wrong**:
`/api/studio-rental/edit` reads the portal cookie through `getPortalBookingRef`,
which my grep for `verifyPortalSession` missed entirely. Worse in the other
direction, `/api/party-builder/save` *also* calls `getPortalBookingRef` — but only
as a hint about which plan a save belongs to, and proceeds happily without one. A
classifier that called it "gated" would have talked me out of looking at the route
that needed it most. The tripwire's `gateOf()` therefore asks whether a handler
REFUSES without a session, not whether it reads one.

### The database, before anything was concluded (rule 13)

```
booking_line_items   206 rows, 42 bookings, 159 with a pricing_item_id
                     unit_price_cents  -25000 … 97500     quantity 1 … 25
                     price_type        flat | per_person   (nothing else)
                     category          17 distinct slugs, max 20 chars
                     8 rows have a NEGATIVE price, every one category 'discount'
cm_cheer_orders       21 real orders — 15 paid, 6 pending — with each customer's
                      athlete name, parent name, email and phone
gift_cards            1 active card, $40 balance, code HH-43MU-ZN6C
bookings              61; contact_email mixed-case on 9 of them, 0 of those open
coupons               0 rows, ever
triggers on bookings / booking_payments / booking_line_items: one updated_at, no
                      append-only anything
```

Two facts from that table decided the shape of the main fix. **47 of 206 line-item
rows carry no `pricing_item_id` at all**, and of those that do, nine groups
legitimately disagree with the catalogue — "Spa Party" at $650 against a catalogue
$850, "Manicure (1st premium — +$100 upgrade)" at $100 against a catalogue $0 —
because the planner's product IS a bundle-and-upgrade calculus. **Re-pricing from
`pricing_items` would have rewritten real quotes.** So the boundary is a screen,
not a re-price.

---

## 2. The headline: the money was the caller's to choose

```ts
// /api/party-builder/save, /api/party-checkout, /api/studio-rental/{checkout,edit},
// /api/quote/save — all unauthenticated or cookie-only
const lineItems = body.lineItems
const snapshot  = buildPlanSnapshot({ lineItems, guestCount })   // total_cents
await writeLineItems(supabase, booking.id, lineItems)            // unit_price_cents
```

`loadPlanInvoice()` then **re-derives** every invoice, every pay link and every
Stripe charge from `booking_line_items` — correctly, and that is the point. "The
amount is computed server-side from the plan" was true of the arithmetic and false
of the inputs. `bookings.total_cents`, `deposit_amount` and `balance_due_cents`
were whatever the browser sent, and so was every figure downstream of them.

**The sharpest reachable consequence needed only a customer's own portal cookie.**
`/api/studio-rental/edit` derives the rental line server-side from the time window —
it always did — and then sums the caller's add-ons into the same total:

```
addOn.unit_price_cents = -1000000
  → calculateLineItemTotal  = 75000 + (-1000000) = -925000
  → balanceCents = Math.max(0, -925000 - paid)   = 0
  → updateFields.status = 'paid_in_full'
  → updateFields.paid_in_full_at = now()
```

A customer could mark their own studio rental settled. `HH-STU-ZVM4U`'s party is
**2026-09-30**. Driven against a throwaway booking in production (§5, probe A):
that payload is now `400`, twice, and the legitimate add-on beside it still works.

`/api/studio-rental/checkout` has the same exposure pointing the other way: the
Stripe charge is `getDepositCents(totalCents) + fee`, so a negative add-on lowers
what the customer is asked to pay for a real booking.

### `lib/publicIntake.ts`

One screen, applied at the five public entry points, bounded against the shapes the
live table actually holds: integer cents 0 … 1,000,000 per unit; integer quantity
1 … 100; `price_type` from the two values the column contains; `category` a short
slug; `pricing_item_id` a uuid or absent; ≤ 60 items; and a ceiling on the
COMPUTED TOTAL as well, because the multiplier is `unit × quantity × guests` and
all three are attacker-chosen.

**A negative price is refused outright.** Eight live rows have one and every one is
Adam's `discount` — that facility stays admin-only, because a discount a customer
grants themselves is not a discount.

The integer check is not belt-and-braces. `unit_price_cents` is `integer NOT NULL`,
so Postgres refuses `12.5` — but `buildPlanSnapshot` runs BEFORE the line-item
insert and has already written `bookings.total_cents` from the same number. The
result is a booking carrying a total with no items beneath it, which
`loadPlanInvoice` renders as **$0**.

And the refusal names which item and why (`line item 2 (Slime Station): quantity
must be a whole number 1–100`). A bare 400 over a real customer's plan is a lost
sale nobody can debug.

---

## 3. Everything else that was live on this surface

**A guard on one of three paths.** `/api/party-builder/save` decides which plan a
save edits from (1) the portal cookie, (2) `body.bookingRef` — honoured when the
booking's own email matches, which is not a credential — or (3) a prior-plan scan.
Its "never fold into a plan money has landed on" check sat **inside the scan
only**. The other two paths reach a branch that replaces the line items
(`replace: true`) and overwrites `total_cents`; production holds 7 `deposit_paid`,
2 `paid_in_full` and 5 `modifications_locked` bookings. And the one place the check
did exist read `const { count } = await …` with the error discarded, so an
unreadable `booking_payments` made `count` undefined and the save folded itself
into a plan that may well have been paid — rules 12 and 19 inside the guard that
existed to prevent exactly that.

It is applied to whichever ref wins now, has three outcomes, and a public
**reduction** of a paid plan's total is refused with 409 while adding to it stays
allowed, because adding a cupcake to a paid party is the product.

**"What does this booking owe" was answered SEVEN times.** Four of them were in
public routes and two of those wrote `paid_in_full` from it:

```ts
const { data: payments } = await supabase…              // error discarded
const { data: bk } = await supabase…single()            // error discarded
const newBalance = Math.max(0, (bk?.total_cents || 0) - paid)
if (newBalance === 0) { status = 'paid_in_full'; paid_in_full_at = now }
```

`lib/bookingBalance.ts` was extracted by link 18 for precisely this shape and none
of the four used it. A Supabase blip on either read — **or any plan nobody has
priced, which is every lead** — made `max(0, 0 − paid)` zero and settled a booking
on its first $250 deposit. `/api/party-builder/{save,confirm-session}` and
`/api/studio-rental/{edit,confirm-session}` all go through `readBalanceInputs` +
`computeBalance` now, and the guard in front of the write tests `paidInFull`, never
`balance === 0`.

**A default credential was the credential.** `/api/cm-cheer-orders` (GET,
`select('*')`) and `/api/cm-cheer-orders/[id]` (PATCH, sets `paid`/`cancelled`)
each carried their own copy of

```ts
const CM_PASSWORD = process.env.CM_CHEER_PASSWORD || 'cmcheer2026'
return auth === `Bearer ${CM_PASSWORD}`
```

and **`CM_CHEER_PASSWORD` was not set in the container.** So a literal printed in
this repository read 21 real customers' contact details and could mark any order
paid or cancel it. The page was worse: it compared client-side against
`process.env.NEXT_PUBLIC_CM_CHEER_PASSWORD || 'cmcheer2026'`, and a
`NEXT_PUBLIC_*` variable is **baked into the JavaScript every visitor downloads** —
so whatever value it held was published either way.

Three defects in five lines: a default credential in source; the same check written
twice (rule 11, where "is this an admin" was already answered in five places); and
no fail-closed guard, which is what `isAdminAuthorized` documents in a comment four
files away (rule 8, thirteenth occurrence in this chain).

And a sharper framing, found while smoke-testing: **`next.config.js` redirects
`/cm-cheer`, `/cm-cheer/order` and `/cm-cheer/orders` to `/fundraiser` — "retired
but kept in the repo as a template".** The pages were retired; the API routes were
not. The room had been closed off and the door left open with a published key.

**The same shape at scale.** `process.env.PORTAL_LINK_SIGNING_SECRET ||
'dev-secret'` was written out **twenty-seven times** — eleven portal routes, four
webhook branches, `party-builder/{save,load}`, `studio-rental/edit`,
`admin/parties/create`, `cron/send-reminders`, a server page, `checkinAuth.ts`,
`portalLinkMint.ts` and (transitively) `adminSessionSecret`. That value signs every
portal session cookie, every magic link, every unsubscribe link, every tracked link
and every check-in link. Measured: it IS set in production (64 characters), so
nothing has ever been signed with the fallback — but the shape is identical to the
one that turned out to be live one door along. One `portalSigningSecret()` now, in
`lib/portalAuth.ts`, and it THROWS in production.

**Two doors with money behind them and nothing behind the door.**
`/api/gift-cards/redeem` was public, and **nothing in `src/` calls it** — zero
references, zero requests in the ten-day window. What it does is deduct from a
customer's gift card, with the amount supplied by the caller and a free-text
`reference` that goes only to the log, so a successful call leaves nothing tying the
spend to an order. `/api/gift-cards/validate` beside it confirms a code and its
balance for free. `/api/boggle-ocr` was public and billed `ANTHROPIC_API_KEY` per
call on a caller-supplied image, with no size limit, no budget check and no ledger
row, on a box that took **222 probes for `/.env`** in ten days. Both are
admin-gated now. Three requests had reached `boggle-ocr` in the window; all three
answered 502, which is what an open door to a paid API looks like before anybody
uses it deliberately.

**A ticket quantity was never checked.** It is multiplied into the price, into
`overallSubtotalCents` (which the tax and card-fee lines derive from), into
`event_tickets.quantity`, into the Stripe metadata the webhook issues tickets from,
and into `decrement_event_tickets(qty)`. `available_tickets < -5` is false, so a
NEGATIVE quantity passed the stock check — and `decrement_*_tickets(qty: -5)`
**increases** inventory by five. On a FREE event the route skips Stripe entirely and
issues tickets directly, so nothing else stood in the way; on a paid event Stripe
refused the negative amount, which is a guard holding by accident one door along.

**Nothing anywhere bounded how many times a stranger could do any of it.** One
POST to `/api/lead` writes a `contacts` row (which since link 17 really does mirror
into Brevo AND Quo), a `bookings` lead plan, an `ingested_messages` event, a
`contact_interactions` row and an enrollment, then sends two emails through Resend
and an SMS to Adam's phone. See §4 for what was built and the honest limits of it.

**Seven routes answered `{ success: true }` over a lost lead.** `upsertContact` can
return null, `ensureLeadPlan` can return `NOT_CREATED`, `recordInboundEvent` can
fail, the `contact_interactions` insert sat inside a `try/catch` that discarded the
SQLSTATE, and the emails went through `Promise.allSettled` with the results thrown
away. All of that could fail and a visitor was still told *"we received your
message and will get back to you within 24 hours."* Rule 10's expensive half, on
the surface where the thing lost is revenue — the same shape that answered 200 with
a confirmation page over 21 people's unsubscribes.

**`findOpenPlan` matched emails case-sensitively, in the one spelling link 17's
tripwire could not see.** The filter was built as a raw PostgREST string —
`contact_email.eq.${orValue(q.email)}` inside an `.or()` — with the value
lowercased on the way in, against a `text` column where **9 of 61 live rows are not
lowercase**. `contactIdentitySurface.test.ts` R1 fails the suite if any file outside
`lib/contactLookup.ts` filters an email column, and it passed this file for two
links, because R1 looks for `.eq('contact_email'` and no method call appeared at
all. A missed match is not cosmetic: it creates a SECOND plan, which earns its own
agent draft and its own text to Adam's phone — the exact failure the safety note at
the top of `lib/plan.ts` exists to prevent, arriving through a different door.
(Measured: zero of the nine are currently `lead`/`quoted`, so nobody has been hit
by it yet. An admin typing a mixed-case address onto a lead is all it takes.)

The `.or()` is gone entirely. Phone variants go through `.in()`, which PostgREST
parameter-encodes, so `(631) 400-8080`'s parentheses are data rather than syntax —
which also retires `orValue()`, a hand-rolled quoter living forty lines above its
only caller and duplicating `lib/postgrestFilter.ts`.

**The CM Cheer order total, cost and PROFIT all arrived from the browser** and were
written to `subtotal_cents`, `cost_cents` and `profit_cents` as posted. The prices
live in `data-price` / `data-cost` attributes in two page components and nowhere on
the server. They are bounded and cross-checked against the line items now, profit
is DERIVED rather than accepted, and a disagreement is written to `status_note`
where the order book renders it (rule 14) — but the price list belongs on the
server and moving it edits two live order pages, so that is needs-Adam 39.

**Rule 19, swept.** `studio-rental/edit` replaced the line items with a bare
`delete()` followed by an `insert()`, **both errors discarded** — a successful
delete plus a failed insert wipes the customer's invoice, which is exactly why
`writeLineItems` bails rather than inserting on top of rows it could not clear.
That route now uses it, through a new `writeLineItemsResult` with three outcomes,
because `delete-failed` (plan stale but intact) and `insert-failed` (invoice now
EMPTY, rendered as $0) are not the same sentence to say to a customer. Plus: the
`bookings` update in `studio-rental/edit` and `party-builder/save` (no error, no
`.select()`, and the email quotes the total they wrote); the Google Calendar id
write, unchecked, so the next edit creates a second block; `booking_modifications`
in both; `trucker-inquiry` and `fundraiser-inquiry`'s `contacts` business-field
updates; and **six raw `contact_interactions` inserts** where `logInteraction` —
typed against the CHECK constraint, and reporting its refusals — already existed.

**Rule 12, swept.** `party-builder/save` read the existing plan through
`.single()` with the error discarded, and the `else` branch of that read **creates a
brand-new plan** — so a Supabase blip forked a duplicate for a returning customer,
the precise defect the whole plan-matching block exists to prevent. The
`party_tags` re-read beside it, also discarded, would have **wiped
`location_address`** and the rest on a failed read. `gift-cards/validate` answered a
confident `404 Gift card not found` for a read that merely failed, on the same table
where `/redeem` already distinguished the two. `studio-rental/edit` answered 404
"Booking not found" for an unreadable booking. `refBelongsToCustomer` and the
idempotency reads in both `confirm-session` routes discarded theirs.

---

## 4. The rate limiter, and what it honestly cannot do

`lib/rateLimit.ts`: two buckets per rule, per-caller and per-ROUTE.

Cloudflare fronts this site and nginx is configured with `X-Real-IP $remote_addr` /
`X-Forwarded-For $proxy_add_x_forwarded_for` and **no `real_ip_header`** (read off
the box, not assumed). So inside the container `X-Real-IP` is the **Cloudflare edge
address** — trustworthy and shared by a great many real visitors — and the only
header that names the actual visitor is `CF-Connecting-IP`, which Cloudflare sets
and nginx passes through untouched. That makes it **forgeable by anyone who reaches
the origin IP directly with the right Host header**: the same family as
`X-Forwarded-Host` (`lib/publicOrigin.ts`), where a header nginx does not SET is a
header the caller controls.

So the per-caller bucket is a courtesy and the per-ROUTE bucket is the half that
holds. The route ceilings are set two to three orders of magnitude above real
traffic: over the whole ten-day nginx window the busiest public intake route took
**23 requests**.

Three deliberate properties, each of which is a way this could have become an
outage rather than a guardrail:

- **A caller with no usable address header SKIPS the per-caller bucket** rather
  than sharing one called `unknown`. Otherwise a proxy misconfiguration — or a
  future deployment that does not set those headers — would cap the whole site at
  `perCaller` requests per window.
- **It never throws.** `req.headers?.get?.()` is read defensively, because this
  function sits in front of every public write and the cost of being wrong about a
  request's shape is a 500 on the booking funnel.
- **The route bucket is not charged when the caller bucket already refused**, so one
  caller hammering a route cannot exhaust everybody else's allowance.

It is in-memory, in one container. It resets on every deploy and would not be shared
across replicas. A durable limiter means a table and a write on every request to a
surface whose whole problem is unbounded writes; the honest trade is an effective
bound today with its limits written down (needs-Adam 43).

### The allowance was wrong, and only production said so

`intakeRule`'s first numbers were 5 per caller per 10 minutes. After firing the
limiter in production I went back to the nginx log for `/api/party-builder/save`:

```
10/Sep 22:35:02  22:35:36  22:37:26  22:40:48  22:41:24   ← FIVE saves, one visitor, 6m22s
10/Sep 16:03:20  16:03:21  16:04:09  16:04:11             ← four in 51 seconds
```

**5 per 10 minutes would have refused that customer's fifth save mid-plan.** A
throttle that blocks a paying customer is worse than no throttle, and reasoning
about it would not have found this — the log did. `plannerRule` is 30 per 10
minutes and covers the planner, the studio edit, the mileage lookup, check-in and
every checkout/confirm pair; the one-shot forms keep 5, which covers a retry and a
corrected resubmit. `/api/unsubscribe` is exempt on the record and the tripwire
asserts the exemption, because a false 429 on a one-click opt-out is far worse than
the abuse it would prevent.

---

## 5. What was driven in production

All of it against the deployed build, with every write on throwaway rows and every
table restored to its exact pre-probe count.

### Probe 1 — the credential, four directions

```
GET /api/cm-cheer-orders
  Bearer cmcheer2026      (the literal that WAS live)  ->  401
  no credential                                        ->  401
  Bearer <wrong>                                       ->  401
  Bearer $CM_CHEER_PASSWORD                            ->  200
  Bearer $ADMIN_PASSWORD   (Adam's own)                ->  200
```

And `grep -rl cmcheer2026 /app/.next` inside the container returns **nothing** — the
literal is in no built artefact any more.

### Probe 2 — the two doors with money behind them

```
POST /api/gift-cards/redeem, unauthenticated  ->  401
POST /api/boggle-ocr,        unauthenticated  ->  401
```

### Probe 3 — the ticket quantity, both directions, zero writes

The screen runs before the event lookup, so a bogus event id proves the refusal and
the ordering at once:

| `quantity` | result |
|---|---|
| `-5` | **400** `Please choose between 1 and 50 tickets.` |
| `1.5` | **400** same |
| `9999` | **400** same |
| `1` | **404 Event not found** — the legitimate value reaches the lookup |

### Probe 4 — the line-item screen, refusal side, zero writes

`POST /api/party-builder/save`, each naming the offending item:

| payload | result |
|---|---|
| `unit_price_cents: -1000000` | 400 `a negative price can only be entered by Host Hampton` |
| `unit_price_cents: 1e9` | 400 `unit price above the accepted maximum` |
| `unit_price_cents: 12.5` | 400 `must be a whole number of cents` |
| `quantity: -3` | 400 `must be a whole number 1–100` |
| `price_type: 'hourly'` | 400 `must be one of flat, per_person` |

### Probe 5 — the limiter, from my laptop through the real Cloudflare edge

`POST /api/gift-cards/validate` (reads nothing, writes nothing) ×13: requests 1–10
answered 404, **11–13 answered 429 with `Retry-After: 3600`**, and the container
said so:

```
rateLimit: refused gift-cards/validate — caller bucket (10/3600s) for 67.x.x.72 [caller-supplied key]
```

First and last octet only, and it flags that the key came from a header the caller
controls. (An earlier run of this probe was measured on the *previous* build and its
log went with the container when the next deploy recreated it — which is the
documented reset behaviour, observed.)

### Probe A — `studio-rental/edit`, the `paid_in_full` payload

Against a throwaway `HH-STU-PROBE1` (studio-rental, 45 days out) with a minted
`hh_portal` cookie:

| request | result |
|---|---|
| add-on at `-1000000` | **400**, reason names the item |
| add-on at `-1` | **400** |
| **legitimate $100 add-on** | **200** `totalCents 67500, balanceCents 67500, creditCents 0` |
| `guestCount: 99999` | 400 |
| forged cookie | **401** |

Read back from the database afterwards: `total_cents 67500` = the server-derived
rental 57500 + the accepted add-on 10000; `balance_due_cents 67500`;
**`paid_in_full_at` NULL**; `party_tags.location_address` **still `1 Probe Way`** (the
merge that a failed read would have wiped); line items correctly replaced, rental
first. The audit row reads *"Total $675, balance $675"* — the sentence matches the
numbers beside it.

### Probe B — reducing a plan money has landed on

Against a throwaway `HH-PTY-PROBE2` (`deposit_paid`, total $1,000, one real
`booking_payments` row of $250):

| request | result |
|---|---|
| reduce $1000 → $0.01 | **409** *"already has a payment on it, so we cannot lower the total from here"* |
| reduce $1000 → $999.99 | **409** |
| same total | 200 |
| **increase to $1,250** | 200 — the product still works |

Database afterwards: `total_cents 125000`, paid 25000, `balance_due_cents` **100000**
= exactly `total − paid`, `paid_in_full_at` NULL, status still `deposit_paid`. And
the log:

```
party-builder/save: refused a REDUCTION on paid plan HH-PTY-PROBE2 (100000c → 1c) from a public request
```

### Everything restored

`bookings` 61, `booking_line_items` 206, `booking_payments` 18, `contacts` 1220,
`portal_tokens` 230, `contact_interactions` 143, `ingested_messages` 449,
enrollments 120 — **every one back to its exact pre-probe baseline.** Zero rows
matching `%PROBE%` anywhere. `invoice_number_seq` untouched at `last_value = 118,
is_called = t`, so **no invoice number was burnt**. `agent_memory` still spans
2026-02-18 … 2026-04-22 across 44 rows.

Only two `bookings` rows were updated in the twenty minutes covering the probes, and
both were the throwaways — **no real booking was touched.**

Brevo: the probe's `upsertContact` created contact id 959 for
`adam@easternbuilding.supply` with **`lists: []`**, and **list 3 stayed at exactly
944 subscribers / 12 blacklisted**. Consent gating held; the contact was deleted
afterwards (Brevo back to 956) because its `LASTNAME` was a probe string, and the
`contacts` row's name was restored with a conditional UPDATE for the same reason.
No email or SMS reached a customer (`sendEmail: false` on every save probe); no
Stripe object was created; no model call was made; nothing was written to
`marketing_ledger`.

The thirteen-page funnel smoke is 200 across the board and `/book` serves **52,742
bytes**, measured twice.

---

## 6. The tripwire, and attacking it

`src/__tests__/lib/publicIntakeSurface.test.ts` — 40 rules, comments stripped,
function bodies brace-matched from the end of the parameter list, every anchor
CRLF-tolerant. Eleven groups: the walker (R0), the rate limit (R1), the line-item
screen and its ORDERING (R2), one balance definition (R3), money-has-landed (R4),
read-your-error (R5), credentials (R6), ticket quantities and route exports (R7),
what actually got recorded (R8), column allow-lists (R9), and the email filter (R10).

`/api/portal/*` is inside R0's walker but deliberately outside the behavioural
rules, with the exclusion named in the source: link 14 audited what those routes
authenticate and nobody has audited what they WRITE. An exclusion nobody can see is
how a rule ends up matching nothing and passing.

Beside it, `publicIntake.test.ts` (24) and `rateLimit.test.ts` (19) drive the real
functions — including a case built from seven real production line-item shapes that
must all survive, because a screen that refuses everything breaks the funnel.

### Then it was attacked: 44 mutations, six holes on the first honest run

`scripts/attack-intake-tripwire.js` reintroduces every defect above one at a time,
verifies the mutation landed on disk with CRLF **and** LF anchors, runs the suites,
and restores on every path including SIGINT. It refuses to run unless the clean tree
is green.

**All six holes were the same family — link 16's "a rule satisfied by a different
occurrence than the one that broke" — and all six were in my own tripwire:**

1. *The screened result is used.* The rule asked whether `screened.lineItems` OR
   `screened.ok` appeared anywhere; `screened.ok` is in the refusal check, so
   changing `const addOns = screened.lineItems` to `body.lineItems` stayed green. It
   counts mentions of the raw field after the screen now.
2. *`total_cents || 0`.* The anchor required them adjacent, and
   `((inputs.row.total_cents as number) || 0)` walked through — **a cast is enough to
   defeat a tight anchor.**
3. *The `paid_in_full` guard.* The rule asked whether `computeBalance` and
   `paidInFull` appeared in the body, and both do, in the destructure, whatever the
   guard beside them says. `if (paidInFull)` → `if (newBalance === 0)` stayed green.
   The guard's own condition is sliced from its `if` to its `{` now.
4. *`moneyHasLanded`'s third outcome.* Deleting `return 'unknown'` left `'unknown'`
   in the return **type annotation** `Promise<'yes' | 'no' | 'unknown'>`, which
   satisfied the rule. A type is not an outcome; the body after the arrow is sliced.
5. *The owner-email index.* Sliced each `resend.emails.send({` for a fixed 400
   bytes, which spilled into the NEXT send — so `results[1] → results[0]` on
   `fundraiser-inquiry`, **the exact slip my own codemod made for real earlier in
   this session**, found `ownerEmail()` in the overlap. Each send is sliced to the
   start of the next one now, and the other sends are asserted NOT to be the owner's.
6. *A skipped rule.* Turning one `it(` into `it.skip(` in
   `contactIdentitySurface.test.ts` left every string my meta-assertion greps for
   exactly where it was. **Grepping a rule's content cannot tell you it has been
   turned off.** A new rule fails the suite if any `*Surface.test.ts` contains
   `.skip`, `xit` or `.todo`.

Then a seventh, found while repairing the third: the fixed rule matched only
`status: 'paid_in_full'` as an object property, and
`party-builder/confirm-session` writes `updateFields.status = 'paid_in_full'` — an
**assignment**. The rule skipped the one handler the harness mutated and passed by
not looking. Both spellings now, plus a count assertion so a vacuous version fails.

**44/44 caught after the repairs**, with one documented expected miss (a duplicate
of the ticket ceiling under a *different name* is outside what a name-based rule can
see), and the restored tree is green.

---

## 7. What HELD

Reporting only what broke would overstate the state of this surface.

- **The ticketing money path derives its prices server-side and always did.**
  `cart-checkout` and `events/checkout` read `events.price_cents`, the variant, the
  session override and the bundle tier from the database and apply
  `saleAdjustedCents` — the client chooses *what*, never *how much*.
- **`vendor-registration`, `gift-cards/checkout` and `/api/checkout` bound their
  amounts server-side.** The vendor fee is two constants; a gift card is clamped to
  $25–$500; the deposit comes from `booking_types.deposit_cents`.
- **`/api/summer-hair/book` is the best-validated route on the surface** — services
  against an allow-list, party size 1–10, the time slot against a computed list —
  and its GET returns only slot availability, never a name or a number, though the
  table holds 16 real people's PII.
- **`party-builder/mileage` keeps the rate and the mileage server-side** and returns
  only a dollar amount, exactly as its comment claims.
- **`party-builder/confirm-session` and `studio-rental/confirm-session` cannot
  fabricate money**: both gate on `metadata.type` and on Stripe's own
  `payment_status`/`status`, and every amount comes from metadata the server set at
  checkout time. The defects there were in the balance arithmetic, not the trust
  boundary.
- **`escapeHtml` / `mailToHref` / `telHref` are applied correctly on every intake
  email** — link 13's work is intact across all seven forms, and `publicOrigin` is
  used wherever a link is built.
- **`/api/signup` has never run.** Zero contacts carry `source_detail` like
  `%signup%`, `coupons` holds zero rows ever, and the table WOULD accept what the
  route writes — so this is "never ran", not "could not have run" (rule 17's
  distinction, in the harmless direction). Its hard-coded `marketingConsent: true`
  has therefore never made a false consent statement about anybody.
- **`upsertContact`'s case-insensitive identity held under a real public write.**
  The probe saves resolved `adam@easternbuilding.supply` to the existing row and
  `contacts` stayed at 1220 — link 17's fix working on the surface where those rows
  are created.
- **Every prior tripwire still passes**, including `publicOrigin`, `emailSafety`,
  `portalAuthSurface`, `signwellSurface`, `stripeWebhookSurface`, `adminSurface` and
  `cronSurface`.

---

## 8. What I could NOT verify

- **Whether anyone ever used `cmcheer2026`.** The nginx window is ten days and holds
  zero requests to `/api/cm-cheer-orders`; the 21 orders were created in March,
  April and August 2026. Whether the published literal was ever used by somebody who
  should not have it cannot be established from a ten-day log, and nothing else
  records a read.
- **Whether any customer has been refused by the rate limiter in normal use.** It
  has existed for under an hour. The sizing is measured against the ten-day log, but
  the only honest check is the next week of `429`s in `docker logs`. If a real
  customer hits one, the log line names the route and the bucket.
- **The negative-add-on payload was never fired at a REAL studio rental**, only at a
  throwaway. Both live studio bookings hold signed SignWell documents and one has a
  party on 2026-09-30; proving a fix by risking that row is not a trade worth taking.
- **`/api/cm-cheer-order`'s total cross-check was not driven in production.** Doing
  so means writing a row into a table of 21 real orders for another business's
  storefront. It is covered by unit tests against the real item shapes.
- **`writeLineItemsResult`'s `insert-failed` branch** — the one where the delete
  succeeded and the invoice is now empty — is proved against a fake, not by forcing a
  refused insert in production.
- **Whether `guestCount` above the ceiling gives a good message.** It answers 400,
  but with *"Missing time or guest count"* rather than something about the number,
  because the screen returns null and the existing falsy check catches it first.
  Correct refusal, imprecise sentence.
- **The per-caller bucket's forgeability was reasoned from the nginx config, not
  exploited.** Sending a forged `CF-Connecting-IP` to the origin IP directly would
  prove it; the origin IP is not something to start probing from outside.

---

## 9. Needs Adam

**39. The CM Cheer / LI High price list lives only in the markup, and the API is
still open while the pages are retired.** `total`, `totalCost` and `totalProfit`
arrive from the browser on `POST /api/cm-cheer-order`; they are bounded and
cross-checked against the line items now, profit is derived, and a mismatch is
written to `status_note` — but the real fix is a server-side catalogue, and the
prices exist only as `data-price`/`data-cost` attributes in `/cm-cheer/page.tsx` and
`/li-high/page.tsx`. Moving them edits two live pages. Separately:
`next.config.js` redirects all three `/cm-cheer/*` pages to `/fundraiser` as
"retired", while `/li-high` still serves and `POST /api/cm-cheer-order` is still a
public write door into a table of 21 real customers. **Should that route be closed,
or is LI High still selling?**

**40. The order book page is currently unreachable, and its password has changed.**
`CM_CHEER_PASSWORD` is now set in `/opt/hosthampton/.env` (24 characters; I have not
printed it anywhere) and the old `cmcheer2026` is dead. Anyone who used it needs the
new value — or, better, an admin login, which now works on those routes. And
`/cm-cheer/orders` redirects to `/fundraiser`, so the page cannot be opened at all
until that redirect goes. Both are your call.

**41. `bookings.balance_due_cents` and the invoice disagree about what a studio
rental owes, by exactly the deposit.** `lib/planInvoice.ts` is explicit that for a
studio rental Balance Due is the FULL total and the deposit is separate and not
deducted. The `bookings` column says `total − deposit`. Measured on both live
rentals:

| ref | total | deposit | column says | invoice says |
|---|---|---|---|---|
| `HH-STU-2CTJ3` | $1,100 | $250 | **$850** | $1,100 |
| `HH-STU-ZVM4U` | $475 | $250 | **$225** | $475 |

Neither has paid yet, so nobody has been asked the wrong amount in a transaction —
but the customer portal renders the column and the invoice document renders the
other. Which is the rule is a decision about what a studio customer owes, so I have
not changed it.

**42. `/api/signup` records `marketingConsent: true` for everyone, in code.** The
form is a "sign up for 10% off" sheet so consent is arguably implied, but the
assertion is made by the route rather than by the person, and now that the Brevo
mirror works it would add them to the 944-person list. It has **never run** (§7), so
nothing has happened; worth a ruling before it does. It also mints an unbounded
number of 10%-off coupons, now rate-limited but not otherwise capped.

**43. The rate limiter is in-memory and resets on every deploy.** Effective today,
and the route ceilings are the half that cannot be forged — but a durable version
needs a table and a migration. Say the word if you want it.

*Not blocking, and already actioned:* nothing in §2–§6 needed a price, a business
rule or a credential I did not have.

---

## 10. Housekeeping

- **No migration taken. 049 is the highest applied; 050 is free.** Verified against
  `starting_plan/` after a `git fetch`, not from a handover note.
- **One new environment variable: `CM_CHEER_PASSWORD`**, in `docker-compose.yml`,
  `/opt/hosthampton/.env` and the AGENTS.md §7 table. Never printed.
- **Nothing written to `marketing_ledger`** — no model call, no SMS, $0 spent.
- **No email or SMS reached a customer.** Every save probe used `sendEmail: false`.
- **`invoice_number_seq` untouched** — still `last_value = 118`, `is_called = t`, so
  the next issued number is still `444124-000119`.
- `audit_scratch/` and `services/website/scripts/attack-intake-tripwire.js` are
  untracked on purpose, per the do-not-commit list.
- **Two notes for whoever edits next.** The Bash tool ate backticks out of a
  double-quoted `node -e` twice this session and backslashes out of a heredoc once,
  each time producing a patch that applied and was wrong — the same trap that has now
  cost five consecutive links time; use the Write/Edit tools for anything containing
  `` ` `` or `\`. And this repository is `core.autocrlf=true`: a fresh worktree gets
  CRLF while the main checkout may hold LF, which is how link 19's
  `summer-hair-reminders` rule silently stopped checking in every worktree the chain
  works in. It is fixed, and every anchor I wrote tolerates both.
