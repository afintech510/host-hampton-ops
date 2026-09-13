# Needs Adam — the one list

Everything the build chain could not decide or could not reach, in the order
worth doing. Detail for each lives in the review doc named at the end of the
line; the numbers match `PLAN.md`'s needs-Adam entries.

**How to read this:** § A is minutes of your time and unblocks a session.
§ B is a decision only you can make. § C is a credential nobody else has.
§ D is real customer data that needs a human to say what is true.

Nothing in here is broken-and-getting-worse unless it says so.

---

## A · Quick unblocks — minutes each, and they unblock work

### A1. Finish the Slack cutover — four values *(this is the one you asked for)*
`/opt/hosthampton/.env` has **zero `SLACK_*` variables** and the Slack app has
never been created. The code is deployed and inert (`/api/slack/*` answers 401
`unconfigured`, which is correct). Get these four and a session can flip it:

| value | where |
|---|---|
| Signing Secret | Slack app → Basic Information |
| Bot User OAuth Token (`xoxb-…`) | OAuth & Permissions, after install |
| `#hh-leads` channel ID (`C…`) | channel → View channel details → bottom |
| your Slack member ID (`U…`) | your profile → ⋮ → Copy member ID |

**⚠ Ordering trap, and it will look like our bug if you get it wrong:** the
signing secret must be on the box **and deployed** *before* you enable Event
Subscriptions. Slack signs the `url_verification` handshake and it gets no
exemption from fail-closed. Enable events early and the handshake 401s.

Full steps: `docs/slack-app-setup.md` §0. Manifest: `docs/slack-app-manifest.yml`.
**Why it is worth doing: it replaces the per-message SMS cost of the reviewer
loop with nothing.** See § B7 — it also fixes the single-handset problem.

### A2. Delete the second Quo webhook *(52)*
Every inbound SMS is delivered to us **twice** and one copy is refused, because
it is signed with a key the Quo API does not expose — an app-created webhook, not
an API one. Find it on the Quo app's **Settings → Integrations / Webhooks** page
and delete it (or send me its signing key and I will put it on the box).
Harmless today; it means that route runs a permanent ~50% 401 rate, which is
exactly the noise the *next* real outage will hide in — and the last one hid
there for two and a half days. `docs/quo-webhook-setup.md` §6.

### A3. Repoint the Twilio inbound webhook *(needs-Adam's oldest open item)*
`TWILIO_PHONE_NUMBER` (+1 844 624 0400) has its `SmsUrl` pointing at
**a different Supabase project** (`losrkjvrcambvgijfism…`) with `StatusCallback`
on a Google Cloud Function in `twiconnect-257c6`. So every reply to a reminder or
campaign SMS — **including STOP** — lands in somebody else's system. Twilio
honours STOP at the carrier level so nobody is texted against their wishes, but
our database never learns and the reminder engine keeps trying them.

**It is now safe to repoint, which it was not before 2026-09-13** — the route
verifies Twilio's signature and fails closed. One API call:
`POST /2010-04-01/Accounts/{SID}/IncomingPhoneNumbers/{NumberSID}.json` with
`SmsUrl=https://www.hosthampton.com/api/webhooks/twilio`.
**The only question is what currently consumes that endpoint and whether it
still matters.** `docs/inbound-message-surface-review.md` §3.

### A4. The weekly distill cron job
`/api/cron/agent-distill?secret=<CRON_SECRET>`, weekly, **Monday 7am**, on
cron-job.org. The route is live and has been run by hand. Until it is scheduled
the learning loop captures corrections and distils nothing on its own.

### A5. Two cron jobs have 401ed every single day for weeks
`booking-locks` and `draft-newsletter` are scheduled on cron-job.org with a
**stale secret**. Either fix the secret in those two jobs or delete them —
right now they are pure noise, and one of them (§ B3) you may not want running
at all. `docs/cron-scheduling-review.md`.

---

## B · Decisions only you can make

### B1. The studio $250 — refundable hold, or reservation payment? *(41)*
Recorded **four times now** (links 16, 21, 23, 24) and still unruled. It is
**$250 each on two live bookings**, one of them a party on **2026-09-30**.

* **The invoice says**: a security deposit held against damage and refunded
  after. `HH-STU-ZVM4U` pays $475 + $250 back = **$725 out, $250 returned**.
* **The stored column says**: a reservation payment that comes off the total.
  Same booking pays **$475 in all**.

It is now **two booleans** in `lib/planBalance.ts` — `STUDIO_DEPOSIT_IS_SEPARATE`
and `COLUMN_FOLLOWS_INVOICE`. Say which reading is right and it is a one-line
change; the test suite will name every row that moves. Meanwhile
`/api/portal/pay` clamps to the *lower* of the two so nobody can be overcharged
while it is open. **This also blocks § D4.** `docs/plan-money-path-review.md` §4.

### B2. Whether to restart `process-sequences`
It ran for five months, **stopped on 2026-08-16, and nobody noticed for a
month.** 44 enrollments are frozen. Turning it on mails real customers —
*"Still thinking about your event?"* to people who enquired in July about an
event that has already happened. Four options now exist:

1. reschedule as-is;
2. cancel the stale enrollments first;
3. drain it one at a time with `?limit=1` (which genuinely drains now);
4. **let it run** — the 14-day freshness bound now *pauses* anything more than a
   fortnight overdue and names it with the SQL to resume, rather than mailing it.

**Read first:** seven of the 44 have a mixed-case email address and their
unsubscribe link did nothing at all until 2026-09-12, so they are the people most
likely to press *Spam* rather than *Unsubscribe*. And thirteen recipients of
"Lead Follow-Up" **already have a confirmed paid booking** (§ D3).

### B3. `booking-locks` would lock four real bookings *(35)*
Running it flips four real approved bookings to `modifications_locked`. Six
sessions have deliberately not run it. Is that the intended behaviour for those
four, or should the rule change first?

### B4. Schedule the three reminder crons *(18)* — and backfill? *(19)*
`scheduled_reminders` is live, repaired, proven… and **empty**. The three crons
are not scheduled, so **~18–20 real upcoming bookings have no reminders at all**.
Scheduling them starts texting and emailing real customers about real parties,
which is the designed behaviour but is still your call to switch on. Backfilling
the existing bookings is a separate yes/no.

### B5. The 3% card fee on deposits *(50)*
`docs/inquiry-response-flow.md` §4.4 says it twice, once with a padlock:
*"3% card fee on the balance only, never on the deposit."* **Three code sites
charge it on the deposit anyway**, and one real customer has paid **$7.14** of
it. Removing it reduces what you collect; leaving it contradicts a locked
document. Pricing decision, not a bug.

### B6. Should an inbound `START` re-subscribe a number? *(53)*
We now recognise `START` / `UNSTOP` / `RESUME` instead of reading them as
ordinary messages — but we **record** it rather than writing consent, because a
number is not a person (two of your duplicated phone groups are two different
people sharing a handset) and nothing records which rows a past STOP turned off.
Has never happened with a real customer yet.

### B7. `REVIEWER_PHONES` is one handset, and it is the test number *(49)*
Every reviewer guardrail — identity, the confirmation prompt, the TEST send —
resolves to a single phone. Should Allie's number join it? **§ A1 largely
dissolves this**: Slack gives you named reviewers with real identities.

### B8. `/api/signup` asserts marketing consent in code *(42)*
It hard-codes `marketingConsent: true` for everyone who submits and mints
unbounded 10%-off coupons. The form says "sign up for 10% off" so consent is
arguably implied — but the *route* is asserting it, not the person, and now that
the Brevo mirror works it would add them to the 944-person list. **Measured: it
has never run.** Worth a ruling before it does.

### B9. LI High is still selling and its API is open *(39)*
`next.config.js` redirects all three `/cm-cheer/*` pages to `/fundraiser` as
"retired", while **`/li-high` still serves and its POST route is still a public
write door into a table of 21 real customers.** Close the route, or is LI High
still live? (The prices also exist only as `data-price` attributes in the page
markup — a server-side catalogue is the real fix, but it edits two live pages.)

### B10. Retire `summer_hair_bookings`? *(38)* · Retire `cm_cheer_orders`? *(39)*
16 and 21 real people's names, phone numbers and emails, in tables nothing writes
to any more. Keep, export, or drop.

---

## C · Credentials nobody but you can get

### C1. A Stripe **test** key pair
The container has `sk_live` only, so **no end-to-end payment has ever been driven
and none should be.** Adding `STRIPE_TEST_SECRET_KEY` + `STRIPE_TEST_WEBHOOK_SECRET`
would let a test card prove what Stripe actually sends. Until then the money path
is covered by a signed-synthetic-event harness, which is a lot but not that.

### C2. Meta / Instagram credentials
Zero `META_*` variables in the container. Automated Instagram posting is blocked
on credentials before it is blocked on code.

### C3. Google Business Profile credentials
Same — no credential in the container.

### C4. Cloudflare's managed `robots.txt` blocks the AI crawlers
Our `robots.ts` welcomes GPTBot, ClaudeBot, PerplexityBot; Cloudflare's managed
rule overrides it. Turn the managed rule off if you want to be cited by AI search.

### C5. Rotate the scrubbed secrets
Secrets were removed from git history on 2026-09-08. **They are still live until
rotated at each provider.** Anyone with a clone from before that date has them.

---

## D · Real customer data that needs a human

### D1. Eight real people have two contact rows each *(31)*
Three are **paying customers whose history is split in half** — the `customer`
status and lifetime value on one row, the bookings and enrollments on the other.
Merging touches eighteen foreign keys. My recommendation: keep the **oldest** row
(which is what every read now resolves to), sum the values onto it, take the
highest status, **never inherit consent**, and *cancel* the loser's enrollments
rather than moving them. **Most urgent inside it:** Jessica Lindstrand is a
three-time customer with $282.62 of history sitting on **two active lead-nurture
enrollments** — she gets pitched "book your first party with us" the day § B2
happens. `docs/contact-identity-review.md` §8.

### D2. 253 people are not in Brevo at all *(32)*
The mirror could never create a contact until 2026-09-12, so everyone captured
outside the two hand-run imports is invisible to every campaign. Going forward
this is fixed. **Backfilling the 253 is a bulk write to a marketing list of real
people** and the consent test for many of them would be an `email_opt_in = false`
that only means "the box was never on the form they used". I have the exact list.

### D3. Thirteen "Lead Follow-Up" recipients already booked and paid *(36)*
They are among the 44 frozen enrollments. Cancel them before § B2, or they get
pitched a first booking they have already made.

### D4. Thirteen bookings hold a stale balance, $3,168 low *(51)*
Rows nobody has paid against, whose column was written at quote time. Nothing
recomputes them until a payment lands, at which point they self-correct. It is
one UPDATE — **but it must happen *after* § B1, not before.**

### D5. Four **cancelled** bookings carry a live balance *(45)*
$47,470 between them. Cosmetic today (the portal refuses to charge a cancelled
booking) but it is wrong in the books.

### D6. $2,256 in and $312.01 out of hand-entered money *(33/34)*
Cash, Venmo, Zelle and card the admin panel recorded but the financial ledger
never saw, because the books writer was private to the Stripe webhook. The code
path is fixed; **whether and how to enter the historical rows is your accounting
call.** Same for the **$927 row**.

### D7. ~$2,186 of Venmo in ten days is in no table at all
No code path writes an offline ticket, and a Venmo *note* can be edited in the
comments two minutes later. This is money moving with no record on our side.

### D8. Six SignWell documents with no booking row *(25)*
`HH-STU-` `WL8YJ`, `MEQJT`, `XVKAU`, `DBTPB`, `VRGSV`, `EQNYV`. **Two are
Completed live-mode liability waivers — real waivers, signed by a returning
customer, recorded nowhere.** Do not archive or void them until somebody says
what they belong to.

### D9. Three open agent drafts hang off cancelled parties *(47)*
Two are real customers whose parties were called off. Every surface now refuses
to send them, but they still sit in the review queue looking actionable.
**Dismiss them?** That is a customer-relationship question — if either
cancellation was a mistake, the draft is the thing you want.

### D10. Thirty real inbound customer texts reached no queue
8 people, 2026-08-27 → 2026-09-10, sitting in `contact_interactions` and nowhere
else — *"Our house is 28 south drive sag harbor… Party 9/13"*, *"Yes can we
book"*, *"I want to book the Nov 7 party"*. **The Quo threads show a human
replying, so they were answered**; the database simply never learned. Nothing to
do unless you want them back-filled onto the right bookings.

### D11. Three social drafts spell the brand hashtag wrong
`#hosthamption` in all three `draft` rows (2026-09-15 / -17 / -19). Left rather
than silently "fixed" because the model wrote it and you should see that.

---

## E · Known and deliberately unfixed

* `/kids-party-menu` publishes a **7**-guest mini-party limit; the planner uses
  **6**. Unruled, so untouched everywhere including generated copy.
* The published mobile tiers ($500/8, $750/12) stay up **by your choice**, while
  the target is $850/10. Every mobile booking today is underpriced against
  intent. The band table is written; stations and travel are still with you.
* The public rate limiter is in-memory and resets on every deploy *(43)*. It is
  effective today; a durable version needs a table and a migration.
* **Nothing monitors anything** *(48, and now four times over)*: a cron that
  stopped for a month, two that 401 daily, a webhook that refused every message
  for 2.5 days, and a CI gate that failed every build for a day. Every one was
  found by somebody happening to look. This is the standing systemic risk.
