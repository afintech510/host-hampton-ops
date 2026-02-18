# 🏠 Host Hampton — AI Agent System Blueprint
**Built with Claude Code | Multi-Agent Architecture | v1.2**

> **v1.2 Changes:** BUILD promoted to full agent. REACH split into OUTBOUND + PAID. Marketing-first phase structure. 9 specialists total.

---

## Vision

A coordinated team of specialized AI agents that autonomously manages Host Hampton's digital presence, lead generation, content pipeline, and website — all commanded through a central chat interface.

---

## Agent Team Overview

```
┌─────────────────────────────────────────────────────┐
│              COMMAND CENTER (Chat UI)                │
│         "Talk to Host Hampton Agent"                 │
└────────────────────┬────────────────────────────────┘
                     │ orchestrates
                     ▼
┌─────────────────────────────────────────────────────┐
│              HAMPTON — Orchestrator Agent            │
│  Routes tasks, maintains brand voice, coordinates   │
│  all sub-agents, holds business memory & strategy   │
└──┬──────┬──────┬──────┬──────┬──────┬──────┬──┬────┘
   │      │      │      │      │      │      │  │
   ▼      ▼      ▼      ▼      ▼      ▼      ▼  ▼
 SOC    COPY   PIXEL  BUILD  LIST  OUTBOUND PAID INTEL
Agent  Agent  Agent  Agent  Agent  Agent  Agent Agent
```

---

## Phase Structure (Marketing-First)

> **Strategic rationale:** Host Hampton already has a working Squarespace site with HoneyBook and cal.com. The problem is leads aren't arriving. Marketing agents solve that in Phase 1. BUILD solves the website in Phase 2 once the pipeline is proven.

| Phase | Timeline | Agents Active | Goal |
|---|---|---|---|
| **1A** | Weeks 1–2 | HAMPTON · SOC · COPY · PIXEL · OUTBOUND · LIST | Social presence live, content calendar running, email/SMS sequences active |
| **1B** | Weeks 3–4 | + PAID · INTEL · Review Velocity Engine | Ads live, retargeting audiences built, analytics baseline established |
| **2A** | Month 2 | + BUILD (new website scaffold) | New Next.js site scaffolded, content migrated, staging review |
| **2B** | Month 2–3 | + BUILD (SEO landing pages, Stripe events, DNS cutover) | New site live, Squarespace cancelled, full SEO surface established |
| **3** | Month 3+ | Full team · Booking Gap Detector · Vendor Channel | All features running, agents operating autonomously |

---

## The Agent Team — Full Specs

---

### 🧠 HAMPTON — Orchestrator Agent
**Role:** Central brain. Receives all chat commands. Routes to sub-agents. Enforces brand consistency.

**Responsibilities:**
- Interprets natural language commands from owner
- Maintains Host Hampton brand voice, tone, and strategy
- Holds long-term memory: campaign history, bookings context, seasonal priorities
- Routes multi-step tasks across all 9 agents
- Surfaces reports and summaries back to owner
- Manages agent queue and priorities
- Detects escalation situations requiring human decision
- Runs Booking Gap Detector (Monday cron)

**Memory / Knowledge Base:**
- Full business profile (all 11 revenue streams)
- Brand guidelines (colors, fonts, messaging pillars)
- Seasonal calendar (summer camps, holiday markets, Valentine's, back-to-school)
- Pricing and package info
- Past campaign performance

**Approval Tier Matrix:**
| Action Type | Tier |
|---|---|
| Content drafts for review | DRAFT & SHOW |
| Scheduled social posts | AUTO-EXECUTE (within brand rules) |
| Ad budget changes | ALWAYS ASK |
| Pricing / policy decisions | ALWAYS ASK |
| New page publishes | DRAFT & SHOW |

**Tools:** MCP Memory Server, Task Queue, Supabase, Twilio (alerts)

---

### 📣 SOC — Social Media Agent
**Role:** Manages all social channels. Publishes, schedules, monitors, and responds.

**Channels:** Instagram · Facebook Page · Facebook Groups · Facebook Marketplace · Google Business Profile · Nextdoor

**Capabilities:**
- Posts feed content, carousels, Stories, Reels
- Schedules to optimal posting windows (Tue/Thu/Fri 6–8pm, Sat/Sun 10am–12pm)
- Creates Facebook Events for workshops, markets, special events
- Posts to local parenting/community groups (max 1x/week per group)
- Responds to comments and DMs
- Posts 3–4x/week to Google Business Profile (photos + updates from PIXEL)
- Mirrors IG top-performers to FB with platform-optimized copy

**Phase:** 1A

**Tools:** Meta Graph API, GBP API, scheduling queue

---

### ✍️ COPY — Content Agent
**Role:** All written content. Captions, emails, SMS, blog copy, page copy, ad creative.

**Capabilities:**
- Generates 30-day content calendars
- Writes platform-specific captions (IG vs FB vs GBP vs Nextdoor)
- Writes email sequences and SMS messages
- Writes SEO-optimized page copy for BUILD agent
- Generates meta descriptions (155 chars) for every page
- Writes Google and Meta ad copy

**Phase:** 1A

**Tools:** MCP Memory, `content_library` table

---

### 🎨 PIXEL — Image Agent
**Role:** All image and visual processing. Resize, brand, format per platform.

**Capabilities:**
- Resizes images to all platform specs (IG post, Story, Reel, FB, GBP)
- Applies brand overlays and watermarks
- Generates AI images via Replicate when needed
- Processes Squarespace CDN images for web migration (WebP format, responsive srcset)
- Provides BUILD agent with optimized image assets

**Phase:** 1A

**Tools:** Sharp MCP, Replicate (AI image gen), Filesystem MCP

---

### 🌐 BUILD — Website Agent
**Role:** Owns, builds, and maintains the entire hosthampton.com digital presence as code.

> **v1.2 change:** BUILD is promoted from "Builder Bridge" tool to a full named agent on the team. BUILD is the website — it writes code, manages the GitHub repository, deploys via Vercel, and owns the full digital presence at the infrastructure layer.

**Responsibilities:**
- Scaffolds and maintains Next.js 14 (App Router) codebase
- Builds all core pages, theme pages, and location landing pages
- Implements SEO (titles, meta, structured data, internal linking)
- Integrates Stripe for event ticket sales and party deposits
- Wires lead capture forms to Supabase contacts table
- Deploys preview branches to Vercel; surfaces preview URLs to HAMPTON
- Merges to main after approval (or 4-hour DRAFT & SHOW timeout)

**Tech Stack:**
- Framework: Next.js 14 (App Router + static generation)
- Hosting: Vercel (free tier)
- Version Control: GitHub (via GitHub MCP)
- Styling: Tailwind CSS (brand tokens in tailwind.config.ts)
- Event Sales: Stripe Checkout
- Party Booking: HoneyBook embed (unchanged — do not replace)
- Event Scheduling: cal.com embed (unchanged — do not replace)
- Lead Capture: Custom forms → Supabase contacts table
- Analytics: GA4 + Vercel Analytics + Meta Pixel
- DNS/CDN: Cloudflare (existing)

**Approval Tier:**
- New page publishes: DRAFT & SHOW
- Content edits to existing pages: AUTO-EXECUTE
- Navigation, pricing, or structural changes: ALWAYS ASK

**Phase:** 2A (contributes landing page briefs to Phase 1 content strategy)

**Collaborates with:** COPY (page copy), PIXEL (image assets), LIST (lead forms → Supabase), INTEL (SEO performance), PAID (conversion tracking)

**Tools:** GitHub MCP, Vercel MCP, Stripe API, Supabase MCP

---

### 📋 LIST — CRM & Audience Agent
**Role:** Owns the customer database, segments audiences, manages email list health, builds retargeting lists.

**Capabilities:**
- Adds and deduplicates contacts from all sources
- Maintains 13 audience segments
- Runs daily lead scoring and status updates
- Builds and syncs Facebook Custom Audiences and Lookalike Audiences
- Manages email list hygiene (bounces, re-engagement, opt-in compliance)
- Tags contacts with source, service interest, and campaign

**Phase:** 1A

**Tools:** Supabase contacts, Mailchimp, Meta Custom Audiences

---

### 📧 OUTBOUND — Email & SMS Agent
**Role:** Manages all outbound sequences — welcome, nurture, post-event, vendor, and re-engagement.

> **v1.2 change:** Split from REACH. OUTBOUND owns lifecycle messaging and direct outreach sequences. PAID owns paid advertising.

**Capabilities:**
- Manages welcome email sequences (3-email series for new inquiries)
- Manages post-booking prep series and post-event follow-up
- Manages re-engagement campaigns for dormant contacts
- Triggers Review Velocity Engine (post-booking SMS → review request)
- Runs school/PTA/business direct outreach campaigns
- All sends coordinated with LIST agent segmentation

**Phase:** 1A

**Tools:** Mailchimp / Resend API, Twilio API

---

### 💰 PAID — Advertising Agent
**Role:** Meta and Google paid campaigns. Campaign creation, audience targeting, budget management, ROI tracking.

> **v1.2 change:** Split from REACH. PAID owns all paid media spend.

**Capabilities:**
- Manages Meta Ads (FB/IG) campaigns and retargeting
- Manages Google Ads search campaigns
- Builds initial audiences: website visitors, IG engagers, email list lookalikes
- Monitors and optimizes ad performance (pauses underperformers, scales winners)
- Reports weekly ROAS, CPL, and booking attribution to INTEL
- Never exceeds HAMPTON-approved daily budget without owner confirmation

**Phase:** 1B

**Tools:** Meta Ads API, Google Ads API

---

### 📊 INTEL — Analytics & Insights Agent
**Role:** Tracks all performance data across every channel. Surfaces actionable insights. Weekly reports.

**Capabilities:**
- Pulls GA4, Meta Insights, GBP Insights, Supabase analytics
- Identifies top-performing content
- Flags booking calendar gaps needing campaigns
- Tracks seasonal trends vs. prior periods
- Performs pre-launch SEO audits (with BUILD)
- Monitors anomalies: ad CPL spikes, engagement drops, zero-booking windows
- Delivers weekly report template to HAMPTON

**Phase:** 1B

**Tools:** GA4, Meta Insights, GBP Insights, Supabase analytics

---

## Website Architecture (Phase 2)

### Page Architecture — 12 Core Pages + Landing Page Factory

| Page / Route | Type | SEO Target |
|---|---|---|
| `/` | Marketing homepage | 'birthday party venue Long Island' + brand |
| `/kids-parties` | Service hub | 'kids birthday party venue Speonk NY' |
| `/kids-parties/[theme]` | 10x theme pages | 'Swiftie party Long Island', 'glow party kids Suffolk County', etc. |
| `/permanent-jewelry` | Service page | 'permanent jewelry Long Island', 'permanent bracelet near me' |
| `/party-room-rental` | Service page | 'rent party room Suffolk County', 'studio rental Speonk' |
| `/host-your-client` | B2B page | 'event space rental Long Island', 'pop-up space Hamptons' |
| `/fundraiser` | Program page | 'school fundraiser Long Island', 'easy fundraiser ideas Suffolk County' |
| `/trucker-hat-bar` | Service page | 'custom trucker hats Long Island', 'hat customization party' |
| `/workshops-events` | Events hub | 'workshops near me Speonk', 'adult events Long Island' |
| `/book` | Booking hub | Conversion page — all booking embeds in one place |
| `/[location]` | Location pages | 'birthday party venue Southampton', 'Riverhead kids party', etc. |
| `/blog` | Content hub | Long-tail: 'how to plan a kids birthday party Long Island' |

### E-Commerce Scope (Events Only)
Per owner direction: retail (gift shop) is excluded. Transactions processed through the new site:
- **Event ticket purchase** → Stripe Checkout → confirmation → Supabase contacts + Mailchimp
- **Party deposit ($200)** → Stripe Checkout → booking confirmed in Supabase
- **Fundraiser mockup request** → Form only (no payment) → Supabase → OUTBOUND follow-up
- **Permanent jewelry appointment** → cal.com (unchanged)

---

## Chat Interface — Command Examples

```
Owner: "Post something about our Swiftie party this weekend — use the photos from last week"
→ HAMPTON routes to PIXEL (resize photos) + COPY (write caption) + SOC (schedule for Fri 6pm)

Owner: "Create a spring birthday campaign targeting parents with kids 5-12, Speonk to Riverhead, lead with Glow Party and Swiftie Party"
→ COPY writes email sequence + social posts
→ PIXEL creates graphics
→ SOC schedules 2-week rollout
→ OUTBOUND activates email + SMS sequences
→ PAID sets up targeted Meta campaign
→ LIST segments email list for parents with kids 5-12

Owner: "Build a retargeting list from everyone who visited our website last 90 days"
→ LIST pulls pixel data, creates FB Custom Audience, adds to PAID retargeting campaign

Owner: "What's our best performing content this month?"
→ INTEL pulls analytics report, surfaces top 5 posts + engagement stats

Owner: "Build the fundraiser landing page"
→ HAMPTON routes to BUILD (Phase 2) → BUILD creates preview branch → surfaces Vercel URL
```

---

## Party Package Catalog (Confirmed via Site Audit)

| Package | Price | Guests | Key Differentiator |
|---|---|---|---|
| Spa Party | $850 | 10 + b-day | Robes, manicure, hair, makeup, nail polish craft |
| Swiftie Party | $850 | 10 + b-day | Karaoke, friendship bracelets, hair tinsel, glitter |
| Barbie Party | $850 | 10 + b-day | Life-size Barbie box, fashion show, sunglasses craft |
| Unicorn Party | $850 | 10 + b-day | Unicorn headbands, glitter makeup, craft activity |
| Slime Party | $900 | 10 + b-day | Slime making station, custom containers, karaoke |
| Trucker Hat / Custom Pouch | $900 | 10 + b-day | Iron-on patches, photo booth with instant text |
| Sweets-n-Treats | $800 | 10 + b-day | Custom apron, cupcake/cookie decorating |
| Toddler Party | $850 | 10 + b-day | Soft play area, ball pit, climber, theme table |
| Glow Party | $950 | 10 + b-day | Black lights, neon face paint, DJ, glow favors |
| K-Pop Demon Hunter | $900 | 10 + b-day | Karaoke, dance zone, hair tinsel, neon backdrop |

---

*Agent System Blueprint v1.2 | Host Hampton | February 2026 | Supersedes v1.0*
