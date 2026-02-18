# 🧠 HAMPTON — Orchestrator Agent Architecture
**Host Hampton AI Agent System | v1.2**

> **v1.2 Changes:** Updated to 9-agent roster (REACH → OUTBOUND + PAID, BUILD promoted). Builder Bridge MCP retired — BUILD routes through standard task queue. Marketing-first phase logic added.

---

## Overview

HAMPTON is the central orchestrator for the Host Hampton AI agent team. It serves as the single point of contact for the business owner, interprets all natural language commands, maintains persistent business memory, enforces brand consistency across all agents, and coordinates multi-agent task execution.

HAMPTON never executes tasks itself — it **plans, delegates, monitors, and reports**.

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    OWNER CHAT INTERFACE                         │
│              (Next.js Web App / Mobile PWA)                     │
│   "Post our Swiftie party photos with a caption for tonight"    │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTPS / WebSocket
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                   HAMPTON ORCHESTRATOR                          │
│                                                                 │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │   Intent    │  │   Planner    │  │   Brand Enforcer      │  │
│  │  Classifier │→ │  & Router    │→ │   (voice, tone, rules)│  │
│  └─────────────┘  └──────────────┘  └───────────────────────┘  │
│         │                │                      │               │
│  ┌──────▼──────┐  ┌──────▼──────┐  ┌───────────▼───────────┐  │
│  │  Business   │  │  Task Queue │  │   Memory Manager      │  │
│  │  Context    │  │  & Priority │  │   (MCP Memory Server) │  │
│  │  Retriever  │  │  Scheduler  │  │                       │  │
│  └─────────────┘  └──────────── ┘  └───────────────────────┘  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ dispatches structured tasks
          ┌────────────────┼────────────────────────────────────┐
          ▼                ▼                ▼                   ▼
      ┌───────┐       ┌────────┐      ┌─────────┐        ┌─────────┐
      │  SOC  │       │  COPY  │      │  PIXEL  │        │  BUILD  │
      │ Agent │       │ Agent  │      │  Agent  │        │  Agent  │
      └───────┘       └────────┘      └─────────┘        └─────────┘
          ▼                ▼                ▼                   ▼
      ┌───────┐       ┌──────────┐    ┌─────────┐        ┌─────────┐
      │  LIST │       │ OUTBOUND │    │  PAID   │        │  INTEL  │
      │ Agent │       │  Agent   │    │  Agent  │        │  Agent  │
      └───────┘       └──────────┘    └─────────┘        └─────────┘
```

---

## HAMPTON's Internal Modules

### 1. Intent Classifier
Parses owner input and categorizes the request type before routing.

| Intent Category | Routes To |
|---|---|
| Social content / posting | SOC + COPY + PIXEL |
| Email / SMS campaign | OUTBOUND + COPY + LIST |
| Paid ad campaign | PAID + COPY + PIXEL + LIST |
| Analytics / reporting | INTEL |
| Website / SEO / landing page | BUILD + COPY + PIXEL |
| CRM / contacts / segments | LIST |
| Image processing | PIXEL |
| Content writing | COPY |
| Booking gap / revenue | HAMPTON → Booking Gap Detector |
| Escalation / human needed | HAMPTON → owner alert (Twilio) |

### 2. Planner & Router
Decomposes multi-step tasks into sequential or parallel agent tasks. Writes structured task manifests to the Task Queue.

**Task manifest format:**
```typescript
interface TaskManifest {
  task_id: string;
  assigned_to: AgentName;
  priority: 'urgent' | 'high' | 'normal' | 'low' | 'async';
  depends_on?: string[];        // task_ids that must complete first
  input: Record<string, any>;
  approval_tier: 'AUTO_EXECUTE' | 'DRAFT_AND_SHOW' | 'ALWAYS_ASK';
  deadline?: Date;
}
```

### 3. Brand Enforcer
Before any content is published or any agent executes a consumer-facing task, the Brand Enforcer checks:
- Brand voice compliance (tone words, never-sound list)
- Color and font standards (BUILD)
- Hashtag set compliance (SOC)
- Pricing accuracy (COPY / BUILD)

### 4. Memory Manager
On every incoming request, HAMPTON loads relevant memory namespaces and passes context to the relevant agent(s). After significant events, HAMPTON updates memory.

**Standard namespaces loaded on every task:**
- `brand.identity`, `brand.voice`
- `services.priority_order`
- `campaigns.active`

### 5. Booking Gap Detector
Runs every Monday morning as a scheduled cron task.

```typescript
// Pseudo-logic
async function bookingGapDetector() {
  const nextFourWeeks = await getBookings({ 
    from: today, 
    to: today + 28 
  });
  
  const gaps = findConsecutiveGaps(nextFourWeeks, minGapDays: 3);
  
  for (const gap of gaps) {
    await supabase.from('booking_gap_events').insert(gap);
    
    if (gap.days >= 14) {
      await escalate({ priority: 'high', reason: 'Extended booking gap detected' });
      await dispatchTask({ agent: 'PAID', task: 'gap_fill_campaign', gap });
    } else if (gap.days >= 7) {
      await dispatchTask({ agent: 'OUTBOUND', task: 'flash_offer_sequence', gap });
    } else {
      await dispatchTask({ agent: 'SOC', task: 'availability_awareness_post', gap });
    }
  }
}
```

### 6. Human Escalation Path
HAMPTON detects situations requiring human decision and routes them out of the agent system.

**Escalation triggers:**
- Pricing or policy changes requested
- Negative review posted on any platform
- Ad account flagged or restricted
- Owner response required on an inquiry (ALWAYS ASK tier)
- System error preventing task completion
- Budget threshold reached
- Unusual CRM data pattern (potential fraud or spam)

**Escalation flow:**
```
1. HAMPTON detects trigger
2. Writes row to escalations table (priority: urgent/high/normal/low)
3. Sends Twilio SMS to owner (urgent/high priority only)
4. Pauses related tasks until owner responds
5. On resolution: owner responds via chat → HAMPTON resumes tasks
```

---

## Approval Tier Matrix

| Approval Tier | Behavior | Examples |
|---|---|---|
| **AUTO_EXECUTE** | Execute immediately, report completion | Scheduled social posts within brand rules, content edits to existing pages, internal data updates |
| **DRAFT_AND_SHOW** | Surface draft to owner, auto-execute after 4-hour timeout if no response | New landing page publishes, new email campaign drafts, new ad creatives |
| **ALWAYS_ASK** | Never proceed without explicit owner confirmation | Pricing changes, navigation/structural website changes, DNS changes, budget increases, policy decisions |

---

## HAMPTON System Prompt (v1.2)

```
You are HAMPTON, the orchestrator agent for Host Hampton — a boutique 
celebration studio in Speonk, NY.

You are the single point of contact between the business owner and the 
full agent team. You interpret natural language commands, maintain brand 
consistency, route tasks to the right agents, and surface reports and 
summaries back to the owner.

AGENT ROSTER (9 specialists + you):
- SOC: Social media — IG, FB, GBP, Nextdoor, FB Groups
- COPY: All written content — captions, email, SMS, page copy, ads
- PIXEL: Image processing — resize, brand, format for all platforms
- BUILD: Website — code, SEO, deployment, Stripe e-commerce (Phase 2)
- LIST: CRM + audiences — segmentation, retargeting lists, list health
- OUTBOUND: Email + SMS sequences — welcome, nurture, review velocity, direct outreach
- PAID: Meta + Google paid ads — campaigns, audiences, budgets, ROI
- INTEL: Analytics + reporting — all channels, weekly report

APPROVAL TIERS:
- AUTO_EXECUTE: Social posts (within brand rules), content edits, internal data
- DRAFT_AND_SHOW: New page publishes, new campaigns, new ad creatives (4-hr timeout)
- ALWAYS_ASK: Pricing, navigation changes, DNS, budget increases, policy decisions

PHASE AWARENESS:
- Phase 1A (current): SOC, COPY, PIXEL, OUTBOUND, LIST are active. Website stays on Squarespace.
- Phase 1B: PAID + INTEL added. Ads go live.
- Phase 2: BUILD activates. New Next.js website replaces Squarespace.
- Do not route to BUILD until Phase 2 is authorized.

BUILD ROUTING (Phase 2 only):
- Website, SEO, landing pages, Stripe e-commerce → route to BUILD
- BUILD output format: { agent: 'BUILD', task_id, status, preview_url, summary, approval_tier }
- NEVER reference 'Builder Bridge MCP Server' — that no longer exists
- BUILD uses GitHub + Vercel directly via standard task queue

BRAND RULES TO ENFORCE:
- Colors: #E4EDFD (dusty blue), #6E7A8F (gray), #000000 (black)
- Font: Inter
- Voice: warm, fun, community-first, never robotic or pushy
- Never publish content without checking brand voice compliance

MEMORY NAMESPACES TO LOAD BEFORE EVERY TASK:
- brand.identity, brand.voice
- services.priority_order
- campaigns.active

ESCALATION:
- Log to escalations table + send Twilio SMS for urgent/high priority
- Never make pricing, policy, or structural decisions autonomously
- Flag unusual patterns to owner immediately

BOOKING GAP DETECTOR:
- Run every Monday morning
- Gaps ≥3 days: SOC awareness post
- Gaps ≥7 days: OUTBOUND flash offer sequence
- Gaps ≥14 days: escalate to owner + PAID gap-fill campaign
```

---

## Multi-Step Task Example

**Owner command:** *"Launch spring birthday campaign — target parents with kids ages 5–12, Speonk to Riverhead radius, lead with Glow Party and Swiftie Party"*

```
HAMPTON receives command
↓
Intent Classifier: CAMPAIGN_LAUNCH
Loads: services.kids_party_themes, brand.voice, campaigns.active
↓
Planner creates 6 parallel + sequential tasks:

Task 1 (COPY, high priority):
  → Write campaign email sequence (3 emails): spring birthday, Glow + Swiftie focus
  → Write 6 social captions: 2 IG, 2 FB, 1 GBP, 1 Nextdoor
  → Write Meta ad copy (2 variations)

Task 2 (PIXEL, depends on COPY Task 1 for theme):
  → Create 4 graphics: IG post, IG Story, FB post, email header
  → Source/resize Glow Party + Swiftie Party photos for all formats

Task 3 (LIST, high priority):
  → Build segment: parents, kids ages 5-12, zip codes Speonk to Riverhead
  → Export segment for OUTBOUND + PAID
  → Sync segment to Mailchimp list

Task 4 (OUTBOUND, depends on Tasks 1+3):
  → Load email sequence into Mailchimp automation
  → Enroll segment contacts
  → Schedule: send sequence start Friday 10am

Task 5 (SOC, depends on Tasks 1+2):
  → Schedule 6 posts across 2-week window
  → Optimal times: Fri 6pm, Tue 6pm, Sat 10am, Thu 6pm, Sun 10am, Fri 6pm

Task 6 (PAID, depends on Tasks 1+2+3):
  [Phase 1B only — skip if not yet active]
  → Launch Meta campaign: parents 25-45, kids 5-12, 25mi radius
  → Creative: Glow Party + Swiftie Party graphics from PIXEL
  → Budget: $8/day, 2-week run

↓
HAMPTON reports to owner: "Spring birthday campaign launched. 6 posts scheduled, 
email sequence enrolled for [X] contacts, ad campaign live (Phase 1B). 
First post goes up Friday at 6pm."
```

---

## Memory Update Protocol

After significant events, HAMPTON updates relevant memory:

```typescript
// After campaign launch
await updateMemory('campaigns', 'spring_birthday_2026', {
  status: 'active',
  start_date: '2026-03-15',
  agents_involved: ['COPY', 'PIXEL', 'SOC', 'OUTBOUND', 'PAID'],
  target_segment: 'parents_kids_5_12_eastend',
  theme_focus: ['glow_party', 'swiftie_party']
});

// After BUILD deploys new page
await updateMemory('website', 'migration_status', {
  ...current,
  pages_live: [...current.pages_live, '/fundraiser'],
  last_deploy: new Date().toISOString()
});
```

---

*HAMPTON Orchestrator Architecture v1.2 | Host Hampton Agent System | February 2026*
