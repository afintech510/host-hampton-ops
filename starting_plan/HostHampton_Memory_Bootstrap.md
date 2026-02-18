# 🧠 Agent Memory Bootstrap
**Shared Knowledge Base | Load into `agent_memory` table on first deploy**
**All agents read from this. HAMPTON and owner write to it.**

---

## How This Works

On first deploy, Claude Code runs `memory_bootstrap.ts` which inserts all entries below into Supabase `agent_memory`. Every agent pulls relevant namespaces at task start. HAMPTON updates memory after every significant campaign, performance report, or business change.

---

## Bootstrap Script

```typescript
// scripts/memory_bootstrap.ts
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_KEY!
)

const memory: MemoryEntry[] = [
  // ── All entries below ──
]

async function bootstrap() {
  for (const entry of memory) {
    const { error } = await supabase
      .from('agent_memory')
      .upsert(entry, { onConflict: 'namespace,key' })
    
    if (error) console.error(`Failed: ${entry.namespace}.${entry.key}`, error)
    else console.log(`✅ Loaded: ${entry.namespace}.${entry.key}`)
  }
  console.log('Memory bootstrap complete.')
}

bootstrap()
```

---

## Memory Entries

### NAMESPACE: brand

```json
{
  "namespace": "brand",
  "key": "identity",
  "description": "Core business identity — load on every task",
  "value": {
    "business_name": "Host Hampton",
    "tagline": "Celebrate Here.",
    "type": "Boutique event studio and multi-revenue celebration space",
    "address": "295 Montauk Highway, Speonk, NY 11972",
    "phone": "(631) 998-9325",
    "email": "hosthampton295@gmail.com",
    "website": "https://www.hosthampton.com",
    "instagram": "https://www.instagram.com/hosthampton/",
    "facebook": "https://www.facebook.com/p/Host-Hampton-61564504617893",
    "google_maps": "https://g.co/kgs/3iWi7CM",
    "booking_links": {
      "kids_party": "[FILL IN — HoneyBook public link for party inquiries]",
      "permanent_jewelry": "[FILL IN — cal.com or scheduling link for jewelry appointments]",
      "room_rental": "[FILL IN — HoneyBook or inquiry form link]",
      "workshops_events": "[FILL IN — cal.com or Eventbrite link for workshops/tickets]"
    },
    "years_open": 1,
    "first_year_revenue": 100000,
    "monthly_fixed_costs": 2500
  }
}
```

```json
{
  "namespace": "brand",
  "key": "voice",
  "description": "Tone, personality, and writing rules for all content",
  "value": {
    "persona": "Like a friend who throws amazing parties — stylish but real, helpful but not overwhelming. Knowledgeable but approachable.",
    "tone_words": ["warm", "fun", "community-first", "approachable", "celebratory", "genuine"],
    "never_sound": ["corporate", "pushy", "salesy", "cold", "generic", "robotic"],
    "voice_by_service": {
      "kids_party": "Exciting, colorful, parent-relief focused. 'You show up, we handle everything.'",
      "adult_events": "Sophisticated, fun, you-deserve-this energy.",
      "business_rental": "Professional, flexible, ROI-aware. Peer-to-peer entrepreneur tone.",
      "community": "Warm, giving, neighborhood pride.",
      "permanent_jewelry": "Trendy, feminine, gift-worthy."
    },
    "cta_always": true,
    "cta_examples": ["Book your date →", "DM us to check availability", "Link in bio to see themes", "Reply to this story"],
    "never_start_with": ["We are excited to announce", "We are pleased to", "It is with great pleasure"],
    "emoji_policy": "Use freely but purposefully — match the service vibe",
    "contractions": "Always use — 'we're' not 'we are'"
  }
}
```

```json
{
  "namespace": "brand",
  "key": "visual",
  "description": "Photography style, image specs, and design rules",
  "value": {
    "photo_style": ["bright", "warm-toned", "candid party moments", "design-forward", "clean backgrounds"],
    "color_palette": {
      "dusty_blue": "#E4EDFD",
      "gray": "#6E7A8F",
      "black": "#000000"
    },
    "fonts": {
      "primary": "Inter"
    },
    "watermark": {
      "position": "bottom-right",
      "opacity": 0.85,
      "size_percent_of_width": 15
    },
    "platform_sizes": {
      "ig_post": "1080x1080",
      "ig_portrait": "1080x1350",
      "ig_story": "1080x1920",
      "ig_reel": "1080x1920",
      "fb_post": "1200x630",
      "fb_story": "1080x1920",
      "fb_cover": "820x312",
      "gbp_post": "1200x900",
      "email_header": "600x200",
      "pinterest": "1000x1500",
      "nextdoor": "1200x900"
    },
    "photo_consent": "Blur or exclude children's faces in any public-facing content unless parent consent documented"
  }
}
```

```json
{
  "namespace": "brand",
  "key": "hashtags",
  "description": "Pre-approved hashtag sets by category — use these, don't invent new ones",
  "value": {
    "kids_birthday": [
      "#HostHampton","#HamptonsBirthday","#LongIslandKids","#SpeonkNY",
      "#WesthamptonMoms","#KidsBirthdayParty","#BirthdayVenueLI",
      "#LongIslandMoms","#HamptonsKids","#PartyVenueNY","#KidsPartyIdeas",
      "#BirthdayPartyInspo","#LongIslandPartyVenue","#HamptonsParty"
    ],
    "permanent_jewelry": [
      "#PermanentJewelry","#WeldedBracelet","#HamptonsJewelry",
      "#LongIslandJewelry","#PermanentBracelet","#JewelryHamptons",
      "#GirlsNightLI","#WeldedJewelry","#ChainBracelet"
    ],
    "room_rental": [
      "#EventSpaceHamptons","#VenueRentalLI","#PartyRoomLongIsland",
      "#EventVenueNY","#DIYParty","#EventSpaceLI"
    ],
    "community": [
      "#Speonk","#WesthamptonBeach","#Southampton","#HamptonBays",
      "#LongIslandLocal","#HamptonsLife","#SuffolkCounty",
      "#LongIslandMoms","#HamptonsMoms"
    ],
    "adult_events": [
      "#AdultWorkshop","#CraftNight","#GirlsNightOut","#HamptonsEvents",
      "#LongIslandEvents","#AdultCrafts","#WomenInHamptons"
    ],
    "business_rental": [
      "#PopUpShop","#StudioRental","#HamptonsStudio","#LongIslandBusiness",
      "#SmallBusinessLI","#PopUpHamptons"
    ]
  }
}
```

---

### NAMESPACE: services

```json
{
  "namespace": "services",
  "key": "priority_order",
  "description": "Revenue stream priority — weight promotional efforts accordingly",
  "value": {
    "1": "kids_party",
    "2": "permanent_jewelry",
    "3": "room_rental",
    "4": "host_your_client",
    "5": "trucker_hat_bar",
    "6": "workshops",
    "7": "fundraisers",
    "8": "craft_events",
    "9": "photography_studio",
    "10": "pop_up_vendor",
    "11": "seasonal_retail"
  }
}
```

```json
{
  "namespace": "services",
  "key": "kids_party_themes",
  "description": "All available party themes — keep current as new themes launch",
  "value": {
    "themes": [
      {
        "name": "Spa Party",
        "tier": "standard",
        "age_range": "5-12",
        "highlights": ["facials", "nail painting", "spa robes", "cucumber water"]
      },
      {
        "name": "Swiftie Party",
        "tier": "standard",
        "age_range": "6-14",
        "highlights": ["friendship bracelet station", "Taylor trivia", "Eras Tour decor", "karaoke"]
      },
      {
        "name": "Barbie Party",
        "tier": "standard",
        "age_range": "4-10",
        "highlights": ["pink decor", "fashion design station", "Barbie trivia"]
      },
      {
        "name": "Unicorn Party",
        "tier": "standard",
        "age_range": "3-8",
        "highlights": ["pastel decor", "craft station", "unicorn horns"]
      },
      {
        "name": "Slime Party",
        "tier": "standard",
        "age_range": "5-12",
        "highlights": ["make your own slime", "add-ins and glitter", "take-home containers"]
      },
      {
        "name": "Glow Party",
        "tier": "premium",
        "age_range": "5-14",
        "highlights": ["UV black lights", "glow accessories", "neon decor", "DJ upgrade available"]
      },
      {
        "name": "Toddler Soft Play Party",
        "tier": "standard",
        "age_range": "1-4",
        "highlights": ["soft play equipment", "sensory stations", "parent-friendly setup"]
      },
      {
        "name": "Trucker Hat Party",
        "tier": "standard",
        "age_range": "7-14",
        "highlights": ["custom hat design", "iron-on patches", "take home creation"]
      },
      {
        "name": "Sweets & Treats Decorating",
        "tier": "standard",
        "age_range": "4-12",
        "highlights": ["decorate cookies/cupcakes", "candy stations", "take-home boxes"]
      }
    ],
    "add_ons": [
      "Photo booth",
      "Glitter tattoos",
      "Hair tinsel",
      "Balloon garland upgrade",
      "Candy wall",
      "Slime add-on station",
      "DJ upgrade",
      "Glow upgrade package",
      "Piñata"
    ]
  }
}
```

---

### NAMESPACE: social

```json
{
  "namespace": "social",
  "key": "posting_schedule",
  "description": "Optimal posting times per platform — based on Hamptons/LI audience behavior",
  "value": {
    "instagram": {
      "best_days": ["Tuesday", "Thursday", "Friday", "Saturday", "Sunday"],
      "best_times": ["6:00 PM", "7:00 PM", "10:00 AM"],
      "avoid": ["Monday morning", "After 9 PM"],
      "stories": "Post 3-5x per week, any time — stories decay in 24hrs so fresh content daily preferred",
      "reels": "Post 1-2x per week — Tuesday or Friday preferred for algorithm boost"
    },
    "facebook_page": {
      "best_days": ["Wednesday", "Thursday", "Friday"],
      "best_times": ["12:00 PM", "3:00 PM", "7:00 PM"]
    },
    "facebook_groups": {
      "cadence": "Max 1 post per group per week",
      "best_days": ["Tuesday", "Wednesday", "Thursday"],
      "best_times": ["9:00 AM", "12:00 PM"]
    },
    "google_business_profile": {
      "cadence": "1x per week minimum",
      "best_days": ["Monday", "Tuesday"],
      "note": "GBP posts expire after 7 days — must post weekly to stay visible"
    },
    "nextdoor": {
      "cadence": "1-2x per month",
      "note": "Treat as community member, not advertiser — soft tone always"
    }
  }
}
```

```json
{
  "namespace": "social",
  "key": "facebook_groups",
  "description": "Local Facebook groups to post in — update as new groups found",
  "value": {
    "groups": [
      {
        "name": "Westhampton Area Moms",
        "id": "[FILL IN GROUP ID]",
        "members_approx": "[FILL IN]",
        "rules": "No hard selling. Community posts only.",
        "cadence": "1x per week max"
      },
      {
        "name": "Hampton Bays Community",
        "id": "[FILL IN GROUP ID]",
        "rules": "Local events and recommendations welcome",
        "cadence": "1-2x per month"
      },
      {
        "name": "Southampton Moms",
        "id": "[FILL IN GROUP ID]",
        "rules": "[FILL IN after joining]",
        "cadence": "1x per week max"
      },
      {
        "name": "Long Island Kids Events",
        "id": "[FILL IN GROUP ID]",
        "rules": "Events and family activities welcome",
        "cadence": "1-2x per week"
      },
      {
        "name": "Riverhead Community Board",
        "id": "[FILL IN GROUP ID]",
        "rules": "[FILL IN after joining]",
        "cadence": "2x per month"
      }
    ],
    "note": "FILL IN group IDs after owner confirms admin/member status in each group"
  }
}
```

---

### NAMESPACE: calendar

```json
{
  "namespace": "calendar",
  "key": "seasonal_priorities",
  "description": "Month-by-month content and campaign focus",
  "value": {
    "january": {
      "push": ["New Year booking campaign", "Valentine's Day party planning"],
      "email": "New year — book early, slots fill fast",
      "social_theme": "Fresh start, new themes for 2026"
    },
    "february": {
      "push": ["Valentine's Day permanent jewelry", "Galentines workshop", "Valentine party add-on"],
      "email": "Gift a permanent bracelet for Valentine's Day",
      "social_theme": "Love-themed parties, jewelry gift guide"
    },
    "march": {
      "push": ["Spring break camps/parties", "Easter-themed party push"],
      "email": "Spring break party ideas + availability",
      "social_theme": "Spring vibes, pastel themes, spring break fun"
    },
    "april": {
      "push": ["Spring market vendor spots", "Spring birthday peak begins"],
      "email": "Spring market announcement + spring party themes",
      "social_theme": "Spring parties, market preview, birthday season"
    },
    "may": {
      "push": ["Mother's Day permanent jewelry", "Spring birthday peak", "End of school parties"],
      "email": "Mother's Day gift — permanent jewelry + party slots",
      "social_theme": "Moms + kids, celebration season, jewelry gifts"
    },
    "june": {
      "push": ["Summer camps/parties launch", "End of school year parties", "Summer birthday peak"],
      "email": "Summer camp and party schedule — book now",
      "social_theme": "Summer fun, beach themes, school's out"
    },
    "july": {
      "push": ["Summer birthday peak (highest volume month)", "Beach and tropical themes"],
      "email": "Last summer slots — book before they're gone",
      "social_theme": "Peak summer parties, showcasing real events"
    },
    "august": {
      "push": ["Back to school launch", "Fall booking campaign opens", "Labor Day events"],
      "email": "Book fall parties now — September fills fast",
      "social_theme": "Summer wrap-up, fall preview, back to school fun"
    },
    "september": {
      "push": ["Fall birthday season", "Fundraiser outreach to schools/PTAs STARTS NOW"],
      "email": "Fundraiser partnership invite to schools + teams",
      "social_theme": "Fall themes, cozy vibes, fundraiser program"
    },
    "october": {
      "push": ["Halloween workshops", "Halloween party theme", "Fall pop-up market"],
      "email": "Halloween party + adult workshop announcement",
      "social_theme": "Halloween, spooky fun, fall market"
    },
    "november": {
      "push": ["Holiday market planning", "Holiday party booking opens", "Friendsgiving workshops"],
      "email": "Holiday party — book your December date now",
      "social_theme": "Holiday prep, market teasers, gratitude content"
    },
    "december": {
      "push": ["Holiday market", "Holiday party peak", "Gift card push", "New Year preview"],
      "email": "Gift card + last minute holiday booking",
      "social_theme": "Holiday magic, real events, gift card promos"
    }
  }
}
```

---

### NAMESPACE: market

```json
{
  "namespace": "market",
  "key": "positioning",
  "description": "Competitive advantages and positioning — use in ad copy and pitches",
  "value": {
    "against": ["Chuck E Cheese", "bowling alleys", "generic party halls", "restaurant party rooms", "home parties"],
    "advantages": [
      "Design-forward aesthetic — Instagram-worthy decor included",
      "Fully themed and turnkey — parents show up, we handle everything",
      "Boutique and personal — you're not just a party number",
      "Multi-use space — studio, venue, and professional hub in one",
      "Community-rooted — local Hamptons family, not a franchise",
      "Entrepreneur-friendly — small business owners welcome"
    ],
    "emotional_drivers": {
      "parents": "You want your child's birthday to be magical without it being stressful",
      "kids": "The party that all their friends talk about for months",
      "business_clients": "A beautiful space that makes you look professional without overhead",
      "community": "A local spot that's invested in this neighborhood"
    },
    "positioning_statement": "Host Hampton is the modern celebration studio for families who want something beautiful, effortless, and real — not a generic party mill."
  }
}
```

```json
{
  "namespace": "market",
  "key": "target_keywords",
  "description": "SEO and Google Ads keywords by service — research quarterly",
  "value": {
    "kids_parties": [
      "birthday party venue long island",
      "kids party place near me",
      "children party venue suffolk county",
      "themed birthday party ny",
      "all inclusive birthday party long island",
      "swiftie party venue",
      "glow party long island",
      "spa party birthday long island"
    ],
    "permanent_jewelry": [
      "permanent jewelry near me",
      "welded bracelet long island",
      "permanent bracelet hamptons",
      "welded jewelry suffolk county",
      "permanent anklet near me"
    ],
    "room_rental": [
      "rent party room suffolk county",
      "event space rental hamptons",
      "party room rental long island",
      "studio rental westhampton"
    ],
    "host_your_client": [
      "pop up space rental hamptons",
      "studio rental long island",
      "professional space rental suffolk",
      "photo studio rent long island"
    ]
  }
}
```

---

### NAMESPACE: operations

```json
{
  "namespace": "operations",
  "key": "booking_rules",
  "description": "Operational policies agents need to know when answering questions",
  "value": {
    "advance_booking": "Recommended 4-6 weeks for parties, 2 weeks minimum",
    "deposit": "$200 security deposit required to confirm",
    "cancellation": "100% of the deposit is non-refundable. The deposit is transferable and may be applied towards a future event booking. There are no refunds given for parties canceled at any time. Host Hampton reserves the right to cancel or reschedule events due to unforeseen circumstances (e.g. severe weather, safety concerns) — in such cases the customer may reschedule without penalty or receive a full refund.",
    "capacity": {
      "base": 10,
      "max_with_fee": 15,
      "additional_guest_fee": "$35 per additional guest above 10"
    },
    "age_range": "Birthday parties primarily for ages 2-14",
    "party_duration": "2 hours included",
    "food_included": "Pizza or bagels + juice/water",
    "arrival": "15 minutes before party for setup walkthrough",
    "cleanup": "Included — venue cleaned by staff after event",
    "recurring": {
      "tuesday_morning": "Moms in the Morning — open soft play, $10 drop-in",
      "time": "Check current schedule for specific hours"
    }
  }
}
```

---

## Memory Update Protocol

After significant events, HAMPTON should update relevant memory keys:

```typescript
// Example: Update after new theme launches
await supabase.from('agent_memory')
  .update({
    value: { ...currentValue, themes: [...currentThemes, newTheme] },
    updated_by: 'HAMPTON'
  })
  .eq('namespace', 'services')
  .eq('key', 'kids_party_themes')

// Example: Update after campaign performance review  
await supabase.from('agent_memory')
  .upsert({
    namespace: 'analytics',
    key: 'channel_performance',
    value: {
      instagram: { leads_this_month: 23, cpl: 0 },
      google_ads: { leads_this_month: 8, cpl: 18.50 },
      facebook: { leads_this_month: 12, cpl: 0 },
      email: { leads_this_month: 15, cpl: 0 },
      referral: { leads_this_month: 9, cpl: 0 }
    },
    updated_by: 'INTEL'
  }, { onConflict: 'namespace,key' })
```

---

## Fields to FILL IN Before First Deploy

Search for `[FILL IN]` throughout this file and complete:

- [ ] `brand.identity.phone`
- [ ] `brand.identity.email`
- [ ] `brand.identity.booking_link`
- [ ] `brand.visual.color_palette` (pull from website CSS)
- [ ] `brand.visual.fonts` (pull from website)
- [ ] `social.facebook_groups` — all group IDs and rules
- [ ] `operations.booking_rules.cancellation` policy
- [ ] `operations.booking_rules.capacity.additional_guest_fee`
- [ ] All pricing data (add `services.pricing` namespace with current rates — keep out of this file for security, store separately and load from env or Supabase vault)

---

*Memory Bootstrap v1.0 | Host Hampton Agent System*
