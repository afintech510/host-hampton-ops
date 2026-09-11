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
- [ ] **Migrate remaining hardcoded prices** to pricing_items table
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
- [x] Phase 2 — SMS review loop (SEND / EDIT / TEST / CANCEL) + real send via Resend + Quo; Quo webhook fail-closed + dedupe + unknown senders become contacts; `lib/agent/{reviewers,reviewLoop,sendApproved}.ts`, `inquiry_draft` as a GATED graph entity, 2h business-hours nudge, admin Send/Test; migration_034. **Deployed 2026-09-11.**
- [ ] Phase 3 — permanent Gmail ingestion (own OAuth refresh token, `/api/cron/gmail-sync`) + triage (ignore marketing/vendor)
- [ ] Phase 4 — every lead is a Party Plan (`bookings.status='lead'`, `party_type`), one planner for theme/mobile/studio, pricing single-sourced in `pricing_items`; migration_035
- [ ] Phase 4.5 — **Lead Thread Workspace** (Adam's ask, 2026-09-11): `/admin/lead/[ref]` as Allie's lead-management interface — unified timeline per lead, chat composer that re-drafts in plain English, tone chips (warmer / mom-to-mom / shorter), inline SMS+email editing, Approve & send, plan panel linking the party planner and invoice. **Blocked on per-user admin login** (`admin_users`) — today every admin approval logs as the anonymous actor 'ADMIN'. `/review/[token]` stays read-only (a forwardable token must never approve a send). See plan §11.
- [ ] Phase 5 — `/plan/[ref]/summary` DB-rendered invoice page (locked template design) + extracted `PayPanel` with embedded Stripe; "Email me this"; persisted pay links
- [ ] Phase 6 — learning loop: reviewer-edit capture, weekly distill into `agent_learnings` + voice profile v2; migration_036

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
