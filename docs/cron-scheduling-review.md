# The cron / scheduling surface — attack and repair

**Link 19 of the build chain. 2026-09-13.** Worktree `bright-mink`.
Main was `47490c7` at the start; the code landed as `96ceaa7`.
**No migration taken. `information_schema` and `ls starting_plan/` were asked
rather than a handover note: 049 is the highest applied, so 050 is still free.**
Suite **2602 → 2662 green**, 0 app `tsc` errors, `/book` still `○ Static`
7.15 kB and serving **52,742 bytes** in production.

Scope: all fourteen routes under `src/app/api/cron/**`, plus the two libraries
they decide with — `lib/sequences/processor.ts` and `lib/reminderQueue.ts`. The
brief named nine jobs; there are **fourteen**, and the five nobody had listed
included the one that could re-text thirteen real customers.

Every scheduled job this business has was written, tested and **not running**.
Nobody had ever exercised them as a SET, and that is exactly where the defects
were: not inside any one job, but in the things all of them assumed.

---

## 1. What was measured first

The live database, `pg_constraint`, `pg_enum`, `pg_trigger`, `pg_proc`, and the
full ten-day nginx window — before anything was concluded (rules 13 and 17).

```
scheduled_reminders                        :    0 rows
contact_sequence_enrollments  active       :   45   oldest enrolled 2026-03-10
                              completed    :   48
                              unsubscribed :   27
email_sequence_sends                       :    0   (migration 043; created AFTER the cron stopped)
scheduled_campaigns  draft                 :  110 total / 103 draft
   …of which campaign_type='event_update'  :  102, 2026-03-08 → 2026-07-17, against 2 ever SENT
bookings upcoming, not cancelled           :   20
bookings approved, cutoff already passed   :    7   ← three of them for parties that already happened
summer_hair_bookings confirmed             :   13, every one reminder_sent = true
website_content pending_review             :    4
content_experiments / variant_assignments  :    0 / 0
agent_learnings is_active                  :    0
marketing_budget 2026-09                   :  $0.556 of $25 LLM, 0 of 500 SMS
```

### The brief's list of jobs did not survive the directory

Fourteen route files, not nine. The five nobody had carried forward:
`send-campaigns`, `draft-newsletter`, `social-calendar`, `birthday-rebooking`
(known but unlisted) and **`summer-hair-reminders`**, which is §5.

### Two jobs ARE scheduled, and both have failed every day

The brief said only `gmail-sync` and `agent-dispatch` are scheduled. Filtering
`docker logs hampton_nginx` by path **and status** — the fleet shares that proxy,
so a bare path count is another business's traffic — says otherwise:

```
/api/cron/agent-dispatch    200 × 1555      every 2 min, working
/api/cron/gmail-sync        200 ×  995      every 3 min, working
/api/cron/booking-locks     401 ×   11      daily 04:00 UTC, user-agent cron-job.org
/api/cron/draft-newsletter  401 ×   11      daily 11:00 UTC, user-agent cron-job.org
```

**`booking-locks` and `draft-newsletter` have a cron-job.org job each and have
answered 401 on every single run in the window.** Their configured secret no
longer matches `CRON_SECRET`. Link 10 flagged this in passing; measured here, it
is not a footnote — it is two jobs that have been dead for at least ten days
(and, given the secret, almost certainly far longer) while looking to anybody
glancing at the box exactly like two jobs that work. **Nothing in this system
monitors a cron's status.** Seven approved bookings are past their modification
cutoff and still say "Approved" because of it.

### Rule 17, asked properly, three times

- **`email_sequence_sends` is empty.** Not a dead subsystem: migration 043
  created that table on 2026-09-12, three weeks *after* the sequencer's cron
  disappeared on 2026-08-16. Nothing has run since it existed. Checked before
  claiming a fifth dead subsystem.
- **`scheduled_reminders` is empty** and, since migration 044, would accept
  rows. Link 10's finding stands and is fixed; the queue is simply unfilled.
- **`bookings_status_check` permits `modifications_locked`** and five real rows
  already hold it, so `booking-locks` is not link 10's "could not have run" — it
  worked once, and then the secret drifted.

---

## 2. The headline: the documented drain drained nobody, and could not have

`PLAN.md` and `AGENTS.md` §8 both describe the safe way to restart the frozen
sequencer for 45 real people:

> `?limit=1` — `/api/cron/process-sequences?secret=…&limit=1` processes only the
> single longest-waiting enrollment per tick (the scan is
> `ORDER BY enrolled_at ASC`, so the cap is deterministic), which means one real
> person at a time with a look in between.

`?limit=N` set `batchSize`, which is a cap on **rows read**. And the two oldest
of the 45 active enrollments — enrolled **2026-03-10**, six months ago — are on
`Post-Booking Prep`, whose `is_active` is **false**. The processor skips an
enrollment on an inactive sequence and leaves it `active`, so those two rows sit
at the top of the oldest-first scan **forever**.

Driven against the deployed code in production, with three throwaway
enrollments proved to sort ahead of every real row:

```
GET /api/cron/process-sequences?limit=1
→ 200 {"scanned":1,"sent":0,"skipped":1,"deferred":0,"failed":0,"notes":[]}
```

Zero notes. Nothing changed. **Byte-for-byte indistinguishable from "nothing was
due"** — which is what an operator draining a backlog one person at a time would
have concluded, run after run, while the backlog did not move. On the live table
`?limit=1` through `?limit=5` all send nothing; `?limit=6` sends one.

This is rule 10's expensive half on the exact mechanism built to protect 45 real
people from a six-month backlog.

**The fix is that `?limit=` counts sends.** `?scan=` is the new, separate bound
on rows read — it exists because it is the only way to drive this route in
production and be able to *prove beforehand* that no real customer's enrollment
was in the scan. They are different questions, and conflating them is what made
the drain a no-op.

Also fixed: an enrollment on an inactive sequence is now counted as
`inactiveSequence` and named in the summary, instead of vanishing into `skipped`
alongside "not due yet".

---

## 3. Nothing anywhere asked how LATE a message was

`now >= due` was the only question either sender asked about time. A step that
came due in July was as due as one that came due five minutes ago.

### What the first tick actually does, computed from the live rows

The 45 active enrollments, resolved against their sequences and steps:

| sequence | active | what the first tick sends |
|---|---|---|
| `Post-Booking Prep` (is_active **false**) | 2 | nothing, forever |
| `Birthday Party Nurture` | 11 | 4 × step 2 *"Thanks for celebrating with us!"*, 4 × step 1 **"Get ready for party day at Host Hampton!"** |
| `Lead Follow-Up` | 31 | 24 × step 1 **"Still thinking about your event at Host Hampton?"**, 1 × step 2 |
| `Room Rental Nurture` | 1 | 1 × step 1 |

**About 34 emails in one run**, to ~30 people. And the content is the problem,
not the volume:

- The four `Birthday Party Nurture` step-1 sends are *"Get ready for party
  day!"* to people enrolled on `booking_confirmed` in **late August** — parties
  that have already happened.
- **Thirteen** of the `Lead Follow-Up` recipients have a confirmed, non-lead
  booking in the database. They are being asked whether they are *"still
  thinking about"* an event they have already paid for.
- `mmcconn8@gmail.com` appears **three times** in one tick — twice on
  `Lead Follow-Up`, because that person has two `contacts` rows (needs-Adam 31),
  and once on `Birthday Party Nurture`. Two identical emails and a third, in one
  run. `acksen28@`, `nnigg726@` and `dstrand4@` are each on two sequences.

`?limit=1` bounds the RATE of that. It does nothing about the content being
wrong, and that is the half nobody had.

### `lib/scheduleFreshness.ts` — two bounds, because "late" means two things

- **`REMINDER_MAX_LATENESS_HOURS` = 48.** Reminders are **date-anchored**; their
  bodies say "tomorrow", "today", "in 7 days". Two days is longer than any
  credible blip in a fifteen-minute job and short enough that a sender which has
  been off for a week cancels its backlog instead of delivering it. A stale row
  is `cancelled` with the sentence on `last_outcome`.
- **`SEQUENCE_MAX_LATENESS_DAYS` = 14.** Sequence steps are
  **relationship-anchored**, so they survive a few days late in a way a
  date-anchored reminder does not. Past two weeks the enrollment is `paused`
  (`email_sequence_status` already has that label — checked in `pg_enum` before
  writing it) and the run summary names it **with the SQL to resume it**.

Both are env-overridable, and an unusable override falls back to the default and
says so rather than silently meaning "no bound".

Nothing is deleted and both outcomes are one statement to undo. That is the
point: it converts an invisible standing hazard into a visible decision for a
human, which is Adam's to make and not mine.

**This is the live exposure on `send-reminders` too**, even though its queue is
empty today: `event-reminders` fills that queue and can be scheduled without the
sender being scheduled — the two are documented as a dependent pair. Two days of
that and every row in it is a false statement about a date.

---

## 4. "Is this the scheduler?" was answered fourteen times, in two spellings

```
seven routes   return !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET
seven routes   return secret === process.env.CRON_SECRET
```

The guarded seven: `agent-dispatch`, `agent-distill`, `experiment-report`,
`gmail-sync`, `process-sequences`, `send-campaigns`, `social-calendar`.
The unguarded seven: `birthday-rebooking`, **`booking-locks`**, `draft-newsletter`,
`event-reminders`, **`send-reminders`**, `summer-hair-reminders`,
`weekly-town-drafts` — including the only route that sends email and SMS to
customers, and the only one that writes to real bookings.

`agent-distill`'s own header comment explains the missing half, four files away
from seven copies that do not have it:

> *the same `!!CRON_SECRET` check agent-dispatch uses — without it an unset
> secret makes the route world-callable to anyone who sends no header at all*

**Measured, not asserted (rule 8): that comment is wrong about today.** With
`CRON_SECRET` unset the guardless form is **not** bypassable, because
`Headers.get()` and `URLSearchParams.get()` both return `null` and
`null === undefined` is false. It is one refactor away — a `?? ''`, a default
argument, a caller that passes a plain object — and the routes behind it lock
customers' bookings, text customers and mail 944 people. It is now
`lib/cronAuth.ts`, once, with the guard, and
`processSequencesRoute.test.ts` drives an unset secret on every transport rather
than reasoning about it.

This is link 18's admin-surface finding one surface over, and rule 11's sharpest
form for the second session running: a concept defined more than once is a
concept nothing is checking.

---

## 5. The loaded gun: `?force=true` re-texted thirteen real customers

`/api/cron/summer-hair-reminders` is a one-day pop-up's appointment reminder,
for an event on **2026-07-03**. It has never been scheduled and appears zero
times in the log window. `summer_hair_bookings` holds **16 real rows — 13
`confirmed`, every one already `reminder_sent = true`** with real names and
phone numbers.

Three triggers on one authenticated GET:

1. **`?force=true` dropped the `reminder_sent = false` filter** as well as the
   date and time-window gates. One request therefore re-texted all thirteen
   people about an appointment two months in the past. `force` now overrides the
   **clock** only; the already-sent guard is not optional, because it is the
   only cross-run idempotency this table has and there is no way to un-send an
   SMS.
2. **It marked rows sent AFTER sending, in one bulk `.in()` whose error was
   discarded** — read → send → mark, the shape link 10 removed from
   `send-reminders`. A failed mark means the next tick texts everybody again.
   The mark is now a per-row CLAIM taken **before** the send, conditional on
   `reminder_sent = false` and read back, and released if the send then fails.
3. **It never checked consent, and it returned the customer list in the response
   body** — `debug: [{name, phone, normalized, slot}]` for every row it looked
   at, plus an `errors` array carrying name and phone, whether or not it texted
   them. Behind `CRON_SECRET`, but a cron response is not a place to put a
   customer list. Consent is now the same fail-closed `hasExplicitSmsOptOut` the
   check-in text uses (an appointment reminder is transactional, so it is not
   gated on the marketing flag — but an explicit STOP is a statement about the
   NUMBER and is honoured, via `findContactsByPhone`), and the payload carries
   counts and `***1234`.

Driven in production after the fix:
`GET …/summer-hair-reminders?force=true` → `{"candidates":0,"sent":0}`.

---

## 6. Everything else that was live

**`booking-locks` counted rows it had not verified it changed.** The UPDATE had
no `.select()` and no status guard, so `locked++` fired for a write that may
have matched nothing, and two ticks both "locked" the same booking. It is now a
conditional claim on `status = 'approved'`, read back, with a distinct note for
"no longer approved when the write ran". Its audit insert discarded its error on
the table whose entire job is to say what happened — now `logBookingChange`
(link 18's one writer). **And it locked parties that had already happened**:
three of today's seven candidates are for 2026-08-21, 2026-09-04 and 2026-09-12.
Nothing in the app enforces `modifications_locked` — it is a label in the Parties
tab and the customer portal, and nothing more — so relabelling finished history
is pure noise. Past parties are counted and named, not touched.

**`send-campaigns` had no per-tick cap.** It claimed *every* row that was
`scheduled` with a past `scheduled_for`, in one statement, and sent them all.
Each campaign is 944 real people, and **102 stale `event_update` drafts about a
July bingo night are one bulk status change away from being claimable**. There
is now a `MAX_PER_TICK` of 5 and a `?limit=1..5`; the cap is applied by an
ordered advisory read whose ids the conditional claim then takes, so the claim
still decides ownership. (`MAX_PER_TICK` is deliberately **not exported** — see
§10.)

**`draft-newsletter`'s archive UPDATE discarded its error.** It is the only
thing that stops a finished event being featured, and a refused archive was
indistinguishable from "there was nothing to archive". Reported and carried in
the response, but not fatal. **Its throttle is also permanently engaged**: it
skips whenever an unread `event_update` draft exists, and there are 102. Until
somebody clears the pile, fixing its secret buys an archive sweep and nothing
else. That is honest — it names the blocking draft — but it is not a working
newsletter, and it is a needs-Adam.

**`weekly-town-drafts` said "All towns already have a draft — nothing to do."**
about eleven towns of which six have none. `Number(process.env.X || 2)` reads
`'abc'` as `NaN` and `'0'` as `0`, and `slice(0, NaN)` and `slice(0, 0)` both
return `[]`. A misconfiguration that reports itself as success is rule 10's
expensive half. An unusable value now falls back to 2 and says so.

**A comment correction.** `draft-newsletter`'s own header said the pile was
"17 `event_update` drafts between 2026-07-01 and 2026-07-17". That was the July
window. Over the whole table it is **102, from 2026-03-08**. Corrected in place.

---

## 7. Driven against production

Deployed as `96ceaa7`; `docker inspect hampton_website` image
`sha256:d9c55586…` equals the built image id, `RestartCount=0`.

The sequencer was driven with **three throwaway enrollments on a throwaway
contact** (`Adam+CronProbe@EasternBuilding.supply`, deliberately mixed-case),
`enrolled_at` 2000-01-01/02/03 so they sort ahead of every real row, on three
throwaway sequences — one inactive, one whose step is due in 2000, and one whose
step uses `delay_reference = 'event_date'` with `event_date = yesterday`, which
is the only way to have a row that both sorts first and is inside the freshness
bound. **The ordering was read before anything was fired:**

```
 e0000000-…dead | CRON-PROBE dead (inactive) | f | 2000-01-01 | probe
 e0000000-…5ade | CRON-PROBE stale           | t | 2000-01-02 | probe
 e0000000-…f7e50| CRON-PROBE fresh           | t | 2000-01-03 | probe
 1c3a6207-…     | Post-Booking Prep          | f | 2026-03-10 | REAL
 …
 real_rows_in_scan (limit 3): 0
```

### Before the fix — the two defects, live

```
?limit=1  → {"scanned":1,"sent":0,"skipped":1,"notes":[]}          the drain, draining nobody
?limit=2  → {"scanned":2,"sent":1,"completed":1}                   a step due in the YEAR 2000, DELIVERED
```

### After the fix — the same three rows

```
?limit=1&scan=1 → sent 0, inactiveSequence 1
   note: "1 active enrollment(s) are on a sequence whose is_active is false — they
          will never progress and will be scanned again every tick…"

?limit=1&scan=2 → sent 0, stale 1, paused 1
   note: "…stale: step 1 of "CRON-PROBE stale" was due 2000-01-02T00:00:00.000Z
          (9751 days ago), past the 14 days freshness bound — not sent. PAUSED — a
          human decides whether this person should still hear from us. Resume with:
          update contact_sequence_enrollments set status='active' where id='…';"

?limit=1&scan=3 → sent 1, capped 1
   note: "send cap of 1 reached — 1 enrollment(s) were read and left untouched for
          the next tick"

?limit=1&scan=3 again → sent 0, everything already handled
```

**One send. The cap held. The real rows were never in the scan.**

### The reminder bound, both directions

Two throwaway rows on the same contact, into a queue with **0 real pending rows**
(read first):

```
run 1 → {"due":1,"delivered":0,"skipped":1,"stale":1,
         "reasons":["booking_email_7day: stale: … was due 2026-08-24T07:51:54.885Z
                     (20 days ago), past the 2 days freshness bound — not sent"]}
run 2 → {"due":1,"delivered":0,"failed":1,
         "reasons":["booking_email_1day: no booking HH-PROBE-CRON"]}
run 3 → {"due":0,"message":"no reminders due"}
```

Run 2 is the point: a reminder five minutes late **passed the bound** and went on
to dispatch, where it failed honestly on a reference that does not exist. The
legitimate direction survived.

### Authorization, both directions, on the whole surface

Twelve routes, unauthenticated and with a wrong secret:

```
process-sequences  none=401  wrong=401      draft-newsletter    none=401  wrong=401
send-reminders     none=401  wrong=401      send-campaigns      none=401  wrong=401
event-reminders    none=401  wrong=401      social-calendar     none=401  wrong=401
birthday-rebooking none=401  wrong=401      weekly-town-drafts  none=401  wrong=401
booking-locks      none=401  wrong=401      summer-hair-reminders none=401 wrong=401
experiment-report  none=401  wrong=401      agent-distill       none=401  wrong=401
```

…while every probe carrying the real secret returned 200. Both directions.

### Bounds, refused

```
?limit=0                 → 400 limit must be a number of at least 1 (got "0")
?scan=0 / 51 / lots      → 400 scan must be an integer 1..50
send-campaigns ?limit=99 → 400 limit must be an integer 1..5
```

### Idle paths still say three different things (rule 10)

```
send-reminders        {"ok":true,"due":0,"message":"no reminders due","configured":{"resend":true,"sms":true}}
event-reminders       {"ok":true,"message":"no active events tomorrow","date":"2026-09-14","events":0,"queued":0}
summer-hair           {"ok":true,"message":"Not event day","date":"2026-09-13","sent":0}
summer-hair ?force    {"ok":true,"message":"No reminders to send","candidates":0,"sent":0}
send-campaigns        {"processed":0,"sent":0,"failed":0,"deferred":0,"cap":1,"notes":[]}
```

### Everything restored

`scheduled_reminders` **0**, `email_sequence_sends` **0**, `contacts` **1220**,
`contact_interactions` **143**, enrollments **45 active / 120 total** (48
completed, 27 unsubscribed — unchanged), `email_sequences` **7**,
`email_sequence_steps` **9**, `marketing_ledger` **407 with zero rows written in
the last hour** (nothing permanent this time), `invoice_number_seq` **118 / t**,
`agent_memory.updated_at` still spanning **2026-02-18 … 2026-04-22**, bookings
unchanged (13 approved, 5 `modifications_locked`), `summer_hair_bookings`
untouched at 13 confirmed / 3 cancelled. Every probe row deleted in FK order.

**Three emails were sent, all to `Adam+CronProbe@EasternBuilding.supply`** — two
by the before-probe on the old code and one by the after-probe. No real customer
was emailed or texted, no SMS was sent at all, no Brevo campaign, no Stripe
object, no model call, $0 spent.

Funnel checked live after deploy: all thirteen pages **200**, `/book` serving
**52,742 bytes** — the pinned value to the byte.

---

## 8. The tripwire, and attacking it

`src/__tests__/lib/cronSurface.test.ts` (28 checks, 8 rule groups), in the shape
`portalAuthSurface` / `signwellSurface` / `stripeWebhookSurface` /
`contactIdentitySurface` / `adminSurface` established. Comments are stripped
before every rule.

- **R0** staleness walker: every route file yields a recognised handler; the
  fourteen known jobs are all still present by name.
- **R1** every handler calls `isCronAuthorized`, imported from `lib/cronAuth`.
  No exemptions and no reason for one — a cron route is called by a scheduler.
- **R2** exactly one implementation; no file outside `lib/cronAuth.ts` compares
  against `process.env.CRON_SECRET`; and the guard is pinned **inside the
  function's own brace-matched body**, in order, so moving it after the
  comparison fails.
- **R3** both senders bound lateness, the reminder check sits **after the claim
  and before dispatch**, the sequence check sits **before the claim**, the bounds
  live in one file, and an unusable override falls back rather than opening up.
- **R4** `?limit` reaches `sendCap` and `?scan` reaches `batchSize`, never the
  reverse; the processor enforces the cap against `sent`; `send-campaigns` caps
  and claims by id.
- **R5** the mutating jobs claim before they act — asserted against the sliced
  loop, not the file — and `summer-hair` never puts a name or a raw phone in the
  response.
- **R6** the writes that decide a sentence read their errors; one audit writer;
  no literal admin actor.
- **R7** the standing rules on this surface: no interpolated `.or()`, no direct
  email-column filter, no `x-forwarded-host`.

Beside it, three behaviour suites against fakes that refuse what Postgres
refuses: `sequenceBacklog.test.ts` (10 — the live pile in miniature, in the same
order), `processSequencesRoute.test.ts` (12 — the caps and the unset-secret
behaviour), `bookingLocks.test.ts` (8), and four new cases in
`sendReminders.test.ts`.

**A note about those four.** Eighteen existing `sendReminders` tests turned red
the moment the freshness bound landed, because every fixture was dated
`2000-01-01` — *"long overdue, sorts first"*. That is the bound working: a
`booking_email_1day` twenty-six years late is not a late reminder. The fixtures
now express overdue in minutes, which is what overdue means for a job that ticks
every fifteen. **The same correction applies to the production probe recipe** in
`AGENTS.md`, and it is why the sequence probe had to use
`delay_reference = 'event_date'`.

### The attack: 32 defects reintroduced, one real hole

`scripts/attack-cron-tripwire.js` reintroduces each defect into the real
sources, verifies the mutation **landed** (CRLF and LF anchors), runs the suites,
and restores on every path including SIGINT. **It refuses to run unless the clean
tree is green** — link 17's harness could not spawn its runner and reported all
34 mutations "caught"; link 18's refused once for real.

**First run: 27/31, one genuine hole and it is the same family again.**

> **A rule that greps a block can be satisfied by a different occurrence than
> the one that broke.** Link 16 named it, it cost three of link 18's twenty-six,
> and it cost one of mine.
>
> R5's past-party rule was `expect(loop).toMatch(/party_date/)`. The attack
> neutered the guard to `if (false)` and left `booking.party_date` in the NOTE
> STRING two lines below, which satisfied the rule. The guard's own condition is
> now sliced from its `if` to its `{`, both halves are pinned, and it must
> precede the write.

A second miss was R6's literal-actor rule, which knew the column names
`modified_by`/`recorded_by` but not `actor`, which is `logBookingChange`'s
parameter name — the value reaches the same column either way. Added.

**Three predictions were wrong, and in the useful direction**: `?scan`
validation, a changed claim predicate, and the actor key were all predicted
MISSED and all three were CAUGHT — two of them by the behaviour tests rather
than the shape rules. A shape rule and a behaviour test covering each other is
the point of having both.

**30/32 after the fixes.** The two remaining misses are deliberate non-defects,
kept in the set as controls: a redundant *extra* `checkFreshness` call after the
claim (noise, not a defect — the real check is still first), and a
comment-only change, which proves `decomment()` is doing its job.

---

## 9. What HELD

Reporting only what broke would badly overstate the state of this surface.
Links 9, 10 and 12 did real work here and most of it survived contact.

- **`lib/sequences/processor.ts` is the best-built module in this codebase.**
  Every lookup has three outcomes, the claim is an insert against a unique index
  with 23505 handled by code, the crash-recovery takeover is conditional on the
  attempts count it read, consent is re-read at send time, and the `sent`
  denominator is recorded only after the send really happened. Nothing in §2 or
  §3 is a defect *in* that design; both are questions it was never asked.
- **`send-campaigns` already distinguished "created at Brevo" from "sent"**, and
  already refused to write `sent` over a failed `/sendNow`. The cap is the only
  thing it was missing.
- **`experiment-report` and `agent-distill` both answer 503 on a failed read**,
  so a dead measurement shows a red run rather than a green zero — and
  `experiment-report` names the arms its read-time screen dropped. Reviewed and
  not changed.
- **`event-reminders` enqueues rather than sends**, uses `findContactsByEmail`,
  counts `lookupFailed` separately from `noContact`, and computes tomorrow in
  Eastern time. Link 10's rewrite holds.
- **`social-calendar` and `weekly-town-drafts` cannot publish anything.** Both
  land at `draft`/`pending_review` and both self-throttle before spending money.
  The six gated edges in `lib/marketing/graph.ts` are untouched — still six, none
  added, none removed.
- **`scheduled_reminders`' `scheduled_for` is `timestamptz NOT NULL`**, so the
  "unreadable time" branch cannot be reached from the table (rule 13, asked
  before claiming the branch was live). It is tested against the function
  directly rather than against an impossible row.
- **Every prior tripwire still passes**: `publicOrigin`, `contactLookup`, the
  escaping walker, the Stripe, SignWell, portal, contact-identity and admin
  surfaces.

---

## 10. What I could NOT verify

- **`booking-locks` was not driven in production.** Making it run means flipping
  seven real customers' bookings, which is the job's decision to make on a
  schedule and not mine to make by hand. It is covered by `bookingLocks.test.ts`
  (8 cases, including the race the status guard exists for) and by R5. That is
  the honest coverage; it is not a production run.
- **`draft-newsletter` was not driven either**, because a successful run costs a
  Haiku call and adds a 103rd unread draft to a pile that is already the
  problem. Its archive-error fix is covered by R6 and by inspection.
- **Whether the guardless `isCronAuthorized` was ever actually bypassed.** It was
  not, and could not have been: `CRON_SECRET` has been set throughout, and even
  unset the `null !== undefined` accident closes it. The exposure was structural,
  not incident.
- **How long `booking-locks` and `draft-newsletter` have been 401ing.** The nginx
  window is ten days and shows 11 failures each with zero successes. Rule 17: a
  count over a window is not a statement about history. The database's answer —
  five bookings hold `modifications_locked`, so it worked at some point — bounds
  it from the other side, but the date the secret drifted is not recoverable from
  anything on the box.
- **`send-campaigns` was not driven with a real campaign.** A Brevo campaign send
  is never a test; `BREVO_DEFAULT_LIST_ID=3` is 944 real people. The cap and the
  claim were exercised against an empty scheduled set (which is honest about
  itself) and by unit test.
- **The `?force=true` re-text was never actually triggered.** Thirteen
  `reminder_sent = true` rows and no send record from July prove the guard was
  bypassable, not that anyone bypassed it. It is a loaded gun, not a smoking one.
- **The remaining ~30 unchecked admin writes** (link 18's §8) were the stated
  secondary and were **not** taken. The main scope grew: fourteen jobs rather
  than nine, and two of the findings needed production probes in both directions.
  They are still open and are the natural secondary for the next link.

---

## 11. Needs Adam

**35. Two cron-job.org jobs are 401ing every single day.** `booking-locks`
(04:00 UTC) and `draft-newsletter` (11:00 UTC) hold a stale `CRON_SECRET`.
Fixing it is one login and two field edits. **Do `booking-locks` first and
`draft-newsletter` second, and read item 37 before doing the second one.** When
`booking-locks` starts working it will lock **four** real approved bookings whose
parties are still ahead (`HH-2026-2800`, `HH-PTY-ZPDJQ`, `HH-PTY-F47YW`,
`HH-2026-8242`) and deliberately leave the three whose parties have passed. That
is correct behaviour and it is only a label — nothing in the app enforces the
lock — but it is a visible change in the Parties tab and the customer portal.

**36. The 45 frozen enrollments are now a decision, not a hazard.** With the
freshness bound in place, switching `process-sequences` back on **pauses** every
enrollment whose next step is more than 14 days overdue and names each one, and
sends only the ones inside the bound. The recommended sequence is
`?limit=1&scan=…` to watch it, then unbounded. **The judgement Adam still owns:
thirteen `Lead Follow-Up` recipients already have a confirmed booking** and
should arguably be `completed`, not nurtured — and four of the 45 belong to
duplicated `contacts` rows (needs-Adam 31), so one person would get the same
email twice. Neither is a technical question.

**37. 102 stale `event_update` drafts should be cleared.** `scheduled_campaigns`
holds 102 `draft` rows from 2026-03-08 to 2026-07-17, all about events that have
happened, against 2 ever sent. Two consequences: `draft-newsletter`'s throttle is
permanently engaged, so fixing its secret buys nothing until the pile is cleared;
and each of those rows is one bulk status change away from being claimable by
`send-campaigns`, which would mail 944 people about a July bingo night. The
per-tick cap of 5 bounds the damage; it does not remove the pile. A single
`UPDATE … SET status='archived'` is not available (`scheduled_campaigns_status_check`
permits only draft/scheduled/sending/sent/failed) — so it is a `DELETE`, and
deleting a hundred rows of somebody's content is his call.

**38. `/api/cron/summer-hair-reminders` and its table are dead weight.** A
one-day pop-up from 2026-07-03, with 16 real people's names and phone numbers in
`summer_hair_bookings`, a public booking route, an admin tab and a banner
component. The route is now safe, but the safest version of a job for an event
that is over is not to have it. Whether to retire the feature — and what to do
with the 16 rows of customer PII — is Adam's.

*Carried forward and unchanged:* needs-Adam 18 (schedule the three reminder
crons — still not scheduled, and note `event-reminders` depends on
`send-reminders`), 19 (backfill the 20 upcoming bookings' reminders), 20
(schedule `experiment-report`), 1 (schedule `agent-distill`), 6 (schedule
`weekly-town-drafts`), 31 (the duplicated contacts).

---

## 12. Housekeeping

- **No migration.** `information_schema`, `pg_enum` and `ls starting_plan/` were
  asked: 049 is the highest applied, **050 is next**. `email_sequence_status`
  already contains `paused`, which is why the freshness bound needed no DDL —
  checked before the code was written, not after.
- **Two new environment variables, both optional and both unset.**
  `REMINDER_MAX_LATENESS_HOURS` (default 48) and `SEQUENCE_MAX_LATENESS_DAYS`
  (default 14). Added to the `AGENTS.md` §7 table. Neither is in
  `docker-compose.yml` or `/opt/hosthampton/.env`, because the defaults are the
  intended values and an absent variable is one fewer thing to drift.
- **No secret was printed, logged, committed or displayed.** `CRON_SECRET` was
  read inside the container and only its presence and length were shown.
- **Nothing written to `marketing_ledger`** — 407 before and after, zero rows in
  the probe hour.
- **`invoice_number_seq` untouched** — still `118 / t`, next issued number
  `444124-000119`.
- **A trap hit, and it is the one the brief warns about.** `export const
  MAX_PER_TICK` in a route file is a build-time type error that **neither jest
  nor `tsc --noEmit` reports**. The suite was 2662 green and `tsc` was clean;
  only `npx next build` caught it. Link 17 nearly shipped one; this session did,
  and the build is what stopped it. Run it.
- `audit_scratch/` and `services/website/scripts/attack-cron-tripwire.js` are
  untracked on purpose, per the do-not-commit list.
