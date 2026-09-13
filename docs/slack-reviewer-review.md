# The Slack reviewer surface — read, attacked, corrected (link 26)

Plan §25. Written 2026-09-13, against `e1627d9`.

**The job:** finish the Slack reviewer channel and cut the booking agent's
review loop over from SMS to Slack, because every reviewer interaction today is
a billed SMS and Slack is free.

**Where it ended:** the code is correct, the tripwire is real, the cost is
measured — and **the cutover itself is still blocked on four values only Adam
can get.** Nothing was flipped. `REVIEWER_CHANNEL` is still `sms`.

---

## 1. What was measured before a line changed

| thing | measured | how |
|---|---|---|
| migration 049's artefacts | **all live** | `pg_constraint` / `pg_indexes`, not the migration file |
| `ingested_messages_source_check` | contains `'slack'` | `pg_get_constraintdef` |
| `idx_inquiry_drafts_slack_ts`, `idx_admin_users_slack_user_id` | both present | `pg_indexes` |
| `admin_users.slack_user_id`, `inquiry_drafts.slack_channel` / `.slack_ts` | all three columns present | `information_schema.columns` |
| `inquiry_drafts` | 24 rows — **16 `sent_for_review`**, 3 `sent`, 5 `cancelled` | direct read |
| `/api/slack/*` in production | both answer **401 `unconfigured`** | as designed; fail-closed |
| `SLACK_*` in `/opt/hosthampton/.env` | **zero** | still true |
| the dispatcher | **healthy** — 0 pending events, `last_handled` 30 s behind `last_created` | `ingested_messages.status` |

That last row mattered more than it looks. The entire Slack design routes a
button press through the dispatcher, so if the dispatcher were one of this
project's several silently-stopped crons, the whole channel would be
dead-on-arrival and every "Sending HH-…" message would be a lie. It is running.

**One premise in the brief did not hold.** It said to measure the SMS cost from
`marketing_ledger` `sms_send` rows. **There is no such action and no such row.**
`marketing_ledger` has exactly four actions — `note` (260), `llm_call` (167),
`transition` (39), `send` (10) — and none of them records a reviewer SMS or a
segment count. The only trace of reviewer SMS cost anywhere is a `console.log`
line in `lib/ownerNotify.ts` reading `[sms-cost] N seg x M recipient(s)`, which
lives in `docker logs` — a window that a container recreate erases, and which
was empty when checked. **The cost this cutover exists to remove is not
recorded in any durable place.** That is a finding, not an aside.

## 2. The measured saving

Measured with the real `reviewerSmsBody`, `reviewerPingBody` and
`smsSegmentInfo` against the 16 genuinely open drafts.

**The instrument was checked first**, because link 19 found the budget charging
1 segment for a 3-segment message. Against GSM-7 boundaries including the
extended characters that cost two units each:

```
  160 chars -> 160 units, 1 segment      161 -> 161 units, 2 segments
  306 chars -> 306 units, 2 segments      307 -> 307 units, 3 segments
   80 '['   -> 160 units, 1 segment        81 '[' -> 162 units, 2 segments
```

All correct. The counter is trustworthy and link 19's bug is not present here.

**Per lead, the five billed messages Adam named:**

| | SMS today | on Slack |
|---|---|---|
| 1. draft notification | 2 seg | **1 seg** (the ping) |
| 2. two-hour nudge | 1 seg | free, in the thread |
| 3. confirmation prompt | 1 seg | free — it is a button |
| 4. reviewer's reply | 1 seg | free |
| 5. our reply to the reply | 1 seg | free |
| **total** | **6 seg** | **1 seg** |

**5 segments saved per lead. At ~16 leads/month, ~80 segments/month.**

**Being straight about the size of that:** at roughly a cent a segment this is
on the order of **$1/month**, and it doubles if Allie's number joins
`REVIEWER_PHONES` (§B7). It is a real saving and it scales with lead volume, but
it is not the reason to do this. The reasons that are worth the work:

- **the loop stops costing per-interaction at all**, so revising a draft four
  times is free rather than four more billed round trips — and every one of the
  24 drafts has at least one revision recorded;
- **16 of 24 drafts were nudged**, which is a segment each that disappears;
- **named reviewers.** The ledger can finally say *which human* approved a
  message to a customer instead of the anonymous `'ADMIN'` (§11.1);
- **it dissolves §B7**: the reviewer loop stops being one handset.

The modelled input is the *summary* line: `inquiry_drafts` has no `summary`
column, so the string a reviewer actually reads is not stored and cannot be
recovered. The `subject` was used in its place. Stated rather than assumed.

## 3. What was WRONG, and is now fixed

### 3.1 A Supabase blip told the reviewer their draft was gone — and ate the press

`handleSlackAction` read the draft with `const { data } = await …` and no
`error`. Three separate rules in one expression:

- **rule 19** — the error was never read;
- **rule 12** — "the draft was deleted" and "I could not ask the database" both
  arrived as `data === null`;
- **rule 10** — so the reviewer was told *"I cannot find that draft any more.
  Nothing was sent."* about a draft still sitting in the queue;
- **rule 3** — and the dispatcher finalises a Slack event whether or not it was
  handled, so **the button press was consumed and never retried.**

This project has documented transient Supabase timeouts. Pressing *Send it*
during one would have quietly lost the approval and reported a deletion.

Now: the error is destructured, a transient failure returns
`outcome: 'lookup_failed', retryable: true` and says nothing to the reviewer,
and the dispatcher re-queues it through `requeueEvent` on the **same
`agent_attempts` counter the drafting path already uses** — not a second one
(rule 11). Out of attempts, it finalises loudly.

### 3.2 Approving a draft erased it from Slack

`settle()` called `settledBlocks({ original: [], … })`. That function keeps
every block that is *not* an `actions` block, so an empty array meant the
message the reviewer had just approved was **replaced by a single line** reading
`Sent to Sarah (email + text) — Adam`. The customer, the date, the guest count
and the drafted email all vanished from the channel at the moment of approval.

Slack is meant to be the record of what went to a customer. Approving cannot be
the thing that deletes it.

Sharpest detail: `slackBlocks.test.ts:185` passes a **real** `original` array
and asserts the actions block is stripped. It proved a capability that the one
production call site did not use. A green test over a path nobody takes.

Now the interaction payload's `message.blocks` are carried through
`ingested_messages.parsed.slack_message_blocks` (bounded at 24 KB, dropped
rather than truncated — half a block array makes `chat.update` fail with
`invalid_blocks`, which the fail-soft client reports as "Slack was down"), and
`settle()` strikes the buttons off and keeps everything else.

### 3.3 The ack said "Sending HH-2026-0042" before anything had been sent

The brief names this exact sentence as the project's signature failure, and it
was in the code:

```
Sending ${code} — I'll confirm in this thread when it's out.
```

At the instant that is produced, the route has written one row. The dispatcher
acts minutes later. In a system with **four demonstrated silent cron/webhook
failures**, that sentence can be the last thing a reviewer ever hears, and it
says a customer was emailed.

Now: `Queued ${code} to send. I'll confirm in this thread when it's actually
done — if nothing appears within a few minutes, it did NOT happen.` Rule 10 in
both directions: claim only what is true now, and **say what silence means**.
Same correction applied to the events route's "Re-drafting…".

### 3.4 Smaller, same family

- `slackThreadFor` collapsed `error` and "no thread yet" into one `null`. The
  return value genuinely cannot distinguish them — the caller's move is the same
  either way — so the failure is now **named in the log** instead of being
  invisible. A lead's thread silently splitting in two is otherwise unexplainable.
- `settle()` discarded `updateMessage`'s boolean. A failed `chat.update` leaves
  a **live Approve button under a draft that has already gone to the customer**.
  Now reported.

### 3.5 The tripwire's own instrument was blind

The inherited `decomment` helper strips `/* … */` **first**, then `// …`. That
corrupts any file whose *line* comment contains an open-block marker — and
`app/api/slack/interactions/route.ts` opens with:

```js
// lib/slack/*, and NOTHING from lib/agent/reviewLoop or lib/agent/sendApproved.
```

The `/*` inside `lib/slack/*` opened a block-comment match that ran to the next
`*/` further down the file and **blanked three `import` statements**. The
module-graph rule — the best rule in the file — was walking a route it believed
imported nothing from `lib/slack/*`, and *"this route cannot reach sendApproved"*
passed because the walker had gone blind.

Fixed to a single left-to-right alternation (leftmost match wins, so the line
comment consumes its own `/*`). **The same two-pass helper was in six other
surface tripwires** — `adminSurface`, `cronSurface`, `inboundSurface`,
`planMoneySurface`, `portalWriteSurface`, `publicIntakeSurface`. All six were
corrected; all six still pass. Only three files under `src/` trip the bug and
all three are on this surface — but one of them is `agent-dispatch/route.ts`,
which `cronSurface.test.ts` reads.

## 4. What HELD

Worth as much as the fixes, and now pinned so it cannot drift:

- **The signature scheme is character-for-character Slack's own**, checked
  against `docs.slack.dev` rather than against our own harness: headers
  `x-slack-signature` / `x-slack-request-timestamp`, base string
  `v0:{timestamp}:{rawBody}`, HMAC-SHA256, hex, `v0=` prefix, and a 300-second
  window checked with `Math.abs` in **both** directions — Slack's own example
  uses `abs()`. This is the exact opposite of link 24's finding, where
  `/api/webhooks/quo` implemented Standard Webhooks while Quo signed something
  else and refused every real message for 2.5 days.
- **Fail-closed is real and complete.** An unset `SLACK_SIGNING_SECRET` returns
  `'unconfigured'`, both routes treat anything but `'ok'` as a 401, and the
  `url_verification` handshake gets **no exemption** — which is precisely why
  the ordering constraint in §0 exists.
- **Slack's HTTP-200 failures are handled.** `lib/slack/client.ts` reads `ok`
  out of the *body* at every Web API call site and logs the `error` string by
  name. `not_in_channel` is a one-line fix; an unnamed failure is an afternoon.
- **The fallback is unconditional and was already right.** Every branch of
  `notifyReviewers` reaches `notifyOwnerSms`. Slack having a bad afternoon costs
  the formatting, never the lead. *(This was the brief's open question 4 — the
  answer was already built: fall back to SMS, loudly, on every failure path.)*
- **The routes cannot reach `sendApproved.ts`** and the dispatcher can. Both
  directions asserted, and the walker is now actually able to see.
- **The empty allowlist authorises nobody**, and a Slack id can only ever *name*
  an admin, never create one. No seventh gated edge was added; the gate table is
  untouched and asserted.

## 5. The tripwire, and attacking it

`src/__tests__/lib/slackSurface.test.ts` — **17 rule groups, 86 assertions**,
up from 4 groups. House shape: comments stripped before any rule runs, bodies
sliced to the next declaration rather than by a fixed width, CRLF tolerated,
every rule stating how many sites it examined, no skipped test.

`services/website/scripts/attack-slack-tripwire.js` (untracked) applies **82
mutations**. It refuses to run unless two controls pass first — the tripwire is
green on a clean tree *and* fails on a deliberately obvious break — because a
previous link's harness had a detector that could not run and reported 34/34
caught while testing nothing.

| round | applied | caught | escaped |
|---|---|---|---|
| first | 67/82 | 58 | **10 holes** |
| final | **82/82** | **82** | **0** |

The 15 that did not apply first time were mostly `\n` patterns that match
nothing in a CRLF repo — link 23's exact trap, caught because the harness
reports a non-applying mutation as NOT-APPLIED rather than as a pass.

**Seven real holes in my own rules**, each now closed:

1. `toMatch(/json\.error/)` passed while one of two call sites had stopped
   naming the error — the other still matched. Counted now.
2. `if (lookupError)` survived a mutation that restored the discarded error and
   added `const lookupError = null`. The guard was intact and guarding a
   constant. The **destructure itself** is asserted now.
3. One `settle(…, actor.label)` matched while another site had been changed to
   the literal `"someone"` — the anonymous-`ADMIN` problem reappearing in the
   channel instead of the ledger.
4. The block-size limiter existed and was asserted; **nothing checked it was
   called.** A mutation stored the raw payload with the limiter unused two lines
   away.
5. One `warnings.push(` matched while the Slack-post failure specifically had
   stopped being recorded — the one that decides which link the SMS carries.
6. `SECTION_TEXT_MAX` was asserted by **name**, so a mutation raised it to
   100000: still present, still named, no longer a cap.
7. `MAX_DRAFT_ATTEMPTS` and `attemptsOf` both still appear **in the error string
   that reads "(attempt 2/3)"**, so a name-presence rule passed over an
   `if (true)` — an unbounded retry loop described by a message claiming it was
   bounded. Rule 10 applied to a log line, found by the harness.

Also: my own R16 listed `xit(` and `.todo(` as string literals, which made this
file its own offender under `publicIntakeSurface`'s R10 walker. Every token is
built by concatenation now. Same wrong-occurrence family as the CI gate that
failed every build for a day.

## 6. Verification

- `npx jest` → **3117/3117 green** (3048 before; +69).
- `npx tsc --noEmit` → **0 errors in app code**.
- `npx next build` → `✓ Compiled successfully`. `/book` is still **○ Static,
  7.15 kB**; `/plan/[ref]/summary` is still **ƒ**; both `/api/slack/*` are **ƒ**.

## 7. What I could NOT verify

Honestly, and it is the important section:

- **Nothing has ever talked to real Slack.** No app exists. Every claim about
  `chat.postMessage`, `chat.getPermalink`, `views.open`, the Block Kit
  rendering, the modal, the thread reply and the signature over a *real* Slack
  delivery is verified against Slack's documentation and our own tests — **not
  against a request Slack actually sent.** Link 24's whole lesson is that those
  are different things. The signature scheme matches the published spec exactly;
  that is the strongest statement available until a real delivery arrives.
- **The end-to-end drive did not happen** — handshake, real post, button press,
  thread reply, a throwaway draft reaching `approved` through the dispatcher.
  All of it is blocked on the four values.
- **`admin_users.slack_user_id` is NULL for every row**, so the first approvals
  will record `SLACK:U…` rather than a name. Deliberate, and better than
  `'ADMIN'`, but it is not the finished state.
- **No probe rows were written to `marketing_ledger`** — it is append-only and
  nothing needed to be written to reach these conclusions.

## 8. What needs Adam

**The four values (needs-Adam A1, still open).** Signing Secret, `xoxb-…` bot
token, `#hh-leads` channel ID (`C…`), his member ID (`U…`).

**And the ordering, which will look like our bug if it goes wrong:** the
manifest **no longer contains the events URL at all**, so the wrong order is now
impossible rather than merely documented. Create the app, install it, make the
channel, invite the bot, send the four values. A session puts the secret on the
box, deploys it, and confirms it is live in the container by SHA-256 fingerprint
(never by printing it). **Only then** is Event Subscriptions enabled by hand.

**The flip itself is Adam's call.** `REVIEWER_CHANNEL=slack` changes where a
real human is told about a real customer, and it only happens after the
end-to-end drive passes, with his explicit go-ahead.

**New, and it belongs with the standing systemic risk (needs-Adam E, item 48):**
the reviewer SMS cost — the thing this whole phase exists to reduce — **is
recorded nowhere durable.** After the cutover there will be no before-and-after
to point at, because there was never a "before" in any table. That is a small
instance of the same gap as the cron nobody watched for a month.

## 9. Files

| file | what |
|---|---|
| `src/lib/agent/slackLoop.ts` | three-outcome lookup, retryable, settle keeps the draft and reads its error |
| `src/app/api/cron/agent-dispatch/route.ts` | honours `retryable` via `requeueEvent`, bounded |
| `src/app/api/slack/interactions/route.ts` | carries `message.blocks` (bounded), honest ack |
| `src/app/api/slack/events/route.ts` | honest "queued a re-draft" |
| `src/lib/agent/notifyReviewers.ts` | thread lookup names its failure |
| `src/__tests__/lib/slackSurface.test.ts` | 4 rule groups → 17, 86 assertions, comment-stripped |
| six other `*Surface.test.ts` | the `decomment` fix |
| `docker-compose.yml`, `AGENTS.md` §7 | the five env vars, with their fail-closed semantics |
| `docs/slack-app-manifest.yml` | events URL removed — the trap is now structural |
| `docs/slack-app-setup.md` | corrected: migration **049** not 048, handlers are built, real sequence |
