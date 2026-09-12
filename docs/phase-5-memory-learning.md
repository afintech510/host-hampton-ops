# Phase 5 — Memory + Learning

**Link 11 of the build chain. 2026-09-12. Migration 045. Suite 1646 → 1802 green.**

Two halves: the memory update pipeline, and A/B content testing (COPY writes
variants, INTEL tracks performance). The measurement came first and it decided
the shape of both.

This is the **second** learning loop in this system. The first one — the booking
agent's — is `docs/booking-agent-plan.md` §23 (as built) and §24 (attacked). A
reader of one needs to know about the other, and §23 now links here.

---

## 1. The measurement, before anything else

### 1.1 The orchestrator is gone

Phase 5's brief says *"agents write back learnings post-task"*. Those agents do
not exist.

```
/opt/hosthampton/docker-compose.yml  →  services: nginx, website.  That is all.
docker ps                            →  hampton_website, hampton_nginx.
                                        (elm_copy / elm_intel / elm_orchestrator
                                         on the same box are Eastern Landscape —
                                         PLAN.md's branch-per-business model.)
https://app.hosthampton.com/         →  520
```

HAMPTON, COPY, SOC, IMAGE, LIST, OUTBOUND and INTEL have no container and are
not defined in the live compose file. The `redis_data` volume is a leftover.

### 1.2 `agent_memory` is dead data, and it is not harmlessly dead

44 rows. **43 written between 2026-02-18 and 2026-02-21** by
`scripts/seed_agent_memory.js` and never touched since. The 44th,
`analytics.last_report`, was overwritten by INTEL 78 times — daily — and
**stopped on 2026-04-22**. `agent_memory_history` holds 89 rows, 78 of which are
that one key.

**`services/website` references the table zero times.** Every reader and writer
is in `services/hampton`, `copy`, `intel`, `image`, `list`, `outbound`, `soc`.

And the contents are the §24 shape. Run the live screens over all 44 rows:

```
flagged 26 of 44
  services.packages     states dollar amount $125
  services.kids_party_themes  states dollar amount $800
  operations.booking_rules    states dollar amount $200
  campaigns.recurring         states a percentage off ("10% off")
  services.permanent_jewelry  states a discount ("discounts")
  brand.identity              contains a link to facebook.com that is not ours
  crm.segment_owner_founder…  contains a email address alark51@gmail.com
  crm.segment_hamptons_…      contains an upper-case section header ("PRIORITY PULL LOGIC:")
  services.addons             a figure that reads as a price (bare number)
  services.rentals            a figure that reads as a price (bare number)
  …
```

Plan §24's headline defect was a **hand-written store that had never been
screened feeding mobile prices into a prompt that says "ABSOLUTELY NO PRICING"**,
and `HH-2026-4295` is the draft it parked. Giving these 44 rows a prompt reader
would reproduce that at scale.

### 1.3 Nothing in this system has ever recorded a content outcome

The A/B half's starting fact, and it is total:

| table | what it holds |
|---|---|
| `analytics_events` | **0 rows, and zero references anywhere in the repo.** The table designed for content attribution — campaign / content / medium / source / session_id — has never had a writer. |
| `content_library.performance` | 20 rows, `{}` on **all twenty**. |
| `scheduled_campaigns` | 7 rows `sent` to **2,160 recipients**, with `opened = 0`, `clicked = 0`, `bounced = 0`. |
| `contact_interactions` | 142 rows, and only **two** of the CHECK's twenty labels ever written: `form_submission` (109) and `sms_received` (33). Zero `email_sent`, `email_opened`, `email_clicked`. |
| Resend webhook | there is no route for one. |

The Brevo webhook is registered at Brevo for `opened` / `click` / `delivered`
and has produced nothing in our tables.

**So "INTEL tracks performance" had nothing to track.** An A/B programme built on
that would have been picking winners out of noise — which is rule 15 with a
plausible number attached, the worst kind.

---

## 2. The memory half: one loop, not two

Phase 6 already built the live loop: `draft_feedback` → the weekly distiller →
`agent_learnings` → the draft prompt, with `voice_profile` beside it, screened
in, screened out, terminating at a human because `is_active` defaults FALSE.

Building a second store here would be **hard-won rule 11 in its sharpest form —
a concept defined twice is a concept nothing is checking** — and the concept is
"what the agent has learned", whose divergence nobody would notice until a draft
said something wrong.

So Phase 5 **retires** `agent_memory` rather than wiring it in or dropping it.

- **Kept, not dropped.** 44 rows of hand-curated brand knowledge — operating
  policies, target areas, positioning, party themes — that the booking agent
  does not know today, plus 89 rows of provenance.
- **Marked in the database**, by a `COMMENT ON TABLE`, which the next reader
  meets before this document.
- **One door**: `lib/agent/memoryImport.ts` + `/api/admin/memory` + a panel
  section. A human reads a row and writes the rule; it goes through the existing
  `proposeLearning`, so it is screened on the way in, lands `is_active = false`,
  and is screened again on read by `loadActiveLearnings`.

**It deliberately does not derive the rule text from `value`.** The values are
arbitrary jsonb of eleven different shapes; turning one into a one-line standing
instruction automatically would be the pipeline guessing at an input it cannot
interpret, which is the one thing a module whose output becomes a prompt must
never do.

### The migration's own near-miss

The first draft of 045 added `retired_note text` and set it on all 44 rows.
`agent_memory` carries two BEFORE UPDATE triggers, read out of `pg_trigger`
rather than assumed (rule 13):

```
trg_memory_version    → log_memory_change(), inserts into agent_memory_history
                         ONLY when `value` changes. A note-only UPDATE is
                         invisible to it. Fine.
trg_memory_updated_at → handle_updated_at(), fires UNCONDITIONALLY.
```

So that UPDATE would have stamped today's date on `updated_at` for every row —
and `updated_at` is the evidence that 43 of them have not been touched since
February. **A migration that makes dead rows look freshly maintained destroys the
measurement that justifies calling them dead.** It is rule 10's other half: it
would have said something happened that did not. The judgement is a COMMENT,
which triggers nothing. Verified after applying: `min(updated_at) = 2026-02-18`,
`max = 2026-04-22`, `agent_memory_history` still **89**.

---

## 3. The A/B half: the measurement before the generator

The brief said *"pick where a variant can actually be measured before you build a
generator for it"*. The measured answer was **nowhere**, so Phase 5 builds the
outcome record first.

### 3.1 Migration 045

| table | what it is |
|---|---|
| `content_experiments` | one named test. `status` **DEFAULTS to 'draft'**; `active` is a GATED edge in `lib/marketing/graph.ts`. `min_per_arm` and `alpha` are COLUMNS. |
| `content_variants` | the copy. At most one control per experiment (partial unique index). |
| `variant_assignments` | **the claim about a person.** `UNIQUE (experiment_id, contact_id)`. |
| `variant_events` | the outcome. `UNIQUE (assignment_id, event_type)`. |
| `unattributed_signals` | rule 14's final branch. |

Every safety property is schema, not convention. `status` defaulting to `draft`
is the same reasoning as `agent_learnings.is_active` defaulting false and
`social_posts.status` defaulting `draft`: a future writer that forgets fails
SAFE. `min_per_arm` and `alpha` are columns because **the rule that decides "not
enough data" has to be readable by whoever reads the result.**

### 3.2 An assignment is a claim, not a coin flip

If a variant were chosen at send time by `Math.random()`, the same person on
step 2 and step 4 would be in two arms, every outcome would be attributable to
both, and two overlapping ticks would assign twice.

`idx_variant_assignments_once` decides, and **23505 is handled by CODE, never by
message text** — the same shape `email_sequence_sends` needed in migration 043
and `scheduled_reminders` in 044. The arm itself is a SHA-256 of
`(experiment_id, contact_id)`, so it needs no read, is stable under a retry, and
the losing tick of a race computes the *same* arm the winner did.

Keyed on the pair and not on the contact alone, deliberately: otherwise every
experiment would split the population identically and any systematic difference
between those two groups would show up in every test as if it were the copy.

### 3.3 Clicks, and deliberately not opens

`/r/<token>` is the first outcome signal this database has ever had. HMAC on the
existing `PORTAL_LINK_SIGNING_SECRET` (no new env). The destination is **inside
the signed payload**, not taken from a parameter, and is re-screened with
`safeSiteLink` after the signature verifies — because a signature proves we
minted the link, not that the target is still one we want to send people to
(rule 8). An open redirect on `www.hosthampton.com` is a phishing kit wrapped in
our own TLS certificate.

**There is no open tracking and that is a decision, not an omission.** Apple Mail
Privacy Protection pre-fetches every tracking pixel for every recipient on Apple
Mail, so an "open" is registered whether or not a human saw the message. That
number looks like evidence and is not one.

**And a bound on `clicked`, stated rather than solved.** Corporate link scanners
(Outlook SafeLinks and friends) fetch every URL in a message before a human sees
it, so an absolute click RATE measured this way is inflated. That is why the
analysis only ever compares one arm with another and never reports a rate as a
fact about customers: random assignment spreads the scanners evenly, so the
DIFFERENCE survives and the absolute number does not. The unique index caps each
assignment at one click either way. Nothing here pretends to have solved it.

**The link that is never wrapped** is the unsubscribe URL. Wrapping it would make
the RFC 8058 one-click POST a GET redirect (and `/unsubscribe` deliberately never
acts on GET), and would make a person's ability to opt out depend on a
`variant_assignments` row. An opt-out link has to work for years and depend on
nothing. `EXCLUDED_PATHS` is that rule, matched by path SEGMENT so
`/unsubscribe-policy` is not caught by a prefix, and a test pins it.

### 3.4 The analysis refuses rather than rounds

Five outcomes, one of which names a winner:

| outcome | when |
|---|---|
| `winner` | both arms cleared `min_per_arm` **and** the two-proportion test cleared `alpha` |
| `no_difference` | enough data, no significant gap. A real result. |
| `not_enough_data` | names **which** arm, how many it has, how many it needs |
| `unconfigured` | no control, or fewer than two arms. Not the same as learning nothing (rule 10). |
| `unavailable` | a read failed. **Not zero** — a variant whose count could not be read is never reported as losing (rule 12). |

- **One metric, chosen up front.** `metric` is a column. Picking it after seeing
  the data is how a pipeline manufactures significance: three metrics at
  α = 0.05 is an effective false-positive rate near 14%.
- **Bonferroni over the challengers.** Pinned by a pair of tests that run the
  *same* numbers (59/400 vs 40/400, p ≈ 0.041) through a two-arm and a three-arm
  experiment and get `winner` and `no_difference` — a correction that never
  changes a verdict is one nobody would notice removing.
- **A zero pooled variance returns `null`, not a p-value.** Both arms all-hits or
  all-misses is not a tie and not a win.
- **The denominator is `sent`, not `assigned`** — an assignment with no send never
  put the copy in front of anybody.
- **`converted` is attributed inside a window the output ALWAYS states**, and
  recorded once so the number cannot quietly change between two readings. A
  booking before the assignment does not count (the population has already
  enquired), nor does a cancelled one, nor one past the window. An unparseable
  `assigned_at` is DROPPED and named — defaulting it to "now" would make every
  booking count.
- **A winner is a PROPOSAL.** `conclude` writes the verdict and changes no
  `email_sequence_steps` row. A pipeline that promoted its own winner into the
  live step would be the whole chain from "a model wrote this" to "a customer
  received this" with no human in it.

### 3.5 The model writes plain text and we build the HTML

`content-pipeline.md` §2 settled this once: the fix for "the renderer executed
agent-written HTML" was to make the stored content TEXT, not to add a sanitiser —
*"a sanitiser is a list of things you thought of"*. The stakes are higher here,
because a variant body goes into a MAIL body where the same markup reaches an
inbox we cannot audit.

So `bodyHtmlFromText()` escapes every character, and `loadVariants` **does not
even SELECT** `content_variants.body_html` — the value it returns is derived from
the screened text. That was a hole in this session's own first draft: the stored
column was being passed through, so a hand-inserted `<script>` would have gone
into a customer's inbox past a screen that had just approved the plain text
beside it. Exactly the shape link 6 found twice in one file (rule 11).

A placeholder the renderer cannot interpret is refused, not passed through:
`"Hi {{customer_first}},"` in a real inbox is rule 15 on a surface a customer
reads.

---

## 4. Driven against production

Deployed at `23d97e6`; image id on the box matches the built image. A **throwaway
sequence** was used, so no real enrollment can ever be on the step the experiment
targets, and the probe contact carries a **mixed-case** address
(`Adam+P5Probe@EasternBuilding.supply`).

**The scan was read BEFORE anything fired**, including a count of how many real
rows a `?limit=1` run would touch:

```
 enrollment                           | enrolled_at | email                               | sequence
 0f5e0000-…-000000000004              | 2000-01-01  | Adam+P5Probe@EasternBuilding.supply | ZZ Phase 5 probe sequence
 1c3a6207-…                           | 2026-03-10  | BONDIALINY@GMAIL.COM                | Post-Booking Prep
 62bd5124-…                           | 2026-03-10  | jocex354@gmail.com                  | Post-Booking Prep

 real_rows_in_limit_1: 0
```

### The doors

```
/api/cron/experiment-report   no secret → 401   wrong secret → 401
/api/admin/experiments        unauthenticated → 401
/api/admin/memory             unauthenticated → 401
/api/admin/experiments POST transition→active, unauthenticated → 401
activate with 0 usable variants → 422 "has 0 usable variant(s) and needs at least two"
```

### Rule 10 on the idle path

```
{"ok":true,"experiments":0,"message":"no active or paused experiments","conversionWindowDays":14}
```

…and a ledger row, because a run that did nothing must not look like a run that
never fired.

### COPY wrote the variants, and INTEL refused to call it

```
generate → inserted 2 (control A copied from the live step, challenger B), $0.0021, refused: []
activate → 200, draft → active
analysis → "Not enough data to call \"ZZ phase 5 probe test\".
            arm A has 0 send(s) of the 30 needed; arm B has 0 send(s) of the 30 needed."
```

After one real send:

```
experiment-report → {"experiments":1,"applied":false,
  "results":[{"outcome":"not_enough_data",
    "summary":"…arm A has 0 send(s) of the 30 needed; arm B has 1 send(s) of the 30 needed.",
    "unattributed":0}]}
```

**That refusal, with real numbers, on real data, is the point of the phase.**

### The click, seven times, recorded once

```
click 1, click 2, and five concurrent → all 302 → https://www.hosthampton.com/book
variant_events:  clicked = 1
contact_interactions: email_clicked = 1   ← the FIRST ever row of that type
```

### The open redirect, attacked with a GENUINE signature

Four payloads forged and signed with the real secret read from inside the
container — the strongest form of the attack, because the HMAC verifies:

| destination | result |
|---|---|
| `https://evil.example.com/x` | 302 → `https://www.hosthampton.com/` |
| `https://www.hosthampton.com//evil.example.com/x` | 302 → `https://www.hosthampton.com/` |
| `/\evil.example.com/x` | 302 → `https://www.hosthampton.com/` |
| `javascript:alert(1)` | 302 → `https://www.hosthampton.com/` |
| tampered signature | 302 → `https://www.hosthampton.com/` |

Nothing recorded on any of them. A legitimate token still redirected correctly —
both directions, on the same route.

### Rule 14, observed

A genuinely signed token for an assignment that does not exist: the visitor was
still sent to the real page (we minted that link; they should not meet a 404),
and the click landed in `unattributed_signals`:

```
tracked_click | a click on a link we minted, whose variant_assignments row no longer exists
              | assignment 00000000-0000-4000-9000-0000000000ff
```

### Two hostile arms inserted straight into Postgres

Past the route, past the write screen, into an experiment that was **already
active**:

```
rows really in the table: A (control), B, C, D
usable arms after the READ screen: ["A","B"]
DROPPED:
  C — it states dollar amount $500 — this surface may not publish a price
  D — it contains a link to hosthampton-secure.net that is not ours
```

D also carried `<script>alert(1)</script><img src=x onerror=…>` in `body_html`.
That column is not selected at all, so there is no variable holding it.

The experiment stayed `active` with A and B: a hostile insert does not take a
live test down, it is ignored and **reported** in the panel, the API and the log.

---

## 5. The bug my own probe found in my own work

The first real challenger COPY wrote came back as:

> *"We'd love to show you what we've got happening at the studio. Check out the
> calendar and see what speaks to you. Take a look at the calendar."*

No URL. And the send said so:

```
"enrollment …004: variant B sent with NO tracked link
  (skipped: unsubscribe link — never tracked, unsubscribe link — never tracked)"
```

**The control's copy IS the live step**, which keeps its real HTML and its real
anchor, so the control can always register a click and that challenger never
could. The control would have won every time, and the result would have read as a
finding about the words. That is rule 15 with a plausible number attached.

The cause: `htmlToPlainText` correctly throws hrefs away, so the model was shown
a control body with no URL in it and had no way to reproduce one. The prompt
said *"keep any link exactly as it appears"* about a link it had never seen.

Fixed in three places, because one would have been a screen nobody applies:

1. the step's `href`s are extracted, screened with `safeSiteLink`, and passed to
   the prompt as `links_you_must_include`;
2. `generateVariants` **refuses** a challenger that omits one on a `clicked`
   metric, naming which;
3. `loadVariants` drops such an arm on the **read** path, so a hand-inserted row
   is caught too — with the control exempt, because its link lives in
   `email_sequence_steps.body_html` which that function cannot see;
4. and the variants route refuses to set up a click test on a step that carries
   no trackable link at all.

Re-run after the fix: `hasLink: true`, a genuinely different subject
(*"Let's find your perfect date at Host Hampton"*), and no warning on the send.

**It was visible only because the send reported it** (rule 10). A silent version
of this would have produced a confident, wrong standing rule about how Host
Hampton writes to its customers.

### And a second one, in the memory screen

`screenMemory` called `services.addons` and `services.rentals` CLEAN. Both store
prices as bare JSON numbers — `{"weekday_3hr": {"price": 450}}` — and
`containsFabricatedTerms` looks for a `$`. That `450` is also **stale**: the live
weekday studio rate is $475, which is the exact number
`docs/content-pipeline.md` §11 corrected on the Spanish page.

`containsMoney` runs too now; the flagged count went 13 → 26 of 44. Some of the
13 it added are false positives (`brand.visual` holds image dimensions), and that
is the right trade for an advisory: a false positive costs a glance, a miss costs
a stale February price pasted into a standing rule. Stated plainly in the module:
**these warnings are a HELP, not a gate, and "no warnings" is not "safe".**

---

## 6. Tests

`src/__tests__/helpers/fakeExperimentDb.ts` — table specs for the five Phase 5
tables on top of `fakeReminderDb`'s **engine**, imported rather than copied. One
engine change was needed and it is a correctness fix: `created_at` is now
supplied only when the spec declares it, because `variant_assignments` has
`assigned_at` and `variant_events` has `occurred_at`, and injecting a column the
spec does not declare made the store answer 42703 on a row Postgres accepts. A
fake is only useful while it is right in both directions.

| file | what it holds |
|---|---|
| `lib/experimentScreen.test.ts` (21) | every refusal naming its match; U+2028 / TAG block / bidi / lone surrogates built with `String.fromCodePoint`; the backslash and `//host` origin bypasses; `bodyHtmlFromText` escaping; the placeholder list asserted against `render.ts`'s own source in both directions |
| `lib/experimentAssign.test.ts` (19) | arm stability, range, even split, not keyed on contact alone; idempotency; **five concurrent ticks → one row, one arm, one `fresh`**; a stored arm the screen dropped is `unavailable`, never re-armed; 23505 by code; the CHECK refusing `opened` |
| `lib/experimentAnalysis.test.ts` (28) | the five outcomes; a 10% vs 60% gap over ten sends still refused; one short arm is enough to refuse; zero pooled variance ≠ tie; the Bonferroni pair; `sent` as denominator; a null rate never 0%; unattributed events; every conversion-window rule |
| `lib/experimentTrack.test.ts` (18) | mint/verify, forged and cross-secret tokens, four open-redirect forms, `EXCLUDED_PATHS` by segment, the unsubscribe link left alone, no-secret behaviour |
| `lib/experimentLoad.test.ts` (26) | the READ screen against rows inserted straight into the store; `body_html` derived AND not selected; the click-metric link rule both ways; `eq('status','active')` asserted on the QUERY |
| `lib/experimentsSchema.test.ts` (13) | the migration `.sql` parsed off disk and compared with `types.ts`; `status DEFAULT 'draft'` pinned; **no `opened` in either place**; `agent_memory` retired by COMMENT and never by UPDATE; `active` the only GATED edge |
| `lib/memoryImport.test.ts` (19) | the screen verdicts incl. the bare-number miss; preview truncated while the WHOLE value is screened (a padding attack); promote lands inactive; no `is_active:` key anywhere in the module; three lookup outcomes |
| `lib/sequenceVariant.test.ts` (12) | substitution and the `sent` event AFTER the send; a failed send records no impression; the tracked link replaces the body link and NOT the unsubscribe link or the RFC 8058 headers; **with no experiment the mail is byte-identical to before Phase 5** |

`npx jest` → **1802/1802**. `npx tsc --noEmit` → 0 errors in app code.
`npx next build` → compiled successfully, `/book` unchanged at `○ Static`
7.15 kB, `/r/[token]` `ƒ (Dynamic)`.

**One thing `next build` caught that neither jest nor `tsc --noEmit` did:** a
Next App Router route file may export only the handler names, so
`export const EXPERIMENT_ENTITY` in a route was a build-time type error. It lives
in `lib/experiments/types.ts` now, which is where it belonged anyway (rule 11).

---

## 7. What bounds this — the plain statement

Phase 5 adds a variant that gets **SENT**, so it inherits every bound
`docs/reminder-engine-review.md` §9 states for reminders, plus its own:

- **Who.** Only a contact with an `active` `contact_sequence_enrollments` row
  that the sequencer was already going to mail. **Phase 5 creates no recipient
  and sends to nobody the sequencer would not have sent to anyway.** With no
  experiment, the mail is byte-identical to before (asserted by test).
- **What.** Only a `content_variants` row that passed the screen at write time
  and again at read time: no dollar figure at all (not even the $250 deposit), no
  concession, no foreign link or handle, no markup, no unknown placeholder, no
  invisible structure. The HTML is built by us from the screened plain text.
- **When.** Only while `content_experiments.status = 'active'`, which is a GATED
  graph edge requiring an authenticated admin. A `draft` experiment is invisible
  to the sender — asserted on the QUERY, not on the output.
- **How often.** Once per person per experiment, by unique index.
- **Consent.** Untouched. The opt-out check still runs at send time, before any
  of this, and the unsubscribe link is never wrapped.
- **What a result can do.** Nothing. A winner is written to
  `content_experiments.outcome` and to the ledger; no copy anywhere changes.
- **And the largest bound today:** `/api/cron/process-sequences` **is not
  scheduled** and must not be rescheduled blind (44 frozen enrollments —
  PLAN.md needs-Adam). Until it is, an experiment accumulates nothing, and the
  analysis will say `not_enough_data` forever, which is the correct answer.

---

## 8. What I could NOT verify

- **A real winner.** Two arms × 30 sends is 60 real emails and the sequencer is
  not scheduled. The `winner` and `no_difference` paths are exercised by test
  against a store that models the real indexes, and by arithmetic pinned to
  textbook p-values — but no production experiment has ever had enough data,
  and by design none will until Adam decides about the sequencer.
- **The `campaign_subject` surface has no sender.** It is in the CHECK and in
  `EXPERIMENT_SURFACES` so the analysis can read a campaign experiment set up by
  hand; no code sends it. A Brevo campaign goes to 944 real people and a campaign
  is never a test, so this was not wired. `WIRED_SURFACES` says so and the create
  route warns when you pick it.
- **A click from a real mail client.** The click was driven by fetching `/r/` with
  a token minted inside the container using the real secret — every byte of the
  route's logic, but not a human pressing a link in Gmail.
- **`replied` is a metric with no writer.** It is in the CHECK because a reply is
  a real outcome, but nothing records one: the Twilio inbound webhook points at
  another project (needs-Adam 11) and there is no inbound-email→variant link.
  An experiment on `replied` would report `not_enough_data` forever, honestly.

---

## 9. Not touched

Mobile pricing (rate card, `MobilePriceBlock`, planner bands,
`pricingCatalog.ts`) — and the variant screen enforces it, since a generated
variant may publish no figure at all. The 44 active enrollments (the probe used a
throwaway sequence). The 103 draft campaigns and the Brevo list. The three
`social_posts` drafts. The real open customer drafts, the `HH-TEST-PAY*` plans,
the three `agent_learnings` proposals and voice profile v2, the four
`pending_review` town drafts, the four dead English drafts. `process-sequences`
was run only with `?limit=1` against a probe row proved to sort first.
No Stripe object was created and no charge of any kind was made. No SMS was sent.
`invoice_number_seq` is still `118 / t`.

**What could not be cleaned up:** `marketing_ledger` is append-only (a
migration-021 trigger raises on DELETE), so the `content_experiment` rows this
session's probe runs wrote are permanent. They record an experiment creation, two
generations, a conclusion-free report and the LLM spend ($0.0043 total). Harmless,
and they are there.

---

## 10. Needs Adam

1. **A cron-job.org job for `/api/cron/experiment-report`** —
   `?secret=<CRON_SECRET>`, weekly, Monday ~8am. It concludes nothing, changes no
   copy, costs nothing (no model call) and is safe to leave scheduled
   indefinitely. **Ninth job in the same cron-job.org backlog** as PLAN.md items
   1, 6, 12, 13 and 18 — one visit settles all of them.
2. **Whether to run an A/B test at all yet.** The machinery is live and correct,
   and it has nothing to measure until `process-sequences` is rescheduled — which
   is PLAN.md needs-Adam 3 and mails 44 real people. An experiment can be created
   and left as a draft in the meantime; a draft sends nothing.
3. **`services.rentals` in `agent_memory` says the weekday studio rate is $450;
   the live rate is $475.** Nothing reads that row, so nothing is wrong today —
   but it is a February number sitting in a table somebody might one day copy
   from, and it is the reason the panel warns on it.
4. **The 26 flagged memory rows are not reviewed.** Nobody has to read them; the
   table is inert. But if any of that knowledge is worth giving the booking
   agent, the Memory panel is where it happens, one screened sentence at a time.

---

## 11. Phase 5 review findings

**Link 12 of the build chain. 2026-09-12. Worktree `ancient-cairn`. No migration —
046 is still free. Suite 1802 → 1840 green.**

§8 was the starting list. Five of its six items are closed below; the sixth
(`replied`) has no writer and could not be. Then each stated guarantee was
attacked in production, and **nine gave**.

Nothing here changes the shape of Phase 5. The screens hold, the claim holds, the
redirect holds, the refusal holds. What gave was the reporting around them —
twice in the direction rule 10 warns about, and once in the direction that caps
the whole feature.

---

### 11.1 What §8 could not verify, and what production said

**A real `winner` — now measured.** A throwaway experiment, isolated by a
`target_key` naming a sequence uuid that does not exist (so no real enrollment
could ever match it), was given 60 assignments over real contacts, 60 `sent`
events and a deliberate skew:

```
arm A (control) 5/30 · arm B 18/30
→ "Arm B beat the control (B: 18/30, control A: 5/30, p = 0.0006
   against α = 0.0500, Bonferroni over 1 challenger(s)).
   This is a PROPOSAL: nothing has been changed."
```

p = 0.0006 against a hand-computed 0.000557. **The arithmetic in §3.4 is right on
real Postgres.** `concluded` then wrote the verdict and `email_sequence_steps` was
**byte-identical before and after** (sha256 of all nine rows, unchanged) — a
winner really does change no copy.

**`min_per_arm` is really read, proved by CHANGING it** (rule 6, not by reading
the page). `UPDATE … SET min_per_arm = 40` turned the same data from `winner`
into:

```
"Not enough data to call … arm A has 30 send(s) of the 40 needed;
 arm B has 30 send(s) of the 40 needed."
```

And it cannot go the other way by accident: `min_per_arm` has no PATCH route, the
create route refuses `1` and `2.5` with 400, the DB CHECK refuses anything below
2, and `asExperimentRow` refuses it again on read.

**The conversion attribution, against real bookings.** Five hand-built cases over
real `bookings` rows, each one naming what it tested:

| case | assigned relative to the booking | expected | got |
|---|---|---|---|
| confirmed booking | 1 day before | count | counted |
| deposit_paid booking | 12 days before | count | counted |
| booking PRE-DATES assignment | 5 days after | no | not counted |
| 60 days before | outside the 14-day window | no | not counted |
| **cancelled** booking | 1 day before | no | not counted |

`control A: 2/2, best challenger B: 0/3`. **All five window rules are right on
live data**, which §8 listed as untested. The `bookings` table was read-only
throughout and still holds 60 rows.

**`campaign_subject`, which nobody had exercised.** It activates cleanly (the
gate does not care which surface), the report analyses it honestly
(`not_enough_data`, 0 of 2 needed), nothing sends, and the create route warns in
so many words: *"no sender in this codebase reads the campaign_subject surface
yet, so activating it will change nothing."* The open item is closed: it behaves.

**`/r/<token>`, attacked with GENUINE signatures on thirteen destination forms
§4 did not try** — every one refused, 302 to the homepage, nothing recorded:

| destination | result |
|---|---|
| `https://www.hosthampton.com@evil.example.com/` (userinfo) | refused |
| `https://www.hosthampton.com:443@evil.example.com/` | refused |
| `data:text/html,<script>alert(1)</script>` | refused |
| `//` alone | refused |
| `///evil.example.com/x` | refused |
| `https://www.hosthаmpton.com/x` (Cyrillic а — IDN homograph) | refused |
| NUL inside the destination | refused |
| U+2028 inside the destination | refused |
| `/\evil.example.com/x` | refused |
| `ht<TAB>tps://evil.example.com/x` | refused |
| `vbscript:` · `file:///etc/passwd` | refused |
| CRLF header injection in the destination | refused |

…and nine malformed-token forms: a one-character token, dots only, base64 that
decodes to invalid UTF-8, a valid token with one character appended, a 40 kB
token (**414** from nginx — bounded), a NUL inside the assignment id, an
assignment id that is not a uuid, and a genuinely signed token for an assignment
that does not exist. The last one wrote **exactly one** `unattributed_signals`
row; the two malformed-id cases wrote **none**, which is correct — a 22P02 on a
uuid column is a blip, and a blip must not put a permanent row in front of a
human (rule 12). A mixed-case scheme on a real destination (`HtTpS://`) **still
worked**, so legitimate input survives. Seven further requests on that same valid
token — two serial, five concurrent — left `clicked` at exactly **1**.

**`loadVariants` is the only reader of `content_variants` in the codebase.**
Grepped, not assumed: `generate.ts` writes, `load.ts` reads, nothing else names
the table. The panel renders `body_text` as a React child, and `body_html` is
never selected anywhere. **§24's shape does not recur here.**

Still unverified, and honestly: **a click from a real mail client**, and
**`replied`**, which is in the CHECK and has no writer.

---

### 11.2 Finding 1 — the analysis died at ~390 assignments, permanently

The one that matters. PostgREST takes `.in()` as a query **parameter**, so the
whole id list travels in the URL. Driven against the real endpoint with real
assignment uuids:

```
n=300  urlLen=11,214  http=200  rows=300
n=350  urlLen=13,064  http=200  rows=350
n=380  urlLen=14,174  http=200  rows=380
n=400  urlLen=14,914  THREW: fetch failed
n=500  urlLen=18,614  THREW: fetch failed
```

And against the live analysis, with 500 assignments really in the table:

```
analysis kind: unavailable
summary      : unavailable: events unreadable: TypeError: fetch failed
TOTAL sent counted by the analysis: 0   (the table holds 500)
```

**Rule 12 held — it reported `unavailable`, not zero.** But it reported it
*forever*: past about 390 assigned contacts an experiment becomes permanently
unanalysable, and nothing ever recovers it. That ceiling sits **inside the range
the feature is designed for**: `min_per_arm` defaults to 30, two arms need 60, and
a nurture experiment left running over a 1,219-row `contacts` table reaches 390
without anybody doing anything unusual. `attributeConversions` has the same
ceiling on distinct contact ids.

Worse, the weekly report would stay **green** while this happened: a single failed
experiment among several keeps HTTP 200 (`allFailed` requires *every* one to fail),
so the only symptom is a line in `failures[]` nobody is watching for.

There is no PostgREST row cap in the way — the same probe confirmed an unlimited
`select` returned all 500 rows. It is purely the URL.

**Fixed** by chunking both `.in()` reads at 100 ids (URL ≈ 3.8 kB, an order of
magnitude of headroom), with a failure in **any** batch failing the whole read —
half the events would be a smaller numerator against a full denominator, which is
the one direction that invents a result.

**Verified after deploy, on the same 520 rows that had just failed:**

```
analysis kind: winner
arms         : [{A, sent 250, m 40}, {B, sent 250, m 120}]
```

250/250, matching what the database itself reported. The read that threw now
answers.

---

### 11.3 Finding 2 — unattributed events were counted and never written down

A hostile arm C (`"take $500 off"`) was inserted straight into Postgres, past
every route, into an already-**active** experiment. The read screen dropped it and
named it, exactly as §4 claims. Its events — **19, nine of them clicks, 39% of
the experiment's entire click volume** — were correctly held out of both arms.

And then:

```
unattributedSignals rows: 0
```

The panel's own message reads *"19 event(s) could not be attributed to any arm —
**see the unattributed signals**"*, and that list was empty. `analyseExperiment`
incremented a counter in both of its unattributable branches and called
`recordUnattributed` in neither.

This is hard-won rule 14 — *an unattributable record is a bookkeeping problem; an
INVISIBLE one is a loss* — failing in the module whose header cites rule 14 as its
reason for existing, and rule 10's expensive half on top: the panel said it had
recorded something where a human looks, and it had not.

**Fixed:** one naming row per analysis run (not one per event — nineteen identical
lines in front of a human is its own kind of silence), carrying the count, the arm
label and the screen's reason. Written only when `attribute` is on, so the admin
GET still never writes to the table it is displaying.

**Verified in production:**

```
variant_events | 32 outcome event(s) in "ZZ p5 review probe — scale" belong to
                 no usable arm and are in no arm's numerator or denominator:
                 arm C (32 event(s)) — it states dollar amount $500 —
                 this surface may not publish a price
```

…and the panel GET before that run still wrote nothing.

---

### 11.4 Finding 3 — a significant loss read as "no difference"

The conversion probe came back:

> `no_difference` — *"No significant difference … (best challenger B: 0/3, control
> A: 2/2, p = 0.0253 against α = 0.0500 …). Enough data, no winner — which is a
> result."*

**p was below alpha and the control had won.** The `winner` branch requires
`best.rate > controlArm.rate`, which is right — a winner should only ever be a
challenger — but everything below it fell through to a sentence that says the
copy made no difference, over a measurement saying the new copy is significantly
*worse*.

That is the same class of mistake as §5's rigged arm, with the arithmetic pointing
the other way: the number is correct and the sentence contradicts it. And it is
the more dangerous direction, because "no difference" is the verdict under which
somebody adopts the challenger anyway.

**Fixed:** the `kind` stays `no_difference` (no challenger won, and the DB
`outcome` CHECK has no fifth label), but the note now says it:

```
The CONTROL beat every challenger in "…" on clicked, significantly
(control A: 190/250, best challenger B: 120/250, p = 0.0000 against α = 0.0500…).
No challenger won, so there is no winner to propose — but this is not
"no difference": the live copy is measurably ahead and the challengers should
not be adopted.
```

Verified in production by pushing the control ahead on the 500-row probe. A
genuine tie still reads as no difference, with no mention of a control winning.

---

### 11.5 Finding 4 — the weekly report could not say an arm had been dropped

`/api/cron/experiment-report` is the **only scheduled reader** of an experiment.
With arm C dropped and nine clicks discarded, it answered:

```
kind: winner | outcome: winner | unattributed: 19
summary: Arm B beat the control (B: 18/30, control A: 5/30, p = 0.0006 …)
```

`loadExperiment` returns `rejected`; the report never looked at it. The count was
in the JSON as `unattributed: 19`, and the **sentence** — the thing that goes into
the ledger, the console and any future email — said nothing. The admin panel does
show it, and that is exactly the gap: the panel needs a human to open it, and
§24's whole lesson is a correct screen whose finding nobody was shown.

**Fixed:** `rejected` now reaches the per-result payload, the `summary` sentence,
the console line and the ledger meta, through **one shared sentence**
(`droppedArmsNote` in `analysis.ts`) rather than a second spelling in the route —
because a sentence written in two places is rule 11 with prose instead of a
constant. Verified live; the summary now carries *"NOTE: the read-time screen
dropped arm C (…) — any sends or clicks on that arm are in NO arm's numbers."*

---

### 11.6 Finding 5 — a billed model call was recorded as costing nothing

`inputTokens`/`outputTokens` are read off `usage` **before** the JSON parse, and
the parse is the step most likely to fail: `max_tokens` is 3,000, the screen
allows 12,000-character bodies, three variants truncate, and a truncated reply has
no closing brace — so `text.match(/\{[\s\S]*\}/)` misses and the whole call throws.

Anthropic has already billed those tokens. The old `catch` returned
`{ costUsd: 0, tokens: 0 }` and **never called `recordLlmSpend`** — so the ledger
said a call that cost money cost nothing, and `assertLlmBudget` would let the next
caller spend as if it had never happened.

`assertLlmBudget` before / `recordLlmSpend` after was correct **by invocation**
on the happy path, which is what §6 checked. It was the failure path that lied.
Same family as link 10's finding that the SMS half of that module was charged 1
segment for a 3-segment message: a counter is only as good as what it is told, and
rule 10's expensive half is reporting something you did not do — here, spending
nothing.

**Fixed:** one `recordSpend()` helper, idempotent, called on both the success and
the failure path, and the response reports the real figure. A reply with no `usage`
at all records nothing rather than a fabricated zero-token row.

---

### 11.7 Finding 6 — `EXPERIMENT_ENTITY` was re-typed four times

`generate.ts` imports four things from `./types` and then writes
`entityType: 'content_experiment'` out by hand in four places — including once
three lines from a comment explaining that the constant lives in `types.ts`
*"which is where it belonged anyway (rule 11)"*.

Same value today, so nothing was broken. It is rule 11 in its plainest form, in
the file whose own header preaches it, and it is one import. Fixed, and pinned by
a test that reads the source and fails if the literal comes back.

---

### 11.8 Finding 7 — a tracked plain-text link pointed at a 404

The text pass matches a bare URL with `[^\s<>"')\]]+`. That correctly stops at a
closing bracket and does **not** stop at a full stop:

```
"Pick a date here: https://www.hosthampton.com/book."
  → token signed for  https://www.hosthampton.com/book.
"See https://www.hosthampton.com/book, then call."
  → token signed for  …/book,   and the comma vanished from the sentence
```

And in production:

```
/book   → 200
/book.  → 404
/book,  → 404
```

So the plain-text part of a variant email carried a tracked link to a dead page.
The click is still *recorded* (the route writes before redirecting), so the
measurement survives — the customer is the one who pays, with a 404 on
hosthampton.com reached from an email we sent.

The module comment above it read *"There is no failure mode here in which a
recipient gets a broken link: the worst case is an untracked click."* Rule 8's
oldest form, now for the sixth time: a comment asserting the opposite of its code.

It matters more here than it would elsewhere, because the screen **requires** the
model to write plain paragraphs and the prompt tells it to include the URL in
full — `"…here: <url>."` is the most natural sentence it could produce.

**Fixed:** sentence punctuation is split off the end, wrapped URL and punctuation
re-joined, so the reader keeps the full stop and the token carries the real path.

---

### 11.9 Finding 8 — `EXCLUDED_PATHS` was case-sensitive

`/UNSUBSCRIBE?t=…` and `/API/unsubscribe` pass `safeSiteLink` and were **not**
excluded, so a body carrying either would have had its opt-out wrapped.

**No live opt-out was ever defeated, and it is worth being exact about why:**
Next's route matching is case-sensitive, so both forms answer **404 in
production** (measured), and every unsubscribe link the system actually emits
comes from `buildUnsubscribeUrl`, which is lower case and is *also* passed to
`rewriteTrackedLinks` explicitly. Three independent things had to be true for the
guarantee to hold and two of them were coincidences.

One related observation, not a finding: the explicit `url === unsub` belt is
defeated by HTML entity encoding (`&amp;` in an href), and only
`isExcludedFromTracking` catches it — confirmed by test. It does not arise today
because `buildUnsubscribeUrl` emits a single query parameter and so has no `&`. If
a second parameter is ever added, the belt goes silently inert and the path check
is all that remains.

**Fixed:** the path is lower-cased before comparison, and a test asserts every
entry in the list is itself lower case — otherwise the comparison silently stops
working. `/unsubscribe-policy` is still correctly **not** excluded; the match is
by segment for exactly that reason.

---

### 11.10 Finding 9 — `advance()` called a failed read "not found"

Observed live, activating an experiment through the real route:

```
{"error":"advance: content_experiment 0f5e0001-… not found (Gateway Timeout)"}
```

A Supabase blip, reported as a confident statement that the row does not exist —
about a row that was sitting right there. A retry seconds later succeeded.

This is **shared code**: `advance()` is the one transition function for all six
entity types, including `inquiry_draft` → `approved`/`sent`. `.single()` reports a
genuine miss as **PGRST116**, so the two were always distinguishable; collapsing
them turned a blip into a fact (rule 12). The route answered 500, so nothing
false was written — the damage is a person sent looking for a row that is fine.

**Fixed:** PGRST116 is "not found"; anything else is *"could not be read (…) — the
row may well exist; this is a failed read, and nothing was changed."*

---

### 11.11 Finding 10 — `loadActiveExperiment` truncated, then filtered

```
.eq('surface', surface).eq('status','active').order('created_at').limit(8)
   … then  .filter(r => r.target_key == null || r.target_key === targetKey)
```

The target filter ran in **code, after the LIMIT**. With nine active
`sequence_step` experiments the ninth is invisible, and the one it hides could be
the one naming this very step. The processor reads that as `absent` — the "normal
case, and it is not news" branch — so the experiment simply never runs and
**nothing anywhere says so**. Rule 16's shape again: a framework default (a limit)
deciding the answer.

Not reachable today (nobody has had more than four active at once, and this
review's probes peaked at three). Fixed anyway, because the failure is silent:
two explicit reads, one `.eq('target_key', key)` and one `.is('target_key',
null)`, each filtered in the query. Two reads rather than one PostgREST `.or(...)`
because `target_key` is `<uuid>:<step>` and a colon inside an `or` filter is a
syntax question nobody should have to think about on the live send path. The
existing query-assertion test was extended to pin both reads.

While in there: an **active** row `asExperimentRow` cannot parse was dropped by a
`.filter(r => r !== null)` and became `absent` — the same rule-12 collapse,
unreachable today because migration 045's CHECKs are exactly that function's
bounds, reachable the moment a migration widens one while an older image is still
serving. It now logs what it did not understand.

---

### 11.12 Finding 11 — the memory screen, and a wrong fix caught by its own test

`screenMemory` runs three detectors. Two read the whole value — deliberately,
because *"screening a truncated value would be a screen that gets weaker the
longer the payload is"* is this module's own stated reason for reading `value` in
full. The third, the prompt-structure detector, was called on `text.slice(0, 400)`.
So a forged `PRIORITY PULL LOGIC:` header at character 500 was invisible to the
one detector that looks for forged headers, while the same row's `$850` was not.

**The first fix was wrong, and the test is what said so.** Passing the whole value
makes it *worse*: `screenLearningText` refuses anything over `MAX_LEARNING_CHARS`
(400) with *"it is longer than 400 characters"* **before** it ever reaches
`PROMPT_STRUCTURE`, and `screenMemory` filters that verdict out — so every value
over 400 characters would have lost its structural screen entirely. The real rows
run to 3,210 characters. `.slice(0, 400)` was not an oversight; it was working
around that cap, and it happened to screen exactly the window the cap allows.

**Fixed properly:** overlapping 400-character windows (overlap 120, so a heading
straddling a boundary is still matched whole), keeping only structural verdicts.
Rule 8 applies to one's own patches, and this is the second time in two sessions
that writing the test for a fix found the fix.

---

### 11.13 Recorded, not fixed: `promoteMemory` stamps `updated_at`

§2 and migration 045 go to some trouble not to UPDATE `agent_memory`, because
`trg_memory_updated_at` fires **unconditionally** and `updated_at` is the evidence
that 43 rows have not been touched since February. The migration used a COMMENT
for that reason and says so.

`promoteMemory` then does:

```ts
await supabase.from('agent_memory').update({ promoted_learning_id: proposed.id }).eq('id', memoryId)
```

The migration anticipated this and argued it is fine — *"where bumping
`updated_at` is correct, since that row really did change."* **I would reverse
that call.** The row changed; the *knowledge* did not, and `updated_at` on this
table means when the value was last maintained — that is what `trg_memory_version`
keys on and what the entire retirement argument rests on. Making one column carry
both facts is rule 11's sharpest form, and after two promotions nobody can tell
which rows are stale: `agent_memory_history` does not log it (the value is
unchanged) and `version` is not bumped either.

**Not changed here**, because the right fix is a migration —
`agent_learnings.source_memory_id`, which also makes the link readable from either
side as the code comment claims it wanted — and that is a design change, not a
defect repair. **Migration 046 is free and this is what it is for.** Flagged for
the next link.

It is still **latent**: production shows `agent_memory promoted = 0` and
`updated_at` bounded `2026-02-18 … 2026-04-22`. This review deliberately did
**not** exercise `promoteMemory` against production, because proving the finding
would have destroyed the evidence on a real row. The trigger was read out of
`pg_trigger` instead (rule 13), which is the right way to know.

---

### 11.14 Driven against production

Everything above was measured on the live box, either through the public routes
from inside the container or through `/root/pg.sh`.

Three throwaway experiments, each isolated by a `target_key` naming a sequence
uuid **that does not exist**, so no real enrollment could match one even if
`/api/cron/process-sequences` had fired (it is not scheduled — PLAN.md
needs-Adam 3). The 44 active enrollments were never touched and
**no email or SMS was sent by this session at all.**

Doors, re-checked: `/api/cron/experiment-report` 401 without the secret and with
a wrong one; `/api/admin/experiments` 401 unauthenticated, including on the
`transition → active` edge; `create` refuses `minPerArm: 1`, `minPerArm: 2.5`,
`alpha: 0.9` and `alpha: 0` with 400 and a reason. `content_experiment`'s GATED
set is `{active}` and nothing else — read out of `graph.ts`, and it is the sixth
gated edge in the file.

**What was written to a real customer's record, and removed.** The legitimate-click
probe wrote one `contact_interactions` row of type `email_clicked` against a real
contact — a true record of the route's behaviour and a **false statement about a
customer**, who never clicked anything. It was deleted, scoped by the
`metadata.source = 'variant_track'` stamp the route writes.
`contact_interactions` is back to **142** rows with **zero** `email_%`.

**Restored, every counter, against the figures this session started from:**

```
content_experiments 0 · content_variants 0 · variant_assignments 0
variant_events 0 · unattributed_signals 0
contact_interactions 142 (email_% = 0) · contacts 1219 (21 still mixed-case)
bookings 60 · active enrollments 44 · email_sequences 7 · steps 9
agent_memory 44 (promoted 0) · agent_memory_history 89
agent_learnings 3 (0 active) · social_posts draft 3
scheduled_reminders 0 · scheduled_campaigns draft 103
agent_memory.updated_at  min 2026-02-18  max 2026-04-22   ← unchanged
invoice_number_seq  118 / t                                ← untouched
```

No Stripe object was created, no charge of any kind was made, no Brevo campaign
was sent, and **no model call was made** — the two `llm_call` rows in
`marketing_ledger` ($0.0043) are timestamped 15:39 and 15:45 and belong to link
11, before this session began.

**What could not be cleaned up.** `marketing_ledger` is append-only (a
migration-021 trigger raises on DELETE), so this session's rows are permanent:
**7 `transition`, 15 INTEL `note` and 2 ADMIN `note`**, all against
`entity_type = 'content_experiment'`, all with `cost_usd` null or 0. They record
probe activations, probe reports and one probe conclusion. Harmless, and they are
there.

Live funnel after deploy: `/`, `/book`, `/party-planner`, `/party-room-rental`
and `/admin` all **200**.

---

### 11.15 Tests

`src/__tests__/lib/phase5Review.test.ts` — **37 tests, one `describe` per
finding**, each carrying the production observation that justified it, in the
shape `phase4Review.test.ts` established. The chunk-size test derives its bound
from the **measured** 14,174-character ceiling rather than pinning a number
somebody chose, so raising `IN_CHUNK` past what the URL can carry fails in CI.

`fakeReminderDb`'s engine gained `.is(col, null)` — NULL is not a value `.eq()`
can match, in PostgREST or in Postgres, and `loadActiveExperiment` now depends on
that distinction. Extended, not replaced (§6's rule about the fake).
`experimentLoad.test.ts`'s query assertion was widened to pin **both** reads and
their target filters, which is the finding in 11.11 made permanent.

`npx jest` → **1840/1840**. `npx tsc --noEmit` → 0 errors in app code.
`npx next build` → compiled successfully, `/book` unchanged at `○ Static`
7.15 kB, `/r/[token]` still `ƒ (Dynamic)`.

---

### 11.16 Needs Adam

Unchanged from §10, plus nothing new. Restating the one that now matters more:

**The `/api/cron/experiment-report` job (§10.1) is worth scheduling even with
nothing to measure** — it is the surface that writes the `unattributed_signals`
row from 11.3, and after this review it is also the surface that names a dropped
arm. It concludes nothing, changes no copy and costs nothing. Ninth job in the
same cron-job.org backlog as PLAN.md items 1, 6, 12, 13 and 18.

And a note for whoever schedules it: a **partial** failure keeps HTTP 200 and
names the failures in `failures[]` (11.2). That is a deliberate judgement — the
experiments that did analyse produced real verdicts and hiding them behind a 503
would lose them — but it means a green run is not proof every experiment was read.
