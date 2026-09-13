# Host Hampton — Ops & Agent Guide

Operating and development guide for the Host Hampton party/event booking platform — the live `www.hosthampton.com`. **This repo is the FLEET HUB:** its `hampton_nginx` container and `hampton_net` Docker network are the shared edge reverse proxy / network that other projects on the same VPS attach to. Treat changes to the proxy and network as fleet-wide changes.

---

## 1. What this is

Host Hampton is a party/event booking platform: marketing site, customer booking/party-builder flows, an admin dashboard, and the public API — all served by a single Next.js app. Customers book parties/events, pay deposits via Stripe (LIVE mode — real money), e-sign studio rental agreements (SignWell), and receive automated email/SMS reminders.

There is **no CI/CD**. Production is one Hetzner VPS running Docker Compose; deploys are a manual `git pull` + rebuild on the box, driven from your laptop by `scripts/deploy.sh`.

> A multi-service AI "agent stack" (orchestrator, SOC, copy, image, paid-ads, MCP servers, redis) is scaffolded in `docker-compose.yml` and `services/` but is **commented out / disabled**. Only `nginx` and `website` run in production. Do not assume those services exist when operating.

---

## 2. Stack

- **App:** Next.js 14 (14.2.5), React 18, TypeScript, App Router (`src/app/...`), Tailwind CSS. Built as `output: 'standalone'`.
- **Container runtime image:** `node:20-alpine`, runs `node server.js` on **port 3002**.
- **Reverse proxy:** `nginx:alpine` (`hampton_nginx`), terminates TLS on 80/443.
- **Database/Auth/Storage:** Supabase (Postgres), project ref `ychnlroczjhwimouecxz`.
- **Payments:** Stripe (LIVE).
- **Email:** Resend + Brevo. **SMS:** Twilio. **E-sign:** SignWell. **AI:** Anthropic.
- **Tests:** Jest (`npm test` in `services/website`).
- **Edge:** Cloudflare in front of the VPS (origin TLS via Cloudflare Origin cert mounted into nginx).

---

## 3. Where it runs (host, paths, domains, shared proxy)

- **VPS:** Hetzner, `5.161.88.134` · SSH alias `hampton-vps` (user `root`, key `~/.ssh/id_ed25519_headless`).
- **Repo on box:** `/opt/hosthampton` (tracks `main`).
- **Git remote on box:** uses an SSH **deploy key** (read-only), `origin = git@github-hosthampton:afintech510/host-hampton-ops.git` via the `github-hosthampton` SSH host alias. No PAT, no token expiry.
- **Domains:**
  - `www.hosthampton.com` — production site (proxied to `website:3002`).
  - `staging.hosthampton.com` — staging (same container, in tracked nginx config).
  - `app.hosthampton.com`, `api.hosthampton.com` — dashboard / API hostnames (served by the same app; their `server` blocks live in the **server-only** nginx config on the box, not in the tracked `nginx/nginx.conf`).

### The shared edge proxy & network (FLEET-CRITICAL)

This repo owns the shared edge for the whole VPS:

- **`hampton_nginx`** (from `docker-compose.yml` service `nginx`) is the only container publishing host ports **80 and 443**. All HTTP(S) traffic for every project on this box enters through it.
- **`hampton_net`** (declared in `docker-compose.yml`, `driver: bridge`) is the shared Docker network. Other projects (e.g. eastern-equip-rentals, maningo, larkin, etc.) attach their containers to `hampton_net` so `hampton_nginx` can `proxy_pass` to them by container name.
- **`nginx/nginx.conf` (tracked) only contains Host Hampton's own `www`/`staging` server blocks.** The `server` blocks and SSL mounts for the *other* domains/projects live on the box in the skip-worktree copy of `nginx.conf` plus `docker-compose.override.yml`. The tracked file is intentionally minimal so pulls never conflict.
- Upstream is defined as `upstream website { server website:3002; }` with Docker's embedded DNS resolver (`127.0.0.11`) so upstreams re-resolve after container restarts.
- TLS certs are mounted read-only from the host: `/etc/ssl/hosthampton:/etc/ssl/hosthampton:ro`, used as `origin.pem` / `origin.key`.

**Rule of thumb:** anything that touches `nginx_*`, ports 80/443, `hampton_net`, or the `nginx` service is a fleet-wide change — it can take down *every* site on the box, not just Host Hampton.

---

## 4. Run locally

The app lives in `services/website`.

```bash
cd services/website
npm ci
npm run dev          # next dev on http://localhost:3002
npm run build        # production build (output: standalone)
npm test             # jest
npm run lint
```

You need a local `.env` (gitignored) with the same var **names** the container uses (see §8). At minimum Supabase + Stripe vars for most flows. Without secrets, pages render but payment/email/SMS/Supabase calls fail. There is no committed `.env.example` checked in (the gitignore allows `.env.example.template`, but none is present).

---

## 5. Deploy

### Standard (from your laptop — needs SSH access to `hampton-vps`)

```bash
bash scripts/deploy.sh            # rebuilds the 'website' service (default)
bash scripts/deploy.sh website    # same, explicit
bash scripts/deploy.sh <service>  # rebuild a specific compose service
```

`scripts/deploy.sh` SSHes to `hampton-vps`, then on the box runs:
1. `cd /opt/hosthampton`
2. `git pull --ff-only` (via the read-only SSH deploy key)
3. `docker compose up -d --build "${SERVICE}"`
4. `docker compose ps` (status)

Then back on your laptop it smoke-tests `https://www.hosthampton.com/` and prints the HTTP code.

### Manual fallback

```bash
ssh hampton-vps
cd /opt/hosthampton
git pull --ff-only
docker compose up -d --build website     # rebuild + recreate; nginx stays up
docker compose ps
curl -s -o /dev/null -w "%{http_code}\n" https://www.hosthampton.com/
```

### Deploy rules

- **Always rebuild with `docker compose up -d --build`. Never use `docker compose restart`** — `restart` does **not** pick up `.env` changes or newly built images.
- `NEXT_PUBLIC_*` vars are **build-time** `build.args` (e.g. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GADS_ID`) — they only take effect on `--build`.
- Default deploy targets only the `website` service, so `hampton_nginx` is left running. If you must rebuild nginx, understand it affects the whole fleet (see §3).
- Apply DB migrations **before** deploying code that depends on them (see §7).

### Rollback

```bash
ssh hampton-vps 'cd /opt/hosthampton && git log --oneline -5'
ssh hampton-vps 'cd /opt/hosthampton && git checkout <good_sha> -- . && docker compose up -d --build website'
# or: revert the merge commit on GitHub, then re-run scripts/deploy.sh
```

---

## 6. Database

- **Supabase project ref:** `ychnlroczjhwimouecxz` (DB host `db.ychnlroczjhwimouecxz.supabase.co`, storage host `ychnlroczjhwimouecxz.supabase.co` — the latter is whitelisted in `next.config.js` `images.domains`).
- **Base schema + addendum** live in `starting_plan/`:
  - `HostHampton_Supabase_Schema.sql` (core tables, enums, triggers, RLS, seed data)
  - `HostHampton_Supabase_Schema_Addendum_v1.2.sql`
- **Apply base + addendum** with `scripts/db_setup.sh`:
  ```bash
  export DATABASE_URL='postgres://postgres:[password]@db.ychnlroczjhwimouecxz.supabase.co:5432/postgres'
  # or: export SUPABASE_DB_HOST=... SUPABASE_DB_PASSWORD=...
  ./scripts/db_setup.sh
  ```
  It validates `DATABASE_URL`/`psql`, tests the connection, then runs the base schema and addendum each in a single transaction (`ON_ERROR_STOP=1`). Re-runnable (uses `IF NOT EXISTS`).
- **Incremental migrations:** `starting_plan/migration_*.sql` (e.g. `migration_004_website_booking.sql` … `migration_017_studio_rental.sql`). Per DEPLOY.md these are applied **manually via the Supabase MCP / SQL editor, independently of the container deploy** — `db_setup.sh` runs only base + addendum, not the numbered migrations. Apply the migration first, then deploy dependent code.
- **Verify:** `./scripts/db_verify.sh`.

---

## 7. Environment & secrets

- **Runtime secrets live in `/opt/hosthampton/.env` on the box (gitignored).** `docker-compose.yml` maps them into the `website` container's `environment:`.
- **Build-time public vars** (`NEXT_PUBLIC_*`) are passed as `build.args` and baked at build time.
- **Server-only Compose overrides** (per-host nginx SSL volume mounts, including the other fleet domains) live in **`/opt/hosthampton/docker-compose.override.yml`** (gitignored; Compose auto-merges it). Edit that file on the box when changing per-host mounts.
- When adding a var: add it to `docker-compose.yml` (`environment:` for runtime, `build.args` for `NEXT_PUBLIC_*`) **and** to `/opt/hosthampton/.env`, then `docker compose up -d --build website`.

**Variable NAMES only (never print values):**

Build args: `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GADS_ID`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

Runtime env (`website`):
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`,
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`, `GOOGLE_CALENDAR_ID`,
`RESEND_API_KEY`, `RESEND_FROM_EMAIL`,
`ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (optional), `CRON_SECRET`,
`BREVO_API_KEY`, `BREVO_DEFAULT_LIST_ID`, `BREVO_SENDER_EMAIL`,
`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`,
`ANTHROPIC_API_KEY`, `PORTAL_LINK_SIGNING_SECRET`,
`SMS_PROVIDER`, `QUO_API_KEY`, `QUO_PHONE_NUMBER`, `QUO_USER_ID`, `QUO_WEBHOOK_SECRET`,
`OWNER_NOTIFY_EMAIL`, `REVIEWER_PHONES`,
`AGENT_ENABLED`, `AGENT_DRAFT_MODEL`, `AGENT_TRIAGE_MODEL`, `AGENT_DAILY_USD_CAP`, `REVIEW_LINK_SIGNING_SECRET`,
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_USER`, `GMAIL_HANDLED_LABEL`,
`VENMO_HANDLE`, `ZELLE_PHONE`,
`SIGNWELL_API_KEY`, `SIGNWELL_TEMPLATE_ID`, `SIGNWELL_TEST_MODE`, `SIGNWELL_SIGNER_PLACEHOLDER`,
`SIGNWELL_WEBHOOK_ID`

`db_setup.sh` additionally reads: `DATABASE_URL` (or `SUPABASE_DB_HOST` / `SUPABASE_DB_PASSWORD` / `SUPABASE_DB_PORT` / `SUPABASE_DB_NAME` / `SUPABASE_DB_USER`).

**`SIGNWELL_WEBHOOK_ID`** (link 15) is the HMAC key for webhook verification: the
`id` returned by `POST https://www.signwell.com/api/v1/hooks`, with which SignWell
signs `"${event.type}@${event.time}"`. **Without it the SignWell webhooks fail
closed with 503, by design** — an unverified event marks a liability waiver
signed, so "not configured" must never be a bypass (this is deliberately unlike
`QUO_WEBHOOK_SECRET`, which skips verification when unset). `GET /hooks` lists
what is really registered; it returned `[]` until 2026-09-12, which is why zero of
61 bookings had a recorded signature. **Rotating it means deleting the hook and
creating a new one** — the id and the hook are the same object.

**Mapped in `docker-compose.yml` but NOT set in `/opt/hosthampton/.env`:**
`SIGNWELL_CHECKIN_TEMPLATE_ID` and `SIGNWELL_CONSENT_TEMPLATE_ID`. Both need a
template built in the SignWell dashboard. Until they are set, the pre-arrival
check-in waiver reports `{unavailable:true}` and `/api/admin/marketing/consent`
answers 503 — both needs-Adam, both live and tested otherwise.

> Never commit `.env`, `*.pem`, `*.key`, or SSH keys — all are gitignored. `SIGNWELL_TEST_MODE=false` means live e-sign.

**Booking agent env (see `docs/booking-agent-plan.md`):**

| Var | Meaning |
|---|---|
| `AGENT_ENABLED` | Kill switch for `/api/cron/agent-dispatch`. `false`/unset = the agent claims nothing, spends nothing, sends nothing. Inbound events are still recorded. |
| `AGENT_DRAFT_MODEL` | Claude model for customer-facing drafts. Default `claude-sonnet-5`. |
| `AGENT_TRIAGE_MODEL` | Model for Phase-3 email triage. Default Haiku 4.5. |
| `AGENT_DAILY_USD_CAP` | Hard daily ceiling (USD) on agent LLM spend. Default 5. On hit, the dispatcher stops and texts `REVIEWER_PHONES` once per day. |
| `REVIEWER_PHONES` | Comma-separated E.164 list that receives draft-review SMS. Empty = no SMS. |
| `OWNER_NOTIFY_EMAIL` | Where owner notification emails go. Default `hosthampton295@gmail.com`. |
| `REVIEW_LINK_SIGNING_SECRET` | HMAC secret for `/review/<token>` draft previews. Falls back to `PORTAL_LINK_SIGNING_SECRET`. |
| `ADMIN_PASSWORD` | Unchanged and still a full admin login, forever — it is the lockout guard for the per-user login below. Sent as `authorization: Bearer $ADMIN_PASSWORD`. **Cron routes use `x-cron-secret`, not Bearer.** |
| `ADMIN_SESSION_SECRET` | **Optional.** HMAC secret for the `hh_admin` per-user admin session cookie (migration 038, plan §18). Falls back to `PORTAL_LINK_SIGNING_SECRET`, so it does not need to be set — it exists so admin sessions can be revoked independently. **Rotating it signs every admin out immediately**, which is the only instant revocation there is: the cookie carries its own 7-day expiry and is verified without a DB read, so deactivating a row in `admin_users` stops the next login rather than a live session. |
| `REMINDER_MAX_LATENESS_HOURS` | **Optional, default 48.** How late a `scheduled_reminders` row may be and still be SENT. Past it, `/api/cron/send-reminders` CANCELS the row with the reason on `last_outcome` instead of delivering it. 48 hours because every reminder type is date-anchored — the bodies say "tomorrow", "today", "in 7 days" — and this route is not scheduled while `event-reminders`, which fills its queue, can be. Two days of that and the queue holds false statements rather than late ones. `lib/scheduleFreshness.ts`; an unusable value falls back to the default and says so, never to "no bound". |
| `SEQUENCE_MAX_LATENESS_DAYS` | **Optional, default 14.** How late a sequence step may be and still be sent. Past it, `/api/cron/process-sequences` PAUSES the enrollment and names it in the run summary **with the SQL to resume it**. 14 rather than 48 hours because sequence steps are relationship-anchored ("still thinking about your event?") and survive being a few days late in a way a date-anchored reminder does not. Same file, same fallback behaviour. |
| `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` / `GMAIL_REFRESH_TOKEN` | Phase-3 Gmail ingestion (`lib/gmail.ts`, `/api/cron/gmail-sync`). A **separate OAuth grant** from `GOOGLE_*`, scoped `gmail.readonly` + `gmail.modify` only. Unset is supported: the route reports `configured:false` and does nothing. |
| `GMAIL_USER` | Mailbox to ingest. Default `hosthampton295@gmail.com`. |
| `GMAIL_HANDLED_LABEL` | Gmail label applied by the **dispatcher** once a message has actually produced a draft. Default `HH-Agent/Handled`. |
| `GMAIL_SEEN_LABEL` | Gmail label applied by **ingestion** to every message it reads, including auto-ignored newsletters. Default `HH-Agent/Seen`. The two are separate because "the agent read this" and "the agent acted on this" are different claims, and one label on everything made a mailbox of Abercrombie promos look handled. |

The agent never sends to a customer without an explicit human approval, never
sends customer email through Gmail (Resend for email, Quo for SMS), and its
migrations (028, 032, 033, 034, 035) must be applied by hand before `AGENT_ENABLED`
is turned on. Migration **036 is the pricing catalog seed** (Phase 4 item 4) and is
data, not schema: without it `lib/pricingCatalog.ts` falls back to its compiled
constants, which are the same prices, so the site renders correctly either way.
The next free migration number is **047**. **Link 17 took none** — the
contact-identity repair is entirely code, deliberately: the fix for eight
duplicated people is the LOOKUP, and a functional unique index on `lower(email)`
cannot be created until those eight are merged (needs-Adam 31), because they
would collide on it. **046 was taken by link 16** — the
webhook money-idempotency migration: `uniq_event_ticket_per_session_line`
(`NULLS NOT DISTINCT`, so a redelivery of a single-event ticket really does
collide), `uniq_bookings_stripe_session`, the **`nextval_event_ticket_seq()`
function five call sites had been calling for months without it existing** (with
`event_ticket_seq` set to 10000 so new refs cannot collide with the legacy
four-digit space), `decrement_event_tickets` / `decrement_session_tickets`
returning the new count instead of `void` so an oversell can be reported, and
`redeem_gift_card` — one atomic `SELECT … FOR UPDATE` replacing four copies of a
read-modify-write. The thing 046 was *previously* wanted for is still unclaimed
and is now **047's** job: `docs/phase-5-memory-learning.md` §11.13, moving the
memory-promotion back-reference off `agent_memory` (where writing it fires the
unconditional `trg_memory_updated_at` and erases the evidence those rows are
dead) and onto `agent_learnings.source_memory_id`. (037 plan content, 038 + 039 per-user
admin login, 040 payment idempotency, 041 the learning loop, 042 typed
`draft_feedback`, **043 Phase 4 campaign automation** — `email_sequence_sends`
plus the columns and slot index that extend the pre-existing `social_posts`;
**044 the reminder-queue repair** — `scheduled_reminders.reference_id` widened
from `uuid` to `text`, the `reference_type` CHECK corrected to `('event',
'booking')`, a `'sending'` claim status, `attempts` / `last_outcome` /
`last_error` / `claimed_at`, and **one** unique index
`uniq_scheduled_reminder_once (contact_id, reminder_type, reference_id) WHERE
status <> 'cancelled'` replacing the two partial ones; **045 Phase 5 — A/B
content testing**: `content_experiments` (`status` DEFAULT `'draft'`,
`min_per_arm`/`alpha` as columns), `content_variants`, `variant_assignments`
with `UNIQUE (experiment_id, contact_id)`, `variant_events` with
`UNIQUE (assignment_id, event_type)`, `unattributed_signals`, plus
`agent_memory.promoted_learning_id` and a `COMMENT ON TABLE agent_memory`
recording that it is retired — a COMMENT rather than a column UPDATE, because
`trg_memory_updated_at` fires unconditionally and would have stamped today onto
the `updated_at` that proves those rows are dead.)
Phase 4's **review** (link 9, 2026-09-12) took no migration.

**No new environment variable was added for Phase 5** either. The tracked-link
tokens reuse `PORTAL_LINK_SIGNING_SECRET` and variant generation reuses
`ANTHROPIC_API_KEY` / the optional `MARKETING_DRAFT_MODEL`. Note that rotating
`PORTAL_LINK_SIGNING_SECRET` now invalidates outstanding **tracked links** as
well as unsubscribe links — a dead tracked link is only a lost data point (the
route 302s to the homepage), but the unsubscribe reason still stands: don't.

**No new environment variable was added for Phase 4.** The unsubscribe tokens
reuse `PORTAL_LINK_SIGNING_SECRET`; the social calendar reuses
`ANTHROPIC_API_KEY` and the optional `MARKETING_DRAFT_MODEL`. **Rotating
`PORTAL_LINK_SIGNING_SECRET` now also invalidates every outstanding unsubscribe
link**, which is a link that must keep working for years — so don't.

**Never re-consent `GOOGLE_REFRESH_TOKEN` for Gmail.** That grant is
calendar-only and powers live availability on the booking pages; re-running
consent on it for a different scope set invalidates the calendar access. Gmail
has its own client and its own token, minted by `scripts/gmail_consent.mjs`,
which refuses to print a token unless the mailbox matches `GMAIL_USER`. The
Gmail grant has no send scope, so it is structurally incapable of emailing a
customer — that is the guardrail, not a policy.

**`STRIPE_WEBHOOK_SECRET` and the endpoint it belongs to.** The live endpoint is
`we_1T7ckv02uXWznKaWMiPeXCCf` → `https://www.hosthampton.com/api/webhook`,
created 2026-03-05. **Until 2026-09-12 it was subscribed to
`checkout.session.completed` and nothing else**, so `payment_intent.succeeded`
— the entire in-page Payment Element path, i.e. every party-planner payment and
every studio-rental deposit — had never been delivered, and neither had
`checkout.session.async_payment_succeeded`. It now carries all four event types
the handler has branches for. **Check the subscription, not just the code**, with
`GET /v1/webhook_endpoints`; a handler with no matching subscription is
indistinguishable from a handler that is merely never triggered
(`docs/stripe-webhook-branches-review.md` §1). **Never RECREATE that endpoint to
change its events — UPDATE it** (`POST /v1/webhook_endpoints/{id}`): recreating
rotates the signing secret and every delivery 400s until
`/opt/hosthampton/.env` catches up.

`QUO_WEBHOOK_SECRET` became security-relevant in Phase 2: `/api/webhooks/quo`
now **fails closed** (401 on a bad or missing signature) because an inbound SMS
can approve a draft and trigger a customer-facing send. Leaving the var unset
disables verification entirely.

The live subscription is Quo webhook `WHc7b78b376fd743ab9bfc10365f5d241f` on
phone `PNYQcWcAEd` (+1 631-998-9325), event `message.received`, pointing at
`https://www.hosthampton.com/api/webhooks/quo`. Its signing key IS
`QUO_WEBHOOK_SECRET` on the box. **If that webhook is ever deleted and recreated
in Quo, the new key must be copied to the box or every inbound SMS starts
401ing** — including customer STOP requests. List it with
`curl -s https://api.quo.com/v1/webhooks -H "Authorization: $QUO_API_KEY"` (raw
key, no `Bearer`).

"Nothing reaches a customer without a human" is enforced structurally, not by
convention: `inquiry_draft` is an entity in `lib/marketing/graph.ts` whose
`approved` and `sent` transitions are GATED, so they require an actor flagged
`isAdmin` — which only an authenticated admin request or a sender verified
against `REVIEWER_PHONES` ever gets.

---

## 8. Cron / scheduled jobs

There is **no in-container scheduler**. Scheduled work is driven externally by **cron-job.org**, which hits the app's cron API routes.

**Authorization is `lib/cronAuth.ts` and nothing else.** One `isCronAuthorized(req)`, accepting the `x-cron-secret` header **or** `?secret=`, matching `CRON_SECRET`, and **failing closed when `CRON_SECRET` is unset**. It was declared fourteen times before 2026-09-13 — once per route file, in two spellings, seven of them missing that guard while the other seven had it and `agent-distill`'s own comment explained it four files away. Measured rather than assumed: the guardless form was **not** bypassable, because `Headers.get()` and `URLSearchParams.get()` return `null` and `null === undefined` is false — it was one refactor away, on routes that lock bookings and text customers. `cronSurface.test.ts` R1/R2 fail the suite if a route declares its own, skips the gate, or compares against `process.env.CRON_SECRET` outside that file.

**Two bounds every operator needs to know, `lib/scheduleFreshness.ts`.** Neither sender used to ask how LATE a message was; `now >= due` was the only question. `REMINDER_MAX_LATENESS_HOURS` (48) cancels a date-anchored reminder that is older than that, with the reason on `last_outcome`. `SEQUENCE_MAX_LATENESS_DAYS` (14) pauses a sequence enrollment whose next step is older than that and prints the SQL to resume it. See §7 and `docs/cron-scheduling-review.md` §3.

### What is actually scheduled (measured 2026-09-13 from `docker logs hampton_nginx`, by path AND status — the fleet shares that proxy, so a bare path count is another business's traffic)

| job | schedule | state |
|---|---|---|
| `/api/cron/agent-dispatch` | every 2 min | **working**, 200 × 1555 in the window |
| `/api/cron/gmail-sync` | every 3 min | **working**, 200 × 995 |
| `/api/cron/booking-locks` | daily 04:00 UTC | **401 on every run**, stale secret — needs-Adam 35 |
| `/api/cron/draft-newsletter` | daily 11:00 UTC | **401 on every run**, stale secret — needs-Adam 35 |
| everything else | — | **not scheduled at all** |

**Nothing monitors a cron's status.** A job that has failed every day for months looks exactly like a job that works. If you are asked whether a job runs, ask nginx by path *and* status, and then ask the table that would hold its output.

### The fourteen routes

- `/api/cron/send-reminders` — booking/event reminder emails + SMS. **The only deliverer**: it claims each row (`pending`→`sending`) before sending, checks the freshness bound, re-reads consent at send time, and records a named outcome on every path. `?limit=N` (1…50, out of range is a 400) bounds a manual run to the N longest-waiting rows. **Not scheduled** — `docs/reminder-engine-review.md` §10.
- `/api/cron/process-sequences` — email sequence processing. **Not scheduled, and must not be rescheduled blind**: its cron-job.org job disappeared 2026-08-16 and **45 enrollments are frozen**. **`?limit=N` caps SENDS; `?scan=N` caps rows READ.** They are different questions and conflating them is what made the old drain a no-op — `?limit=` used to set the row cap, and the two oldest enrollments are on an inactive sequence, so `?limit=1` read one row, skipped it, changed nothing and answered 200 for anyone draining a six-month backlog one person at a time. `?scan=` exists so a production probe can be *proved* safe: give a throwaway enrollment an `enrolled_at` that sorts first, read the top of the scan, then fire with a `scan` no larger than the number of throwaway rows. Out-of-range is a 400 on both.
- `/api/cron/event-reminders` — nightly sweep for tomorrow's ticketed events. **ENQUEUES into `scheduled_reminders`; it does not send**, so it depends on `send-reminders` also being scheduled. Not scheduled.
- `/api/cron/birthday-rebooking` — scans bookings 8–10 months past and enqueues a pre-approved nudge. Marketing: opt-in checked at enqueue **and again at send**. Has run once, ever (2026-08-17), and found nothing. Not scheduled.
- `/api/cron/send-campaigns` — sends campaigns an admin has scheduled. **Blast radius 944 real people per campaign.** Capped at **5 per tick** (`?limit=1..5`), because it used to claim every due row in one statement and `scheduled_campaigns` holds **102 stale `event_update` drafts** about a July event, one bulk status change away from being claimable. Not scheduled.
- `/api/cron/draft-newsletter` — newsletter drafting. Scheduled and 401ing. **Its throttle is permanently engaged**: it skips whenever an unread `event_update` draft exists and there are 102, so fixing the secret buys an archive sweep and nothing else until the pile is cleared (needs-Adam 37).
- `/api/cron/booking-locks` — moves `approved` → `modifications_locked` past the T-14 cutoff. Scheduled and 401ing; **seven bookings are past their cutoff**. It claims conditionally and reads back, uses `logBookingChange`, and skips parties that have already happened. Note **nothing in the app enforces `modifications_locked`** — it is a label in the Parties tab and the customer portal.
- `/api/cron/experiment-report` — INTEL's weekly A/B read (migration 045). Concludes nothing and changes no copy. A failed read is a **503** so cron-job.org shows red — but only when **every** experiment failed; a partial failure stays 200 and names them in `failures[]`. Not scheduled (needs-Adam 20); suggested weekly, Monday ~08:00.
- `/api/cron/agent-distill` — the weekly learning distill. Behind `AGENT_ENABLED`; proposes, activates nothing. Not scheduled (needs-Adam 1); suggested Monday 7am.
- `/api/cron/weekly-town-drafts` — 2 towns per run, lands at `pending_review`, no-op once all 11 have a draft. Not scheduled (needs-Adam 6).
- `/api/cron/social-calendar` — weekly social drafts. Drafts only; `approved`/`published` are gated edges. Self-throttling before the model call. Not scheduled.
- `/api/cron/summer-hair-reminders` — a one-day pop-up (2026-07-03) that is over. **`?force=true` overrides the CLOCK only** — it used to drop the `reminder_sent = false` filter as well, so one authenticated GET re-texted all thirteen real customers about a July appointment. Claim before send, STOP honoured, masked payload. Never scheduled; needs-Adam 38 is whether to retire it.
- `/api/cron/agent-dispatch` — booking agent: claims new inbound events, drafts replies, texts the reviewers. Every 2 minutes. No-op unless `AGENT_ENABLED` is true.
- `/api/cron/gmail-sync` — pulls new mail from `GMAIL_USER` into `ingested_messages` and applies the handled label. Every 3 minutes. No-op unless the `GMAIL_*` env is set. Read + label only. `?backfill=1&pageToken=…` runs the bounded historical pull by hand.

Example trigger:
```bash
curl -s "https://www.hosthampton.com/api/cron/send-reminders" -H "x-cron-secret: $CRON_SECRET"
```

If reminders/campaigns stop firing, check the cron-job.org schedule **and that the configured secret still matches `CRON_SECRET` in `.env`** — two jobs have been failing that check daily.

---

## 9. Day-to-day cheat sheet

```bash
# Connect
ssh hampton-vps                                # root@5.161.88.134, key id_ed25519_headless

# What's running
ssh hampton-vps 'cd /opt/hosthampton && docker compose ps'

# Logs (website)
ssh hampton-vps 'docker logs -f --tail=200 hampton_website'
# Logs (shared proxy — FLEET)
ssh hampton-vps 'docker logs -f --tail=200 hampton_nginx'

# Deploy
bash scripts/deploy.sh                          # rebuild + recreate website

# Health
curl -s -o /dev/null -w "%{http_code}\n" https://www.hosthampton.com/      # expect 200
ssh hampton-vps 'cd /opt/hosthampton && docker compose -f docker-compose.yml ps'   # all Up
ssh hampton-vps 'docker exec hampton_website sh -c "echo \$SIGNWELL_TEMPLATE_ID"'  # env present

# Rollback
ssh hampton-vps 'cd /opt/hosthampton && git log --oneline -5'
ssh hampton-vps 'cd /opt/hosthampton && git checkout <good_sha> -- . && docker compose up -d --build website'

# Reload proxy config after editing nginx.conf ON THE BOX (it is skip-worktree)
ssh hampton-vps 'docker exec hampton_nginx nginx -t && docker exec hampton_nginx nginx -s reload'
```

---

## 10. Key files

- `DEPLOY.md` — authoritative deploy runbook (deploy key, override.yml, manual deploy, rollback, infra setup).
- `docker-compose.yml` — services (`nginx`, `website`; agent stack commented out), `hampton_net` network, env wiring.
- `docker-compose.override.yml` — **on the box only**, gitignored; per-host nginx SSL mounts incl. other fleet domains.
- `nginx/nginx.conf` — tracked proxy config (www/staging only); **skip-worktree on the box** (box owns the real one).
- `scripts/deploy.sh` — laptop → VPS deploy (pull → `up -d --build` → ps → smoke test).
- `scripts/db_setup.sh` — apply base schema + addendum to Supabase.
- `scripts/db_verify.sh` — schema verification.
- `scripts/signwell-check.mjs` — SignWell integration check.
- `starting_plan/HostHampton_Supabase_Schema.sql`, `..._Addendum_v1.2.sql` — schema applied by `db_setup.sh`.
- `starting_plan/migration_*.sql` — incremental migrations (apply manually via Supabase SQL editor).
- `services/website/` — the Next.js app (`src/app`, `src/lib`, `Dockerfile`, `next.config.js`, `package.json`, `TESTING.md`).
- `SESSION_LOG.md`, `PLAN.md` — running history / planning notes.

---

## 11. Gotchas & operational rules

- **This box hosts the whole fleet.** `hampton_nginx` (ports 80/443) and `hampton_net` are shared infra. Do not rename/remove the `nginx` service, change its published ports, or delete/rename `hampton_net` — you would break every other site (eastern-equip-rentals, maningo, larkin, etc.) attached to it. Treat proxy/network edits as fleet-wide.
- **`nginx/nginx.conf` is `git update-index --skip-worktree` on the box.** The box's real config (with the other projects' server blocks + `app`/`api` blocks) differs from the tracked minimal file. Edit the live config **on the box** and reload with `nginx -t && nginx -s reload`. To hand control back to git: `git update-index --no-skip-worktree nginx/nginx.conf`.
- **Server-only SSL mounts live in `docker-compose.override.yml` on the box** (gitignored, auto-merged by Compose). Edit there for per-host volume mounts; don't add them to the tracked `docker-compose.yml`.
- **Never trust the request for the site's own origin. Use `publicOrigin(req)` (`lib/publicOrigin.ts`).** nginx's HTTPS `default_server` answers **444** for a hostname that is not one of its `server_name`s, so `Host` cannot be forged past the edge — but **nginx never SETS `X-Forwarded-Host`** (it sets `Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto` and nothing else), so that header reaches the container exactly as the caller typed it. Twenty-two routes preferred it over `Host` until 2026-09-12, which made it decide the links in the owner's own notification emails, a link mailed to a customer, every redirect out of three portal routes, and **Stripe's `success_url`/`cancel_url` in five checkout routes**. Measured, not reasoned about: `curl -H 'X-Forwarded-Host: evil.example.com' https://www.hosthampton.com/api/portal/auth` moved the 307 to that host. `docs/outbound-template-escaping.md` §3. A test fails the suite if any file outside `lib/publicOrigin.ts` reads `x-forwarded-host` or `NEXT_PUBLIC_SITE_URL`.
- **An email address is never a filter. Use `lib/contactLookup.ts`.**
  `contacts.email` and `bookings.contact_email` are plain `text` holding
  whatever the customer typed — 21 of 1217 contacts and **9 of 61 bookings** are
  not lowercase — so `.eq()` is case-sensitive and misses them. And `.ilike()`
  is a LIKE **pattern**: `%` is a wildcard run, `_` is any single character.
  `/api/portal/my-bookings` used `.ilike('contact_email', cookieEmail)` as its
  **authorization filter**, and a signed session cookie whose email was the
  single character `%` returned **34 bookings — every kids party in the
  database, with the children's names**. Measured live. `findContactsByEmail()`
  and `findBookingsByContactEmail()` use `ilike` to fetch CANDIDATES and then
  re-compare exactly in JS; callers write by `id`, never by the email filter.
  `docs/portal-auth-review.md` §2/§4. `src/__tests__/lib/portalAuthSurface.test.ts`
  fails the suite if any file outside `lib/contactLookup.ts` filters an email
  column, with one documented exemption.
- **A session cookie carries its own expiry, inside the signature.** `hh_admin`
  always did; `hh_portal` and `hh_portal_email` did not until 2026-09-12 — the
  value was `HMAC("cookie:" + ref)`, a constant, so `Max-Age` was a hint to the
  browser and a copy of the value authenticated that booking forever, with no
  revocation short of rotating `PORTAL_LINK_SIGNING_SECRET` (which you must not
  do; see §7). All three now use `<subject>:<issuedAtMs>:<sig>`. **The
  expiry-less form is honoured until a hard-coded sunset of 2026-10-20** so no
  live customer was signed out; after that date it is invalid with no deploy
  needed.
- **A customer-facing route names its columns.** `select('*')` on `bookings`
  hands out 62 columns including `admin_notes`, `quote_snapshot`,
  `portal_token_hash` and the Stripe ids. Use an ALLOW-list, so a column added
  by the next migration is private until somebody decides otherwise —
  `PORTAL_BOOKING_COLUMNS` in `/api/portal/booking`, `publicBookingView` in
  `/api/checkin/[token]`.
- **A failed link and an unknown link answer the same thing.** `/api/portal/auth`
  used to redirect with `error=not_found` for a ref that does not exist and
  `error=expired` for one that does — an unauthenticated, unthrottled oracle
  over a structured ref space. `/review/[token]` was deliberately built the
  other way and that is the rule.
- **The Venmo/Zelle number is not the public line.** `lib/paymentContacts.ts`:
  payments go to **631-599-2469** / `VENMO_HANDLE`; **(631) 998-9325** is the
  business line and finds nothing in Venmo. A phone number as a literal in the
  portal or plan surface fails the suite.
- **A webhook that changes legal or money state verifies, and fails CLOSED when
  unconfigured.** All three SignWell routes verified nothing until 2026-09-12 —
  an anonymous POST carrying `"hash":"totally-made-up-hash"` wrote
  `agreement_signed_at` and was answered `{"received":true}`. `verifySignwellEvent`
  in `lib/signwellWebhook.ts` is the only implementation; a second copy fails the
  suite. `/api/webhooks/quo` skips verification when its secret is unset and that
  is *correct for quo* (its unverified actions are logging and opt-out) — it is
  not a pattern to copy onto a surface that marks a waiver signed.
- **A signature over the envelope is not a signature over the body.** SignWell
  signs only `"${type}@${time}"`, so a valid hash cannot vouch for the document
  id, the status or the metadata — anyone who observes one genuine triple can
  replay it with a body of their choosing. Every write is gated on **re-reading
  the document from the provider's own API**, and `booking_ref`, `release_id` and
  `metadata.type` are taken from that response, never from the POST. Check what
  a provider's signature actually covers before trusting it.
- **A provider field that is always absent reads as "not ready yet".**
  `fetchSignedPdfUrl` read `files[].pdf_url`, a key SignWell returns on no
  document in any state, under a comment saying "returns null if not available
  yet". It returned null 100% of the time, so a recorded signature would have had
  no signed PDF beside it. The endpoint that returns one is
  `/documents/{id}/completed_pdf/?url_only=true`.
- **`.or()` takes a RAW PostgREST filter expression.** Interpolating an
  attacker-supplied value into it lets a `,` or `)` rewrite the filter — the same
  family as `.ilike('%')` as an authorization filter. Use sequential `.eq()`
  calls, which are parameter-encoded. `signwellSurface.test.ts` R6 fails the
  suite on a template literal passed to `.or()`.
- **`checkout.session.completed` does NOT mean paid.** For a delayed-notification
  method it fires with `payment_status: 'unpaid'` and the payment can still fail;
  `checkout.session.async_payment_succeeded` is what says it settled. Measured on
  the live account: `klarna`, `cashapp` and `amazon_pay` are enabled on about two
  thirds of the Checkout Sessions we create. Every branch gates on
  `sessionSettlement()` in `lib/stripeSettlement.ts`, which **fails closed** — a
  session with no `payment_status` is not settled, because issuing goods for money
  that is not there is the expensive direction.
- **Stripe redelivers, so every issuing branch takes a CLAIM.** The unique indexes
  (migration 040 for payments, 046 for tickets and bookings) stop a duplicate
  INSERT; they do not stop the second confirmation email, the second inventory
  decrement, the second `upsertContact` (which mirrors into Brevo and Quo and
  enrols a sequence) or a second financial row under a freshly generated
  reference. `claimBySessionId` does, with three outcomes — an unreadable table is
  **not** "fresh". And the idempotency marker for the Payment-Element branches is
  the **`financial_transactions` row, not the `booking_payments` row**: that path
  has two writers (the browser's `confirm-session` and the webhook) and only the
  webhook does the side effects, so "my insert was a duplicate" cannot mean "this
  is already done".
- **A handler with no matching webhook SUBSCRIPTION looks exactly like a handler
  that is never triggered.** Link 15 found `GET /hooks` returning `[]` at
  SignWell; link 16 found the Stripe endpoint subscribed to one event type out of
  four. Before concluding a branch is dead code, ask the provider what it is
  configured to send. `docs/stripe-webhook-branches-review.md` §1.
- **A ticket reference comes from `event_ticket_seq`, never from the clock.**
  `HH-EVT-${Date.now().toString().slice(-4)}` is a ten-second-wide space against
  `event_tickets_ticket_ref_key`, and in `cart_checkout` it was computed inside a
  tight loop so two lines for one event always collided. Use `nextTicketRef()`.
  Refs are five digits from 10000 up; the legacy four-digit space tops out at 9932.
- **Gift-card redemption is `redeem_gift_card` (migration 046) and nothing else.**
  It existed four times as a read-modify-write with both errors discarded — one of
  which issued the ticket *before* deducting the balance, so a race gave a whole
  ticket away — and all four wrote `redeemed_at: newBal === 0 ? now : null`, which
  CLEARS the timestamp on a card that was already spent.
- **Escaping vs URL-screening in mail bodies.** Text into an element body gets `escapeHtml`; a URL in an `href`/`src` gets a URL SCREEN (`mailHref` / `mailHrefExternal` in `lib/emailSafety.ts`) and *then* attribute encoding. `escapeHtml` alone on an href leaves `javascript:` working while looking screened, and an HTML-escaped URL handed to a URL parser is silently corrupted rather than refused. A number you computed and a nested template you built get neither. The plain-text half of an email must never be escaped. `src/__tests__/lib/emailTemplateEscaping.test.ts` enforces all of it off disk.
- **A unique index on a raw text value makes `upsert(onConflict: …)` a
  CASE-SENSITIVE WRITE.** `contacts_email_key` is `UNIQUE (email)` on the raw
  value and there is no functional index on `lower(email)`, so
  `upsert(record, { onConflict: 'email' })` did not conflict with a row spelled
  differently and INSERTED a second one. **Eight real people had two `contacts`
  rows each.** Link 9 had already made the READ in front of it case-insensitive,
  which made this harder to see, not easier: `found` and a brand-new row in the
  same call. `upsertContact` is now a lookup followed by an UPDATE BY ID or an
  INSERT, with 23505 handled as "another writer got there first". The stored
  spelling is never rewritten — lowercasing the 21 mixed-case rows would collide
  for eight of them. `docs/contact-identity-review.md` §2.
- **"Which row is this person" has ONE answer: the oldest.**
  `findContactsByEmail` returns rows oldest-first and names a `primary`. Five
  callers used to take `contacts[0]` off an *unordered* PostgREST read, which is
  whichever row is earlier in the heap — measured live, that is the lowercase
  row for one duplicated person and the MIXED-case row for another, so two
  callers could disagree about who somebody is in one request. It is a
  tie-break, not a merge; merging the eight pairs repoints eighteen foreign keys
  and is needs-Adam 31.
- **A phone number is normalised before it is compared, never matched raw.**
  `contacts.phone` holds `6314008080`, `+16314008080`, `631-400-8080`,
  `16318338149` and `(631) 400-8080` for the same numbers, and **21 normalised
  numbers carry more than one contact row**. Use `findContactsByPhone` /
  `normalizePhoneKey` in `lib/contactLookup.ts`. **An inbound STOP is a
  statement about the NUMBER, so it reaches EVERY row holding it** —
  `recordSmsOptOut` in `lib/smsOptOut.ts`, used by both SMS webhooks. Both used
  to build a raw `.or()` of three guessed spellings and read it through
  `.single()`, which **errors when more than one row matches**: the error was
  discarded, the STOP was dropped, and the Quo route then created a third row
  for a texter it already knew.
- **Brevo's `PUT /v3/contacts/{identifier}` is UPDATE-ONLY.** It answers
  `404 document_not_found` for an address Brevo does not already hold —
  measured, against a comment claiming "upsert semantics". The mirror therefore
  never created a single Brevo contact and **253 of our 1209 people are absent
  from the marketing list**. `POST /v3/contacts` with `updateEnabled: true` is
  the real upsert (201 new / 204 repeat). Two other measured facts about that
  API: an attributes-only PUT does **not** clear `emailBlacklisted`, and
  `POST /contacts/lists/{id}/contacts/add` **succeeds on a blacklisted contact
  and leaves the blacklist in place** — so list membership is not a consent
  record and must never be read as one.
- **Quo answers 409 to a duplicate `externalId`, and its list filter is
  `externalIds=`, NOT `externalIds[]=`.** The bracketed OpenPhone idiom is
  IGNORED rather than refused, so it returns an unfiltered page of strangers.
  `findQuoContactByExternalId` uses the working form and re-compares the id
  anyway. A 409 used to be reported as a plain error, so `quo_contact_id` was
  never learned and every later sync for that contact 409'd again forever.
- **`.or()` takes a RAW PostgREST filter expression — build it with
  `lib/postgrestFilter.ts`, never a template literal.** A comma starts a new
  disjunct, `)` closes the group, `%`/`_` are LIKE wildcards inside an `ilike`
  value, and `}` ends an array literal in `cs.{…}`. Four call sites interpolated
  directly, one of them the **public, unauthenticated** `/api/pricing?event_type=`.
  A value that reduces to nothing must match NOTHING, never drop the filter.
  `contactIdentitySurface.test.ts` R4 fails the suite on any template literal
  passed to `.or()`, with no exemptions — an exemption is what let link 13's and
  link 14's tripwires excuse a whole file.
- **"May we market to this person" is `optedOutReason()` and nothing else.** It
  reads `email_opt_in` AND `status = 'unsubscribed'`. There have now been five
  readers of that question; the outward mirror and the Google-Ads/Meta export
  each read `email_opt_in` alone until 2026-09-12. The export also emitted one
  line per ROW, so the eight duplicated people were uploaded to an ad platform
  twice under the same lowercased address.
- **The books have ONE writer: `lib/financialLedger.ts`.** `financial_transactions`
  is what the admin Financials tab reads, so it is what this business believes
  about its own revenue. That writer used to be a `function` declared *inside*
  `src/app/api/webhook/route.ts` — private to the Stripe webhook — which is why
  **$2,256 of hand-entered customer money ($1,608 of it cash, Venmo and Zelle)
  and $312.01 of refunds never appeared in the tab.** `source in ('cash','other')`
  had **zero rows, ever**, though the CHECK has always permitted both and there
  is no trigger: not "never ran", not "could not have run" — the code path did
  not exist. Admin money goes through `lib/adminMoney.ts`
  (`recordAdminPayment` / `recordAdminRefund`); a refund is a NEGATIVE row.
  `adminSurface.test.ts` R4 lists every direct writer and fails if the list
  grows. `docs/admin-surface-review.md` §1.
- **Recording a hand-entered payment checks the books first.** Four of the twelve
  live admin payments are a human re-typing a Stripe deposit the webhook already
  recorded as `stripe-bk-<booking_ref>`. `findCoveringLedgerRow` declines with
  `already-in-books` rather than double-counting — matched by REFERENCE and exact
  cents, never by amount+date proximity, which on the live table matched two rows
  for two of those four because $99 is the default deposit. A failed coverage
  read does not record: that is the direction that double-counts.
- **A refund CLAIMS before it spends.** Both ticket-refund routes did
  `if (status === 'refunded') return 400` → `stripe.refunds.create(…)` →
  **unchecked** UPDATE, so the guard depended on a write whose failure was
  discarded and a second click issued a second real Stripe refund. `lib/adminRefund.ts`
  takes the claim first (conditional, read back), calls Stripe only for the
  winner, and releases the claim if Stripe declines. Capture the prior status
  BEFORE the claim — reading it back afterwards restores the value the claim just
  wrote. And a ticket's inventory is restored against **`ticket.event_id`**, never
  an id from the URL: the event-scoped route used `params.id` and never checked
  the two agreed, so refunding ticket B through event A's URL gave A a free seat.
- **`adminActorId(req)` everywhere, and migration 047 is what permits it.**
  It returns `admin:<email>` from a signed `hh_admin` cookie or the historical
  **`'ADMIN'`** on the shared password. `booking_payments.recorded_by` and
  `booking_modifications.modified_by` carried CHECKs that refused **both**
  spellings — the capitalised one included — so nine sessions' worth of
  hardcoded `'admin'` could not simply be replaced until 047 relaxed them. Read
  the CHECK before writing an actor.
- **`isAdminAuthorized(req)` is the only admin credential check.** Four routes
  carried a hand-rolled copy — `token !== process.env.ADMIN_PASSWORD` — missing
  the guard the real one spells out in a comment (`if (!expected) return false`),
  so an unset `ADMIN_PASSWORD` makes `undefined !== undefined` false and **the
  check passes**, on a route that mints Stripe Payment Links. The copies also
  **reject the `hh_admin` session cookie**, so an admin signed in per-person
  could not use those tools at all — measured in production: `cookie` went
  401 → 200 on all four after the fix while an unauthenticated call stayed 401.
- **A portal link is minted through `lib/portalLinkMint.ts` or it is not mailed.**
  Seven copies wrote the `portal_tokens` row with the error discarded and sent the
  email regardless; `parties/create` read the error, logged it *"non-fatal"* and
  mailed the link anyway. A token row that was refused means the URL in that
  email cannot work — non-fatal to the booking, fatal to the email.
- **`recalcTotals` must never write a total it could not read.** It discarded both
  read errors, so a failed `booking_line_items` read left the loop with nothing to
  add and it **wrote `total_cents: 0` over a real customer's invoice**, then
  answered `{ok:true}`. Link 16 found the read-becomes-a-balance shape on four
  webhook branches; this is the same defect with an overwrite behind it. One
  balance definition now lives in `lib/bookingBalance.ts`, shared with the webhook,
  and `computeBalance` refuses to call an **unpriced** booking paid in full —
  `(null || 0) - paid` clamps to 0, which marked every lead `paid_in_full` on its
  first deposit.
- **A rule that greps a file can be satisfied by a different occurrence than the
  one that broke.** Link 16 named this family; it cost three of link 18's
  twenty-six attack mutations. A migration with two `ADD CONSTRAINT` blocks, and a
  function with two error guards, each kept their rule green when one of the pair
  was deleted. Scope every source-reading rule to the specific site — slice the
  block, brace-match the guard — and never ask "does this file contain X".
- **An attack harness must refuse to run on a red tree.** Link 17's returned
  false for every input and reported all 34 mutations "caught". Link 18's refused
  once for real, because a repair to the tripwire had turned it red — which is
  exactly what that refusal is for. Check the checker first, verify each mutation
  landed on disk (CRLF *and* LF anchors), and restore on every path.
- **`isCronAuthorized(req)` in `lib/cronAuth.ts` is the only scheduler credential check.** It was declared **fourteen times**, once per route file, in two spellings — seven with the fail-closed `if (!expected) return false` and seven without, while `agent-distill`'s own header comment explained why that guard exists four files away from seven copies that lacked it. Measured rather than reasoned about: the guardless form was **not** bypassable, because `Headers.get()` and `URLSearchParams.get()` return `null` and `null === undefined` is false — which is luck, on routes that lock customers' bookings and text customers. Rule 11's sharpest form for the second session running. `cronSurface.test.ts` R1/R2 fail the suite if a route declares its own, skips the gate, or compares against `process.env.CRON_SECRET` anywhere outside that file.
- **A scheduled sender must ask how LATE a message is, not just whether it is due.** `now >= due` was the only question either sender asked, so a step that came due in July was as due as one that came due five minutes ago. Measured on the live table: the first tick of `process-sequences` after its six-month gap sends ~34 emails at once, including *"Get ready for party day at Host Hampton!"* to people whose party was three weeks ago and *"Still thinking about your event?"* to **thirteen people who have already booked and paid**. `lib/scheduleFreshness.ts` holds both bounds — 48 hours for date-anchored reminders (cancelled, reason on the row), 14 days for relationship-anchored sequence steps (enrollment paused, named in the summary **with the SQL to resume it**). Neither deletes anything; both turn an invisible standing hazard into a visible decision. An unusable env override falls back to the default and says so, never to "no bound".
- **A cap on rows READ is not a cap on anything an operator cares about.** `?limit=` on `process-sequences` set the batch size, and PLAN.md and AGENTS.md both described `?limit=1` as *"the drain: one real person per tick"* for 45 frozen enrollments. The two oldest of those enrollments are on a sequence whose `is_active` is false, so they are skipped and stay `active` at the top of the oldest-first scan forever: `?limit=1` read one row, changed nothing, and answered `200 {"scanned":1,"sent":0,"notes":[]}` — indistinguishable from "nothing was due", run after run. `?limit=` now caps **sends**; `?scan=` caps **rows**, and exists so a production probe can be *proved* safe before it is fired.
- **The probe recipe changed: a sentinel date of `2000-01-01` is no longer "due", it is CANCELLED.** Eighteen `sendReminders` tests turned red on the freshness bound for exactly that reason. To drive `send-reminders` in production, date the throwaway row minutes in the past and prove the scan holds zero real rows (it holds zero rows at all today). To drive `process-sequences`, the throwaway enrollment needs an `enrolled_at` in 2000 **and** a step with `delay_reference = 'event_date'` plus `metadata.event_date = yesterday` — that is the only way to have a row that both sorts first and is inside the bound.
- **Ask nginx by path AND status, and remember the proxy is shared.** `docker logs hampton_nginx | grep /api/cron/` counts other businesses' jobs on the same box. Filtered properly, **`booking-locks` and `draft-newsletter` have a cron-job.org job each and have answered 401 on every run in the whole ten-day window** — a stale `CRON_SECRET`. **Nothing in this system monitors a cron's status**, so a job failing daily for months looks exactly like a job that works.
- **`modifications_locked` is a label and nothing else.** `booking-locks` writes it; the Parties tab and the customer portal render it; **no route enforces it**. Do not reason about it as a lock.
- **A cron response is not a place to put a customer list.** `summer-hair-reminders` returned every candidate's name, raw phone number and appointment slot in its JSON body, and `?force=true` dropped the already-sent guard as well as the clock gates — one authenticated GET re-texted thirteen real customers about a July appointment. A `force` flag may override the CLOCK; it may never override an idempotency guard, because there is no way to un-send an SMS.
- **A rule that greps a BLOCK can be satisfied by a different occurrence than the one that broke.** Link 16 named the family for whole files, link 18 hit it twice, and it hit this session's own tripwire inside a sliced loop: the past-party rule asked whether the loop contained `party_date`, and neutering the guard to `if (false)` left `booking.party_date` in a note string two lines below, which satisfied it. Slice the guard's own condition, from its `if` to its `{`, and assert its ordering against the write.
- **Brace-match a function body from the end of its PARAMETER LIST, not from the name.** `functionBody(src, 'processSequences')` took the next `{` after the name and found the default value in `(opts: ProcessOptions = {})`, returning a two-character body that no rule could ever match — a rule passing for the wrong reason, in a file whose whole job is to stop that. Paren-match first.
- **Never `docker compose restart`** to deploy — always `up -d --build` (restart ignores `.env` and new images).
- **`NEXT_PUBLIC_*` changes require a rebuild** (`--build`); they are baked at build time, not read at runtime.
- **Stripe is LIVE** — deposits/payments are real money. **`SIGNWELL_TEST_MODE=false` is live e-sign.** Be careful testing payment/contract flows against production.
- **Migrations are not run by deploy** — apply `starting_plan/migration_*.sql` manually in Supabase first, then deploy.
- **Git on the box uses a read-only deploy key** via the `github-hosthampton` SSH alias (`IdentitiesOnly yes` required, since the box holds multiple repos' keys). It can pull but not push; pushes happen from your laptop/GitHub.
- **No CI/CD, no GitHub Actions** — every production change is a manual deploy. Don't assume a pipeline will catch anything.
- **Agent stack is disabled.** redis/orchestrator/SOC/copy/image/paid/MCP services in `docker-compose.yml` are commented out; `redis_data` and `uploads` volumes are retained for if they're re-enabled. Don't reference them as live infra.
