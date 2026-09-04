# Session Summary & Plan — Venue Listings + AI/SEO Content

**Date:** 2026-09-04
**Scope:** Optimize hosthampton.com for search/AI crawlers, and build the groundwork
to get Host Hampton listed on venue marketplaces and party lead directories.

---

## 1. What shipped (live in production)

Commits `7f2b7c2` (code) and `bf6639e` (docs), pushed to `origin/main`; GitHub Actions
deploy completed successfully. Live on hosthampton.com:

| Change | File |
|---|---|
| **New `/faq` page** — 18 common party questions in 5 groups, with full `FAQPage` JSON-LD. Primary source AI answer engines quote. | `services/website/src/app/faq/page.tsx` |
| **AI-crawler rules** — explicitly allow GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot-Extended, CCBot, etc. + `host` directive | `services/website/src/app/robots.ts` |
| **`Event` JSON-LD** on event detail pages (Google event listings + AI) | `services/website/src/app/events/[slug]/page.tsx` |
| **`FAQPage` schema** added to mobile-party (had FAQ content, no schema) | `services/website/src/app/mobile-party/page.tsx` |
| **`/book` metadata** (was inheriting root defaults) via client-safe layout | `services/website/src/app/book/layout.tsx` |
| **Sitemap** — added 7 missing routes: `/faq`, studio-rental, party-menu, party-quote, party-builder, party-planner, gift-cards | `services/website/src/app/sitemap.xml/route.ts` |
| **Visible hours** + FAQ link in footer | `services/website/src/components/Footer.tsx` |

Later commit `e3c346a` finalized the copy pack.

**Known remaining SEO gaps (not yet addressed):** several pages still lack per-page
metadata (`party-add-ons`, `classes`, `canvas-bags`, `signup`, `vendor-registration`,
`li-high`, `boggle`, `cm-cheer`); no `BreadcrumbList` schema anywhere; no `Service`/`Offer`
schema on most party pages (only first-birthday + fundraiser have it).

---

## 2. Business facts confirmed by owner (now canonical)

- **Outside food & cake:** allowed — blank-canvas, BYO welcome
- **Card fee:** 3% applies to **all** card payments (not invoices only)
- **Studio capacity:** up to **65 guests**
- **Amenities:** free on-site **parking lot**; **folding tables & chairs included**
- **Studio rental rates:** weekday (Mon–Thu) **$125/hr, 2-hr min**; weekend (Fri–Sun)
  **$200/hr, 3-hr min**. No flat-rate block. Net to Host Hampton (marketplace adds its fee).
- Existing: 25% deposit; packages from $800; first birthday from $850 (up to 10 guests);
  permanent jewelry from $65; mobile parties within 20 mi of Speonk included.

---

## 3. Artifacts produced

- **`docs/venue-listing-copy-pack.md`** — paste-ready copy for every listing site: NAP,
  4 description lengths, categories, services, service area, amenities, pricing, event
  types, FAQ answers, keywords, platform-specific notes, NAP-consistency rules.
  **Zero open placeholders.**
- **`docs/venue-listing-agent-plan.md`** — skeptical plan for agent-assisted signups.
  Core finding: an agent gets listings ~90% done but **cannot clear verification walls**
  (CAPTCHA, email/phone OTP, GBP video/postcard). Model = *agent prepares, human verifies*.
  Includes phased rollout, security guidance, and a `listing-status.csv` template.

---

## 4. Rated platform order (ROI-ranked)

**Move 0 — finish Google Business Profile first.** Set the *mobile service-area* (not just
the storefront pin), add secondary categories (Children's Party Service, Party Planner,
Event Venue), 20+ photos, weekly Posts, review-ask habit. ~1 hour, out-converts everything below.

| # | Platform | Notes |
|---|---|---|
| 1 | **The Bash** | Party-specific, LI-heavy; lists venue **and** mobile. **PAID: $129 Basic / $219 Pro per year.** Recommend **Pro** — 8 categories (vs 3) solves the "we don't fit one category" problem; Regional visibility is near-mandatory since Speonk is tiny and mobile travels 20 mi; $50 featured coupon makes real delta ~$40. |
| 2 | **GigSalad** | Same dual play. **Has a free entry tier** — start free, upgrade only if leads justify. Rewards granularity: list each station type (slime, spa, arts & crafts, glitter) as its own searchable act. |
| 3 | **Peerspace** | Biggest hourly-rental volume for the studio. Multi-category trick: list same room as Party Venue + Baby Shower Venue + Photo Shoot. |
| 4 | **Tagvenue + Eventective** | Free LI inquiry directories. Completeness drives ranking. |
| 5 | **Nextdoor Business** | Hyperlocal, free, inside mobile radius. High ROI-per-effort. |
| 6 | **Facebook Groups** | Converts, but ongoing manual effort. **Do NOT automate** (see §5). |
| 7 | **Macaroni KID Hamptons** | Local parent newsletter, birthday audience. Cheap sponsorship. |
| 8 | **PartySlate** | Portfolio play, upscale showers/communions. Slow payoff. |
| 9 | **Peerspace multi-category** | Free upside once #3 is live. |
| 10 | **This Open Space** | Easy to rank, low traffic. Nice-to-have. |
| 11 | **The Knot / WeddingWire** | Pricey, wedding-skewed. Only if pushing bridal-shower volume. |
| 12 | **LiquidSpace / Breather** | Corporate/meeting. Poor fit — skip. |

**Order of execution:** GBP → The Bash (Pro) + GigSalad (free) → Peerspace →
Tagvenue + Eventective → Nextdoor + Macaroni KID → Facebook Groups → rest later/skip.

---

## 5. Key decisions & guardrails

- **Facebook Groups: do not build an auto-posting agent.** No legit API (Graph group
  posting deprecated 2020); automation = ToS violation driving a *personal* account, with
  account-ban and group-removal risk that outweighs the leads. Correct model: agent
  monitors for buying signals, drafts replies, rotates content, tracks per-group promo
  rules and cadence — **human does the actual posting**. A weekly "draft & email my posts"
  agent is safe (never touches Facebook) and this repo already has cron + Resend wired.
- **The Bash is paid**, not free — earlier assumption corrected.
- **Category strategy:** pick categories by *what the customer searches*, not by what
  describes the business. The Bash/GigSalad are vendor/entertainer marketplaces → lead
  with the **Mobile Party** arm there; the studio belongs on the venue sites.

---

## 6. GBP service entries drafted (ready to paste)

Descriptions all under GBP's 300-char limit; price entered as a number with the rate
stated in the service name.

1. **Photography Studio Rental — Weekday** — $100/hr (2-hr min)
2. **Photography Studio Rental — Weekend** — $200/hr (3-hr min)
3. **Party Room Rental — Weekday** — $125/hr (2-hr min)
4. **Party Room Rental — Weekend** — $200/hr (3-hr min)
5. **Kids Theme Party** — from $800
6. **Glow Party** — from $800
7. **Spa & Glam Party** — from $800
8. **First Birthday Party** — from $850 (up to 10 guests)
9. **Mobile Craft Party** — from $850

Full descriptions are in the session transcript; fold into the copy pack §9 when convenient.

---

## 7. Open items / next actions

1. **Submit sitemap in Google Search Console** — `sitemap.xml`, then URL-Inspect →
   Request Indexing for `/faq` and `/`. Also add to Bing Webmaster Tools. *(Steps emailed
   to adam@benchworksai.com on 2026-09-04 via Resend.)*
2. **Start listings** — GBP first, then The Bash (Pro) + GigSalad (free).
3. **Verify exact current category labels** on The Bash & GigSalad; map the 8 Pro category
   slots to station types so none are wasted.
4. **Add the 9 GBP service entries** into the copy pack §9.
5. **Optional:** FB Group Engagement Kit + weekly draft-and-email agent.
6. **Optional:** close the remaining SEO gaps listed in §1.

---

## 8. Prerequisites before any agent-assisted signup

Dedicated `listings@hosthampton.com` inbox (for OTP/verification), OTP-capable phone,
photo/asset pack, password manager. **No credentials in this repo** — it has prior
secret-leak history.
