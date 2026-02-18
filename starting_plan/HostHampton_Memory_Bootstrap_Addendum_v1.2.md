# 🧠 Agent Memory Bootstrap Addendum — v1.2
**New Namespace Keys | Load AFTER main memory_bootstrap.ts**

> Run `memory_bootstrap_v1.2.ts` after the base bootstrap to add these entries.
> These keys reflect: marketing-first strategy, website migration status, 
> Build agent promotion, vendor referrals, Review Velocity Engine, Booking Gap rules,
> and the full 10-package party catalog confirmed via site audit.

---

## New / Updated Bootstrap Entries

### NAMESPACE: services — Updated kids_party_themes

Replace the existing `services.kids_party_themes` entry with the confirmed catalog:

```json
{
  "namespace": "services",
  "key": "kids_party_themes",
  "description": "All available party themes — confirmed via site audit Feb 2026",
  "value": {
    "themes": [
      {
        "name": "Spa Party",
        "slug": "spa-party",
        "price": 850,
        "guests": "10 + birthday child",
        "includes": "Robes, manicure, hair, makeup, nail polish craft",
        "seo_target": "spa birthday party long island"
      },
      {
        "name": "Swiftie Party",
        "slug": "swiftie-party",
        "price": 850,
        "guests": "10 + birthday child",
        "includes": "Karaoke, friendship bracelets, hair tinsel, glitter",
        "seo_target": "taylor swift birthday party long island"
      },
      {
        "name": "Barbie Party",
        "slug": "barbie-party",
        "price": 850,
        "guests": "10 + birthday child",
        "includes": "Life-size Barbie box, fashion show, sunglasses craft",
        "seo_target": "barbie birthday party suffolk county"
      },
      {
        "name": "Unicorn Party",
        "slug": "unicorn-party",
        "price": 850,
        "guests": "10 + birthday child",
        "includes": "Unicorn headbands, glitter makeup, craft activity",
        "seo_target": "unicorn birthday party long island"
      },
      {
        "name": "Slime Party",
        "slug": "slime-party",
        "price": 900,
        "guests": "10 + birthday child",
        "includes": "Slime making station, custom containers, karaoke",
        "seo_target": "slime birthday party long island"
      },
      {
        "name": "Trucker Hat / Custom Pouch",
        "slug": "trucker-hat-party",
        "price": 900,
        "guests": "10 + birthday child",
        "includes": "Iron-on patches, photo booth with instant text",
        "seo_target": "custom hat birthday party long island"
      },
      {
        "name": "Sweets-n-Treats",
        "slug": "sweets-treats-party",
        "price": 800,
        "guests": "10 + birthday child",
        "includes": "Custom apron, cupcake/cookie decorating",
        "seo_target": "baking birthday party kids long island"
      },
      {
        "name": "Toddler Party",
        "slug": "toddler-party",
        "price": 850,
        "guests": "10 + birthday child",
        "includes": "Soft play area, ball pit, climber, theme table",
        "seo_target": "toddler birthday party venue long island"
      },
      {
        "name": "Glow Party",
        "slug": "glow-party",
        "price": 950,
        "guests": "10 + birthday child",
        "includes": "Black lights, neon face paint, DJ, glow favors",
        "seo_target": "glow party birthday suffolk county"
      },
      {
        "name": "K-Pop Demon Hunter",
        "slug": "kpop-demon-hunter-party",
        "price": 900,
        "guests": "10 + birthday child",
        "includes": "Karaoke, dance zone, hair tinsel, neon backdrop",
        "seo_target": "kpop birthday party long island"
      }
    ],
    "price_range": "$800–$950",
    "base_capacity": 10,
    "additional_guest_policy": "$35 per additional guest above 10",
    "party_duration": "2 hours",
    "last_updated": "2026-02"
  }
}
```

---

### NAMESPACE: services — fundraiser (updated)

```json
{
  "namespace": "services",
  "key": "fundraiser",
  "description": "Fundraiser program — confirmed via site audit. High SEO opportunity.",
  "value": {
    "model": "No upfront cost, no inventory risk, organization keeps 100% of profit above Host Hampton floor price",
    "products": [
      {
        "name": "Custom Trucker Hats",
        "sell_price_range": "$25–$45",
        "profit_range": "$5–$15"
      },
      {
        "name": "Canvas Totes",
        "sell_price": "$40",
        "profit": "$10"
      },
      {
        "name": "Canvas Pouches",
        "sell_price": "$25",
        "profit": "$5"
      }
    ],
    "target_orgs": "Schools, sports teams, PTAs, community orgs — Suffolk County radius",
    "seo_opportunity": "HIGH — 'school fundraiser long island', 'easy school fundraiser ideas suffolk county' — zero competition, high intent. Currently invisible in search.",
    "cta": "No-risk inquiry form — BUILD agent creates at /fundraiser"
  }
}
```

---

### NAMESPACE: website

```json
{
  "namespace": "website",
  "key": "migration_status",
  "description": "Current state of website migration from Squarespace to Next.js",
  "value": {
    "current_site": "squarespace",
    "squarespace_monthly_cost": "$23–$65",
    "target_stack": "Next.js 14 + Vercel + GitHub + Stripe",
    "target_stack_monthly_cost": "$0 (Vercel free tier)",
    "migration_phase": "pending",
    "phase_2_start": null,
    "squarespace_cancel_date": null,
    "pages_migrated": [],
    "pages_live": [],
    "honeybook_embed_preserved": true,
    "calcom_embed_preserved": true
  }
}
```

```json
{
  "namespace": "website",
  "key": "seo_status",
  "description": "Current SEO gaps and targets — from Feb 2026 site audit",
  "value": {
    "current_issues": [
      "Not ranking for any local search terms",
      "Google snippets show footer nav text — no meta descriptions set",
      "No structured data (LocalBusiness, Event schema)",
      "~10 indexed pages, most with no meaningful content signal",
      "No dedicated landing pages per service",
      "Squarespace blocks agent-level programmatic updates"
    ],
    "critical_gap": "Searching 'birthday party venue Speonk NY kids' returns Yelp, Peerspace, Laser Bounce — Host Hampton does not appear. Invisible for primary category in own backyard.",
    "fixes_planned": [
      "Keyword-rich title tags per page",
      "COPY agent-generated meta descriptions (155 chars)",
      "LocalBusiness + Event + Product schema on every page",
      "12+ landing pages: one per party theme + location radius pages",
      "Keyword-anchored internal link structure (BUILD agent)",
      "Next.js static generation = near-perfect Core Web Vitals",
      "SOC agent: 3–4 GBP posts/week + photo dumps from PIXEL"
    ]
  }
}
```

```json
{
  "namespace": "website",
  "key": "page_architecture",
  "description": "Target page map for new Next.js site",
  "value": {
    "core_pages": [
      { "route": "/", "type": "homepage", "seo": "birthday party venue Long Island" },
      { "route": "/kids-parties", "type": "hub", "seo": "kids birthday party venue Speonk NY" },
      { "route": "/permanent-jewelry", "type": "service", "seo": "permanent jewelry Long Island" },
      { "route": "/party-room-rental", "type": "service", "seo": "rent party room Suffolk County" },
      { "route": "/host-your-client", "type": "b2b", "seo": "event space rental Long Island" },
      { "route": "/fundraiser", "type": "program", "seo": "school fundraiser Long Island" },
      { "route": "/trucker-hat-bar", "type": "service", "seo": "custom trucker hats Long Island" },
      { "route": "/workshops-events", "type": "hub", "seo": "workshops near me Speonk" },
      { "route": "/book", "type": "conversion", "seo": null },
      { "route": "/blog", "type": "content", "seo": "how to plan a kids birthday party Long Island" }
    ],
    "theme_pages": [
      "/kids-parties/spa-party",
      "/kids-parties/swiftie-party",
      "/kids-parties/barbie-party",
      "/kids-parties/unicorn-party",
      "/kids-parties/slime-party",
      "/kids-parties/trucker-hat-party",
      "/kids-parties/sweets-treats-party",
      "/kids-parties/toddler-party",
      "/kids-parties/glow-party",
      "/kids-parties/kpop-demon-hunter-party"
    ],
    "location_pages": [
      "/southampton",
      "/riverhead",
      "/westhampton-beach",
      "/east-hampton"
    ]
  }
}
```

---

### NAMESPACE: review_velocity

```json
{
  "namespace": "review_velocity",
  "key": "sequence_config",
  "description": "Review Velocity Engine — timing and rules for post-booking review requests",
  "value": {
    "trigger": "booking.status = 'completed'",
    "step_1": {
      "channel": "sms",
      "delay_hours": 24,
      "condition": "sms_opt_in = true",
      "message": "Thank you for celebrating with us at Host Hampton! We'd love your feedback — it takes 30 seconds and means the world to us. [Google link] or [Facebook link]"
    },
    "step_2": {
      "channel": "email",
      "delay_days": 5,
      "condition": "email_opt_in = true AND review_posted = false",
      "subject": "Share your Host Hampton experience 🎉",
      "message": "Softer follow-up + event photos if available"
    },
    "opt_out_rule": "If review_posted = true after step 1, skip step 2",
    "never_send_if": "opted_out = true OR sms_opt_in = false (for SMS) OR email_opt_in = false (for email)",
    "platform_priority": "Google first, Facebook second",
    "track_in": "review_requests table"
  }
}
```

---

### NAMESPACE: gap_fill_rules

```json
{
  "namespace": "gap_fill_rules",
  "key": "thresholds",
  "description": "Booking Gap Detector rules — HAMPTON Monday cron",
  "value": {
    "check_window_days": 28,
    "thresholds": [
      {
        "min_gap_days": 3,
        "action": "SOC awareness post",
        "agent": "SOC",
        "urgency": "low"
      },
      {
        "min_gap_days": 7,
        "action": "OUTBOUND flash offer sequence",
        "agent": "OUTBOUND",
        "urgency": "normal"
      },
      {
        "min_gap_days": 14,
        "action": "Escalate to owner + PAID gap-fill campaign",
        "agents": ["PAID", "OUTBOUND"],
        "urgency": "high",
        "escalate": true
      }
    ],
    "cron_schedule": "every Monday 7:00 AM",
    "track_in": "booking_gap_events table"
  }
}
```

---

### NAMESPACE: vendor_referrals

```json
{
  "namespace": "vendor_referrals",
  "key": "program_rules",
  "description": "Vendor / partner referral program — Phase 3",
  "value": {
    "status": "pending_launch",
    "launch_phase": "3",
    "target_partner_types": [
      "wedding_planner",
      "event_photographer",
      "local_influencer",
      "dance_studio",
      "pta_org",
      "cosmetic_injector",
      "esthetician"
    ],
    "utm_convention": "utm_source=referral&utm_medium=partner&utm_campaign=[partner_slug]",
    "attribution_window_days": 30,
    "outreach_owner": "OUTBOUND agent",
    "tracking_table": "vendor_referrals"
  }
}
```

---

### NAMESPACE: operations — phase_status (new key)

```json
{
  "namespace": "operations",
  "key": "phase_status",
  "description": "Current build phase — HAMPTON uses to route tasks correctly",
  "value": {
    "current_phase": "1A",
    "active_agents": ["HAMPTON", "SOC", "COPY", "PIXEL", "OUTBOUND", "LIST"],
    "phase_1b_start": null,
    "phase_2_start": null,
    "phase_notes": {
      "BUILD": "Not active until Phase 2 authorized by owner",
      "PAID": "Not active until Phase 1B authorized",
      "INTEL": "Not active until Phase 1B authorized"
    },
    "squarespace_status": "active — do not modify",
    "last_updated": "2026-02"
  }
}
```

---

### NAMESPACE: market — updated seo_gaps (new key)

```json
{
  "namespace": "market",
  "key": "seo_gaps",
  "description": "Identified SEO gaps from Feb 2026 site audit — high-value targets",
  "value": {
    "invisible_searches": [
      "birthday party venue Speonk NY kids",
      "school fundraiser Long Island",
      "easy school fundraiser ideas Suffolk County",
      "permanent jewelry Long Island",
      "glow party kids Suffolk County"
    ],
    "zero_competition_keywords": [
      "school fundraiser Long Island",
      "easy school fundraiser ideas Suffolk County"
    ],
    "local_competitor_ranking_above_us": [
      "Yelp", "Peerspace", "Laser Bounce", "Long Island party guides"
    ],
    "structured_data_missing": ["LocalBusiness", "Event", "Product"],
    "fix_owner": "BUILD agent (Phase 2)"
  }
}
```

---

## Updated memory_bootstrap_v1.2.ts Script Reference

```typescript
// scripts/memory_bootstrap_v1.2.ts
// Run AFTER base memory_bootstrap.ts

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const v12Entries = [
  // Paste all JSON entries above here
]

async function bootstrap_v1_2() {
  for (const entry of v12Entries) {
    const { error } = await supabase
      .from('agent_memory')
      .upsert(entry, { onConflict: 'namespace,key' })
    
    if (error) console.error(`Failed: ${entry.namespace}.${entry.key}`, error)
    else console.log(`✅ Loaded: ${entry.namespace}.${entry.key}`)
  }
  console.log('Memory bootstrap v1.2 complete.')
}

bootstrap_v1_2()
```

---

*Memory Bootstrap Addendum v1.2 | Host Hampton Agent System | February 2026*
