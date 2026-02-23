# Host Hampton Ops — Session Log

---

## Session 1 — 2026-02-19

### What Was Accomplished

- **SSL/CORS fixed**: Cloudflare Origin Certificate installed on VPS; nginx.conf updated with HTTPS server blocks for both `api.hosthampton.com` and `app.hosthampton.com`. CORS double-header bug resolved (CORS now only in Express middleware, never nginx).
- **Vercel → VPS frontend migration**: Vercel auto-deploy was stale (13 hours behind). User deleted Vercel deployment. Switched `app.hosthampton.com` Cloudflare DNS from CNAME→Vercel to A record→5.161.88.134. nginx now proxies the Vite frontend Docker container directly.
- **All agents deployed to VPS**: SOC, COPY, IMAGE, LIST, OUTBOUND all running in Docker Compose alongside HAMPTON, Redis, and nginx.
- **`awaiting_approval` bug fixed**: Supabase enum doesn't include `awaiting_approval`. Code now uses `pending` + derived logic (`approval_tier != AUTO_EXECUTE + no approved_at/rejected_at`) to represent the same state.
- **JSON parse hardening**: LIST and OUTBOUND agents now sanitize trailing commas before JSON.parse.
- **History + Content Library tabs built**: New `/tasks/history` and `/content-library` API routes. Frontend has two new tabs: History (completed tasks with readable output) and Content (content_library browser). Committed as `da33e5b`.
- **Approve/Reject bug fixed**: `approvalGate.approve()` and `approvalGate.reject()` were querying by `task_id` column; frontend passes `task.id` (primary key UUID). Fixed to use primary key `id` lookup. Committed as `49fd23f`.
- **COPY → content_library schema fix**: COPY was inserting with wrong column names (`task_id`, `headline`, `cta` don't exist) and wrong enum values (`social_post` instead of `caption`, `email` instead of `email_body`). All corrected. Committed as `49fd23f`.
- **SSH non-interactive access enabled**: `~/.ssh/config` entry created for `hampton-vps`. Agent can now run `ssh hampton-vps "cmd"` non-interactively.
- **Session management skills created**: `.claude/commands/close-session.md` and `.claude/commands/open-session.md`.

### Decisions Made

- **Keep `pending` not `awaiting_approval`** for tasks needing review: avoids DB migration, simpler derived logic, consistent with Supabase enum that can't be easily altered.
- **VPS for frontend serving** (not Vercel): Vercel auto-deploy was unreliable. Docker Compose frontend container on same VPS + nginx proxy is simpler and fully in our control.
- **CORS in Express only**: nginx must never set CORS headers — causes double-header bug because Cloudflare proxies both layers.
- **Primary key `id` for approve/reject URLs**: Frontend uses `task.id` (UUID PK). The separate `task_id` column is for internal tracking only.

### Known Issues / Blockers

- **VPS not yet updated with latest commits**: Commits `da33e5b` and `49fd23f` (History/Content tabs + bug fixes) exist locally and on GitHub but are NOT yet deployed to VPS. User must run `git pull && docker compose build --no-cache hampton copy && docker compose up -d hampton copy` on VPS.
- **IMAGE agent blocked on Replicate credits**: HTTP 402 "Insufficient credit" from Replicate. Not a code issue — needs either Replicate credits or switching provider (e.g., OpenAI DALL-E 3).
- **Content tab will be empty until COPY runs a real task**: The schema/column fix means future COPY tasks will save correctly, but no historical content exists from before the fix.

### Current Project State

All Phase 1A agents (SOC, COPY, IMAGE, LIST, OUTBOUND) are deployed on VPS and healthy. The dashboard at `app.hosthampton.com` now serves from VPS Docker. History and Content Library tabs are built and committed but the VPS needs a `git pull` + rebuild of `hampton` and `copy` containers to deploy the latest fixes.

### Updated Priority TODO (in order)

1. **Deploy latest commits to VPS** — `git pull && docker compose build --no-cache hampton copy && docker compose up -d hampton copy`
2. **Verify approve/reject works** in dashboard after deploy
3. **Verify Content tab populates** when COPY agent runs a task
4. **IMAGE agent — unblock**: add Replicate credits OR switch to DALL-E 3
5. **Phase 1B planning**: PAID agent (Stripe + booking integration), INTEL agent (analytics)

---

## Session 2 — 2026-02-20

### What Was Accomplished

- **SSH passphrase eliminated**: Switched `~/.ssh/config` from `id_ed25519` (encrypted) to `id_ed25519_headless` (no passphrase). Added headless public key to VPS `authorized_keys`. All subsequent SSH calls now non-interactive.
- **VITE_API_URL Docker build injection fixed**: Frontend was building with fallback `http://5.161.88.134` instead of `https://api.hosthampton.com`. This caused mixed-content blocking on HTTPS pages (reject/approve POST requests silently failed). Fixed: `docker-compose.yml` now passes `VITE_API_URL: https://api.hosthampton.com` as build arg; `frontend/Dockerfile` accepts `ARG VITE_API_URL` / `ENV` so Vite picks it up at build time. Bundle now contains correct API URL.
- **IMAGE agent filename NOT NULL constraint fixed**: `image_assets` table requires `filename` (NOT NULL). Agent was omitting it. Fixed: derive filename from Replicate URL (`imageUrl.split('/').pop()`) with fallback to timestamp. IMAGE tasks now successfully persist to DB.
- **Replicate image generation confirmed working**: Credits added ($10). IMAGE agent is generating images successfully; only failure was the filename constraint (now fixed).
- **Cloudflare DNS verified**: `app.hosthampton.com` A record → 5.161.88.134 (orange proxied). Was pointing to Vercel CNAME before; user updated DNS.
- **nginx config inode bug discovered & fixed**: After `git pull`, the `nginx.conf` file on disk was 129 lines with app.hosthampton.com blocks, but the running nginx container had a stale 104-line version bound to the old inode. Docker file-level bind-mounts latch to the inode at container start; `git pull` replaces files with new inodes. Fix: `docker compose restart nginx` (forces re-bind). Both URLs now resolve correctly.
- **Both domains live & working**:
  - `https://api.hosthampton.com/health` → ✅ HTTP 200 HAMPTON orchestrator
  - `https://app.hosthampton.com/` → ✅ HTTP 200 dashboard (Vite frontend from VPS)

### Decisions Made

- **Use headless key for all VPS SSH**: The passwordless `id_ed25519_headless` is already what CODEX uses. Consistency eliminates prompts entirely.
- **Build-time VITE_API_URL injection**: Rather than runtime env files or .env in Docker, inject at build time via docker-compose args. This ensures the URL is baked into the static bundle and avoids mixed-content issues on HTTPS pages.
- **Docker compose restart for nginx after config changes**: File bind-mounts are inode-based. Any time nginx.conf is modified (via git pull or direct edit), must `docker compose restart nginx` to re-bind. Added to patterns.md for future reference.

### Known Issues / Blockers

**None blocking. System fully operational.**

### Current Project State

Phase 1A is fully complete and LIVE:
- All agents (SOC, COPY, IMAGE, LIST, OUTBOUND, HAMPTON) deployed and healthy on VPS
- Dashboard accessible at `https://app.hosthampton.com` (served by VPS Docker)
- API accessible at `https://api.hosthampton.com` (HAMPTON orchestrator proxied by nginx)
- VITE_API_URL correctly baked into frontend bundle
- Approve/reject buttons now working (mixed-content issue resolved)
- IMAGE agent fully functional (Replicate working, filename constraint fixed)
- COPY → content_library schema correct; Content Library tab populates on task completion
- SSL/TLS working via Cloudflare Origin Certificate

### Updated Priority TODO (in order)

1. ✅ **Deploy latest commits to VPS** — COMPLETE (dcb4edf pushed, git pull done, containers rebuilt)
2. ✅ **Verify approve/reject works** — COMPLETE (mixed-content bug fixed, VITE_API_URL injected)
3. ✅ **Verify Content tab populates** — COMPLETE (schema correct, tab functional)
4. ✅ **Unblock IMAGE agent** — COMPLETE (Replicate credits active, filename constraint fixed)
5. **Phase 1B planning**: PAID agent (Stripe + booking integration), INTEL agent (analytics)
6. **Test approval workflows end-to-end** with real user approval scenarios
7. **Memory population**: Seed agent_memory with brand voice, services, campaigns

### Files Changed This Session

- `docker-compose.yml` — frontend service now uses `build: { context, args: { VITE_API_URL } }`
- `frontend/Dockerfile` — Added `ARG VITE_API_URL` and `ENV VITE_API_URL=$VITE_API_URL` to builder stage
- `services/image/src/index.ts` — `saveImageAsset()` now derives `filename` from Replicate URL before insert
- `memory/patterns.md` — Added nginx inode bug explanation and recovery steps; updated Frontend + DNS sections; removed Vercel reference
- Containers rebuilt: frontend (with VITE_API_URL), image (with filename fix), hampton, copy all deployed
- nginx container restarted to pick up updated nginx.conf from disk

---

### Files Changed This Session

- `nginx/nginx.conf` — Added HTTPS blocks for api + app subdomains; HTTP → HTTPS redirect; frontend proxy
- `services/hampton/src/approvalGate.ts` — `approve()` and `reject()` now lookup by primary key `id`
- `services/hampton/src/taskQueue.ts` — Added `getCompleted()` and `getContentLibrary()` methods
- `services/hampton/src/index.ts` — Added `/tasks/history` and `/content-library` routes
- `services/hampton/src/types.ts` — Removed `awaiting_approval` from TaskStatus union
- `services/copy/src/index.ts` — Fixed CONTENT_TYPE_MAP enum values; fixed `saveToContentLibrary()` column names
- `frontend/src/api.ts` — Added `ContentItem` interface, `getHistory()`, `getContentLibrary()` functions; updated Task status union
- `frontend/src/App.tsx` — Full rewrite: 4 tabs (chat, tasks, history, content), HistoryCard, ContentCard components
- `.claude/commands/close-session.md` — New session management skill
- `.claude/commands/open-session.md` — New session management skill
- `SESSION_LOG.md` — Created (this file)

---

## Session 3 — 2026-02-20

### What Was Accomplished

- **Phase 1C completed**: Approval workflows tested, task_status enum fixed, History tab unblocked, COPY platform case bug fixed, stale tasks bulk-cancelled, agent_memory seeded (10 entries).
- **OUTBOUND Resend integration**: Added `resend` npm package, email sending live with `noReply@mail.hosthampton.com`. Test email sent successfully.
- **INTEL agent built and deployed**: Full analytics agent with GA4 + internal metrics. Generates business intelligence reports via Claude.
- **GA4 OAuth2 working**: User created new Google OAuth client. New credentials synced to VPS. GA4 fetching live data (534 sessions, 406 users, 621 page views last 7 days).
- **Dashboard Reports tab**: New `/report` endpoint + ReportView component showing analytics summary, GA4 metrics, insights, and recommended actions.
- **nginx DNS resolver fix**: Added `resolver 127.0.0.11 valid=5s;` to nginx.conf — prevents 502 after container restarts.
- **INTEL max_tokens fix**: Bumped from 1200 → 2000 to prevent JSON truncation on detailed prompts.

### Files Changed
- `docker-compose.yml` — Added RESEND_API_KEY, RESEND_FROM_EMAIL to outbound; intel service with Google env vars
- `services/intel/` — New agent: src/index.ts, src/types.ts, package.json, tsconfig.json, Dockerfile
- `services/outbound/src/index.ts` — Resend integration, loadBookingLinks(), send_immediately logic
- `services/outbound/src/types.ts` — Added sent, sent_to, send_error fields
- `services/hampton/src/index.ts` — Added /report GET endpoint
- `frontend/src/api.ts` — Added IntelReport interface, getReport()
- `frontend/src/App.tsx` — ReportView component, reports tab, 📊 Analytics quick prompt
- `nginx/nginx.conf` — Added Docker DNS resolver
- `scripts/seed_agent_memory.js` — Added services.booking_links

### Commits: fdf28b0, 75323ea, 72b0d00, 337d876, 7783b89, 8326a66

---

## Session 4 — 2026-02-21

### What Was Accomplished

- **GA4 credentials fixed**: User created new OAuth2 client (93105553520-*). Synced new GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN to VPS. Confirmed: `docker compose up -d intel` (not `restart`) required to reload env vars. GA4 now returning live data.
- **INTEL max_tokens fix deployed**: Bumped to 2000, committed (bea59f4), deployed.
- **Multi-tenant architecture evaluated**: Explored full codebase for multi-tenancy. User decided against restructuring — will branch the repo per business instead. Training data = `agent_memory` table.
- **Claude Code templates installed**: `frontend-developer` + `backend-architect` agents + `seo-optimizer` skill. Committed to `.claude/agents/` and `.claude/skills/`.
- **Database migration_004 written**: `bookings` table (party_tags JSONB, event_type, Stripe fields, Google Calendar event ID) + `website_content` table (agent-written CMS content). Fixed partial-create bug (added DROP TABLE IF EXISTS).
- **Stripe test key added**: User added `sk_test_*` to .env. Webhook secret still needed — instructions provided.
- **Replit site reviewed**: Comprehensive inventory of 300+ images, brand colors (Dusty Blue, Soft Blush, Warm Ivory, Mauve Rose), fonts (Libre Baskerville + Poppins), and copy from user's previous Replit prototype.
- **Next.js website scaffolded — 20 pages, build succeeds**:
  - Home page: hero, trust bar, themes grid, how it works, reviews, services, CTA
  - Party Packages: size packages + 10 themed packages with pricing
  - First Birthday Parties: SEO landing page with schema.org markup
  - Communion Party: SEO landing page
  - Room Rental, Permanent Jewelry, Add-Ons, Events, Fundraiser, CM Cheer
  - Book page (Stripe placeholder), Book Success, Contact Us
  - Legal pages: privacy, terms, return, party contract
  - Sitemap.xml, robots.txt, schema.org LocalBusiness JSON-LD
  - Dockerfile for standalone Next.js on VPS

### Decisions Made

- **Branch-per-business for multi-tenancy**: No schema restructuring. New businesses get their own git branch, `.env`, Supabase project. Training data = `agent_memory` entries.
- **Next.js 14 App Router on VPS**: Not Vercel (previous reliability issues). Docker container at port 3002, proxied by nginx.
- **Same URL slugs as Squarespace**: `/party-packages`, `/party-room-rental`, `/contact-us`, etc. — zero SEO disruption on DNS cutover.
- **Replit brand colors adopted**: Dusty Blue (#A1B5C8), Soft Blush (#E8C7CB), Warm Ivory (#F6F1EB), Mauve Rose (#C9A9A6) + Navy (#1a2744).
- **$250 deposit model**: Party tags (JSONB) capture preferences; options_locked_by = party_date - 7 days.

### Known Issues / Blockers

- **migration_004 not yet run in Supabase**: User got column error on first attempt (existing table conflict). Fixed migration provided but not yet confirmed run.
- **Stripe webhook secret empty**: User has test key but needs to create webhook endpoint in Stripe Dashboard to get `whsec_*` signing secret.
- **Google Calendar scope not yet added**: Existing OAuth token covers analytics only. Need to re-authorize with `calendar` scope for booking availability/blocking.
- **META credentials still empty**: SOC agent deployed but no META_ACCESS_TOKEN, META_PAGE_ID, META_IG_ACCOUNT_ID.

### Current Project State

GA4 analytics live on VPS. INTEL agent generating reports with real website data. Full Next.js website scaffolded with 20 pages, all building successfully. Brand design from Replit prototype adopted (Dusty Blue/Blush/Ivory color scheme, Libre Baskerville + Poppins fonts). Booking page has phone CTA placeholder — Stripe checkout integration is the next build step once webhook secret is provided.

### Updated Priority TODO (in order)

1. **Run migration_004 in Supabase** — bookings + website_content tables (SQL fixed, ready to run)
2. **Create Stripe webhook** in Stripe Dashboard → get `whsec_*` → add to `.env`
3. **Wire Stripe $250 checkout** into `/book` page (checkout session + webhook handler)
4. **Add Google Calendar scope** to OAuth → wire availability + date blocking
5. **Deploy website to VPS** — add to docker-compose, nginx server block for staging.hosthampton.com
6. **DNS cutover** — point www.hosthampton.com from Squarespace to VPS
7. **Agent content pipeline** — COPY writes to website_content → Next.js ISR renders it

### Files Changed This Session

- `services/intel/src/index.ts` — max_tokens 1200→2000 (commit bea59f4)
- `.gitignore` — Changed from `.claude/` to `.claude/settings.local.json` (allow agents/skills in git)
- `.claude/agents/backend-architect.md` — New (claude-code-template)
- `.claude/agents/frontend-developer.md` — New (claude-code-template)
- `.claude/skills/seo-optimizer/SKILL.md` — New (claude-code-template)
- `starting_plan/migration_004_website_booking.sql` — New: bookings + website_content tables (commits 2d132fb, 37e26a7)
- `services/website/` — **New service**: 31 files total
  - `package.json`, `next.config.js`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `Dockerfile`
  - `src/app/layout.tsx`, `src/app/globals.css`, `src/app/page.tsx`
  - `src/components/Nav.tsx`, `src/components/Footer.tsx`
  - `src/lib/utils.ts`
  - 15 page files: party-packages, party-add-ons, party-room-rental, permanent-jewelry, contact-us, events, classes, book, book/success, first-birthday-parties, communion-party, fundraiser, cm-cheer, privacy-policy, terms-of-service, return-policy, party-contract
  - `src/app/sitemap.ts`, `src/app/robots.ts`
  - `public/images/` — 12 images copied from Replit site (logo, 8 theme photos, 2 jewelry photos)

### Commits This Session
- bea59f4: fix: bump INTEL max_tokens
- 9c95934: chore: install claude-code-template agents + SEO skill
- 2d132fb: feat: add migration_004 — bookings + website_content tables
- 37e26a7: fix: migration_004 — drop existing tables before recreate
- 1eadde0: feat: scaffold Next.js website with 20 pages — full content + SEO

---

## Session 5 — 2026-02-21

### What Was Accomplished

- **Stripe $250 deposit checkout wired**: Full checkout flow — Stripe Checkout Session API with metadata (partyDate, contactName, packageName, etc.), webhook handler inserts into `bookings` table, success page.
- **Google Calendar integration**: OAuth refresh token live, availability API returns real blocked dates from calendar. Book page date picker grays out unavailable dates.
- **Stripe webhook fixed**: Webhook URL was pointing to `https://www.hosthampton.com/api/webhook/stripe` (Squarespace, wrong path). Updated to `https://staging.hosthampton.com/api/webhook` via Stripe API. Confirmed emails now fire on checkout.
- **Booking confirmation emails**: Resend sends rich branded HTML emails on `checkout.session.completed` — customer confirmation (deposit receipt, booking summary, next steps, gratuity tip) + owner notification (full booking details, Stripe PI).
- **sharp installed**: Added `sharp` to website package.json for Next.js standalone image optimization.
- **Website deployed to VPS**: Docker container on port 3002, nginx reverse proxy for staging.hosthampton.com. All returning 200.
- **Event ticketing system built**: Complete system for event ticket purchases:
  - migration_005_events.sql: events, event_sessions, event_tickets tables + RPC functions + 7 seed events from live Squarespace site
  - Public pages: /events (card grid with category filters), /events/[slug] (detail + TicketForm), /events/success
  - API routes: GET events, GET events/[slug], POST events/checkout, webhook handler for event_ticket metadata
  - Free event RSVP flow (bypasses Stripe entirely)
  - Variant pricing (JSONB array) and multi-session support (event_sessions table)
- **Admin event management dashboard**: Full admin at /admin/events with password gate (ADMIN_PASSWORD env var):
  - Event CRUD: create, update, archive (soft delete), Google Calendar sync on create
  - Attendee management: ticket list, print button, CSV download
  - Refund processing: per-ticket Stripe refund + ticket status update + available_tickets increment
  - Bulk email: compose + send to all confirmed attendees (deduplicated)
- **Board-3 theme refinements**: Updated brand tokens and typography.
- **ADMIN_PASSWORD env var**: Added to docker-compose.yml and VPS .env.

### Decisions Made

- **Variant pricing via JSONB**: Events with multiple options (e.g., Embroidery Workshop: Baseball Hat $45, Tote Bag $55) store variants as `[{label, priceCents}]` array in events table.
- **Multi-session via separate table**: Recurring events (e.g., Soft Play weekly) use `event_sessions` table with per-session dates, times, optional price overrides, and independent ticket counts.
- **Free RSVP bypasses Stripe**: $0 events insert ticket directly, decrement availability via RPC, send emails — no Stripe redirect.
- **Simple admin auth**: Bearer token matching ADMIN_PASSWORD env var. Intentionally lightweight to avoid over-engineering.
- **force-dynamic on all API routes**: Required for Next.js standalone build — prevents prerendering routes that need runtime env vars.
- **x-forwarded-host for URLs in Docker**: `req.nextUrl.origin` returns Docker internal hostname; use `x-forwarded-host || host` header instead.

### Known Issues / Blockers

- **migration_005 NOT YET RUN**: events, event_sessions, event_tickets tables don't exist yet. User must paste migration_005_events.sql into Supabase SQL Editor.
- **DNS cutover deferred**: User said "leave staging for now" — www.hosthampton.com still on Squarespace.
- **Stripe webhook URL needs update after DNS cutover**: Currently staging.hosthampton.com/api/webhook → will need to be updated to www.hosthampton.com/api/webhook.

### Current Project State

Full website live at staging.hosthampton.com with Stripe checkout, Google Calendar availability, branded confirmation emails, and event ticketing system (pending migration_005). Admin dashboard at /admin/events. All containers healthy on VPS.

### Updated Priority TODO (in order)

1. **Run migration_005_events.sql in Supabase SQL Editor**
2. **Test event ticketing end-to-end** (browse → purchase → webhook → email → admin view)
3. **DNS cutover** www.hosthampton.com → VPS
4. **Update Stripe webhook URL** to www after DNS cutover
5. **Agent content pipeline** (COPY → website_content → ISR)
6. **SEO optimization pass**

### Files Changed This Session

- `services/website/src/app/api/webhook/route.ts` — Added event_ticket metadata branch, upgraded booking email HTML
- `services/website/src/app/api/events/route.ts` — New: public event listing
- `services/website/src/app/api/events/[slug]/route.ts` — New: event detail by slug
- `services/website/src/app/api/events/checkout/route.ts` — New: checkout (free + paid)
- `services/website/src/app/api/admin/events/route.ts` — New: admin list + create
- `services/website/src/app/api/admin/events/[id]/route.ts` — New: admin get/update/delete
- `services/website/src/app/api/admin/events/[id]/tickets/route.ts` — New: ticket list
- `services/website/src/app/api/admin/events/[id]/tickets/[ticketId]/refund/route.ts` — New: refund
- `services/website/src/app/api/admin/events/[id]/email/route.ts` — New: bulk email
- `services/website/src/app/events/page.tsx` — Rewritten: server component + EventFilters
- `services/website/src/app/events/EventFilters.tsx` — New: client component with category tabs + cards
- `services/website/src/app/events/[slug]/page.tsx` — New: event detail page
- `services/website/src/app/events/[slug]/TicketForm.tsx` — New: ticket purchase form
- `services/website/src/app/events/success/page.tsx` — New: ticket confirmation page
- `services/website/src/app/admin/events/page.tsx` — New: full admin dashboard (~400 lines)
- `services/website/src/lib/supabase.ts` — New: shared Supabase client factory
- `services/website/src/lib/adminAuth.ts` — New: admin auth helper
- `services/website/src/lib/emailTemplates.ts` — New: 3 branded HTML email templates
- `starting_plan/migration_005_events.sql` — New: events + sessions + tickets + RPC + seed data
- `docker-compose.yml` — Added ADMIN_PASSWORD env var to website service
- `services/website/package.json` — Added sharp dependency

### Commits This Session

- 1d8282b: feat: wire Stripe $250 deposit checkout + availability API + VPS deploy config
- 95c53d7: chore: add website public images
- 25df74a: fix: use x-forwarded-host for Stripe success/cancel URLs
- 2b3a594: feat: send Resend confirmation emails on booking deposit
- 5c44d7f: feat: upgrade booking confirmation email + add sharp for image optimization
- 8f8bc39: feat: add event ticketing system with admin management dashboard
- bc90291: chore: add ADMIN_PASSWORD env var to website container
- 816e2c0: style(website): refine board-3 theme tokens and typography

---

## Session 6 — 2026-02-22

### What Was Accomplished

- **Jest test infrastructure built**: Installed Jest 30 + ts-jest + @types/jest + @testing-library/react + @testing-library/jest-dom. Created jest.config.ts with @/ path alias mapping.
- **72 unit tests written across 7 test suites**, all passing:
  - `emailTemplates.test.ts` (22 tests): All 3 email templates — brand styling, free/paid variants, refund reasons, first-name extraction
  - `adminAuth.test.ts` (6 tests): Bearer token validation, missing/wrong/non-Bearer auth
  - `events.test.ts` (8 tests): Public GET /api/events + GET /api/events/[slug], category filtering, session fetching
  - `checkout.test.ts` (8 tests): Free RSVP flow, Stripe checkout, variant pricing, availability checks
  - `webhook.test.ts` (5 tests): Stripe webhook — ticket creation, session ticket decrement, booking deposits
  - `adminEvents.test.ts` (15 tests): Admin CRUD, tickets list, bulk email, auth gates on all 7 endpoints
  - `refund.test.ts` (7 tests): Stripe refund, partial refund, session ticket increment, error handling
- **Mock infrastructure**: Shared fixtures (sample events, tickets, sessions), Supabase chain builder, delegating mock pattern for stable module references.
- **TESTING.md training doc**: Comprehensive guide covering test structure, mocking patterns, how to add tests, CI integration, and specific test commands. Agent-agnostic — any AI agent or human can follow it.

### Decisions Made

- **Delegating mock pattern over jest.fn() direct**: Using `const mockGetSupabase = jest.fn()` with `getSupabase: (...args) => mockGetSupabase(...args)` in `jest.mock()` factory. This survives `jest.clearAllMocks()` without breaking references — unlike `jest.resetModules()` which invalidates module-level mock imports.
- **No jest.resetModules()**: Discovered it breaks all mock references when combined with top-level module imports. Fixed all 7 test files to use `jest.clearAllMocks()` + reconfigure return values in `beforeEach`.
- **All mocked, no env vars needed**: Tests mock Supabase, Stripe, Resend, and NextResponse entirely. Can run in CI without any secrets.

### Known Issues / Blockers

- **migration_005 still NOT RUN**: events/tickets tables don't exist in Supabase yet. Events pages return empty on staging.
- **DNS cutover still deferred**: www.hosthampton.com still on Squarespace.

### Current Project State

Full test suite passing (72 tests, 7 suites) covering the entire event ticketing system. Website live at staging.hosthampton.com. Event ticketing deployed but waiting on migration_005 to populate the database. TESTING.md provides everything needed for another agent or CI to run and extend tests.

### Updated Priority TODO (in order)

1. **Run migration_005_events.sql in Supabase SQL Editor** — unblocks all event features
2. **Test events end-to-end on staging** (browse → buy → webhook → email → admin)
3. **DNS cutover** www.hosthampton.com → VPS
4. **Update Stripe webhook URL** to www after cutover
5. **SEO optimization pass** (meta tags, Open Graph, structured data for events)
6. **Agent content pipeline** (COPY → website_content → ISR)

### Files Changed This Session

- `services/website/jest.config.ts` — New: Jest config with ts-jest + @/ alias
- `services/website/package.json` — Added test/test:watch scripts, jest/ts-jest/@types/jest/@testing-library devDeps
- `services/website/TESTING.md` — New: comprehensive test training doc for agents/CI
- `services/website/src/__tests__/mocks/fixtures.ts` — New: sample events, tickets, sessions, checkout bodies
- `services/website/src/__tests__/mocks/supabase.ts` — New: mock Supabase chain builder
- `services/website/src/__tests__/mocks/nextRequest.ts` — New: mock NextRequest factory
- `services/website/src/__tests__/lib/emailTemplates.test.ts` — New: 22 tests
- `services/website/src/__tests__/lib/adminAuth.test.ts` — New: 6 tests
- `services/website/src/__tests__/api/events.test.ts` — New: 8 tests
- `services/website/src/__tests__/api/checkout.test.ts` — New: 8 tests
- `services/website/src/__tests__/api/webhook.test.ts` — New: 5 tests
- `services/website/src/__tests__/api/adminEvents.test.ts` — New: 15 tests
- `services/website/src/__tests__/api/refund.test.ts` — New: 7 tests

---

## Session 7 — 2026-02-22

### What Was Accomplished

- **Supabase MCP connection attempted**: Configured `.mcp.json` with personal access token. MCP tools never appeared in tool list. Workaround: Supabase Management API via curl (`POST https://api.supabase.com/v1/projects/ychnlroczjhwimouecxz/database/query`) works perfectly for running SQL.
- **migration_006 run via Supabase API**: Series events migration executed successfully.
- **CM Cheer fundraiser order page**: Full-fidelity port of Squarespace HTML order form to `/cm-cheer/order`. Layout hides Host Hampton nav via CSS injection. Form submits to Google Apps Script. Committed as b40d5d2.
- **Favicon added**: `H_icon_hh_*.png` files (64x64, 96x96, 240x240) added to public/images. Layout.tsx updated with icons metadata. Committed as f9479d2.
- **Glow Party landing page built**: Dark neon aesthetic page at `/glow-party` with animated hero (GlowHero.tsx), What's Included, Glow Packages (5 tiers $750-$1950), How It Works, Add-Ons, FAQ, Final CTA. Committed as 68a11d6.
- **Universal Calendar Module — full implementation**:
  - **booking_types table**: Migration 007 created + run via Supabase API. 18 booking types seeded (kids party, room rental, perm jewelry, retail, spray tan, photo shoot, etc.) with per-type slot config, deposits, allowed days, and tags.
  - **Google Calendar helper lib** (`src/lib/googleCalendar.ts`): Extracted and expanded — token refresh, fetch events, parse time blocks, create events (write-back), time utilities.
  - **Availability API upgraded**: Now returns time-slot-level granularity per booking type. Backward compatible without `bookingType` param.
  - **Booking-types API** (`/api/booking-types`): New endpoint with optional tag filtering via Supabase `.overlaps()`.
  - **UniversalCalendar component suite** (9 files): CalendarGrid (month grid with availability dots + sync indicator), TimeSlotPanel (time slot selector), EventTypeSelector (grouped pill bar: Parties/By Appointment/Events & Rentals), SummaryFooter (CTA with dynamic deposit), CalendarShell (expandable/collapsible wrapper), index.tsx (main composing component), types.ts, useBookingTypes.ts, useCalendarAvailability.ts.
  - **Book page rewritten**: HTML date/time inputs replaced with interactive UniversalCalendar. Contact form appears after date+time selection. Dynamic deposit amount in submit button.
  - **Variable deposits in checkout**: Checkout API now looks up `booking_types` for deposit_cents. Free bookings ($0 deposit) skip Stripe entirely — insert booking directly + redirect to success.
  - **Google Calendar write-back in webhook**: After booking insert, creates GCal event with `[BOOKING] Name - Type` summary, duration from booking type, full contact details in description.
  - **Dynamic deposit in confirmation emails**: Both customer and owner emails now show actual deposit amount instead of hardcoded $250.
  - **Calendar embedded on 4 service pages**: party-packages, permanent-jewelry, party-room-rental, glow-party — all with expandable calendar widget locked to the relevant booking type.
  - **93 tests passing**, clean production build (31 pages).
  - Deployed to VPS — commit 9ceb897.

### Decisions Made

- **Slot generation is computed, not stored**: Business hours config + duration → generate slots → subtract Google Calendar blocks. Avoids maintaining slot rows in DB. Works even without GCal configured.
- **Supabase Management API over MCP**: MCP server configured but never connected in tool list. Curl with PAT works reliably for running SQL. Kept `.mcp.json` in `.gitignore`.
- **showSummary prop for embedded calendar**: Book page uses `showSummary={false}` since the form has its own submit button. Service pages use default `showSummary={true}` for standalone booking CTA.
- **Free booking path in checkout API**: `requires_deposit=false` or `deposit_cents=0` → insert directly to `bookings` with status='confirmed', skip Stripe entirely.
- **Nav hiding via CSS injection**: CM Cheer order page layout uses `body > header.sticky { display: none !important; }` to hide Host Hampton nav on standalone page — cleaner than modifying root layout.

### Known Issues / Blockers

- **migration_005 still NOT RUN**: events, event_sessions, event_tickets tables don't exist in Supabase yet. Event pages return empty data on staging.
- **DNS cutover still deferred**: www.hosthampton.com still on Squarespace.
- **Supabase MCP not connecting**: `.mcp.json` configured correctly but tools don't appear. Using Management API curl as workaround.

### Current Project State

Universal calendar module fully deployed at staging.hosthampton.com. 18 booking types configured with variable deposits and per-type time slot generation synced to Google Calendar. Book page replaced with interactive calendar. Free booking path (skip Stripe) works for $0-deposit appointment types. Calendar widgets embedded on all major service pages. 93 tests passing.

### Updated Priority TODO (in order)

1. **Run migration_005** in Supabase — unblocks event ticketing on staging
2. **DNS cutover** www.hosthampton.com → VPS
3. **Update Stripe webhook URL** to www after DNS cutover
4. **SEO optimization pass** (meta tags, Open Graph, structured data)
5. **Agent content pipeline** (COPY → website_content → ISR)
6. **Test calendar end-to-end on staging** (select type → pick date/time → checkout → GCal event created)

### Files Changed This Session

**New (17):**
- `.mcp.json` (gitignored) — Supabase MCP config with PAT
- `starting_plan/migration_007_booking_types.sql` — booking_types table + 18 seed types
- `services/website/src/lib/googleCalendar.ts` — Shared Google Calendar helpers
- `services/website/src/app/api/booking-types/route.ts` — Booking types API
- `services/website/src/components/UniversalCalendar/types.ts`
- `services/website/src/components/UniversalCalendar/useBookingTypes.ts`
- `services/website/src/components/UniversalCalendar/useCalendarAvailability.ts`
- `services/website/src/components/UniversalCalendar/CalendarGrid.tsx`
- `services/website/src/components/UniversalCalendar/TimeSlotPanel.tsx`
- `services/website/src/components/UniversalCalendar/EventTypeSelector.tsx`
- `services/website/src/components/UniversalCalendar/SummaryFooter.tsx`
- `services/website/src/components/UniversalCalendar/CalendarShell.tsx`
- `services/website/src/components/UniversalCalendar/index.tsx`
- `services/website/src/app/glow-party/GlowHero.tsx` — Animated neon hero component
- `services/website/src/app/glow-party/page.tsx` — Kids Glow Party landing page
- `services/website/src/app/cm-cheer/order/layout.tsx` — Nav-hidden layout
- `services/website/src/app/cm-cheer/order/page.tsx` — Fundraiser order form

**Modified (9):**
- `.gitignore` — Added `.mcp.json`
- `services/website/src/app/layout.tsx` — Added favicon metadata
- `services/website/src/app/api/availability/route.ts` — Time-slot granularity
- `services/website/src/app/api/checkout/route.ts` — Variable deposits + free booking
- `services/website/src/app/api/webhook/route.ts` — GCal write-back + dynamic deposit emails
- `services/website/src/app/book/page.tsx` — Calendar replaces date/time inputs
- `services/website/src/app/party-packages/page.tsx` — Expandable calendar widget
- `services/website/src/app/permanent-jewelry/page.tsx` — Expandable calendar widget
- `services/website/src/app/party-room-rental/page.tsx` — Expandable calendar widget

### Commits This Session

- 9c5fa30: feat: add fundraiser lead-capture landing page
- f87e180: feat: admin event editing, variants/sessions UI, series events + bigger logo
- b40d5d2: feat: add CM Cheer fundraiser order page at /cm-cheer/order
- f9479d2: feat: add H favicon for browser tabs and Apple Touch Icon
- 68a11d6: feat: add Kids Glow Party landing page at /glow-party
- 9ceb897: feat: universal calendar module with real-time availability, variable deposits, and GCal write-back

---

## Session 8 — 2026-02-23

### What Was Accomplished

- **Site-wide visual redesign deployed (6 deploys)**: Comprehensive visual refinement across all pages, aligned to the dusty blue / bronze / ivory mood board.
- **Party packages animation removal**: Stripped all heavy-loading effects from /party-packages — sparkle particles, floating blobs, shimmer CSS, glass cards, glow effects. Page loads instantly now.
- **Smooth theme tile transitions**: Replaced hard `return null` with CSS-driven collapse/expand (opacity, scale, max-h, grid-template-rows transitions). Added `hover:shadow-lg hover:-translate-y-1` lift on hover. Added `fadeIn` keyframe.
- **Fixed glass nav with dusty blue gradient**: Nav.tsx rewritten — starts transparent, gains frosted glass (`bg-white/60 backdrop-blur-xl`) on scroll. Mobile menu changed from dropdown to full-screen centered overlay. Body gradient from #BCCDEB → #dae6f0 → #F7F2E8 in globals.css.
- **Body gradient visible on all pages**: Removed `bg-hampton-mauve` from 10 hero sections and `bg-hampton-ivory` from 10+ page wrapper divs that were blocking the body gradient.
- **Reverse gradient at page bottom**: Added 160px gradient transition div (`from-transparent to-[#BCCDEB]`) in layout before footer. Footer restyled from dark navy to dusty blue (`bg-[#BCCDEB]`) with navy text.
- **Dark navy sections → bronze/cream gradient**: All `bg-hampton-navy` content sections (5 across 4 files) changed to `bg-gradient-to-r from-hampton-pink to-hampton-pink/30` with text colors flipped to dark-on-light.

### Decisions Made

- **CSS transitions over conditional rendering**: Theme tile collapse uses opacity/scale/max-h transitions instead of `return null` — much smoother UX.
- **Fixed nav with scroll-triggered glass**: Transparent on load, frosted glass after 20px scroll. `pt-20` offset on main content.
- **Body gradient with no-repeat**: `linear-gradient(...) no-repeat` + `background-color: #F7F2E8` so gradient only covers top 600px, solid ivory below.
- **Dusty blue footer**: Mirrors the top gradient by transitioning back to #BCCDEB at the bottom. Navy text for contrast on light background.
- **Bronze-to-cream for accent sections**: `from-hampton-pink to-hampton-pink/30` replaces the dark navy (#2F343B) sections — warmer, on-brand.

### Known Issues / Blockers

- **migration_005 still NOT RUN**: events/tickets tables don't exist in Supabase yet.
- **DNS cutover still deferred**: www.hosthampton.com still on Squarespace.

### Current Project State

Full visual redesign deployed at staging.hosthampton.com. Dusty blue gradient flows from nav through hero on every page, with reverse gradient at footer. Glass nav, smooth tile transitions, bronze accent sections. 93 tests still passing. All containers healthy on VPS.

### Updated Priority TODO (in order)

1. **Run migration_005** in Supabase — unblocks event ticketing
2. **DNS cutover** www.hosthampton.com → VPS
3. **Update Stripe webhook URL** to www after DNS cutover
4. **SEO optimization pass**
5. **Agent content pipeline** (COPY → website_content → ISR)

### Files Changed This Session

**Major rewrites:**
- `services/website/src/components/Nav.tsx` — Fixed transparent/glass nav with scroll listener
- `services/website/src/components/Footer.tsx` — Dark navy → dusty blue with navy text
- `services/website/src/app/party-packages/PartyPackagesContent.tsx` — Removed all animations, added smooth tile transitions

**Modified:**
- `services/website/src/app/layout.tsx` — Added `pt-20`, gradient transition div before footer
- `services/website/src/app/globals.css` — Body gradient, fadeIn keyframe
- `services/website/src/app/page.tsx` — Removed hero bg + wrapper bg + dark section → bronze
- `services/website/src/app/book/page.tsx` — Removed hero bg + wrapper bg
- `services/website/src/app/party-room-rental/page.tsx` — Removed hero bg + wrapper bg
- `services/website/src/app/permanent-jewelry/page.tsx` — Removed hero bg + wrapper bg
- `services/website/src/app/first-birthday-parties/page.tsx` — Removed hero bg + wrapper bg + dark section → bronze
- `services/website/src/app/communion-party/page.tsx` — Removed hero bg + wrapper bg + dark section → bronze
- `services/website/src/app/fundraiser/page.tsx` — Removed hero bg + wrapper bg + 2 dark sections → bronze
- `services/website/src/app/contact-us/page.tsx` — Removed hero bg + wrapper bg
- `services/website/src/app/party-add-ons/page.tsx` — Removed hero bg + wrapper bg
- `services/website/src/app/events/page.tsx` — Removed hero bg + wrapper bg
- `services/website/src/app/events/[slug]/page.tsx` — Removed wrapper bg
- `services/website/src/app/book/success/page.tsx` — Removed wrapper bg
- `services/website/src/app/events/success/page.tsx` — Removed wrapper bg

### Commits This Session

- 297336b: feat: redesign party packages page, site-wide color refinements, phone required
- 8bd529a: fix: remove heavy animations from party-packages, add smooth theme scroll
- b811ab9: feat: smooth theme tile transitions with hover lift on /party-packages
- ec5a2de: feat: fixed glass nav with dusty blue gradient flowing into hero sections
- 3a39ff9: fix: remove bg-hampton-ivory from page wrappers so body gradient shows
- b6f914a: feat: reverse gradient at bottom of page + dusty blue footer
- 348b17d: feat: replace dark navy sections with bronze-to-cream gradient
