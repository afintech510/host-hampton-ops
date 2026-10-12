# Careers page — `/join-the-team`

Status: **built and deployed**, 2026-10-11. Planned the same day; the spec below is what was
built, with two differences:

- The migration is **071**, not 070. 070 was taken that day by the evite template choice
  (`evites.template_choice`, applied live). Applied by psql on the box before the deploy.
- Owner alerts go to **`ownerEmail()`** (OWNER_NOTIFY_EMAIL), not `info@hosthampton.com`, until
  the routing test (pre-build check 1) is confirmed delivered. The switch is
  `INFO_INBOX_CONFIRMED` in `lib/careersNotify.ts`; flip it only on a confirmed delivery.

Files: `lib/careers.ts` (roles, pay, every option list), `lib/jobApplication.ts` (the server
screen), `lib/email-templates/careers.ts`, `api/careers/apply`, `app/join-the-team`,
`admin/applications` + `api/admin/applications`. Tripwire: `publicIntakeSurface.test.ts` R11.

## Decisions (Adam, 2026-10-11)

| Question | Answer |
|---|---|
| Pay | **Party Lead $25/hr + tips · Party Helper $17/hr + tips** |
| Age range in the ads | **mostly 5–9** (Adam's call; see the data note below) |
| Must-have helper skills | **arts & crafts, hair tinsel, braiding, nail painting** — we train |
| Notification address | `info@hosthampton.com` — **only once a real test email is confirmed arriving** (pre-build check 1) |
| Text alert per application | yes — `notifyOwnerSms` |
| Applicant confirmation email | yes — signed **Allie** |
| Admin list | yes — `/admin/applications` |
| Portfolio link for Leads | yes, optional |
| Google for Jobs markup | yes — unblocked now that pay is set |
| Minimum age | **18+ for both roles** |
| Lead must have a car | **no** — asked, not required |

## What the bookings say (measured 2026-10-11)

~50 real parties since April (cancelled, `lost`, `lead`, own test plans excluded):

- **Nearly all Sat/Sun**, a handful of Fridays. Start times cluster 11am–1pm, second slot ~4–5pm.
- **14 are mobile** (at the customer's home) plus trucker-hat / patch-bar activations, including a
  150-guest corporate event on a Tuesday (2026-10-20).
- **10 days carry two parties; 2026-11-07 and 2026-11-15 run two at the same hour** (studio +
  mobile). Two crews, two Leads, a Lead who can run a mobile party alone.
- Themes: Custom, Slime, Glow, Spa (studio + mobile), K-Pop Demon Hunter, Barbie, Mermaid,
  Unicorn, Sleep Under, Toddler, plus craft and tinsel/glitter-tattoo mobile parties.
- **Ages — the table is thin.** `child_age` is empty on 35 of 78 bookings, and the table only
  covers 2026 (2025 history lives in HoneyBook exports). Of the 43 recorded: 4–6 = 24, 7–10 = 13,
  11–12 = 2, under 4 = 5. Two real clusters, 4–6 and 8–10; "mostly 5–9" covers the middle of both.
- Ticketed events (drop-offs, Bingo, Ms. Rachel, Christmas Market) are **mostly weekdays**.
- Customers are charged **$30/hr** for the "Party Helper" add-on (migration 065).
- **$17/hr is exactly the 2026 Long Island minimum wage.** From 2027 the NY minimum is indexed to
  inflation, so the helper rate and the ad need a look each January.

## The ads (revised)

Both point to **hosthampton.com/join-the-team**, not an email address.

### Party Lead — Kids' Parties & Events (Speonk + East End)

Host Hampton is a celebration studio in Speonk, NY, hiring a Party Lead to run our themed parties
from start to finish — in the studio and at families' homes across the East End.

You're the face of the party: welcoming families, keeping parents relaxed, running the flow of the
event and leading a small team of helpers. You run the room — and you're hands-on when it counts,
from arts and crafts to hair tinsel, braids and nails.

**You're a great fit if you:**
- Have poise and presence — you can read a room and keep a busy parent smiling
- Have hospitality, events, retail or team-lead experience
- Have an eye for design and enjoy decorating, setup and making a room look finished
- Bonus: balloon arch / garland experience
- Can commit to regular weekend availability (some weekday events too)

Weekend days, sometimes back-to-back parties. **$25/hr + tips.** Must be 18+.
Apply at hosthampton.com/join-the-team.

### Weekend Party Helper — Kids' Birthday Parties (Speonk + East End)

Host Hampton in Speonk is hiring fun, energetic Party Helpers for our themed birthday parties —
Glow, Slime, Spa, Barbie, K-Pop Demon Hunters and custom themes.

You'll be hands-on with the kids (mostly ages 5–9): leading arts and crafts, doing hair tinsel,
braids and nail painting, keeping the energy up, and helping with setup and cleanup so every
birthday feels special. Never done tinsel or braids? We'll teach you — but you'll need to learn
them, because every party has them. Childcare, babysitting or camp experience is a plus; a great
attitude matters most.

Part-time weekends, with flexible hours that fit around school or another job.
**$17/hr + tips.** Must be 18+. Apply at hosthampton.com/join-the-team.

**Copy rules:** no "perfect for students" / age-coded language (NY Human Rights Law covers 18+);
pay is stated (NY pay-transparency law applies at 4+ employees); no luxury/exclusivity words.

## The form

Mobile-first, one page, role selector first. 1–5 scales are large tap buttons, not sliders.
Pay is shown beside each role in the selector.

**Everyone:** role (Lead / Helper / Either) · name · email · phone · **I am 18 or older** (no →
friendly "we're hiring 18+ right now" message, nothing submitted) · weekend availability (every /
most / occasional) · weekday afternoons/evenings (yes / sometimes / no) · car + license (yes / no)
· how'd you hear (Indeed, Instagram, Facebook, a friend, I've been to a party here, other).

**Lead or Either:** hospitality/events/retail/team-lead experience (textarea) · comfort managing
parents and directing a team (1–5) · decorating/design experience and do you enjoy it (textarea) ·
balloon arch/garland (yes / some / no) · portfolio or photo link (optional).

**Helper or Either:** experience with kids (textarea) · comfort leading group activities (1–5) ·
arts & crafts with kids (yes / some / no) · braiding (yes / some / no) · hair tinsel (yes / some /
no) · nail painting (yes / some / no) · **"I'm willing to learn hair tinsel, braiding and nail
painting"** (required checkbox — this is the must).

**Everyone:** why do you want to work with us? (textarea). Hidden honeypot field `website`.

## Build spec

### 1. Migration 071 — `job_applications` (planned as 070)

Apply by hand via psql on the box **before** deploying. Columns as the original prompt, plus:
`is_18_plus boolean not null`, `weekday_availability text`, `has_car boolean`,
`portfolio_url text`, `crafts_experience text`, `braiding_experience text`,
`tinsel_experience text`, `nails_experience text`, `will_learn_beauty boolean`,
`attribution jsonb`, `admin_notes text`, `reviewed_at timestamptz`.
CHECK constraints on `role_interest`, `weekend_availability`, `weekday_availability`, every
yes/some/no column, both 1–5 ratings, and
`status in ('new','contacted','interviewing','hired','declined')`.
RLS copied from `migration_059_market_vendors.sql:184-196`: enabled, service-role policy,
`is_owner_or_admin()` policy, **no public policy** — there is no browser Supabase client.

### 2. `POST /api/careers/apply`

Pattern: `api/christmas-market/vendor/route.ts` for the row, `api/contact/route.ts` for the
notification and outcome tracking.
- `guardRate(req, intakeRule)` as the first statement.
- `clean()`, `looksLikeEmail`, `looksLikePhone`, `boundedIntakeText`; 400 lists missing fields;
  refuse `is_18_plus = false`; Helper/Either without `will_learn_beauty` → 400; honeypot filled →
  fake 200.
- `portfolio_url` through the URL screen in `lib/emailSafety.ts` before it is stored or mailed.
- Insert with `{ data, error }` destructured; `IntakeRecord` semantics — nothing landed → 503.
- **Never `upsertContact`, `enrollInSequence`, `ensureLeadPlan` or `recordInboundEvent`**:
  applicants are not leads and must not reach Brevo, Quo contacts, sequences or the booking agent.
- Owner email via Resend to `info@hosthampton.com` (name, role, weekend/weekday availability,
  car, the four skill answers, link to `/admin/applications`); every applicant value
  `escapeHtml`'d. One-line `notifyOwnerSms(leadSmsLine({ kind: 'Job application', … }))`.
- Applicant confirmation via Resend, signed Allie, plain and HTML parts.

### 3. Page `/join-the-team`

Server page + client form component. Hero pattern from `christmas-market/page.tsx:62-80`;
metadata spreads `OG_DEFAULTS` (title ≤ 60, description ≤ 160). `/careers` → `/join-the-team`
declared in `next.config.js` `redirects()` (a stub page sends no Location). Add to the sitemap and
the footer. Two JobPosting JSON-LD blocks: `baseSalary` 25 and 17 `unitText: HOUR`,
`employmentType: PART_TIME`, `jobLocation` from `lib/studioLocation.ts`, `datePosted`, and a
`validThrough` so a filled role does not stay listed forever.

### 4. Admin `/admin/applications`

Copy `admin/market-vendors/page.tsx` + `api/admin/market-vendors`: GET with
`isAdminAuthorized`, explicit column list, newest first, filter by role, availability and car;
`PATCH [id]` for `status` / `admin_notes`. app.hosthampton.com is not used (Cloudflare 520 since
2026-09-12).

### 5. Test lists to update

- `publicIntakeSurface.test.ts` `DELIBERATELY_PUBLIC` ← `POST /api/careers/apply`
- `emailTemplateEscaping.test.ts` `TEMPLATE_SOURCES` ← the new template file
- `lib/content/slugSafety.ts` `STATIC_ROUTE_PATTERNS` ← `/join-the-team`
- Route tests: happy path, missing fields, under-18 refusal, helper without the will-learn
  checkbox, honeypot, insert failure + email failure → 503, email-only → 200 damaged, no
  `contacts` write.

## Pre-build checks

1. **Does `info@hosthampton.com` deliver?** The domain's MX is Cloudflare Email Routing, so it
   works only if a routing rule for `info@` exists. Send a test and confirm who reads it before
   wiring alerts to it; otherwise fall back to `OWNER_NOTIFY_EMAIL`.

## Out of scope

W-2 vs 1099 classification (accountant), background checks, resume uploads, start-time pay
changes (each January's minimum-wage check is a manual reminder, not code).
