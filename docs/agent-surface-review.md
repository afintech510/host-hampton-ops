# The booking agent as one surface — the dispatcher, the classifier, the draft writer, the review loop

**Link 22 of the autonomous build chain. 2026-09-13.**
Scope: `src/lib/agent/**` (19 modules, 7,019 lines) plus `/api/cron/agent-dispatch`,
`/api/cron/agent-distill`, `/api/cron/gmail-sync`, `/api/admin/agent`, `/api/webhooks/quo`
and `/review/[token]` — the only live, running, model-driven, customer-facing path in this
business, and the only subsystem that generates customer-facing text.

Links 3, 4 and plan §24 attacked the **prompt-injection layers**, and §24 found the live
voice profile feeding mobile prices into the trusted half of a prompt that says "ABSOLUTELY
NO PRICING". Nobody had attacked the dispatcher, the classifier, the draft writer and the
review loop **as one surface**, and nobody had audited what the agent **writes**.

---

## 1. What was measured first

Nothing below was reasoned from source. Every finding was reproduced against live
production before a line changed, and driven again after.

**The surface, walked rather than listed.** The brief named 19 modules and `lib/agent/`
holds exactly 19 — the second brief in a row whose list survived the directory. But the
walk found five writers the brief did not name: `/api/cron/gmail-sync`, `/api/admin/lead/[ref]`,
`/api/admin/plan/[ref]/send`, `/api/admin/learnings`, `/api/admin/memory` and
`/api/admin/marketing/fb-reply` all touch `ingested_messages`, `agent_learnings` or
`voice_profile`. The walker is now `agentSurface` R0 and holds the module list exact in
both directions.

**The agent is running, and it moved while I worked.** `ingested_messages` went
**456 → 461 → 466 → 468** across the session; `inquiry_drafts` **22 → 23**; `bookings`
**61 → 62**. Every number in a handover is a snapshot.

**Database facts, read from the catalogue (rule 13), never from a comment:**

| | |
|---|---|
| `inquiry_drafts` | 23 rows — **15 `sent_for_review`**, 5 `cancelled`, 3 `sent`. One carries a guardrail `error` |
| `ingested_messages` | 468 rows; **zero** in `new`, `claimed` or `error` — the dispatcher has drained everything |
| classification split | 218 NULL, 119 `auto_ignored`, 91 `marketing`, 13 `lead`, 10 `spam`, 4 `customer_reply`, 2 `booking_admin`, 2 `reviewer_approve` |
| `agent_learnings` | 3 rows, **all `is_active = false`** — the fence holds |
| `voice_profile` | v1 active, v2 inactive; **v1's raw JSON still carries 8 dollar figures** |
| `marketing_ledger` | 296 `inquiry_draft` rows; **137 `llm_call` at $0.519, every one non-zero** |
| LLM spend by actor | `AGENT` 137 / $0.519, `agent:distill` 1 / $0.0248, **`ADMIN` 3 / $0.0205** |
| models in use | `claude-sonnet-5` and `claude-haiku-4-5-20251001` — both in `MODEL_PRICING`, so the cost ledger is accurate |
| guest counts | 8 bookings with NULL, **zero with 0**, max 65; **5 bookings carry `guest_multiplied` line items and all five have a real count** |
| `party_date` | 3 NULL; `party_time` 8 NULL, and one holds the literal string `'Evening'` |

**And the draft corpus, which sized every screen below.** All 23 drafts were read out of
Postgres and scanned: **not one contains a phone number, a URL or an `@handle`.** That
measurement is the whole reason the new detectors could be made strict — it puts the
false-positive risk of the phone-number and payment-processor rules at **0 of 23**, measured
rather than argued.

**Rule 17, asked properly, and it answers in the harmless direction twice:** only ONE
draft has ever been parked by a guardrail (`HH-2026-4295`, §24's pricing park), and it was
subsequently cancelled. So the parked-approval hole below has never been walked. The
cancelled-plan hole **has** — three times, and two of those are real customers.

---

## 2. The headline: the payment-redirect guard let eight spellings through

`containsForeignContact` is the deterministic backstop for the whole injection defence.
Its own header says so, at length:

> the question that actually matters is what an injection could DO if it worked, and the
> worst answer by a distance is: **get a payment redirected**

It allowlisted hosts:

```js
const OUR_HOSTS = /(?:^|\.)(?:hosthampton\.com|venmo\.com|stripe\.com)$/i
```

That is matched against the **host only**. Ten hostile payloads were run through the live
implementation. **Eight passed**, and the same eight also passed `screenLearningText` — the
screen standing between a distilled learning and the *trusted* half of every future draft
prompt — and `sanitizeVoiceProfile`:

```
PASSED  | Pay the deposit here: https://buy.stripe.com/4gwcNa1Bt0Xv9kk28e
PASSED  | Send the $250 to https://venmo.com/u/not-allie
PASSED  | Venmo: https://www.venmo.com/u/attacker-handle
PASSED  | Checkout link: https://checkout.stripe.com/c/pay/cs_live_abc123
PASSED  | Zelle the deposit to 917-555-0134 to hold your date.
PASSED  | Text our billing line at (917) 555-0134 to pay the deposit.
PASSED  | Cash App us at $NotAllie for the deposit.
PASSED  | Venmo @ab
CAUGHT  | Venmo the deposit to @not-allie-at-all
CAUGHT  | Pay at https://evil.example.com/pay
```

The first line is the worst thing on this surface. `https://buy.stripe.com/<anything>` is a
**live, real, chargeable Stripe payment page**, and anyone can own one in ten minutes. A
payment processor's domain is not evidence that the money comes to us — it is evidence of
the *opposite*, because the entire point of a hosted payment page is that anybody can have
one. **The host tells you who takes the card, never who gets paid.** And `Send the $250 to
https://venmo.com/u/not-allie` passes `containsFabricatedTerms` too, because `$250` is the
one figure a draft is allowed to state: the sentence is a complete, plausible,
fully-guardrail-approved instruction to pay a stranger.

Three more axes were missing entirely rather than mis-scoped:

- **A bare phone number.** **Zelle is keyed by phone number.** "Zelle the deposit to
  917-555-0134" is the same attack as an `@handle` redirect with none of the detection, and
  "text our billing line at …" is the same thing wearing a different hat — it moves the
  conversation to a stranger, which is how the rest of the fraud happens.
- **A Cash App `$cashtag`.**
- **A two-character handle.** The floor was `[A-Za-z0-9_][A-Za-z0-9_.-]{2,31}`, i.e. a
  minimum of three characters, and both Venmo and Instagram allow two.

### The fix

- `hosthampton.com` (and subdomains) is ours unconditionally — we own every path on it.
- **Venmo is ours only at a path naming our handle** (`isOurVenmoUrl`), and the handle comes
  from `lib/paymentContacts.ts`, which already owns "where a customer sends money". This
  module had its own read of `process.env.VENMO_HANDLE` with its own normalisation — rule
  11, our handle spelled twice is a handle nothing is checking.
- **Stripe is never ours in a draft.** This agent does not mint pay links; Adam attaches the
  priced quote himself. So a Stripe URL in generated text is a hallucination or an
  injection, and the guard PARKS rather than blocks — the trade its own comment names
  ("a false positive costs Adam one edit, a false negative costs a customer their deposit").
- A **phone-number detector**, with our four real numbers allowlisted from
  `PUBLIC_PHONE_DISPLAY`, `zellePhone()`, `QUO_PHONE_NUMBER` and `REVIEWER_PHONES`.
- A cashtag detector (`$` + a **letter**, so `$250` stays the money guardrail's business).
- The handle floor lowered to two characters.

**Verified in both directions** (`agentGuardBehaviour.test.ts`): 14 hostile payloads all
refused; 9 legitimate draft sentences all allowed, including `Give us a call on (631)
998-9325`, `Reply to this text on 6319989325`, `Venmo the $250 deposit to @HostHampton, or
Zelle it to 631-599-2469`, `https://hosthampton.com/s/8Kq2mXp7` and
`https://venmo.com/u/HostHampton`.

---

## 3. `summaryForReviewer` was screened by nothing

The three output guardrails ran on `emailDraft`, `smsDraft` and `emailSubject`. They did not
run on `summaryForReviewer` — **in either of the two places the guardrail block was
written**.

That is the one line a reviewer actually reads. It is the entire body of the one-segment SMS
ping (§25.5), the Slack message's fallback text, and the sentence beside the Approve button.
It is model output over a stranger's email, by the same writer, in the same response, as the
two drafts beside it. A field is hostile because of who can WRITE it, not which block it
prints in — and this one is aimed at exactly the human whose approval is the load-bearing
fence.

The block also existed **twice in one file** (the first-draft path and the revision path),
differing only in the words "draft" and "revision" — and the two had already drifted in the
way that mattered, because neither had the summary. It is now one
`screenGeneratedDraft(draft, label)` in `draftGuards.ts`, covering all four strings and
naming WHERE the hit was, so a reason reads `the draft's reviewer summary contains a link to
buy.stripe.com/…` rather than just "the draft".

The money check deliberately stayed out of it: the first-draft path gets one corrective
retry and the revision path does not, so "did this name a price" has genuinely different
consequences for the two callers and folding it in would hide that.

---

## 4. Plan §4.6's cancelled-plan stand-down was never implemented

`docs/booking-agent-plan.md` §4.6 has said since the first version of the document:

> **Stand-down rules.** If a human already replied on the thread (`direction='out'` after
> the inbound), **or the plan is `cancelled`, no draft.**

The first half is implemented, in `triage.humanAlreadyReplied()`. **The second half is
implemented nowhere.** `PLAN_COLUMNS` did not even `SELECT status`, and no module on the
surface reads `bookings.status` at all — every `cancelled` in `lib/agent/` refers to the
DRAFT's own status.

Production holds **three open `sent_for_review` drafts whose plan is cancelled**, and two of
them are real customers whose parties were called off:

| draft | plan | party date |
|---|---|---|
| `HH-2026-4344` | `HH-PTY-AH4AW` — **cancelled** | 2026-10-17 |
| `HH-2026-4273` | `HH-PTY-N6L8Q` — **cancelled** | 2026-10-17 |
| `HH-2026-3504` | `HH-TEST-PAY3` — cancelled (link 2's throwaway) | — |

Both real ones are also two of the four cancelled bookings holding **$1,490 of
`balance_due_cents` each** that link 21 found (needs-Adam 45). Approving either texts and
emails a real person a reply about a party that is not happening, and there is no undo.

**And the admin Inbox already knew.** `/api/admin/agent`'s GET carries this comment, written
by whoever built it:

> An OPEN draft whose plan has been cancelled is a **live hazard, not a curiosity**:
> approving it sends a customer a quote for a party that was called off. Production had two
> of these the day this was written.

It surfaces `booking_status` for the UI and **refuses nothing**. The hazard was displayed to
a human and left executable by the same request. Rule 8's newest form: not a comment that
lies, but a comment that is *entirely right* beside code that does not act on it.

Now refused at four places: the draft node (before the model call, on a row it has to read
anyway), `applyExtractedFields` (the WRITE half, reachable independently), the SMS review
loop, and the admin Inbox. `edit`, `dismiss` and `revise` stay allowed — dropping such a
draft or tidying it is exactly what somebody should be able to do. "Is this party still
happening" has **one** implementation, `planStatusOf`, because three surfaces need it.

**Measured in live production, before and after**, with `{action:'test'}` — the right probe,
because `test` delivers to the OWNER's own handles and writes nothing, so it exercises the
identical gate with the recipient swapped for us:

```
BEFORE  POST /api/admin/agent {action:test} on HH-2026-4344 (plan CANCELLED)
     -> 200  {"ok":true,…,"emailSent":true,"smsSent":true,"recipient":{…}}

AFTER   -> 409  {"error":"This draft is for a cancelled party (HH-PTY-AH4AW).
                 Dismiss the draft, or re-open the plan first.",
                 "planStatus":"cancelled","bookingRef":"HH-PTY-AH4AW"}
```

---

## 5. A parked draft is the one a human must read, and it was the one nobody had to

`parkedSmsBody` deliberately does **not** end with "Reply SEND", and its comment explains
why at length: a parked draft is precisely the one a reviewer should not approve by reflex
from a phone, because the whole reason it was parked is that a human needs to read WHY.

Approving one was nevertheless **completely unguarded**. `resolveDraft` did not select the
`error` column, `OPEN_STATUSES` includes `drafted`, and `handleReviewerReply`'s approve
branch asked for a confirmation only when the code was out of context. `SEND HH-2026-4295`
on a draft held for `foreign_contact_in_draft` moved it to `approved`, called
`sendApprovedDraft`, and delivered it — without the held-back reason being mentioned once.
`sendApprovedDraft` re-screens nothing by design ("the text that goes out is byte-for-byte
the text a human approved").

**And the hold could be cleared by an edit that edited nothing.** `/api/admin/agent`'s
`edit` action set `error: null` unconditionally, with `emailDraft = body.emailDraft ??
draft.email_draft`. So `{action:'edit', id}` with no fields at all — or with only a new
`subject` — cleared the guardrail hold, moved the draft to `sent_for_review`, gave it a fresh
nudge clock, and never touched the flagged bytes. Rule 10 in miniature: the guardrail stopped
saying it had stopped anything, over a change that changed nothing.

Three fixes:

1. The approve path asks for **one confirmation when the draft carries an `error`**, naming
   the reason (`HH-2026-4295 was HELD BACK: foreign_contact_in_draft: …`) and the recipient,
   and recording `because: 'parked'` in the ledger so a guardrail override is
   distinguishable from a typo guard.
2. `edit` clears the hold **only when the email or SMS text actually changed**, and the
   check precedes the clear.
3. **`sendApprovedDraft` re-screens the exact bytes it is about to deliver** — the
   money-redirect axis only. This is the last point at which refusing is free, and the
   argument for doing it again is rule 8 rather than against it: between the draft node's
   screen and here the text has been through an admin `edit` (free text, no screen), a
   re-draft, and a human skimming SMS on a phone — *and the screen itself was broken*, so
   drafts that passed it are in the queue right now. Only the foreign-contact axis: an admin
   who has edited the text is allowed the last word on its wording, and nobody is allowed
   the last word on where the money goes.

**Driven end to end in live production, both directions**, on two throwaway approved drafts
whose recipient is the designated test pair:

```
HH-PROBE-22A  clean text
  POST {action:send} -> 200  emailSent:true smsSent:true errors:[]   status=sent
HH-PROBE-22B  carrying https://buy.stripe.com/4gwcNa1Bt0Xv9kk28e
  POST {action:send} -> 502  emailSent:false smsSent:false  status stays approved
      "refusing to send: this draft contains a link to buy.stripe.com/4gwcNa1Bt0Xv9kk28e
       that is not ours. Edit it in Admin → Inbox to remove it."
  marketing_ledger: note / send_refused / {"reason":"link to buy.stripe.com/…"}
```

The first line is the expensive direction and it is the one that mattered most to check: a
change that stops the agent answering real customers is an outage nobody would notice for
days.

---

## 6. Eight more findings

1. **A date the model resolved into the PAST was written to a real booking.**
   `coerceIsoDate` asks whether a date *exists*, not whether it could be a party, and
   2025-10-14 is a perfectly good Tuesday. The model is asked to resolve "this Saturday" and
   "the 14th" against today, and a relative-date resolver's failure mode is the wrong month
   or the wrong year. Rule 15 exactly: a guessed date **stops the agent asking** — and it is
   worse than that here, because `party_date` arriving is what computes
   `modification_cutoff` and `guest_count_cutoff`, so a past date locks a live booking's
   modification windows the moment it lands and the customer is told their date is fixed for
   a day that has already been. Now refused as a field and **kept as
   `party_tags.requested_date_text`**, so the evidence survives the refusal and the next
   draft can quote it back.

2. **The guest count was a fourth hand-rolled bound.** `Number.isInteger(n) && n > 0 && n <=
   200`, beside `screenPublicGuestCount` and two others. Link 21 established that
   `guest_count_approx` is the **multiplier** in `loadPlanInvoice`'s per-head arithmetic, so
   it is a money input whichever door it comes through — and this door is a *model* reading a
   stranger's prose. It now goes through the shared screen with the agent's tighter ceiling
   stated as a tightening. Rule 17's harmless direction: **zero** bookings currently have a
   blank guest count *and* per-head line items, so this path is not loaded today.

3. **The fill-blanks compare-and-swap had a hole for one column.** `blank()` for the guest
   count is `!(Number(x) > 0)`, so a literal `0` counts as fillable — and `.is(col, null)`
   does not match a `0`, so that one column was written **unconditionally**, losing the
   compare-and-swap the whole function rests on. `.eq(col, 0)` restores it. (No row holds 0
   today.)

4. **A failed read silently disabled the wrong-customer guard.** `mostRecentlyTexted`
   returned `string | null` and the caller computed `outOfContext: !!top && top !== draft.id`
   — so a Supabase blip produced `null`, produced `false`, and **skipped the confirmation
   prompt**: the one guard between a reviewer's typo ('0913' for '0313') and a real quote
   reaching the wrong real customer. Three outcomes now, and `unavailable` means **confirm**.
   Asking once when we did not need to costs one text.

5. **`resolveDraft` reported a read failure as "no such code".** "I can't find a draft
   matching HH-2026-0042" over a Supabase timeout is a confident false statement about a row
   that is sitting right there, made to the one person who could act on it. Rules 10 and 12.

6. **The ambiguity message reported its own LIMIT as a count.** `.limit(10)` then "There are
   ${drafts.length} open drafts" — production has **fifteen**. A number in a message to a
   human is read as a fact. It reads one more than it shows and says "more than 10" when
   there are.

7. **The daily LLM cap counted one actor of four, and failed open.** `spentTodayUsd`
   filtered `actor = 'AGENT'`, but the agent's nodes bill under `agent:distill`, `'ADMIN'` /
   `admin:<email>` and `REVIEWER:+1…` as well. Production holds **$0.045 of agent spend the
   cap could not see** ($0.0248 in one distiller call, $0.0205 across three Inbox drafts) —
   0.9% of a $5 daily ceiling, invisible. And `if (error || !data) return 0` means a failed
   read says "nothing spent today", i.e. the ceiling is off. It now counts by ENTITY
   (`inquiry_draft` + `agent_learning`, excluding the marketing and social nodes which have
   their own budget) and **stands the run down with a 503** rather than guessing. The
   MONTHLY breaker in `lib/marketing/budget.ts` throws rather than guessing and was never
   unbounded, which is why this was a soft failure rather than a live one.

8. **`QUO_WEBHOOK_SECRET` unset meant verification SKIPPED.** That reading was honest in
   Phase 2, when this route only logged an opt-out. It became a latent hole the moment an
   inbound SMS could approve a draft and send a real customer an email and a text: a lost
   `.env` line, or a rotation landing out of order, turns this into an unauthenticated
   endpoint that anyone who knows the URL can use to impersonate a reviewer phone, and
   nothing would look wrong. Closed in production on the `portalSigningSecret()` pattern (the
   build is not a request). The secret **is** set today — this is about the day it is not.

Plus the one genuinely uncaptured write on the whole surface (`sendApproved`'s `send_error`
+ message-id stamp, rule 19), the dispatcher's three near-duplicate inline re-queues folded
into one helper that reads its error *and* checks it matched a row, and the
`contact_id`-linking write whose loss would leave a draft anchored to a contact the event
cannot be traced to.

---

## 7. The tripwire, and the four holes my own attack found in it

`src/__tests__/lib/agentSurface.test.ts` — **40 rules in eleven groups**, reading the
surface off disk. House shape: comments stripped before any rule runs (this file's header
names every defect it tests for), bodies sliced to the next declaration rather than by a
fixed width, CRLF tolerated everywhere, R0 counting what it examined and holding the module
list exact in both directions. No `.skip` rule — `publicIntakeSurface` R10 already walks
every `*Surface.test.ts` and this file matches that glob (rule 11: the concept has an owner,
and mutation 49 proves the inheritance works).

`scripts/attack-agent-tripwire.js` reintroduces **49 defects**, one per thing the tripwire
exists to catch. It refuses to run on a red tree, verifies each mutation landed and reports
`NOT_APPLIED` rather than counting it as caught, and restores on every path including SIGINT.

**First honest run: 44 caught, FOUR THROUGH, one not applied.** All four holes were the same
family — link 21's, verbatim: *the rule matched, but not the occurrence that mattered.*

1. **R2's send-path rule asserted the call was PRESENT, not that its result was USED.** The
   harness kept `containsForeignContact(draft.email_draft …)` and assigned it to an unused
   variable: the screen was still spelled and no longer did anything. **A guardrail is its
   refusal, not its detector.** Now anchored on the assignment, the `if (redirect) {` branch,
   the early return and the ledger row.
2. **R6's `mostRecentlyTexted` rule matched the TYPE ANNOTATION.** The function's return type
   spells `{ ok: false; error: string }`, so `toMatch(/ok:\s*false/)` was satisfied while the
   harness had replaced the entire error branch with `return { ok: true, id: null }`. **The
   signature is not the behaviour.**
3. **R6's `resolveDraft` rule matched one of two occurrences plus the type.** The function
   has two reads; removing one left the other and the `Resolution` union to satisfy the rule.
   Now it *counts* the guarded returns and requires two.
4. **R7's rule matched the wrong `return null`.** `toMatch(/return null/)` over the function
   found `if (!data) return null` two lines below the branch the harness had gutted.

And then, for the record: **my first fix for #4 reproduced the same bug.** I changed it to
`if \(error\) \{[\s\S]{0,200}return null` — a window bolted onto the same defect, and 200
characters still reaches the next branch's `return null`. It went through a second time. The
form that works is a construct, not a window: the first `return null` after `if (error) {`
must come before any subsequent `if (` (`(?:(?!\bif\s*\()[\s\S])*?`). That is rule 8 applied
to my own fix for a rule-8 problem, which is exactly how link 21 described its own three.

**And R9 was wrong in both directions on the first run**, which is the one I would have
missed without counting. It walked back to the nearest statement boundary treating `\n` as
one — but *every* supabase call in this codebase is a chain spanning several lines, so the
statement head was pure indentation: the capture test matched nothing (a captured write read
as bare) and the `.from(` proximity test failed (most writes were skipped). It examined
**7 of 23** writes and found its one real offender by luck. Counting what it examined is
what surfaced that; `expect(examined).toBeGreaterThanOrEqual(20)` is now in the rule.

**Second run: 49 of 49 caught, 0 through, 0 not applied.**

Beside it, `agentGuardBehaviour.test.ts` (**45 tests**) *exercises* the screens rather than
reading them — link 17's harness had a detector that could not run at all, so all 34 of its
mutations reported "caught". Both files are needed and neither substitutes: a source-reading
rule cannot tell you whether a regex matches the payload it was written for, and a
behavioural test cannot tell you the screen is still wired into the route.

**One existing test broke, and it broke for the textbook reason.**
`agentReviewLoop.test.ts` mocked `@/lib/agent/draftInquiry` as a bare object returning only
`redraftForReviewer`; the day `reviewLoop` started importing `planStatusOf` from the same
module, nine tests died with "is not a function". Hard-won rule 7, second occurrence in this
chain. Fixed with `...jest.requireActual(...)`.

---

## 8. Every production probe

Run **inside the container** on its own address (`http://172.18.0.3:3002`, from
`os.networkInterfaces()`) — Cloudflare 403s a probe through `www.hosthampton.com` with a
non-JSON body, which reads exactly like a broken app (link 21).

| # | probe | before | after |
|---|---|---|---|
| 1 | `POST /api/admin/agent {action:test}` on a draft whose plan is CANCELLED | **200**, email AND SMS delivered | **409**, nothing delivered, booking ref named |
| 2 | `POST {action:send}`, clean throwaway draft | — | **200**, `status=sent`, emailed + texted, `errors: []` |
| 3 | `POST {action:send}`, throwaway draft carrying `buy.stripe.com/…` | — | **502**, nothing sent, `status` stays `approved`, reason in the response AND in `marketing_ledger` as `send_refused` |
| 4 | `POST /api/webhooks/quo`, no signature headers | 401 | 401 |
| 5 | `POST /api/webhooks/quo`, wrong signature | 401 | 401 |
| 6 | rows the forged webhook created | **0** | **0** |
| 7 | `GET /review/<forged token>` ×3, incl. a VALID code with a wrong token | 404 / 404 / 404 | 404 / 404 / 404 |
| 8 | `GET /api/cron/agent-dispatch` with / without / with a wrong secret | — | **200** / 401 / 401 |
| 9 | today's spend, old count vs new | identical today; **$0.045 divergence over the month** | counts all four actors |
| 10 | active voice profile v1's raw JSON | 8 dollar figures present | 8 still present — **and the read-time screen drops the strings carrying them on every live draft**, recorded in 6 recent ledger rows |

Probe 10 is §24's fix verified by exercise rather than assertion, in production: the *row*
still holds `$1,100 / $950 / $990 / $300 / $40 / $35 / $25 / $250`, and every draft's ledger
meta records `exemplars[1]: it states dollar amount $1,100 that is not the $250 deposit`.
The screen fires on every draft and says so.

**Cleanup.** Two throwaway bookings (`HH-PROBE-L22A/B`) and two throwaway drafts
(`HH-PROBE-22A/B`), created by SQL with `invoice_number` left NULL so the sequence is never
touched, deleted in FK order. Every count back to the exact pre-probe baseline —
`bookings 62, inquiry_drafts 23, ingested_messages 468, contacts 1220, contact_interactions
144, booking_modifications 151, booking_line_items 206, booking_payments 18, agent_learnings
3, probe rows left 0`. `invoice_number_seq` still `118 / is_called = t`.
`agent_memory.updated_at` still spans `2026-02-18 … 2026-04-22`. The three real
cancelled-plan drafts untouched.

**Three `marketing_ledger` rows cannot be cleaned up** — the table is append-only by a
migration-021 trigger. They are named here so they are not a mystery later:
`transition`/`send_approved`, `send`/`send_approved` for `HH-PROBE-22A`, and
`note`/`send_refused` for `HH-PROBE-22B`, all at `2026-09-13 12:48`, actor
`admin:adam@benchworksai.com`.

**One real notification went to Adam**, twice: the `{action:test}` before-probe and the
`{action:send}` on `HH-PROBE-22A` each delivered an email to `hosthampton295@gmail.com` /
`adam@easternbuilding.supply` and an SMS to `+16314008080`. Both are the designated test
handles and both were necessary — the second is the only honest way to prove the send loop
still works.

**Post-deploy funnel:** all 13 pages 200. `/book` still `○ Static`, **52,742 bytes measured
twice**. `docker inspect hampton_website` image id equals `docker images hosthampton-website`
id, `RestartCount=0`.

---

## 9. What HELD

Most of this surface was already right, and saying so is a finding.

- **THE fence holds, from both directions.** `agent_learnings.is_active` defaults FALSE,
  `proposeLearning` never sets it, `proposeVoiceProfile` writes `is_active: false`
  explicitly, and all three live rows are inactive. The customer→prompt chain ends at a
  human.
- **Screened on the way in AND on the way out**, in both stores, and §24's read-time screen
  is firing on every live draft in production (probe 10).
- **The send path runs no model call** and imports no Anthropic anything. The text that goes
  out is the text a human approved.
- **The module graph enforces a guardrail, not just discipline.** `/api/webhooks/quo` imports
  `lib/agent/reviewers` and *not* `reviewLoop` or `sendApproved`, so the inbound webhook
  cannot reach the customer send even transitively. Verified, and now a rule.
- **Reviewer identity is by phone number, first and unconditionally** — the check precedes
  `parseReviewerReply` in source order, which is now asserted.
- **Rule 3 is honoured properly by the dispatcher.** A triage FAILURE is re-queued with a
  bounded counter and the last attempt lands as `error` (visible in Admin → Inbox), not
  `ignored`. A 402 budget refusal re-queues without burning an attempt. A 5xx re-queues,
  bounded. Abandoned claims are reaped after 15 minutes. This is the best-implemented
  instance of rule 3 in the codebase.
- **Rule 1 and rule 2 are honoured at all four Claude call sites**: the first TEXT block,
  never `content[0]`; and no `effort` key on the Haiku calls.
- **The cost ledger is accurate.** 137 `llm_call` rows, every one non-zero, and both
  production model ids are in `MODEL_PRICING` — so unlike link 19's SMS budget, nothing here
  is billed at a guessed rate.
- **`/review/[token]` is genuinely read-only**, HMAC-hashed, 7-day TTL, `notFound()` for
  every kind of bad link including an expired one, `robots: noindex`, and it does exactly one
  query before the token validates.
- **The extraction module's four stated rules all hold**: `allowed` is enforced in code after
  the model answers, the output schema has no money field at all, `flattenToOneLine` strips
  bidi and zero-width codepoints as well as line breaks, and `{ok:false}` is distinct from
  "found nothing".
- **`draftGuards`' money detector is well-tuned and I did not touch it.** The date-masking
  list has the Eleonore lesson in it and `To put pricing together for Oct 10 or 11` still
  passes.
- **Zero raw PostgREST filter strings** on the whole surface (link 15/20's family).
- **Rule 19 held almost completely**: 23 writes, and exactly ONE discarded its error.

---

## 10. What I could NOT verify

- **Whether a redirect has ever reached a customer.** Only three drafts have ever been sent,
  all three are in the `draft_feedback` corpus, and none contains a URL, a phone number or a
  handle. So the answer is "no, on the evidence available" — but `ingested_messages` holds
  438 gmail bodies that were never re-read for injection attempts, and I did not audit them.
- **The parked-approval path was not driven in production.** Only one draft has ever been
  parked and it is cancelled; manufacturing a parked draft means driving the draft node,
  which costs a Sonnet call and a real text to Adam. It is covered by the tripwire and unit
  tests only.
- **The Quo webhook's signature path was driven only in the negative.** Producing a VALID
  Standard-Webhooks signature would mean writing an `ingested_messages` row the dispatcher
  then acts on, and the sender I would have to forge is a reviewer phone — i.e. a synthetic
  draft approval. The 401s prove the gate; the positive path is proven by the two real `quo`
  rows in the table.
- **Inbound customer SMS is never triaged.** The dispatcher's `quo` branch marks a
  non-reviewer text `ignored` with "triage lands in Phase 3". That is the documented design
  and only 2 `quo` rows exist, but it means a customer texting the business gets no draft.
  Named rather than changed — it is a scope decision, not a bug.
- **The `resolveRecipient` third source.** It falls back to the inbound event's
  `parsed.email ?? from_address` and `parsed.phone`, taken independently, so in principle an
  email could go to one person and the SMS to another. Only one of 468 events carries a
  `parsed.phone`, and `from_address` is the sender themselves, so it is not currently
  reachable in a harmful way. I did not change it; a next link auditing the Quo/Gmail inbound
  edge should.
- **Whether the new Stripe refusal will ever be a false positive.** It cannot be today —
  nothing in the agent mints a pay link — but if a future phase has the agent attach one,
  this guard will park every such draft and the fix is an allowlist of pay links *we*
  created, keyed on `booking_pay_links.url`.

---

## 11. Needs Adam

Carried forward unchanged: **18, 19, 25, 31–46**, plus the two from
`booking-agent-status`: the `agent-distill` cron job still does not exist, and voice profile
v1 still tells the agent to quote prices in prose the screen cannot detect.

**New:**

- **47. Three open drafts hang off cancelled parties, and two are real customers.**
  `HH-2026-4344` → `HH-PTY-AH4AW` and `HH-2026-4273` → `HH-PTY-N6L8Q` (both parties were
  2026-10-17), plus `HH-2026-3504` → `HH-TEST-PAY3`. Every surface now refuses to approve or
  send them, but they still sit in the review queue looking actionable, and the reviewer
  nudge has already fired on two of them. **Should they be dismissed?** That is a customer
  relationship question — if either cancellation was a mistake, the draft is the thing you
  want. Dismissing three rows takes one minute in Admin → Inbox; I did not touch them
  because a real customer's open correspondence is not mine to close.
- **48. Nothing watches the agent's queue depth or its parked drafts.** `ingested_messages`
  is fully drained today, and the dispatcher's `error` state is visible in Admin → Inbox —
  but only if somebody opens it. The nudge watches `sent_for_review` only, so a draft in
  `error` or `drafted` is watched by nothing, which is §18's failure with a new cause. Same
  shape as needs-Adam's standing "nothing monitors a cron status".
- **49. `REVIEWER_PHONES` is one number, and it is Adam's test number.** Every reviewer
  guardrail on this surface — identity, the confirmation prompt, the TEST send — resolves to
  a single handset. Whether Allie's number joins it is a business decision (plan §7.1 parked
  it deliberately), but it is worth stating that the "verified reviewer" fence is currently
  one phone.

---

## 12. Migrations

**None taken.** Nothing in this work needed a schema change; every constraint it relies on
was read from `pg_constraint` / `pg_indexes` / `information_schema` rather than assumed.

`starting_plan/` holds up to **`migration_049_slack_inbound_source.sql`**, and 049's
artefacts are present in the live database (`idx_inquiry_drafts_slack_ts`,
`idx_admin_users_slack_user_id`, and `'slack'` in `ingested_messages_source_check`), so
**050 is the next free number** — asked of the database and of disk after a `git fetch`,
not believed from link 21's sentence. **The next link should do the same rather than believe
this one.**
