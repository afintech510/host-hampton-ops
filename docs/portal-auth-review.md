# The customer portal and the `/plan` auth surface — attacked and repaired

**Link 14 of the build chain. 2026-09-12. No migration — 046 is still free.
Suite 1985 → 2111 green.**

Scope: `lib/portalAuth.ts`, `lib/checkinAuth.ts`, `lib/planAccess.ts`,
`lib/contactLookup.ts`, all eleven routes under `src/app/api/portal/`,
`/api/plan/[ref]/{pay-link,email-me}`, `/api/checkin/[token]`,
`/plan/[ref]/summary`, `/my-booking/*`, and the `portal_tokens` /
`email_auth_codes` / `checkin_tokens` tables.

This is the only authentication surface in the product no link had attacked,
and it sits on the money path. Link 13 found three defects in it *without
looking for them*, which is what made it the pick.

---

## 1. The measurement, before anything else

Everything below was measured on the live database and the live site first.
Three of the brief's own starting facts did not survive that, and one of them
was mine to correct rather than inherit.

| question | answer |
|---|---|
| `portal_tokens` rows | **230**, 118 unexpired, across 39 bookings — one booking holds **15 live tokens** |
| `portal_tokens.used_at` written, ever | **0 of 230.** The column has existed since the table did |
| `email_auth_codes` rows, ever | **2**, both on 2026-05-25, the day it was built |
| `checkin_tokens` | **0**, as link 10 said and for the reason link 10 gave |
| `bookings` | 61, of which 16 cancelled |
| `bookings.contact_email` **not lowercase** | **9 of 61** — two `deposit_paid`, one `approved`, two `modifications_locked` |
| `bookings.event_type` distinct values | **10**, including `Kids Birthday Party` and a row whose `event_type` is a sentence |
| `bookings` columns | **62** |
| `bookings.admin_notes` non-empty | **12 rows** |

**The brief's table name was wrong and it mattered.** There is no
`email_login_codes`; the table is `email_auth_codes`. And **link 13's handover
was mechanically right and materially wrong**: it listed
`/api/portal/email-auth/request` and `/verify` as `.eq('email', …)` sites that
"may be a real login failure for the 21 mixed-case contacts". They are not.
Both `.eq('email', …)` calls are on `email_auth_codes.email` — a column *we*
write, always lowercased, our own index into our own table. Those two routes
were the **case-insensitive** half of the login.

The case-sensitive half was somewhere else entirely, and it is the half
customers actually use.

### Rule 17, asked properly

`email_auth_codes` holding 2 rows since May could mean "nobody uses it" or
"every insert is refused". So the table was asked whether it would accept one:
it does — a row was inserted, verified and consumed in production during this
review. **The 6-digit-code login is not broken; it is unreachable.**
`/my-booking/login` posts to `/api/portal/resend-link` and nothing in the app
ever calls `email-auth/request`. There is no UI for it.

Which means: **the only sign-in a Host Hampton customer can reach is the one
with the case-sensitive lookup in it.**

---

## 2. The finding that matters most: a session cookie that was a LIKE pattern

`/api/portal/my-bookings` decided which bookings to return like this:

```ts
const email = getEmailFromCookie(req.headers.get('cookie'), secret)   // signed
…
.ilike('contact_email', email)          // ← the authorization filter
```

PostgREST passes an `ilike` pattern straight to `LIKE`, where `%` is a wildcard
run and `_` is any single character. So the filter is not "this customer's
bookings" — it is "every booking matching this pattern".

Driven against production **before** the fix, with the cookie forged using the
real signing secret so the signature check was genuinely satisfied:

```
cookie email = %@gmail.com    -> 200   27 bookings
cookie email = %              -> 200   34 bookings   ← every kids party in the database
```

Thirty-four real customers' bookings: `booking_ref`, the **child's name**, party
date and time, package, total and balance due. Returned to a caller holding one
session.

**And the first half of the chain is a public, unauthenticated POST.**
`/api/portal/email-auth/request` validated the address as
`includes('@') && length >= 5`, so `%@gmail.com` passed, and *its* lookup was
`.ilike('contact_email', rawEmail)` too — which matched 40 of 61 bookings, so
the route concluded a booking existed and **minted a real `email_auth_codes`
row for the string `%@gmail.com`.** Confirmed: that row was in the table
afterwards and had to be deleted.

The only step left between an attacker and those 34 bookings is guessing a
six-digit code. Which brings us to the second finding.

### The shape underneath it

The **POST handler in the same file**, forty lines below, compares the two
addresses like this:

```ts
if (!booking || (booking.contact_email || '').toLowerCase() !== email.toLowerCase())
```

Exact, case-insensitive, correct. One file, two answers to "is this the same
person", and the one nobody checked was the one that decided what a customer
could read. That is rule 11 in its purest observed form so far.

---

## 3. The five-attempt lock did not bind

`/api/portal/email-auth/verify` read `attempts`, compared the code, then wrote
`attempts + 1`. Check-then-act, straddling exactly the thing it was limiting.

Measured in production, twelve concurrent wrong codes against one live code row:

```
statuses  : 400 ×12
attempts  : 3          ← the counter, after twelve guesses
```

All twelve compared a code; three were counted. So the "5 attempts" guarantee
held only for a customer who waited their turn. An attacker firing in parallel
had the full fifteen-minute TTL against a 10⁶ space — and the separate
three-codes-an-hour limit is keyed on the email **string**, so `%`,
`%@gmail.com`, `%a%` and so on each get their own bucket for free.

The sequential path, exercised in the same run, was correct throughout — locked
at 5, consumed at 6, "code expired or not found" at 7. Both directions.

**Fixed** with the claim discipline `scheduled_reminders` and
`email_sequence_sends` already use: one conditional UPDATE taken **before** the
comparison.

```ts
.update({ attempts: row.attempts + 1 })
.eq('id', row.id)
.eq('attempts', row.attempts)   // nobody else has guessed since we read
.lt('attempts', maxAttempts)    // and we are still inside the budget
.select('id, attempts').maybeSingle()
```

Zero rows back means somebody else's guess got there first, which is precisely
what should stop this one. Re-driven after deploy with **sixty** concurrent
requests:

```
60 requests -> 5 actually compared a code
               32 refused at the claim (429)
               11 told the code was locked
attempts recorded: 5 | consumed: true
```

**A code can now absorb at most five evaluated guesses however many requests
arrive.** A correct code also burns an attempt, which is harmless because a
correct code is consumed on the same request — verified: the real code still
returns 200 with a session, and a replay of it returns 400.

---

## 4. The only login the site offers could not find nine of its customers

`/api/portal/resend-link` — the endpoint behind the "Email me a link" button on
`/my-booking/login` — looked the address up with

```ts
.eq('contact_email', email.toLowerCase().trim())
```

`bookings.contact_email` is plain `text` holding whatever the customer typed.
Running the route's own query against every mixed-case booking in production:

| booking | status | `.eq()` rows | `ilike` rows |
|---|---|---|---|
| `HH-2026-2805` | **deposit_paid** | 0 | 1 |
| `HH-2026-7036` | **deposit_paid** | 0 | 1 |
| `HH-PTY-F47YW` | approved | 0 | 1 |
| `HH-PTY-7XCD8` | modifications_locked | 0 | 1 |
| `HH-PTY-2Y9UE` | pending_review | 0 | 1 |
| `HH-PTY-Q387U` | awaiting_deposit | 0 | 1 |
| `HH-VND-5439` | confirmed | 0 | 1 |
| `HH-PTY-AATJT` | awaiting_deposit | 1 | 1 |
| `HH-PTY-Q8FKB` | modifications_locked | 1 | 1 |

**Seven real customers, two of whom have paid a deposit, typed their address
into the only login on the site and got nothing.** The route answers
`{ok:true}` unconditionally — deliberately, as anti-enumeration — and the page
then says *"Check your email!"*. That is rule 10's expensive half on the surface
where the customer sits and waits, and it is the same defect as the unsubscribe
endpoint answering 200 over a write that never happened, on a worse surface.

The saved-quote fallback in the same route used `.eq('email', …)` on `contacts`,
so the 21 mixed-case contacts lost that too.

**Fixed** by `findBookingsByContactEmail()`, added to `lib/contactLookup.ts`
beside `findContactsByEmail` so the concept has one home. It uses `ilike` to
fetch **candidates** and re-compares every one exactly in JS — which is what
also closes §2, from the other side.

---

## 5. Fifteen live bookings were invisible to their own owners

`/api/portal/my-bookings` also carried:

```ts
.in('event_type', ['kid-party', 'kids-party', 'kids_party'])
```

Measured against the column:

| event_type | rows | in the list? |
|---|---|---|
| `kid-party` | 25 | yes |
| `kids-party` | 9 | yes |
| `kids_party` | **0** | yes — a spelling that has never existed |
| `room-rental` | 9 | **no** |
| `Kids Birthday Party` | 5 | **no** |
| `mobile party` | 4 | **no** |
| `kids-birthday-party` | 3 | **no** |
| `studio-rental` | 2 | **no** |
| `vendor_registration` | 2 | **no** |
| *a full sentence about Christmas photoshoots* | 1 | **no** |

**Fifteen non-cancelled bookings**, including eight that really are kids
parties, were hidden from the customer who owns them. They signed in
successfully and were shown an empty list — the same "a confident absence"
defect as link 8's admin pipeline filter showing 32 of 41 rows, but this one
faces the customer. A hand-written list of a free-text column's values is rule
13: a constraint asserted in code and declared nowhere.

**Fixed** by deleting the filter. A customer is entitled to every booking under
their own address; `cancelled` is the only exclusion left. Verified live after
deploy on a `room-rental` row (see §9).

---

## 6. The session cookie that never expired

```ts
buildPortalCookieValue = (ref, secret) => `${ref}:${HMAC("cookie:" + ref)}`
```

Nothing in that varies. Measured in production: two derivations 1.1 seconds
apart are **byte-identical**. So:

- `Max-Age=30 days` was a hint to the browser and nothing else. A copy of the
  value taken anywhere — a shared laptop, a proxy log, a screenshot —
  authenticated that booking **forever**.
- There is no revocation. `getPortalBookingRef` reads no row, so deactivating
  nothing helps; the only kill switch is rotating
  `PORTAL_LINK_SIGNING_SECRET`, which AGENTS.md §7 tells you not to do because
  it also invalidates every outstanding unsubscribe link and tracked link.

`hh_portal_email` had the same shape. **And `lib/adminAuth.ts` had already
solved this** — `hh_admin` carries its issued-at *inside* the signed payload
precisely so a client cannot extend it, and its own header comment explains
why. The portal, the older surface, never got it. Rule 11 again.

**Fixed** by adopting that exact payload shape, `<subject>:<issuedAtMs>:<sig>`.

**The legacy form is still accepted, until a date in code.** Rejecting it
outright signs out every customer holding a live session, on the revenue path,
to close a hole that requires the cookie to have been stolen already. So a
two-part cookie is honoured until `LEGACY_SUNSET_MS` (2026-10-20, a full cookie
lifetime past the deploy), by which point every browser has either been
re-issued a v2 cookie on its next authenticated request or dropped the old one
on its own `Max-Age`. **After that date the old form is simply invalid and no
deploy is needed to make it so.** That trade is stated rather than hidden: for
five weeks a stolen pre-2026-09-12 cookie still works.

Verified after deploy: fresh → 200, 29 days old → 200, 31 days old → 401, a
timestamp edited forward → 401, a v2-shaped value carrying the legacy signature
→ 401, a legacy cookie inside the sunset → 200.

---

## 7. The rest, in the order they were found

**`/api/portal/booking` answered `select('*')` — 62 columns to the customer.**
Confirmed live with a real portal session: the payload carried `admin_notes`
(12 rows hold one; they are Adam's internal notes *about that customer*),
`approved_by`, `options_locked_by`, `quote_snapshot`, `portal_token_hash`,
`stripe_payment_intent_id`, `stripe_session_id`, `google_calendar_event_id`,
`signwell_document_id` and `security_deposit_pi_id`. The check-in route **next
door** already had a column allow-list, under the comment *"Only ever expose
these. The booking row holds pricing, admin notes and payment ids."* The
codebase knew, in a comment, in an adjacent file, reading the same table for the
same audience. Now an allow-list (45 keys), so a column added by the next
migration is private until somebody decides otherwise. `booking_payments` and
`booking_modifications` were narrowed too — the latter was returning `new_data`,
which holds the full body of every message.

**`/api/portal/auth` was a booking-ref oracle.** Measured before the fix:

```
?ref=HH-2026-0001  -> error=not_found     (no such booking)
?ref=HH-PTY-Q8FKB  -> error=expired       (a real customer's)
```

Unauthenticated, unthrottled, over a structured ref space (`HH-2026-NNNN` is
10,000 wide). `/review/[token]` was deliberately built the other way — *"an
expired link is a 404, like a wrong one, because 'this link expired' confirms
the draft exists"* — so this is the same decision made twice, differently. All
link failures now answer `expired`, whose copy on the login page was already
right for every case.

**`portal_tokens.used_at` had never been written.** 230 rows, zero values, so
nothing could answer "has this emailed link been opened, and when". Deliberately
**not** made single-use — a magic link lives in an email a customer re-opens,
and burning it on first click turns every second visit into a support call. What
single-use would have bought is visibility, and stamping the column buys that
without the cost. Verified after deploy: `used_at` is now written.

A related piece of waste: `/api/portal/my-bookings` POST minted a
`portal_tokens` row on every plan switch and then discarded the raw token
(`void rawToken`) under a comment saying it was "so admin/manual links keep
working". A token whose plaintext nobody kept can never be matched by
`/api/portal/auth`; the row was unreachable by construction. Removed. It is a
large part of why one booking carries 15 live tokens.

**`/api/portal/session-status` retrieved any Stripe session id it was handed.**
The portal cookie was checked, but never that the Stripe object belonged to that
booking — so any authenticated portal customer could read the status of any
checkout session on the account, and a malformed id produced a bare 500. It now
requires `metadata.booking_ref` to match the session's ref, and answers the same
404 for "not yours" and "no such id" so it cannot be used as a probe. A session
with no `booking_ref` — a hand-made Payment Link in the Stripe dashboard, which
is exactly what produced the lost $927 — belongs to nobody's portal.

**`/api/portal/pay`'s clamp had a hole.**
`Math.min(amountCents, booking.balance_due_cents || amountCents)` reads as a
clamp and is one, until `balance_due_cents` is `0` or `NULL`, when `||` falls
through to the caller's own figure and the clamp clamps to itself. A plan owing
nothing would charge whatever the request body asked for, and `tipCents` had no
ceiling at all. Now: no balance means nothing to pay (409), and the tip is
bounded.

**Rule 12, swept.** Eleven lookups across the surface discarded their read error
and reported a Supabase blip as a fact: `/api/portal/auth` told a customer their
valid link had expired *and* that their booking did not exist; `send-message`
404'd an authenticated customer (link 13 left this one deliberately);
`my-bookings` GET rendered "no parties" over a failed read, and its POST said
"not your booking"; `booking` GET/PATCH, `notify-payment`, `pay`,
`email-auth/verify` and `resend-link` the same. All now have three outcomes.

**Rule 19, swept.** Nine writes discarded their SQLSTATE — including the
`booking_modifications` audit insert in `send-message` (link 13's other
left-behind) and in `notify-payment`, where that row **is** the record of a
customer's payment pledge; and the `email_auth_codes` insert in
`email-auth/request`, which meant a code that was never stored could be mailed
and the customer told to go and find it.

**Rule 10, swept.** `send-message` and `notify-payment` returned `{ok:true}`
over an unset `RESEND_API_KEY`, a Resend rejection and an SMS the provider
refused. The portal says "Message sent!" on that. Both now report what actually
left, and a 502 when nothing did — the message is still recorded on the booking
either way, so nothing is lost, but nothing is claimed either.
`email-auth/request` now answers 503 rather than "check your email" when the
send failed, and retires the code nobody can have received. That 503 is a weak
enumeration signal (only an address WITH a booking reaches it) and the trade is
made deliberately: a customer who cannot sign in and is told they can is worse,
and the two branches already differed by a live API call's worth of latency.

**`notifyOwnerSms` counted attempts, not deliveries.** It returned
`phones.length` and discarded every per-send result, and `sendSMSVia` resolves
`null` on a provider rejection rather than throwing. Same defect as the campaign
sender's `total_recipients` and the reminder engine's `status='sent'`: a counter
is only as good as what it is told. It now returns what the provider accepted,
which is what makes the two rule-10 fixes above mean anything.

**`/api/checkin/[token]` demoted paying customers.** Its `.eq('email', email)`
against a lowercased input missed the 21 mixed-case contacts, so `existing` came
back null and the status/source restore below it never ran — meaning
`upsertContact`'s unconditional `status: 'lead'` stood, and somebody who had
already booked and paid was reset to a lead by checking in. Link 9 fixed this
shape in `upsertContact`'s other callers; it did not reach here. The same file
also carried a comment asserting *"bookings has no contact_id column (migration
004 recreated the table without one) … Don't add a second link"* — **migration
035 §9 added `bookings.contact_id`** and the column is right there in
`information_schema`. Rule 13: a constraint asserted in a comment and
contradicted by the schema is worse than no comment, because it is instruction.

**The Venmo number was the wrong number.** `/api/portal/pay` told the customer
*"contact Allie at (631) 998-9325 for the handle"* — the public line, which
**finds nothing in Venmo** — for a fact we already hold in `VENMO_HANDLE` and
`ZELLE_PHONE` in the container. The correct number existed in the codebase as a
bare literal, twice, inside `lib/emailTemplates.ts`. Now one module,
`lib/paymentContacts.ts`, with the env vars winning and the live values as
defaults.

**`/api/portal/resend-link` 500'd on junk.** `{"email":123}`, `{"email":{}}` and
a non-JSON body each crashed the public login endpoint, because
`await req.json()` was unguarded and `email.toLowerCase()` assumed a string. Not
a security hole; it is the front door falling over. All four now 400.

---

## 8. What HELD, reported because it is worth knowing

These were attacked and did not move. Stating them is the other half of the job.

- **Cross-booking authorization.** A portal cookie for plan A gets 404 on
  `/plan/B/summary` and 403 on `/api/plan/B/pay-link`. `planAccess()` is one
  function used by the page and the money route, which is why they cannot drift.
- **The admin `custom` amount** stays admin-only: a customer cookie asking for
  `purpose: 'custom'` is 403 before Stripe is touched.
- **The redirect allowlist on `/api/portal/auth`.** `/plan/<otherRef>/summary`,
  `https://evil.example.com/x`, `//evil.example.com` and `/admin` all fall back
  to `/party-planner`; `/plan/<thisRef>/summary` is honoured. The design — match
  against the ref *this request just authenticated* — is sound.
- **The cookie signature.** A garbage signature, a missing signature, a
  signature minted for another booking, an empty ref and a four-part value are
  all refused.
- **Link 13's forwarded-host fix**, re-verified independently of its author:
  `X-Forwarded-Host: evil.example.com` does not move the 307, and
  `X-Forwarded-Host: localhost` does not get a cookie without `Secure`.
- **The login code is bound to its address.** The right code submitted for a
  different address is refused; a consumed code cannot be replayed.
- **Cookie flags**, read off a real production response:
  `HttpOnly; SameSite=Lax; Path=/; Secure; Max-Age=2592000` on both.
  `SameSite=Lax` is what makes the cookie-authorized POSTs non-CSRF-able.
- **The magic link itself was never leaked by the forwarded-host bug**, because
  `buildPortalUrl` uses `CANONICAL_ORIGIN`.

---

## 9. The tripwire, and the two holes the attack found in it

`src/__tests__/lib/portalAuthSurface.test.ts` (75 checks) reads the sources off
disk, the way `emailTemplateEscaping.test.ts` and `slugSafety.test.ts` do:

1. **No `.eq()`/`.ilike()` on an email column** anywhere in the surface, and no
   `.ilike` on one anywhere in `src/` outside `lib/contactLookup.ts`. The one
   exemption — `email_auth_codes.email` — carries §1's measurement as its
   reason, so the distinction stays written down instead of being re-discovered.
2. **No `select('*')` from `bookings`**, and no internal column named anywhere
   in either customer-facing route.
3. **No `.in('event_type', …)`** on a customer's own list.
4. **Every write reads its error**, every single-row read reads its error.
5. **Both cookies sign an `issuedAt`**; every `Set-Cookie` is `HttpOnly` +
   `SameSite=Lax` + `Path=/`; a cleared cookie is always `Secure`; a route that
   mints one decides `isInsecure` from `isLocalRequest(req)` and nothing else.
6. **No `not_found` outcome** on `/api/portal/auth`, a distinct outcome for a
   failed read, **and the login page has copy for every code the route emits** —
   derived from the route's source, so adding a code without adding its message
   fails.
7. **The attempt claim is conditional, and taken before the comparison** —
   asserted by index, not by presence.
8. **No phone number as a literal** anywhere in the surface.
9. **A staleness walker**: every `route.ts` under `app/api/portal` must be in
   the audited list.

`src/__tests__/lib/portalSessions.test.ts` (48) drives the behaviour — cookie
expiry both directions, forged and edited values, the legacy sunset on both
sides, the lookups against a fake that models **real LIKE semantics** (`%` a
wildcard run, `_` one character), because a fake that treats `ilike` as equality
cannot see the bug the module exists to prevent. The `checkin.test.ts` mock was
extended the same way and gained a test for the mixed-case demotion and one for
the `_` neighbour.

### Then I attacked it, and two of fourteen got through

Every defect above was reintroduced by hand and the suite re-run.

| reintroduced | caught? |
|---|---|
| `ilike()` as the authorization filter | yes |
| `.eq('contact_email')` on the login path | yes |
| `select('*')` from bookings | yes |
| **`admin_notes` added back to the allow-list** | **no** |
| a discarded insert error | yes |
| a discarded single-row read error | yes |
| the `not_found` oracle | yes |
| the `used_at` stamp removed | yes |
| the expiry taken back out of the signature | yes |
| `HttpOnly` dropped | yes |
| the attempt claim made unconditional | yes |
| **the public line back as a Venmo destination** | **no** |
| the payment number back as a literal | yes |
| the `event_type` allowlist restored | yes |

**The first hole:** the column rule searched only the text inside `.select(…)`.
Both routes hold their column list in a **constant** — `PORTAL_BOOKING_COLUMNS`,
`LIST_COLUMNS` — so the names were never between those parentheses and adding
`admin_notes` passed. It now searches the whole de-commented file.

**The second hole is link 13's exact shape, one session later.** The phone rule
read *"contains 998-9325 AND does not mention `PUBLIC_PHONE_DISPLAY`"*.
`/api/portal/pay` legitimately mentions `PUBLIC_PHONE_DISPLAY` in its cash
branch — so **the exemption excused the entire file**, and putting the public
line back as the Venmo destination passed. The rule is now per-line and takes no
exemption: a ten-digit phone number has no business being a literal here.

Both were found by reintroducing the defect and watching the suite stay green,
not by re-reading the rules. **A tripwire that has only ever passed is a comment
asserting its own correctness.**

**A third thing the tripwire caught, in my own patch rather than in the old
code:** the rule-19 walker found two writes I had just added that discarded
their own error — the code-retirement update in `email-auth/request` and the
lock update in `verify` — plus two in the check-in route nobody had ever
checked, one of which is the write that stops the pre-arrival texts.

*(A note for whoever edits these tests: the first version of the attack script
used `perl -0pi -e` with `\n` in the patterns. This repo's files are CRLF, so
several substitutions silently did nothing and reported as MISSED. The results
above are from edits verified to have landed. Link 13 lost half a rewrite to the
same trap.)*

---

## 10. Driven against production

Deployed `bdecc12`. `docker inspect hampton_website` and
`docker images hosthampton-website` both report
`sha256:3baf5e…f2940`, so the recreate took.

Everything in §2–§7 was re-driven after the deploy. The headline results:

**The wildcard session, both forms of cookie:**

| cookie email | before | after |
|---|---|---|
| `%` | **34 bookings** | 0 |
| `%@gmail.com` | 27 bookings | 0 |
| `_____@gmail.com` | 0 | 0 |

and the public door it came through is shut too: `email-auth/request` and
`resend-link` both answer **400** for `%@gmail.com` and `%`, while
`nobody-probe@example.com` and `_@gmail.com` still answer 200 and write nothing
(the exact re-compare finds no booking, so no code row is minted — checked).

**The attempt lock:** §3's sixty-request run.

**The event_type fix, on a row that is not cancelled.** The eight
`HH-TEST-PAY*` plans are all `cancelled`, so a portal list for that address is
legitimately empty and proves nothing. `HH-TEST-PAY2` — a `room-rental`, the
exact type the old filter hid — was flipped to `awaiting_deposit` for one
request and restored by a **conditional** `PATCH … WHERE status =
'awaiting_deposit'` (rule 6):

```
before: {"status":"cancelled","event_type":"room-rental"}
flipped: 1 row
/api/portal/my-bookings -> 200  bookings: 1  refs: HH-TEST-PAY2(draft)
restored: 1 row -> {"status":"cancelled","event_type":"room-rental"}
```

The old filter would have returned 0.

**The payload:** 62 keys → **45**, with every named internal field gone and
everything the UI reads still present.

**The oracle:** all four refs — two real, two invented — now answer
`error=expired`.

**`used_at`:** written on the successful authentication, read back out of
Postgres as `2026-09-12T20:16:40+00:00`.

**The funnel, after deploy.** `/`, `/book`, `/party-packages`,
`/studio-rental`, `/kids-party-menu`, `/mobile-party`, `/gift-cards`,
`/events`, `/my-booking/login`, `/my-booking`, `/party-planner` and
`/es/party-room-rental` all **200**, `/book` serving **52,742 bytes**.

**What was written, and what was restored.** Two `portal_tokens` probe rows
(deleted; `portal_tokens` back to 230). Four `email_auth_codes` probe rows
(deleted; the table is back to its 2 historical rows from 2026-05-25). One
`bookings.status` flip on a cancelled throwaway plan (restored conditionally).
**No email and no SMS was sent to anybody** — the code probes were seeded
directly by SQL rather than through `email-auth/request`, precisely so that
nothing was mailed. **No Stripe object was created.** No model call. `contacts`
and `booking_modifications` are untouched; `scheduled_reminders` is still 0;
`invoice_number_seq` is still `118 / t`.

---

## 11. What I could NOT verify

- **That no real customer has been harmed by §2.** The wildcard read leaves no
  trace: `/api/portal/my-bookings` writes nothing and nginx's log is a ten-day
  window (rule 17). The table that would hold the evidence does not exist. What
  *can* be said is that the first half of the chain requires minting a code for
  a pattern address, and `email_auth_codes` held **two rows, both from
  2026-05-25**, before this session — so as far as that table can tell, nobody
  ever did.
- **The five-week legacy-cookie window** (§6) is a deliberate, stated exposure,
  not a verified absence of one.
- **`/api/portal/session-status` against a real session.** Only `sk_live` exists
  in the container, so no test-mode checkout session could be created to prove
  the positive direction. The negative direction (bogus id → 404, malformed →
  400, no `booking_ref` → 404) is verified; the positive path rests on
  `planPayLinks.ts` setting `metadata.booking_ref` on the payment link, read
  from the source. Stripe copies payment-link metadata onto the session.
- **`checkin_tokens` remains empty**, so `/checkin/[token]` and
  `/api/checkin/[token]` could not be driven end to end against a real token —
  only their code was audited and their unit tests extended. The three reminder
  crons that would mint one are still unscheduled (needs-Adam 18).
- **`/api/portal/pay`'s card branch** was not driven: it creates a live
  PaymentIntent. The clamp fix is covered by reading and by tsc, not by a
  charge.

---

## 12. Needs Adam

1. **Nothing new is blocking.** No price, no business rule and no credential was
   needed for any of this.
2. **Worth a decision, not a blocker: the 6-digit email login has no UI.** It is
   the better login — case-insensitive, rate-limited, now properly locked — and
   `/my-booking/login` does not offer it. Wiring it up is a small frontend job;
   whether the site should have two sign-in styles is a product call.
3. **Worth knowing: seven customers could not get their portal link** between
   whenever `resend-link` was written and today, two of them after paying a
   deposit. Fixed. Whether any of them should be contacted is Adam's call.

---

## 13. Not touched

Mobile pricing. The 44 active enrollments, the 103 draft campaigns, the Brevo
list, the Twilio configuration, the three `draft` social posts, the real open
customer drafts, the three sent drafts, the `agent_learnings` proposals, voice
profile v2, the four `pending_review` town drafts, the four dead English drafts,
`agent_memory`'s 44 rows, the five Phase 5 tables, `scheduled_reminders`.
`process-sequences` was not run. The `HH-TEST-PAY*` plans are all still
cancelled. No migration was taken — **046 is still free.**
