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
| `CM_CHEER_PASSWORD` | **Required for `/cm-cheer/orders`.** The credential on the CM Cheer / LI High order book (`GET /api/cm-cheer-orders`, `PATCH /api/cm-cheer-orders/[id]`). Set 2026-09-13; `lib/cmCheerAuth.ts` **fails closed** without it. It replaces `process.env.CM_CHEER_PASSWORD \|\| 'cmcheer2026'` — a literal in the public repository, over a table holding **21 real orders** with each customer's athlete name, parent name, email and phone — while this variable was **not set**, so the literal WAS the production credential. The page no longer holds it either: `NEXT_PUBLIC_CM_CHEER_PASSWORD` was baked into the client bundle, so the typed password is now POSTed and the server judges it. Adam's `ADMIN_PASSWORD` / `hh_admin` cookie also works on those two routes. The value is in `/opt/hosthampton/.env`. |
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
- **A public route's LINE ITEMS are the money, and they came from the browser.** `lineItems[].unit_price_cents` went into `booking_line_items` verbatim and into `bookings.total_cents` / `deposit_amount` / `balance_due_cents` through `buildPlanSnapshot`, and `loadPlanInvoice` re-derives every invoice and every Stripe charge from those rows — so "the total is computed server-side" was true of the arithmetic and false of the inputs. Measured consequence: one add-on priced `-1000000` on `/api/studio-rental/edit` made the total negative, `Math.max(0, total − paid)` zero, and the route wrote **`status = 'paid_in_full'`** on a real studio rental — a customer settling their own booking with their own portal cookie. `screenPublicLineItems` in `lib/publicIntake.ts` bounds them and **refuses a negative price outright**; negative prices are the admin discount facility (8 live rows, all in category `discount`) and stay admin-only. It is a SCREEN and not a re-price on purpose: 47 of 206 live rows carry no `pricing_item_id`, and nine groups legitimately disagree with the catalogue because the planner's product is a bundle calculus. `publicIntakeSurface.test.ts` R2 fails the suite if a non-admin handler feeds unscreened items into the arithmetic, if the screen runs after it, or if the raw body is used afterwards.
- **A guard on one of three paths is a guard on nothing.** `/api/party-builder/save` resolves which plan a save edits from the portal cookie, `body.bookingRef`, or a prior-plan scan — and its "never fold into a plan money has landed on" check sat inside the scan only. The other two paths reach a branch that REPLACES the line items and overwrites `total_cents`; production holds 7 `deposit_paid`, 2 `paid_in_full` and 5 `modifications_locked` bookings. The check is applied to whichever ref wins now, has three outcomes (an unreadable `booking_payments` is **not** "no payments" — the original discarded that error), and a public **reduction** of a paid plan's total is refused with 409 while adding to it stays allowed, because that is the product.
- **"What does this booking owe" is `lib/bookingBalance.ts` and nothing else.** It had SEVEN answers; four were in public routes and two of those wrote `paid_in_full` from `(total_cents || 0)` with both reads discarded — so a Supabase blip, or any plan nobody has priced, settled a booking on its first $250 deposit. `/api/party-builder/{save,confirm-session}` and `/api/studio-rental/{edit,confirm-session}` all use `readBalanceInputs` + `computeBalance` now. **Never write `total_cents || 0`**; that clamp is the bug.
- **A default credential IS the credential.** `/api/cm-cheer-orders` compared a Bearer token against `process.env.CM_CHEER_PASSWORD || 'cmcheer2026'` in two hand-rolled copies, and **that variable was not set in production** — so a literal printed in this repository read 21 real customers' names, emails and phone numbers and could mark any order paid. The page was worse: `NEXT_PUBLIC_CM_CHEER_PASSWORD` is baked into the JavaScript every visitor downloads. One fail-closed `isCmCheerAuthorized` in `lib/cmCheerAuth.ts`; the page POSTs the typed password and the server judges it. The same shape at scale: `PORTAL_LINK_SIGNING_SECRET || 'dev-secret'` was written out **twenty-seven times** and now lives once, in `portalSigningSecret()` in `lib/portalAuth.ts`, which THROWS in production. `publicIntakeSurface.test.ts` R6 fails the suite on any literal fallback for a secret, on a second file holding `'dev-secret'`, and on any `NEXT_PUBLIC_*` variable whose name is credential-shaped.
- **A fail-closed secret must not fail the BUILD.** `portalSigningSecret()`'s throw fired while `next build` prerendered two cookie-reading routes, and the image is built with `up -d --build`, which passes `.env` at RUN time and not as a build arg — so the first version of it broke the deploy and only `npx next build` said so. It checks `NEXT_PHASE === 'phase-production-build'`, and any route that reads a cookie carries `export const dynamic = 'force-dynamic'`.
- **A public intake route answers 200 only if something landed.** All seven ended `return NextResponse.json({ success: true })` regardless of whether `upsertContact`, `ensureLeadPlan`, `recordInboundEvent`, the `contact_interactions` insert or the owner email succeeded — so a visitor was told "we received your message" over a lead that existed nowhere. Rule 10's expensive half, where the thing lost is revenue. They track an `IntakeRecord` now: nothing at all → **503** so the form retries; a lead that reached only Adam's inbox is DAMAGED, logged loudly, and still a 200. `Promise.allSettled` with the result discarded cannot see either failure mode — a rejected promise **or** a resolved one carrying `{ error }` — so `settledOk()` checks both.
- **There is a rate limit now, and its per-caller half is forgeable.** `lib/rateLimit.ts`: two buckets, per-caller and per-ROUTE. nginx sets `X-Real-IP` to the **Cloudflare edge**, so the only header that names the visitor is `CF-Connecting-IP` — which Cloudflare sets and nginx passes through untouched, so anyone reaching the origin IP directly controls it (the `X-Forwarded-Host` family). The route ceiling is the half that holds, and it is set 2–3 orders of magnitude above real traffic: the busiest public intake route took **23 requests in the whole ten-day window**. In-memory, one container, resets on deploy — deliberately, and written down. A caller with no usable address header SKIPS the per-caller bucket rather than sharing one, because a proxy misconfiguration must not cap the whole site. `/api/unsubscribe` is exempt on the record: a false 429 on a one-click opt-out is worse than the abuse.
- **A ticket `quantity` is a positive whole number, checked.** It was multiplied into the price, into `event_tickets.quantity` and into `decrement_*_tickets(qty)` with no validation at all. A NEGATIVE value passed the stock check (`available_tickets < -5` is false) and **inverts the decrement into an inventory increase**; on a FREE event the route issues tickets without touching Stripe, so nothing else stood in the way. `screenPublicCount` on both checkout routes, ceiling in `lib/ticketLimits.ts` (a `route.ts` may not export a constant).
- **A rule that greps for one SPELLING is satisfied by another.** `contactIdentitySurface.test.ts` R1 forbids filtering an email column outside `lib/contactLookup.ts` — and it passed `lib/plan.ts` for two links while `findOpenPlan` filtered `contact_email` case-sensitively, because a PostgREST `or()` expression is a STRING and the filter was written `contact_email.eq.${value}` with no method call to match. **Nine of 61 live `bookings` rows are not lowercase**, so those customers' open plans were unfindable and each new enquiry would fork a second plan, a second agent draft and a second text to Adam's phone. R1 now checks both spellings; `findOpenPlan` goes through `findBookingsByContactEmail` and builds no `.or()` at all — phone variants go through `.in()`, which parameter-encodes, so `(631) 400-8080`'s parentheses are data and the hand-rolled `orValue()` quoter is gone.
- **A skipped rule is a disabled tripwire, and grepping its CONTENT cannot see that.** Turning one `it(` into `it.skip(` in `contactIdentitySurface.test.ts` left every string a meta-assertion looks for exactly where it was. `publicIntakeSurface.test.ts` R10 fails the suite if any `*Surface.test.ts` contains `.skip`, `xit` or `.todo`.
- **The portal's PAYMENT TYPE is `lib/portalWrite.ts` and nothing else, and `refund` is not a customer's word.** `/api/portal/pay` copied a body-supplied `paymentType` into `metadata.payment_type` with no screen. `booking_payments_payment_type_check` allows `deposit|partial|final|refund`, so an unknown value charged the card and then failed 23514 in the webhook → 500 → Stripe retries forever → **money collected and recorded nowhere**; and `refund` is a spelling the CHECK ACCEPTS whose row `sumPayments()` **SUBTRACTS**, so a customer could pay us and raise their own balance. Both were driven against production and both created a live PaymentIntent. `screenPortalPaymentType` is the one screen; an ABSENT value is still not an error, because `/my-booking/pay` posts none.
- **One figure must not live under two metadata keys.** The webhook and `party-builder/confirm-session` both read the credited amount as `paymentType === 'deposit' ? depositCents : amountCents`; `/api/checkout` writes `depositCents` and `/api/portal/pay` wrote only `amountCents`, so the branch `/my-booking` selects BY DEFAULT for an `awaiting_deposit` booking charged the card and wrote `amount_cents: 0` — balance unmoved, status demoted to `pending_review`, and a **"Deposit Received — $0.00"** email. Measured live: `pi_3UFBu5…`, amount 10197, `depositCents: ABSENT`, would credit **0**. Both keys are written now and both readers fall back — and a payment naming NO amount is REFUSED, because the unique `stripe_payment_intent_id` means a $0 row permanently swallows the correction.
- **A cancelled booking does not take money, and `status` in a SELECT list is not a check.** `/api/portal/pay` selected `status` and never read it; four real `cancelled` bookings carry **$47,470** of `balance_due_cents` and a customer holding a cookie for any of them saw a live Pay button. `isPayableStatus` gates `portal/pay` and `notify-payment`, on every payment-method branch — a guard on one of two is a guard on nothing.
- **`guest_count_approx` is the MULTIPLIER in the money, and the customer writes it.** `loadPlanInvoice()` computes a per-head item as `unit_price × quantity × guest_count_approx`, and `/api/plan/[ref]/pay-link` takes a PORTAL COOKIE and derives the Stripe charge from that invoice. The portal PATCH bounded it `0…10_000`: **zero removes every per-head charge**. Use `screenPublicGuestCount` (1…500) — the same screen the public intake routes use — never a private numeric range. Link 20 screened the unit price; the multiplier is the other half of the same product.
- **`bookings.contact_email` is an AUTHORIZATION KEY, not a form field.** It is what `/api/portal/email-auth/request` and `/api/portal/my-bookings` authorize on. `/api/checkin/[token]` wrote it from its form, so a link in a text message could move a booking onto somebody else's address and hand over the portal, the receipts, the reminders and every future magic link. A token-gated route may SET an absent address and must never CHANGE one; record the request where a human reads it instead.
- **`bookings.party_date` is nullable and `isModificationAllowed` does `.split('-')` on it.** Both portal handlers passed the column in behind an `as string` cast and answered **500** for the three dateless plans, one of them a live lead. A cast is an assertion, not a check — and a cast also defeats a tripwire anchor.
- **`old_data: null` makes an audit trail useless.** `booking_modifications` recorded that a customer changed something and never what it changed from, on 45 real rows. Capture the before-values **before the write**, not after: after is correct by accident against a real PostgREST client and wrong against any fake that returns live row references, which is how my own route test caught it printing `guest count 2 → 2`.
- **A route that emails AND texts Adam on a cookie alone must be counted.** `portal/send-message` and `portal/notify-payment` had no bound at all. `ownerNotifyRule` (8/caller/hour, 60/route/hour) — sized from the measured ten-day traffic of **4** and **0** requests, not reasoned.
- **`guardRecipient` is the OTHER axis of the rate limiter, and it lives in `lib/rateLimit.ts`.** Bounding a CALLER is not bounding a RECIPIENT: the caller bucket stops one script, the route bucket stops a flood, and neither stops somebody cycling through proxies to text one real customer forty times. `resend-link` had its own private `Map` for this with **no eviction** — an unbounded memory leak keyed by attacker-chosen strings, inside a rate limiter.
- **Measure before AND after, in production, and keep the before.** Every one of this session's nine findings was reproduced against the live site on throwaway rows before a line was changed, and re-driven after the deploy. The "before" column is the evidence; without it a fix is a claim. **And note the first probe run returned 403 with a non-JSON body on every call — that was Cloudflare, tripped by a forged `cf-connecting-ip`, not the app.** Call the container on its own address (`os.networkInterfaces()` → `http://172.18.x.x:3002`) when probing routes; it is also the honest test, because it exercises the app rather than the edge.
- **An unconfirmed PaymentIntent is not a charge, and it is the right probe.** Creating one is exactly what happens when a customer opens the pay panel and walks away: `status: requires_payment_method`, no payment method attached, no money can move. Read its `metadata` to prove what the webhook would credit, then **cancel it**. Five were created and five cancelled this session against a live key, with nothing charged.
- **A payment processor's domain is not evidence the money comes to US.** `containsForeignContact`'s host allowlist carried `venmo.com` and `stripe.com`, and it matches the HOST only — so `https://buy.stripe.com/<attacker>`, a live and chargeable payment page anyone can own, passed the one guardrail whose stated purpose is stopping a payment redirect. So did `venmo.com/u/<anyone>`. **The host tells you who takes the card, never who gets paid.** `hosthampton.com` is ours unconditionally; Venmo is ours only at a path naming `venmoHandle()`; Stripe is never ours in generated text, because this agent does not mint pay links.
- **Zelle is keyed by a PHONE NUMBER, so a bare phone number is a payment handle.** "Zelle the deposit to 917-555-0134" and "text our billing line at …" were undetectable — the axis did not exist. The detector allowlists our four real numbers from `lib/paymentContacts.ts` + `QUO_PHONE_NUMBER` + `REVIEWER_PHONES`, and it is strict because the false-positive risk was MEASURED: not one of the 23 real drafts in production contains a phone number, a URL or an `@handle`.
- **`summaryForReviewer` is the artefact, not a label.** It is the entire body of the one-segment reviewer SMS, the Slack fallback text and the sentence beside the Approve button — the one line a human reads before pressing send — and it is model output over a stranger's email by the same writer as the drafts beside it. It was screened by nothing, in both copies of the guardrail block. Everything a model generates gets screened, including the part that is "only for us".
- **Plan §4.6's cancelled-plan stand-down was stated for months and implemented nowhere.** `PLAN_COLUMNS` did not even SELECT `status`; every `cancelled` in `lib/agent/` meant the DRAFT's status. Three open drafts hung off cancelled parties, two of them real customers. Rule 8's newest form is not a comment that lies but one that is **entirely right beside code that does not act on it**: `/api/admin/agent`'s GET says an open draft on a cancelled plan "is a live hazard, not a curiosity", surfaces it for the UI, and refuses nothing. `planIsStoodDown` / `planStatusOf` in `lib/agent/draftInquiry.ts` are the one implementation; four surfaces call it.
- **A PARKED draft is the one class a human must read, so it is the one class whose approval must be guarded.** `parkedSmsBody` deliberately omits "Reply SEND" for exactly that reason, and approving one was completely unguarded — `resolveDraft` did not even SELECT `error`. And the hold could be cleared by an edit that edited nothing: `{action:'edit', id}` with no fields set `error: null` and moved the draft to `sent_for_review` without touching the flagged bytes. A hold is released by changing the TEXT, and approving a held draft costs one confirmation naming the reason.
- **Screen again at the last gate, and the reason is rule 8 not paranoia.** `sendApprovedDraft` re-screens the exact bytes it is about to deliver on the money-redirect axis. Between the draft node's screen and the send, the text has been through an admin `edit` (free text, no screen), a re-draft and a human skimming SMS — **and the screen itself was broken, so drafts that passed it are still in the queue.** Only that axis: an admin who edited the text owns its wording; nobody owns where the money goes.
- **`coerceIsoDate` asks whether a date EXISTS, not whether it could be a party.** A model resolving "this Saturday" fails into the wrong month or the wrong year, and 2025-10-14 is a perfectly good Tuesday. A past `party_date` written to a plan stops the agent asking (rule 15) **and** computes `modification_cutoff` / `guest_count_cutoff`, locking a live booking's windows and telling the customer their date is fixed for a day that has been. Refuse it as a field; keep it as `party_tags.requested_date_text` so the evidence survives the refusal.
- **`blank()` and `.is(col, null)` do not agree about zero.** `applyExtractedFields` treats `guest_count_approx = 0` as fillable (`!(Number(x) > 0)`) but guards the write with `.is(col, null)`, which never matches a 0 — so that one column lost the compare-and-swap the whole function rests on. When a blankness test and its guard are written separately, they are two definitions of blank.
- **A budget that filters on ONE actor is not a budget.** The agent bills LLM calls under `AGENT`, `agent:distill`, `'ADMIN'` / `admin:<email>` and `REVIEWER:+1…`; `spentTodayUsd` counted the first and $0.045 of real spend was invisible to the daily ceiling. Count by ENTITY (`inquiry_draft` + `agent_learning`). And a failed read must not return 0 — "nothing spent today" turns the ceiling off; stand the run down with a 503 instead.
- **A guard that depends on a read disappears when the read fails.** `mostRecentlyTexted` returned `string | null`, the caller computed `outOfContext: !!top && …`, and a Supabase blip silently skipped the one confirmation between a reviewer's typo and a real quote reaching the wrong customer. Three outcomes, and `unavailable` means CONFIRM — asking once you did not need to costs one text.
- **`.limit(n)` then `drafts.length` is not a count.** "There are 10 open drafts" when production has fifteen. Read one more than you show.
- **"Not configured" stopped meaning "harmless" the moment the route could send.** An unset `QUO_WEBHOOK_SECRET` skipped verification, which was honest when the route only logged an opt-out and became a latent unauthenticated endpoint once an inbound SMS could approve a draft and message a real customer. Fail closed in production on the `portalSigningSecret()` pattern; the build is not a request.
- **A guardrail is its REFUSAL, not its detector — and a return-type annotation is not behaviour.** Four of `agentSurface.test.ts`'s 40 rules went through on the first attack run, all one family: one asserted a screen's CALL was present while the harness assigned its result to an unused variable; one matched `ok: false` in the function's own return TYPE while the whole error branch was gone; one matched one of two occurrences plus the type union; one matched the wrong `return null`. **And the first fix for that last one reproduced it** — a 200-character window still reaches the next branch. The form that works is a construct: `if \(error\) \{(?:(?!\bif\s*\()[\s\S])*?return null`.
- **A statement boundary is not a newline, and only COUNTING catches the difference.** `agentSurface` R9 walked back to the nearest `;{}\n` to find a write's statement head — but every supabase call here is a multi-line chain, so the head was pure indentation: captured writes read as bare and most writes were skipped entirely. It examined **7 of 23** and found its one real offender by luck. `expect(examined).toBeGreaterThanOrEqual(20)` is the line that surfaced it.
- **`bodyOf()`-style helpers see TOP-LEVEL declarations only.** A `^`-anchored declaration regex returns '' for an indented `const` inside a function, and a rule that then scans '' passes for the wrong reason. Every caller asserting `not.toBe('')` is what makes that fail loudly instead.
- **Never `docker compose restart`** to deploy — always `up -d --build` (restart ignores `.env` and new images).
- **`NEXT_PUBLIC_*` changes require a rebuild** (`--build`); they are baked at build time, not read at runtime.
- **Stripe is LIVE** — deposits/payments are real money. **`SIGNWELL_TEST_MODE=false` is live e-sign.** Be careful testing payment/contract flows against production.
- **Migrations are not run by deploy** — apply `starting_plan/migration_*.sql` manually in Supabase first, then deploy.
- **Git on the box uses a read-only deploy key** via the `github-hosthampton` SSH alias (`IdentitiesOnly yes` required, since the box holds multiple repos' keys). It can pull but not push; pushes happen from your laptop/GitHub.
- **No CI/CD, no GitHub Actions** — every production change is a manual deploy. Don't assume a pipeline will catch anything.
- **Agent stack is disabled.** redis/orchestrator/SOC/copy/image/paid/MCP services in `docker-compose.yml` are commented out; `redis_data` and `uploads` volumes are retained for if they're re-enabled. Don't reference them as live infra.

### Link 23 — the plan money path (2026-09-13)

- **"What does this party owe" has ONE home: `lib/planBalance.ts`.** It was answered at least nine ways and two of them disagreed *in front of the customer*. `planMoney()` produces every figure; `billedTotalCents()` is the only loop that turns line items into money; `depositIsSeparateFor()` is the only place `party_type === 'studio_rental'` is spelled. Import it, never restate it.
- **A figure computed at quote time is not a balance.** `loadPlanInvoice().balanceDueCents` was `total − the NOTIONAL deposit` and never read `booking_payments` at all, so it disagreed with what was outstanding on 27 of 35 live priced plans and told two paid-in-full customers they owed $1,475.00 and $1,560.00. If a number is labelled with what someone owes, it has to be derived from what they have paid.
- **A guard that asks the wrong question is not a guard.** `quoteFor('deposit')` was bounded by "has a `payment_type='deposit'` row been recorded" — and 16 of the 18 real payments are typed `partial`, because every hand-entered one is. **A deposit is part of the price, so it can never exceed the price that is left.** Cap it. (A studio SECURITY deposit is genuinely outside the total and is deliberately not capped — that asymmetry is the whole of needs-Adam 41.)
- **The dangerous-sounding branch gets guarded and the innocuous one does not.** `balance` correctly refused a paid-in-full plan; `deposit` minted a live $257.50 Payment Link against one. When you find a guard, check its siblings.
- **Two reads of the same rows are two answers.** The page, the pay route and the invoice each read `booking_payments` separately. The invoice now carries them and `quoteFor` takes no payments array, so they *cannot* be given different inputs. A second read is a place to drift.
- **A comment that PROMISES a number will move is rule 8's worst form.** The `?paid=1` banner said "the balance below updates once Stripe confirms it" over a figure that structurally could not.
- **`is_optional` means quoted-and-not-charged, and it was honoured by one of five totals.** When a flag exists in the DB and in one reader, check every other reader — and prefer making the shared helper delegate over adding a second correct implementation.
- **An accounting question gets reduced to a switch, not answered.** needs-Adam 41 is two booleans (`STUDIO_DEPOSIT_IS_SEPARATE`, `COLUMN_FOLLOWS_INVOICE`) with every writer routed through them **at today's values**, tests asserting the exact figures production holds, and the divergence logged on every call. The ruling is a two-line change; making it silently would charge two real customers $250 more than they were quoted.
- **When two sources disagree about what is owed and you may not pick, clamp to the LOWER one.** It cannot overcharge, it is a no-op when they agree, and the log line makes the disagreement visible. `/api/portal/pay`.
- **`.from(` is the wrong place to split a write site.** A rule that slices there puts `const { error } = await supabase` in the *previous* chunk and reports correct code as an offender. Include the preceding ~200 characters.
- **A tripwire on PROSE must assert the substance, not one phrase.** The needs-Adam comment is the deliverable; a rule checking a single sentence lets the explanation around it be tidied away. Assert the ticket number, the rows, the dollar figure and what each setting means.
- **CRLF silently disarms a mutation harness.** Six of 34 mutations reported "find string absent" because a literal `\n` matches nothing in this repo. They would have scored as catches in a harness that did not separate NOT_APPLIED from CAUGHT. Match on `\r?\n`.
- **Rule 8, aimed at my own new rule, again:** R8 asserted `derivedOutstandingCents` *contains* `return null` — it does, in a different branch — so turning the read-failure branch into `return 0` went straight through. Anchor on the branch, and assert the absence of the wrong answer as well as the presence of the right one.
- **Opening `/plan/<ref>/summary` BURNS an invoice number** (`ensureInvoiceNumber` issues on first render). 53 of 62 bookings have none. To probe, seed a throwaway with `invoice_number` pre-set — the sequence then stays put, verified at `last_value 118, is_called t` before and after.
- **The first fetch after a container recreate can be a PARTIAL payload.** `/plan/…/summary` came back 200 at 47,449 bytes with no totals in it, and at 56,308 bytes complete on every fetch after. Measure twice before calling anything a regression.
- **`booking_line_items.is_optional` and `is_featured` exist and are NOT NULL DEFAULT false**; the per-head flag is `guest_multiplied`; `category` is NOT NULL. `bookings.deposit_amount` is NOT NULL (default 25000) while `total_cents` and `balance_due_cents` are nullable.

### From link 24 — the inbound message surface (2026-09-13)

- **A webhook is verified when a REAL provider delivery returns 200 — never when your own signed request does.** `docs/quo-webhook-setup.md` §4 "verified" `/api/webhooks/quo` by signing a payload the way the verifier checks it. That proves the verifier agrees with itself and nothing else, and it is how the endpoint **refused every genuine inbound SMS for two and a half days** (38 deliveries, every one 401, while the harness kept printing 200) without anybody noticing.
- **ASK THE PROVIDER'S OWN DOCS for the signing scheme, and read the HEADER NAMES, not just the algorithm.** Quo/OpenPhone: `openphone-signature: hmac;1;<ms>;<base64>`, HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``, keyed by the **base64-DECODED** key. Twilio: `X-Twilio-Signature`, HMAC-SHA1 over the **public** URL followed by every POST parameter sorted by name, key then value — use `publicOrigin(req)`, never `req.url`, which inside the container is not the URL the provider called. SignWell: `type@time` only, so a valid hash vouches for nothing in the body. Three providers, three schemes, no overlap.
- **Count a route's traffic by STATUS, not by path.** A stream of 401s reads exactly like a stream of 200s if you only count lines, and `docker logs hampton_nginx | grep -c <path>` is how that mistake is made.
- **A refusal must name WHY it refused.** `signature verification FAILED — rejecting` cannot distinguish a wrong key from a wrong scheme, and that distinction was the whole of the 2.5 days. Log the reason and which signature headers were present — and log **fingerprints**, never a prefix of a digest, because a prefix of a real HMAC is a piece of a real HMAC.
- **`Buffer.from(x, 'base64')` NEVER throws.** It silently drops the characters it cannot read. So `try { base64 } catch { utf8 }` is dead code that hides a mis-set secret behind a wrong key; check the round-trip instead.
- **A verifier must never throw.** It sits in front of every inbound write, so an unexpected request shape must be a 401, not a 500. Read headers defensively, the way `callerKey` already does.
- **Rate-limit a webhook generously or not at all.** A throttle that drops a provider delivery is the same outage as an over-strict signature check, with a different cause — most providers retry a handful of times and then give up forever. Size it from the measured volume and then multiply. `webhookRule()`.
- **A `null` return that means three things will be read as the harmless one.** `recordInboundEvent` returned `null` for *duplicate*, *refused* and *threw*; `gmail-sync` read it as "duplicate" and advanced its history checkpoint past the message, and the Quo route answered 200 so the provider never redelivered. Rule 12, on a writer rather than a reader.
- **"Could not read it" is not "it is not there", at the API boundary too.** `getMessage()` returns `null` for a Gmail 429/500/timeout exactly as it does for a deleted message, and the caller moved its checkpoint past both.
- **A fence is only a fence if the data cannot close it — in EVERY prompt, not the one you remembered.** `draftInquiry` neutralises `<their_message>` and flattens every interpolated value; `triage`, which an inbound email reaches *first*, did neither. Rule 11: one concept, implemented in one of the two places that needed it.
- **Two handles are not one recipient unless something links them.** `resolveRecipient` filled `email` and `phone` independently from three sources, so one conversation could be emailed to one person and texted to another. 21 phone numbers carry several contact rows and two of those groups are two different people sharing a household phone.
- **A STOP is cheap to over-record and a START is not.** Opting every row holding a number OUT is always safe; opting them back IN hands one person's consent to another. Record the START, say so, and let a human decide.

**Tripwire lessons (all four holes were in my own rules):**

- **`\)\n` matches NOTHING in this CRLF repo.** R8's log-scanning rule ended on `)\n`, so its match list was empty, the loop never ran, and it passed over a `console.log` printing a real customer's SMS. It counted **files** and not **sites** — count what you actually examined, every time. This is the same family as link 23's six NOT_APPLIED mutations.
- **A rule that reads one of two failure paths reads neither.** R3 asserted the `if (error)` branch returns `failed` and never looked at the `catch`, so turning the catch into `return { kind: 'duplicate' }` went straight through.
- **`decomment` PRESERVES OFFSETS**, which is right for anything comparing positions and a trap for anything measuring distance: a `[\s\S]{0,240}` proximity window over decommented source is measuring hundreds of blanked comment characters. Collapse whitespace first (`squash`) or anchor on a construct. Two rules fired on correct code this way — **when a rule fires on code you believe is right, suspect the rule first.**
- **A rule that matches a WORD rather than an interpolation is wrong in the false-positive direction**, and a false-positive rule is one the next person relaxes. The secret-logging rule matched `\btoken\b` and fired on the string `'gmail: token refresh failed'`; it is anchored on `${…}` now, with both negative cases pinned.
- **An exclusion is CLASSIFIED, never regex'd away.** R0 names the three modules that legitimately compute an HMAC elsewhere and asserts each still exists and still does, so the exclusion list cannot quietly end up protecting nothing.
- **A mutation that cannot LAND proves nothing.** One of the 56 anchored on two lines with a comment between them and reported `NOT_APPLIED` — which is why a harness must distinguish that from `caught`.

**And the build pipeline itself:**

- **The CI gate can be the thing that is broken, and it can be broken by its own documentation.** `.github/workflows/deploy.yml` greps `src/__tests__` for `(describe|it|test)\.skip\(` and fails the build on a hit, without excluding comments — and `publicIntakeSurface.test.ts`'s R10 comment spelled the pattern literally while explaining the rule that bans it. **Every push to main failed CI from `d611eef` until link 24 found it**, and nothing on the box was affected because `scripts/deploy.sh` SSHes in directly and bypasses the Action entirely. That is exactly why nobody noticed. **When a deploy is red, read `.github/workflows/` before assuming it is your code** — and remember that a gate refusing every build looks identical to a gate passing them (rule 10, in a pipeline).
