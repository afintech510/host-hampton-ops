# Mobile Craft Party — Keyword & SEO Research + Build Notes

_Goal: organically capture "kids craft party" / "mobile craft party near me" demand and grow the
mobile (at-your-house) side of the business, while making clear we do the same crafts **at Host
Hampton OR at your house**, anywhere on Long Island (East Hampton → Nassau, into Manhattan for
larger budgets)._

Date: 2026-09-01 · Studio base: Speonk, NY 11972 (western Southampton Town, East End)

---

## 1. Keyword targets

**Primary (commercial intent, "we come to you"):**
- mobile craft party / mobile craft party near me
- kids craft party / kids craft party near me
- at home arts and crafts party
- mobile art party Long Island
- kids arts and crafts birthday party
- craft party [town] (long-tail, one per location page)

**Craft/activity long-tail (strong on-page + station content):**
- sand art party, canvas painting party kids, slime party, balloon dog painting / drip paint balloon dogs,
  seashell decorating party, bracelet making party, tie-dye / decoden

**Studio-intent (already partly covered by existing pages):**
- birthday party venue Hamptons, kids party Speonk, party room rental Long Island

**Why this structure:** "near me" and "[town]" searches are won with (a) a clear service/Service
schema, (b) real localized landing pages per town, and (c) NAP + LocalBusiness consistency. We had
the studio pages but **no craft-specific or town-specific mobile pages** — that's the gap this build
fills.

---

## 2. Competitor landscape (Long Island mobile / craft parties)

| Competitor | Model | Notes / pricing signal |
|---|---|---|
| **Paint Party LI** (paintpartyli.com) | Mobile, comes to home/clubhouse/backyard | **$40–60/pp**, 10-guest min (11th/birthday child free); **$75 travel fee east of Riverhead or Queens**, 20-guest min out there. Crafts: beach-glass frames (~$375/10 kids), wood signs (~$350/10). Direct competitor. |
| **The Craft'd Bus** (craftdbus.com) | Mobile "craft bus" that parks at your venue | Slime, bear-making, lip balm, splatter/"Splatter Bus" painting. Novelty vehicle angle. |
| **Tiny Artisan Events** (tinyartisanevents.com) | Mobile workshops to your door | Birthdays, bar mitzvahs, camps, corporate. Broad "creative workshops for events" positioning. |
| **The Craft Studio – Parties To-Go** (craftstudionyc.com) | Mobile ("come, set up, entertain, craft, clean, leave") | NYC-based, strong "we do everything" copy — reaches into LI. |
| **Creative Touch LI** (creativetouchli.com) | Studio (Lindenhurst) | Plaster, slime, canvas, glow. Studio-only. |
| **Plaster Kraze** (plasterkraze.com, Holbrook) | Studio | Plaster, tote/t-shirt, sand crafts, candy, teddy bear, tea. Suffolk. |
| **Camp Crafty** | Craft party ideas/events | Content-strong; good for idea keywords. |
| **clowns4kids.com** | Entertainment incl. arts & crafts | NY/NJ/CT/LI reach. |

**Takeaways for positioning:**
1. Most competitors are **either** mobile **or** a studio. Host Hampton can own **"both — your choice"**,
   which is exactly what the owner wants conveyed. That's a genuine differentiator.
2. Paint Party LI sets the price anchor (~$40–60/pp, travel fee past Riverhead). Our mobile quote
   flow (custom, 24-hr turnaround) sidesteps a public per-head price war and lets us upsell station mixes.
3. "Take-home keepsake = party favor" is a repeated selling point across competitors — we lead with it.
4. Nobody is running **per-town** SEO landing pages well. That's the opening.

Sources: Mommy Poppins (LI arts & crafts party roundup), Paint Party LI, Craft'd Bus, Tiny Artisan
Events, The Craft Studio, Creative Touch LI, Plaster Kraze, yourlocalkids.com LI party guide.

---

## 3. What was built (this session)

**New hub page** — `/mobile-craft-party`
- Targets "mobile craft party near me / kids craft party Long Island / at home arts and crafts party".
- Leads with **"at your house OR our Speonk studio"** (the conveyance the owner asked for).
- Craft-forward station grid (canvas painting, sand art, drip-paint balloon dogs, slime, seashell,
  bracelet, bag/hat bars…), links to the full `/mobile-party` menu.
- "Where we go" grid linking every town page. Service + FAQPage JSON-LD.

**New per-town landing pages** — `/mobile-craft-party/[location]` (26 towns, statically generated)
- East End (South & North Fork): Westhampton Beach, Quogue, Hampton Bays, Southampton, Bridgehampton,
  Sag Harbor, East Hampton, Amagansett, Montauk, Sagaponack, Riverhead, Mattituck, Southold, Greenport
- Central Suffolk: Patchogue, Sayville, Bay Shore, Smithtown, Babylon, Huntington
- Nassau: Rockville Centre, Garden City, Long Beach, Great Neck, Manhasset
- NYC: Manhattan
- Each page: localized H1/copy, real neighboring-town internal links, honest **travel-tier note**
  (included ≤~20mi of Speonk → East End small fee → western Suffolk → Nassau → NYC custom quote),
  craft grid, form pre-filled with the town, and Service + FAQPage + BreadcrumbList JSON-LD.
- Data model: `src/lib/locations.ts` (add a town = one array entry; page + sitemap + hub update
  automatically). Craft list: `src/lib/craftStations.ts`.

**Technical SEO** — expanded `src/app/sitemap.xml/route.ts`
- An XML sitemap route already existed (static list). Rewrote it to also include all 26 location
  pages, the 9 craft/theme pages, and live DB content (`website_content`) alongside the existing
  static routes + active events. Preserved the prior URLs (studio-rental, party-quote/-builder/
  -planner, cm-cheer).

**Internal linking / conveyance**
- Nav: added **"Craft Parties"**. Footer: added **"Mobile Craft Parties"**.
- `/mobile-party`: added an "At Your House — or Our Studio" band linking the town finder + room rental;
  broadened its keywords toward craft.
- HTML `/sitemap` page: added the hub + a "Mobile Craft Party Service Areas" section.

---

## 3b. Second build pass (craft-type pages + review schema + homepage band)

**9 craft/theme landing pages** at top-level exact-match slugs, all rendered by one shared
`CraftPartyLanding` component driven by `src/lib/craftParties.ts` (add a page = one data entry):
`/arts-and-crafts-party`, `/slime-party`, `/balloon-dog-painting-party`, `/spa-party`,
`/toddler-party`, `/mermaid-party`, `/squishy-party`, `/shower-venue` (studio-hosted intent),
`/canvas-tote-activation` (B2B brand/corporate activation). Each: Service + FAQPage JSON-LD,
dual-venue band, town marquee, related-craft cross-links, pre-filled quote form.
- **`/glow-party` NOT rebuilt** — it already exists as a bespoke page; we link to it as a related craft.
- **Why not a location×craft matrix (26×~9 ≈ 234 pages):** doorway-page / thin-content risk. Instead
  the craft pages ↔ town pages cross-link, giving matrix coverage without the thin pages. Add specific
  `[craft]/[town]` pages later only where Search Console shows real impressions.

**Review schema** (`src/lib/reviews.ts`): AggregateRating added to the sitewide `EventVenue` schema
(`layout.tsx`) + `Review` nodes on the homepage from the 3 visible testimonials. Values are honest
(5.0 / 3) — **TODO: replace `RATING` with the true GBP average + count** now that GBP is live.

**Homepage band**: "We Bring the Craft Party to You" section linking `/mobile-craft-party` +
`/mobile-party`. Craft pages also wired into the hub (chips row), footer, HTML `/sitemap`, and
`/sitemap.xml`.

## 4. Recommended next steps (not done here)

1. **Google Business Profile**: add "Children's party service" secondary category, set the service-area
   radius, and add photos of at-home craft setups. GBP is where "near me" mobile intent actually converts.
2. **Homepage**: add a mobile-craft-party promo card/band (currently only nav/footer link it) — highest
   on-site conveyance for existing traffic.
3. **Photos**: shoot real at-home craft-party setups per craft (canvas, sand art, balloon dogs). Swap the
   placeholder studio/theme images the new pages currently reuse.
4. **Reviews**: seed 3–5 Google reviews that mention "at our house" + a town name — strongest local signal.
5. **Content**: 1–2 blog posts ("best at-home craft party ideas for kids on Long Island", "sand art vs.
   canvas painting party") to catch idea-stage searches and link down into the hub.
6. **Measure**: watch Search Console for impressions on "[town] + craft party"; prune/merge town pages
   that get zero impressions after ~90 days (avoid thin-page bloat).
