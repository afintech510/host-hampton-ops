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
`SIGNWELL_API_KEY`, `SIGNWELL_TEMPLATE_ID`, `SIGNWELL_TEST_MODE`, `SIGNWELL_SIGNER_PLACEHOLDER`

`db_setup.sh` additionally reads: `DATABASE_URL` (or `SUPABASE_DB_HOST` / `SUPABASE_DB_PASSWORD` / `SUPABASE_DB_PORT` / `SUPABASE_DB_NAME` / `SUPABASE_DB_USER`).

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
The next free migration number is **045**. (037 plan content, 038 + 039 per-user
admin login, 040 payment idempotency, 041 the learning loop, 042 typed
`draft_feedback`, **043 Phase 4 campaign automation** — `email_sequence_sends`
plus the columns and slot index that extend the pre-existing `social_posts`;
**044 the reminder-queue repair** — `scheduled_reminders.reference_id` widened
from `uuid` to `text`, the `reference_type` CHECK corrected to `('event',
'booking')`, a `'sending'` claim status, `attempts` / `last_outcome` /
`last_error` / `claimed_at`, and **one** unique index
`uniq_scheduled_reminder_once (contact_id, reminder_type, reference_id) WHERE
status <> 'cancelled'` replacing the two partial ones.)
Phase 4's **review** (link 9, 2026-09-12) took no migration.

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

There is **no in-container scheduler**. Scheduled work is driven externally by **cron-job.org**, which hits the app's cron API routes. Each route is authorized by a shared secret matching `CRON_SECRET`, sent either as the `x-cron-secret` request header **or** the `?secret=` query parameter (unauthorized → 401).

Cron routes (under `services/website/src/app/api/cron/`):

- `/api/cron/send-reminders` — booking/event reminder emails + SMS. **The only deliverer**: it claims each row (`pending`→`sending`) before sending, re-reads consent at send time, and records a named outcome on every path. `?limit=N` (1…50, out of range is a 400) bounds a manual run to the N longest-waiting rows. **Not currently scheduled** — see `docs/reminder-engine-review.md` §10.
- `/api/cron/send-campaigns` — outbound campaign sends
- `/api/cron/draft-newsletter` — newsletter drafting
- `/api/cron/process-sequences` — email sequence processing. **Not currently scheduled, and must not be rescheduled blind** (PLAN.md needs-Adam): its cron-job.org job disappeared on 2026-08-16 and **44 enrollments are frozen mid-sequence**, so turning it back on mails 44 real people at once, months late. `?limit=N` (1…50) caps one tick to the N longest-waiting enrollments — that is the drain: one real person per tick, checked in between. An out-of-range `limit` is a 400, never a silent full batch.
- `/api/cron/event-reminders` — nightly sweep for tomorrow's ticketed events. **ENQUEUES into `scheduled_reminders`; it does not send.** (Until 2026-09-12 it texted `event_tickets` directly with no consent check and no cross-run idempotency.) It therefore depends on `send-reminders` also being scheduled. Not currently scheduled.
- `/api/cron/birthday-rebooking` — scans bookings 8–10 months past and enqueues a pre-approved rebooking nudge. Marketing: opt-in checked at enqueue **and again at send**. Has run once, ever (2026-08-17), and found nothing. Not currently scheduled.
- `/api/cron/booking-locks`
- `/api/cron/agent-dispatch` — booking agent: claims new inbound events, drafts replies, texts the reviewers. Every 2 minutes. No-op unless `AGENT_ENABLED` is true.
- `/api/cron/gmail-sync` — pulls new mail from `GMAIL_USER` into `ingested_messages` and applies the handled label. Every 3 minutes. No-op unless the `GMAIL_*` env is set. Read + label only; it has no send scope. `?backfill=1&pageToken=…` runs the bounded 12-month historical pull by hand (writes rows as `handled`, so it never triggers a draft).

Example trigger:
```bash
curl -s "https://www.hosthampton.com/api/cron/send-reminders" -H "x-cron-secret: $CRON_SECRET"
```

If reminders/campaigns stop firing, check the cron-job.org schedule and that the configured secret still matches `CRON_SECRET` in `.env`.

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
- **Never `docker compose restart`** to deploy — always `up -d --build` (restart ignores `.env` and new images).
- **`NEXT_PUBLIC_*` changes require a rebuild** (`--build`); they are baked at build time, not read at runtime.
- **Stripe is LIVE** — deposits/payments are real money. **`SIGNWELL_TEST_MODE=false` is live e-sign.** Be careful testing payment/contract flows against production.
- **Migrations are not run by deploy** — apply `starting_plan/migration_*.sql` manually in Supabase first, then deploy.
- **Git on the box uses a read-only deploy key** via the `github-hosthampton` SSH alias (`IdentitiesOnly yes` required, since the box holds multiple repos' keys). It can pull but not push; pushes happen from your laptop/GitHub.
- **No CI/CD, no GitHub Actions** — every production change is a manual deploy. Don't assume a pipeline will catch anything.
- **Agent stack is disabled.** redis/orchestrator/SOC/copy/image/paid/MCP services in `docker-compose.yml` are commented out; `redis_data` and `uploads` volumes are retained for if they're re-enabled. Don't reference them as live infra.
