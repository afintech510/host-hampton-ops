# Digital Invitations + RSVP — Stage 1 Codebase Review

**Date:** 2026-10-10 · **Tree:** `main` @ `70588c0` (fetched, matches `origin/main`) · **Live DB:** Supabase `ychnlroczjhwimouecxz`, Postgres 17.6, read via MCP
**Input:** `docs/specs/evites/handoff/HANDOFF.md` (the brief — wins over the planning doc and the AI reviews)
**Status:** Stage 1 — no code changed. **Gate: waiting for Adam's OK.**

All code paths are relative to `services/website/src/` unless stated.

---

## 0. Summary

The feature fits the codebase. The parts it needs mostly exist: a token-gated public page pattern (`/checkin/[token]`), portal magic-link auth, a link-preview card system, a claim-before-send cron discipline, Resend, `sharp`, and public Supabase Storage. **Nine places in the brief do not match how this system actually works.** None of them block the feature, but each one changes the spec:

1. **There is no `leads` or `quotes` table.** A lead and a saved quote are both a `bookings` row (status `lead` or `quoted`). The evite hangs off `booking_id` only.
2. **The deposit is $250, not $99** (`BOOKING_DEPOSIT_CENTS = 25000`, `lib/partyPricing.ts:15`).
3. **"Unlock on `checkout.session.completed`" would miss most deposits.** Party deposits arrive through **four different writers** (two Stripe event types plus hand-entered Venmo/Zelle/cash), and none of them reliably sets `deposit_paid`. Invite unlock must be **derived from money, the way `lib/bookingStatus.ts` already does it**, not triggered by one webhook branch.
4. **Leads almost never carry the child's name.** No public lead route writes `child_name`. Both live in-studio leads have none. The lead-stage preview (D1) will usually have no name to show unless intake changes.
5. **There is no end time** for theme parties, and `party_time` is free text (`"14:00"`, `"2:00 PM"`, `"Evening"`, `"TBD"`). Calendar files and reminders need both.
6. **A 3-character slug suffix is not unguessable.** Combined with D8 (a mobile party shows the family's home address), the slug is the only thing between a stranger and a child's name, age, party date and home address. It needs about 50 bits of randomness.
7. **The site's link-preview rule is the opposite of the brief.** `lib/linkPreview.ts` and `app/plan/layout.tsx` state that a preview must never carry customer data. The invite card deliberately does. That is a legitimate exception, but it should be written down as one.
8. **`upsertContact` is the wrong tool for Birthday Club opt-ins.** It sets **email and SMS** opt-in together, overwrites the stored name of an existing contact, and syncs to Brevo and Quo on every call. That would breach D3 (email-only) and D16 (reminder contacts are not marketing).
9. **Meta Pixel and GA fire on every page, with no exclusions.** On `/i/[slug]` that sends a child's name (in the URL and the page title) to Meta and Google.

Two unrelated live defects also turned up on the deposit path that this feature depends on (§7).

---

## 1. How the relevant parts work today

### 1.1 Leads and quotes

| Entry | File | Writes |
|---|---|---|
| Inquiry form | `app/api/lead/route.ts:139` → `ensureLeadPlan` | `bookings` `status='lead'`: date, `party_time` from time-of-day, guests, `child_age`. **Theme goes into notes and `party_tags.party_theme` only. No child name.** |
| Contact form | `app/api/contact/route.ts:115` → `ensureLeadPlan` | Name, email, phone, message. No party type. |
| `/kids-party-menu` "Save for later" | `app/kids-party-menu/KidsPartyMenuContent.tsx:589` → `app/api/quote/save/route.ts:136` | Lead plus screened line items. `childName` sits only inside `quote_snapshot`; **the route never writes `child_name`**. `partyTime` is always null. |
| `/kids-party-menu` "Check availability" | `KidsPartyMenuContent.tsx:619` → `/api/lead` | As the inquiry form. The party name goes into notes. |
| `/kids-party-menu/summary` submit | `summary/SummaryContent.tsx:139` → `app/api/party-checkout/route.ts:145` | `pending_review` request with `child_name`, `child_age`. **Sends `address`, which the route never reads (dropped).** |
| Mobile inquiry | `app/api/mobile-party-inquiry/route.ts:77` → `ensureLeadPlan` | No address field. |
| Party planner | `/party-planner` → `app/api/party-builder/save/route.ts` | Insert is `awaiting_deposit` with child name and age, `party_tags.location_type` / `location_address` / `catchy_party_name`. **The insert hard-codes `party_type: 'in_studio_theme'` even for a mobile plan (L288).** |
| Admin | `app/api/admin/parties/create/route.ts:104`, `app/api/admin/bookings/route.ts:52` | `awaiting_deposit` / `confirmed`. |

- `ensureLeadPlan` / `findOpenPlan` / `enrichPlan` live in `lib/plan.ts` (lead row shape L341-366; open-plan match L520-588).
- **Ordering rule, `lib/plan.ts:16-26`:** the plan must exist before `recordInboundEvent`, or the agent drafts the lead twice. Creating an evite at lead time must sit after that and be non-fatal to the intake's response (the `IntakeRecord` rule in AGENTS.md).

### 1.2 What a booking can tell an invite (live data, 2026-10-10)

| Invite field | Where it lives | Reliability |
|---|---|---|
| Child name | `bookings.child_name` | In-studio: 0/2 leads, 1/3 awaiting deposit, 14/16 paid in full. Mobile: 4/10 paid in full. |
| Age | `bookings.child_age` (integer) | Better than name; still gaps. |
| Theme | **No column.** Four homes: `booking_line_items` row `category='theme'` → `pricing_items` (category `party-theme`); `bookings.package_type` (free text, e.g. "Glow Party", "Custom Party Theme", "Pool party "); `quote_snapshot.themeName`; `party_tags.theme` / `party_theme` (free text). | Needs one resolver mapping to `party_themes.slug`. |
| Theme catalogue | `party_themes`: `glow-party`, `swiftie-party`, `spa-party`, `slime-party`, `kpop-party`, `barbie-party`, `sweets-treats`, `sleep-under-party`, `toddler-party` | Names differ from `pricing_items` ("K-Pop Party" vs "K-Pop Demon Hunter Party"). Communion, first birthday and trucker hat are landing pages, not rows. |
| Date | `party_date` (date) | Good once booked; free-text requests go to `party_tags.requested_date_text`. |
| Start time | `party_time` (**text**) | Values seen: `14:00`, `12:00 PM`, `Evening`, `TBD`. `lib/partyTime.ts` `parseTime` handles the first two only. |
| End time | **None.** Implied 2h (`webhook/route.ts:684` calendar block); mini party 1.5h (`quote_snapshot.isMiniParty`); mobile tiers 60/90 min (`lib/pricingCatalog.ts:159-205`); studio rentals use `party_tags.rental_end_time`. | Needs a duration resolver. |
| Location type | `bookings.party_type` (CHECK: `in_studio_theme`, `mobile_party`, `studio_rental`, `unknown`, NULL) and `party_tags.location_type` (`host_hampton` / `mobile`) | `party_type` is unreliable for planner-created mobile plans (above). Read both. |
| Mobile address | `party_tags.location_address` (`lib/partyAddress.ts`, `isProvisionalAddress` L27); check-in also captures `checkin_address_*` | Often provisional or absent until check-in. |
| Studio address | `lib/studioLocation.ts:39-59` — `295 Montauk Hwy`, `Speonk, NY 11972`, no suite. | Correct; matches the mock. `lib/email-templates/reminders.ts:129,222` still put "Suite 7" in map URLs. |
| Guest cap | `bookings.guest_count_approx` (what was booked); catalogue defaults: theme 10 included, mini 6, mobile 8/12 (`pricingCatalog.ts:70, 221-226`) | Birthday child is already excluded everywhere (`pricingCatalog.ts:70`). Mini cap is 6 in the catalogue but 7 in `KidsPartyMenuContent.tsx:26` and the planner copy. |
| Host contact default | `STUDIO_PHONE_DISPLAY` `(631) 998-9325` (`lib/studioLocation.ts`) | Matches D5. **Never** the Venmo/Zelle number 631-599-2469. |

There are 19 upcoming non-cancelled kids parties (in-studio plus mobile).

### 1.3 Deposits — who records them

`lib/bookingStatus.ts` `bookingStage()` (L102) says **Booked** when net payments are above zero (`sumPayments`, `lib/bookingBalance.ts:64`) **or** the status is a legacy booked value (`deposit_paid`, `confirmed`, `modifications_locked`, `paid_in_full`, `completed`). `approved` without money is deliberately not booked. This already drives the admin Parties/Booked tabs and `/my-booking`.

The writers it covers:

| Path | Stripe object / source | Webhook / writer | Status it writes |
|---|---|---|---|
| Party planner, `/my-booking` → `/api/portal/pay` | PaymentIntent, metadata `party_builder` | `payment_intent.succeeded` (`app/api/webhook/route.ts:426-707`); browser race `app/api/party-builder/confirm-session/route.ts:120-178` | `pending_review` (or `paid_in_full`), `date_locked` |
| `/plan/[ref]/summary` PayPanel → Payment Link `plan_pay_link` | Checkout Session | `checkout.session.completed` / `async_payment_succeeded` → `lib/planPayment.ts` `recordPlanPayment` (L249-521) | `deposit_paid` (the only writer of it), no `date_locked` |
| Admin "record payment" (Venmo / Zelle / cash) | none | `app/api/admin/parties/[id]/route.ts:471-629` + `lib/adminMoney.ts` | **unchanged** (only `paid_in_full` at zero balance) |
| Admin-created booking | none | `app/api/admin/bookings/route.ts:52` | `confirmed`, with no payment row |

- Checkout `party_builder` (webhook L2041) and the legacy no-metadata tail (L2523) are effectively dead: nothing creates those sessions now.
- **There is no post-deposit hook anywhere.** Each branch inlines its own side effects behind a per-payment "first time" flag (`pbFirstTime`, webhook L555).

### 1.4 Customer portal and auth

- **Magic link:** `lib/portalAuth.ts` stores `HMAC("<ref>:<raw>")` in `portal_tokens`, valid **30 days and reusable** (L10). The link is `/api/portal/auth?ref&token&redirect`; the only minter is `lib/portalLinkMint.ts`.
- **Cookies:** `hh_portal` is `<ref>:<issuedAtMs>:<sig>`, 30 days. The legacy unsigned-expiry form is honoured until 2026-10-20. The email-code fallback is `/api/portal/email-auth/*` (6 digits, 15 min, 5 tries, atomic claim).
- **Redirect allow-list** (`app/api/portal/auth/route.ts:175-186`): `/my-booking`, `/party-builder`, `/party-planner`, `/plan/<ref>/summary`. **A host invite page must be added there.**
- **Portal pages:** `/my-booking` (one long scrolling page of sections, **no tabs**), `/my-booking/pay`, `/plan/[ref]/summary` (gated by `lib/planAccess.ts`), `/party-planner`.
- **The "kids-party lifecycle spec" the brief cites (§4, §9) does not exist in this repo.** The TODO is `starting_plan/HostHampton_ClaudeCode_TODO_v1.2.md` and says nothing about portals or invites. The brief's "6 open questions incl. magic-link expiry" are answered by the code above: 30 days, reusable, email-code fallback. `docs/portal-auth-review.md` has the reasoning.

### 1.5 The closest analogue to `/i/[slug]`: pre-arrival check-in

- `lib/checkinAuth.ts` / `lib/checkinLink.ts`: 32 random bytes, stored as `HMAC("checkin:"+raw)` in `checkin_tokens`, looked up **by hash**. It dies at 23:59 ET on the party date.
- `app/api/checkin/[token]/route.ts:31-52` `publicBookingView()` is an output allow-list. POST is rate limited, field lengths are bounded, and it can never change `contact_email`.
- `app/checkin/[token]/page.tsx` is a server component, `force-dynamic`, noindex, and renders nothing until the token resolves.
- Caveat to avoid copying: `resolveCheckinToken` reads the booking with `select('*')` and allow-lists only at output.

### 1.6 Link previews

- `lib/linkPreview.ts`: preview-bot UA list (iMessage fetches as `facebookexternalhit/1.1 Facebot Twitterbot/1.0`); `previewCardHtml()` (L119-160) is a static card, `/images/og-default.png`, with a `?go=1` escape hatch. L110-118: "**It must never carry customer data.**"
- `app/plan/layout.tsx:12-24`: fixed OG strings and deliberately **no** `generateMetadata`, so a third party never renders a customer's name.
- Dynamic OG today: only `app/events/[slug]/page.tsx` (a DB image URL). The brief's "known limit": odd image sizes make iMessage fall back to a small chip, so always emit width and height.

### 1.7 Rendering, fonts, storage, container

- **No** `next/og`, `@vercel/og`, satori, puppeteer, playwright-core or canvas. `lib/planShare.ts:92` records that puppeteer was deliberately left out.
- **`sharp ^0.33.5` is installed** (used for upload resizing, `app/api/admin/media/route.ts:89`).
- **Fonts:** none self-hosted. `app/globals.css:1` `@import`s Google Fonts at runtime; one `next/font/google` (`app/trucker-hat-bar/layout.tsx`). No `@fontsource`.
- **Container:** `services/website/Dockerfile` is `node:20-alpine`, standalone output, **no Chromium and no system fonts**.
- **Storage:** public buckets `media` (used by `app/api/admin/media/route.ts`) and `event-images`. Supabase host is in `next.config.js` `images.domains`. **No `headers()` in `next.config.js`.**

### 1.8 Admin

- Admin is **`/admin`** on the main host (`app/admin/page.tsx` `TABS` L34), cookie `hh_admin`, APIs gated by `isAdminAuthorized` + `adminActorId`. `app.hosthampton.com` has answered Cloudflare 520 since at least 2026-09-12 (PLAN.md L210). The brief's "RSVP tab in app.hosthampton.com" means `/admin`.
- **Party detail:** `app/admin/PartiesTab.tsx` (L843+) is a two-column card drawer, not tabs: Customer, Event, Studio time, Line Items | Actions (incl. pre-arrival check-in L1266, `PhotoAlbumSender` L1313), Balance, Payments, Activity. **An "Invitation & RSVPs" card fits there**, fed by a new `/api/admin/parties/[id]/rsvps`.
- **Prep sheet:** there is none in the app. `party-summary-sheets/*.html` at the repo root are untracked, hand-made files. "Headcount + allergies on the party prep sheet" has nothing to attach to (see C14).

### 1.9 Email

- **No shared Resend wrapper.** About 60 call sites construct `new Resend(...)` inline; the cron has a private `sendEmail()` (`app/api/cron/send-reminders/route.ts:321-329`). **No attachments anywhere**, though `resend ^6.9.2` supports them. **No `.ics` or Google Calendar link code anywhere.**
- **Templates:** `lib/emailTemplates.ts`, `lib/email-templates/*`. The rule is `escapeFields()` first and URLs through `mailHref` (`lib/emailSafety.ts`), enforced off disk by `__tests__/lib/emailTemplateEscaping.test.ts` over a **fixed file list** (L57-61). New template files must be registered there.

### 1.10 Scheduler

- **Live scheduling:** the box crontab (`/root/hh-cron.sh`) runs `send-reminders` every 15 min and `review-asks` daily. Everything else is cron-job.org.
- `scheduled_reminders` (`lib/reminderQueue.ts`, `app/api/cron/send-reminders/route.ts`):
  - claim, then freshness check (`lib/scheduleFreshness.ts`, 48h), then send; SMS quiet hours via `lib/quietHours.ts`.
  - `reminder_type` and `reference_type` (`event|booking|contact`) are CHECK-constrained.
  - The dedup index is `(contact_id, reminder_type, reference_id)`.
  - **The cron joins `contacts` and fails any row without one** (L208-210). `contact_id` is nullable in the live table, but the sender assumes it is set.
- **Time helpers:** `lib/partyTime.ts` `etToUtc` / `shiftEtDate` (the box is UTC; never `setHours`).

### 1.11 Contacts, consent, security helpers

- **`upsertContact`** (`lib/contacts.ts:114-269`):
  - `marketingConsent: true` sets **both** `email_opt_in` and `sms_opt_in` (L175-181).
  - It writes `first_name`/`last_name` from the posted name over an existing row (L138-140, applied at L189).
  - It always calls `syncContactExternally` (Brevo + Quo, `lib/contactSync.ts:95-141`).
  - `contacts.source` is the enum `lead_source` (no `evite` value). There is no consent-wording storage anywhere.
- **Other helpers:**
  - `optedOutReason` (`lib/sequences/processor.ts:817`)
  - `lib/contactLookup.ts` (the only legal email/phone matcher)
  - `lib/rateLimit.ts` (in-memory, per container; per-caller key forgeable; `guardRecipient` for per-recipient caps)
  - `lib/publicOrigin.ts`
  - `lib/publicIntake.ts` screens (`boundedIntakeText`, `screenPublicCount`, …)
- **No captcha, Turnstile or honeypot exists.**

### 1.12 Analytics

- `lib/gtag.ts` (GA4 + Ads + Meta helpers), `lib/metaPixel.ts`.
- `components/MetaPixel.tsx` fires PageView on **every** pathname change with no exclusions. It is mounted in `app/layout.tsx:206-208` alongside GA and `AttributionCapture`.
- No general server-side event table.

### 1.13 Tripwire suites a new feature must satisfy (`__tests__/lib/*Surface.test.ts`)

| Suite | What the feature needs |
|---|---|
| `publicIntakeSurface` | Every unauthenticated handler listed in `DELIBERATELY_PUBLIC`, rate limited, writes read their results |
| `portalAuthSurface` | Column allow-list constants; no `select('*')` to customers |
| `portalWriteSurface` | Token routes never move `contact_email` |
| `contactIdentitySurface` | Email/phone matching only via `contactLookup` |
| `adminSurface` | `isAdminAuthorized` + `adminActorId` |
| `cronSurface` + `outboundSendSurface` | New cron in the known list and `SEND_ROUTES`; the exact module count (`ALL.length === 23`) changes; claim before send; freshness |
| `emailTemplateEscaping` | New template files registered |
| `slugSafety.test.ts` | `/i` added to `STATIC_ROUTE_PATTERNS` in `lib/content/slugSafety.ts:43`, because a static `app/i/` shadows the root `[...slug]` catch-all |

---

## 2. Live schema vs HANDOFF §8

| HANDOFF assumes | Live reality | Proposal |
|---|---|---|
| `leads`, `quotes` tables | Neither exists | `evites.booking_id NOT NULL` → `bookings(id)`. A lead is a booking. |
| `evite_templates` table with asset URLs | — | **Templates as code**, a registry like `lib/appointmentEvents.ts`: `lib/evites/templates/glow.ts` + bundled assets + `glow.layout.json`. Rendering needs the fonts and art on local disk anyway, and a template change belongs in git with tests. `evites.template_slug` is validated in code. A DB table can come in P2 if Adam wants to toggle templates without a deploy. |
| `evites` copies `event_date`, start/end, `location_type`, address, `honoree_name`/`age` | All already on `bookings` | **Do not copy them.** Two homes for the party date is the drift the AGENTS.md rules keep fixing. One function `inviteFacts(booking)` derives every displayed fact; the evite stores only invite-specific choices plus a hash of the inputs it was last rendered from. |
| `evites.status` (preview/live/archived) flipped by the webhook | No single deposit writer (§1.3) | Store only `archived_at`. **preview vs live is derived** from `bookingStage()` at read time. |
| `host_token_hash` | Portal auth exists | Drop. The host page uses the `hh_portal` cookie (`lib/planAccess.ts`). |
| `evite_reminders_sent` | — | `evite_sends`: one ledger for every evite email (invite ready, new RSVP, guest confirmation, week before, day before, details changed, final headcount), claim-before-send, unique per (evite, rsvp, type, version). |
| `contacts` upsert with `source='evite'`, `source_evite_id` | `contacts.source` is enum `lead_source`, no `evite`; no `source_evite_id` column; `upsertContact` is unsafe here (§1.11) | `ALTER TYPE lead_source ADD VALUE 'evite'`. Provenance in `source_detail` = `evite:<slug>` and on `evite_rsvps.contact_id`. A dedicated `recordClubOptIn()` writes email-only consent and never overwrites an existing name. |
| "store exact wording shown" | No consent-text storage exists | `evite_consent_texts (version PK, wording)`, seeded; `evite_rsvps.opt_in_text_version` FK. |
| RLS | All core tables have RLS on with service-role/admin policies only | Same: RLS on, **no anon policies**. Every public read goes through a server route with a column allow-list. |

### Proposed `starting_plan/migration_068_evites.sql` (draft for review — nothing applied)

The highest file is 067. It is purely additive: new tables, one new enum value, no change to existing columns.

```sql
-- 068: digital invitations + RSVP (MVP). Additive only.
BEGIN;

CREATE TABLE evites (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id            uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  -- name-theme-<10 chars base32> ≈ 50 bits; see C6
  slug                  text NOT NULL UNIQUE
                        CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 14 AND 80),
  template_slug         text NOT NULL DEFAULT 'glow',
  theme_word            text CHECK (char_length(theme_word) <= 12),   -- override; NULL = template default
  theme_sub             text CHECK (char_length(theme_sub)  <= 12),
  host_contact_name     text NOT NULL DEFAULT 'Allie'        CHECK (char_length(host_contact_name) BETWEEN 1 AND 40),
  host_contact_phone    text NOT NULL DEFAULT '631-998-9325' CHECK (char_length(host_contact_phone) BETWEEN 7 AND 20),
  show_host_contact     boolean NOT NULL DEFAULT true,
  host_note             text CHECK (char_length(host_note) <= 140),
  gift_note             text CHECK (char_length(gift_note) <= 140),
  rsvp_deadline         date,
  render_version        integer NOT NULL DEFAULT 0,
  render_inputs_hash    text,
  rendered_at           timestamptz,
  image_key             text,             -- random storage prefix; image URLs never derive from the slug alone
  invite_ready_sent_at  timestamptz,      -- claimed by conditional UPDATE (exactly-once "your invite is ready")
  final_headcount_sent_at timestamptz,
  archived_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uniq_evite_per_live_booking ON evites (booking_id) WHERE archived_at IS NULL;

CREATE TABLE evite_consent_texts (
  version     text PRIMARY KEY,                 -- 'club-v1'
  channel     text NOT NULL CHECK (channel IN ('email','email_sms')),
  wording     text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO evite_consent_texts (version, channel, wording) VALUES
  ('club-v1', 'email', 'Send me party & craft ideas from Host Hampton');   -- pending D3 confirmation

CREATE TABLE evite_rsvps (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evite_id             uuid NOT NULL REFERENCES evites(id) ON DELETE CASCADE,
  status               text NOT NULL CHECK (status IN ('yes','no')),
  parent_name          text NOT NULL CHECK (char_length(parent_name) BETWEEN 1 AND 120),
  -- [{first_name, allergy_note|null}], siblings included; birthday child never appears here
  children             jsonb NOT NULL DEFAULT '[]'
                       CHECK (jsonb_typeof(children) = 'array' AND jsonb_array_length(children) <= 6),
  child_count          integer GENERATED ALWAYS AS (jsonb_array_length(children)) STORED,
  adult_count          smallint NOT NULL DEFAULT 0 CHECK (adult_count BETWEEN 0 AND 2),   -- 2 = "2+"
  has_allergy          boolean,
  note_to_honoree      text CHECK (char_length(note_to_honoree) <= 500),
  reminder_email       text CHECK (char_length(reminder_email) <= 254),
  reminder_phone_e164  text CHECK (reminder_phone_e164 ~ '^\+1[2-9][0-9]{9}$'),
  reminder_opt_out_at  timestamptz,
  club_email           text CHECK (char_length(club_email) <= 254),
  club_opt_in_at       timestamptz,
  opt_in_text_version  text REFERENCES evite_consent_texts(version),
  club_opted_out_at    timestamptz,
  birthday_month       smallint CHECK (birthday_month BETWEEN 1 AND 12),
  contact_id           uuid REFERENCES contacts(id) ON DELETE SET NULL,   -- set ONLY on club opt-in
  consent_ip           inet,
  edit_token_hash      text NOT NULL UNIQUE,
  allergy_purged_at    timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'yes' OR (jsonb_array_length(children) = 0 AND adult_count = 0)),
  CHECK (club_opt_in_at IS NULL OR (club_email IS NOT NULL AND opt_in_text_version IS NOT NULL))
);
CREATE INDEX idx_evite_rsvps_evite ON evite_rsvps (evite_id);

CREATE TABLE evite_sends (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evite_id     uuid NOT NULL REFERENCES evites(id) ON DELETE CASCADE,
  rsvp_id      uuid REFERENCES evite_rsvps(id) ON DELETE CASCADE,
  send_type    text NOT NULL CHECK (send_type IN
               ('invite_ready','new_rsvp','rsvp_confirmed','week_before','day_before','details_changed','final_headcount')),
  ref_version  integer NOT NULL DEFAULT 0,          -- render_version for details_changed; 0 otherwise
  channel      text NOT NULL CHECK (channel IN ('email','sms')),
  status       text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','sent','failed','skipped')),
  outcome      text,
  provider_id  text,
  last_error   text,
  claimed_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz
);
CREATE UNIQUE INDEX uniq_evite_send_once
  ON evite_sends (evite_id, rsvp_id, send_type, ref_version, channel) NULLS NOT DISTINCT;   -- PG17

CREATE TABLE evite_events (                          -- analytics, no PII
  id          bigserial PRIMARY KEY,
  evite_id    uuid NOT NULL REFERENCES evites(id) ON DELETE CASCADE,
  event       text NOT NULL CHECK (event IN ('invite_viewed','share_clicked','rsvp_started','rsvp_completed',
                                             'club_opted_in','birthday_month_saved','calendar_added')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_evite_events ON evite_events (evite_id, event);

ALTER TABLE evites              ENABLE ROW LEVEL SECURITY;
ALTER TABLE evite_rsvps         ENABLE ROW LEVEL SECURITY;
ALTER TABLE evite_sends         ENABLE ROW LEVEL SECURITY;
ALTER TABLE evite_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE evite_consent_texts ENABLE ROW LEVEL SECURITY;
-- No anon/authenticated policies: service role only, like bookings/contacts.

-- updated_at triggers: reuse the project's existing trigger function (confirm its name in Stage 2).
COMMIT;

-- Outside the transaction (ADD VALUE cannot be used in the same transaction that adds it):
ALTER TYPE lead_source ADD VALUE IF NOT EXISTS 'evite';
```

The brief's `booking_completed` and `guest_booking` analytics events are reports, not stored events. They come from a join (a new booking whose contact matches a past RSVP's club email, via `contactLookup`). The Storage bucket choice (`media` vs a new `evites` bucket) is a Stage 2 decision. A new public bucket is cleaner for retention sweeps.

---

## 3. Conflicts with HANDOFF and how I'd resolve them

Items marked **[Adam]** need a decision. The rest are engineering calls I'd make in the spec unless told otherwise.

**C1. No `leads`/`quotes` tables (§8, §9).** The evite keys on `booking_id`. "A new lead with a theme" means a `bookings` row at `lead`/`quoted` whose `party_type` (or `party_tags.location_type`) is a kids party. Exclude studio rentals, fundraisers, trucker, contact-form-only.

**C2. Deposit is $250 (§1 item 2).** Copy only. The invite never names the amount.

**C3. Unlock trigger (§9, AC 2).** `checkout.session.completed` carries only plan pay-link deposits. Party-planner and `/my-booking` deposits arrive as `payment_intent.succeeded`, and Venmo/Zelle/cash arrive through admin with no status change.
- **Live = `bookingStage()` in {booked, completed}, not cancelled/lost, not archived**, computed at read time. That covers every writer (including Venmo), refunds back to zero, and admin "confirmed" bookings. "Repeated webhooks do not duplicate" is then true by construction.
- **The "invite is ready" email** is sent by a sweep in the new evite cron: find booked bookings whose evite has `invite_ready_sent_at IS NULL`, claim with a conditional UPDATE, send. That is exactly once per booking, without touching five money writers.
- **[Adam]** Should a refund that takes net paid back to $0 take the invite offline? The derived design does that automatically. I recommend yes.

**C4. Lead-stage preview has no name (D1).** No public lead route writes `child_name`. `quote/save` keeps it only in `quote_snapshot`. The inquiry form doesn't ask. Theme is free text in four places.
- Engineering fix: read `quote_snapshot.childName` as a fallback, and add an optional "Birthday child's first name" field to `/api/lead` and the mobile inquiry. That also fixes the quote-save bug.
- **[Adam]** What should a preview show with no name? Options:
  - (a) Don't create a preview until a name exists.
  - (b) Show "Your Star" or "Birthday Star" as the placeholder.
  - (c) Show the theme only.

  I recommend **(b) for the page, but don't email the preview until a real name exists**: a sales asset that says "Your Star" is weaker than none.
- Theme resolution: line-item `pricing_item_id` → `party_themes.pricing_item_id`, else a fuzzy name match → `glow-party` etc. Anything unresolved gets the plain fallback with the theme word from `package_type` ("CUSTOM PARTY" if nothing usable).

**C5. No end time; free-text start (§6b, AC 6).**
- One `partyWindow(booking)` resolver: start from `parseTime(party_time)`, duration 2h / 1.5h (mini) / mobile tier minutes / rental end time.
- **An unparseable start (`Evening`, `TBD`) keeps the invite from going live** and shows on the admin card as "needs a start time". A calendar file with a guessed time is worse than no file.
- **[Adam]** Confirm the durations: theme 2h, mini 1.5h, mobile Entry 60 min / Signature 90 min.

**C6. Slug guessability (D9) combined with D8.** `mia-glow-k4x` has 36³ ≈ 46,656 suffixes. With only an in-memory per-container rate limit and a forgeable per-caller key, enumerating every "mia-glow-*" invite is a single afternoon's work. For a mobile party it reveals a child's name, age, date and **home address**.
- Proposal: keep the readable prefix, make the suffix **10 characters of Crockford base32 (~50 bits)**, e.g. `mia-glow-7kq2m9xh4t`. That stays within D9's "unguessable suffix". The image object key gets its own random prefix too.
- Also: 404 identically for unknown and archived slugs, and `X-Robots-Tag: noindex` plus `<meta robots noindex>`.

**C7. Link-preview privacy rule (§6).** The codebase rule "a preview never carries customer data" exists for portal links that unlock money and documents. An invite is the opposite case: the parent is deliberately publishing it to guests. I'll write the exception down in `lib/linkPreview.ts` and AGENTS.md so a later reviewer doesn't "fix" it. The card carries the first name, theme, date, place and host contact line, per D5. It does **not** carry the mobile street address (town only, e.g. "Westhampton Beach"); the address appears only on the page itself.
- **[Adam]** OK to keep the street address off the preview image? The mock already shows only "Host Hampton, Speonk".

**C8. Rendering pipeline (§6, Stage 4).** No Chromium on Alpine, and the prototype uses Playwright.
- **Recommendation:** Satori via `next/og` `ImageResponse` → `sharp` → JPEG (mozjpeg, q≈82, check < 300 KB), rendered in the Node runtime, stored in Storage under a versioned key.
- **Risk:** the Glow design uses `-webkit-background-clip:text` gradients and `filter: drop-shadow`. Satori supports `background-clip: text` and `text-shadow`, but **not `filter`**. The neon glow has to be rebuilt from stacked text-shadows, or the "GLOW" word pre-rendered per template as art.
- **Stage 3 should start with a one-day spike**: render the Mia invite with Satori and diff it against `mocks/invite_mia.png`.
- **Fallback** if fidelity fails: a separate render worker container with Chromium, not inside the website image (the build rule is that the site image stays small, and `lib/planShare.ts:92` already rejected puppeteer).
- **Fonts:** Satori takes TTF/OTF/WOFF, not WOFF2. `@fontsource` ships WOFF, so bundle the `.woff` files for the four families and load them from disk, never from Google. The page uses the same files via `@font-face`.

**C9. Host page lives where? (§4).**
- There is no tabbed portal and no lifecycle spec.
- Proposal: `/my-booking/invitation` (a sibling page plus a link from `/my-booking`), gated by `hh_portal` through `planAccess`, with `/my-booking/invitation` added to the portal auth redirect allow-list. "Becoming a tab" is a later UI refactor of `/my-booking`, not a dependency.
- Admin gets the same view as a card in the PartiesTab drawer.

**C10. Guest reminders don't belong in `scheduled_reminders` (§6b).** That queue, its dedup key and its sender are contact-centric, and D16 says reminder contacts are **not** contacts.
- Proposal: a dedicated `/api/cron/evite-sends` that **computes** due sends each tick (week before ~10am ET, day before ~4pm ET, final headcount after the day-before run, invite-ready sweep, allergy purge) and claims each into `evite_sends`. No pre-built queue, so a date change needs no rescheduling.
- Bound lateness the way `lib/scheduleFreshness.ts` does: skip a week-before email inside 2 days of the party, and never send a day-before email after the party.
- Schedule it on the box crontab beside `send-reminders` (every 15 min), and register it in `cronSurface` / `outboundSendSurface`.

**C11. Birthday Club opt-in vs `upsertContact` (D3, D4, D16).** Calling `upsertContact` with `marketingConsent:true` would:
- opt the guest parent into **SMS** marketing (breaks D3 email-only);
- overwrite an existing customer's stored name with whatever they typed (this happened to Host Hampton's own Brevo contact on 2026-09-16);
- push a Quo contact for a phone number.

Proposal: `recordClubOptIn()` in `lib/contacts.ts`:
- finds the contact by email via `contactLookup`;
- inserts if absent, with `source='evite'`;
- sets `email_opt_in`/`email_opt_in_at` **only**;
- never rewrites names on an existing row;
- syncs to Brevo only.

Reminder-only and No RSVPs never touch `contacts`.

**[Adam]** Which Brevo list do club members go on? List 3, "Host Hampton Leads" (944), receives promotional campaigns; D2/D4 say the club gets ideas, no offers. I recommend **a separate "Birthday Club" list** so a future campaign to list 3 cannot reach them by accident.

**C12. Analytics leak (§10).** Meta Pixel and GA would receive `/i/mia-glow-…` and the title "Mia's Glow Party".
- Proposal: exclude `/i/` and `/my-booking/invitation` from `MetaPixel` and `AttributionCapture`.
- GA gets a redacted `page_path` (`/i/:slug`) and a generic title, or nothing.
- The brief's funnel events go to the server-side `evite_events` table (no IP, no UA, no names).
- **[Adam]** OK to keep Meta Pixel off guest-facing invite pages entirely? I recommend yes: the visitors are other families, mostly with children.

**C13. Data duplication (§8).** Covered in §2. Every fact the invite shows is derived from `bookings` through one function. A change to theme, time, date, name or address changes `render_inputs_hash`, which triggers a re-render (`render_version++`), a new image key and a "details changed" email to Yes RSVPs with a reminder contact.
- The brief's "changes allowed up to 7 days out" is a booking-edit rule, not an invite rule. Today `modification_cutoff` is T-14 and admin can change anything. The invite simply follows the booking.

**C14. "Headcount + allergies on the party prep sheet" (§5).** There is no in-app prep sheet. MVP: an admin "Print RSVP sheet" view (headcount, kids, adults, allergies, notes) from the party card. Folding it into the hand-made summary sheets stays manual.

**C15. "EVITE" trademark in live copy (Open item).** The places to rename:
- `components/ThemeTileGrid.tsx:30`
- `app/party-packages/PartyPackagesContent.tsx:50`
- `app/glow-party/page.tsx:36`
- `app/kids-party-menu/KidsPartyMenuContent.tsx:690`
- `app/party-menu/page.tsx:121`
- `app/party-builder/PartyBuilderContent.tsx:2596`
- `app/book/success/page.tsx:22`
- `lib/emailTemplates.ts:513`
- `lib/email-templates/reminders.ts:200`
- `lib/email-templates/marketing-emails.ts:130`
- possibly the `pricing_items` / `party_themes` description rows in the DB

The code name stays `evite` internally (tables and routes are invisible to customers). **[Adam]** Final marketing name.

**C16. Guest cap (D6, §4).** The cap is `guest_count_approx` (what the party was booked and priced for), not the package default. Count = Σ `child_count` over Yes RSVPs; the birthday child is never an RSVP. MVP shows "11 of 10 kids"; the tier-upgrade prompt is P2 as the brief says. Note that the mini-party cap is inconsistent (6 vs 7) and should be fixed separately.

**C17. Guest children's data (§8 security).** Allergy notes are health data about minors. Purge them `allergy_purged_at` = party date + 7 days (**[Adam]** confirm the window), in the evite cron. Children's first names stay for the host's history unless Adam wants those purged too. A privacy-policy addition is required before launch (brief §12).

**C18. RSVP editing (D16 "Update your RSVP").**
- Each RSVP gets a 32-byte edit token: hashed in `edit_token_hash`, raw in the guest's confirmation and reminder emails as `/i/<slug>/rsvp/<token>`, and set as an HttpOnly cookie on the guest's device so a reload shows "you're on the list" instead of a second blank form.
- A guest without email or the cookie re-RSVPs. The host list shows both; that is acceptable.

**C19. Abuse / spam.**
- RSVP POST: `guardRate` (per-caller and per-route) plus `guardRecipient` on the reminder email/phone, so nobody can make us email one address forty times. Plus a hidden honeypot field.
- No captcha in MVP (none exists in the codebase, and it would break the 30-second goal).
- RSVPs only accepted while live and before the party date.

**C20. Host contact line (D5).** The default comes from `lib/studioLocation.ts`, never a literal. A parent-entered phone is screened (US 10-digit, rendered `631-998-9325` style), because it is printed into a public image. Name ≤ 40 characters.

---

## 4. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Satori can't reproduce the neon look closely enough | Day-one spike; pre-rendered word art; separate Chromium worker as fallback |
| R2 | Apple/WhatsApp cache previews by URL forever | Versioned image key per render (already in the brief); never overwrite an object |
| R3 | `facebookexternalhit` is iMessage's UA, so bot-detection logic from `/api/portal/auth` must **not** be copied to `/i/[slug]` | `/i/[slug]` is a plain SSR page serving the same HTML to bots and humans; no `?go=1` dance |
| R4 | Public page + child data | 50-bit slug, noindex, no analytics pixels, allow-listed columns, identical 404s, archive at cancel/lost |
| R5 | Over-sending to guests | Claim-before-send ledger, lateness bounds, `guardRecipient`, email only in MVP |
| R6 | Deposit unlock fails for a payment path nobody remembered | Derived from `bookingStage()`, which already reconciles all writers; add a test per writer type |
| R7 | Rendering on the request path slows the page or OOMs the 1-container site | Render on create/update in the background (best-effort, idempotent on `render_inputs_hash`); the page falls back to the last good image; one render at a time (in-process mutex) |
| R8 | Brevo free plan is 300 emails/day | Guest emails go through **Resend**, not Brevo; only club sync touches Brevo (contact sync, not sends) |
| R9 | Deleting a booking cascades to evites and RSVPs | Matches existing `delete_booking` behaviour (it already cascades payments and portal tokens); documented, not changed |

---

## 5. Side findings (outside this feature, but on its critical path)

These are from reading the code, not from running it. Worth a separate fix, because "unlock at deposit" only works if customers can pay.

1. **`/my-booking` card payments look broken.** `/api/portal/pay` returns a **PaymentIntent** `client_secret` (`app/api/portal/pay/route.ts:323-327`). `app/my-booking/MyBookingContent.tsx:193` passes it to `stripe.initEmbeddedCheckout()`, which takes a **Checkout Session** secret, so the card form should fail to mount.
2. **`/my-booking/pay` card payments do nothing.** `app/my-booking/pay/page.tsx:57` only handles `data.url`, but the card branch returns `clientSecret` and no URL, so it falls through to showing empty "instructions".
3. **`/api/party-checkout` drops the mobile address** sent by `/kids-party-menu/summary`.
4. **`/api/party-builder/save` classifies new mobile plans as `in_studio_theme`** (L288).
5. **`/api/quote/save` never writes `child_name`** (the value sits only in `quote_snapshot`).
6. **Two leftover "Suite 7" map URLs** in `lib/email-templates/reminders.ts:129,222`.
7. **Mini-party cap is 6 in the catalogue and 7 in the menu/planner copy.**

The planner's own Payment Element path and the `/plan/[ref]/summary` pay link are unaffected by 1–2.

---

## 6. Decisions needed before Stage 2

| # | Question | My recommendation |
|---|---|---|
| Q1 | D3: club checkbox email-only? | Yes: email-only, wording "Send me party & craft ideas from Host Hampton" (`club-v1`) |
| Q2 | Preview with no child name (C4) | Page shows "Birthday Star"; don't email the preview until a name exists; add an optional first-name field to inquiry forms |
| Q3 | Slug suffix length (C6) | 10 characters base32 (~50 bits), readable prefix kept |
| Q4 | Street address on the preview image (C7) | Town only on the image; full address on the page (D8 unchanged) |
| Q5 | Meta Pixel on invite pages (C12) | Off; funnel events server-side; GA with redacted path |
| Q6 | Brevo list for club members (C11) | New "Birthday Club" list, never list 3 |
| Q7 | Refund to $0 takes the invite offline (C3) | Yes |
| Q8 | Party durations for calendar/reminders (C5) | Theme 2h, mini 1.5h, mobile 60/90 min |
| Q9 | Allergy-note retention (C17) | Purge party date + 7 days |
| Q10 | Templates in code, not an `evite_templates` table (§2) | Code registry for MVP |
| Q11 | Host page at `/my-booking/invitation` rather than a portal tab (C9) | Yes; tabs later |
| Q12 | Fix side findings 1–2 (`/my-booking` card pay) first, as a separate change? | Yes: verify against production with a throwaway PaymentIntent, then fix |
| Q13 | Feature name to replace "EVITE" in copy | Adam's call |

---

## 6b. Gate 1 — Adam's decisions (2026-10-10)

Stage 1 approved. These override the recommendations above where they differ.

| # | Decision |
|---|---|
| Q1 | **Accepted.** The club checkbox is email-only, `club-v1` wording. |
| Q2 | **Changed.** With no child's name, the invite shows **"Birthday ⭐"**, and the preview **is still emailed to the prospect** as a marketing asset. |
| Q3 | **Changed.** The slug suffix is **4 random characters** (`mia-glow-7kq2`, about 1M per prefix). Compensating controls: a Cloudflare edge rate-limit on `/i/*` and `/api/i/*`, identical not-found answers, and an image key independent of the slug. |
| Q4 | **Accepted.** Town only on the preview image; the full address goes on the page. |
| Q5 | **Changed.** Meta tracking on invite pages goes **server-side through the Conversions API** with the URL cleaned to `/i/invite` and no title; no browser Pixel there. GA uses the same cleaned path. |
| Q6–Q12 | **Accepted** as recommended. |
| Q13 | Customer-facing name: **"Host Hampton EVITE"**. The trademark risk was raised once and Adam chose this; the copy is easy to change. |

## 7. Housekeeping

- The handoff package moved to `docs/specs/evites/handoff/` as AGENT_PROMPT.md instructed. It is **untracked**. This repo is public: `assets/glow/source-svg/` is 9.1 MB of reference-only Canva exports and should not be committed (keep it local or gitignore it). The mocks use a sample child "Mia" and the public business line only.
- Next free migration number: **068** (the highest file in `starting_plan/` is 067).
