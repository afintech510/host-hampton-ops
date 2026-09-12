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
