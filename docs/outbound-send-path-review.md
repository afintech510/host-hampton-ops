# The outbound send path, as one surface

Link 25 of the build chain. 2026-09-13. Base commit `e1627d9`; the work landed as
`9fc3b62`.

Scope: everything that answers *"we decided to message a customer — did the
message actually go, to the right person, once?"* — `scheduled_reminders`,
`lib/reminders.ts`, `lib/reminderQueue.ts`, `lib/checkinReminders.ts`,
`lib/sequences/processor.ts`, `lib/marketing/**`'s send half, and the eight cron
routes that send or fill a queue something else sends from.

---

## 1. What was measured first

Everything below was read out of production **before** a line changed.

| | measured 2026-09-13 |
|---|---|
| `scheduled_reminders` | **0 rows**, still |
| `email_sequence_sends` | **0 rows**, ever |
| `contact_interactions` | 161 rows, two types only — `form_submission` 111, `sms_received` 50. **Zero `email_sent`, zero `sms_sent`, ever** |
| `contact_sequence_enrollments` | 121 — 46 active, 48 completed, 27 unsubscribed |
| `scheduled_campaigns` | 110 — 103 draft (102 stale `event_update`), 7 sent |
| `marketing_ledger` | 478 |
| `marketing_budget` | `sms_sent = 0` of a 500 cap; `llm_usd_spent` $0.65 of $25 |
| upcoming bookings with no reminders | **21** (the brief said ~18–20; re-measured) |
| `contacts.status` | `lead` 791, `customer` 429. **Never `unsubscribed`** |
| `contacts.sms_opt_in` | 706 false / 514 true / **0 null** |

### The scheduler is not on the box, and nothing on this surface is on it either

`crontab -l` on `hampton-vps` has MyGravelGuy, EasternLM, Maningo and Benchworks
entries and **not one Host Hampton job**. The scheduler is **cron-job.org**, an
account I have no access to. Counting the nginx window (ten days) by path **and
user-agent**, it drives exactly four Host Hampton jobs:

| job | calls | status |
|---|---|---|
| `agent-dispatch` | 1834 | 200 (+9 503, 1 502, 1 500) |
| `gmail-sync` | 1181 | 200 (+4 504, 1 502, 1 404) |
| `draft-newsletter` | 11 | **401, every one** |
| `booking-locks` | 11 | **401, every one** |

**Not one route on my surface has a schedule entry.** `send-reminders`,
`event-reminders`, `birthday-rebooking`, `summer-hair-reminders`,
`process-sequences` and `send-campaigns` show only probe-shaped traffic from
prior links. The entire outbound send path is code that has never been switched
on — which is why its defects were invisible, and why finding them now is cheap.

### Rule 17, asked of each zero, and answered honestly

- `email_sequence_sends` is empty because the table is **newer than the last
  run**. Migration 043 created it; `process-sequences` stopped 2026-08-16 and has
  not run since. Not a defect. The claim path is unproven in production, not
  broken.
- `contact_interactions` has no `email_sent`/`sms_sent` because the only writer
  of them, `logInteraction` in the sequence processor, sits **after a successful
  send** — and no send has happened since it was wired. Also not a defect.
  Worth knowing: **`send-reminders` never calls `logInteraction` at all**, so
  reminder sends will never appear there. The `scheduled_reminders` row is their
  record. Named, not changed.
- `marketing_budget.sms_sent = 0` because its only caller is `birthday-rebooking`,
  which is unscheduled. Named in §5.

---

## 2. The headline: every reminder was scheduled in UTC, and two SMS types broke
the law

`lib/reminders.ts` is the enqueuer every party, booking and event ticket passes
through. It built its send times like this:

```ts
const partyDateObj = new Date(partyDate + 'T12:00:00')   // parsed as LOCAL
oneDayBefore.setDate(oneDayBefore.getDate() - 1)
oneDayBefore.setHours(10, 0, 0, 0)                        // 10:00 LOCAL
```

The container runs in **UTC** — verified on the box, no `TZ` set, node reports
`UTC`. So `setHours(10)` means 10:00 **Zulu**, and all ten reminder types fired
four to five hours before the hour they were written for.

Proved in the container's own environment, both DST halves:

| type | intended | actually fired | |
|---|---|---|---|
| `booking_email_7day` | 10:00 ET | **06:00 ET** (05:00 EST) | |
| `booking_email_1day` — *"Tomorrow's the big day!"* | 10:00 ET | **06:00 ET** | |
| `booking_sms_1day` | 12:00 ET | **08:00 EDT / 07:00 EST** | **SMS** |
| `party_balance_t2` / `_t1` | 10:00 ET | **06:00 ET** | |
| `party_admin_unpaid_dayof` | 07:00 ET | **03:00 ET** (02:00 EST) | owner |
| `party_thank_you_t1` | 10:00 ET | **06:00 ET** | |
| `event_email_3day` | 10:00 ET | **06:00 ET** | |
| `event_email_dayof` — *"See you today!"* | 08:00 ET | **04:00 ET** (03:00 EST) | |
| `event_sms_1day` | 10:00 ET | **06:00 ET / 05:00 EST** | **SMS** |
| `review_request_sms` | 14:00 ET | **10:00 ET** | **SMS** |

The control row in the same run: `checkin_link_dayof`, which goes through
`etToUtc`, landed at **06:00 ET in both seasons** — correctly. So this is the
pattern, not the environment.

**Why the SMS rows are not cosmetic.** The TCPA permits telephone solicitations
only between **8am and 9pm in the recipient's local time**, and the CTIA applies
the same window to text. `event_sms_1day` broke it year-round. `booking_sms_1day`
broke it **only in winter** — 8:00 EDT is legal, 7:00 EST is not. A bug that is
lawful in July and unlawful in December is exactly what hard-coding an offset
instead of converting a timezone buys you.

### How it survived, which is the part worth keeping

`lib/partyTime.ts` has carried this warning since link 12:

> the `new Date(date + 'T12:00:00')` + `setHours()` pattern used elsewhere
> silently schedules in UTC — "6am" would land at 2am Eastern.

Three modules were fixed to use `etToUtc`: `checkinReminders.ts`,
`checkinAuth.ts`, and `birthday-rebooking`, whose comment reads *"The old code
called setHours on a UTC box, which is 6am local."* **`lib/reminders.ts` — which
re-exports `etToUtc` on line 10 — was never one of them.** Hard-won rule 11 in
its sharpest form: a concept implemented twice, one right and one wrong, and the
wrong one is the one that runs.

And the reason no test caught it: **the suite was 3048 green with the bug in, and
stayed 3048 green after the fix.** No test had ever asserted a scheduled time.
The `scheduled_for` values in `reminderEngine.test.ts` are all test *inputs*. The
four enqueuers had no coverage at all.

---

## 3. What was fixed

**At the source.** `lib/reminders.ts` now schedules through `etToUtc`, via a new
`shiftEtDate` in `partyTime.ts` that does calendar arithmetic on a noon-UTC
anchor (noon is twelve hours from either boundary, so a ±n-day shift can never
cross a DST change). An unreadable date now returns `null` and says so, instead
of pushing `Invalid Date.toISOString()` — which **throws**, and the throw was
swallowed by the "non-fatal" try/catch every caller wraps these in, so one
malformed `party_date` silently cost a customer their entire reminder set.

**At the send, because a fix at the enqueue end only protects rows enqueued after
it.** New `lib/quietHours.ts`: an SMS outside 8am–9pm Eastern is **deferred to
the next 8am, never cancelled**. This is not belt-and-braces — `event-reminders`
enqueues `scheduled_for: nowIso`, so its send time is *whatever time of day that
job is scheduled at cron-job.org*, a value this repository cannot see or test.
Schedule it at 02:00 UTC, a reasonable-looking choice, and it texts ticket
holders at 10pm Eastern.

`reminderQueue` gained a `deferred` outcome: back to `pending`, `scheduled_for`
moved, **`attempts` untouched**. A row due at 2am would otherwise burn all four
retry attempts against the clock and reach `failed` having never been handed to a
provider. Deferrals cap at 11 hours, well inside the 48-hour freshness bound, so
a held text can never be cancelled as stale by the guard above it.

**Three more, each measured before it was changed:**

- **`send-reminders`' SMS branch was the sixth reader of "may we message this
  person"** and read `sms_opt_in` alone, never `contacts.status` — the exact
  defect link 17 found in the admin SMS send, and which the sequence processor's
  own comment claims was *"closed here rather than left to a sixth reader."*
  `optedOutReason` is imported now.
  **Rule 17, both answers: it had wronged nobody.** `contacts.status` has only
  ever held `lead` and `customer`. It is the first admin unsubscribe that would
  have found it, silently, by texting somebody who had asked us not to.
- **`send-campaigns` never looked at `campaign_type`.** An `sms` row reaching
  `status='scheduled'` would have been sent as a **Brevo email campaign to list 3
  — 944 real people**. **Rule 17: the door was shut, by accident.** All six SMS
  rows have a NULL `body_html`, so they hit the empty-body guard and were recorded
  `failed` with the note *"no body_html"* — a true sentence about the wrong
  problem. Now classified explicitly, with the allowlist taken from
  `pg_constraint` (`event_update`, `marketing`, `email`, `sms`) rather than from
  the data — an allowlist written from the data would have refused the first
  `marketing` campaign anybody created.
- **`processor.dueAt`** anchored `metadata.event_date` the same UTC way. Converted
  — with a strict `YYYY-MM-DD` test kept, because `etToUtc` slices ten characters
  and converting without it would have started silently *interpreting* anomalous
  values that `phase4Review.test.ts` deliberately reports as `unreadable`
  (rule 15).

---

## 4. The guards, and attacking them

| file | what it holds |
|---|---|
| `lib/outboundSendSurface.test.ts` | 36 rules over 20 modules, list exact **in both directions**, every rule counting what it examined |
| `lib/reminderScheduling.test.ts` | 23 exact instants, EDT **and** EST, plus both DST-transition eves |
| `lib/quietHours.test.ts` | 26 |
| `api/sendCampaignsRoute.test.ts` | 12 — the route had **no** behavioural test at all |
| `lib/reminderEngine.test.ts` | +5 for the `deferred` outcome |
| `lib/partyTime.test.ts` | +5 for `shiftEtDate` |

**The scheduling tripwire was verified against the defect**: reinstating the old
`setHours` expression turns **20 of its 23 tests red**. The three that survive are
the structural ones that do not assert a time — which is the honest shape.

`scripts/attack-outbound.js` (untracked, per the do-not-commit list) reintroduces
**40 defects** one at a time. It refuses to start on a red tree, verifies each
mutation actually **landed** and reports `NOT_APPLIED` rather than counting it
caught, restores on every path including SIGINT, and matches on `\r?\n` because
this repo is CRLF.

**First pass: 38 caught, 0 NOT_APPLIED, 2 survived. Both were real; both are
closed; 40/40 now.**

- **Hole 1 — `created_not_sent` recorded as sent.** The rule asserted the *string*
  `created_not_sent` appears in the file, and `if (false && result.kind === …)`
  keeps it there. **A grep cannot see reachability.** The fix was not a cleverer
  grep but `sendCampaignsRoute.test.ts`, which runs the branch — on the highest
  blast-radius route on the surface, which had no behavioural test.
- **Hole 2 — and I was wrong about it first.** Removing `shiftEtDate`'s
  `^\d{4}-\d{2}-\d{2}` screen left the suite green, and I judged the screen
  redundant, reasoning that the downstream `isFinite` check would catch anything
  malformed. I tested that claim over a 30-input corpus instead of asserting it:
  **`new Date('2026T12:00:00Z')` is not an Invalid Date — it is January 1st**, and
  `'2026-10'` is the 1st of October. A truncated `party_date` would not have been
  refused; it would have scheduled a real customer's reminders around a date they
  never chose. The screen is load-bearing and now has tests.

**Three of the five first-run failures were my own rules anchoring on the
`import` line rather than the call site** — `indexOf('checkFreshness')` finds
line 47, not line 569, so an "A before B" rule compared two import positions.
That is link 21's wrong-occurrence family in a new spelling. The harness now has
a `stripImports` pass with its own test asserting offsets are preserved, and
ordering rules read the stripped body while presence rules read the source.

Two more first-run failures were rules that were **wrong in the false-positive
direction**, found only by firing on correct code: a blanket `setDate` ban (a
now-anchored range query is fine) and a blanket ban on `new Date(x + 'T12:00:00')`
(the noon anchor is the *correct* idiom for date-only display, used by
`send-reminders` and `draft-newsletter` for the date printed in an email). Both
were narrowed rather than suppressed. A rule that cries wolf is a rule somebody
deletes.

---

## 5. What HELD

Worth stating, because most of this surface is careful work by earlier links and
a review that only lists faults misrepresents it.

- **The claim/lock discipline is real, not asserted.** `email_sequence_sends`
  really does carry a unique index on `(enrollment_id, step_number)`
  (`email_sequence_sends_step_uniq`) — I checked `pg_indexes`, not the comment.
  The sequence claim is a genuine lock.
- **`paused` really is in the `email_sequence_status` enum**, so the processor's
  pause path cannot be silently refused. Rule 13 held on both counts.
- **Rule 19 held across the surface.** Every write on the send path reads its
  error. I found no discarded `.error` anywhere in scope — the third consecutive
  link to report that, and it should be believed rather than hunted harder.
- **`lib/sequences/processor.ts` is the best-implemented module here.** Three
  outcomes on every lookup, consent at send time, the claim before the send, the
  `sent` event recorded only after delivery, and notes that name every non-obvious
  outcome. Nothing in it needed changing except the `dueAt` anchor.
- **`summer-hair-reminders` holds up**: claim-before-send, release-on-failure,
  masked phone numbers, fail-closed consent, and `?force` that overrides the clock
  but not the already-sent guard.
- **The freshness bounds are wired and correct** in both senders.
- **Both providers are configured** (`resend: true`, `sms: true`), so the probe in
  §6 exercised a live send path that chose not to send — not an unconfigured one
  that could not.

---

## 6. Production probes

All drove the **deployed** code, on the container's own IP (Cloudflare 403s a
probe through `www`).

**The check that could have voided the entire fix.** A node image built without
full ICU resolves every `timeZone` option to UTC *instead of throwing*. `etToUtc`
would then return exactly the instants the buggy code did, the tests would still
pass on a developer machine, and the fix would be silently inert. Measured on the
box: **ICU 78.2**, `America/New_York` honoured, `14:00Z → 10:00` in October and
`15:00Z → 10:00` in December. The fix is live.

**The send loop, end to end.** Three throwaway `scheduled_reminders` rows for the
designated test contact (`adam@easternbuilding.supply` — `sms_opt_in = false`,
`email_opt_in = false`, no phone), pointed at a booking ref that does not exist.
The scan was read **before** firing: 3 rows, all mine, **zero real rows**.

| | result |
|---|---|
| no credential | **401** |
| `?limit=999` | **400** `limit must be an integer 1..50` — refused, not clamped |
| real run | **200** `due=3 delivered=0 skipped=2 failed=1 deferred=0` |

Read back from the database rather than from the response:

```
birthday_rebook_email | cancelled | 1 | opted_out: email_opt_in is not true | claimed: t
booking_email_1day    | failed    | 1 | no booking HH-PROBE-L25             | claimed: t
booking_sms_1day      | cancelled | 1 | opted_out: sms_opt_in is not true   | claimed: t
```

Every row was **claimed before dispatch**, none says `sent`, none carries a
`sent_at`, and each names why. This is the first time the repaired reminder send
loop has been driven end to end in production. **No message left the building.**

The `booking_sms_1day` row also proves the quiet-hours check is deployed and
non-blocking when the window is open: `checkSmsQuietHours` runs *before* the
consent gate, so reaching `opted_out` means it returned `open` and let the row
through.

**Cleanup.** All three rows deleted. Every table back to baseline exactly —
`scheduled_reminders` 0, `contacts` 1220, `bookings` 62, `marketing_ledger` 478,
`contact_interactions` 161, `portal_tokens` 230. Invoice sequence still
`118 / is_called = t`. `agent_memory.updated_at` still spans 2026-02-18 …
2026-04-22.

**Deploy verified**: box on `9fc3b62`, running image ID equals the freshly built
one, `RestartCount=0`. 13-page funnel smoke all 200, `/book` at 52,742 bytes.

---

## 7. What I could NOT verify

- **The quiet-hours DEFER branch, end to end in production.** The probe ran at
  2:15pm Eastern, inside the window. Driving the defer path would mean either
  waiting until 9pm or sending a real text. It has 26 unit tests including both
  DST transitions, the container's ICU is verified, and the open branch is proven
  live — but the deferral itself is not production-proven. Re-running the §6
  probe with an SMS row after 21:00 ET would close this in two minutes.
- **That a reminder email or SMS actually arrives.** Nothing on this surface has
  ever delivered a message, and proving delivery means sending to a real handset.
  Every branch I drove refused before the provider call, by design.
- **`process-sequences` end to end.** Deliberately not run — 46 active
  enrollments, thirteen of them people who have since booked and paid.
- **Whether cron-job.org's four jobs use a stale secret or a missing one.** I
  cannot see that account. The 401s are consistent with either.

---

## 8. Needs Adam

Nothing new was added to the list; two existing items change shape.

- **B4 (needs-Adam 18/19) — scheduling the three reminder crons is now safer than
  it was this morning.** Before today, switching them on would have texted
  customers at 6am Eastern and emailed the owner at 3am. That is fixed at the
  enqueue end and guarded again at the send end. **21 upcoming bookings still have
  no reminders** (re-measured; the docs said ~18–20). Still Adam's call, and I did
  not schedule anything.
- **A5 — `booking-locks` and `draft-newsletter` have now 401ed 11 times each** in
  the current ten-day window. Unchanged in substance; the count is fresher.

Two things named but deliberately **not** changed:

- **`send-reminders` writes nothing to `contact_interactions`.** A reminder send
  is recorded only on its own queue row. Defensible — the row is the record — but
  it means the contact timeline will never show a reminder.
- **`marketing_budget` counts the wrong thing.** `checkSmsBudget`/`recordSmsSent`
  have exactly one caller, `birthday-rebooking`, and it charges at **enqueue**
  time. Every other SMS the system sends is uncounted. Those are all
  transactional and arguably out of scope for a *marketing* cap, which is why I
  left it — but the cap does not mean what its name suggests.

**Declined again, and this is the eighth time:** the ~30 unchecked admin writes in
`docs/admin-surface-review.md` §8. Out of scope for this surface, and each fails
in a safe or cosmetic direction. Eight declines is a decision by default; it
belongs on the needs-Adam list as accepted risk or as someone's explicit next
job, not in another review's postscript.

---

## 9. Numbers

- Suite **3048 → 3154** green, 152 suites. 0 app `tsc` errors (259 pre-existing in
  `src/__tests__` only, unchanged).
- `npx next build` clean. `/book` still `○ Static`, 7.15 kB / **52,742 bytes**
  served. `/plan/[ref]/summary` still `ƒ`.
- Attack harness: **40 mutations, 40 caught, 0 NOT_APPLIED**, tree green after
  restore.
- **No migration taken.** Nothing on this surface needed a schema change —
  migration 044 had already done the repair. `starting_plan/` still tops out at
  `migration_049_slack_inbound_source.sql`; **050 is next, and the next link must
  ask the database rather than believe this line.**
