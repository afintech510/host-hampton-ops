# External Deep-Dive Prompt — Host Hampton

Paste the block below into Grok and DeepSeek **separately**, in a fresh chat with
web search / live browsing enabled. Run it in both, then diff the answers — the
disagreements are where the real information is.

Everything inside the brief is verified against the live database, the site
source, or the owner's own confirmation as of 2026-09-21. Do not soften it
before pasting; the adversarial framing is doing the work.

---

You are acting as a hostile outside operator, not a consultant. Your job is to
find where this business is weak, where its competitors are weak, and where
money is being left on the table. I do not want encouragement, validation, or a
summary of what I already told you. If a section of your answer could have been
written without reading the brief, delete it and start that section over.

Use live web search. Actually load the site, actually load the competitors,
actually run the searches. Where you cannot verify something, say "unverified"
rather than asserting it.

## The business

**Host Hampton** — https://www.hosthampton.com — a boutique celebration studio
at 295 Montauk Highway, Suite 7, Speonk, NY 11972 (Suffolk County, Long Island,
just west of the Hamptons proper). Owner-operated. Public phone 631-998-9325.
Instagram and Facebook both @hosthampton. Google Business Profile is live and
claimed.

Three revenue lines:

1. **In-studio themed parties** — the core. Kids' birthdays, hands-on hosts,
   themed build-outs (slime, squishy, spa, glow, mermaid, paint, balloon dog,
   toddler, first birthday, communion, Halloween craft, arts-and-crafts).
   Reserve with a $250 deposit that comes off the total; a separate $250
   refundable damage hold. 39 of 67 bookings year-to-date 2026.
2. **Mobile / at-home parties** — travels to the customer across Long Island.
   Base $850 at 10 guests. 16 of 67 bookings YTD.
3. **Studio rental** — rent the room, bring your own everything. 7 of 67 YTD.

Adjacent lines already running: permanent jewelry, trucker hat bar, custom
canvas bags/accessories, adult events (a recurring irreverent bingo night),
school fundraiser storefronts (cheer teams, PTO/booster groups — the business
runs a branded ordering page and splits proceeds), gift cards, classes, and a
Christmas vendor market scheduled for 5 December 2026.

Scale, so you calibrate correctly and do not hand me enterprise advice:
**CY2025 revenue was $141,250.** 2026 bookings by month: Mar 4, Apr 2, May 2,
Jun 6, Jul 3, Aug 10, **Sep 40**. It is one location with one owner. Any
recommendation that needs a team, a media budget over four figures, or a
twelve-month runway is the wrong recommendation — say so and give me the
version that one person can ship in a week.

## What I already know about my own funnel — do not re-tell me this

- Analytics is **GA4 only**. No Meta Pixel, no Google Tag Manager, no Google
  Ads conversion tag live. No retargeting audience is being built anywhere.
- First-party attribution was only switched on 12 Sept 2026, so the historical
  channel data is worthless. Of everything tagged since: **every single UTM
  ever captured is `chatgpt.com`**, and every organic referrer is `google.com`.
  Zero attributed traffic from Instagram or Facebook despite those being the
  main posting channels.
- Roughly a fifth of new inquiries arrive by SMS to the business line with no
  digital trail at all.
- The site has ~55 public pages, most of them one page per party theme.

That `chatgpt.com` finding is the single most interesting thing in the data and
I want you to take it seriously rather than treat it as noise.

## What I want from you

### 1. AEO / answer-engine visibility — lead with this

Assume a parent asks an assistant, not Google. Actually run these, or their
closest equivalent, against live search and tell me **verbatim what comes back
and who gets named**:

- "kids birthday party places near Westhampton / Hampton Bays / Riverhead"
- "where can I have a slime party on Long Island"
- "birthday party venue that comes to your house Suffolk County"
- "indoor birthday party for a 4 year old near me eastern Long Island"
- "how much does a kids birthday party venue cost Hamptons"
- "rent a party room Speonk NY"

For each: is Host Hampton named? If not, who is, and **what specifically about
their page made them citable when mine wasn't** — structure, schema, review
count, listing presence, freshness, explicit pricing, Q&A format? Be concrete
enough that I can go change a file.

Then tell me what an answer engine cannot currently learn about this business
because the site never states it in extractable form. Prices, capacity, age
ranges, travel radius, lead times, what is included, what is not.

### 2. Competitive teardown — name names

Find the actual businesses competing for these bookings in eastern Suffolk
County: party venues, kids' entertainment, mobile party operators, craft
studios, and the adjacent ones I may not be thinking of (gymnastics gyms,
trampoline parks, farms, libraries, restaurants with party rooms).

For each meaningful competitor: pricing if published, what they rank for, their
review volume and recency, their booking mechanics, and **their specific
weakness**. I am most interested in the last one. What do their reviews
complain about? What do they refuse to do? Who do they turn away? Where is the
seam I can walk through?

Explicitly flag anything they do that is better than what I do.

### 3. Attack my own site

Be unkind. Load the real pages.

- Where does the homepage lose someone in the first five seconds?
- ~55 pages, most of them one-per-theme — is that an SEO asset or thin-content
  cannibalization? Give me a verdict, not both sides.
- Where is the booking friction? A $250 deposit before a human conversation:
  where in the funnel does that kill the deal, and what would you change?
- What does the site fail to say that a parent decides on — safety,
  supervision ratios, allergies, parking, what parents do during the party,
  sibling policy, cancellation, weather?
- Mobile experience specifically. Most of these decisions happen on a phone.
- What would you tell me to delete?

### 4. The seams — where the money actually is

This is the part I care most about. Given the location (year-round locals plus
a seasonal Hamptons population with real money), the existing physical space,
and a single operator:

- What demand in this market is **actively unserved**? Not underserved — nobody
  is doing it at all.
- What is every competitor structurally unable to offer, and why?
- Where is the seasonality trap, and what fills the dead months? Note that
  bookings collapse Apr–Jul and spike in Sept — tell me whether that is a
  demand pattern or a self-inflicted marketing pattern, and how you would test
  which.
- Adult and corporate spend in this market: what is it currently buying, and
  what would it buy from a space like this?
- The fundraiser line already works and is repeatable across organizations.
  What is the ceiling on it and what is the next vertical it generalizes to?

### 5. New service and product ideas

Give me at least fifteen, ranked by (revenue potential ÷ effort for one
person). For each: who buys it, what it costs to stand up, what it charges,
the first customer I would call, and **the reason it might fail**. Include at
least three that use the physical space on weekday daytimes when it is empty,
and at least three that are products rather than events — something that ships
or sells without me being in the room.

Kill your own weakest five before you show me the list.

## Rules

- No preamble, no restating the brief, no closing summary.
- Cite a URL for every external claim. Uncited claims get marked
  "unverified" inline.
- When you are guessing, say so in the sentence where you guess.
- Rank everything. An unranked list is a list I have to do the work on.
- If your recommendation requires spend, name the dollar figure and what I
  should expect back.
- End with the three things you would do first, in order, and what each would
  cost me in hours and dollars.
