# 🔌 MCP Server List — Host Hampton Agent System
**Model Context Protocol Servers | Claude Code Integration | v1.2**

> **v1.2 Changes:** GitHub MCP added (for BUILD agent). Builder Bridge MCP retired — BUILD communicates directly with HAMPTON via the standard task queue. REACH split into OUTBOUND + PAID (no new MCP servers required — same APIs, different agents).

---

## Overview

Each MCP server extends HAMPTON and the agent team with real-world tool access. Servers are grouped by function. Some are pre-built community servers; others require custom builds.

**Legend:**
- ✅ Pre-built — available now (npm install or GitHub)
- 🔨 Custom Build — needs to be built for this project
- 🔗 API Required — needs platform API credentials
- ⚠️ Limitations — has known constraints noted

---

## 1. Core Infrastructure MCP Servers

### 1.1 Memory Server
**Purpose:** Persistent long-term business knowledge for all agents

```bash
npm install @modelcontextprotocol/server-memory
```

**Namespace Plan:**
```
brand.*, services.*, campaigns.*, social.*, crm.*, 
calendar.*, analytics.*, market.*, operations.*,
vendor_referrals.*, review_velocity.*, gap_fill_rules.*
```

> **v1.2:** Three new namespaces added: `vendor_referrals`, `review_velocity`, `gap_fill_rules`

**Used by:** All agents (HAMPTON loads context before every task)

**Priority:** 🔴 Build First — nothing else works well without this

---

### 1.2 Filesystem Server
**Purpose:** Read/write files — images, templates, content drafts, exports

```bash
npm install @modelcontextprotocol/server-filesystem
```

**Folders to mount:**
```
/assets/           → raw photos, videos (migrated from Squarespace CDN)
/processed/        → PIXEL agent output (platform-sized images, WebP)
/templates/        → brand graphic templates
/content/          → COPY agent drafts
/exports/          → email HTML, ad copy
/reports/          → INTEL agent output
```

**Used by:** PIXEL, COPY, BUILD, INTEL

**Priority:** 🔴 Build First

---

### 1.3 Supabase Server
**Purpose:** Primary database — CRM, content library, campaign tracking, analytics

```bash
npm install @supabase/mcp-server-supabase
```

**Key Tables:**
```sql
contacts              -- CRM: leads, customers, past bookers
contact_tags          -- segmentation labels
campaigns             -- campaign metadata + status
content_library       -- approved posts, captions, graphics
email_sequences       -- automated sequence configs
analytics_events      -- all tracked interactions
bookings              -- synced from booking system
ad_performance        -- Google + Meta ad data
tasks                 -- inter-agent task queue
escalations           -- human escalation records
review_requests       -- Review Velocity Engine tracking
booking_gap_events    -- Booking Gap Detector records
content_snapshots     -- Squarespace migration snapshots
landing_pages         -- BUILD agent page tracking
stripe_transactions   -- event ticket + deposit payments
```

> **v1.2 additions:** `content_snapshots`, `escalations`, `review_requests`, `booking_gap_events`, `stripe_transactions`

**Used by:** LIST, COPY, INTEL, OUTBOUND, PAID, HAMPTON, BUILD

**Priority:** 🔴 Build First

---

### 1.4 Task Queue Server (Custom)
**Purpose:** Manages inter-agent task manifests, dependencies, status tracking

🔨 **Custom Build Required**

```typescript
// MCP tools to expose:
tools: [
  "create_task",        // HAMPTON creates tasks for agents
  "update_task_status", // agents report completion
  "get_pending_tasks",  // agents poll for assigned work
  "get_task_output",    // downstream agents fetch upstream results
  "list_active_tasks",  // owner can see what's in progress
  "cancel_task"         // owner or HAMPTON can abort
]
```

**Task output format (BUILD agent):**
```json
{ 
  "agent": "BUILD", 
  "task_id": "...", 
  "status": "awaiting_review",
  "preview_url": "https://hosthampton-*.vercel.app",
  "summary": "Built /fundraiser page with SEO copy",
  "approval_tier": "DRAFT_AND_SHOW"
}
```

**Storage:** Supabase `tasks` table

**Used by:** HAMPTON (writes), all agents (read + update)

**Priority:** 🔴 Build First

---

## 2. Social Media MCP Servers

### 2.1 Meta Graph API Server (Custom)
**Purpose:** Instagram and Facebook posting, scheduling, and insights

🔨 **Custom Build Required**
🔗 **API Required:** Meta App with Graph API permissions

```typescript
tools: [
  "ig_post_image",          // single image post
  "ig_post_carousel",       // multi-image carousel
  "ig_post_story",          // story (24hr)
  "ig_post_reel",           // reel video
  "ig_schedule_post",       // schedule for future time
  "ig_get_insights",        // reach, impressions, engagement
  "fb_post_page",           // Facebook Page post
  "fb_create_event",        // Facebook Event
  "fb_post_group",          // post to a group
  "fb_get_page_insights",   // page performance
  "meta_get_comments",      // fetch comments for moderation
  "meta_reply_comment"      // reply to comment
]
```

**Used by:** SOC Agent

**Priority:** 🔴 Build First (Phase 1A)

---

### 2.2 Google Business Profile Server (Custom)
**Purpose:** GBP posts, photo uploads, Q&A management, insights

🔨 **Custom Build Required** (wraps Google My Business API)
🔗 **API Required:** Google Cloud project, GMB API enabled

```typescript
tools: [
  "gbp_create_post",        // GBP update post
  "gbp_upload_photo",       // add photo to listing
  "gbp_get_insights",       // views, clicks, calls
  "gbp_respond_review",     // reply to Google review
  "gbp_post_offer",         // promotional post type
  "gbp_post_event"          // event post type
]
```

**Used by:** SOC Agent

**Priority:** 🟡 Build Phase 1A (after Meta)

---

### 2.3 Nextdoor Server
**Purpose:** Post to Nextdoor neighborhood feed for hyperlocal reach

⚠️ **Limitations:** No official API — requires browser automation or manual posting
🔨 **Custom Build Required** if automating

**Strategy:** Use SOC agent to draft posts; human-assisted posting or scrape-based automation

**Used by:** SOC Agent (drafts), owner (posts manually until API solution exists)

**Priority:** 🟢 Phase 1B (manual fallback acceptable)

---

## 3. Communication MCP Servers

### 3.1 Mailchimp / Email Server
**Purpose:** Email sequence management, campaign sending, list sync

✅ **Pre-built option available:**
```bash
npm install @modelcontextprotocol/server-mailchimp
# or use Resend for transactional + Mailchimp for marketing
```

```typescript
tools: [
  "email_subscribe",            // add contact to list
  "email_unsubscribe",          // remove/suppress contact
  "email_send_campaign",        // send broadcast email
  "email_create_sequence",      // create automation sequence
  "email_enroll_contact",       // add contact to automation
  "email_get_campaign_stats",   // open rate, click rate, bounces
  "email_sync_segment"          // sync Supabase segment to Mailchimp list
]
```

**Used by:** OUTBOUND Agent, LIST Agent

**Priority:** 🔴 Build First (Phase 1A)

---

### 3.2 Twilio SMS Server
**Purpose:** SMS sequences, booking confirmations, review requests, owner alerts

✅ **Pre-built option:**
```bash
npm install @modelcontextprotocol/server-twilio
```

```typescript
tools: [
  "sms_send",               // send single SMS
  "sms_schedule",           // schedule SMS for future
  "sms_get_replies",        // fetch inbound SMS replies
  "sms_opt_out_check"       // verify contact hasn't opted out
]
```

**Used by:** OUTBOUND Agent (sequences), HAMPTON (owner alerts)

**Priority:** 🔴 Build First (Phase 1A — Review Velocity Engine depends on this)

---

## 4. Paid Advertising MCP Servers

### 4.1 Google Ads Server
**Purpose:** Manage Google Ads campaigns, track performance, optimize spend

🔨 **Custom Build Required** (wraps Google Ads API)
🔗 **API Required:** Google Ads API access, MCC account

```typescript
tools: [
  "gads_create_campaign",
  "gads_create_ad_group",
  "gads_create_ad",
  "gads_set_keywords",
  "gads_pause_campaign",
  "gads_get_performance",
  "gads_adjust_budget",
  "gads_get_search_terms",
  "gads_create_audience",
  "gads_get_recommendations"
]
```

**Initial Campaigns:**
| Campaign | Keywords | Budget |
|---|---|---|
| Birthday Venues | "birthday party venue long island", "kids party place near me" | $15/day |
| Permanent Jewelry | "permanent jewelry near me", "welded bracelet hamptons" | $10/day |
| Room Rental | "rent party room suffolk county", "event space rental" | $8/day |
| Pop-Up Space | "pop up shop space rental", "studio rental hamptons" | $5/day |
| Fundraiser | "school fundraiser long island", "easy fundraiser ideas suffolk county" | $5/day |

**Used by:** PAID Agent

**Priority:** 🟡 Build Phase 1B

---

### 4.2 Meta Ads Server
**Purpose:** Facebook + Instagram paid campaigns and retargeting

🔨 **Custom Build Required** (wraps Meta Marketing API — separate from Graph API)
🔗 **API Required:** Meta Business Manager, Ad Account access

```typescript
tools: [
  "meta_create_campaign",
  "meta_create_ad_set",
  "meta_create_ad",
  "meta_create_custom_audience",
  "meta_create_lookalike",
  "meta_get_ad_performance",
  "meta_pause_ad",
  "meta_duplicate_ad",
  "meta_get_audience_insights"
]
```

**Initial Audiences:**
- Website visitors (pixel — retargeting)
- Customer email list upload (Custom Audience)
- Lookalike of past bookers (2% Lookalike)
- Parents of kids 3-12 in Suffolk County (interest targeting)
- Women 25-45 interested in jewelry within 20 miles

**Used by:** PAID Agent, LIST Agent

**Priority:** 🟡 Build Phase 1B

---

## 5. Website & Code MCP Servers

### 5.1 GitHub MCP Server ⭐ NEW in v1.2
**Purpose:** Give BUILD agent read/write access to the hosthampton.com GitHub repository

✅ **Pre-built:**
```bash
npm install @modelcontextprotocol/server-github
```

**Permissions:**
- Read files, create/update files
- Create branches, open PRs, merge PRs
- Main branch protection: require HAMPTON approval on merge

**Repo Structure:**
```
/src/app          → Next.js pages (App Router)
/src/components   → Reusable UI components
/public/images    → Migrated + optimized assets
/content          → MDX blog posts + service copy
/lib              → Stripe, Supabase, analytics clients
tailwind.config.ts → Brand tokens (dusty blue #E4EDFD, gray #6E7A8F, black #000000)
```

**Used by:** BUILD Agent only

**Priority:** 🟡 Phase 2A (not needed in Phase 1)

---

### 5.2 Vercel MCP Server
**Purpose:** Trigger deployments, get preview URLs, monitor build status

🔨 **Custom Build Required** (wraps Vercel REST API)

```typescript
tools: [
  "vercel_get_deployments",   // list recent deployments + status
  "vercel_get_preview_url",   // get preview URL for branch
  "vercel_trigger_deploy",    // redeploy if needed
  "vercel_get_build_logs",    // debug failed builds
  "vercel_set_env_var"        // manage environment variables
]
```

**Used by:** BUILD Agent

**Priority:** 🟡 Phase 2A

---

### 5.3 Stripe Server
**Purpose:** Event ticket sales and party deposit processing

✅ **Pre-built:**
```bash
npm install @modelcontextprotocol/server-stripe
# or use Stripe SDK directly in Next.js API routes
```

**E-commerce scope (events + deposits only — no retail):**
```typescript
tools: [
  "stripe_create_checkout_session",  // event ticket or deposit
  "stripe_get_payment_status",       // confirm payment completed
  "stripe_list_transactions",        // revenue reporting
  "stripe_create_product",           // new event ticket product
  "stripe_refund_payment"            // process refund
]
```

**Used by:** BUILD Agent (checkout flow), INTEL Agent (revenue reporting)

**Priority:** 🟡 Phase 2A

---

## 6. Analytics MCP Servers

### 6.1 Google Analytics 4 Server
**Purpose:** Website traffic, conversion tracking, user behavior

🔨 **Custom Build Required** (wraps GA4 Data API)
🔗 **API Required:** Google Cloud service account with GA4 access

```typescript
tools: [
  "ga4_get_report",           // custom metric/dimension report
  "ga4_get_realtime",         // live visitor data
  "ga4_get_conversions",      // form submissions, clicks, purchases
  "ga4_get_top_pages",        // highest traffic pages
  "ga4_get_traffic_sources"   // channel breakdown
]
```

**Used by:** INTEL Agent

**Priority:** 🟡 Build Phase 1B

---

### 6.2 Google Search Console Server
**Purpose:** SEO performance — rankings, impressions, click-through rates

🔨 **Custom Build Required**
🔗 **API Required:** Google Search Console API access

```typescript
tools: [
  "gsc_get_performance",      // clicks, impressions, CTR, position
  "gsc_get_top_queries",      // keywords driving traffic
  "gsc_get_index_status",     // pages indexed vs submitted
  "gsc_submit_sitemap",       // submit sitemap after launch
  "gsc_request_indexing"      // request indexing for new pages
]
```

**Used by:** INTEL Agent, BUILD Agent (post-launch)

**Priority:** 🟡 Phase 2B (pre-launch SEO audit + sitemap submission)

---

## 7. Image Processing Server

### 7.1 Sharp Image Server (Custom)
**Purpose:** Resize, crop, watermark, and format images for every platform

🔨 **Custom Build Required** (wraps Sharp.js)

```typescript
tools: [
  "resize_for_instagram",     // 1080x1080, 1080x1350, 1080x1920
  "resize_for_facebook",      // 1200x630, 1080x1080
  "resize_for_gbp",           // 720x540
  "resize_for_web",           // WebP, responsive srcset
  "apply_watermark",          // brand logo overlay
  "apply_brand_overlay",      // color/text overlays
  "batch_process"             // folder of images → platform outputs
]
```

**Used by:** PIXEL Agent

**Priority:** 🔴 Build First (Phase 1A)

---

## 8. ~~Builder Bridge MCP Server~~ ❌ RETIRED in v1.2

> The Builder Bridge MCP server is retired. BUILD agent now communicates directly with HAMPTON via the standard task queue (same as all other agents). GitHub MCP + Vercel MCP replace all Builder Bridge functionality with direct code ownership.

---

## Priority Build Order Summary

| Priority | Server | Phase | Agent |
|---|---|---|---|
| 🔴 | Memory Server | 1A | All |
| 🔴 | Filesystem Server | 1A | PIXEL, COPY, BUILD, INTEL |
| 🔴 | Supabase Server | 1A | Most |
| 🔴 | Task Queue (custom) | 1A | All |
| 🔴 | Meta Graph API (custom) | 1A | SOC |
| 🔴 | Mailchimp/Email | 1A | OUTBOUND, LIST |
| 🔴 | Twilio SMS | 1A | OUTBOUND, HAMPTON |
| 🔴 | Sharp Image (custom) | 1A | PIXEL |
| 🟡 | GBP Server | 1A | SOC |
| 🟡 | Google Ads | 1B | PAID |
| 🟡 | Meta Ads | 1B | PAID |
| 🟡 | GA4 Server | 1B | INTEL |
| 🟡 | GitHub MCP ⭐ | 2A | BUILD |
| 🟡 | Vercel MCP | 2A | BUILD |
| 🟡 | Stripe Server | 2A | BUILD |
| 🟡 | Google Search Console | 2B | INTEL, BUILD |

---

*MCP Server List v1.2 | Host Hampton Agent System | February 2026*
