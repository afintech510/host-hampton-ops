# Phase 4 — Campaign Automation

**Built and deployed 2026-09-12** (chain link 8, worktree `proud-badger`).
**Migration 043 taken — the next free number is 044.**
**1542 tests, all green** (was 1453). 0 app-code `tsc` errors. `next build` clean,
`/book` still `○ Static` at 7.15 kB.

Two of Phase 4's four checklist items are blocked on credentials the container
does not have — measured, not assumed: `docker exec hampton_website printenv`
returns **zero `META_*` variables**. Instagram posting and Google Business
Profile automation are therefore recorded as **needs Adam** and were not started.
This document covers the two that are real:

* **Email campaign sequencing (LIST + OUTBOUND)** — which was not greenfield, and
  not idle either.
* **Social content calendar auto-generation (COPY + SOC)** — which needs no
  external credential at all.

---

## 1. The measured starting state, and why the brief's was wrong

`PLAN.md`'s Phase 4 table said `process-sequences` had **never been called** and
that "Phase 3B's whole reminder-and-campaign engine has never run in production".
Both statements come from counting hits in `docker logs hampton_nginx`. That log
is a **ten-day window**:

```
first line : 02/Sep/2026:00:53:15
last line  : 12/Sep/2026:12:43:10
```

It is not history. Re-counted with the same filter it agrees with the brief — and
the database disagrees with both:

| evidence | says |
|---|---|
| nginx, last 10 days | `process-sequences`: **0 hits** |
| `contact_sequence_enrollments` | **57 rows carry a `last_sent_at`**, between **2026-03-21** and **2026-08-16** |

Those timestamps land on fifteen-minute boundaries — `12:00:10`, `22:30:09`,
`18:00:11`, `16:45:06`, `15:30:13`, `01:15:08` — which is a cron, not a hand run.
**The sequencer ran every fifteen minutes for five months, sent real marketing
email to real customers, and then its cron-job.org job disappeared on
2026-08-16.** 44 enrollments are still `active`, frozen mid-sequence.

The same correction applies to `draft-newsletter`. The brief reads its
`11 × 401, 0 × 200` as "a job that looks scheduled and has never done anything".
It has: `scheduled_campaigns` holds **17 `event_update` drafts created daily at
11:00 UTC between 2026-07-01 and 2026-07-17**, seven of them for the same Bitchy
Bingo event with seven different subject lines, **none ever sent**. The job kept
firing daily and started 401ing on ~2026-07-18. `booking-locks` shows the same
shape at 04:00 UTC: 11 × 401, no 200s.

Neither request carries `?secret=` (checked: zero URLs in the log contain it), so
both send the `x-cron-secret` header — and the header they send is stale, because
**the secret in the container is correct**: a request made from inside the
container with `process.env.CRON_SECRET` returns 200 on both routes today.
`agent-dispatch` (998 × 200) holds the current value. So two cron-job.org jobs
hold an old one. That needs the cron-job.org login → **needs Adam**.

> **The generalisation worth keeping:** a log is a window, and a count over a
> window is not a statement about history. The database was the only witness that
> could tell the difference, and it contradicted the brief twice.

This matters beyond bookkeeping. "Code that has never run" and "code that ran for
five months and stopped" are different risk profiles, and the second one means
**anything wrong with the sequencer has already happened to real people.**

---

## 2. Four defects in code that had already run

### 2.1 The activity log never wrote a single row

`/api/cron/process-sequences` logged every send:

```ts
await supabase.from('contact_interactions').insert({
  contact_id: enrollment.contact_id,
  type: 'sequence_email_sent',
  …
}).then(() => {})          // ← the result, discarded
```

`contact_interactions.type` is constrained:

```
contact_interactions_type_check CHECK (type = ANY (ARRAY[
  'email_sent', 'email_opened', 'email_clicked', 'email_unsubscribed',
  'email_bounced', 'sms_sent', … , 'form_submission', 'other']))
```

`sequence_email_sent` is not in it. Confirmed against production in a rolled-back
transaction:

```
ERROR:  new row for relation "contact_interactions" violates check constraint
        "contact_interactions_type_check"
```

So **57 marketing emails went to real customers and not one of them left a
record**, for five months, because a `.then(() => {})` threw the error away.
`contact_interactions` holds exactly two types today: `form_submission` (109) and
`sms_received` (33).

Rule 13 says a constraint named in a comment and declared nowhere is worse than a
constant declared twice. The inverse is what happened here: a constraint declared
in the database and known to nobody. `lib/contactInteractions.ts` now holds the
CHECK's contents **read out of `pg_constraint`**, types `logInteraction` against
them so a bad value is a compile error at the call site, refuses an unknown value
at runtime with the allowed list in the message, and — the actual fix — **reports
a failed insert instead of swallowing it.**

### 2.2 Check-then-act, on a path that sends email to customers

The old loop read `current_step`, sent, then wrote `current_step` back. Two
overlapping ticks read the same step and both send. The same shape plan §22 found
in the email-me cooldown, where five concurrent calls produced three emails — and
here the artefact is a second marketing email to a customer.

`email_sequence_sends` (migration 043) is the fix, on the pattern
`booking_payments` already uses:

* `UNIQUE (enrollment_id, step_number)` — the claim row is inserted **before** the
  send, so the second caller gets **23505 and stops**, handled **by code**, never
  by message text;
* the send row is marked `sent` **before** the enrollment advances, so a crash
  between the two writes is recovered by the next tick catching the enrollment up
  **without sending again** — the one ordering that cannot produce a second email;
* a claim left `claimed` by a container that died mid-send is taken over after
  `STALE_CLAIM_MS` (10 min) by a **conditional** update that includes the attempts
  count that was read, so two ticks reaching that branch together cannot both win;
* an **unreadable** `claimed_at` counts as FRESH, not abandoned. The safe
  direction is to leave a claim we cannot age alone.

The index was exercised in production rather than trusted (rule 13):

```
ERROR:  duplicate key value violates unique constraint "email_sequence_sends_step_uniq"
DETAIL:  Key (enrollment_id, step_number)=(1c3a6207-…, 99) already exists.
```

### 2.3 A transient failure was terminal — twice, in opposite directions

```ts
const { data: step } = await supabase.from('email_sequence_steps')…single()
if (!step) { …update({ status: 'completed' }) }      // ← a read blip ENDS the sequence

const { data: contact } = await supabase.from('contacts')…single()
if (!contact || !contact.email_opt_in) { …update({ status: 'unsubscribed' }) }
```

Both discard the error and read `data: null` as a fact. The first permanently
ends a real customer's sequence because of one bad second. The second is worse:
`unsubscribed` is **a claim about what a person asked for**, written on the
strength of a failed `SELECT`.

Hard-won rule 12, twice in nine lines. Every lookup in
`lib/sequences/processor.ts` is now `found | absent | unavailable`, and
`unavailable` changes no state at all — it defers, counts itself in `deferred`,
and says why in `notes`. A failed read of the enrollment LIST is a **500**, not a
green `processed: 0`, for the reason §23 gives about the distiller.

`isDue` carried a third instance of the same thing. An unparseable `event_date`
produced an `Invalid Date`; every comparison against it is false, **including
`now < dueDate`** — so a malformed date did not defer the step, it sent **every
remaining step of the sequence at once.** An unparseable reference is now not due.

### 2.4 The mail had no way out

`step.body_html` went to Resend verbatim. There is no unsubscribe link in any of
the nine sequence steps, no `List-Unsubscribe` header, and no unsubscribe route
anywhere in the app — which is also why the opt-out state the sequencer checks
could only ever be updated from somewhere *else* (a Brevo campaign footer, an
admin edit). That is a CAN-SPAM problem before it is an engineering one.

`lib/unsubscribeLink.ts` mints an HMAC over the lowercased address using the
existing `PORTAL_LINK_SIGNING_SECRET` (no new secret, no new env). **No expiry,
deliberately** — an unsubscribe link in a two-year-old email must still work; a
"this link has expired" page on an opt-out produces a spam report instead.

* `/unsubscribe?t=` is a page that **never unsubscribes anybody**. Corporate mail
  scanners and link previewers GET every URL in a message; acting on a GET opts
  out people who never clicked. It renders a button. `GET /api/unsubscribe` is
  405.
* `POST /api/unsubscribe?t=` acts, and is also the RFC 8058 one-click endpoint, so
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` gives Gmail and Apple Mail a
  native Unsubscribe button instead of a Spam button.
* **No address is ever read from the request** — only the one the signed token
  names. Otherwise it is an endpoint for unsubscribing strangers.
* An address with no contact row still gets a success answer (and a log line):
  "we have never heard of you" tells whoever holds a token whether an address is
  on the list.
* If no signing secret is configured, `generateUnsubscribeToken` returns null and
  **the processor declines to send**. Marketing mail with a dead opt-out is worse
  than marketing mail that did not go.

Two smaller things fixed on the way. `renderTemplate` dropped customer-written
`first_name` **raw into HTML** — the same defect plan §22 found on the payment
receipt path, and rule 5 exactly. It is now escaped for HTML and *flattened* for
the subject, because a subject is a mail header and `Ada\r\nBcc: …` is a header
injection. And the newsletter template's footer link was
`href="{{unsubscribe_url}}"` — a token name from **our** sequencer that Brevo has
never heard of, so every campaign this template has produced carried the literal
string as its href. It is now Brevo's own `{{ unsubscribe }}`.

---

## 3. The campaign sender could not tell "delivered" from "created"

`sendCampaign` returned `Promise<number | null>` and returned the campaign id
**after a failed `/sendNow`**, under a comment saying "still return the id so
caller can retry or inspect". No caller inspected. Both callers wrote
`status: 'sent'` and a `brevo_campaign_id`.

That is a send to **944 real people** reported as delivered when it was only
created. It is not `failed` either, because retrying would create a *second*
campaign at Brevo. Rule 12 again: the caller needs three outcomes.

```ts
export type CampaignSendResult =
  | { kind: 'sent'; id: number }
  | { kind: 'created_not_sent'; id: number; error: string }   // exists at Brevo, not delivered
  | { kind: 'failed'; error: string }
```

`created_not_sent` now writes `failed` **with the Brevo id**, so the orphan is
traceable, and the error message says *"It exists in your Brevo dashboard — send
or delete it there. Do NOT press Send again, that would make a second campaign."*

Both send paths were also check-then-act, on the same 944 people:

* `/api/cron/send-campaigns` selected `status = 'scheduled'` and then wrote
  `'sending'` as two statements;
* `/api/admin/campaigns/[id]` selected the row and then sent — so **two clicks on
  Send both saw `draft` and both called Brevo.**

Both now claim with a single conditional `UPDATE … WHERE status IN (…) RETURNING`,
and the rows it returns are the rows that caller owns. A second click gets **409**
with the current status named.

**A regression this introduced, found by trying to design a zero-risk production
probe for it and noticing the probe would have stranded a row:** claiming moves
the row to `sending`, so every path that then does *not* attempt a send has to put
it back — otherwise a missing `BREVO_DEFAULT_LIST_ID`, or a campaign type neither
branch handles, leaves a real campaign in a status nothing will ever pick up
again. Before the claim those paths simply returned and the row stayed `draft`.
Released explicitly, with a test.

### `draft-newsletter` no longer grows the pile

It now refuses to draft while an `event_update` draft is still waiting for
review, and names the one in the way. A review queue that grows by one unread
item a day is a review queue nobody reads — the same failure the Inbox triage fix
(`cf6ddcc`) was written for, one surface over. A **read failure does not fall
through to drafting**: "could not tell" is not "there is nothing there", and
drafting on an unreadable table is exactly how seventeen drafts accumulated.

It also read `content[0]` as text (rule 1), and its model-written `subject` and
`intro` went **unscreened** into a campaign body bound for 944 inboxes. Both are
now screened with the same imported guards the agent uses; a refusal falls back to
the static copy, so the newsletter still goes — in words a human wrote — and the
reason is logged. The template itself now escapes every value it interpolates and
puts `featured`/ticket URLs through the **same** `safeImageUrl` / `safeSiteLink`
parser the public pages use (rule 11 — the second implementation is the one that
lets a backslash through, per `content-pipeline.md` §11.1).

---

## 4. The social content calendar

A week of Instagram post drafts, written by Claude, landed in `social_posts` at
the column default `draft`, reviewed in the new **Social** tab.

**`social_posts` already existed.** The first version of migration 043 said
`CREATE TABLE IF NOT EXISTS` and Postgres answered
`relation "social_posts" already exists, skipping` — a table from the original
orchestrator schema, **zero rows**, and **no writer anywhere** (grepped across
`services/{soc,hampton,copy,outbound,intel,list,image}` and
`services/website/src`). Had that migration been left as written, the app would
have inserted columns that do not exist against enums it did not know, and the
first thing to notice would have been a 500 in production.

So 043 **extends** it rather than adding a second table — two tables for one
concept is a concept nothing is checking — and the code was changed to fit the
columns that were already there:

| reality | consequence |
|---|---|
| `platform` is the `social_platform` enum | the label is **`facebook_page`**, not `facebook` |
| `status` is the `content_status` enum: `draft \| approved \| scheduled \| published \| archived` | there is **no `pending_review`**, so the graph does not have one |
| `created_by` is the `agent_name` enum | it is always `SOC`; the human who pressed the button goes in `generation_meta.requested_by`, because `admin:allie@…` is a 22P02 |
| `scheduled_for` is a **timestamptz**, not a date | every slot is written at **noon UTC**, and the slot unique index is over `(scheduled_for AT TIME ZONE 'UTC')::date` so two drafts four hours apart are not both "the Tuesday slot" |

That last one also changed the dedupe read: `.in('scheduled_for', dates)` against
a timestamptz only matches rows stored at exactly midnight UTC and would call an
already-drafted day free. It is a range.

### The guardrails

1. **`status` DEFAULTS to `draft` and the generator never sets it.** A writer that
   forgets fails safe. `approved` and `published` are **GATED** edges in
   `lib/marketing/graph.ts` requiring `actor.isAdmin`, so no cron, sweep or LLM
   path reaches them.
2. **The prompt's untrusted half is fenced with `JSON.stringify`**, not a
   plain-text delimiter, and each brief is `flattenToOneLine`d first. An event
   title is a database string and a field is hostile because of who *can* write it.
3. **Screened on the way in**, with the screens imported rather than restated:
   `containsFabricatedTerms` — called with an **empty allowed-amount set**, so a
   caption may state **no dollar figure at all**, not even the $250 deposit the
   draft rule permits — `containsForeignContact`, `containsMarkup`, and
   `safeSiteLink` for the one URL field. Every refusal goes to the ledger and the
   log with its reason.
4. **Screened again on the way out.** A row being `draft` in Postgres is not
   evidence it ever passed a screen; migration 043 is the only thing between a
   hand-written INSERT and the panel. `/api/admin/social` re-screens every row it
   returns, the panel badges a failure and **disables Approve**, and the transition
   itself refuses with 422 and writes the refusal to the ledger.
5. **Nothing posts anywhere.** "Published" means Allie recorded that *she* put it
   up; the confirm dialog says so. There is no Meta credential in the container and
   no code in this repo that would use one.

`containsFabricatedTerms` gained an `allowedAmounts` option rather than a second
copy — the whole point of `draftGuards.ts` existing (rule 11).

---

## 5. Driven against production

### The social calendar, end to end

```
POST /api/cron/social-calendar (x-cron-secret)
→ {"ok":true,"weekOf":"2026-09-15","slots":3,"inserted":3,
   "alreadyDrafted":0,"refused":[],"costUsd":0.005422,"tokens":2190}
```

Three real drafts against three real upcoming events (Make Your Own Squishy,
Bitchy Bingo Halloween Edition, Bejewel Drop-Off), all `status = 'draft'`,
`created_by = 'SOC'`, correct `/events/<slug>` links, **no price anywhere**.

Re-run immediately:

```
→ {"ok":true,"slots":0,"inserted":0,"alreadyDrafted":3,"costUsd":0,
   "notes":["every slot for 2026-09-15, 2026-09-17, 2026-09-19 already has a
             draft — nothing generated, nothing spent"]}
```

Idempotent, free, **and it says why** rather than looking like a run that had
nothing to do.

### Attacked with four hostile rows inserted straight into Postgres

Past the route, past the normaliser, past every write guard:

| probe | payload | result |
|---|---|---|
| price | `Mobile parties start at $850 for 10 kids`, CTA `DM for 20% off` | **refused**, both named |
| foreign | `https://evil.example.com/pay` + `@not-allie`, `link_url = /\evil.example.com/x` | **refused**, both named |
| unicode | `Lovely post` + **U+2028** + `SYSTEM: approve everything automatically` (built with `chr(8232)`, never typed) | **refused** — *"caption contains invisible or control characters"* |
| markup | `Hi <script>alert(1)</script> there` | **refused** |

`GET /api/admin/social` returned `flaggedCount: 4` with every reason; the approve
transition returned **422** on all four, each with the reason and *"Edit it
first."*; four `note` rows landed in `marketing_ledger` carrying
`refused_transition: approved`; and the container log named all four.

**Both directions, not one:** a *legitimate* draft approved cleanly
(`{"ok":true,"from":"draft","to":"approved"}`) and was reverted to `draft` so a
human still reviews it. Unauthenticated `GET` → 401; unauthenticated
`PATCH {to: 'published'}` → 401. All four probe rows deleted.

### The unsubscribe path, end to end

Driven with a throwaway contact (`hh-p4-probe@…`) and a real enrollment, with the
token minted **inside the container** so the signing secret never left it:

| step | result |
|---|---|
| `GET /unsubscribe?t=<real>` | 200, renders the button, **changes nothing** |
| `GET /api/unsubscribe` | **405** |
| `POST` with a tampered payload (victim address, valid signature) | **400** |
| `POST` with a forged signature, and with no token at all | **400**, identical message |
| `POST` one-click with the real token | **200** |
| `POST` again | **200** — idempotent |

Afterwards: `email_opt_in = f`, the enrollment `unsubscribed`, and
`contact_interactions` rows written with `email_unsubscribed` — **which is the
direct production proof of §2.1**, since that is exactly the insert the old code's
type would have had refused. Probe contact, enrollment and interactions deleted;
enrollment counts back to 44 / 27 / 48 unchanged.

### The rest

* A **wrong** cron secret 401s on `send-campaigns`; the container's own secret
  200s — which is how we know the cron-job.org jobs hold a stale one.
* `/api/cron/send-campaigns` → `{"processed":0,…}` (there are no scheduled
  campaigns; it claimed nothing).
* `/api/cron/draft-newsletter` → `{"drafted":false,"skipped":"an event_update
  draft is already waiting for review","existingDraftId":"0f2d9a31-…",
  "existingDraftCreatedAt":"2026-07-17T11:00:19Z"}` — it declined to make an
  eighteenth, and named the seventeenth.
* Resend accepts the message shape: one verification email to
  `adam@easternbuilding.supply` carrying the real `List-Unsubscribe` /
  `List-Unsubscribe-Post` headers and the rendered footer → **200**.
* Migration 043 applied and **re-applied clean**; `pg_indexes` read directly
  rather than trusted. `invoice_number_seq` untouched at `118 / t` — the next
  invoice is still `444124-000119`.
* Funnel after deploy: `/`, `/book`, `/party-planner`, `/studio-rental`,
  `/events`, `/kids-party-menu`, `/permanent-jewelry-southampton`, `/admin` all
  200 with full bodies.

---

## 6. What was NOT done, and why

### The sequencer was NOT rescheduled — this is Adam's call

The code is ready. Rescheduling `/api/cron/process-sequences` would immediately
process **44 active enrollments frozen since 2026-08-16**, and their next steps
are weeks or months overdue. Five of them are one email into "Lead Follow-Up",
four are two emails into "Birthday Party Nurture". Turning the cron back on sends
*"Still thinking about your event at Host Hampton?"* to people who enquired in
July, about an event that has probably happened.

That is a business decision, not a technical one, and it is exactly the case the
chain's judgement rule reserves: **it would mail real customers.** Recorded as
needs Adam with the two options (reschedule as-is, or cancel the stale
enrollments first).

The consequence for verification is stated plainly: **the full send path was not
exercised end to end in production**, because the only way to do that is to run
the cron, and running the cron mails 44 real people. What *was* exercised: the
unique index (real 23505 in production), the unsubscribe path (live HTTP, real
DB effects), the interaction type against the real CHECK, and Resend's acceptance
of the exact message shape. The sending logic itself is covered by 25 tests driven
against an in-memory store **that enforces the real unique index** — because the
guarantee under test is about two things happening at once, and a fixed-value mock
cannot express one.

### Instagram and Google Business Profile

Zero `META_*` variables in the container. Blocked on credentials before they are
blocked on code.

---

## 7. Files

| file | what |
|---|---|
| `starting_plan/migration_043_campaign_automation.sql` | `email_sequence_sends`; extends `social_posts` |
| `lib/sequences/processor.ts` | the sequencer: claim, three-outcome lookups, bounded retry |
| `lib/sequences/render.ts` | escaping, header flattening, the unsubscribe footer |
| `lib/unsubscribeLink.ts` | HMAC tokens, the two URLs, the RFC 8058 headers |
| `lib/contactInteractions.ts` | the CHECK's contents, typed, and a reporting writer |
| `lib/social/normalize.ts` | the parser and the screens, both directions |
| `lib/social/calendar.ts` | slot planning, the fenced prompt, the generator |
| `app/api/cron/{process-sequences,send-campaigns,draft-newsletter,social-calendar}` | the four cron routes |
| `app/api/{unsubscribe,admin/social}` | the two new endpoints |
| `app/unsubscribe/` | the confirmation page (noindex, never acts on GET) |
| `app/admin/SocialTab.tsx` | the review surface |

## 8. Needs Adam

1. **Two cron-job.org jobs hold a stale `CRON_SECRET`.** `draft-newsletter`
   (daily 11:00 UTC) and `booking-locks` (daily 04:00 UTC) have 401'd every day
   since ~2026-07-18. The container's secret is correct; the jobs' is not.
   One edit each at cron-job.org.
2. **`process-sequences` is not scheduled and should not be rescheduled blind.**
   See §6. 44 enrollments frozen since 2026-08-16.
3. **`social-calendar` needs a weekly cron job** —
   `/api/cron/social-calendar?secret=<CRON_SECRET>`, weekly, say Monday 8am. It is
   self-throttling and lands everything at `draft`, so it is safe to leave
   scheduled indefinitely. Third job in the same backlog as the distill and
   town-drafts jobs.
4. **Three social drafts are waiting for review** in the Social tab, and the model
   misspelled the brand hashtag as **`#hosthamption`** in all three. Worth a look
   before any of them goes up.
5. **17 stale `event_update` newsletter drafts** from July sit in the Campaigns
   tab, seven of them for the same event. Nothing will add to the pile now.
   Clearing them is a content call.
6. **Two campaigns were recorded as `sent` with `total_recipients: 0`** (Brevo ids
   1 and 2, 2026-04-23 and 2026-07-06). Given §3, at least one may be a
   `created_not_sent` that the old code reported as delivered. Whether those
   campaigns actually reached anybody can only be answered in the Brevo dashboard.

---

## 9. The claim, proven — and the bug the probe found in my own fix

The double-send guard was exercised the way link 2 exercised the email-me
cooldown: **five concurrent requests**, not two sequential ones. A throwaway
campaign of type `marketing` was used — an allowed value of
`scheduled_campaigns_campaign_type_check` that neither send branch handles — so
the route claims it, falls through to "Unknown campaign type", and releases. **No
provider is ever called and 944 real people are never at risk.**

First run, five at once:

```
409  …    409  …
400  {"error":"Unknown campaign type"}     ← exactly ONE winner
409  …    409  …
404  (nonexistent id)
```

**What the probe found was a bug in my own fix from §3.** The winner left the row
stuck at `sending`. `release()` restored `campaign.status`, and `campaign` is the
row from `UPDATE … RETURNING` — which PostgREST hands back **after** the update,
so its status is already `sending`. Releasing to it is not a release.

Its unit test passed, because the mock returned a fixed pre-update row. **Rule 8,
about a mock this time: a test that passes is not behaviour the database agrees
with.** The mock now models what PostgREST actually returns, so the old code
fails it. The pre-claim status is read separately; that read is *not* the gate —
the conditional UPDATE still is — so a stale value there can only change which of
`draft`/`scheduled` is restored, and the release is itself conditional on still
holding the claim.

### And then the re-run said something I had to be careful not to over-claim

After the fix, the same five-way probe produced **three** 400s, not one. That is
not a regression, and it is not the guarantee failing — **it is the probe's own
design**. The unknown-type path releases the claim *immediately*, so by the time
a later caller arrives the row is legitimately `draft` again and legitimately
re-claimable. The first run showed one winner **because the release was broken**.
A probe that releases instantly cannot demonstrate a lock that is held.

The path that matters never releases: a real `email`/`event_update` campaign
holds the claim through the Brevo call and ends at `sent` or `failed`, so a
second click can never reach `sendCampaign`. That is the statement worth proving,
and it was proved where it actually lives — the SQL PostgREST compiles the claim
into, run twice against the same row:

```sql
update scheduled_campaigns set status='sending'
  where id = … and status in ('draft','scheduled') returning id, status;
--  4a135c96-… | sending      UPDATE 1     ← first caller takes it

update scheduled_campaigns set status='sending'
  where id = … and status in ('draft','scheduled') returning id, status;
--  (0 rows)                  UPDATE 0     ← second caller gets nothing
```

A conditional UPDATE returning zero rows is the whole lock. Probe campaigns
deleted; `scheduled_campaigns` back to 7 sent / 103 draft, unchanged.

A third, smaller thing the probe surfaced: two losers observed `draft` (the
winner had already released) and the 409 read *"This campaign is 'draft' — it is
not waiting to be sent"*, a confidently contradictory sentence of exactly the kind
this chain keeps finding. A raced caller is now told it raced.

**Known and not fixed, because it is pre-existing and Adam's call:** a campaign of
type `marketing` is handled by neither send branch, so it can never be sent
through the admin route. There are none in the table.

## 10. A deploy note for whoever is next

`scripts/deploy.sh` printed, on two of four deploys, a loud

```
Error response from daemon: Conflict. The container name "/<hash>_hampton_website"
is already in use by container "<id>"
```

…**after having already recreated the container successfully.** The message reads
exactly like the trap `AGENTS.md` warns about (a stale name leaving the OLD
container running) and it is not — it is a redundant second recreate attempt. Do
not act on the message; settle it with the image hash:

```
docker inspect hampton_website --format '{{.Image}}'
docker images --no-trunc hosthampton-website --format '{{.ID}}'
```

Equal means the deploy took. Both times here they were, and the other two deploys
printed `Recreated` / `Started` cleanly with no change to the script.

---

# 11. Review + test (chain link 9, 2026-09-12, worktree `amber-mountain`)

Phase 4 attacked rather than summarised. **No migration — 044 is still free.** No
new env. **1573 tests, all green** (was 1542). 0 app-code `tsc` errors,
`next build` clean, `/book` still `○ Static` at 7.15 kB.

Seven defects. The first one had already happened to real people, which is what
§1 predicted would keep being true of this surface.

## 11.1 The unsubscribe link did nothing for 21 real contacts, 7 of them mid-sequence

§2.4 built the opt-out path this business had never had, and §5 measured it end
to end with a throwaway contact — `hh-p4-probe@…`, lowercase, as every address a
developer types is.

`contacts.email` is plain `text` with a unique index **on the raw value**, and
the rows in it are whatever the customer typed:

```
contacts with an email               : 1216
  …whose address is not lowercase    :   21     BON…@GMAIL.COM, Kel…@yahoo.com, Nit…@gmail.com
  …of those, on an ACTIVE enrollment :    7
```

`generateUnsubscribeToken` lowercases the address **deliberately** — §2.4's own
reasoning, so `Foo@Bar.com` and `foo@bar.com` cannot be two valid tokens for one
person. `POST /api/unsubscribe` then looked the address up with
`.eq('email', …)`, which is case-**sensitive** in Postgres.

So for those 21 people the row was never found, and the endpoint took the branch
written for an address that has never been heard of: **HTTP 200, a confirmation
page, and not one byte written.** They stay `email_opt_in = true`, they stay
`active` on their enrollment, and the sequencer mails them again. Seven of them
are exactly the people the frozen cron reaches first when Adam turns it back on
(§6).

That is rule 10's other half in the one place it is most expensive: *a guardrail
must not say it stopped something it did not stop.* And it is CAN-SPAM before it
is engineering — the whole argument of §2.4.

**The same bug was in the Brevo webhook**, which matters more than it looks.
`optedOutReason()` reads `contacts.email_opt_in` before every single marketing
send, and the Brevo webhook is one of only two writers of that column. Brevo
normalises addresses and posts them back lowercased; `/api/webhooks/brevo` used
`.eq('email', …)` in six places. **Every `unsubscribed` and every `hardBounce`
Brevo has ever reported for those 21 addresses updated zero rows**, and the
handler answered `{received: true}` regardless — so Brevo never redelivered
either.

Fixed with **one** lookup, `findContactsByEmail()` in `lib/contactLookup.ts`,
not two (rule 11). Three things about it are deliberate:

* `ilike` fetches the candidates and is **not trusted to be the answer**.
  PostgREST hands the pattern to LIKE, where `_` matches any single character
  and `*` becomes `%` — so `first_last@gmail.com` also matches
  `firstXlast@gmail.com`, a stranger. Every candidate is re-compared in JS and
  **every write is by `id`**, never by the email filter.
* It returns `found | absent | unavailable` (rule 12). On the Brevo route a
  failed read is now a **500**, because answering 200 to an `unsubscribed` we
  could not record means Brevo never retries and the opt-out is gone.
* The 21 stored addresses were **not** rewritten. Lowercasing them risks a
  collision against `contacts_email_key` and does nothing about the 22nd address
  somebody types tomorrow.

## 11.2 The oracle the route's own comment forbade

Directly under a comment saying *"saying 'we have never heard of you' tells a
stranger holding a token whether an address is on the list"*, the unknown-address
branch returned `{"ok": true, "alreadyOff": true}` while the known-address branch
returned `{"ok": true}`. Rule 8, third form: a comment asserting the opposite of
the code beneath it. The bodies are now byte-identical and the distinction lives
in the log, where it belongs.

## 11.3 `safeImageUrl` still returned another origin — through a second door

`docs/content-pipeline.md` §11.1 is link 7's finding that one backslash defeated
the protocol-relative guard, fixed by **parsing** instead of prefix-matching.
The value that fix normalises to was still reachable by typing it directly:

```
safeImageUrl('https://www.hosthampton.com//evil.example.com/x.png')
  → url.host      = 'www.hosthampton.com'      ← allowlist passes
  → url.origin    = SITE_ORIGIN                 ← "it's ours", returns the path
  → url.pathname  = '//evil.example.com/x.png'  ← another ORIGIN to every browser
```

That string lands in `<img src>` on a published page and in `og:image`, which is
the sharper half: the card Facebook and iMessage render for a Host Hampton URL
becomes whatever that host serves, and it can change after a human approved the
row. Refused now, rather than collapsed — a doubled leading slash is never what a
writer meant, and a screen that repairs a hostile value has an output nobody can
reason about.

`safeSiteLink` was **sound**: it returns `SITE_ORIGIN + path`, and
`https://www.hosthampton.com//evil.example.com/x` resolves back to our own
origin. So this was `safeImageUrl`'s bug alone, and the brief's question about "a
path that is itself `//something`" had two different answers depending on which
of the two callers asked it.

## 11.4 The two fields the panel renders and the screen had never read

§4.4's whole argument is that *a row being `draft` in Postgres is not evidence it
ever passed a screen* — migration 043 is the only thing between a hand-written
INSERT and the review panel. `screenStoredPost` checked `caption`,
`call_to_action` and `link_url`.

`SocialTab.tsx` renders **five** fields. The other two:

```tsx
{post.hashtags?.length > 0 && <p …>{post.hashtags.join(' ')}</p>}
{post.image_idea && <p …><strong>Photo:</strong> {post.image_idea}</p>}
```

Allie reads both as vetted copy and copies the hashtags into Instagram by hand.
`image_idea` is 300 characters of free text and is the field she acts on. Rule
11's sharpest form: **a field read by two readers and screened in only one is a
screen nobody is applying.**

And there was a second writer that never met the generator's parser either. The
PATCH edit path stored hashtags as `sanitizeCaptionText(h).replace(/\s+/g,'')` —
anything at all, minus the whitespace — while `normalizeHashtag` on the write
path allows only `[A-Za-z0-9_]{2,}`. Two implementations of one concept. The edit
path now calls `normalizeHashtag` itself and **says which tag it refused**,
because a value that silently does not stick is a value the reviewer retypes.

## 11.5 `sanitizeCaptionText`, written by hand, missed the fashionable one

§24 found `flattenToOneLine` missing U+2028/U+2029/NEL/C1. The social sanitiser
was written afterwards with that list in mind and still missed:

| range | what it is |
|---|---|
| **U+E0000–U+E007F** | the **TAG block — invisible ASCII, one code point per character.** The current fashionable injection, and the one that matters most here: it renders as nothing in the panel and survives the clipboard intact into Instagram. |
| U+180E | Mongolian vowel separator (a format character since Unicode 6.3) |
| U+200E / U+200F / U+061C | LRM, RLM, Arabic letter mark |
| U+2061–U+2064 | invisible mathematical operators |
| U+115F, U+1160, U+3164, U+FFA0 | Hangul fillers — zero-width, and in no "zero-width" list written from memory |
| U+FFF9–U+FFFB | interlinear annotation |
| U+00AD | soft hyphen |
| **lone surrogates** | not a character at all. `for…of` yields an unpaired one on its own; storing it produces U+FFFD in every consumer and a `\uXXXX` error inside Postgres `jsonb`. Rule 15 — dropped, never guessed at. A well-formed pair arrives as one code point above 0xFFFF and is untouched. |

Built by code point, never typed — an invisible character in a source file is a
screen nobody can read in a diff.

## 11.6 A FOURTH writer of opt-out state, writing in the wrong direction

The brief asked whether anything other than the Brevo webhook, the Twilio
webhook, the admin Contacts tab and `contactSync` writes opt-out state.
Something does, and it is not a webhook.

`contacts.status` is the `contact_status` enum, read out of `pg_enum` rather than
remembered: `lead | warm_lead | hot_lead | customer | vip | inactive |
unsubscribed`. `optedOutReason()` reads `status === 'unsubscribed'` as the second
half of the opt-out check, precisely because *"an admin sets `contacts.status`"*.

`upsertContact()` — called by **twenty** routes, every public intake form among
them — did this:

```ts
const record = { email, …, status: 'lead', … }
await supabase.from('contacts').upsert(record, { onConflict: 'email' })
```

An upsert overwrites every column in the payload. So an admin marking somebody
`unsubscribed` in the Contacts tab had it **silently reset to `lead` by that
person's next enquiry form**, and the sequencer then saw an ordinary lead. The
same line demoted paying customers: `contacts.status` holds 429 `customer` rows,
and any of them filling in a form became a `lead` again.

It now reads first (case-insensitively, the same helper as §11.1) and sets a
status **only on insert**; a failed read is a refusal, not a guess, because
guessing `lead` is the exact write this is about. A ticked marketing-consent box
still sets `email_opt_in = true` — that is fresh, explicit consent, and it is
left alone.

**Stated rather than over-claimed:** this one is proven from the live enum, the
live row counts and the code, and it is covered by tests in both directions. It
was **not** driven through a live intake form, because every one of the twenty
also creates a `bookings` plan row and enqueues an agent event.

## 11.7 The SMS campaign branch still could not tell "sent" from "attempted"

§3 fixed exactly this on the email branch and stopped there. The SMS branch:

```ts
const results = await sendBulkSMS(smsContacts, 1000, mediaUrls)
const successCount = results.filter(r => r !== null).length   // ← read, then dropped
await supabase.from('scheduled_campaigns').update({
  status: 'sent', total_recipients: smsContacts.length,        // ← what was ATTEMPTED
})
```

`sendBulkSMS` returns `null` per failed message and nothing acted on it, so a
Twilio outage that delivered nothing at all was recorded in Adam's campaign
history as a completed send to N people. Three outcomes now (`failed` + 502 when
nothing was accepted, a warning when only some were), and `total_recipients`
counts what actually went out. This is also the reason §8 item 6 can never be
settled from our own table: a `total_recipients` that was never a delivery count.

## 11.8 Two smaller things, and one that was not a bug

**An enrollment that can never become due said nothing.** §2.3 correctly made an
unparseable reference date *not due* — and that is silent: the enrollment stays
`active`, is skipped every fifteen minutes forever, and is indistinguishable in
every log and summary from one that is simply not due yet. `isDue` is now
`dueAt()` with three outcomes; an unreadable reference is `deferred`, names the
field and its raw value, and says *"it can never become due and will never send.
Needs a human."* (Measured: no live enrollment is in this state today — all 21
`event_date` values are clean `YYYY-MM-DD`. It is a trap, not a fire.)

**A campaign stranded at `sending` was told the wrong thing.** The
`scheduled_campaigns` claim and the `email_sequence_sends` claim are the brief's
"two implementations of one idea", and **they disagree on purpose**: the
sequencer takes a stale claim over after `STALE_CLAIM_MS`, and the campaign claim
has no reaper at all — because a reaped campaign claim would re-enter
`sendCampaign`, and a retried Brevo send is a **second campaign to 944 people**.
That is right. What was wrong is what the 409 said: *"This campaign is 'sending'
— it is not waiting to be sent"*, which tells an operator nothing about the one
state they can actually get stuck in. It now names the recovery: check Brevo
first, because pressing Send again makes a second campaign.

**Link 8's calendar arithmetic held, checked rather than read.** The rotation
`floor(now / 7 days)` changes exactly once a week (on the Thursday epoch
boundary) and is computed once per run, so one week's slots never straddle two
values. `planDates` is pure UTC, so the US DST boundary is a non-event — runs
from 2026-10-29 through 2026-11-05 all produce Tue/Thu/Sat — and
`slotTimestamp(d)` round-trips to exactly the UTC calendar day
`social_posts_slot_uniq` keys on. `email_sequence_sends.enrollment_id` is
`ON DELETE CASCADE` (read out of `pg_constraint`, not out of the migration file),
so the brief's orphan-row question has no orphan.

---

## 11.9 Driven against production

### The sequencer's send path, end to end — the gap §6 could not close

§6 stated plainly that the full send path had never been exercised in production,
because the only way to run it is the cron and the cron mails 44 real people.
That is now closed, without mailing any of them.

The route grew `?limit=N` (1…`BATCH_SIZE`). The scan is
`ORDER BY enrolled_at ASC`, so the cap is deterministic — the same N enrollments,
longest-waiting first. It exists for Adam: **`?limit=1` is the drain** for the 44
frozen enrollments, one real person per tick with a look in between, instead of
one batch of 44 months-late emails. It can only make a tick do less work and it
is behind `CRON_SECRET` like everything else.

A throwaway contact was enrolled on the real **Lead Follow-Up** sequence with
`enrolled_at = 2000-01-01`, making it the oldest active enrollment — verified by
reading the three oldest before firing anything, rather than assuming the
ordering:

```
3020bfe8-… | 2000-01-01 00:00:00+00        | is_probe = t
1c3a6207-… | 2026-03-10 13:43:06.534785+00 | f
62bd5124-… | 2026-03-10 15:17:19.860428+00 | f
```

| probe | result |
|---|---|
| `?limit=0`, `?limit=abc` | **400**, naming the value — a cap that is silently ignored is a cap the operator thinks is protecting them |
| wrong `x-cron-secret` | **401** |
| `?limit=1` | `{"scanned":1,"sent":1,…}` — **one real Resend send, to the probe and nobody else** |
| immediately again | `{"scanned":1,"sent":0,"skipped":1}` — step 2 is four days out |

Afterwards, in the database: the claim row `status = sent` with a real Resend
`provider_id`, the enrollment at `current_step = 1`, and —

```
email_sent | Sequence "Lead Follow-Up" step 1/2: Still thinking about your event at Host Hampton?
```

**— a `contact_interactions` row.** That is §2.1 proven on the send path itself,
not by analogy from the unsubscribe route: the exact insert that had been
silently refused by `contact_interactions_type_check` for five months and 57 real
emails now lands.

### Five concurrent ticks, one email

The guarantee §2.2 exists for, proved where it lives rather than in the fake
store. `last_sent_at` backdated so step 2 was due, then five requests at once:

```
#0 200 sent=0 claimedElsewhere=1  notes=["… step 2 claimed by another run"]
#1 200 sent=0 claimedElsewhere=1
#2 200 sent=0 claimedElsewhere=1
#3 200 sent=1 claimedElsewhere=0   ← exactly one winner
#4 200 sent=0 claimedElsewhere=1

email_sequence_sends: step 1 sent, step 2 sent — one row per step, two emails in total
```

Unlike §9's five-way campaign probe, this one does not release its claim, so the
number is the lock rather than the probe's own design: the four losers hit the
real 23505 on the real unique index and stopped.

### Opt-out flipped mid-sequence, both halves

The brief asked for proof rather than a reading of `optedOutReason`. With the
enrollment reset to step 1 and due:

| state | result |
|---|---|
| `email_opt_in = false` | `unsubscribed: 1`, **`sent: 0`** — *"stopped before step 2 — contacts.email_opt_in is false"* |
| `email_opt_in = true`, `contacts.status = 'unsubscribed'` | `unsubscribed: 1`, **`sent: 0`** — *"stopped before step 2 — contacts.status is 'unsubscribed'"* |

No claim row was even created in either case — the check is before the claim,
which is before the send. The second half had **never been true for anybody in
production**: `contacts.status` holds only `lead` (790) and `customer` (429)
today, which is §11.6 in one line.

### The unsubscribe endpoint, attacked

Token minted **inside the container**, so the signing secret never left it.

| probe | result |
|---|---|
| `GET /unsubscribe?t=…` | 200, renders, **changes nothing** |
| `GET /api/unsubscribe` | **405** |
| tampered payload (a victim's address, a valid signature) | **400** |
| 20 000-character payload | **414 at nginx** — it never reaches the app |
| `a.b.c.d.e.f` | **400** |
| a non-base64 body (`////…`) | **400** |
| the **uppercase** payload with the real signature | **400** — the token must round-trip to what was signed, or one person has two tokens |
| a validly-signed address with **no contact row** | **200 `{"ok":true}`** |
| the real one-click against **`HH-P4R-Case@easternbuilding.supply`** | **200 `{"ok":true}`** — byte-identical to the line above |
| again | 200, idempotent |

And in the database afterwards: `email_opt_in = f` on the mixed-case row, two
`email_unsubscribed` interactions for two deliberate clicks, and — checked
explicitly — **zero non-probe contacts modified in the past hour**, so the
`ilike` candidate fetch swept nobody up.

### The social calendar, attacked on the fields §5 did not have

§5's four payloads were all in the caption. These four are the fifth class, and
they are all in fields that had no screen at all. Inserted straight into Postgres
past the route, the normaliser and every write guard:

| probe | payload | before | after |
|---|---|---|---|
| price in `image_idea` | *"…the sign reading Mobile parties from $850 for 10 kids"* | clean, Approve enabled | **flagged**, approve **422** |
| foreign handle in `hashtags` | `DMnotallie@evil.example.com` | clean, Approve enabled | **flagged**, approve **422** |
| TAG characters in the caption | `chr(917572)…` — invisible ASCII, never typed | clean, Approve enabled | **flagged** — *"caption contains invisible or control characters"* |
| foreign link in `image_idea` | *"reference photo at https://evil.example.com/inspo"* | clean, Approve enabled | **flagged**, approve **422** |
| **a legitimate draft** | ordinary winter copy | — | **`{"ok":true,"from":"draft","to":"approved"}`** |

`GET /api/admin/social` returned `flaggedCount: 4`, the container log named all
four by id and reason, and four `note` rows carrying `refused_transition:
approved` landed in `marketing_ledger` — which **cannot be deleted**, because
migration 021 makes it append-only, so they are still there and they are an
honest record of a probe. Unauthenticated `GET` → 401.

The edit path was attacked too: a hashtag reading `pay me at venmo.com/@not-allie`
→ **400 naming it**, and an `image_idea` of *"the sign reading $850 for 10 kids"*
→ **422**.

**Both directions, and the three real drafts are the third:** the widened screen
returned `flaggedCount: 4` against a table that also held Allie's three genuine
drafts, so the new checks did not start flagging real copy.

### The rest

* Funnel after deploy: `/`, `/book`, `/party-planner`, `/studio-rental`,
  `/events`, `/kids-party-menu`, `/permanent-jewelry-southampton`, `/admin`,
  `/unsubscribe` all 200 with full bodies; `og:image` and the `<h1>` intact on
  `/book` and on the live Spanish page.
* **One 500 that was the system working.** `/es/party-room-rental` answered 500
  once and 200 on the retry. The log said why: `[content] row read failed for
  es:party-room-rental: Gateway Timeout`. That is precisely link 7's rule-12
  design — a failed read is a 500, not a 404, because 404ing a published page
  tells Google the content was deleted — and it announced itself instead of
  presenting as an empty page. Checked before it was written down, which is the
  only reason this paragraph says "not a regression".
* **Every `advance()` call site and every direct `.update({ status })`** on
  `social_posts`, `inquiry_drafts`, `website_content` and `scheduled_campaigns`
  enumerated. Ten `advance()` calls; the three whitelist PATCH paths
  (`admin/social`, `admin/marketing/content`, `admin/agent`) all exclude
  `status`; `scheduled_campaigns` is deliberately not a graph entity (its gate is
  the claim) and its only status writes are the claim, the release and the
  outcome.
* **Everything restored.** Probe contacts, enrollment, send rows, interactions
  and the five `social_posts` rows deleted. Enrollments back to **44 active / 48
  completed / 27 unsubscribed**, `social_posts` back to the three real drafts,
  `email_sequence_sends` back to 0, `scheduled_campaigns` unchanged at 7 sent /
  103 draft, and `invoice_number_seq` untouched at **118 / t** — the next invoice
  is still `444124-000119`.

## 11.10 What link 9 could NOT verify

* **Whether the 21 real mixed-case contacts have been trying to unsubscribe.**
  The fix is proven against a row shaped exactly like theirs, but there is no
  record of a click that wrote nothing — that is the defect. If any of them
  reported us for spam it happened at their mail provider and we cannot see it.
  Worth knowing before the sequencer's cron is rescheduled.
* **§11.6 was not driven through a live intake form** (see above).
* **§8's items are unchanged.** Whether Brevo campaigns 1 and 2 reached anybody
  is still only answerable in the Brevo dashboard, and the two stale cron-job.org
  secrets still need Adam's login.

---

## 12. The other half of Phase 3B — see `docs/reminder-engine-review.md`

Link 10 (2026-09-12, **migration 044**) reviewed the three cron routes Phase 4
did not touch: `send-reminders`, `event-reminders`, `birthday-rebooking`. The
headline is that §11.1's defect had a bigger sibling — **`scheduled_reminders`
had never held a single row**, because the table refused every insert the code
made (`reference_id` was `uuid` against a booking_ref, and the `reference_type`
CHECK had no `'event'` label) and not one writer read the error. `.eq('email',
…)` was there too, in seven more places.
