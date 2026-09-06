# Host Hampton — "Chief of SEO" Local Audit Playbook

Adapted from the 20-part local-SEO audit system (Sarvesh Shrivastava / @bloggersarvesh, "Grok is now
my Chief of SEO"). This is the **operational, GBP + Map-Pack** playbook — it pairs with the
[Fable deep-review prompt](./fable-deep-seo-review-prompt.md) (strategy/demand) and the
[growth plan](./host-hampton-growth-plan.md).

**How to use:** paste **STEP 0 (context)** once into an AI with browser access (Grok, or an agent that
can drive Chrome — this repo's assistant can via its browser tools). Then run the audit prompts in
order. Start with 1–3 for the fastest Map-Pack wins.

**Honesty rule (added):** several fields below are metrics only you can pull from GBP Insights / Search
Console — they're marked `[FILL IN]`. Do **not** let the AI guess them. Everything else is pre-filled
and verified from the business.

---

## STEP 0 — Context prompt (paste once)

> Here is everything you need to know about my business before we start any SEO work. Reference this
> every time I ask you to run an audit, build a strategy, or analyze competitors. Never ask me for this
> information again.
>
> **BUSINESS BASICS**
> Business name: Host Hampton
> Address: 295 Montauk Highway, Suite 7, Speonk, NY 11972
> Phone: (631) 998-9325
> Website: https://www.hosthampton.com
> Google Business Profile: `[FILL IN — paste your GBP share/maps URL]`
> Years in business: `[FILL IN]`
> Team size: small team (owners + party hosts)
>
> **SERVICES + MARKET**
> Primary service: themed kids' birthday parties — offered **both** at our private Speonk studio **and
> mobile (we come to your home/venue)**. We are flexible: we can do almost **any theme and any
> reasonable craft**, studio or mobile.
> Secondary services: mobile craft parties (canvas painting, sand art, drip-paint "balloon dog" fluid
> art, slime, seashell, bracelet making, tote/hat bars, spa/glam, photobooth); party room rental;
> permanent jewelry; baby & bridal shower hosting; events/workshops (Moms in the Morning, Girls Night
> Out, craft classes); custom accessories (canvas bags, trucker hats); on-site brand/corporate
> activations (e.g. canvas tote bar).
> Service areas: Speonk / Westhampton Beach, Southampton, East Hampton, Sag Harbor, Montauk,
> Riverhead & the North Fork, plus central Suffolk (Patchogue, Bay Shore, Smithtown, Huntington),
> Nassau County (Garden City, Rockville Centre, Long Beach, Great Neck), and Manhattan for larger
> events. Studio base = Speonk; mobile travel is free within ~20 mi, small fee beyond.
> Target customer: East End / Long Island parents planning a kids' birthday (ages ~2–13); plus
> brides & expecting moms (showers) and brands/companies (activations, team events).
> Average job value: ~$850–$1,200 for a studio package (range $750–$1,950 by guest count); mobile is
> custom-quoted. `[CONFIRM your real average]`
>
> **SEO GOALS**
> Top 5 keywords I want to rank for: "kids birthday party Hamptons", "mobile craft party near me",
> "kids craft party Long Island", "party room rental Speonk / Hamptons", "baby & bridal shower venue
> Long Island".
> Keywords I currently rank for: `[FILL IN — from Search Console]`
> Keywords I should rank for but don't: "mobile craft party [town]", "[craft] party near me" (slime,
> sand art, spa, mermaid), "at-home birthday party Long Island".
>
> **CURRENT STANDINGS**
> Google reviews: 25 total, 5.0 star rating, `[FILL IN]` new reviews per month.
> GBP monthly views: `[FILL IN from GBP Insights]`
> Monthly website traffic: `[FILL IN from GA]`
> Current Map-Pack status: `[FILL IN — which "[town] kids party" searches show us vs. not]`
> Biggest SEO problem right now: our two-venue flexibility (studio **and** mobile, any theme/craft)
> isn't captured in search, and our 25 reviews trail larger competitors on volume.
>
> **COMPETITORS**
> Paint Party LI — `[GBP URL]` — paintpartyli.com — mobile, ~$40–60/pp, $75 travel fee east of
> Riverhead; strong on "paint party" + at-home.
> The Craft'd Bus — `[GBP URL]` — craftdbus.com — mobile "craft bus" novelty (slime, splatter).
> Creative Touch LI — `[GBP URL]` — creativetouchli.com — Lindenhurst studio (plaster, slime, canvas).
> Plaster Kraze — `[GBP URL]` — plasterkraze.com — Holbrook studio (plaster, sand, tote/tee).
> Tiny Artisan Events — `[GBP URL]` — tinyartisanevents.com — mobile workshops, broad event reach.
> `[Add any local Map-Pack competitors you see for "kids birthday party [your town]"]`
>
> **WHAT I'VE ALREADY TRIED**
> Built out the site: mobile-party + mobile-craft-party hub, 26 per-town location pages, 9 craft/theme
> landing pages, a real sitemap.xml, and LocalBusiness + Service + FAQ + Review/AggregateRating schema
> (25 ratings, 5.0). GBP is claimed and live.
>
> **HOW I WANT YOU TO WORK**
> Always prioritize quick wins over long-term plays unless I ask otherwise. For every recommendation,
> tell me the impact level (high/medium/low) and how long until I see results. Always output
> competitor comparisons in spreadsheet/table format. When you're unsure, tell me — don't guess, and
> never fabricate a metric. Never ask me for this information again; use it as the base for everything.

---

## Audit prompts (run in order)

### 1. GBP Category Audit — fastest Map-Pack win
> Open Chrome and go to Google Maps. Search these 3 queries in my area: "kids birthday party near
> Speonk NY", "kids craft party Long Island", "party place [East Hampton / Southampton — pick a big
> town]". For each search, note which competitors appear in the Map Pack (top 3) and the local finder
> (top 10). Open each competitor's GBP and extract their **primary category** and **all secondary
> categories**. Output a spreadsheet, one tab per query. Columns: business name, primary category,
> secondary categories, star rating, review count, Map-Pack position. Highlight every category
> competitors have that I'm missing. Then give me a prioritized list of categories to add to my GBP,
> ranked by how many top competitors have each. (Likely candidates to check: Children's party service,
> Party planner, Event venue, Children's party service, Party equipment rental service, Jeweler.)

### 2. GBP Attributes Audit
> Open Chrome and go to my GBP `[URL]` and competitors `[URL1] [URL2] [URL3]`. For each, extract every
> visible attribute/tag (e.g. "identifies as women-owned", "on-site services", "appointment required",
> accessibility, payment/booking attributes). Output a spreadsheet. Then three lists: attributes ALL
> top competitors have (add these first), attributes 2 of 3 have, attributes only 1 has. Flag any that
> genuinely apply to Host Hampton so I can enable them.

### 3. Competitor Review Teardown — velocity + keyword insight
> Open Chrome and go to competitor GBPs `[URL1] [URL2] [URL3]`. For each, read the last 50 reviews and
> extract: total count, average rating, reviews in the last 30/60/90 days (velocity), most-mentioned
> services/themes, most-mentioned towns/neighborhoods, and recurring complaints. Compare their velocity
> to mine (25 total, 5.0). Output a spreadsheet plus a tab showing exactly how many reviews/month I need
> to catch the top competitor in 6 and 12 months. List the services/towns they get praised for that I
> should feature on my site and GBP.

### 4. GBP Services section optimization
> Compare the Services section on my GBP vs. competitors `[URLs]`. List every service they itemize that
> I don't. Then draft a complete Services list for my GBP mirroring my site — one entry per theme/craft
> and per delivery mode (studio vs. mobile), each with a short keyword-rich description. Prioritize by
> search demand.

### 5. GBP Description — 3 testable versions
> Write 3 different 750-character GBP business descriptions for Host Hampton, each leading with a
> different angle: (a) "studio OR mobile — anywhere on Long Island", (b) "any theme, any craft, fully
> hosted", (c) "5.0-rated upscale Hamptons parties at honest prices". Keep NAP consistent; work in
> primary keywords naturally. Tell me which to test first and why.

### 6. GBP Posts strategy + 8-week calendar
> Build an 8-week GBP Posts calendar (2 posts/week). Mix: theme/craft spotlights, town shout-outs
> (rotate through my service-area towns), seasonal hooks (communion season, summer beach-house parties,
> Halloween craft, holiday), offers, and review highlights. For each post give a title, 1–2 sentence
> body with a CTA, a suggested photo, and the target keyword. Front-load the highest-impact posts.

### 7. Photo audit + upload plan
> Compare photo count/quality/recency on my GBP vs. the top 3 competitors (interior, activities,
> team, exterior, logo, video). Output a spreadsheet of counts by category. Then give me a 30-day
> upload plan: which photos to add each week to close the gap, labeled per craft/theme and per venue
> (studio vs. at-home), with filename + alt-text suggestions that include town/keyword.

### 8. Keyword gap analysis
> Using [SEMrush/Ahrefs/Ubersuggest, or Search Console if no tool], pull the keywords my top 3
> competitors rank for that I don't. Filter to local + commercial intent (kids party, [craft] party,
> mobile/at-home party, [town] + service, shower venue, corporate activation). Output a spreadsheet:
> keyword, est. volume, difficulty, which competitor ranks + position, do I have a matching page
> (yes/partial/no), recommended action. Reject any that would require thin, near-duplicate pages.

### 9. Money-page + Search Console audit
> From Search Console, list my pages by impressions and clicks. Flag: (a) pages with impressions but
> low CTR (title/meta rewrite), (b) queries where I rank 5–15 (a nudge could reach page 1), (c) my new
> town/craft pages with zero impressions after 90 days (prune or merge). For the top money pages
> (/mobile-craft-party, /party-packages, /shower-venue), recommend concrete on-page fixes.

### 10. Local service + city-page builder
> For the towns where the category audit shows Map-Pack demand but I'm weak, tell me which deserve a
> dedicated page vs. coverage via internal links only (avoid doorway pages). For each recommended page,
> give the target query, H1, meta title/description, 3 locally-specific content angles, and the
> internal links in/out. (Note: I already have /mobile-craft-party/<town> for 26 towns — extend, don't
> duplicate.)

### 11. Citation / NAP consistency check
> Check my Name/Address/Phone across the major directories (Google, Bing Places, Apple Business
> Connect, Yelp, Facebook, Nextdoor, local Hamptons/LI directories, party-vendor listings like The
> Bash/GigSalad/Yelp events). Output a spreadsheet: directory, listed NAP, matches my canonical NAP?
> (yes/no), URL. Flag every inconsistency and every major directory where I'm missing entirely.

### 12. Backlink opportunities from competitors
> Pull backlinks pointing to my top 3 competitors that I don't have (local blogs, Mommy Poppins / Your
> Local Kids party guides, chamber of commerce, school/PTA pages, "best kids party on LI" roundups,
> venue directories). Output a spreadsheet: linking site, competitor(s) linked, link type, how I'd earn
> it, priority. Prioritize local + party-niche sites.

### Bonus. Review-response templates (keyword-rich)
> Write 5 reusable, natural-sounding responses to 5-star reviews that work in a service + a town + our
> two-venue message without sounding templated, plus 2 graceful responses to a hypothetical critical
> review. These improve GBP keyword relevance and conversion.

---

## Suggested run order (quick wins first)
1 → 3 → 2 → 4 → 5 → 7 → 6 (fast Map-Pack + trust), then 8 → 9 → 11 → 12 → 10 (deeper).
Feed the outputs of 1/3/8 back into the [growth plan](./host-hampton-growth-plan.md) and the Fable
review so the page/build recommendations stay data-driven.
