# The contact-identity surface and the outbound mirror — attack and repair

**Link 17 of the build chain. 2026-09-12.** Worktree `ivory-dusk`.
Main was `8f374e4` at the start; the code landed as `ee37b60`.
**No migration taken — 047 is still free.**
Suite **2264 → 2387 green**, 0 app `tsc` errors, `/book` still `○ Static` 7.15 kB
and serving 52,742 bytes in production.

Scope: `upsertContact` and everything it fans out to — `lib/contactLookup.ts`,
`lib/contactSync.ts`, the Brevo and Quo wrappers, `enrollInSequence`, both SMS
webhooks, and the admin contacts surface. Twenty-one routes call
`upsertContact`, including every public intake form, `/api/checkin/[token]` and
six branches of the Stripe webhook.

---

## 1. What was measured first

The schema was read out of `information_schema`, `pg_constraint`, `pg_indexes`,
`pg_trigger` and `pg_enum` before anything was concluded (rule 13), and it is
the whole story:

```
contacts_email_key                UNIQUE (email)            ← the RAW value
uq_contacts_phone_when_no_email   UNIQUE (phone) WHERE email IS NULL
status      NOT NULL DEFAULT 'lead'::contact_status, 7 labels
email_opt_in / sms_opt_in         NOT NULL DEFAULT false
```

There is **no functional index on `lower(email)`**. So `onConflict: 'email'` is
case-sensitive in exactly the way `.eq('email', …)` is — and it is a *write*.

```
contacts                     : 1220
  …with an email             : 1217
  …distinct lower(email)     : 1209      ← eight people counted twice
  …stored not lowercase      :   21
brevo_synced_at set, ever    :    0 of 1220
quo_contact_id set           :    5
sync_error set               :    7  (six of them `brevo:upsert`)
status distribution          : 791 lead, 429 customer, 0 of everything else
```

`status = 'unsubscribed'` has **never been written**, by anything. That matters
later.

### The eight pairs, and what a duplicate actually costs

The brief said not to assume. Measured per row:

| person | older row | newer row |
|---|---|---|
| `aled5290@` | **`customer`**, 4 bookings, **LTV $191.82** | `lead`, LTV 0, from an event ticket |
| `jessica.lindstrand4@` | **`customer`**, 3 bookings, **LTV $282.62**, 0 enrollments | `lead`, LTV 0, **2 ACTIVE sequence enrollments**, 1 booking FK |
| `jgilde711@` | **`customer`**, 2 bookings, **LTV $168.38** | `lead`, LTV 0, from a cart checkout |
| `haleybelmonte94@` | `lead`, opt-in **true**, 3 bookings by FK, 1 ACTIVE enrollment | `lead`, opt-in **false**, enrollment `unsubscribed` |
| `jeberhardt517@` | `lead`, opt-in **false**, 1 booking FK, 1 interaction | `lead`, opt-in **true**, 1 ACTIVE enrollment |
| `michaela.j.manning@` | `lead`, opt-in **true**, 1 booking FK, 1 ACTIVE enrollment | `lead`, opt-in **false**, honeybook import |
| `nitai.finkelstein@` | `lead`, opt-in **true**, 1 booking, 1 message | `lead`, opt-in **false**, a DIFFERENT phone number |
| `meganpastier97@` | `lead`, opt-in **true**, 1 interaction | `lead`, opt-in **false**, admin studio invite |

Three concrete costs, not one:

1. **Three paying customers' history is split in half.** The `customer` status,
   the `booking_count` and the lifetime value sit on one row; the bookings'
   `contact_id`, the enrollments and the interactions sit on the other. Every
   guard written against either is blind to the other.
2. **Jessica Lindstrand is a three-time customer with $282.62 of history and she
   is sitting on two ACTIVE lead-nurture enrollments** — "here's why you should
   book your first party with us". `enrollInSequence`'s already-a-customer guard
   reads `bookings`, and her purchase history is on the row the enrollment is
   not attached to. The moment `process-sequences` is rescheduled (needs-Adam 3)
   she gets pitched.
3. **Four of the eight pairs hold two different answers to "may we email this
   person."** Nobody has been mailed against their wishes yet — those `false`s
   are "never ticked the box", not opt-outs, because `status = 'unsubscribed'`
   has never been written. But the database holds a contradiction, and the
   admin Contacts tab writes to one row by id.

**A correction to the handover, since the number gets repeated:** link 16 wrote
*"sixteen of the 21 mixed-case addresses are one half of such a pair"*. Sixteen
ROWS are in pairs; **eight of the 21 mixed-case addresses are**, because each
pair is one mixed-case row and one lowercase row. Thirteen mixed-case addresses
are not duplicated at all.

### And 21 phone numbers have the same problem, which nobody had counted

`contacts.phone` is plain `text` and the live table holds the same number as
`6314008080`, `+16314008080`, `631-400-8080`, `16318338149` and
`(631) 400-8080`. **21 normalised numbers carry more than one contact row**,
one of them six. Seven of those groups DISAGREE about `sms_opt_in` today.

Two of them are two *different people* sharing a household phone
(`347-400-4495`, `6317672571`), which is the reason a number is not a person —
and also the reason an inbound STOP must reach every row holding it.

### Then the providers were asked, and that is where it turned

Link 15's and link 16's lesson, applied to two providers at once.

**Brevo is case-insensitive and always has been.** All 956 of its contacts are
stored lowercase; both spellings of each duplicated person resolve to the *same*
Brevo id. So the eight duplicates are not duplicated at Brevo. Reported in §6 as
something that HELD — and note which way round that is: the provider's idea of
"the same person" was right and ours was wrong.

**But Brevo has never heard of 253 of our people**, and the reason is a comment
that asserts the opposite of its code for the tenth time in this chain:

```
syncContactToBrevo: "Uses PUT /contacts/{email} which is idempotent (upsert semantics)."

PUT /v3/contacts/hh-link17-probe@example.com   ->  404
{"code":"document_not_found","message":"Contact does not exist"}
```

Six times, with and without the PHONE attribute, with and without names.
**`PUT` is UPDATE-ONLY.** It cannot create a contact. So the mirror could only
ever have worked for somebody a human had already imported by hand:

```
brevo contacts                    : 956, created 869 on 2026-03-09 and 87 on 2026-08-27
                                    — two bulk imports, and nothing else, ever
our distinct people with an email : 1209
people Brevo has never heard of   : 253
brevo contacts our code created   : 0
```

`POST /contacts` with `updateEnabled: true` is the real upsert — measured: **201**
on a fresh address, **204** on a repeat of the same one. That is now what the
wrapper does.

The failures were not invisible, exactly; they were recorded into
`contacts.sync_error` by a write that discarded its own result, under a comment
explaining that it fails harmlessly before migration 032. It does — and that is
why nobody noticed it kept failing afterwards. Rule 19.

**Quo**: 669 contacts, **651 from a `csv-v2` bulk import and 6 from our code**.
A second `POST /v1/contacts` with an externalId Quo already holds is **409**, not
an update — so the comment *"stored as Quo externalId so re-syncs update, not
duplicate"* is half true and the other half was permanent: a 409 was reported as
a generic error, `quo_contact_id` was never learned, and every later sync for
that contact 409'd again forever.

And recovering from it has a trap of its own, measured rather than assumed:

```
GET /v1/contacts?externalIds=<id>     ->  200, 1 row, the right one
GET /v1/contacts?externalIds[]=<id>   ->  200, 10 rows — UNFILTERED
```

Quo **ignores** the bracketed OpenPhone idiom rather than refusing it, so that
lookup returns a page of strangers while looking like a filter that worked.
Rule 16's shape, at a provider.

---

## 2. The headline: `upsert(onConflict: 'email')` is a case-sensitive WRITE

```ts
const record = { email, first_name, …, }
await supabase.from('contacts').upsert(record, { onConflict: 'email' })
```

Link 9 had already fixed the *read* in front of this — `findContactsByEmail`,
case-insensitive, three outcomes — so an existing contact's `status` was safely
preserved. But the write underneath it still keyed on the raw address, so a
returning customer who capitalised differently hit no conflict, the INSERT
succeeded, and the same human existed twice. **The read being right made the bug
harder to see, not easier**: `prior.kind === 'found'` and a brand-new row, in the
same call.

It is now a case-insensitive lookup followed by an **UPDATE BY ID** or an
**INSERT**, with 23505 on `contacts_email_key` treated as "another writer got
there first — re-read and update" rather than as a failure.

**The stored spelling is never rewritten.** `email` is deliberately absent from
the update payload: lowercasing the 21 mixed-case rows in place would collide
against `contacts_email_key` for eight of them, and would do nothing about the
22nd address somebody types tomorrow. The lookup is the fix, not the data.

### Which row IS the person

Five callers took `contacts[0]` off an unordered PostgREST read, which is
whichever row happened to be earlier in the heap — measured live, that is the
lowercase row for `jeberhardt517@` (ctid `(16,5)` before `(17,19)`) and the
MIXED-case row for `haleybelmonte94@` (`(9,12)` before `(10,9)`). Two callers
could therefore disagree about who somebody is, in one request, for no reason
anybody could see.

`lib/reminders.ts` had already decided this for itself — "the oldest row wins,
deterministically" — and nothing else knew. That decision moved into
`findContactsByEmail`, which now returns rows oldest-first and names a
`primary`. Measured against the eight real pairs, oldest-wins picks the row
carrying the history in **seven of eight** cases. Rule 11.

It is a tie-break, **not a merge**. Merging touches eighteen foreign keys and is
needs-Adam 31.

---

## 3. Everything else that was live on this surface

**`upsertContact` had two outcomes where it needed three.** `null` meant the
read failed, the write was refused, *and* the contact exists but reached neither
Brevo nor Quo. On this surface the last one is the expensive collapse: a contact
that exists locally and never reached Brevo is invisible to every campaign while
looking perfectly healthy in the admin tab. `upsertContactResult` now returns
`created | updated | unavailable` with the mirror's own outcome attached, and
`upsertContact` is a thin narrowing of the same implementation.

**The mirror reported `synced` for a contact that never reached the list.**
`addToList` failing pushed a string into an errors array and left
`result.brevo = 'synced'`. At Brevo but not on the list is exactly as
unreachable as never arriving. Three outcomes per provider now, with `partial`
for that case, and `skipped` carries **which** of four reasons (`no-email`,
`no-phone`, `not-configured` ×2) rather than one word meaning all of them.

**The mirror read `email_opt_in` alone**, while `optedOutReason()` — the
function every marketing send consults — reads `email_opt_in` **and**
`status = 'unsubscribed'`. So an admin marking somebody unsubscribed in the
Contacts tab would have had them handed back to Brevo's marketing list by their
next enquiry form. Nothing carries that status today, so nothing has leaked;
`optedOutReason` is now imported here rather than restated (rule 11).

**`enrollInSequence`'s already-a-customer guard was case-sensitive** —
`.eq('contact_email', …)` against a column where 9 of 61 rows are not lowercase
— **and it discarded its read error**, so a Supabase blip said the same thing as
"never booked with us". The safe direction is not to enrol: an unsent nurture
email costs nothing and one sent to somebody who already paid costs goodwill. It
now has five outcomes and a failed read **defers**. (Measured: no live
enrollment is currently a victim of the case-sensitivity itself — the one active
enrollment belonging to a person with a confirmed booking would have been caught
by the old filter too. The Jessica Lindstrand case in §1 is the duplicate, not
this filter.)

**The final log line said "Enrolled X in sequences" unconditionally**, including
when every single upsert had just been refused. Rule 10.

**A STOP reached one row.** Both SMS webhooks matched the number with a RAW
PostgREST `.or()` built from the provider's own `From` field —
`phone.eq.${n},phone.eq.+1${n},phone.eq.${from}` — an allow-list of three
spellings against a column holding five, read through `.single()` /
`.maybeSingle()`, **which ERROR when more than one row matches**. 21 numbers in
production do. The error was discarded, so the contact read as absent: on Twilio
the STOP was silently dropped, and on Quo the route then *created a third row*
for a texter it already knew. `lib/smsOptOut.ts` is now one implementation used
by both, it opts out **every** row holding the number, by id, and it says how
many.

**`upsertContactByPhone` compared the raw string.** `.eq('phone', phone)` with
an E.164 `From` against a row stored as `631-400-8080` misses, and the function's
whole job is to avoid making a second row. That is where several of the 21
phone groups came from.

**Four `.eq('email', …)` sites closed**: `lib/contacts.ts`'s post-write re-read,
`lib/sequences.ts`, `lib/agent/draftInquiry.ts` (so a returning customer's draft
was written with no contact to hang it on) and `/api/cron/gmail-sync` (so their
mail was ingested unlinked to them) and `/api/admin/photos/backfill-reminders`
(which reported "no contact row for email" about people who plainly have one).
The two in `/api/admin/auth/*` and the three in `/api/portal/email-auth/*` were
left alone — link 14 measured those and cleared them.

**`.or()` from a template literal, in four places, one of them PUBLIC.**
`.or()` takes a raw PostgREST expression: a comma starts a new disjunct, `)`
closes the group, and inside an `ilike` value `%`/`_` are LIKE wildcards. The
admin Contacts, Financials and Gift-cards search boxes all interpolated
directly; so did **`/api/pricing?event_type=`, which has no authentication at
all**, where a `}` ends the array literal. All four now go through
`lib/postgrestFilter.ts`, and the rule "no template literal is ever passed to
`.or()`" is absolute rather than exempted — an exemption is what let link 13's
and link 14's tripwires excuse a whole file.

**Three writes could not tell you they matched nothing.** The admin
`PATCH /api/admin/contacts/[id]` answered `{ok: true}` for an id that does not
exist, on the surface whose fields are somebody's marketing consent; so did the
opt-out writers. All three carry `.select()` now. The GET beside it answered a
confident **404** for a read that failed, and now answers 503 (rule 12), and it
returns `duplicateRows` so a human editing one half of a duplicated person can
see that the other exists.

**Two more unchecked writes** (rule 19): `contactSync`'s bookkeeping update and
the Brevo webhook's `last_engaged_at`.

**The ad-platform export was the fifth reader of "may we market to this
person"** and read `email_opt_in` alone, while the other four also read
`status`. It also emitted **one line per ROW**, so the eight duplicated people
were uploaded to Google Ads and Meta twice under the same lowercased address. It
applies `optedOutReason` and dedupes per person now.

**The admin `status` write had no validation**, so a typo was a Postgres 500 in
the panel. `CONTACT_STATUSES` is read from `pg_enum` and written down once.

---

## 4. What was fixed, and how each fix was proved

All of it is deployed (`ee37b60`). Everything below was driven against
**production**.

### Probe 1 — the duplicate, both directions

`POST /api/contact` with **`ADAM@EasternBuilding.Supply`**, against the existing
row `9f8bf9d5…` stored as `adam@easternbuilding.supply`:

```
BEFORE  contacts 1220, distinct lower(email) 1209
AFTER   contacts 1220, distinct lower(email) 1209        ← no second row
        row 9f8bf9d5… updated in place: first_name, last_name, source_detail,
        updated_at 21:50 → 02:15, status still `lead`, email_opt_in still false
```

Under the old statement that is 1221/1209 and a ninth duplicated person. The
*old* behaviour is pinned as a regression test rather than reproduced in
production, because making a real duplicate to prove a point is not a trade
worth taking.

### Probe 2 — the mirror, which had never once worked

The same request, measured at Brevo:

```
BEFORE  contacts.brevo_synced_at : NULL on all 1220 rows
        row 9f8bf9d5….sync_error : 'brevo:upsert'
        GET /v3/contacts/adam@…  : 404 document_not_found

AFTER   brevo_synced_at          : 2026-09-13 02:15:13   ← the first one, ever
        sync_error               : NULL
        GET /v3/contacts/adam@…  : 200, id 958, lists []
        brevo TOTAL              : 956 → 957
        list 3                   : 944 / 12 blacklisted — UNCHANGED
```

**`lists: []` is the half that matters as much as the creation.** That row is
`email_opt_in = false`, so the contact was mirrored and deliberately NOT added
to the 944-person marketing list. Consent gating held on the first real run.

(Brevo contact 958 was deleted afterwards and Brevo is back to 956 — its
`LASTNAME` was a probe string, and a false statement about a person is not worth
keeping for evidence.)

### Probe 3 — the STOP, against a number six rows share

`POST /api/webhooks/twilio`, `From=+16314008080&Body=STOP`. That number is held
by six contact rows in **three different stored formats**, one of them opted in:

```
BEFORE  6314008080=true  631-400-8080=false  6314008080=false
        6314008080=false  +16314008080=false  +16314008080=false

AFTER   all six false

log:    twilio:webhook SMS opt-out recorded for …8080 —
        6 contact row(s), 0 pending SMS reminder(s) cancelled
```

Under the old code, `.or(phone.eq.6314008080,phone.eq.+16314008080)` matched
five rows, `.single()` answered PGRST116, the error was discarded, and the
opted-in row stayed opted in. Restored afterwards with a conditional UPDATE and
the six `sms_unsubscribed` interactions deleted — no real STOP was sent, so
leaving them would have been a false statement about real people.

The Quo endpoint was deliberately **not** used for this probe: `+16314008080` is
a reviewer phone, a bare `STOP` is also a review command ("drop that draft"),
and there are real open customer drafts.

### Probe 4 — the public filter, and the admin one

`/api/pricing?event_type=` — unauthenticated:

| value | rows |
|---|---|
| `kids-party` | **117** — the legitimate filter still works |
| `kids-party)` | 117 — the `)` is stripped, the value survives |
| `kids-party},is_active.eq.false` | 79 |
| `x,id.not.is.null` | 79 |
| `}` / `%` / `_` | 79 |

79 is the universal set (`event_types IS NULL`); the unfiltered table is 151.
Every hostile form collapses to "match nothing extra" rather than widening.

`/api/admin/contacts?search=`, with the container's own credential:

| term | result |
|---|---|
| `jeberhardt` | **2** — both rows of the duplicated person |
| `JEBERHARDT` | 2 |
| `x,status.eq.customer` | **0** — not the 429 customers |
| `%` / `_` | **0** — not all 1220 |

And the detail route, on one half of a real pair:

```
GET /api/admin/contacts/23efdeb0…
  duplicateRows: [{"id":"b388dabe…","email":"jeberhardt517@gmail.com"}]
GET /api/admin/contacts/<unknown uuid>  ->  404
```

### Everything restored

`contacts` 1220, `bookings` 61, `contact_interactions` 143 (0 of type
`sms_unsubscribed`), `ingested_messages` 445, enrollments 120, Brevo 956 with
list 3 at 944/12. The probe's lead plan `HH-PTY-TERMM` was **deleted** rather
than cancelled — it represents money that never moved — along with its inbound
event (deleted in FK order; `bookings_first_touch_event_id_fkey` refuses the
other way round). No invoice number was burnt; no email or SMS reached a real
customer; no Stripe object was created; no model call was made.

---

## 5. The tripwire, and attacking it

`src/__tests__/lib/contactIdentitySurface.test.ts` reads the sources off disk in
the shape `portalAuthSurface` / `signwellSurface` / `stripeWebhookSurface`
established. Twelve rule groups: no `.eq()`/`.ilike()` on an email column
outside `contactLookup` (R1); no `onConflict: 'email'` anywhere and no `email`
in an update payload (R2); a lookup asks for the columns its own answer depends
on (R2b); a phone number is normalised, never compared raw (R3); no `.or()` from
a template literal, absolutely (R4); every write on the surface reads its result
(R5); an UPDATE whose result decides an answer carries `.select()` (R6); one
definition of "may we market to this person", applied by the mirror and the
export (R7); the Brevo wrapper cannot go back to PUT (R8); the Quo lookup uses
the parameter Quo honours and re-compares the id (R9); three outcomes where a
lookup can fail (R10); nothing bulk-lowercases the stored addresses (R11); and a
staleness walker over every file that touches `contacts` (R0). Comments are
stripped before every rule runs — link 16 lost two rules to a file's own prose.

Beside it, `contactIdentity.test.ts` (35), `contactMirror.test.ts` (16),
`sequenceEnrollment.test.ts` (12) and `postgrestFilter.test.ts` (11) drive the
real code against **`helpers/fakeContactsDb.ts`** — a fake carrying the real
unique indexes (including `contacts_email_key` on the RAW value), the real enum,
the real `contact_interactions` CHECK and column PROJECTION. `makeFakeDb` gained
`upsert()` with Postgres's own conflict semantics, a `maybeSingle()` that errors
on more than one row like PostgREST's does, an `.or()` that really parses the
expression, and CHECK validation on UPDATE.

The old mocks were `buildChain({ data: { id: 'c-1' }, error: null })` — a fixed
row for every read and an upsert that accepts anything. Against that, a
case-sensitive conflict target looks fine, a dropped STOP looks fine, and a
zero-row update looks fine. Rule 8's mock form, for the sixth session running.

### Then it was attacked: 34 defects, and the first run found two holes

`scripts/attack-contact-tripwire.js` reintroduces every defect above one at a
time, verifies the mutation LANDED on disk, runs the suites, and restores.

**The first hole was in the harness, not the tripwire, and it was the dangerous
kind.** `suitePasses()` shelled out to `npx.cmd`, which it could not spawn at
all — so it returned `false` for *every* input, the baseline printed RED, and
all 34 mutations reported **"caught"**. A detector stuck off says exactly what
you want to hear. It now invokes jest's own entry point, and refuses to run at
all unless the clean tree is green. (A second harness bug was caught the same
way: a failure path returned without restoring and left a real mutation in
`lib/contacts.ts`, which only the next baseline check revealed. Every path
restores now.)

**With a working detector, one of the 34 got through:**

> **A fake that returns a column the query never asked for cannot see a query
> that forgot to ask.** `findContactsByEmail` appends `created_at` to whatever
> the caller requested, because the canonical-row rule needs it. Deleting that
> append changed nothing — the fake ignored the select list and handed back
> whole rows, so the ordering test stayed green over a query that no longer
> fetched the column it orders by. Projection is modelled now, and a shape rule
> (R2b) sits beside the behaviour test.

**34/34 after the fix**, and the suite on the restored tree is green.

Three deliberate **negative** cases are included so the narrowings cannot
quietly become escape hatches: R1 asserts it still matches `.eq('email'` and
does not match `.eq?.(`; R4 asserts it still sees an interpolated `.or()`; and
R5's narrowing for `crypto…update(…)` asserts that a DB write merely *mentioning*
a hash column is still caught.

---

## 6. What HELD

Reporting only what broke would overstate the state of this surface.

- **Brevo is the case-insensitive authority.** All 956 of its contacts are
  stored lowercase and both spellings of each duplicated person resolve to the
  same id, so the eight duplicates are **not** duplicated in the marketing list.
- **Consent state agrees with Brevo in both directions**: of Brevo's 12
  blacklisted contacts, **zero** are `email_opt_in = true` on any of our rows;
  and no contact we hold as opted-out is still an unblacklisted member of list
  3. Link 9's Brevo-webhook fix is doing its job.
- **`optedOutReason` is defined exactly once** and reads both columns.
- **Link 9's `upsertContact` status fix held**: an existing contact's `status`
  is still never overwritten, including `unsubscribed`.
- **`POST /api/unsubscribe` already handled a duplicated person correctly** —
  link 9 wrote it with `.in('id', ids)` over every matched row, so the one-click
  opt-out reaches both halves.
- **`findContactsByEmail`'s `ilike`-then-exact-re-compare is sound**, and the
  test proves a `_` in a real address cannot wildcard onto a stranger.
- **`publicOrigin`, `contactLookup` and the escaping tripwires are intact** —
  links 13, 14, 15 and 16's suites all still pass.
- **Quo refuses a duplicate `externalId` with 409** rather than silently
  creating a second contact, so no Quo duplicate was ever created by that path.
- **The booking funnel is unchanged**: all thirteen pages 200 after deploy,
  `/book` still `○ Static` at 52,742 bytes.

---

## 7. What I could NOT verify

- **Whether the eight duplicates have ever caused a real person to be mailed
  twice.** Both halves resolve to one Brevo contact, and Resend is addressed
  per-message, so the structural answer is no — but `email_sequence_sends` is
  keyed by `contact_id`, so two active enrollments on two rows for one person
  *would* produce two sends. `process-sequences` has been frozen since
  2026-08-16, so it has not happened yet. It will, for Jessica Lindstrand,
  on the day that cron is rescheduled.
- **Whether Brevo's 253-person gap has cost a campaign.** Only two campaigns
  have ever been sent, both before the most recent import, and Brevo's own
  dashboard is the only place that could say.
- **The Quo side of the mirror was exercised by unit test, not in production.**
  The probe contact already had a `quo_contact_id`, so the run took the PATCH
  path; the 409-recovery branch is proved against a fetch double and against the
  live API's *observed* 409, not by forcing one in production.
- **Nothing was driven through the Quo webhook**, deliberately — that number is
  a reviewer phone and a bare STOP is also a draft-cancel command.
- **`upsertContactByPhone`'s create path was not driven in production**, because
  doing so means making a contact row for a number nobody texted.
- **`last_name` on the test contact row** was restored to NULL rather than to a
  recorded prior value; the baseline query did not capture it. `source_detail`
  is now `Contact Us page` rather than link 16's probe string, which is more
  accurate and was left.

---

## 8. Needs Adam

**31 (updated, not new).** Eight real people have two `contacts` rows each. The
LOOKUP is fixed and no ninth pair can be created, but the existing eight are a
decision about real people and about eighteen foreign keys:

```
contact_tags          contact_interactions   contact_sequence_enrollments
segment_contacts      reviews                analytics_events
stripe_transactions   review_requests        vendor_referrals
bookings              scheduled_reminders    coupons
consent_releases      ingested_messages      inquiry_drafts
email_sequence_sends  variant_assignments    contacts.referral_source
```

What makes it a judgement call rather than a script: **for three of the eight,
the row carrying `status = 'customer'` and the lifetime value is NOT the row the
bookings point at.** A merge has to decide which lifetime value survives, and
whether the `lead` row's active enrollments should be cancelled on merge or
carried over. My recommendation, for what it is worth: keep the **oldest** row
(which is what every read now resolves to), sum `lifetime_value` and
`booking_count` onto it, take the highest status, take `email_opt_in = true`
only if it is true on the surviving row (never inherit consent), repoint the
eighteen FKs, and **cancel the loser's enrollments rather than moving them** —
Jessica Lindstrand should not be nurtured as a lead at all.

**Most urgent within it:** `Jessica.lindstrand4@gmail.com` is on **two active
lead-nurture enrollments** while being a three-time customer, and
`Michaela.J.Manning@` and `haleyBelmonte94@` and `Jeberhardt517@` each hold one.
Those four are among the 45 enrollments that start moving the moment
`process-sequences` is rescheduled.

**32. 253 people in our database are not in Brevo's list at all.** The mirror
could never create a contact until today, so everyone captured outside the two
hand-run imports (2026-03-09 and 2026-08-27) is invisible to every Brevo
campaign. Going forward this is fixed and every new contact will be created —
and added to list 3 only if they consented. **Whether to backfill the 253 is
Adam's call**, not a build session's: it is a bulk write to an external
marketing list holding real people, and the consent test for each one would be
our `email_opt_in`, which for many of them is `false` simply because the box was
never on the form they used. I have the exact list ready; say the word.

*Not blocking, and already actioned:* nothing here needed a credential, a price
or a business rule to fix.

---

## 9. Housekeeping

- **No migration taken. 047 is still free**, and
  `docs/phase-5-memory-learning.md` §11.13's `agent_learnings.source_memory_id`
  is still its nominal job.
- **No new environment variable.**
- **Nothing written to `marketing_ledger`** — no model call, no SMS, $0 spent.
- **One email was sent**: the owner notification for the `/api/contact` probe,
  to `hosthampton295@gmail.com`, about a lead from `adam@easternbuilding.supply`.
  No customer-facing send of any kind.
- **`invoice_number_seq` untouched** — still `last_value = 118`, `is_called = t`,
  so the next issued number is still `444124-000119`.
- `audit_scratch/` and `services/website/scripts/attack-contact-tripwire.js` are
  untracked on purpose, per the do-not-commit list.
- **A note for whoever edits the attack harness**: a perl `-0pi -e` substitution
  and a `node -e` codemod each silently did nothing during this session, once
  eating a `${…}` interpolation because perl read it as its own variable. Verify
  what landed. The same trap has now cost four consecutive links time.
