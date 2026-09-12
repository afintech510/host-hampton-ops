# The agent content pipeline

**COPY → `website_content` → cache → published page.**
Built and driven end to end 2026-09-12 (chain link 6, worktree `windy-summit`).
No migration — **043 is still free.** No new environment variables.

---

## 0. What was actually there

Phase 3C's last unchecked box read *"Agent content pipeline: COPY →
website_content → ISR → published pages"*, and the plumbing half-existed. The
first job was to find out which half. Everything below was measured against the
live database and the live site before anything was changed.

| Claim | Measured |
|---|---|
| `website_content` holds 5 rows | True: 4 `draft` (en), 1 `published` (`es`) |
| The COPY agent writes them | **False.** All five are `created_by = 'manual'` |
| The pipeline has published pages | **Once, by hand.** The only `website_content` rows in `marketing_ledger` are three transitions on 2026-08-17, all `actor = 'admin'` |
| The weekly town-drafts cron runs | **No.** `weekly-town-drafts` appears **0 times** in 10 days of nginx logs, against 805 for `agent-dispatch` and 500 for `gmail-sync` — it is not scheduled at cron-job.org |
| There is no admin UI beyond the preview route | **False.** `app/admin/MarketingTab.tsx` has a full Content pipeline section — list, status badges, preview modal, and the legal transition buttons. What it did **not** have was any way to CORRECT a row |

So: the pipeline had never produced a single row. It was not broken; it had
never been switched on, and the parts that would have caught its output were
missing.

---

## 1. The four drafts that can never render — bug, dead data, or intentional?

**Dead data, and the thing that makes them dead is worth a guardrail.**

`app/[...slug]/page.tsx` is a catch-all, and Next gives a static segment
precedence over a catch-all. All four English drafts —
`first-birthday-parties`, `communion-party`, `fundraiser`, `cm-cheer` — have a
hand-built `app/<slug>/page.tsx`. They were seeded on 2026-02-21, when the
DB-driven renderer was the plan; the pages were then hand-built as static
routes instead, which shadows the rows permanently. They also carry **no
`structured` content at all** — no sections, no FAQ, no `body_html` — so even
unshadowed they would render a heading and a CTA.

The one **published** row is Spanish, and that is exactly why it works: no
static route begins with an `es` segment, so `/es/party-room-rental` reaches the
catch-all while `/party-room-rental` is a real page.

They are left in place rather than archived — that is Allie's content call — but
the panel now says so on every one of them, and the publish gate refuses.

### Why it needed a guardrail and not just a note

Publishing a shadowed row is silent in every direction at once. `advance()`
writes `status = 'published'`, `marketing_ledger` records the transition, the
admin panel turns the badge green, the sitemap gains the URL — and a visitor
sees the hand-built page. Nothing anywhere says the row renders nowhere.

`lib/content/slugSafety.ts` decides this from the same data the renderer uses,
and is applied at four points:

1. **Before the money is spent.** `createTownServiceDraft` checks the slug
   *before* the Claude call. A draft under a dead slug is budget spent on a page
   nobody can reach, and the check costs nothing.
2. **At the publish gate.** `POST /api/admin/marketing/content` refuses
   `published` with a 409 naming the page in the way. Non-publish transitions
   are NOT blocked, so a dead row can still be archived.
3. **In the sitemap.** A shadowed published row is skipped and logged, so the
   same URL is never submitted to Google twice at two priorities.
4. **In the panel**, as an amber banner plus a disabled Publish button carrying
   the reason as its tooltip.

It also refuses reserved prefixes (importing `RESERVED_PREFIXES` from
`lib/content/slug.ts` rather than restating it — rule 11, with a test asserting
the two agree) and non-slug strings, and caps length and depth.

**The tripwire.** `STATIC_ROUTE_PATTERNS` is hand-maintained, because a
`next start` standalone bundle cannot read `src/app`. A test walks `src/app` and
fails if a real page route is missing from the list. The assertion is
**one-directional on purpose**: a missing entry makes the checker call a
shadowed slug safe, which is the dangerous direction; an extra entry only makes
it more cautious.

---

## 2. The renderer executed agent-written HTML

`ContentRenderBody` handed two DB columns to `dangerouslySetInnerHTML`:
`structured.sections[].html` and `body_html`. And
`createTownServiceDraft` ran `JSON.parse` on Claude's reply and inserted
`draft.sections` **wholesale** — the `DraftResult` annotation was a cast, not a
parser. A model answering with

```json
{ "heading": "How it works", "html": "<img src=x onerror=…>" }
```

— the same JSON shape, one different key — got that markup rendered verbatim.

What makes it worse than a public-page XSS: `ContentRenderBody` is also the
admin **preview modal**, which is where a reviewer looks at a draft *while
holding an authenticated `hh_admin` session*. The payload would have executed
there first, before anyone approved anything.

Rule 5 — a field is hostile because of who can WRITE it, not which block it
prints in — and rule 5 is also why the fix is at the READER and not only at the
writer: `body_html` is a column, and the next writer will not remember.

**The fix is not a sanitiser.** A sanitiser is a list of things you thought of.
This renderer has never needed markup: no live row sets `body_html`, no section
carries `html`, and the COPY prompt asks for plain text. So DB content is
**text**, via `lib/content/contentSafety.ts`:

- `htmlToPlainText()` removes `<script>`/`<style>` **bodies**, not just tags
  (including an unterminated one), turns block tags into line breaks, decodes
  entities and then re-strips what decoding revealed.
- `safeImageUrl()` screens `featured_image` and `structured.gallery[]`:
  site-relative or absolute http(s) only. `javascript:`, `data:`, protocol-
  relative `//evil/x.png` and anything containing a control character,
  U+2028/U+2029 or a C1 byte are refused. Built by **code point**, never as a
  literal, because an invisible character in a source file is a guardrail
  nobody can read in a diff (plan §24).

Nothing visible changed, which is the point: the hole was open and empty.

---

## 3. The SEO budget lived only in a prompt

`title` and `meta_description` go straight into `<title>` and
`<meta name="description">`. The prompt asked for "~55-60" and "~150"
characters, and nothing enforced it — the live Spanish row carried **165** and
`first-birthday-parties` **171**.

`lib/content/draftNormalize.ts` is the writer-side parser. It:

- imports `MAX_TITLE_CHARS` / `MAX_DESCRIPTION_CHARS` from `lib/seo.ts` rather
  than restating them (rule 11), and states them **in the prompt** from the same
  constants, so the model is asked for what the writer will enforce;
- trims on a **word boundary**, and trims a title while **keeping the brand
  suffix** — a plain truncation eats " | Host Hampton" off the end and leaves
  the page unbranded in a SERP;
- drops `sections[].html` and recovers only its prose;
- bounds everything: 6 sections, 8 FAQ items, 10 keywords, 2 000 characters of
  section text;
- flattens the characters that forge structure — newline, U+0085, U+2028,
  U+2029, the C1 block, and the bidi/zero-width formatting characters, the same
  set plan §24 had to add to `flattenToOneLine`;
- **refuses** a reply with no usable title, or with no sections *and* no FAQ. An
  empty landing page that reached `pending_review` would be a reviewer's problem
  forever (rule 15);
- records every trim and drop in `notes`, which go to the **ledger**, to the
  API response and into the panel's notice. A normaliser that silently shortens
  a page is the same defect as a guardrail that parks a draft and tells nobody
  (rule 10).

---

## 4. ISR — what "ISR" turned out to mean here

The checklist item says ISR. Caching is right: `force-dynamic` meant **two**
Supabase round-trips per visitor (the row, then a second query for the hreflang
locales) on a landing page that changes a few times a year — and, because
`[...slug]` is the site's de-facto 404 handler, a DB query for every scanner
probing `/wp-login.php` as well.

**Route-level `revalidate` is the wrong mechanism, and the first reason was
measured rather than reasoned about.**

1. **It does not work on this route.** Swapping `force-dynamic` for
   `export const revalidate = 60` and rebuilding leaves `[...slug]` marked
   `ƒ (Dynamic)` in the build table, not `●`. `lib/supabase.ts` sets
   `cache: 'no-store'` on every Supabase fetch, and a no-store fetch opts its
   route out of static rendering entirely. The export would have been a comment.
   *(This is worth carrying forward: it applies to every route in this app that
   reads Supabase during render.)*
2. **The key space is unbounded.** Even if it worked, each distinct URL that
   reaches the catch-all would become its own on-disk ISR entry — a cache keyed
   by a string an attacker picks.

So the cache is at the **data layer**, in `lib/content/published.ts`, in two
stages that bound the key space by construction:

- `loadPublishedIndex()` — **one** cache entry for the whole table: every
  published `(slug, locale)` pair. A path not in it is a 404 with **no DB query
  and no new cache entry**. It also replaces the hreflang query outright.
- `loadPublishedRow()` — one entry per row that really exists.

Freshness is by **tag**, not by clock: `revalidateContent()` runs on every
status transition and every field edit, so an approve → publish is live at once.
The 3 600-second TTL is a safety net for a writer that forgets, not the
mechanism.

The cached callbacks **throw** on a read failure on purpose: `unstable_cache`
stores a resolved value and does not store a rejection, so a Supabase blip
cannot pin "this page is gone" into the cache for an hour.

### Rule 12: three outcomes

`Lookup<T>` is `found | absent | unavailable`, and the renderer must not
collapse the last two. `absent` is a 404 — this URL is gone, and telling Google
so is correct. `unavailable` throws, which is a 500 — Google retries. The
previous code's `catch { return null }` turned one Supabase blip into "this page
does not exist" on every published page simultaneously.

---

## 5. The half of the admin UI that was missing

A reviewer could see a draft, preview it, approve it and publish it. She could
not **fix** it. The one published row's 165-character description could only be
changed with a SQL client.

`PATCH /api/admin/marketing/content` is a **whitelist**: `title`,
`meta_description`, `slug`, `locale`. `status` is deliberately not on it —
status moves through `advance()` and nowhere else, so this cannot become a
second, ungated publish door. `body_html`, `structured` and `featured_image` are
not on it either: hand-editing JSON in a text box is how a reviewer empties a
page.

It applies the same budget and the same markup stripping the agent path does, a
slug change goes through `checkSlug` (and a `(slug, locale)` collision comes
back as 409, not 503), every edit is written to the ledger with
`adminActorId(req)`, and every edit flushes the cache.

The panel gained: the real URL the row will publish at (locale-aware — the old
`view ↗` link pointed at `/{slug}` and so sent you to the **static** page for
the one Spanish row that exists), live title/description length meters that turn
amber at 90 % and red over budget, `created_by` so COPY rows are distinguishable
from hand-written ones, the shadowed-slug banner, a disabled Publish button, and
inline editing with the slug checked as you type.

**One more hardcoded actor is gone.** `reviewed_by` was the literal `'admin'`;
it is now `adminActorId(req)`.

---

## 6. Driven end to end, then attacked

### The pipeline, in production

1. `POST /api/marketing/generate-draft` for **Southampton × permanent jewelry**
   → `permanent-jewelry-southampton`, `created_by = 'COPY'`, `pending_review`,
   47-char title, 131-char description, 3 sections, 3 FAQ entries, no price,
   `$0.0039`.
2. Approve → publish through the gated edges.
3. **Live:** `https://www.hosthampton.com/permanent-jewelry-southampton` — 200,
   correct `<title>`, one `<h1>`, canonical, `WebPage` + `FAQPage` JSON-LD, and
   present in `sitemap.xml` with **no duplicate URLs anywhere in the file**.
4. **The weekly cron, which had never produced a row, run by hand in both auth
   forms** (`x-cron-secret` header and the `?secret=` query string cron-job.org
   would use; a wrong secret 401s). It drafted East Hampton, Smithtown,
   Patchogue and Islip — four real `pending_review` drafts now waiting for
   Allie, every one inside the title and description budget.

Total LLM spend for the whole exercise: **$0.027** (`marketing_budget`
`llm_usd_spent` 0.365926 → 0.393054, cap $25).

### The publish gate, in production

`fundraiser` walked `draft → pending_review → approved` (both fine), then
`approved → published` came back **409** naming `/fundraiser` as a hand-built
page. Restored to `draft` afterwards. `PATCH` refused a slug change to
`studio-rental` (422 `shadowed`) and to `Not A Slug` (422 `format`), and trimmed
a 236-character description to 157 **while saying so**.

### The cache, proved by CHANGING a value (rule 6)

Reading the page proves nothing — a per-field fallback looks right either way.
So: the title was changed **directly in Postgres**, bypassing the route. The
page served the **old** title on three consecutive requests — the cache is real.
Then the same field was changed **through the route**, and the new title
appeared on the very next request — the tag flush works. Both halves, not one.

### The hostile row (rule 8: exercise the guarantee)

A `published` row was inserted **straight into production Postgres**, past the
route, the normaliser and the slug gate, carrying every payload the renderer
ever accepted: `<script>` in `body_html`, `<script>` in `sections[].html`, an
`onerror` image in a section heading and in an FAQ answer, `javascript:` in
`featured_image` and in `gallery[]`, `//evil.example.com/x.png`, and a `jsonLd`
block publishing `offers.price: 399` on a **mobile craft party**.

**What held:** the priced JSON-LD was dropped and the page fell back to the
derived graph; both script bodies were removed; the heading's `onerror` image
was stripped; both gallery URLs were refused; the visible DOM was clean. The
container log named the drops, so rule 10 holds.

**Two things did not, and both were mine.** The probe found them; reading the
code would not have.

1. **`structured.faq` has two readers and only one screened it.**
   `ContentRenderBody` sanitises it; `buildJsonLd` read the raw row. The page
   showed a clean `Question?` while the `FAQPage` node published
   `<script>window…</script>` as the question **text**. Escaped to `<`, so
   inert and never a way out of the script tag — but it is model-written data
   going to Google under our name. A field screened in one reader and not the
   other is rule 11's failure shape.
2. **`featured_image` likewise.** The `<img>` refuses a `javascript:` URL via
   `safeImageUrl`; `openGraph.images` published it verbatim three lines away.

Both fixed, redeployed, and the probe re-run against the fix: **zero payload
markers in the served HTML**, no `javascript:` anywhere, no price in the JSON-LD,
`og:image` correctly fell back to the site default, and the `Question` node
read `"Question?"`. The probe row was then deleted and its URL confirmed 404.

A source-level tripwire pins both, plus "no DB value reaches
`dangerouslySetInnerHTML`" and "this route does not get a route-level
`revalidate`".

### An unplanned test, courtesy of Supabase

Midway through cleanup **Supabase began returning Gateway Timeouts**. Three
behaviours built by recent sessions were exercised for real, without being asked
to be:

- the published DB pages kept serving **200 from cache** instead of 404ing —
  which is precisely the failure mode rule 12 exists to prevent, now with a
  cache in front of it;
- `PATCH` returned **503 "could not save"** rather than claiming success;
- the sitemap **logged** `[sitemap] website_content read failed: Gateway
  Timeout` rather than silently serving a sitemap that looked complete (link
  5's fix, earning itself).

### A trap for the next session

`docker logs hampton_website` lags a few seconds behind a request — Node buffers
stdout to a pipe. Checking the log immediately after a fetch shows **nothing**
and reads exactly like a guardrail that failed to report. Each request to a
DB-driven page produces exactly two lines when both screens fire; count them
before concluding anything. (The same shape as link 5's "wait 20s after a deploy
before measuring".) Cloudflare is **not** a factor here:
`cf-cache-status: DYNAMIC` on every DB-driven page, so every request reaches the
origin.

---

## 7. A stale price found on the way through

The live Spanish page `/es/party-room-rental` published, as its **meta
description** — the text Google shows in a result — *"Desde **$450** por 3
horas"*.

- The English `/party-room-rental` says *"From **$475** for 3 hours"*.
- `pricing_items` (migration 036) says the cheapest 3-hour block is
  `studio_weekday_base` at **$475**, and `studio_weekend_base` is **$600**.

So the Spanish translation was advertising a studio rental $25 below the
cheapest real rate, to search engines. Not mobile pricing, so not in the
do-not-touch set, and the correct figure is unambiguous because the English page
and the rate card agree — corrected through the new PATCH route to match, which
also brought the description from **165 to 128 characters** and closed the last
over-budget snippet `docs/seo-pass.md` §3 left open.

**Every published row is now inside both budgets.** `first-birthday-parties`
still carries a 171-character description, but it is a shadowed draft that can
never publish, so it never reaches Google.

---

## 8. Needs Adam

1. **The cron-job.org job for the weekly town drafts.**
   `/api/cron/weekly-town-drafts?secret=<CRON_SECRET>`, weekly. The route is
   live and was run by hand in production in both auth forms; it is
   self-throttling (2 towns per run, no-op once all 11 have a draft) and lands
   everything at `pending_review`, so it can be left scheduled indefinitely.
   Scheduling it needs the cron-job.org account. **This is the second job in
   that account's backlog** — `/api/cron/agent-distill` (weekly, Monday 7am) is
   still unscheduled from §23/§24.
2. **Four town drafts are waiting for review** in the admin Marketing tab —
   East Hampton, Smithtown, Patchogue, Islip. They are model-written copy that
   no human has read. Nothing publishes without a click.
3. **`permanent-jewelry-southampton` is LIVE.** It is the first agent-written
   page this business has ever published: accurate, priceless, in budget, and
   about a real service. It was published deliberately as the end-to-end proof.
   If Adam or Allie would rather it were not, **Archive** in the Marketing tab
   removes it in one click.
4. **The four dead English drafts.** `first-birthday-parties`,
   `communion-party`, `fundraiser` and `cm-cheer` are shadowed by hand-built
   pages and hold no content. They are safe (they cannot publish) but they sit
   in the review queue forever. Archiving them is a content call.

## 9. Not touched

- **Mobile pricing.** No `mobile-package` row, no `MobilePriceBlock`, no planner
  band, no `pricingCatalog.ts` mobile value. No structured-data price for a
  mobile party was published — the price screen dropped the probe's
  `offers.price: 399` on exactly that basis, and `seo.test.ts`'s assertion still
  passes.
- The booking funnel. `/book`, `/party-planner` and `/studio-rental` were driven
  in a real browser after deploy; all render with an `<h1>` and their
  interactive elements mounted.
- **Observed, not fixed:** an anonymous visitor on `/party-planner` gets a
  console 401 from `/api/party-builder/load` (admin/portal-gated since Phase
  4.5). The page handles it and renders correctly; it is only console noise.

---

## 10. Verification summary

- **1 437 tests** (was 1 284), all green — 153 added.
- **0 app-code `tsc` errors** (`grep -E "^src/" | grep -v "^src/__tests__"`).
- `next build` clean; `/book` still `○ Static`; `[...slug]` `ƒ Dynamic` by
  design.
- Production: both published DB pages render with correct metadata and JSON-LD;
  sitemap 72 URLs, 0 duplicates; publish gate, PATCH guards, cache and tag flush
  all exercised live; hostile row defeated and deleted.
- **No migration (043 still free) and no new environment variables.**
