# ✅ Claude Code Build — Content & Asset TODO List
**Host Hampton Agent System | Feed Into Claude Code | v1.2**

> **v1.2 Updates:** Phase structure remapped to marketing-first sequence (1A → 1B → 2A → 2B → 3). BUILD agent owns GitHub/Vercel/Next.js directly — Builder Bridge retired. REACH agent retired and split into OUTBOUND (email/SMS/outreach) and PAID (ads). Section E (Landing Pages) updated to Next.js architecture with confirmed page routes. Section F (Ads) updated for PAID agent + fundraiser campaign. Section G outreach scripts reattributed to OUTBOUND. Prompt order completely rewritten.

Everything below is content, configuration, and knowledge that must be created and loaded into the agent system. Feed each item to Claude Code as a task.

---

## 🔴 PHASE 1A — FOUNDATION (Weeks 1–2, Build These First)

### A. Business Knowledge (Load into Memory Server)

- [ ] **Brand Guidelines Document**
  - Hex color codes: `#E4EDFD` (dusty blue), `#6E7A8F` (gray), `#000000` (black) — confirmed brand colors
  - Font: Inter — confirm any additional font usage on site
  - Logo usage rules (minimum size, clearspace)
  - Photography style notes (warm, bright, candid)
  - Tone & voice examples (5 good captions, 5 bad captions)
  - Approved hashtag sets by category

- [ ] **Full Service Catalog (one file per service)**
  > **v1.2 note:** Kids party pricing and themes confirmed via site audit. Use these as the source of truth.

  - `service_kids_parties.md` — **10 confirmed themes with pricing:**
    Spa ($850), Swiftie ($850), Barbie ($850), Unicorn ($850), Slime ($900),
    Trucker Hat/Custom Pouch ($900), Sweets-n-Treats ($800), Toddler ($850),
    Glow ($950), K-Pop Demon Hunter ($900). All: 10 guests + b-day child, 2 hrs.
    Include: add-ons, FAQ, deposit policy, cancellation policy [FILL IN]
  - `service_room_rental.md` — pricing tiers, hourly rates weekday vs weekend, what's included, rules, deposit policy
  - `service_permanent_jewelry.md` — services offered, pricing per piece, group booking info, mobile service details
  - `service_host_your_client.md` — target professionals, what's included (WiFi, parking, bathroom), hourly rates, how to book
  - `service_trucker_hat_bar.md` — in-studio vs mobile, what's included, suitable events, pricing
  - `service_workshops.md` — all workshop types, pricing, how to book, recurring vs one-time
  - `service_fundraisers.md` — **confirmed model:** no upfront cost, no inventory risk, org keeps 100% of profit above floor. Products: Custom Trucker Hats ($25–$45, $5–$15 profit), Canvas Totes ($40, $10 profit), Canvas Pouches ($25, $5 profit). Target: schools, sports teams, PTAs, Suffolk County radius. **High SEO opportunity — currently invisible in search.**
  - `service_craft_events.md` — activity types, pricing, group sizes, ages suitable
  - `service_permanent_jewelry_party.md` — group/party format (separate from solo appointment)
  - `service_party_addons.md` — upsell catalog (BUILD agent to extract remaining pricing from Squarespace)

- [ ] **Seasonal Marketing Calendar**
  - Month-by-month content priorities for the whole year
  - Key local events in Hamptons/Long Island area (school calendars, local festivals)
  - Holiday promotional windows (Valentine's, Mother's Day, Summer, Back to School, Halloween, Holiday)
  - Birthday party peak seasons

- [ ] **Local Area Knowledge**
  - List of target zip codes and neighborhoods
  - Local Facebook groups to post in (name, ID, rules/cadence)
  - Local PTAs/schools to target for fundraisers
  - Local business organizations (BNI, Chambers of Commerce)
  - Competitor venues (for awareness, not publication)
  - Local landmarks and community context for copy

- [ ] **FAQ Library**
  - Kids party FAQs (50+ Q&A pairs)
  - Permanent jewelry FAQs (30+ Q&A pairs)
  - Room rental FAQs (20+ Q&A pairs)
  - General venue FAQs (20+ Q&A pairs)
  - These feed: website chatbot, GBP Q&A, DM auto-replies

---

### B. CRM Schema (Load into Supabase)

> **v1.2 note:** Full schema has been created (`HostHampton_Supabase_Schema.sql` + `HostHampton_Supabase_Schema_Addendum_v1.2.sql`). Run both files to get the complete schema including all v1.2 additions. The items below are the content/configuration tasks that still need to be completed after the schema is deployed.

- [x] **Contact Table Schema** — ✅ complete in Supabase schema file
  ```
  id, email, phone, first_name, last_name,
  source (how they found us), 
  service_interest[], child_birthdays[], 
  zip_code, created_at, last_engaged_at,
  lifetime_value, booking_count,
  email_opt_in, sms_opt_in,
  notes, tags[]
  ```

- [ ] **Audience Segment Definitions** — load into `audience_segments` table and `crm.segments` memory namespace
  - `parents_young_kids` — children ages 3–8
  - `parents_tween_kids` — children ages 9–14
  - `teen_party_market` — Sweet 16, teen events
  - `brides_bridal_market` — permanent jewelry, bridal showers
  - `girls_night_market` — adult workshops, jewelry nights
  - `small_business_owners` — Host Your Client, pop-up vendors
  - `school_orgs` — PTAs, sports teams, dance studios (fundraisers)
  - `past_bookers_all` — everyone who has booked
  - `past_bookers_1yr` — booked in last 12 months
  - `hot_leads` — inquired but not booked (last 30 days)
  - `warm_leads` — inquired but not booked (30–90 days)
  - `email_opted_in` — all email marketing sends go here
  > Note: `cold_leads` → use `inactive` status (no engagement 90+ days) per schema enum. No separate segment needed.

- [ ] **Tagging System** — load tag definitions into `crm.segments` memory namespace
  ```
  service tags: party_booked, jewelry_booked, rental_booked, workshop_attended
  lead tags: inquiry_sent, quote_received, follow_up_needed, lost_lead
  campaign tags: spring_2026, summer_camp, holiday_market, glow_party_promo
  channel tags: ig_lead, fb_lead, google_lead, referral, walk_in, nextdoor
  business tags: is_business, pta_fundraiser_prospect, vendor_partner
  ```

---

### C. Email & SMS Sequences (Phase 1A)

> **v1.2 note:** COPY agent writes all copy. OUTBOUND agent owns enrollment, sending, and sequence management. Deliver finished copy to OUTBOUND via the `content_library` table. All sequences should be loaded into Mailchimp before Phase 1A launch.

- [ ] **Sequence 1: New Inquiry Welcome (5 emails)** → COPY writes, OUTBOUND loads into Mailchimp
  - Email 1 (immediately): Thank you + what happens next + link to browse themes
  - Email 2 (day 2): Social proof — real party photos + parent testimonials
  - Email 3 (day 4): Answer top 5 FAQ + link to check availability
  - Email 4 (day 7): Limited spots urgency + current specials
  - Email 5 (day 10): Last touch — personal offer or redirect to call

- [ ] **Sequence 2: Post-Booking Prep Series (3 emails)** → COPY writes, OUTBOUND loads
  - Email 1 (immediately after booking): Confirmation + what to expect
  - Email 2 (1 week before event): Prep checklist + add-on upsell
  - Email 3 (day before event): Reminder + parking/arrival info + excitement builder

- [ ] **Sequence 3: Post-Event Follow-Up (3 emails)** → COPY writes, OUTBOUND loads
  - Email 1 (next day): Thank you + request for review (Google + Facebook)
  - Email 2 (day 3): Share your memories — tag us on social + referral ask
  - Email 3 (day 14): Rebook prompt — sibling birthday / next year reminder

- [ ] **Sequence 4: 6-Month Re-Engagement (3 emails)** → COPY writes, OUTBOUND loads
  - Email 1: "We miss you" — what's new at Host Hampton
  - Email 2: Special offer for returning customers
  - Email 3: Last chance / or update preferences

- [ ] **Sequence 5: Annual Birthday Reminder** → COPY writes, OUTBOUND loads
  - Triggered 60 days before child's birthday (if `child_birthdays` on record)
  - Email: "Their birthday is coming — lock in your date!"
  - Follow-up 30 days before if no booking

- [ ] **Review Velocity Engine (SMS + email)** → OUTBOUND configures, triggers on `bookings.status = completed`
  - +24 hours: SMS review request with Google + Facebook links (`sms_opt_in = true`)
  - +5 days: Email follow-up if no review posted (`email_opt_in = true`)
  - Log all sends to `review_requests` table

- [ ] **Welcome SMS (new subscriber)** → OUTBOUND configures in Twilio
  - Trigger: new email list signup
  - Copy: warm greeting + opt-out instructions

- [ ] **Post-inquiry SMS** → OUTBOUND configures
  - Trigger: new inquiry form submission
  - Copy: personal greeting from owner, email follow-up inbound

---

## 🟡 PHASE 1B — CONTENT ENGINE + ADS (Weeks 3–4)

### D. Social Media Content Library

- [ ] **30-Day Content Calendar Template**
  - Balanced across all 7 content pillars
  - Mix of: party showcases, behind the scenes, testimonials, educational, community, promotions, service spotlights
  - Includes platform-specific variations (IG caption vs FB caption vs Nextdoor tone)
  - Optimal posting times per platform pre-loaded

- [ ] **Caption Templates by Content Type (50 total)**
  - 10 party showcase templates (fill in theme + details)
  - 10 testimonial/social proof templates
  - 10 promotional templates (for flash sales, new themes, limited spots)
  - 10 educational templates ("How to plan a kids party" style)
  - 10 community/event templates

- [ ] **Hashtag Sets (saved by category)**
  ```
  #kids_birthday_hamptons: [list of 25 hashtags]
  #permanent_jewelry_li: [list of 20 hashtags]
  #event_venue_hamptons: [list of 20 hashtags]
  #local_community: [list of 15 hashtags]
  #adult_workshops: [list of 15 hashtags]
  ```

- [ ] **Facebook Group Post List**
  - Name, Group ID, posting rules, last posted date, admin status
  - Groups: Hampton Bays Moms, Southampton Community, Long Island Events, Westhampton Moms, Suffolk County Parents, etc.
  - Max 1 post per week per group, rotate topics

- [ ] **Facebook Marketplace Listings (5 listings to create)**
  - Kids birthday party venue listing
  - Room rental / DIY event space listing
  - Permanent jewelry service listing
  - Studio rental for professionals listing
  - Pop-up/vendor space listing

- [ ] **Google Business Profile Posts Queue (initial 30-post batch)**
  > **v1.2 note:** SOC agent posts 3–4x per week to GBP (upgraded from 1x/week). Build an initial batch of 30 posts. SOC + PIXEL maintain cadence autonomously after that.
  - Rotating content: party themes, events, services, testimonials, seasonal
  - Always include photo (PIXEL provides assets)

---

### E. Website — BUILD Agent Tasks (Phase 2A + 2B)

> **v1.2 change:** BUILD agent owns the website directly. There is no Builder Bridge or external CMS. All items below are tasks for the BUILD agent working in the `hosthampton.com` GitHub repo, deploying to Vercel. COPY writes all page copy. PIXEL provides all images. BUILD does not publish without both.
>
> **Phase gate:** BUILD is not activated until owner authorizes Phase 2. During Phase 1, Squarespace site stays live as-is.

#### Phase 2A — Core Site Scaffold

- [ ] **GitHub repo created** — `hosthampton.com`, Next.js 14 (App Router), Tailwind with brand tokens, Inter font
- [ ] **Component library built** — Header, Footer, Nav, CTAButton, ServiceCard, BookingEmbed (HoneyBook), ScheduleEmbed (cal.com), LeadForm (→ Supabase)
- [ ] **Squarespace content crawl** — BUILD extracts all copy + structure from all pages; stores in `content_snapshots` table
- [ ] **Image download** — BUILD downloads all images from Squarespace CDN → hands to PIXEL for WebP optimization
- [ ] **COPY rewrites all page copy** — SEO-optimized, brand voice, with meta descriptions per page
- [ ] **PIXEL delivers optimized images** — WebP format, responsive srcset, descriptive alt text

#### Phase 2A — 12 Core Pages (routes confirmed from site audit)

- [ ] **`/`** — Homepage: hero, service grid, social proof, booking CTA
  - SEO: "birthday party venue Long Island" + brand
- [ ] **`/kids-parties`** — Service hub: all 10 themes grid, pricing overview, book CTA
  - SEO: "kids birthday party venue Speonk NY"
- [ ] **`/permanent-jewelry`** — Services offered, pricing, group/party format, solo appointment, gallery
  - SEO: "permanent jewelry Long Island", "permanent bracelet near me"
- [ ] **`/party-room-rental`** — Pricing tiers, what's included, use cases, availability CTA
  - SEO: "rent party room Suffolk County", "studio rental Speonk"
- [ ] **`/host-your-client`** — B2B tone, who it's for, what's included, pricing, apply CTA
  - SEO: "event space rental Long Island", "pop-up space Hamptons"
- [ ] **`/fundraiser`** — How it works, confirmed products + profit model, target orgs, no-risk inquiry form
  - SEO: "school fundraiser Long Island", "easy fundraiser ideas Suffolk County" ⭐ zero competition
- [ ] **`/trucker-hat-bar`** — In-studio vs mobile, what's included, events perfect for, gallery
  - SEO: "custom trucker hats Long Island", "hat customization party"
- [ ] **`/workshops-events`** — Upcoming events calendar, past events gallery, email sign-up
  - SEO: "workshops near me Speonk", "adult events Long Island"
- [ ] **`/book`** — Booking hub: all booking embeds (HoneyBook + cal.com) in one place
- [ ] **`/[location]`** — Dynamic location pages: `/southampton`, `/riverhead`, `/westhampton-beach`, `/east-hampton`
  - SEO: "birthday party venue Southampton", "Riverhead kids party", etc.
- [ ] **`/blog`** — Content hub scaffold (posts added Phase 3)
  - SEO: "how to plan a kids birthday party Long Island"

#### Phase 2B — Landing Page Factory (10 theme pages + location pages)

- [ ] **`/kids-parties/spa-party`** — SEO: "spa birthday party long island"
- [ ] **`/kids-parties/swiftie-party`** — SEO: "taylor swift birthday party long island"
- [ ] **`/kids-parties/barbie-party`** — SEO: "barbie birthday party suffolk county"
- [ ] **`/kids-parties/unicorn-party`** — SEO: "unicorn birthday party long island"
- [ ] **`/kids-parties/slime-party`** — SEO: "slime birthday party long island"
- [ ] **`/kids-parties/trucker-hat-party`** — SEO: "custom hat birthday party long island"
- [ ] **`/kids-parties/sweets-treats-party`** — SEO: "baking birthday party kids long island"
- [ ] **`/kids-parties/toddler-party`** — SEO: "toddler birthday party venue long island"
- [ ] **`/kids-parties/glow-party`** — SEO: "glow party birthday suffolk county"
- [ ] **`/kids-parties/kpop-demon-hunter-party`** — SEO: "kpop birthday party long island"

#### Phase 2B — E-Commerce (Stripe)

> **Scope:** Event tickets + party deposits only. No retail. Gift shop excluded per owner direction.

- [ ] **Event ticket checkout** — Stripe Checkout → confirmation → Supabase contacts + Mailchimp enrollment
- [ ] **Party deposit ($200)** — Stripe Checkout → `bookings.status = deposit_paid`
- [ ] **Fundraiser inquiry form** — Form only (no payment) → Supabase → OUTBOUND follow-up sequence
- [ ] **Stripe webhook handler** — Update `stripe_transactions` table on payment events

#### Phase 2B — Pre-Launch Checklist

- [ ] **INTEL pre-launch SEO audit** — all titles ≤60 chars, all meta descriptions ≤155 chars, all structured data valid, internal links descriptive
- [ ] **DNS cutover** — Cloudflare → Vercel (15 min, zero downtime, verify SSL auto-provision)
- [ ] **Google Search Console** — submit sitemap, request indexing for all pages
- [ ] **Owner cancels Squarespace** — after confirming new site is live and all embeds working
- [ ] **SOC launch announcement** — post across all channels on launch day

#### Every Page Must Have (BUILD checklist):
- [ ] Unique `<title>` ≤60 chars, keyword-first
- [ ] `<meta description>` ≤155 chars (from COPY agent)
- [ ] Canonical URL
- [ ] LocalBusiness or Event JSON-LD structured data
- [ ] All images: descriptive alt text
- [ ] All internal links: descriptive anchor text
- [ ] GA4 + Meta Pixel firing
- [ ] Mobile-first responsive verified
- [ ] Lead capture form → Supabase contacts table

---

### F. Ad Copy Library (PAID Agent — Phase 1B)

> **v1.2 note:** PAID agent manages all paid advertising. COPY agent writes all ad copy. Deliver finished copy to PAID agent via `content_library` table.

- [ ] **Google Ads Copy (6 campaigns, 3 headlines + 2 descriptions each)**
  - Kids birthday venue campaign — "birthday party venue long island" + variants
  - Permanent jewelry campaign — "permanent jewelry near me" + variants
  - Room/event rental campaign — "rent party room suffolk county" + variants
  - Pop-up studio campaign — "studio rental hamptons" + variants
  - Summer camp/workshop campaign — "adult craft workshop hamptons" + variants
  - **Fundraiser campaign** ⭐ — "school fundraiser long island" + "easy fundraiser ideas suffolk county" (zero competition keywords — prioritize early)

- [ ] **Meta Ads Copy (5 ad sets, 3 creative variations each)** → delivered to PAID agent
  - Kids party retargeting (website visitors last 90 days + IG engagers last 60 days)
  - Kids party cold prospecting (parents, kids ages 3–12, Suffolk County + Hamptons, 25-mile radius)
  - Permanent jewelry — women 22–45, jewelry interest, within 20 miles
  - Lookalike — past bookers (2% lookalike from email list, from LIST agent)
  - Fundraiser — school administrators, PTAs, coaches in Suffolk County radius

- [ ] **Lead Magnet Content (pick 1 to build first)**
  - "Ultimate Kids Birthday Party Planning Checklist" (PDF)
  - "10 Hottest Kids Party Themes for 2026" (PDF) — includes confirmed theme list from site audit
  - "How to Host a Stress-Free Birthday Party" (email course)
  *Lead magnet drives email list signups from landing pages and ads*

---

## 🟢 PHASE 3 — AUTOMATION & SCALE (Month 3+)

### G. Advanced Content Assets

- [ ] **Blog Post Outlines (10 posts for SEO)** → COPY writes, BUILD publishes to `/blog`
  - "10 Best Kids Birthday Party Themes in 2026" — include confirmed theme list
  - "Everything You Need to Know About Permanent Jewelry"
  - "How to Host a Kids Party Without the Stress"
  - "Best Event Venues on Long Island for Small Parties"
  - "Why Your Business Should Pop Up at Host Hampton"
  - "Glow Party Ideas for Kids: The Ultimate Guide"
  - "Permanent Jewelry as a Wedding Favor: A Complete Guide"
  - "How to Plan a Fundraiser for Your School or Team" ⭐ high SEO value
  - "Adult Workshop Ideas for Girls Night Out in the Hamptons"
  - "Summer Birthday Party Ideas for Kids in Long Island"

- [ ] **Review Response Templates (20 templates)** → COPY writes, SOC applies
  - 5-star review responses (10 variations, never reuse same wording)
  - 4-star review responses (5 variations — acknowledge + invite back)
  - 3-star review responses (3 variations — empathize + offer resolution)
  - Negative review responses (2 variations — calm, professional, resolve offline)

- [ ] **DM Auto-Reply Scripts** → COPY writes, SOC applies
  - "What themes do you have?" → link to theme gallery
  - "How much does a party cost?" → pricing overview + book call CTA
  - "Do you do permanent jewelry?" → yes + book link
  - "Can I rent just the space?" → room rental info + pricing
  - "Are you available on [date]?" → link to availability checker
  - "Do you do mobile?" → permanent jewelry + hat bar mobile info

- [ ] **Outreach Scripts (for OUTBOUND agent)** → COPY writes, OUTBOUND executes
  > **v1.2 note:** These were previously listed under REACH agent. Now owned by OUTBOUND.
  - School/PTA fundraiser outreach email template (first touch + follow-up)
  - Dance studio / sports team outreach template
  - Local business "Host Your Client" cold outreach template (Instagram DM version + email version)
  - Wedding vendor / bridal shop referral partnership template
  - Local mom blogger / influencer collaboration pitch

- [ ] **Vendor/Partner Channel Setup (Phase 3)** → OUTBOUND manages
  - Vendor records loaded into `vendor_referrals` table
  - UTM convention configured: `utm_source=referral&utm_medium=partner&utm_campaign=[partner_slug]`
  - Monthly partner newsletter template (COPY writes)
  - Referral attribution tracking live in INTEL reports

- [ ] **Testimonial Collection System**
  - Post-event review request email template → COPY writes, OUTBOUND sends (Review Velocity Engine)
  - SMS review request template → COPY writes, OUTBOUND sends
  - Instructions for pulling Google/FB reviews into `content_library` table
  - Graphic template for turning text reviews into Instagram quote posts → PIXEL applies

---

### H. Image Asset Organization

- [ ] **Photo Library Audit**
  - Sort all existing photos by: service type, theme, season
  - Tag for: used/unused, platform, quality rating
  - Identify gaps (which themes have NO photos yet)
  - Note: all images are on Squarespace CDN and directly downloadable — BUILD crawls and downloads these in Phase 2A

- [ ] **Brand Graphic Templates (Canva or design file)**
  - Party announcement template (one per theme — 10 total)
  - Promotional flash sale template
  - "X Spots Left" urgency template
  - Testimonial/quote graphic template
  - Event announcement template (workshops, markets)
  - GBP post graphic template
  - Email header template

- [ ] **Watermark Asset**
  - Logo PNG with transparent background (multiple sizes)
  - Corner watermark layout defined
  - PIXEL applies automatically to all published assets

- [ ] **Web-Optimized Image Set (Phase 2A)** → PIXEL delivers to BUILD
  - All party theme photos: WebP format, responsive srcset variants
  - All service photos: WebP + alt text
  - Stored in `/public/images/` in GitHub repo

---

### I. Analytics & Reporting Setup

- [ ] **Weekly Report Template** → INTEL generates, HAMPTON delivers to owner
  - Metrics: inquiries, bookings, email open rates, social reach, ad spend (PAID), cost per lead, top content, review count
  - Phase 2+ additions: search rankings, new pages indexed, site conversion rate
  - Format: markdown summary delivered via chat every Friday 4pm

- [ ] **UTM Structure Convention** — load into `operations.utm_convention` memory namespace
  ```
  utm_source: instagram | facebook | google | email | nextdoor | sms | referral
  utm_medium: organic | paid | story | reel | post | group | marketplace | partner
  utm_campaign: kids_parties_spring | jewelry_mothers_day | room_rental_q1 | fundraiser_fall
  utm_content: [specific ad or post identifier]
  ```

- [ ] **KPI Dashboard Definition** → INTEL tracks, HAMPTON surfaces weekly
  - Monthly leads by source
  - Booking conversion rate by service
  - Revenue by service stream
  - Email list growth + health (OUTBOUND)
  - Social following growth (IG + FB)
  - Google profile views + calls + direction requests
  - Ad spend vs revenue attributed (PAID)
  - Phase 2+ additions: organic search impressions, keyword rankings, Core Web Vitals score

- [ ] **Booking Gap Detector** → HAMPTON Monday cron (Phase 1B)
  - Gaps ≥3 days → SOC awareness post
  - Gaps ≥7 days → OUTBOUND flash offer sequence
  - Gaps ≥14 days → escalate to owner + PAID gap-fill campaign
  - Results logged to `booking_gap_events` table

---

## Claude Code Prompt Order — v1.2 Marketing-First Build Sequence

Feed tasks in this order. Phase gates are real — do not start a later phase until the prior phase is confirmed working.

```
─── PHASE 1A: MARKETING FOUNDATION (Days 1–10) ──────────────────

1.  Deploy Supabase schema
    → Run HostHampton_Supabase_Schema.sql
    → Run HostHampton_Supabase_Schema_Addendum_v1.2.sql

2.  Deploy Memory Server + run bootstrap scripts
    → memory_bootstrap.ts (base)
    → memory_bootstrap_v1.2.ts (addendum keys)
    → Verify all namespace reads before proceeding

3.  Build HAMPTON orchestrator (v1.2 prompt)
    → 9-agent roster, 3-tier approval matrix, Booking Gap Detector logic
    → Escalation path wired to Twilio SMS
    → Test: issue a command, verify task manifest is created in task queue

4.  Connect Meta API → SOC agent
    → IG + FB Page + GBP APIs connected
    → Test post on all three platforms
    → Verify image sizes match PIXEL specs

5.  Build Sharp image processing MCP → PIXEL agent
    → All platform resize configs loaded
    → Watermark asset ready
    → Test: process one party photo → verify IG/FB/GBP outputs

6.  Build Mailchimp integration → OUTBOUND agent
    → All 5 email sequences loaded (COPY writes first)
    → Welcome sequence trigger live on new list signups
    → Test enroll: add test contact, verify sequence fires

7.  Build Twilio SMS → OUTBOUND agent
    → Welcome SMS configured
    → Post-inquiry SMS configured
    → Review Velocity Engine: +24hr trigger wired to bookings.status = completed
    → Test send: verify SMS fires correctly

8.  LIST agent connected to Supabase
    → Import all existing contacts
    → Segment definitions loaded
    → Daily lead scoring job running
    → Test: verify segment counts are accurate

9.  COPY agent: generate 30-day content calendar
    → Balanced across all 7 content pillars
    → Platform-specific caption variations ready

10. SOC agent: schedule first 2 weeks of posts
    → IG + FB + GBP scheduled at optimal times
    → Verify PIXEL provides correctly sized assets for each

11. Build Next.js chat UI → deploy to app.hosthampton.com (Vercel)
    → Owner can now issue commands via chat interface
    → Test: issue 3 commands, verify HAMPTON routes correctly

─── PHASE 1B: PAID + ANALYTICS (Days 11–28) ─────────────────────

12. PAID agent: launch Meta Ads campaigns
    → 4 initial ad sets live (retargeting, cold prospecting, jewelry, lookalike)
    → Fundraiser campaign added (zero competition keywords)
    → Budgets confirmed with owner before launch

13. PAID agent: launch Google Ads campaigns
    → 6 campaigns live (birthday venues, jewelry, rental, pop-up, workshops, fundraiser)
    → Negative keyword lists loaded
    → Conversion tracking verified

14. INTEL agent: connect all data sources
    → GA4 + Meta Insights + GBP Insights + Supabase analytics
    → Weekly report template configured
    → Baseline metrics established (week 1 numbers recorded)

15. Booking Gap Detector: activate Monday cron
    → Test: verify gap detection logic fires
    → Verify correct agent routing per gap size

─── PHASE 2A: WEBSITE SCAFFOLD (Month 2, Weeks 1–2) ─────────────

16. BUILD agent: create GitHub repo + scaffold Next.js 14
    → Brand tokens, Inter font, component library
    → Header, Footer, Nav, CTAButton, BookingEmbed, LeadForm built

17. BUILD agent: crawl Squarespace → content_snapshots table
    → All pages extracted; copy + structure stored
    → All images downloaded from Squarespace CDN

18. COPY agent: rewrite all page copy with SEO optimization
    → One meta description per page (≤155 chars)
    → One keyword-optimized title per page (≤60 chars)
    → All body copy in brand voice

19. PIXEL agent: optimize all migrated images
    → WebP format, responsive srcset
    → Alt text suggestions provided per image
    → Delivered to /public/images/ in repo

20. BUILD agent: build all 12 core pages
    → Stripe integration (event tickets + party deposit)
    → All lead forms wired to Supabase contacts
    → GA4 + Meta Pixel installed on all pages

21. BUILD agent: surface full Vercel preview URL → owner review session
    → Owner + HAMPTON review: mobile, booking flows, pricing, brand feel
    → COPY + BUILD address all feedback before proceeding

─── PHASE 2B: LAUNCH (Month 2, Weeks 3–4) ───────────────────────

22. BUILD agent: generate all 10 theme pages (/kids-parties/[theme])
    + 4 location pages (/southampton, /riverhead, /westhampton-beach, /east-hampton)

23. INTEL: pre-launch SEO audit
    → All titles, meta descriptions, structured data, internal links verified

24. DNS cutover: Cloudflare → Vercel
    → 15-minute process, zero downtime
    → SSL auto-provisioned by Vercel
    → Verify all embeds (HoneyBook, cal.com, Stripe) working on live domain

25. Google Search Console: submit sitemap, request indexing
26. SOC agent: launch announcement post across all channels
27. Owner cancels Squarespace subscription

─── PHASE 3: FULL AUTONOMY (Month 3+) ───────────────────────────

28. Build Booking Gap Detector full automation + escalation path
29. Vendor/Partner Channel: vendor records loaded, UTM attribution live
30. COPY + BUILD: blog posts written and published (10 posts for SEO)
31. Memory hygiene sweep: all TODO items resolved, static docs retired
32. All 9 agents operating autonomously — owner commands only for strategy
```

---

*Build TODO v1.2 | Host Hampton Agent System | February 2026 | Claude Code*
