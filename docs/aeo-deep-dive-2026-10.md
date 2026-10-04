# AEO Deep Dive: What ChatGPT Sees, and How to Get Recommended More

*2026-10-04. Measured against the live site, the live database and the open web. Nothing here is from memory alone. Each figure was re-checked today.*

---

## 1. Summary

ChatGPT really is sending you customers. The cause is narrower than it looks.

- **What's working:** the website. ChatGPT's search crawler can read every page, and the pages give it real prices, FAQs and business schema. When someone's question names the **Hamptons, Speonk or Westhampton**, ChatGPT can find you and cite you.
- **What's missing:** the rest of the web. An answer engine builds its recommendations from **third-party lists, directories and reviews**, and Host Hampton isn't on any of them. That covers all 13 "best birthday party places" lists that rank for the Long Island queries. You don't appear for *"kids birthday party Long Island"*, *"slime party Long Island"*, *"spa party Suffolk County"*, *"mobile craft party Long Island"*, *"permanent jewelry party Long Island"* or *"sweet 16 venue Hamptons"*. Those are exactly the questions parents ask ChatGPT.
- **The website was also feeding engines three wrong numbers.** All three were real text on our own pages:
  - homepage theme tiles showing **$600–$750**
  - **$450 / $575** room rental on `/party-menu`
  - **$450 / $575 and a $500 security deposit** on the Spanish room-rental page

  These are the "contradictions" Grok and ChatGPT reported on 2026-09-22. We wrote that off as a stale cache. **It wasn't. It was us.** All three are fixed as of today.

**The biggest lever is off-site. Most of it is your time, not code:**
1. Get onto 3 Mommy Poppins lists.
2. Claim and correct 5 business listings.
3. Grow Google reviews (the review-ask cron shipped yesterday).

---

## 2. What ChatGPT leads actually look like

From `contacts.attribution` / `bookings.attribution` (first touch, captured site-wide since 2026-09-15):

| Date | Landed on | Evidence | What they wanted |
|---|---|---|---|
| 2026-08-31 | `/mobile-party` | `utm_source=chatgpt.com` | mobile party |
| 2026-09-02 | `/party-room-rental` | `utm_source=chatgpt.com` | room rental |
| 2026-09-03 | `/mobile-party` | `utm_source=chatgpt.com` | mobile party |
| 2026-09-19 | `/fundraiser` | `utm_source=chatgpt.com` | **St. Patrick School PA**, a school fundraiser (Adam called 9/22; she's consulting the PA) |
| 2026-09-28 | `/mobile-party` | UTM **and** ticked "ChatGPT or another AI assistant" | mobile party, 14 guests, Nov 7 |
| 2026-10-03 | `/mobile-party` form | ticked "ChatGPT or another AI assistant" | mobile party, Nov 22 |

What the data says:

- **4 of the 6 are mobile parties.** ChatGPT sends people to `/mobile-party` more than to any other page. That page's visible price anchor is the **$500 Entry tier**, so these leads arrive having been told about $500. That's below your $850 / 10-guest target (see §7, decision 1).
- **Since 2026-09-15, 11 of 32 new contacts carry any channel evidence.** Google accounts for 8 of them and ChatGPT for 2, plus one more who self-reported. ChatGPT is your **#2 measured channel**, and the only one besides Google.
- ChatGPT adds `?utm_source=chatgpt.com` to every link it cites, so these tags are real referrals. Perplexity and Gemini add no tag. Their visitors show up as untagged, or only via the "How did you hear about us?" field.

---

## 3. What we feed the answer engines

### 3.1 Which crawlers can read the site (user-agent sweep, today)

| Crawler | Who | Result | Matters for |
|---|---|---|---|
| **OAI-SearchBot** | ChatGPT search index | 200 ✅ | **ChatGPT citations** |
| **ChatGPT-User** | ChatGPT fetching live for a user | 200 ✅ | **ChatGPT citations** |
| **PerplexityBot** | Perplexity | 200 ✅ | Perplexity citations |
| **Bingbot** | Bing, which ChatGPT search leans on | 200 ✅ | ChatGPT and Copilot |
| Googlebot / Google-Extended | Google, AI Overviews, Gemini | 200 ✅ | Gemini, AI Overviews |
| GPTBot | OpenAI **training** | 403 (Cloudflare) | Model training only |
| ClaudeBot | Anthropic **training** | 403 (Cloudflare) | Model training only |

**Verdict: access isn't the problem.** Every crawler that produces a citation or referral gets in. The 403s are Cloudflare's "block AI training" default. Leave them alone (explained in `memory/search-console-baseline`).

### 3.2 What a non-JavaScript crawler reads on each page

None of these crawlers run JavaScript, so they read only the server-rendered text. We fetched all 72 sitemap URLs as OAI-SearchBot:

- **Good:**
  - The homepage leads with "Studio parties from **$800** — 2 hours, up to 10 kids… Extra guests $35… $250 deposit."
  - `/party-packages` prints every theme price ($800–$950).
  - FAQ schema is on `/faq`, `/mobile-party`, every craft page and every town page.
  - The `LocalBusiness` schema carries the address, hours, phone, geo and a 5.0 / 25 rating.
- **Bad, now fixed:**
  - **Homepage tiles.** Each tile printed "Glow Party — Starting at **$750**", "Sweets & Treats — Starting at **$600**", and so on: the **Mini Party** price ($200 off, 1.5 hrs, fewer kids). The label explaining that only appeared after a click. A crawler doesn't click, so it read one paragraph saying "from $800" and nine tiles saying "$600–$750". Grok and ChatGPT both quoted that back as a contradiction.
  - **`/party-menu` room rental.** It printed **$450 weekday / $575 weekend, +$50 / $100 an hour, Friday counted as weekend.** It was reading an old `room-rental` price list that nothing charges. Checkout, `/studio-rental` and `/party-room-rental` all charge **$475 / $600, +$100 / $150**. This is where ChatGPT's 2026-09-22 claim of "$450 weekday / $575 weekend" came from, and it's why Google's snippet for the Riverhead / Moriches query shows $450.
  - **`/es/party-room-rental`** (a database content row). It said $450 / $575 and a **$500** security deposit. The real figure is a $250 hold.
  - **Homepage theme detail panel.** It said "Lock your date with a **25% deposit**". The deposit has been a flat $250 for months, and Patch's listing repeats the 25%.
  - **No `/llms.txt`** (it returned 404).
  - The schema's one-sentence business description said "themed birthday parties, permanent jewelry, room rentals, and **workshops**". It didn't mention **mobile parties**, which is the page ChatGPT sends the most people to.

### 3.3 What the rest of the web says about us (searched today)

| Query a parent asks | Host Hampton | Who gets cited instead |
|---|---|---|
| kids birthday party places Long Island | **absent** | Mommy Poppins (3 lists), NY Family, kidsoutandabout, LI Playbook, magicaldave |
| kids birthday party Hamptons | **#1** (DuckDuckGo / Bing index) | Mommy Poppins Hamptons list #2 |
| best kids birthday party venue Hamptons | #9, but **named first in the AI answer** | Yelp, Giggster |
| birthday party Speonk / Westhampton | #5–9 | Punchbowl, Yelp |
| slime party Long Island | **absent** | Emily's Slime Party, Playtime Slime, The Slime Machine, Mad Science |
| spa party for kids Suffolk County | **absent** | Mommy Poppins spa list, Ritzy Glitzy, Lil Miss Divas |
| mobile craft party Long Island | **absent** | LI Crafty Ones (TBR News), Creative Touch, Cool Crafts |
| glow party venue Long Island kids | **absent** | Mommy Poppins, LaserBounce, Xplore |
| trucker hat bar Long Island event | **absent** | Mother Truckers Hat Bar (on maternity leave per its own snippet), an NJ operator |
| permanent jewelry party Long Island | **absent** | Bonded Brilliance, Lavish Everlasting, Sourced Studio |
| sweet 16 / small baby shower venue Hamptons | **absent** | Tagvenue, PartySlate, The Knot |
| party room rental Westhampton | **absent** | Superpages, Eventective, Westhampton Chamber |
| Host Hampton reviews | the answer was built from **our own homepage testimonials** | no Yelp or Google review page surfaced |

**Third-party footprint:** Yahoo Local, Patch, Instagram, Facebook, one NY Family event listing, one Little Moments class listing, and **one press article, a pre-opening piece in the Long Island Advance from Sept 2024**. Not found: Yelp page (unconfirmed), Bing Places, Apple Maps, Peerspace, Giggster, The Bash, Thumbtack, Nextdoor, 27east, Dan's Papers, Newsday, kidsoutandabout.

**Name, address and phone don't match across listings:**

| Source | Address | Hours |
|---|---|---|
| Site schema | 295 Montauk Hwy, **Suite 7**, Speonk 11972 | Sat–Sun 10–8, Mon–Fri 12–7 |
| Google Business Profile | 295 Montauk Hwy, Speonk (**no suite**) | — |
| **Yahoo Local** | 295 Montauk Hwy, **Bldg 2** | **Sun 10–2, Mon closed, Tue 9–1, Wed–Fri closed, Sat 10–2** ❌ |
| Facebook | **Remsenburg**, NY | — |
| Patch | Suite 7, "Remsenburg-Speonk", category "Other", **25% deposit** ❌ | — |

The phone number, (631) 998-9325, matches everywhere.

**The competitor to watch is ColorPop Workshop.** It opened at 3 Sunset Ave, Westhampton Beach in **Feb 2026**, in the space Pawcasso left. Within a week it had press in 27east and Hamptons.com, plus Mommy Poppins and kidsoutandabout listings. It publishes **no prices**, which is our edge. **Emily's Slime Party** does answer-engine basics best: visible prices ($849 / 12 kids, $499 in-home), 22-question FAQ schema, and blog posts that answer "Long Island parents" questions.

---

## 4. What shipped today

| Change | Where | Why |
|---|---|---|
| **New `/llms.txt`** | `services/website/src/app/llms.txt/route.ts` | A plain-text brief an assistant can read in one fetch: what we are, where, all ages, service area, travel rule, every studio theme with its price, the Mini Party explained, the deposit, studio rental rates, adult activations, key pages, all craft pages and town pages. **Every figure is read from the same tables checkout charges from**, so it can't drift. **No mobile figure**: it points to `/mobile-party` (see §7). |
| Homepage tiles show both tiers with what each buys | `components/ThemeTileGrid.tsx` | "$950 · 10 kids, 2 hrs" / "Mini (7 kids, 1.5 hrs) $750". Ends the $600–$750 "contradiction". |
| "25% deposit" → "$250 deposit" | same | Matches every other page and the actual charge. |
| `/party-menu` room rental reads the real studio rates | `app/party-menu/page.tsx` | $475 / $600, $700 / $975 full day, $100 / $150 extra hour, $250 hold, Sat–Sun as weekend. Read via `loadPricingCatalog()`, the checkout's own source. |
| Spanish room-rental page corrected | `website_content` row `ec98ee6c…` | $450→$475, $575→$600, $500 deposit→$250 hold on arrival. The old text is backed up in the session scratch folder. |
| Business schema description rewritten, `knowsAbout` added | `app/layout.tsx` | Names mobile parties, craft parties, studio rental and activations. Lists the party types we want to be matched on. |
| Default meta description | `app/layout.tsx` | Leads with studio + mobile instead of the deposit. |
| New `/mobile-party` FAQ: "How much does a mobile party cost?" | `app/mobile-party/page.tsx` | It's the first question an assistant gets asked. The answer gives no figure, because no mobile price may appear in schema. |
| Sitemap `lastmod` bumped to 2026-10-04 | `app/sitemap.xml/route.ts` | Freshness signal for the changed pages. |
| **IndexNow key** + submission of all sitemap URLs | `public/bf8497…b.txt` | IndexNow pushes changed URLs to **Bing**, which ChatGPT search leans on, without waiting for a recrawl. |

Tests: full Jest suite green (3,824 / 3,824). `next build` succeeds and `/llms.txt` is a dynamic route.

---

## 5. The plan, ranked by payoff per hour

### This week (Adam, about 3 hours total)

1. **Pitch Mommy Poppins.** It's the most-cited source for every Long Island and Hamptons party query. Email **mommy@mommypoppins.com** (listing edits: listings@mommypoppins.com) and claim the free business page. Three lists, each with a concrete opening:
   - **[Birthday Party Venues in the Hamptons and North Fork](https://mommypoppins.com/kids/birthday-party-venues-in-the-hamptons-and-north-fork):** dated **2013**, and #1 for "where to have a kids party in the Hamptons". Offer them a refresh.
   - **[Long Island's Top Crafts Birthday Party Places](https://mommypoppins.com/long-island-kids/birthday-parties/best-arts-crafts-birthday-party-places-long-island)** (Aug 2025): its only East End entry, **Pawcasso, has closed.** Offer to be the replacement.
   - **[Party Entertainers That Come to You](https://mommypoppins.com/long-island-kids/birthday-parties/long-island-birthday-parties-that-come-to-you)** (Sep 2024): it lists no East End mobile provider. Pitch mobile craft parties.

   A pitch draft is in §8.
2. **Fix Yahoo Local's hours and address.** It's the #1 result for "Host Hampton Speonk", and its hours tell people you're closed Wed–Fri. Yahoo listings come from data aggregators (Yext / Localeze), so search "Host Hampton" on **Data Axle**, **Foursquare** and **Localeze**, claim, and correct.
3. **Claim Bing Places for Business.** It imports from your Google profile in one click. ChatGPT search uses Bing heavily, and you have no confirmed Bing listing. While you're in there, verify **Bing Webmaster Tools** (also a one-click import from Search Console) and confirm the sitemap.
4. **Pick ONE address string and use it everywhere:** *295 Montauk Hwy, Suite 7, Speonk, NY 11972*. Add "Suite 7" to the Google profile. Change Facebook from Remsenburg to Speonk. Fix Patch's category (Other → Party Venue) and its 25% deposit.
5. **Apple Business Connect:** claim it. That's Apple Maps and Siri.

### This month

6. **Reviews are the strongest AI trust signal you control.** The past-client review ask (shipped 2026-10-03, ~526 people) has to be **scheduled on cron-job.org together with `send-reminders`**, or it queues and never sends. Then:
   - update `RATING` in `lib/reviews.ts` to the true Google count once it moves;
   - replace the homepage testimonials with **verbatim Google reviews**, first name and initial, with the reviewer's OK. I couldn't trace "Jessica M. / Sarah K. / Amanda R." to any source. Answer engines are repeating them as our reviews, so they should be real ones.
7. **Yelp:** confirm or claim the page. Yelp is cited heavily by ChatGPT and Perplexity for local "best X near Y" questions.
8. **Local press, one story.** 27east (mailbag@27east.com) and Hamptons.com covered ColorPop's opening within a week. You have angles they'd run: the **Christmas Market (Dec 5)**, the **school fundraiser program** (ESM Sharks, St. Patrick's), the trucker hat bar for brand events. A single dated, third-party article does more for "who's good in the Hamptons" answers than ten pages of our own copy.
9. **Directory listings where the AI answers come from:** Hamptons Moms (/contact-us), kidsoutandabout (free), LI Playbook, NY Family's birthday directory, Dan's Papers kids calendar (events.danspapers.com), Macaroni Kid Hamptons, Giggster / Peerspace (studio rental), The Bash / GigSalad (mobile).
10. **The activity queries you're absent from, but sell:** slime, spa, glow, trucker hat bar, permanent jewelry. Each already has a page. What's missing is a **third-party mention** (above) and a page that **answers a parent's question directly**, as Emily's blog posts do. One focused post each: *"How much does a slime party cost on Long Island?"*, *"Spa party for a 7-year-old: what's included"*, *"Trucker hat bar for a corporate event on the East End"*. Each should state real prices and link the booking page.

### Ongoing

11. **Ask the AI panel monthly** (prompts in §9.4). Record whether Host Hampton is named, what it says, and which sources it cites. That's your share of voice in AI answers. The "How did you hear about us?" field and `utm_source=chatgpt.com` are the outcome side.
12. **Hold the HOH.1 gate (Oct 22).** Google indexing was stuck at 14 pages. Build the Sweet 16 / Graduation pages only if it has moved. Otherwise prune the 28 town pages toward ~10.

---

## 6. Things that look like problems but aren't

- **GPTBot / ClaudeBot 403.** These are training crawlers, not citation crawlers. Allowing them buys nothing you can measure.
- **The "stale cache" theory from 2026-09-22.** Withdrawn. The $650–$750 and $450 / $575 figures were live text on our own site. The lesson: **when a model reports a contradiction, fetch the page as its crawler (no JavaScript) before blaming its cache.** A browser runs the page's scripts and can show you something different.
- **ColorPop shows no prices.** Don't copy them. Published prices are why you get named in "how much" answers.

---

## 7. Decisions only Adam can make

1. **The mobile price that ChatGPT leads see.** `/mobile-party` publishes **$500 (Entry, 8 kids, 60 min) / $750 (Signature, 12 kids, 90 min)**. That's 4 of your 6 AI leads. Your target is $850 / 10 guests. You chose to leave the tiers up, so `/llms.txt` deliberately points to the page and states no mobile number. **When the mobile grid is settled, add the anchor to `/llms.txt` in one line.** Until then, every ChatGPT mobile lead arrives anchored at $500.
2. **The old `room-rental` rows in `pricing_items`** ($450 / $575 / $50 / $100). Nothing on the site reads them now, but the public `/api/pricing` still returns them. Deactivate them (`is_active=false`)? Recommended; it's one statement.
3. **"Studio Rental (per hour) $75/hr — Business / Professional Use"** on `/party-menu`. Is that still a real rate? It sits next to a $100 / hr add-on.
4. **The homepage testimonials:** keep them, or swap in verbatim Google reviews (§5.6)?

---

## 8. Mommy Poppins pitch (draft, edit freely)

> **Subject:** East End update for your Hamptons & LI crafts birthday lists
>
> Hi Mommy Poppins team,
>
> Your "Birthday Party Venues in the Hamptons and North Fork" list is still the first thing parents find when they search for East End party spots, and I wanted to flag a couple of changes. Pawcasso in Westhampton Beach (on your Long Island crafts list) has closed. And I run Host Hampton, a private party studio at 295 Montauk Hwy in Speonk that opened in 2024.
>
> What we do: fully hosted themed and craft parties (slime, spa, glow, mermaid, paint, drip-paint balloon dogs, toddler and first birthdays), with our studio all yours for two hours. Packages run $800–$950 for 10 kids, with pizza, cupcakes, decor and cleanup included. We also bring craft parties to homes from Montauk to Nassau, and rent the studio for showers.
>
> Happy to send photos or host one of your writers' kids for a party.
>
> Adam Larkin, Host Hampton · (631) 998-9325 · hosthampton.com

---

## 9. Prompts for an independent deep dive

Run each in a **fresh chat with web search on**. Each prompt plays to that engine's strength:

- **ChatGPT:** the engine sending the leads, so ask what *it* would say.
- **Perplexity:** shows its sources, so map them.
- **Grok:** adversarial, with live X/social access.

Paste the shared brief (9.1) first, then the engine-specific block. **Diff the three answers; the disagreements are the information.** Then hand the results back here and every claim gets fetched and checked before anything is built, as was done with the 2026-09-22 round.

### 9.1 Shared brief (paste first, in all three)

```text
CONTEXT — verified 2026-10-04 against the live site, database and web. Do not re-tell it to me.

Business: Host Hampton — https://www.hosthampton.com — private, fully hosted party studio at
295 Montauk Hwy, Suite 7, Speonk, NY 11972 (Suffolk County, Long Island; just west of Westhampton).
Owner-operated, one location. Public phone (631) 998-9325. Instagram/Facebook @hosthampton.
Plain-text fact sheet for AI: https://www.hosthampton.com/llms.txt

Lines of business:
1. In-studio themed kids parties — 2 hrs private, 10 kids + birthday child, $800–$950 by theme
   (Glow, Spa, Slime, K-Pop, Barbie, Swiftie, Sweets & Treats, Sleep Under, Toddler, etc.).
   Mini Party = $200 off, 1.5 hrs, smaller group. Extra guests $35. Flat $250 deposit applied to total.
2. Mobile craft parties at the customer's home anywhere on Long Island (published starting tiers
   on /mobile-party; larger parties custom-quoted). Free travel within 20 miles, no mandatory gratuity.
3. Studio rental — $475 weekday / $600 weekend for 3 hrs, $250 refundable hold.
4. Adult/corporate: trucker hat bar, canvas tote bar, permanent jewelry; school fundraisers.
All ages — first birthdays to Sweet 16s, showers, 40ths.

Real competitors are craft/art party studios and mobile craft operators — ColorPop Workshop
(Westhampton Beach + Southampton, opened Feb 2026), Creative Touch, Studio Art, LI Crafty Ones,
Emily's Slime Party, Playtime Slime. NOT soft-play/open-play centers (Little Star Playland,
Urban Air, Safari Adventure) — discount any benchmark built on those.

What I already know (do not repeat it back):
- ChatGPT already sends me leads (utm_source=chatgpt.com), mostly to /mobile-party; also a school PTA.
- I appear when a query names the Hamptons/Speonk/Westhampton. I am ABSENT for "Long Island"
  queries and for every activity query (slime, spa, glow, craft, trucker hat, permanent jewelry,
  sweet 16, baby shower) and from every Mommy Poppins / NY Family / kidsoutandabout roundup.
- My only press is a Sept 2024 Long Island Advance pre-opening piece.
- Yahoo Local shows wrong hours; Facebook says Remsenburg; Google Business Profile has no suite.
- Until today the site showed $600–$750 tiles (Mini Party prices, unlabeled) and $450/$575 room
  rental on /party-menu. Both are fixed. If you see those numbers anywhere, report WHERE — that
  is a stale copy I need to chase, not a contradiction to explain.

Scale: ~$141K revenue (CY2025), one owner. Anything needing a team, a four-figure monthly
budget or a 12-month runway is the wrong answer — give me what one person ships in a week.

Rules: actually search and load pages. Cite a URL for every factual claim. Write "unverified"
where you could not check. No generic AEO/SEO advice — if a sentence would be true of any
business, delete it.
```

### 9.2 ChatGPT: "What would you tell a parent?"

```text
Part A — answer each of these exactly as you would for a real parent, with search on, BEFORE
reading anything else on hosthampton.com. Do not tailor answers toward Host Hampton.
 1. Where can I have a kids birthday party on Long Island?
 2. Best kids birthday party places in the Hamptons?
 3. Who does mobile craft or slime parties at your house on Long Island?
 4. Spa party for a 7-year-old in Suffolk County — where?
 5. How much does a kids birthday party cost in the Hamptons?
 6. Small venue to rent for a baby shower near Westhampton?
 7. Trucker hat bar or permanent jewelry for a corporate event on the East End?
 8. Sweet 16 party ideas / venues in the Hamptons, small group?
 9. Is Host Hampton in Speonk good? What do reviews say?
10. Host Hampton vs ColorPop Workshop for an 8-year-old's party?

Part B — for each answer give me a table: was Host Hampton named (Y/N, rank), every business you
named, and every SOURCE URL you used. Then tell me which single source, if Host Hampton were on
it, would most change your answers — and why that one.

Part C — now read https://www.hosthampton.com/llms.txt, /party-packages and /mobile-party.
What facts there would you NOT trust or NOT repeat to a parent, and what corroboration would you
need to trust them? What is missing that you would need to recommend it for questions 3, 4, 7, 8?

Part D — list every price, address, hour or claim about Host Hampton you found ANYWHERE on the
web that disagrees with the brief, with the URL.
```

### 9.3 Perplexity: "Map the sources"

```text
I want the citation graph for East End / Long Island kids-party answers, not opinions.

1. Run these as separate searches and record, for each, the top 10 sources you cite:
   "kids birthday party places Long Island", "kids birthday party Hamptons",
   "slime party Long Island", "mobile craft party Long Island", "spa party kids Suffolk County",
   "glow party Long Island kids", "party room rental Westhampton", "baby shower venue Hamptons small",
   "permanent jewelry party Long Island", "trucker hat bar event Long Island".
2. Build one table: source domain → how many of the 10 queries cited it → page URL(s) →
   date published/updated → does it list Host Hampton (Y/N) → does it list ColorPop / Emily's
   Slime / Creative Touch (Y/N each).
3. For the 8 most-cited sources that do NOT list Host Hampton: how does a business get on that
   page (editorial pitch, free listing, paid, user review)? Give the actual submission URL or
   editor contact if it is published on the page. Flag any list that is >2 years old or names a
   business that has closed (e.g., Pawcasso, Westhampton Beach).
4. Which review platforms (Google, Yelp, Facebook, Nextdoor, The Bash, Thumbtack, Peerspace) do
   you actually cite for these queries? Rank them by how often.
5. Check NAP consistency for Host Hampton across every directory you can find (Google, Bing,
   Apple Maps, Yelp, Yahoo Local, Foursquare, Patch, Facebook, BBB). Table of mismatches.
6. Finish with the 10 actions ranked by (citation share gained ÷ hours of work), each naming the
   exact URL to act on.
```

### 9.4 Grok: "Hostile operator, plus the social layer"

```text
You are a competitor's growth lead who wants to keep Host Hampton invisible. Be adversarial.

1. If you were ColorPop Workshop, what would you do in the next 60 days to own "kids party
   Hamptons" in AI answers and Google, and which of those moves is Host Hampton exposed to?
2. Search X, Instagram, TikTok, Facebook groups and Reddit (r/longisland, r/hamptons, local
   parent groups) for how East End parents actually ask for party recommendations and who gets
   recommended. Quote real posts with links and dates. Is Host Hampton ever mentioned? By whom?
3. What does the social footprint of Host Hampton (@hosthampton) tell an answer engine vs.
   ColorPop and Emily's Slime Party — post cadence, location tags, reviews in captions, reels
   that name the town and the party type? Be specific; compare numbers you can see.
4. Find any wrong, stale, or damaging information about Host Hampton online (old prices,
   wrong hours, wrong town, closed status, bad review). URL for each.
5. The three cheapest moves that would most embarrass a competitor in AI answers within 30
   days, for a one-person business. No ad spend over $300.
6. Tell me one thing in my brief that you think is wrong or that I am fooling myself about.
```

### 9.5 Monthly AI share-of-voice check (5 minutes, same 6 questions each month)

Ask ChatGPT, Perplexity and Gemini, each in a fresh logged-out or private chat:

1. "Best kids birthday party places in the Hamptons?"
2. "Kids birthday party places on Long Island?"
3. "Who does at-home craft or slime parties on Long Island?"
4. "Spa party for kids in Suffolk County?"
5. "Small venue to rent for a baby shower near Westhampton?"
6. "Is Host Hampton in Speonk good?"

Log: named Y/N, position, the price it quoted, and the sources it cited. Baseline from today's web searches: **named on 1 and 6 (and 6 answered from our own testimonials); absent on 2, 3, 4, 5.**
