# SEO optimization pass — as built (2026-09-12)

Link 5 of the autonomous build chain. Phase 3C item *"SEO optimization pass (meta
tags, Open Graph on remaining pages, structured data)"*.

This is its own doc rather than a section of `docs/booking-agent-plan.md`: the
booking agent answers leads, and this is about what puts leads in front of it.
The two only touch in one place, and it is in §7 below.

Everything here was **measured on the live site before it was changed**. The
brief for this link said to treat every claim about the current state as
unverified, and that was the right instruction — the starting facts it handed
over were both incomplete and, in one case, an over-count.

---

## 0. What the measurement actually found

The brief said *"68 `page.tsx` files; only 48 export `metadata`"*, twenty pages
shipping with nothing of their own. Checking rather than believing it:

- **Nine of the twenty inherit real metadata from a sibling `layout.tsx`.** The
  true gap was eleven.
- **Two of the eleven are not pages at all.** `/classes` and `/party-add-ons`
  are bare `redirect()` calls. They do not need metadata; they need a different
  status code (§5).
- **Most of the rest should be `noindex`, not "fixed"** — the admin console, the
  customer portal, a signed invoice, a reviewer draft preview, three checkout
  confirmations, a printable QR sheet, a word-game tool and a sample page.

So the headline number pointed at a smaller problem than it described, and the
real damage was somewhere the count could not see.

### The one that mattered: `/book` served ten characters

`/book` is the primary conversion page. It is `priority: 0.8` in the sitemap and
it is linked from the nav and the footer of all 69 URLs. Measured 2026-09-12,
the HTML it served inside `<main>` was, in full:

```
Loading...
```

Ten characters. No `<h1>`, no copy, no links. Every other page on the site
serves 900–5,200 characters; `/book` served ten.

**Cause.** `/book/page.tsx` *was* the client component — `'use client'`, calling
`useSearchParams()`, wrapped in a single `<Suspense>`. During a **static**
prerender, a client component that reads `useSearchParams()` bails out to its
Suspense **fallback**. The build labelled the route `○ (Static)` and prerendered
the fallback.

**Why it is worse than it looks.** Google renders JavaScript on a second pass
and would eventually see the form. The AI crawlers `robots.ts` goes out of its
way to welcome by name — `GPTBot`, `ClaudeBot`, `PerplexityBot`, `OAI-SearchBot`
— **do not execute JavaScript at all.** To every one of them the booking page
was blank, on a site whose robots file exists to invite them in.

**Fix.** `page.tsx` is now a *server* component that renders the `<h1>`, the
intro copy, a "what you can book here" block and internal links to
`/party-packages`, `/mobile-party`, `/studio-rental`, `/events`,
`/kids-party-menu` and `/faq` — then the untouched client form inside the same
`<Suspense>`. The booking component moved to `book/BookingClient.tsx` **byte for
byte apart from the hero it no longer owns**; no booking logic was altered.
The route stays `○ Static`.

Prerendered `<main>` text: **10 characters → 1,035. One `<h1>` where there were
none.**

---

## 1. Structured data — validated, not admired

Every JSON-LD block on the live site was pulled, parsed and checked against the
properties Google actually enforces (`audit_scratch/ldcheck.mjs` at the time;
not committed). Four defects, two of them publishing prices.

### 1.1 Every `Event` rich result on the site was invalid

```
"startDate": "2026-10-09T7:00 PM"
```

That is not ISO 8601. `events.event_time` is free text typed by a human and the
live table holds **seven** different shapes for it:

```
'7:00 PM'   '10:00 AM'   '10:00 am'   '9:00 AM'   '6:00'   '10'   '1'
```

The page concatenated `${event_date}T${event_time}` and shipped whatever came
out. Every Event node on the site failed validation, so **no Host Hampton event
has ever been eligible for Google's event listings** — the surface that answers
"things to do in the Hamptons this weekend".

`lib/eventSchema.ts` now builds the node, and the interesting part is what it
**refuses**. `'6:00'` is 6am or 6pm and nothing in the row says which. It is
DROPPED, and the event publishes a date-only `startDate` (`"2026-10-09"`), which
is valid ISO 8601 and valid for `Event`. **Rule 15 — an input the pipeline
cannot interpret must be dropped, never guessed at.** A time that is silently
four hours wrong in Google's event listing sends a family to a closed door; an
absent time sends them to the page.

The rule it uses: with a meridiem, unambiguous. Without one, only an hour of 0
or 13–23 can be read (nobody writes 1pm as `13:00` by accident, and no 12-hour
clock has an hour 0). Hours 1–12 with no meridiem are refused.

The UTC offset comes from `Intl.DateTimeFormat(… timeZoneName: 'shortOffset')`
against `America/New_York` — **verified inside the running container first**
(`icu_small = false`, `2026-10-09 → GMT-4`), because a small-ICU Node answers
UTC and would shift every event by four hours. If it cannot be resolved the
offset is omitted rather than guessed; Google reads an offsetless local time as
local, which is correct here anyway.

### 1.2 A sold-out event advertised tickets, and a $35 ticket was published at $45

Same file, same node.

- `availability` was hardcoded `https://schema.org/InStock` even though
  `events.available_tickets` is maintained (29 / 20 / 17 on the live rows). It
  now says `SoldOut` at zero.
- A single `Offer` published the BASE price. Both variant events sell **First
  Child $45 / Sibling $35**, and `/events` already shows "from $35" via
  `EventFilters`' own `Math.min`. The schema said $45. Multi-price events now
  emit `AggregateOffer` with the real `lowPrice`/`highPrice`, and a live sale is
  applied to every variant, not only the base.

### 1.3 `/fundraiser` published an `Offer` with no price

```json
"offers": { "@type": "Offer", "priceCurrency": "USD" }
```

`priceCurrency` without `price` is an invalid Offer and Google rejects the
block. What it was trying to say — *"minimum 20% of total sales"* — is a
commercial term, not a price, and it is already in the `FAQPage` node, which is
the block Google can use. The `offers` node is gone.

### 1.4 `/first-birthday-parties` published $850 against its own $650 table

The `Service` node carried `offers: { price: '850' }`. The page's own pricing
table, thirty lines below, reads **$650 / $800 / $1,045** for up to 8 / 10 / 12
guests. Google's structured-data policy requires the marked-up price to match
the visible one, and a price in search that the page contradicts is a customer
dispute before it is an SEO problem.

The three packages are now a hoisted `PACKAGES` constant and the schema is
DERIVED from it as an `AggregateOffer`, `lowPrice: 650 / highPrice: 1045` —
exactly what a visitor can see. **Rule 11: the structured data no longer
restates a price beside the one it is supposed to describe.**

**Not changed, on purpose:** the page's own prose says *"packages start at $850
for up to 10 guests"* while its table says $800 at 10. Both are visible on one
page and they disagree. That is a price, so it is Adam's — recorded as
**needs Adam** in `PLAN.md` and commented at the line.

### 1.5 Entity consolidation

A single page could emit **four unlinked descriptions of the same business**:
the root layout's `EventVenue`, the root layout's `Organization`, the page's
`Service.provider` LocalBusiness, and on the homepage one
`Review.itemReviewed` LocalBusiness per review. With no `@id`, a consumer has no
way to know they are one entity.

`BUSINESS_ID` and `ORGANIZATION_ID` in `lib/seo.ts` are stable `@id`s; the
layout node is now multi-typed `['EventVenue', 'LocalBusiness']` (it has to
answer to both names or the references dangle) and gained `image` and
`parentOrganization`. Six `provider` / `itemReviewed` blocks became
`businessRef()` — a reference carrying `@id` and `name`, not a fourth copy of
the street address.

---

## 2. Open Graph — 40 of 69 URLs shared as a blank card

**Next.js merges metadata SHALLOWLY.** A page that exports its own `openGraph`
REPLACES the root layout's entire `openGraph` object; it does not merge field by
field. Every page that wrote `openGraph: { title, description, url, siteName,
locale, type }` therefore dropped the layout's `images: [og-default.png]`.

Measured live: **40 of 69 sitemap URLs had no `og:image`** — including `/book`,
`/faq`, `/studio-rental`, `/mobile-party` and all 26 town pages. Every share on
Facebook, iMessage, WhatsApp, Slack or LinkedIn rendered a blank card.

`OG_DEFAULTS` in `lib/seo.ts` is now spread into all 20 page-level blocks, and
`src/__tests__/lib/seo.test.ts` **walks `src/app`, parses every `openGraph`
object literal, and fails if one has neither `OG_DEFAULTS` nor its own
`images`.** That tripwire is the only thing standing between this fix and the
next person who copies an existing metadata block.

Two related ones:

- `craftMeta.ts` wrote `images: data.heroImages[0] ? [...] : undefined`, which
  **clears** the key rather than falling back. Now spread-conditional.
- The root layout declared no `twitter` block at all, so Next emitted a bare
  `twitter:card=summary` (the small square) and no image. It is now
  `summary_large_image` with the default card, declared once at the root because
  nothing beneath it sets `twitter`.

---

## 3. Titles and descriptions

Measured **entity-decoded** — the first pass read raw HTML, where `&` counts as
five characters and `’` as six, which over-reported several pages. On the true
lengths: **39 of 69 titles over 60 characters and 56 of 69 descriptions over
160**, i.e. truncated in the SERP with the offer in the part that was cut.

- **The 26 town pages were the worst and the cheapest to fix**: 85–96 character
  titles, because the template appended ` | Host Hampton` to an already-long
  string. `townMeta()` in `lib/locations.ts` now produces
  `Mobile Kids Craft Party in <Town>, NY` (48 worst case, Westhampton Beach) and
  a 155-character description. It lives in `locations.ts` rather than the page
  **so the test can assert the budget across all 26 at once** — if a longer town
  is added the suite fails instead of Google truncating it quietly.
- The 11 craft landing pages are likewise one data file (`craftParties.ts`) and
  are asserted the same way.
- 13 individual pages trimmed; three had a **doubled brand** (`Privacy Policy |
  Host Hampton | Host Hampton`) because they named the brand in a title the root
  template already suffixes.

Nothing in this section changes a URL, a canonical or a robots directive — only
the text of the snippet.

---

## 4. `noindex` — and why not robots.txt

A `Disallow` stops a URL being **fetched**, which means a `noindex` on that page
is never read, and the bare URL can still be listed from an inbound link with no
snippet and no way to remove it. Anything that must stay OUT of the index has to
be crawlable and say no.

So `robots.ts`'s `disallow` list got **shorter**, not longer. `/book/success`
and `/events/success` came off it and carry `robots: NOINDEX` instead. `/admin`
was added **without** a trailing slash as well — `/admin/` does not match
`/admin` itself, which returns 200.

`NOINDEX` (from `lib/seo.ts`) now applies to: the whole `/admin` subtree,
`/my-booking/*`, `/plan/*` (a customer's invoice), `/review/*` (an unsent draft
preview behind a 7-day token — an indexed copy would outlive the token),
`/checkin/*`, the five checkout confirmations, `/kids-party-menu/summary`,
`/boggle`, `/li-high` and `/cora`.

Left indexable on purpose: `/signup` and `/vendor-registration`, which are thin
but real public pages. Delisting something that might rank is the one SEO change
that can *lose* traffic, so the bar for `noindex` was "structurally not content"
— a print sheet, a demo, a portal, a receipt.

---

## 5. Redirects: 307 → 308 for two permanent moves

`/classes → /events` and `/party-add-ons → /kids-party-menu` were both
`redirect()`, which Next issues as **307 Temporary**. A 307 keeps the old URL in
the index showing the new URL's content, so the two compete and nothing
transfers. Both are permanent content consolidations — and `/party-add-ons` is
linked in body copy from `/first-birthday-parties`, so it is a URL Google has a
reason to hold. Both now use `permanentRedirect()` (308).

**`/cm-cheer` and `/cm-cheer/orders` were deliberately LEFT at 307.** That is a
retired seasonal campaign, not a content move; Adam may run CM Cheer again, and
307 is the reversible state. This is the "a redirect can delist a page that
currently ranks" hazard, and the conservative direction is to leave it.

---

## 6. Core Web Vitals and page structure

- **19 `<Image fill>` elements had no `sizes`.** Without it the browser assumes
  `100vw` and Next serves the **3840px** variant — confirmed in the live HTML:
  `/_next/image?url=%2Fimages%2Fslime-party-1.jpg&w=3840` into a card. All 19
  now carry a real `sizes`; `ImageSlider` took it as a prop with a sensible
  default. `audit_scratch/fillscan.py` re-scans for regressions.
- **The homepage LCP image was `loading="lazy"`.** The first hero tile now has
  `priority`, and the four tiles have distinct descriptive `alt` text instead of
  four copies of `"Party theme"`.
- **`h2 → h4` on all 69 pages**: the footer's three column headings were `<h4>`
  after each page's own `<h2>`. A global two-level jump, fixed in one file.
- **`/studio-rental` was reachable from two pages sitewide** (`/party-room-rental`
  and `/sitemap`) despite being one of the three money pages. Added to the
  footer's Services column. `/book` and `/mobile-party` were already linked from
  every page via the nav and footer.
- **`/es/party-room-rental` rendered under `<html lang="en">`** while its own
  hreflang alternates declared `es` — the page contradicted its metadata. The
  root layout hardcodes the `<html>` attribute and App Router gives a page no
  way to change it, so `lang={locale}` is set on the content `<main>`, which is
  the element whose text actually differs.

---

## 7. The one place this touches an agent output path

`app/[...slug]/page.tsx` renders `website_content` rows, and
`website_content.structured.jsonLd` — if present — is emitted **verbatim** into
a `<script type="application/ld+json">`, bypassing the derived graph entirely.
`website_content` is written by the COPY agent and by the weekly town-drafts
cron.

No writer sets `jsonLd` today and no live row has one (checked:
`structured ? 'jsonLd'` is false on all five rows). But **the reader accepts
it**, and hard-won rule 5 is that a field is hostile because of who can WRITE
it, not which block it prints in. A model-authored `offers.price` would publish
an invented figure to Google under our name with no human in the path — and on a
town page it would be a **mobile** price, which is the one number in this
codebase that belongs to Adam alone (plan §15).

`carriesPublishedPrice()` in `lib/seo.ts` screens the DB-authored block for
`price` / `lowPrice` / `highPrice` / `priceCurrency` / `priceSpecification` /
`offers` / `minPrice` / `maxPrice` at any depth. If it finds one the block is
dropped, the page falls back to the derived graph (which prices nothing), and it
**logs why** — rule 10, a guardrail that stops something must say that it
stopped it.

It walks with a `WeakSet` rather than a depth cap **on purpose**: a depth cap
terminates on a cycle but it is also a bypass — nest the price one level past
the limit and the screen waves it through. The suite asserts a price buried
twenty deep is still caught, and that a cyclic object does not hang.

The derived fallback also changed: it used to publish a second `LocalBusiness`
with its own address. It is now a `WebPage` node referencing `BUSINESS_ID` and
`ORGANIZATION_ID` by `@id`, plus `datePublished`/`dateModified` from the row.

---

## 8. Sitemap

Checked in both directions rather than read.

- **All 69 URLs return 200.** No 404s, no redirects.
- **The DB half works** — one published `website_content` row (`/es/party-room-rental`)
  and three active events are all present. It reads `website_content` and
  `events` per request (`force-dynamic`) because those credentials do not exist
  at build time.
- **Two indexable pages were missing**: `/signup` and `/vendor-registration`.
  Added. Everything else absent from the sitemap is now correctly `noindex`, a
  308, or dynamic and covered by the DB queries.
- **The DB read failed silently.** `catch {}` swallowed it, so a Supabase blip
  served a sitemap that *looked* complete while every event and Spanish URL
  vanished — which Google reads as "these are gone". It still serves the static
  half (a partial sitemap beats none) but now logs `[sitemap] … read failed`.
  Same rule as plan §18's held draft: an absence reads exactly like a fact.
- `CONTENT_LAST_MODIFIED` bumped to `2026-09-12`, which is what its own comment
  asks for when page copy changes.

---

## 8b. Cloudflare is overriding `robots.ts` — and blocking the AI crawlers it welcomes

Found while verifying the deploy, by reading the **served** file rather than the
source. `https://www.hosthampton.com/robots.txt` is not what `src/app/robots.ts`
emits. Cloudflare's **Managed robots.txt / Content Signals Policy** is enabled on
the zone and PREPENDS its own block to the origin's:

```
# BEGIN Cloudflare Managed content

User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /

User-agent: ClaudeBot
Disallow: /
…  GPTBot, CCBot, Google-Extended, Bytespider, Amazonbot,
   Applebot-Extended, meta-externalagent — all Disallow: /
```

Our rules still follow it (the deploy is confirmed present: `Disallow: /admin`
without the trailing slash is there, and `/book/success` is correctly gone). So
the served file now contains **two contradictory groups for the same
user-agent** — Cloudflare's `Disallow: /` and ours `Allow: /`.

RFC 9309 says a crawler merges matching groups and the least restrictive rule
wins a same-length tie, so in strict terms `Allow: /` should win — but real
crawlers differ, Cloudflare's group is FIRST, and `ai-train=no` is unambiguous
regardless.

This matters because it is **the same defect as `/book`, one layer out**:
`robots.ts` exists specifically to invite GPTBot, ClaudeBot, PerplexityBot and
Google-Extended to read and cite Host Hampton, and the edge is telling them no.
Fixing it is a Cloudflare dashboard setting on the zone, for which this session
has no credentials — **needs Adam**, recorded rather than guessed at.

---

## 9. What was NOT touched

- **Mobile pricing.** No `mobile-package` row, no `MobilePriceBlock`, no planner
  band, no `pricingCatalog.ts` mobile value, and the published $500/$750 tiers
  stay up by Adam's choice (plan §15, `mobile-pricing-rework` memory). **No
  structured-data price was published for a mobile party** — the audit confirmed
  there was none before and the suite now asserts there is none after, across
  `mobile-party`, `mobile-craft-party`, the town template and
  `CraftPartyLanding`.
- `/kids-party-menu`'s 7-guest mini-party limit vs the planner's 6 — documented,
  unruled, and deliberately not reflected in any schema markup.
- No migration. **043 is still free.** No new env.

---

## 10. Verification

| | Before | After |
|---|---|---|
| jest | 1154 / 1154 | **1284 / 1284** (+130) |
| `tsc --noEmit`, app code | 0 | **0** |
| `next build` | clean | **clean**, `/book` still `○ Static` |
| `/book` prerendered `<main>` text | **10 chars** | **1,035 chars** |
| `/book` `<h1>` | **0** | 1 |
| sitemap URLs returning 200 | 69 / 69 | 69 / 69 |
| Event `startDate` valid ISO 8601 | **0 / 3** | 3 / 3 |
| Structured-data prices disagreeing with the page | 2 | 0 |

---

## 11. Needs Adam

1. **`/first-birthday-parties` contradicts itself on price.** Prose: *"packages
   start at $850 for up to 10 guests."* Table, same page: **$650** (up to 8),
   **$800** (up to 10), **$1,045** (up to 12). Both visible, both live. The
   structured data now publishes the table ($650–$1,045) because that is what a
   visitor can see, but one of the two has to go.
2. **Cloudflare's Managed robots.txt is blocking every AI crawler the site
   wants** (§8b). `ai-train=no` plus `Disallow: /` for ClaudeBot, GPTBot, CCBot,
   Google-Extended, Bytespider, Amazonbot, Applebot-Extended and
   meta-externalagent, prepended at the edge and directly contradicting
   `src/app/robots.ts`, which lists those same crawlers to WELCOME them. Turning
   it off (or aligning it) is a zone setting in the Cloudflare dashboard, which
   this session has no login for.
3. **No Google Search Console access.** Which URLs currently rank could not be
   checked, so every canonical and `robots` decision here was made on the
   conservative side — `noindex` only where a page is structurally not content,
   and 308 only on two unambiguous content consolidations. A Search Console
   login would let the next pass verify indexed coverage and confirm the Event
   rich results start validating.
