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
- [ ] **Run migration_004 in Supabase SQL Editor**
- [ ] **Create Stripe webhook** → get `whsec_*` signing secret
- [ ] **Wire Stripe $250 deposit checkout** into /book page
- [ ] **Google Calendar integration** (availability check + date blocking)
- [ ] **Deploy website to VPS** (Docker + nginx staging.hosthampton.com)
- [ ] **DNS cutover**: www.hosthampton.com from Squarespace → VPS
- [ ] **Agent content pipeline**: COPY → website_content → ISR → published pages

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
