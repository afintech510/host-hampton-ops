# Host Hampton — Consolidated SEO Action Plan

**Date:** 2026-09-04
**Inputs reconciled:** `fable-deep-seo-review-2026-09-04.md` (deep review), `listings-seo-session-summary-2026-09-04.md` (what shipped + owner facts), `venue-listing-copy-pack.md`, `venue-listing-agent-plan.md`, `chief-of-seo-playbook.md`, `host-hampton-growth-plan.md`, `mobile-craft-party-seo.md`
**Method:** every claim in the deep review was re-checked against `services/website/src` **and against the live site** (HTTP + live `sitemap.xml`) on 2026-09-04. Findings are tagged CONFIRMED / ALREADY-FIXED / DISPUTED / **NEW**.

---

## 0. The finding that reorders everything

> **The single largest SEO asset in this repo — 28 town pages, 12 craft/landing pages, the `/mobile-craft-party` hub, review schema, breadcrumbs, and the rewritten sitemap — is not committed and is not live. Every one of those URLs returns 404 in production.**

Verified 2026-09-04:

| Check | Result |
|---|---|
| `git status` on `services/website/src` | `lib/locations.ts`, `lib/craftParties.ts`, `lib/craftMeta.ts`, `lib/craftStations.ts`, `lib/reviews.ts`, `components/CraftPartyLanding.tsx`, `app/mobile-craft-party/`, `app/slime-party/`, `app/spa-party/`, `app/shower-venue/`, `app/toddler-party/`, `app/mermaid-party/`, `app/squishy-party/`, `app/arts-and-crafts-party/`, `app/balloon-dog-painting-party/`, `app/canvas-tote-activation/` — **all untracked (`??`)** |
| `GET /mobile-craft-party/southampton` | **404** |
| `GET /slime-party` | **404** |
| `GET /shower-venue` | **404** |
| `GET /mobile-craft-party` | **404** |
| Live `sitemap.xml` `<loc>` count | **30** (the review reasons about "65+ URLs") |
| `GET /faq` | 200 ✅ (last session's work *is* live) |

**Consequence for the review's plan.** The deep review read the working tree and assumed it was production. So:

- **Move 2 ("consolidate the 26 town pages to ~19", 7× 301 redirects, `locations.ts` edits, sitemap updates, hub rewrite")** is scoped as a migration. It isn't one. Nothing is indexed, so there is nothing to redirect. It collapses to *"delete 7 rows from an array before first publish."* Effort drops from **M** to **XS** and the 301/404 risk goes to zero.
- Every "deepen this page to 600+ words" item (slime, spa, towns) is now a **pre-publish edit**, not a rewrite of a ranking page. Do it before the first crawl, not after — a page's first indexed version anchors it.
- "Verify all 65+ URLs indexed" (review action #1) is wrong. There are 30. Submit the sitemap *after* the shipping decision below, not before.
- The 90-day clock has not started. Treat 2026-09-04 as day 0 for the town/craft set, not "already live and underperforming."

**Do not just `git add .` and ship it.** Two blockers first: (a) the thin-page decision below, (b) the untracked tree contains other sessions' in-flight work (`inquiryDrafts.ts`, `portalAuth.ts`, `sms-templates.ts`, `contacts_real.csv`, `invoices/`, `revenue/`, and `.env`-adjacent scratch). Commit **only** the SEO file set, by explicit path. `contacts_real.csv`, `my_contacts.csv`, `hh-scraped-contacts.csv`, `invoices/`, `revenue/`, and `audit_scratch/` must **never** be committed — customer PII, and this repo has secret-leak history.

---

## 1. Claim-by-claim verification of the deep review

### 1a. CONFIRMED (real, unfixed)

| # | Claim | Evidence | File |
|---|---|---|---|
| C1 | `/trucker-hat-bar` titled "Atelier Brim — Bespoke Hat Bar Activations" — zero keyword coverage on a trending cluster | `metadata.title` line 6 | `services/website/src/app/trucker-hat-bar/page.tsx` |
| C2 | Home H1 says neither *kids*, *Long Island*, nor *we come to you* | H1 = "The Upscale Party Experience — at Prices You'd Pay Anywhere"; eyebrow "Speonk, NY • The Hamptons" | `services/website/src/app/page.tsx:87` |
| C3 | Money-page titles anchor on "Hamptons"/"Speonk", not "Long Island"/"Suffolk" | `first-birthday-parties` → "…in the Hamptons"; `party-room-rental` → "— Speonk NY"; `kids-party-menu` → "— Speonk NY"; `permanent-jewelry` → "— Speonk NY" | 4 files |
| C4 | No `Organization` schema sitewide | only `events/[slug]` emits one | `app/layout.tsx` has `EventVenue` only |
| C5 | `BreadcrumbList` only on town pages | single match repo-wide, and that file is unshipped | `app/mobile-craft-party/[location]/page.tsx` |
| C6 | `lastmod` = `new Date()` on every town + craft URL, on every request | `const now = new Date().toISOString()` | `app/sitemap.xml/route.ts:65` |
| C7 | No `Offer`/`Product` schema on `/party-packages` despite public prices | no match | `app/party-packages/page.tsx` |
| C8 | `/mobile-party`, craft pages and town pages publish **no price** | confirmed | 40+ files |
| C9 | Two rental pages splitting one intent | `/party-room-rental` and `/studio-rental` both live, both indexed | 2 routes |
| C10 | `/boggle`, `/li-high`, `/canvas-bags` are off-brand and live/indexable | all HTTP 200 | 3 routes |
| C11 | Town pages ~30 unique words | template substitutes town name; body copy shared | `app/mobile-craft-party/[location]/page.tsx` (280 lines, one template) |
| C12 | No informational/TOFU content anywhere | no `/blog`, no `/ideas` route | — |

### 1b. ALREADY-FIXED / MOOT (do not re-do)

| # | Review says | Reality |
|---|---|---|
| F1 | "Set true GBP values in `lib/reviews.ts`; RATING is still a TODO placeholder" | **DISPUTED.** `RATING` is already `{ratingValue: '5.0', reviewCount: 25}` with a comment stating "confirmed by owner 2026-09-04". The reviewer read the *stale header comment*, not the values. The only live risk is drift as GBP grows — see T-11. |
| F2 | AI-crawler access | Shipped. 14 agents explicitly allowed + `host` directive. `app/robots.ts` |
| F3 | FAQ content / `FAQPage` schema | Shipped. `/faq` is **live (200)** with 18 Q&A in `FAQPage` JSON-LD; `mobile-party` also has it. |
| F4 | Per-page metadata gaps (prior summary listed 8 pages) | **Mostly fixed.** Only `classes` and `party-add-ons` lack a `metadata` export — and **both are pure `redirect()` stubs (HTTP 307)**. Metadata on a redirect is dead code. Close this item as *not a gap*; the real fix is sitemap hygiene (T-4). |
| F5 | "Robots: `/portal` not disallowed" | **DISPUTED.** `/portal` does not exist (404). `/my-booking` does (200) and is worth `noindex` — but it's a tokenised page with no inbound links; **low value**. |
| F6 | `Event` JSON-LD on event pages | Shipped. |
| F7 | `/book` metadata | Shipped via `app/book/layout.tsx`. |

### 1c. NEW — found during verification, not in the review

| # | Finding | Severity |
|---|---|---|
| **N1** | **The whole town/craft build is unshipped and 404s.** See §0. | Critical |
| **N2** | **Published rental pricing contradicts the owner-confirmed rates.** Owner (2026-09-04): weekday **$125/hr, 2-hr min**; weekend **$200/hr, 3-hr min**; **"No flat-rate block."** Live `/party-room-rental` publishes flat blocks **$475/3hr weekday**, **$600/3hr weekend**, full-day **$700/$975**, "+$100/hr weekday, +$150/hr weekend", **and** a separate "**Studio by the Hour — $75/hr**" section. That is *three* pricing systems on one page, none of which match the canonical rates. The `$75/hr` figure also contradicts the prior session's own GBP draft (§6: "Photography Studio Rental — Weekday $100/hr") *and* the canonical $125. Commit `e3d4cc3` (Sep 1) raised the block rates; the owner's Sep-4 statement appears to supersede it. | **Critical** — blocks listings, GBP services, and every quote |
| **N3** | **The live sitemap lists `/cm-cheer`, which 307-redirects to `/fundraiser`.** The review flagged `/party-add-ons` (a working-tree-only regression) but missed the one that is actually live. | Med |
| **N4** | `app/sitemap.xml/route.ts` is `force-dynamic` — every crawler hit runs two Supabase queries and regenerates. Combined with C6 (`lastmod = now`), Google sees "everything changed" on every fetch and learns to distrust `lastmod` entirely. | Med |
| **N5** | `/es/party-room-rental` is live and in the sitemap, but there are **no `hreflang` alternates** anywhere and no `/es/` hub or nav entry. An orphaned foreign-language URL with no `hreflang` pairing is a duplicate-content signal, not an asset. | Med |
| **N6** | Root `LocalBusiness` is typed `EventVenue` only. Half the revenue is *mobile* — a service-area business. `EventVenue` has no `areaServed` semantics, so the 20-mi radius is invisible to structured data. | Med |

### 1d. Review recommendations I am rejecting or downgrading

Being blunt, because padding this list costs real hours:

- **`WebSite` schema — skip.** The review pairs it with `Organization` as one item. `Organization` is worth adding (entity/knowledge-panel consolidation, `sameAs` to GBP). `WebSite` + `SearchAction` existed to win the sitelinks searchbox, which **Google retired in 2023**. It does nothing now. Add `Organization`; drop `WebSite`.
- **`noindex /boggle` and `/cora` — downgrade to trivial.** These are word-game/lemonade-stand toys. They dilute nothing measurable at 30 indexed URLs and rank for nothing that competes with us. Do it in the same 10 minutes as T-4 or never; it is not a week-1 item.
- **"Verify all 65+ URLs indexed" — factually wrong**, see §0. Rewrite as "baseline the 30 live URLs, then re-baseline after the ship."
- **Consolidating 26 → 19 towns is directionally right but the count is unearned.** The review kept/cut towns on *autocomplete presence*, which is a demand signal for the head term, not for a page that exists to catch "[town] + mobile craft party". Zero autocomplete ≠ zero queries; it means below the suggestion threshold. Cut on **operational truth** instead — the owner's answer to "which towns have you actually delivered in?" (review Q7). A town page with a real photo and a named local review is worth 5 without. **Recommendation: publish ~8–10 towns you can substantiate, hold the rest unpublished.** Same end state as the review, arrived at defensibly, and cheaper because nothing gets built then deleted.
- **`/paint-and-sip` + `/girls-night-out` + `/team-building` + `/party-themes` + 3 TOFU posts + 4 seasonal pages = 11 new pages in 90 days.** That is the same thin-page trap the review correctly diagnoses on the town pages, one level up. Ship **`/paint-party`** and the **`/trucker-hat-bar` rewrite** first, measure for 30 days with real GSC data, then decide. Building 11 pages against qualitative autocomplete guesses with **zero** impression data is not a plan, it's a bet.
- **Review action 23 ("25 → 40 GBP reviews in 90 days") is fine; the SMS mechanism is not free.** `lib/sms-templates.ts` and `lib/marketing/reviewLink.ts` are **modified by another live session right now.** Coordinate before touching, or this collides.

---

## 2. The ranked plan

Sequenced by impact ÷ effort. **Do not start track C (listings) until P0 is resolved** — you will publish wrong prices to a dozen directories and then need NAP-consistency cleanup on all of them.

### P0 — Blockers (do these before anything else)

| ID | Action | Why first | Effort |
|---|---|---|---|
| **P0-1** | **Owner: settle the rental price model** (see N2). One system, then propagate. | Every downstream artifact — GBP services, The Bash, Peerspace, quotes, `studioRental.ts` rate engine, confirmation emails — encodes a price. Publishing now means re-editing 12 external listings later. | Owner call, then S |
| **P0-2** | **Decide what ships from the untracked SEO build** (§0). Recommend: hub + 9–12 craft pages + a *substantiated subset* of towns. | Nothing is indexed. This is the one free chance to publish the right set the first time. | Owner input + S |

### Track A — On-site technical SEO

| ID | Action | Files | Impact | Effort |
|---|---|---|---|---|
| **A-1** | **Ship the SEO build** — `git add` by explicit path only: `src/lib/{locations,craftParties,craftMeta,craftStations,reviews}.ts`, `src/components/CraftPartyLanding.tsx`, `src/app/{mobile-craft-party,slime-party,spa-party,shower-venue,toddler-party,mermaid-party,squishy-party,arts-and-crafts-party,balloon-dog-painting-party,canvas-tote-activation}/`, `src/app/sitemap.xml/route.ts`. **Exclude** all CSV/PII, `invoices/`, `revenue/`, `audit_scratch/`, and other sessions' files. | above | **Very high** | S (gated by P0-2) |
| **A-2** | **Retitle the money pages** to lead with Long Island / Suffolk, keep Hamptons secondary. Home, `/party-packages`, `/kids-party-menu`, `/first-birthday-parties`, `/party-room-rental`, `/permanent-jewelry`. Evidence for this is the strongest in the whole review: "kids birthday party long island" fills all 10 autocomplete slots; "…southampton ny" and "…east hampton" return **zero**; "hamptons" drifts to Hampton, VA. | 6 `page.tsx` `metadata` exports | **High** | S |
| **A-3** | **Rewrite `/trucker-hat-bar`** title/H1/body → "Hat Bar Party — Trucker Hat Bar for Kids, Teens & Events (Long Island)". Keep the URL. Currently the page targets a brand name nobody searches, on a cluster with full 10-slot autocomplete including `pricing` and `for kids`. | `app/trucker-hat-bar/page.tsx` | **High** | S |
| **A-4** | **Sitemap hygiene:** drop `/cm-cheer` (N3) and `/party-add-ons` (both redirect); replace `lastmod: now()` with a build-time constant or per-entry `updatedAt` (C6/N4); consider `revalidate = 3600` instead of `force-dynamic`. | `app/sitemap.xml/route.ts` | Med | S |
| **A-5** | **Home H1 + subhead** → state *kids*, *Long Island*, and *studio **or** at your house*. The two-venue message is the one structural advantage no LI competitor has (all mobile rivals treat the East End as a surcharge zone; Paint Party LI literally charges +$75 east of Riverhead) and it is currently a promo band, not the headline. | `app/page.tsx:87` | **High** | S |
| **A-6** | **`Organization` JSON-LD sitewide** with `sameAs` → GBP, Instagram, Facebook. Add `areaServed` / consider `ProviderMobility` for the mobile arm (N6). **Skip `WebSite`/`SearchAction`.** | `app/layout.tsx` | Med | S |
| **A-7** | **`Offer` schema on `/party-packages`** — prices are already public, so this is free rich-result eligibility. **Depends on P0-1** for the rental figures. | `app/party-packages/page.tsx` | Med | S |
| **A-8** | **`BreadcrumbList` on craft pages** via `CraftPartyLanding.tsx` (one edit covers all 12). | `components/CraftPartyLanding.tsx` | Low–Med | XS |
| **A-9** | **Merge `/studio-rental` → `/party-room-rental`** (301), or give each a distinct intent (rental-by-the-hour vs party-block). **Depends on P0-1.** | 2 routes + `next.config.js` | Med | M |
| **A-10** | **`/es/` decision:** either add `hreflang` alternates pairing `/es/*` ↔ `/*` and build a real `/es/` entry point, or drop `/es/*` from the sitemap. Orphaned + unpaired is the worst of the three states (N5). | `sitemap.xml/route.ts`, `layout.tsx` | Med | S–M |
| **A-11** | Trivia bundle: `noindex` `/boggle`, `/cora`, `/my-booking`; fold `/li-high` into `/fundraiser`. Batch with A-4. | `robots.ts` / per-page | Low | XS |

### Track B — Content

| ID | Action | Impact | Effort |
|---|---|---|---|
| **B-1** | **Publish a mobile price anchor** — "from $X for 10 kids, travel free within 20 mi of Speonk." **[owner]** Every mobile competitor publishes one ($300 / $425 / $499 / $849); we publish none, and "birthday party places near me for kids **with price**" is a live autocomplete suggestion. Highest-conversion single change in the report and I agree with it. Ship as a shared component so it lands on `/mobile-party`, the hub, and all craft/town pages at once. | **Very high** | S (blocked on owner) |
| **B-2** | **Deepen `/slime-party` and `/spa-party` to 600+ words *before* they are first indexed** (they 404 today — this is now a pre-publish edit, not a rewrite). Add the East-End-at-home angle, glow-slime, tween glam, price. Do **not** chase "slime party long island" — Emily's Slime Party runs 60+ town pages at ~2,500 words. Target "slime party **East End / Hamptons / Suffolk**" and "slime party **studio**", where they have nothing. | High | M |
| **B-3** | **Substantiate the surviving town pages** — 300–500 genuinely local words each: a real party we ran there, a real photo, drive time, a named review. **[owner: which towns, which crafts, last 12 months]** This is the *only* thing that makes a town page non-thin, and no amount of templating substitutes for it. | High | M (owner-gated) |
| **B-4** | **`/permanent-jewelry`: add a "parties — studio or at your home" section** + package price + FAQ. Page is walk-in-only today; "permanent jewelry party near me / at home / cost / packages" all autocomplete, and every named local competitor is Nassau/west-Suffolk. | Med–High | S |
| **B-5** | **Build `/paint-party`** (kids canvas / splatter / glow, studio or mobile), 600+ words, with a price. Competitors own this cluster with dedicated pages; we have a station and no page. | Med–High | M |
| **B-6** | **Halloween craft party page — hard deadline Sept 15**, evergreen URL reused yearly. Only genuinely date-bound item on the list; the window closes on its own. | Med | S |
| **B-7** | **Hold:** `/paint-and-sip`, `/girls-night-out`, `/team-building`, `/party-themes`, 3 TOFU posts, remaining seasonal pages. Re-decide after 30 days of real GSC data. See §1d. | — | — |

### Track C — Off-site / listings

Ordering already settled last session; unchanged. **Gated on P0-1** (prices) — do not publish contradictory rates to a dozen directories.

| ID | Action | Notes |
|---|---|---|
| **C-1** | **GBP optimization** — secondary categories (Children's Party Service, Party Planner, Event Venue, Art Studio), **mobile service-area setting** (not just the storefront pin), 9 service entries, 20+ photos, weekly Posts, seed Q&A from `/faq`. | ~1 hr; out-converts everything below it. Fix the `$100/hr` figure in the drafted service list against P0-1 first. |
| **C-2** | **Submit `sitemap.xml` in GSC + Bing Webmaster.** **Do this *after* A-1 ships**, so the first crawl sees the full set. | Steps already emailed 2026-09-04 |
| **C-3** | **Connect GSC + GA4** so the 90-day kill/scale criteria are applicable at all. | The review's own #1, and correctly so — every demand rating in it is qualitative because this is missing |
| **C-4** | The Bash (**Pro, $219/yr**) + GigSalad (free tier) → Peerspace → Tagvenue/Eventective → Nextdoor/Macaroni KID | Settled |
| **C-5** | Editorial outreach: Mommy Poppins LI crafts list (Aug-2025, 20 studios, **none east of Westhampton Beach** — a genuine gap we fit), Hamptons Moms, Your Local Kids 2026 guide, Macaroni KID Hamptons | Real referring domains; ~4 emails |
| **C-6** | Review flywheel 25 → 40. **Coordinate first** — `lib/sms-templates.ts` and `lib/marketing/reviewLink.ts` are being modified by a concurrent session. | Med |
| **C-7** | Facebook Groups — **agent drafts, human posts.** Settled; no automation. | — |

---

## 3. Conflicts with prior decisions, and which wins

| Conflict | Resolution |
|---|---|
| **Rental pricing: owner facts ($125/$200 per hour, no flat block) vs live site (flat $475/$600 blocks + $75/hr + $700/$975 full-day) vs commit `e3d4cc3` vs the prior session's GBP draft ($100/hr).** | **Nobody wins on evidence — this is an owner call (P0-1).** The Sep-4 owner statement is the most recent, but `e3d4cc3` is a deliberate Sep-1 price *increase* touching the live rate engine, admin tools, and confirmation emails. The likeliest reading is that hourly and block pricing are two different products (party-block vs professional-hourly) that were never reconciled in the docs. **Do not guess.** |
| Review: "301 seven town pages" vs reality: they were never published. | **Reality wins.** Delete rows pre-publish; no redirects. |
| Review: "`lib/reviews.ts` RATING is a TODO." | **Codebase wins.** Already correct (25 / 5.0). |
| Review: "several pages lack metadata (`classes`, `party-add-ons`)" vs both being 307 redirect stubs. | **Codebase wins.** Not a gap. Sitemap hygiene (A-4) is the real fix. |
| Review: build 11 new pages in 90 days vs its own (correct) verdict that thin pages are a liability. | **Its diagnosis wins over its prescription.** Ship 2 pages, get data, then decide (§1d). |
| Review: `WebSite`/`SearchAction` schema. | **Skip** — the feature it targeted was retired in 2023. |
| Review: town-count cut driven by autocomplete. | **Substitute operational evidence.** Same end state, defensible, and the surviving pages get real content. |

---

## 4. Owner decisions required

Ranked by how much downstream work each unblocks. None of these are guessable from the repo.

1. **What is the rental price model?** Flat blocks (live: $475/$600/3hr) or hourly ($125/$200 with minimums) — or both, for different products? *Blocks: P0-1, A-7, A-9, C-1, C-4, all quotes and listings.*
2. **What mobile price can be published?** "From $X for 10 kids within 20 mi of Speonk." *Blocks: B-1 — the highest-conversion single change available.*
3. **Which towns have you actually delivered mobile parties in, in the last 12 months — and which crafts?** *Blocks: P0-2 and B-3; determines which town pages ship at all.*
4. **What are the GBP primary/secondary categories and service-area setting today?** *Blocks: C-1, and the whole near-me strategy.*
5. **Is `$75/hr` "Studio by the Hour" a real, current product?** It appears on `/party-room-rental` and nowhere in the canonical facts.
6. **Are camps / after-school / drop-off classes something you want to sell?** Color Pop Workshop now has Southampton **and** Westhampton Beach studios — the East End cluster we are most exposed on, but a different operating model.
7. **Is a quiet / sensory-friendly party a real offering?** If yes → a page; if no → one line in the toddler FAQ. Do not publish it either way until answered.
8. **Spanish:** do South Fork inquiries arrive in Spanish, and is there a bilingual host? *Blocks A-10.* If no, drop `/es/` from the sitemap rather than leaving it orphaned.
9. **Is Manhattan mobile real and profitable?** If not, reframe or drop that page.

---

## 5. Recommended next three actions

1. **Get answers to owner questions 1–3.** Everything meaningful is downstream of pricing and of which towns are substantiable. One conversation.
2. **Curate and ship the untracked SEO build (P0-2 → A-1)** — explicit paths only, PII excluded, thin towns dropped *before* first publish. This turns ~30 indexed URLs into ~45–50 good ones and is the largest single move available.
3. **Ship the retitle + hat-bar + home-H1 batch (A-2, A-3, A-5)** — three small metadata/copy edits on the strongest evidence in the report, then submit the sitemap to GSC (C-2) so the baseline is captured against the *new* URL set rather than the old one.

**Explicitly deferred until 30 days of GSC data exist:** the 11 speculative new pages, the town-page kill/scale criteria, and any further consolidation. You cannot apply a kill criterion measured in impressions when nothing is measuring impressions.
