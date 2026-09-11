# Host Hampton Ops — Master Plan

## Phase 1A: Core Orchestrator + Agents ✅ COMPLETE

- [x] HAMPTON orchestrator (Express + WebSocket + Redis pub/sub)
- [x] Redis infrastructure
- [x] SOC agent (social listening, comment scanning)
- [x] COPY agent (content writing → content_library)
- [x] IMAGE agent (Replicate image gen — working)
- [x] LIST agent (email list management)
- [x] OUTBOUND agent (email/SMS dispatch + Resend integration)
- [x] Docker Compose on VPS (5.161.88.134)
- [x] Cloudflare SSL (Full Strict) with Origin Certificate
- [x] CORS fix (Express-only, no nginx CORS headers)
- [x] Dashboard at app.hosthampton.com (VPS Docker → nginx proxy)
- [x] Approval gate (AUTO_EXECUTE / DRAFT_AND_SHOW / ALWAYS_ASK)
- [x] History tab (completed/failed task log)
- [x] Content Library tab (content_library browser)

## Phase 1B: Immediate Fixes + Unblocking ✅ COMPLETE

- [x] Deploy latest commits to VPS
- [x] Verify approve/reject buttons work
- [x] Verify Content tab populates
- [x] Unblock IMAGE agent

## Phase 1C: Testing & Validation ✅ COMPLETE

- [x] Test approval workflows end-to-end (DRAFT_AND_SHOW + ALWAYS_ASK)
- [x] Populate agent_memory (brand voice, services, campaigns — 10 entries seeded)

## Phase 2: INTEL Agent + Resend ✅ COMPLETE

- [x] INTEL agent built and deployed (GA4 + internal metrics + Claude reports)
- [x] GA4 OAuth2 credentials working (live data: 534 sessions/wk)
- [x] OUTBOUND Resend email sending live
- [x] Dashboard Reports tab (surface analytics from agent_memory)
- [x] nginx DNS resolver fix (127.0.0.11 valid=5s)

## Phase 3: Website Redesign + Booking ← CURRENT

- [x] Next.js 14 website scaffolded (20 pages, build succeeds)
- [x] Brand design finalized (Dusty Blue/Blush/Ivory, Libre Baskerville + Poppins)
- [x] SEO foundations: sitemap.xml, robots.txt, schema.org LocalBusiness JSON-LD
- [x] migration_004 written (bookings + website_content tables)
- [x] Claude Code templates installed (frontend-dev, backend-architect, SEO skill)
- [x] **Run migration_004 in Supabase** — bookings + website_content tables
- [x] **Create Stripe webhook** → whsec signing secret configured
- [x] **Wire Stripe deposit checkout** into /book page ($99 default deposit)
- [x] **Google Calendar integration** (availability + date blocking + write-back)
- [x] **Deploy website to VPS** (Docker + nginx staging.hosthampton.com)
- [x] **Event ticketing system** — migration_005 + events/sessions/tickets + admin dashboard
- [x] **Universal Calendar Module** — 18 booking types, variable deposits, GCal sync
- [x] **Pricing database** — pricing_items table (87 items), /api/pricing, /party-menu page
- [x] **Visual redesign** — dusty blue gradient, glass nav, bronze accent sections
- [x] **Homepage theme tiles** — image slider, mini party pricing, two-tier card, scroll-to-panel, updated CTAs
- [x] **kids-party-menu** — DIY rental section (collapsible) + food/balloon qty adjusters
- [x] **Book page UX** — show form/themes immediately on party type select (no timeslot wait)
- [x] **DNS cutover**: www.hosthampton.com from Squarespace → VPS ✅ (2026-03-07)
- [x] **Admin UI modernization**: Sidebar nav, Dashboard tab, KPI cards, glass login
- [x] **Financials system**: financial_transactions table, CSV import (GoDaddy/Squarespace/HoneyBook), Stripe auto-record, server-side aggregation, timeframe selector, category filter, inline category editing
- [x] **Email sequences engine**: 4 active sequences, cron processor, 13 enrollment points
- [x] **Update Stripe webhook URL** to `https://www.hosthampton.com/api/webhook` ✅ (we_1T7ckv02uXWznKaWMiPeXCCf)
- [x] **Run migration_005 in Supabase** — event ticketing live ✅
- [x] **CM Cheer Fundraiser**: Order form at `/cm-cheer`, organizer dashboard at `/cm-cheer/orders`, Supabase DB + RLS, local product photos, mobile-optimized, notes field, CSV export
- [~] **Migrate remaining hardcoded prices** to pricing_items table — Mobile tiers, studio rate card and the party-planner constants moved in migration 036 behind `lib/pricingCatalog.ts` (2026-09-11)
- [x] **OG image support for event pages** — dynamic openGraph metadata from DB images
- [ ] **SEO optimization pass** (meta tags, Open Graph on remaining pages, structured data)
- [ ] **Agent content pipeline**: COPY → website_content → ISR → published pages

## Phase 3B: Communications Infrastructure ✅ COMPLETE

- [x] Brevo REST API wrapper (bulk email campaigns, contact sync)
- [x] Twilio REST API wrapper (SMS/MMS with opt-in check)
- [x] SMS templates (event reminders, booking reminders, confirmations)
- [x] Email templates (reminders, newsletters, marketing)
- [x] Reminder engine (auto-enqueue on ticket purchase + booking)
- [x] Cron routes (send-reminders, send-campaigns, draft-newsletter)
- [x] Webhook handlers (Brevo bounces/unsubscribes, Twilio STOP/HELP/inbound)
- [x] TCPA/CTIA/10DLC compliance (Privacy Policy, Terms of Service, consent checkboxes)
- [x] Admin Contacts tab (list/filter/search, detail, edit status/notes/opt-in)
- [x] Admin Campaigns tab (CRUD, Brevo send, draft newsletter, process reminders)
- [x] Webhook bug fixes (interaction_type → type in Brevo + Twilio handlers)
- [x] Marketing consent checkboxes on all lead/contact forms
- [x] Contact export for Google Ads / Meta retargeting (CSV download)
- [x] 178-test suite across 15 suites (all API routes covered)
- [ ] Configure Brevo (API key, contact list, DNS records, webhook URL)
- [ ] Configure Twilio webhook URL in console
- [x] Set up external cron service (cron-job.org, every 15 min) ✅ (4 jobs running)

## Phase 3C: Booking Agent ← CURRENT (plan: `docs/booking-agent-plan.md`)

- [x] Phase 0 — `inquiry_drafts` schema (migration_028), classifier + required-info gate (`lib/inquiryDrafts.ts`, 24 tests)
- [x] Phase 1 — lead trigger → Claude draft → SMS to reviewers (stub send); `lib/agent/{config,events,voice,reviewLink,draftInquiry}.ts`, `/api/cron/agent-dispatch`, `/review/[token]`, admin Inbox tab + `/api/admin/agent`; migrations 032 + 033. **Live 2026-09-11** (reviewed and fixed in 912111c: sweep re-draft loop, claim reaper, budget re-queue, money guardrail).
- [x] Phase 2 — SMS review loop (SEND / EDIT / TEST / CANCEL) + real send via Resend + Quo; Quo webhook fail-closed + dedupe + unknown senders become contacts; `lib/agent/{reviewers,reviewLoop,sendApproved}.ts`, `inquiry_draft` as a GATED graph entity, 2h business-hours nudge, admin Send/Test; migration_034. **Deployed 2026-09-11**, then reviewed and fixed in 361c57d: the parser ate a trailing number out of a revision note, a quoted iPhone reply was parsed as intent, the send had a double-send window (per-channel claim now precedes the send), an impossible channel stranded a draft at `approved`, and an approval naming an out-of-context draft now confirms once.
- [x] Phase 3 — permanent Gmail ingestion + triage. `lib/gmail.ts` (read + label only, its own OAuth grant, no send scope), `/api/cron/gmail-sync` (history checkpoint with a bounded `newer_than:2d` fallback, both directions ingested, `?backfill=1` for the 12-month corpus pull), `lib/agent/triage.ts` (free sender filter → Haiku, schema-enforced, category-gated so an injected body cannot make itself actionable), dispatcher wiring, cron-job.org job 8429172. No migration needed — 032 already had `gmail_sync_state`. **Reviewed and fixed 2026-09-11 in a2dd707**: `sent_at` was ingestion time so the backfill made every outbound row look newer than any inbound question (the stand-down check silently over-firing); the history checkpoint had no poison-message escape and could stall the mailbox permanently; an injected email body reached the *draft* prompt un-fenced, now fenced plus an output-side `containsForeignContact()` park; admin "Draft now" had no age check over 270 backfilled messages; and the Handled label was split into Seen (ingestion) + Handled (drafted). Plus a sixth, the one that mattered most: an injected email body could steer a QUOTE-path draft into a fabricated promise ("your deposit is waived", a $1 total) that no existing guardrail could see — `containsMoney()` only ever ran on info-gather, and a waived deposit names no figure. `containsFabricatedTerms()` parks it. Also: `bookings.contact_id` never existed, so thread→plan linking had never worked — added in migration 035 §9.
- [~] Phase 4 — every lead is a Party Plan. **Items 1–3 deployed 2026-09-11**: migration 035 applied (status CHECK with `lead`/`quoted`, `party_type` backfilled over all 41 rows, `source`, `first_touch_event_id`, `invoice_number` + `invoice_number_seq` from 444124-000116, `booking_pay_links`, check/other payment methods, and the four NOT NULLs a lead can't satisfy relaxed behind a reachability CHECK and a `scheduled_fields` CHECK that re-imposes them past `quoted`); `lib/plan.ts` (`buildPlanSnapshot` / `planTotals` / `writeLineItems` / `ensureLeadPlan` with the 30-day reuse rule); all seven intake routes create or reuse a plan **before** recording the event so the dispatcher's booking sweep can't double-draft; `quote/save` writes real `booking_line_items`; the three divergent `quote_snapshot` writers collapsed onto the shared builder; 34 new tests.
  - **Items 4, 5 and 6 deployed 2026-09-11** (plan §14). **Item 4** — migration 036 (data only, 46 rows across four new `pricing_items` categories) + `lib/pricingCatalog.ts`: the Mobile tiers, studio rate card and the planner's inline constants are DB rows keyed by `metadata->>'catalog_key'`, with the pre-036 constants kept as a per-field fallback so a broken table renders today's prices rather than $0. `studioRentalRateWith(rates, …)` keeps the rate engine synchronous for the two client components that re-price interactively; `lib/mobilePricing.ts` deleted; the three mobile marketing routes gained `revalidate = 3600` because they prerender at build time where `SUPABASE_URL` does not exist. Surfaced (not fixed — Adam's call) that the planner's $400 mobile base and the published $500 Entry tier are two different products that had never been in the same file. **Item 5** — pipeline header + `party_type` filter + live stage counts in `PartiesTab`, `lib/pipelineStages.ts` shared with the API, and "Draft reply with agent" (`lib/agent/manualDraft.ts`) for phone leads, which enqueues a real event and takes it through the dispatcher's own `claimInboundEvent()` behind four anti-double-draft layers. Fixed: the route's `event_type` allowlist was showing **32 of 41** party rows, hiding four `room-rental` studio bookings, three `'Kids Birthday Party'` rows and both mobile leads. **Item 6** — `mergeInquiry()` so the draft node evaluates the plan *and* the message (it was reading `event.parsed` alone despite the event carrying a `booking_id`, so a returning customer was re-asked for a date we already had), plus `lib/agent/extractPlanFields.ts`: a prose reply is read for the missing fields only, validated locally, written blanks-only, and the gate re-run. 77 new tests (703 total). Then two fixes from the Phase 3 review session handoff: extraction had opened a prompt-injection hole through the *structured* half of the draft prompt (`contact_name` and the new free-text-date hint are unfenced, and a newline in either forges a section header — `flattenToOneLine()` now flattens at both the extraction source and the prompt boundary, which also closes the pre-existing form-field path), and `bookings.first_touch_event_id` is finally written via `linkFirstTouchEvent()`, guarded fill-once because the plan is necessarily created before the event exists. **Reviewed adversarially 2026-09-11** (plan §16): the ordering contract held across all eight writers and the manual-draft precheck matches the partial unique indexes exactly, but six things around them were wrong — `findOpenPlan` built a PostgREST `or()` out of raw customer input (confirmed live: a crafted email adds a disjunct and returns a stranger's bookings, which `enrichPlan` would then write onto), phone matching was raw string equality so the person who texts then fills in the form got a SECOND plan and a second text, a third prompt-injection door ran through `classifyPartyType`'s `reason` quoting customer-written `package_type` into the trusted half, the `<their_message>` fence could be closed by the data inside it, `applyExtractedFields` wrote unguarded after its own blankness read, and the "a fallback is never cached" rule was false for a row that exists and prices at 0. **Remaining in Phase 4**: the planner product switch (load any plan by ref, make the studio/mobile sections a real product selector) — folded into Phase 4.5's plan panel, which is where it gets used.
- [ ] **Mobile pricing rework** (Adam, 2026-09-11) — spec in plan §15, **blocked on Adam's numbers**. Stop publishing a firm mobile rate card; base price as a table by guest band (10/15/20/25) with craft stations priced per band; location as a real rule, not "a modest mileage charge". **Live gap worth knowing: the site publishes $500/8 and $750/12 ($62.50/child) while Adam's target is $850/10 ($85/child), and the planner charges less still — every mobile booking today is underpriced against intent.** The catalog from migration 036 is the right substrate: band grids fit in `pricing_items.metadata` with no DDL.
- [ ] Phase 4.5 — **Lead Thread Workspace** (Adam's ask, 2026-09-11): `/admin/lead/[ref]` as Allie's lead-management interface — unified timeline per lead, chat composer that re-drafts in plain English, tone chips (warmer / mom-to-mom / shorter), inline SMS+email editing, Approve & send, plan panel linking the party planner and invoice. **Blocked on per-user admin login** (`admin_users`) — today every admin approval logs as the anonymous actor 'ADMIN'. `/review/[token]` stays read-only (a forwardable token must never approve a send). See plan §11.
- [~] Phase 5 — **the summary page is live (2026-09-11); the pay path is not.** `/plan/[ref]/summary` server-renders the invoice from the DB in the exact section order of `invoices/_template.html` (locked header + services bar, client/event grid, featured + line items with descriptions and Optional tags, Total and Balance Due, the deposit callout OUTSIDE the totals, What's Included studio-only, good-to-know/policies per `party_type`, payment block, mobile menu appendix, locked footer). Gated on the `hh_portal` cookie naming THAT ref; the magic link may redirect here because `/api/portal/auth` matches the path against the ref it just authenticated, so the allowlist stays closed. **migration 037** adds `plan_content` (the invoice's prose per party type, moved out of SKILL.md) with a compiled fallback, `lib/planContent.ts` + `lib/planInvoice.ts` (view model: the studio rule — Balance Due = full Total, deposit separate — and optional items quoted but never totalled) + `lib/invoiceNumber.ts` (issued on FIRST RENDER so a lead that never quotes burns nothing; idempotent on refresh, and two tabs agree on one number). Mobile menu chips are the 26 migration-036 `mobile-station` rows, priceless by construction, minus anything already billed. 26 new tests. **NOT built, deliberately: `PayPanel`, "Email me this", admin "Send to client", `booking_pay_links` persistence and the payment_link webhook match** (items 2-4) — a page that takes money without recording it, or a button that mails a customer without review, is worse than a smaller finished slice. Native admin viewing is also deferred: admin auth is a shared password in `localStorage`, so a server component cannot recognise an admin without the `admin_users` work Phase 4.5 already blocks on. Admins open the plan's portal link meanwhile.
- [ ] Phase 6 — learning loop: reviewer-edit capture, weekly distill into `agent_learnings` + voice profile v2; **migration_038** (036 was taken by the Phase 4 pricing catalog seed and 037 by Phase 5's `plan_content`, both of which shipped first)

## Phase 4: Campaign Automation

- [ ] Social content calendar auto-generation (COPY + SOC)
- [ ] Automated Instagram posting via Meta API (OUTBOUND) — needs META credentials
- [ ] Email campaign sequencing (LIST + OUTBOUND)
- [ ] Google Business Profile post automation

## Phase 5: Memory + Learning

- [ ] Memory update pipeline: agents write back learnings post-task
- [ ] A/B content testing (COPY generates variants, INTEL tracks performance)

## Future: Multi-Business Scaling

- Branch-per-business model (not SaaS multi-tenant)
- Same codebase, different .env + Supabase + agent_memory seed data
- Target businesses: MyGravelGuy.com, Eastern Landscape (easternlm.com)
