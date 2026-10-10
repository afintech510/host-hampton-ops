# Host Hampton EVITE — Statement of Work (MVP)

**Status:** LOCKED with `03-architecture-spec.md` (see changelog there) · **Date:** 2026-10-10
**Inputs:** `handoff/HANDOFF.md` (source of truth), `01-codebase-review.md` (incl. §6b Gate 1 decisions)
**Customer-facing name:** "Host Hampton EVITE". Internal code name: `evite`.

---

## 1. Goal

Replace the Canva-PNG-plus-hand-tracked-RSVPs workflow with a generated invitation that:
- exists from the moment a kids-party lead comes in, as a sales asset;
- unlocks when the party is booked;
- unfurls in a text thread as the invite itself;
- collects RSVPs in under 30 seconds;
- tells the parent and the studio who is coming and what they can't eat.

## 2. In scope (MVP = HANDOFF §10 item 1)

| # | Deliverable |
|---|---|
| S1 | Migration **068**: `evites`, `evite_rsvps`, `evite_sends`, `evite_events`, `evite_consent_texts`, `evite_reminder_email_recent()`, `lead_source += 'evite'`, plus the `evites` storage bucket. Additive only. |
| S2 | **Glow template**, matching `handoff/mocks/invite_mia.png`, plus a **plain fallback** (Glow background with theme word) for every other theme. Self-hosted fonts (Monoton, Bungee Outline, Neonderthaw, Poppins). No runtime calls to Google Fonts or Canva. |
| S3 | **Render pipeline:** portrait invite JPEG plus a **1200×630 OG JPEG under 300 KB**, versioned in Supabase Storage, re-rendered when an input changes. |
| S4 | **Evite creation** for every kids-party booking (in-studio or mobile) at lead stage. Idempotent, non-fatal to intake, with a cron backfill. |
| S5 | **Lead preview email** to the prospect: one per booking, carrying the invite image and a link. Name missing → "Birthday ⭐". |
| S6 | **Public invite page `/i/[slug]`:** SSR, OG/Twitter metadata, noindex, works without client JS for the preview. States: preview, live, needs-time, closed, unavailable. |
| S7 | **3-screen RSVP**: Yes / Can't make it → Who's coming → You're on the list (add to calendar, note to birthday kid, Birthday Club card). RSVP edit link and device cookie. |
| S8 | **Unlock at booking:** live = booked per `lib/bookingStatus.ts`. Covers every deposit path, including Venmo/Zelle/cash entered by admin. Refund to $0 takes it offline. |
| S9 | **"Your invitation is ready" email** to the parent, once per booking, with a magic link to the host page. |
| S10 | **Host page `/my-booking/invitation`:** Text My Invitation (Web Share / `sms:` fallback), Copy link, Download image, optional customization (host note, gift note, RSVP-by date, host contact line), live RSVP list with headcount vs cap and an allergy roll-up. |
| S11 | **Parent "new RSVP" / "RSVP changed" emails.** |
| S12 | **Add-to-calendar** `/i/[slug]/cal` (`.ics` on Apple, Google Calendar on Android/other, `?format=ics`), with alarms at −1 day and −2 hours. |
| S13 | **Guest emails** (Resend): RSVP confirmation (if an email was given), week-before, day-before, details-changed. `.ics` attached. Exactly once each. |
| S14 | **Parent final-headcount email** after the day-before run. |
| S15 | **Birthday Club** opt-in (email-only, `club-v1` wording, unchecked, shown only after the RSVP is confirmed). The consent record is the RSVP row. A **new** person gets a `contacts` row (`source='evite'`, opt-in flags left false); an existing contact is only linked, never modified. Added to a dedicated Brevo "Birthday Club" list. |
| S16 | **Admin:** "Invitation & RSVPs" card on the PartiesTab drawer: state, links, headcount, allergies, notes, re-render, archive, printable RSVP sheet. |
| S17 | **Analytics:** server-side `evite_events` for invite_viewed, share_clicked, rsvp_started, rsvp_completed, club_opted_in, birthday_month_saved, calendar_added. Meta Conversions API `ViewContent` with a cleaned URL (`/i/invite`, no name or email). GA page view with a cleaned path; no Google Ads tag on `/i/*`. The guest-booking report is deferred past the MVP. |
| S18 | **Copy:** replace "Digital EVITE invitation" wording with "Host Hampton EVITE" in the 10 places listed in review C15. |
| S19 | **Retention cron:** purge allergy notes 7 days after the party; null non-club reminder contacts and archive the evite at 30 days. |
| S20 | **Tests:** behavioural tests plus a new `eviteSurface.test.ts` tripwire; existing surface suites updated (review §1.13). |
| S21 | **Rollout behind two flags:** `EVITES_PAGES` and `EVITES_SENDS` (each `off` / `pilot` / `on`), plus `EVITES_PILOT_REFS`. |
| S22 | **Party-cancelled notice** to Yes guests with an email, carrying a CANCEL `.ics`. |
| S23 | **Intake fixes the invite needs:** `quote/save` writes `child_name`; optional "Birthday child's first name" on the inquiry and mobile-inquiry forms; `/my-booking/login?next=`. |

## 3. Out of scope

**Phase 2 / 3 per HANDOFF:** SMS reminders and alerts (blocked on 10DLC), remaining theme templates, capacity meter with tier-upgrade prompt, animation, photo album page, goody-bag QR, tablet check-in, AI monthly ideas email, adult room-rental templates.

**Out entirely (HANDOFF §10, D2, D7, D10, D11):** guest accounts, native app, guest-to-guest messaging, visible guest lists, contact syncing, Host Hampton texting guest lists, review requests to guests, discounts / perk codes / credits / referral rewards, waivers, a "Maybe" option.

**Also out of this SOW:**
- **Fixing the `/my-booking` card-payment defects (review §5.1–5.2).** These are a separate change, done before the build (Q12).
- The other side findings in review §5.
- Turning `/my-booking` into a tabbed portal.
- An in-app prep sheet beyond the printable RSVP sheet.
- Studio rentals, fundraisers, trucker / canvas activations.

## 4. Acceptance criteria

Adapted from HANDOFF §11, with the Gate 1 decisions applied. Each one names how it is verified.

| # | Criterion | Verified by |
|---|---|---|
| AC1 | A new kids-party lead (in-studio or mobile) gets an evite row and a working `/i/{slug}` page **within seconds** of intake. RSVP is disabled until booked. The OG image exists within 60 s (inline render) or at worst by the next 15-minute cron tick. | Route test plus a pilot lead on production |
| AC2 | A lead with an email address receives **exactly one** preview email. With no child name it reads "Birthday ⭐". | Send-ledger test, pilot |
| AC3 | Any of these makes the invite **live**, with the correct date, time and location, and sends the parent **exactly one** "ready" email: a Stripe Payment Element deposit, a plan pay-link deposit, an admin-recorded Venmo/Zelle/cash payment, or an admin "confirmed" booking. Repeated webhooks or payments create nothing twice. | `inviteState` test per writer type; ledger uniqueness |
| AC4 | A `cancelled`/`lost` status or an archive makes `/i/{slug}` answer the same "isn't available" page as an unknown slug, and live guests with an email get one cancellation notice. An admin-recorded refund bringing net paid to ≤ 0 (on a non-legacy status) returns the invite to preview. **A Stripe refund alone does not change the invite**, because Stripe refunds don't touch `booking_payments` by design (spec §4). | Route + state tests |
| AC5 | Pasting `/i/{slug}` into iMessage and Android Messages shows the card with the child's name (or "Birthday ⭐"), date and contact line (default "Allie · 631-998-9325"). OG JPEG is exactly 1200×630, RGB, < 300 KB, with width/height in the metadata. | Image test (size, dims, colour type); manual link-preview matrix |
| AC6 | A guest completes a Yes RSVP in ≤ 3 screens on a 375 px viewport. The parent's host page shows it on refresh, and polls every 30 s while open. | Playwright e2e at 375 px; manual |
| AC7 | Headcount = Σ children across Yes RSVPs (siblings included). The birthday child is never counted. Cap = `bookings.guest_count_approx`. | Unit test |
| AC8 | `/i/{slug}/cal` on an iPhone UA returns `text/calendar` with the right start/end (ET → UTC), full address, the contact line, the invite URL, a stable UID, and VALARMs at −P1D and −PT2H. An Android UA gets a 302 to a prefilled Google Calendar URL. `?format=ics` forces the file. | Unit + route test; manual on devices |
| AC9 | A Yes RSVP with an email gets the confirmation, week-before and day-before emails exactly once each, each with an `.ics`. A No RSVP, an RSVP changed to No, a reminder opt-out, or a cancelled party gets nothing. The parent gets the final headcount once, after the day-before run. | Cron test over a fixture timeline; ledger uniqueness |
| AC10 | The Birthday Club checkbox is unchecked by default and appears only after the RSVP is confirmed. Opting in stores the timestamp, `club-v1` (the exact wording) and the IP on the RSVP. It never writes `contacts` consent flags or names, and never uses `upsertContact`. | Unit test on `recordClubOptIn`; tripwire E4 |
| AC11 | No public response (page HTML, OG metadata, RSVP API, cal route) contains another guest's data. Guest list, counts and notes are visible only to the authenticated parent and admin. | `eviteSurface` tripwire plus route tests asserting response shapes |
| AC12 | No browser Meta Pixel fires on `/i/*` or `/my-booking/invitation`. GA receives `/i/invite`, never the slug or the child's name. Outbound links from `/i/*` send no Referer. | Component test; manual network check |
| AC13 | Allergy notes are gone 7 days after the party. Non-club reminder contacts are gone and the evite archived 30 days after. | Cron test |
| AC14 | With `EVITES_PAGES` off, nothing is created or rendered and `/i/*` 404s. With `EVITES_SENDS` off, no evite email is sent, but live pages keep working. | Route + cron test |
| AC15 | The full Jest suite and `next build` pass. Every new public handler is in `DELIBERATELY_PUBLIC` and rate-limited. | CI |

## 5. Assumptions and dependencies

- **Production is the staging environment.** `staging.hosthampton.com` is the same container and the same database. "Build on staging" therefore means a production deploy behind `EVITES_ENABLED=pilot`, with throwaway bookings on addresses that provably do not exist (never a real contact: see the `upsertContact` note in the review).
- Migration 068 is applied by hand before the dependent code deploys (AGENTS.md §6). It is additive. Adam is still asked first.
- Satori/`next/og` reproduces Glow acceptably. **Phase 0 spike decides this**; the fallback is a separate Chromium render worker, which would extend the schedule.
- **Needs Adam during the build** (none block the spec):
  1. OK to add the Cloudflare rate-limit rule for `/i/*` and `/api/i/*`. Separately, whether to lock the origin to Cloudflare IPs plus nginx `limit_req`. That is a **fleet-wide** `hampton_nginx` change; it closes the origin-direct bypass of the 4-character slug's protections.
  2. A Meta Conversions API access token (`META_CAPI_ACCESS_TOKEN`). Without it, server-side Meta events are skipped and everything else works.
  3. OK to create the "Birthday Club" Brevo list (`BREVO_BIRTHDAY_CLUB_LIST_ID`).
  4. OK for the box crontab line for `/api/cron/evite-sends`.
  5. A privacy-policy paragraph for RSVP data, before `EVITES_ENABLED=on`.
  6. Confirm the "Host Hampton EVITE" name after the trademark note.

## 6. Schedule (indicative)

| Phase | Content |
|---|---|
| 0 | Render spike (1 day). Go/no-go on Satori. |
| 1–2 | Migration, facts, state, slug, render pipeline. |
| 3–4 | Public page, RSVP, calendar. |
| 5–6 | Host page, admin card, emails and cron. |
| 7 | Club, analytics, copy, retention, pilot. |

About two weeks of build, matching HANDOFF §10. Stage 3 turns these into operator prompts.
