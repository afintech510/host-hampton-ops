# Host Hampton — Deep SEO & Growth Review

**Date:** 2026-09-04 · **Scope:** hosthampton.com + Long Island / East End market · **Author:** Fable research session (repo + web access)

**Evidence tags:** `[search-data]` Google autocomplete pulled live 2026-09-04 (suggestqueries endpoint, gl=us) and web search results · `[competitor]` competitor sites fetched 2026-09-04 · `[our-site]` verified in repo (`services/website/src`) · `[inferred]` reasoning, not measured.

**What was NOT available:** Search Console and GA4 are not connected (Adspirer only holds a Google Ads account for another business), so there is no impression/click data for any page. Google Trends could not be queried programmatically. Competitor Google review counts could not be read (Maps/Yelp blocked automated fetch). Every demand rating below is qualitative (High/Med/Low) with the reasoning shown. This is the single biggest measurement gap and is action #1 in the plan.

---

## 1. Executive summary — the five highest-leverage moves

| # | Move | Why (evidence) | Impact | Effort |
|---|---|---|---|---|
| 1 | **Re-anchor money-page titles on "Long Island / Suffolk County / near me", keep "Hamptons" secondary** | `[search-data]` Autocomplete for "kids birthday party hamptons" drifts to *Hampton VA / Hampton Roads*; "kids birthday party southampton ny" and "…east hampton" return **zero** suggestions. "kids birthday party long island" returns 10 rich suggestions (places, venues, ideas, indoor, entertainment). `[our-site]` Home title is "Birthday Party Venue in the Hamptons, NY"; 4 of 5 studio landing titles lead with Hamptons/Speonk. | High | S |
| 2 | **Consolidate the 26 town pages to ~19 and make the survivors genuinely local** | `[our-site]` Town pages are ~4–5% unique text (~30 words + town name substituted ~18×); 18 of 26 get internal links only from the hub, /sitemap and neighbors. `[competitor]` Emily's Slime Party runs 60+ town pages at ~2,500 words each with local FAQ and blog interlinking — that is what "town + slime party" now competes against. `[search-data]` Micro-towns (Sagaponack, Amagansett, Quogue, Mattituck, Southold) show no autocomplete demand at all. | High (risk removal + rank) | M |
| 3 | **Publish a mobile price anchor** | `[competitor]` Every mobile competitor publishes a number: Emily's $499 in-home / $849 trailer (12 kids), Paint Party LI $300/10 kids canvas (+$75 east of Riverhead, 20 min for travel), Little Art Bus $425. `[our-site]` /mobile-party, all 26 town pages and all 9 craft pages show **no price** — custom quote only. `[search-data]` "birthday party places near me for kids **with price**" is an autocomplete suggestion. | High (conversion) | S (needs owner number) |
| 4 | **Fix the two pages that already sit on trending demand: hat bar and permanent-jewelry parties** | `[search-data]` "hat bar party" → near me / pricing / for kids / trucker hat bar party / hat bar birthday party; "trucker hat bar" → near me / party / pricing. "permanent jewelry party" → near me / at home / cost / packages. `[our-site]` /trucker-hat-bar is titled "Atelier Brim — Bespoke Hat Bar Activations" (no keyword, off-brand name); /permanent-jewelry is walk-in only ("Starting at $65"), no party/at-home angle. Both crafts are things we already do. | High | S–M |
| 5 | **Get listed where East End parents actually look, and turn the 5.0/25 into visible proof** | `[competitor]` Mommy Poppins' Aug-2025 "Top Crafts Birthday Party Places on LI" lists 20 studios, **none east of Westhampton Beach** and no mobile-craft-East-End option; Host Hampton is absent. Also absent from Hamptons Moms "Children's Party Sites", Your Local Kids 2026 Party Guide, and Mommy Poppins' Hamptons venue list (last updated 2013). `[our-site]` Review schema exists but `lib/reviews.ts` RATING is still a TODO placeholder. | Med–High | S |

Everything else in this document supports those five.

---

## 2. Keyword & demand map

Demand = qualitative. "Cover?" is verified against the repo.

| Cluster | Example queries `[search-data]` | Intent | Demand & why | Season | Cover? `[our-site]` | Action |
|---|---|---|---|---|---|---|
| **Kids party venue, LI-modified** | kids birthday party long island · …places/venues long island · indoor kids birthday party long island · toddler birthday party long island | Commercial, local | **High** — 10/10 autocomplete slots filled with LI variants; the anchor cluster | Year-round; Jan and Aug–Sep peaks `[inferred from decor-search seasonality]` | Partial — titles say Hamptons/Speonk, not Long Island | Move 1: retitle home, /party-packages, /kids-party-menu |
| **Near me / venue-finder** | kids birthday party near me · birthday party places near me kids (within 5/20 mi, **with price**, indoor) | Commercial, local pack | **High** — GBP-driven; site can only support via NAP, categories, reviews | Year-round | Partial | GBP work (§6), price on page |
| **Craft / art party** | craft party near me (for kids, for adults, places, bus, **mobile craft party near me**, girls craft party) · art party near me kids · craft birthday party long island | Commercial | **High** — "mobile craft party near me" and "craft party bus near me" both autocomplete; this is our core term | Year-round | Yes — /mobile-craft-party, /arts-and-crafts-party | Deepen hub; add "craft party bus" language honestly (we are not a bus — say "no bus, we set up inside") |
| **Slime** | slime party long island · slime party bus long island · slime party near me · mobile slime party near me · glow in the dark slime party | Commercial | **High** — most developed LI-specific craft cluster; 2 dedicated mobile competitors | Year-round, summer spike (Emily's summer post) | Yes — /slime-party (~225 unique words) | Deepen to 600+ words, add glow-slime + price; do not expect to out-rank Emily's on "slime party long island" in 90 days — target "slime party **East End / Hamptons / Suffolk**" and "slime party **studio**" |
| **Paint party / paint & sip** | paint party long island · **paint and sip long island suffolk** · kids paint party long island · splatter paint party long island · paint and sip east hampton · canvas painting party for kids near me | Commercial | **High** — adults + kids; "suffolk" modifier is explicit | Year-round; Jan–Feb (Galentine's), Oct–Dec | Partial — canvas is a station; no paint-party or adult paint-night page | New: /paint-party (kids) and /paint-and-sip (adult, studio + mobile) |
| **Hat bar** | hat bar party near me · hat bar party pricing · hat bar party for kids · trucker hat bar party · trucker hat bar near me | Commercial, trending | **High** (trend) — full 10-slot autocomplete, party + pricing modifiers | Year-round; strong for teen/bachelorette/summer | Partial — /trucker-hat-bar mis-titled, /custom-accessories | Move 4: rewrite /trucker-hat-bar |
| **Permanent jewelry party** | permanent jewelry party near me · at home · cost · packages · permanent jewelry long island · permanent jewelry hamptons ny | Commercial | **Med–High** — party/at-home modifiers exist; local competitors (Bonded Brilliance, Sparked, Aurelle Bond) are all Nassau/west Suffolk | Summer (Hamptons pop-ups), Nov–Dec | Partial | Move 4: add "permanent jewelry party (studio or at your home)" section + FAQ, price per attach |
| **Spa / glam** | spa party for kids near me · at home · at home spa parties (Your Local Kids directory category) · mobile spa party | Commercial | **Med** — many mobile competitors (Lil Miss Divas, Caps & Tiaras, Bubble), all west of Riverhead | Year-round | Yes — /spa-party | Add "we come to you on the East End" + tween/teen glam variant |
| **Age-specific ideas (TOFU)** | birthday party ideas for 5/8/10 year old (girl/boy) **near me / at home / in winter** · tween/teen birthday party ideas near me · boys birthday party ideas near me | Informational → commercial | **High** — every age query autocompletes "near me" and "at home" | Year-round; "in winter" Nov–Feb | **No** — zero blog/ideas content | 3 posts (§5) |
| **At-home party** | birthday party at home ideas for kids · craft party at home for kids · at home craft party kits | Informational | **Med–High** | Year-round | Partial (/mobile-party) | One pillar post + link to /mobile-party |
| **Toddler / first birthday** | toddler birthday party long island · first birthday party venues near me | Commercial | **Med** | Year-round | Yes — /toddler-party, /first-birthday-parties | Retitle first-birthday to "Long Island"; done otherwise |
| **Showers** | baby shower venue long island (suffolk county, affordable, unique, small) · small bridal shower venues long island | Commercial | **Med–High** — "long island" cluster is rich; "hamptons" cluster is **empty** | Spring/summer | Yes — /shower-venue | Retitle to "Small Baby & Bridal Shower Venue — Suffolk County / East End"; add capacity (65 seated) and price |
| **Party room rental** | party room rental long island · party space rental long island · how much does it cost to rent a party room | Commercial | **Med** | Year-round | Yes — /party-room-rental ($475/3 hr), /studio-rental | Merge into one page (two pages compete); publish price answer as FAQ |
| **Team building / corporate** | team building long island (activities, events, ideas, corporate) | Commercial B2B | **Med** — LI cluster exists; "corporate event hamptons" and "brand activation hamptons" autocomplete **empty** (buyers search differently — agencies, not Google) | Q4, June–Aug (Hamptons activations) | Partial — /canvas-tote-activation | New /team-building page targeting LI cluster; keep activation page as B2B proof, not an SEO play |
| **Girls night / mommy & me** | girls night out ideas long island · girls night activities long island · mommy and me classes long island · mommy and me spa long island · mommy and me classes east hampton | Commercial / event | **Med** | Year-round | Partial — /events (event pages only) | Evergreen /girls-night-out and /moms-in-the-morning pages that list recurring events, not just one-offs |
| **Communion** | communion party venues near me · communion party packages | Commercial | **Med**, sharp season | Feb–May (publish by early Jan) | Yes — /communion-party | Add packages/price + FAQ; internal links from home in Feb |
| **Sensory-friendly** | sensory friendly birthday party places near me · autism friendly birthday party places near me | Commercial | **Med** — real "places near me" demand; LI venues thin (Sensory Island opening, Pixie Dust Bay Shore) | Year-round | No | Section on /toddler-party + GBP attribute now; standalone page only if owner confirms a real quiet-party offering |
| **Fandom themes** | taylor swift party · bluey party · pokemon party · minecraft party | Mostly **supplies/decor**, not services | **Low for us** — autocomplete is decorations/favors/supplies; "taylor swift party nyc / near me" exists but weak | Varies | Swiftie & K-Pop packages exist on /party-packages | **Do not build per-fandom pages** (doorway risk, wrong intent). One "Any Theme" page (§5) |
| **Summer camp / after-school** | summer camp hamptons · summer camp hampton bays ny · day camp hamptons | Commercial | **Med–High**, seasonal | Search Jan–May for summer; Aug for fall | No | Owner decision (§7) — Color Pop Workshop now has studios in Southampton **and Westhampton Beach** |
| **Holiday / seasonal** | halloween craft party for kids · christmas craft workshop kids near me · christmas craft party for kids · holiday craft classes for kids | Event | **Med**, sharp | Sept–Oct; Nov–Dec | Partial (events DB only) | Seasonal landing pages 60–90 days ahead (§5) |
| **Bilingual / Spanish** | (not testable via autocomplete this session) | — | **Unknown** | — | Site already supports `/es/` locale in `website_content` `[our-site]` | Open question (§7) |

---

## 3. Competitor scorecard

All rows `[competitor]` unless noted. Review counts unavailable = "n/a (not fetchable)".

| Competitor | Model | Price anchor | Area | Reviews | Ranking strength | Beats us on | Beatable on |
|---|---|---|---|---|---|---|---|
| **Emily's Slime Party** (Bohemia) | Mobile (trailer + in-home) | $499 in-home / $849 trailer for 12; $600+ schools/camps; **no travel fees** Nassau+Suffolk | All Nassau/Suffolk; 60+ town pages (Garden City→Patchogue, Huntington→Long Beach) | n/a; 3 featured testimonials | **Strong** — 2,500-word town pages, 20+ FAQs, 3,200-word blog posts interlinked | "slime party long island", "slime party [central/west town]", at-home party ideas TOFU | East End (no visible East End town pages), anything not slime, studio option, older kids/adult, showers |
| **The Slime Machine** | Mobile bus | Not published | LI + nearby; schools/camps/corporate | n/a | Med | Themed slime (Taylor Swift, K-pop, Minecraft, Wicked) — proves fandom-themed *slime* converts | Price transparency (none), East End, non-slime |
| **Paint Party LI** (MD Design / Dawn) | Mobile | $300/10 kids canvas (+$22 extra); $375 beach-glass; **$75 fee east of Riverhead**, 20-guest min | Nassau/Suffolk | Yelp listing (count n/a) | Med | "paint party long island", beach-glass/sea-glass crafts (a coastal craft we don't name) | East End economics (their fee + 20 min = our home turf), studio option, kids under 20-guest min |
| **Happy Little Brush Strokes** | Mobile paint | Not published; 8-person min Suffolk | LI | Reviews page | Med | Girl Scout, fundraiser, school paint-night pages (dedicated URLs) | Crafts beyond canvas, East End, studio |
| **Color Pop Workshop** | Studio (UES ×2, **Southampton, Westhampton Beach**) | Not published | East End + NYC | n/a | Med–High for camps/classes | Camps, semester classes, after-school, drop-off, "working artists" credential — **the direct East End threat** | Birthday parties as a product (they are class-first), mobile, themes, showers, adults |
| **Studio Art** (WHB + Water Mill) | Studio walk-in + parties | $25–75/project; parties/camps | East End | Yelp (n/a) | Med (long-established, in every Hamptons list) | Listed in every Hamptons directory; walk-in traffic | Website depth, mobile, hosted/themed packages |
| **Art Studio Hamptons** (WHB) | Studio classes/camps, Sip & Create | $75–450/class, mostly sold out | East End | "Voted Best Art Studio in the Hamptons 2024 & 2025" | Med | Adult workshops, camps, awards/credibility | Kids parties, mobile |
| **Hampton Kids** (Wainscott) | Venue | From $450/10 kids, 2 hr | South Fork | n/a | Med (in every Hamptons list) | "kids party wainscott/east hampton" venue searches | Craft depth, mobile, at-home |
| **Creative Touch LI** (Lindenhurst) | Studio | Not published | West Suffolk | n/a | Low–Med | — | Everything east of Babylon |
| **Plaster Kraze** (Centereach) | Studio walk-in | Not published | Central Suffolk | n/a | Low–Med | walk-in plaster | Mobile, East End |
| **Mobile spa cluster** (Lil Miss Divas, Caps & Tiaras, Bubble, Lil Divas St. James) | Mobile | Not published | Nassau/west Suffolk | n/a | Med for "spa party" | "mobile spa party long island" | East End at-home spa (none of them base east of St. James) |
| **Host Hampton** `[our-site]` | **Studio + mobile** | Studio $800–950/10 kids; room $475/3 hr; **mobile: no price** | Speonk; free ≤20 mi; all LI + NYC | GBP 25 / 5.0 (owner brief) | Weak–Med (new pages, thin, few internal links, no TOFU) | Two-venue flexibility, theme breadth, showers, hat bar, permanent jewelry, fully hosted | — |

**Where we win on structure `[inferred]`:** nobody else on Long Island is both studio *and* mobile with a craft menu this wide **and** based east of Riverhead. The whole mobile field treats the East End as a surcharge zone; we treat it as home. That is the message every page should carry, and it is currently absent from the home H1.

---

## 4. Our-site gap list

### 4a. Coverage gaps (build these)

| Gap | Query cluster | Reason | Doorway risk? |
|---|---|---|---|
| **/paint-party** (kids canvas/splatter, studio or mobile) | paint party long island, kids paint party near me, splatter paint party long island | Canvas is already a station; competitors own this cluster with dedicated pages; we have none | No — distinct craft, distinct FAQ, price |
| **/paint-and-sip** (adult, studio + at-your-house) | paint and sip long island suffolk, paint and sip east hampton, girls night out ideas long island | Adult cluster with explicit Suffolk modifier; our Girls Night Out exists only as event listings | No |
| **/trucker-hat-bar rewrite** | hat bar party near me/pricing/for kids | Page exists but targets nothing; trending cluster | No |
| **/permanent-jewelry party section** | permanent jewelry party near me/at home/cost/packages | Existing page is walk-in only | No |
| **/team-building** | team building long island/activities/events | B2B cluster with real LI demand; /canvas-tote-activation targets an empty query | No |
| **/party-themes ("any theme")** — one page listing 30+ themes we can do (Swiftie, K-Pop, Barbie, Bluey, Pokémon, Minecraft, mermaid, glow, sleep-under, sweets…) with 1–2 lines each and a "name yours" form | taylor swift party near me, [theme] party long island | Captures fandom long-tail on **one** page; answers "flexibility not searchable" | Explicitly **instead of** per-fandom pages |
| **3 TOFU posts** (see §5 W5–W8) | birthday party ideas for 8 year old girl near me/at home; tween birthday party ideas near me; birthday party at home ideas for kids | Zero informational content; every age query carries "near me/at home" | No |
| **Seasonal pages, 60–90 days early** | halloween craft party for kids; christmas craft workshop kids near me; communion party packages | Event-DB pages expire; need evergreen URLs that get re-used yearly | No if one URL per season reused |
| **Sensory-friendly section + GBP attribute** | sensory friendly birthday party places near me | Real demand, thin LI supply | Section only until offering confirmed |
| **North Fork region page** | (replaces Mattituck/Southold/Greenport) | Three micro-town pages with no demand → one real page | Reduces risk |

### 4b. Conversion gaps `[our-site]`

- **Home H1** ("The Upscale Party Experience — at Prices You'd Pay Anywhere") says neither *kids*, *Long Island*, nor *we come to you*. The two-venue message is a promo band, not the headline.
- **No mobile price anywhere** (see Move 3). Competitors' anchors are $300–$849.
- **Two rental pages** (/party-room-rental $475, /studio-rental "seats 65") split one intent.
- **Review proof**: `lib/reviews.ts` RATING still a TODO; AggregateRating in schema must match GBP (25 / 5.0) or it is a rich-result liability.
- **/mobile-party has 28 stations and a form**; no "most-booked" shortlist, no price, no photos of real at-home parties (mermaid/squishy/balloon-dog use placeholders per `mobile-craft-party-seo.md`).

### 4c. Technical / authority gaps `[our-site]`

| Item | Detail | Fix |
|---|---|---|
| Town-page thinness | ~30 unique words/page, 5 travel-note variants shared verbatim | Consolidate (Move 2), then 300–500 genuinely local words per survivor: nearby venues we've served, real photos, drive-time, a named review |
| Internal links | 18/26 towns linked only from hub, /sitemap, neighbors; craft pages linked from no nav/home/packages | Footer "Serving" block (8 towns + hub), home links to 4 craft pages, /party-packages → "prefer it at your house?" links |
| `lastmod = now()` | All 35 town/craft URLs report today's date on every request | Use a build/deploy timestamp or a per-page `updatedAt` in the data files |
| Sitemap includes a redirect | `/party-add-ons` 307s to /kids-party-menu | Remove from sitemap |
| Schema gaps | No `Organization`/`WebSite`; no `Product/Offer` on /party-packages despite public prices; `BreadcrumbList` only on town pages | Add sitewide Organization + WebSite; Offer per package; breadcrumbs on craft pages |
| Off-brand URLs on primary domain | `/boggle`, `/cora`, `/li-high`, "Atelier Brim" naming | noindex /boggle and /cora; fold /li-high into /fundraiser |
| Robots | `/portal`, `/my-booking` not disallowed | Add |
| Title modifier | "Hamptons" ambiguous vs Hampton VA (Move 1) | Retitle |
| Measurement | No GSC/GA4 connection reachable | Connect (W1) |

### 4d. Explicitly rejected

- **Town × craft matrix** (26×9): rejected (already rejected in `mobile-craft-party-seo.md`; reaffirmed — Emily's proves depth beats breadth).
- **Per-fandom pages** (Bluey, Pokémon, Minecraft, Taylor Swift): autocomplete intent is supplies/decor, and each page would be 200 words around a name. One /party-themes page instead.
- **"Hamptons"-variant duplicates** of existing pages ("kids party Hamptons", "party venue Hamptons"): the modifier has no measurable local demand and collides with Virginia.
- **More East End micro-town pages**: none. Fold seven existing ones.
- **A "craft party bus" page**: we don't run a bus; a page claiming one is a bait page. Mention honestly on the hub instead.

---

## 5. 90-day action plan (sequenced)

Success metric column assumes GSC is connected in week 1. Owner-blocked items are marked **[owner]**.

### Weeks 1–2 — measurement, quick wins, risk removal

| # | Action | Target query | Page/URL | Success metric |
|---|---|---|---|---|
| 1 | Connect Search Console + GA4 (Adspirer connector or direct); verify all 65+ URLs indexed; submit sitemap | — | GSC | Baseline impressions/clicks by page captured by day 10 |
| 2 | Retitle: home → "Kids Birthday Party Venue & Mobile Parties — Long Island / East End (Speonk, NY)"; /party-packages, /kids-party-menu, /first-birthday-parties, /shower-venue → lead with "Long Island" or "Suffolk County" | kids birthday party long island; baby shower venue long island | 5 pages | Impressions on "long island" queries up vs baseline by day 60 |
| 3 | Rewrite home H1 + subhead to state kids + Long Island + "at our Speonk studio **or at your house**" | — | / | Form submits from home (GA event) |
| 4 | **[owner]** Publish a mobile price anchor ("Mobile craft parties from $X for 10 kids, travel free within 20 mi of Speonk") on /mobile-party, hub, craft and town pages | with price / cost queries | 37 pages via shared component | Mobile quote requests per 100 sessions |
| 5 | Consolidate towns: 301 quogue, bridgehampton, amagansett, sagaponack → southampton/east-hampton (as "also serving" lists); mattituck, southold, greenport → new /mobile-craft-party/north-fork; update `locations.ts`, sitemap, hub | — | 7 URLs | No 404s; hub still lists all towns as text |
| 6 | Internal-link pass: footer "Serving" block; home → 4 craft pages; /party-packages → hub; craft pages → all surviving towns | — | Footer, home, packages | Every town/craft page has ≥3 non-hub inbound links |
| 7 | Sitemap hygiene: real `lastmod`, drop /party-add-ons, robots disallow /portal & /my-booking, noindex /boggle & /cora | — | sitemap.xml, robots.ts | Clean GSC coverage report |
| 8 | Set true GBP values in `lib/reviews.ts`; add Organization + WebSite schema; Offer on packages | — | layout, packages | Rich-result test passes |

### Weeks 3–6 — pages on proven demand

| # | Action | Target query | Page/URL | Success metric |
|---|---|---|---|---|
| 9 | Rewrite /trucker-hat-bar → "Hat Bar Party — Trucker Hat Bar for Kids, Teens & Events (Long Island)"; price per hat, studio/mobile, 5 FAQs | hat bar party near me / pricing / for kids | /trucker-hat-bar (keep URL, 301 nothing) | Top-20 for "hat bar party long island" by day 90 |
| 10 | Add "Permanent Jewelry Parties — studio or at your home" section, package price, FAQ | permanent jewelry party near me / cost | /permanent-jewelry | Impressions on "party" variants |
| 11 | Build /paint-party (kids) with splatter + canvas + glow variants; 600+ words; price | kids paint party long island; splatter paint party long island | new | Indexed + impressions by day 60 |
| 12 | Build /paint-and-sip (adults; studio nights + mobile to your house) and evergreen /girls-night-out that lists recurring events | paint and sip long island suffolk; girls night out ideas long island | new ×2 | Event ticket sales attributed |
| 13 | Deepen /slime-party and /spa-party to 600+ words each: East End at-home angle, glow-slime, tween glam, price, real photos | slime party hamptons / east end / suffolk | existing | Position improvement on tracked terms |
| 14 | Build /party-themes ("Any theme, studio or mobile") listing 30+ themes, 1–2 lines each, request form | [theme] party near me / long island | new | Form submits naming a theme not on /party-packages |
| 15 | Merge /studio-rental into /party-room-rental (301), add "how much does it cost to rent a party room" FAQ, capacity, shower use | party room rental long island; how much to rent a party room | /party-room-rental | Single URL ranking |
| 16 | **Halloween page live by Sept 15** (craft party / workshop, kids + adults); reuse URL yearly | halloween craft party for kids | /halloween-craft-party | Event sell-through |

### Weeks 7–12 — content, seasonality, authority

| # | Action | Target query | Page/URL | Success metric |
|---|---|---|---|---|
| 17 | Post 1: "Birthday party ideas for 8-year-old girls on Long Island (at home or at a studio)" → links to spa, hat bar, slime, mobile | birthday party ideas for 8 year old girl near me / at home | /ideas/… (new route) | Impressions on "ideas … near me" |
| 18 | Post 2: "Tween & teen birthday party ideas on Long Island that aren't a trampoline park" | tween birthday party ideas near me | /ideas/… | Assisted conversions |
| 19 | Post 3: "At-home birthday party on the East End: what a hosted craft party actually includes (and costs)" | birthday party at home ideas for kids; craft party at home | /ideas/… | Links to /mobile-party clicked |
| 20 | **Holiday craft workshop page live by Oct 1**; winter-break page by Nov 1; **communion page refreshed with packages by Jan 5**; summer beach-house / rental-family page by March 1 | christmas craft workshop kids near me; communion party packages | seasonal URLs | Published ≥60 days before peak |
| 21 | Build /team-building (Long Island, studio or on-site; tote bar, hat bar, canvas) and link /canvas-tote-activation as case study | team building long island | new | B2B inquiries |
| 22 | Listings & PR: request inclusion in Mommy Poppins craft list + Hamptons venue list, Hamptons Moms party sites, Your Local Kids party guide (advertise/directory), Macaroni Kid Hamptons; Patch business listing already exists | — | off-site | 4 new referring domains |
| 23 | Review flywheel: post-party SMS asking for a review that names the town and "at our house / at the studio"; target 25 → 40 GBP reviews | local pack | GBP | 40 reviews by day 90 |
| 24 | GBP: add secondary categories (Party planner, Children's party service, Art studio, Event venue), service-area radius, services list with prices, weekly posts, 20+ real photos, seed Q&A with the FAQs above | near me cluster | GBP | GBP calls + direction requests up |

---

## 6. Measurement

**Track (GSC):** impressions/clicks/position grouped by cluster: LI-venue, craft/mobile, slime, paint, hat bar, jewelry, showers, room rental, ideas (TOFU), seasonal, towns. Annotate every retitle and launch date.

**Track (GA4):** form submits by landing page (studio quote vs mobile quote), event ticket purchases, click-to-call, and "theme requested" text field.

**Track (GBP):** calls, direction requests, website clicks, review count/velocity, photo views, and the query insights list (feed these into FAQs monthly).

**90-day kill / scale criteria**

| Page set | Kill (day 90) | Scale |
|---|---|---|
| Surviving town pages | 0 impressions **and** 0 form submits → 301 to region page | ≥50 impressions or any submit → add 300 more local words, a local photo, a named review |
| Craft pages | <20 impressions → merge into hub section | ≥100 impressions → add price table, video, second FAQ block |
| Ideas posts | <50 impressions → rewrite title to the autocomplete phrasing | ≥200 impressions → add a second post in the series |
| Seasonal pages | Never kill; refresh 60–90 days before next season | — |

---

## 7. Open questions for the owner

Only what data and the repo cannot answer.

1. **What mobile price can be published?** A "from $X for 10 kids within 20 mi" anchor is the highest-conversion single change and blocks actions 4, 9–13.
2. **What are the GBP primary/secondary categories and the service-area setting today?** Needed to decide the near-me strategy and whether "Long Island" or "Speonk" is the effective radius.
3. **Do you want to sell camps / after-school / drop-off classes?** Color Pop Workshop now has studios in Southampton and Westhampton Beach; this is the East End demand cluster we are most exposed on, but it is a different operating model.
4. **Is a quiet / sensory-friendly party a real offering** (lower guest count, no music, dimmed lights)? If yes it becomes a page; if not, it stays a line in the toddler FAQ.
5. **Is Manhattan mobile real and profitable?** If not, the Manhattan page should be reframed as "NYC corporate & brand events" or dropped.
6. **Spanish-language demand:** the site already supports `/es/` content. Do South Fork inquiries arrive in Spanish, and is there a bilingual host? That decides whether to publish an `/es/` hub.
7. **Which crafts have you actually delivered mobile in the last 12 months, and where?** Real town + craft pairs (with photos and a review) are what make the surviving town pages non-thin.
8. **Can Search Console and GA4 be shared** (to the Adspirer connector or a Google account this session can use)? Without it the 90-day kill criteria cannot be applied.

---

### Sources consulted

Google autocomplete (suggestqueries, gl=us, 2026-09-04, ~85 seeds; raw output kept in session scratchpad) · emilysslimeparty.com (home, East Islip town page, summer blog post) · paintpartyli.com (home; kids-parties via search snippet) · theslimemachine.com/party-packages · happylittlebrushstrokes.com · colorpopworkshop.com · artstudiohamptons.com · creativetouchli.com · plasterkraze.com · mommypoppins.com (Hamptons venues 2013; LI crafts Aug-2025; tween ideas 2022; mobile spa list) · hamptonsmoms.com children's party sites · yourlocalkids.com LI party guide 2026 · patch.com (Studio Art Water Mill) · repo: `services/website/src/app/**`, `lib/locations.ts`, `lib/craftParties.ts`, `lib/reviews.ts`, `app/sitemap.xml/route.ts`, `app/robots.ts`, `docs/marketing/*.md`.
