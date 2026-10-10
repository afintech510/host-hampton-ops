# Host Hampton Digital Invitations — Handoff Brief

**Status:** Planning complete, decisions settled by Adam (Oct 9–10, 2026). Ready for codebase review → spec → build.
**Repo:** `afintech510/host-hampton-ops` (Next.js 14 App Router · Supabase · Stripe · Resend · Twilio · Docker on Hetzner)
**Planning doc (reference, may lag this file):** https://claude.ai/code/artifact/b6739f6d-2fc5-45c9-8054-e4482933e006
**Rule:** where this file and the planning doc or the AI reviews disagree, **this file wins.**

---

## 1. What we're building

Today staff design each party invite in Canva, export a PNG, and the parent texts it out and tracks RSVPs by hand. Replace that with:

1. Every lead (inquiry or saved quote) automatically gets a **preview invite** for their child in the chosen theme, usable as a sales asset.
2. When the $99 deposit is paid, the invite **unlocks**: the parent taps one button to text the link from their own phone.
3. The link's **text-message preview** (iMessage, Android RCS/SMS, WhatsApp) shows a small version of the invite.
4. Guests open a mobile page and **RSVP in under 30 seconds** (no app, no account).
5. The parent sees a **live RSVP list**; the studio sees **headcount + allergies** for prep.
6. After RSVP, guests may tick **one checkbox** to join the Host Hampton Birthday Club (party & craft ideas). Each guest family is a potential customer.

Works for **in-studio** and **mobile** (at client's home/park) parties.

## 2. Settled decisions (do not reopen without Adam)

| # | Decision |
|---|---|
| D1 | Invite is created at the **lead stage** (inquiry/saved quote) as a marketing preview. Date shows "Pick your date" until booked. **Sharing and RSVP unlock at deposit**; booking details fill in automatically. |
| D2 | **No discounts, perk codes, credits or referral rewards** for guests or hosts. |
| D3 | **One** marketing opt-in checkbox (unchecked by default), shown only **after** the RSVP is confirmed. Store timestamp + exact wording shown + opt-out timestamp. Claude's recommendation (not yet confirmed by Adam): make it **email-only** ("Send me party & craft ideas from Host Hampton"), which avoids marketing-SMS (TCPA/10DLC) exposure. Confirm with Adam before locking the spec. |
| D4 | No manually managed mailing list. Opted-in contacts receive an **AI-run monthly ideas email** built from recent @hosthampton Instagram posts (Phase 3). No offers. Suppress after 2 ignored sends. |
| D5 | **Host contact line** on every invite, on by default, **also shown in the preview image**: "Any questions? Ask {name} · {phone}". **Default = "Allie · 631-998-9325"** (Host Hampton). The parent can change it to their own name and number before sharing. |
| D6 | **Siblings count** toward the package guest cap. The birthday child does **not**. |
| D7 | **No waiver.** |
| D8 | Mobile-party address is **shown to everyone** who opens the invite. |
| D9 | Link format: `hosthampton.com/i/{slug}` (slug like `mia-glow-k4x`, unguessable suffix). |
| D10 | Host Hampton **never texts the guest list**. The parent shares from their own phone (native share sheet / SMS composer with a prewritten message). |
| D11 | RSVP options are **Yes / Can't make it** (no "Maybe"). |
| D12 | Parent customization is **optional**: one-line host note, RSVP-by date, gift note. The invite is ready to share without touching anything. |
| D13 | Templates are designed in **Canva**, exported as text-free backgrounds + icon art. **All text is rendered in code** (no Canva API at runtime). |
| D14 | Fonts are **free Google Fonts** (licensing-safe). Glow: Monoton, Bungee Outline, Neonderthaw, Poppins. |
| D15 | Guest list is **never visible to other guests**. |
| D16 | **Reminders:** optional "Want a reminder?" field (email **or** mobile, one box, auto-detected) for Yes RSVPs only. Sends **week before** (details + "Plans changed? Update your RSVP" link) and **day before ~4 PM** (time, address, parking/entrance note, contact line). Party-scoped only: these contacts are **not** marketing unless the Birthday Club box is ticked. Every SMS ends "Reply STOP to opt out." |
| D17 | **Add to calendar** everywhere: confirmation screen button, link in every reminder text, `.ics` attached to reminder emails. Event includes built-in alerts (1 day before, 2 hours before) so the phone reminds guests even without SMS. |
| D18 | **Parent final headcount:** after the day-before reminders go out, the parent gets a summary email (kids, adults, allergies, notes). |
| Open | Marketing name for the feature. Packages currently say "Digital EVITE invitation"; "Evite" is another company's trademark, so rename to "Digital invitation" (or similar) on the site. |

## 3. Guest RSVP flow (3 screens)

1. **Invite**: theme art, child name, date/time, location, host contact line, optional host note, countdown ("12 days to go"). Buttons: **Yes, we'll be there** / **Can't make it**.
2. **Who's coming** (Yes only):
   | Field | Required |
   |---|---|
   | Child first name (+ add sibling) | Yes |
   | Parent/guardian name | Yes |
   | Adults staying: 0 / 1 / 2+ | Yes |
   | Food allergy? No / Yes → details | Yes (the Yes/No) |
   | "Want a reminder?" email **or** mobile (one field, auto-detected) | Optional |

   "Can't make it" asks parent name only.
3. **You're on the list**: **Add to calendar** button (see section 6b), optional note to the birthday kid (host sees it). Below a divider: Birthday Club card with the single opt-in checkbox, email, optional birthday month.

Nothing on screens 1–2 mentions offers or marketing.

## 4. Parent (host) experience

- Lead stage: "Here's Mia's Glow Party invite" preview in the quote follow-up email/page.
- After deposit: "Mia's Glow Party invitation is ready!" → big **Text My Invitation** button (Web Share API / `sms:` fallback) with prewritten message, plus Copy link and Download image.
- Live list: kids attending, adults, allergies, notes to birthday kid, capacity vs. package tier (siblings count, birthday child excluded).
- Email alert to the parent on each RSVP (MVP); SMS alerts after 10DLC approval (P2).
- Auth: magic link (reuse the customer-portal token pattern from the kids-party lifecycle spec; the host page should become a tab in that portal).

## 5. Studio / admin

- RSVP tab on the booking in `app.hosthampton.com`: headcount, allergies roll-up, notes.
- Headcount + allergies on the party prep sheet.
- Theme or time changes (allowed up to 7 days out) re-render the invite and preview image (versioned image URL to bust caches).

## 6. Link preview (critical path)

- `/i/[slug]` is server-rendered with `og:title` ("You're invited to Mia's Glow Party!"), `og:description` ("Sat, Nov 14 · 2–4 PM · Host Hampton, Speonk · Tap to RSVP"), `og:image` (+ width/height), `twitter:card=summary_large_image`. No auth, no client JS required, `noindex`.
- Preview image: **1200×630 JPEG, under 300 KB** (WhatsApp is strictest). Layout per `mocks/og_card_mia.jpg`: portrait invite on the left over the plain background, title/date/place/"Tap to RSVP" on the right, host contact line included (D5).
- Full invite image: portrait, same render pipeline (for the page and the Download button).
- Pre-render on create/update (Satori via `next/og`, or headless Chromium as in `prototype/`), store in Supabase Storage, serve via Cloudflare. Version the filename on each re-render (`og-v3.jpg`); Apple and WhatsApp cache by URL.
- Known limits: iPhone may show "Tap to Load Preview" for unknown senders; already-sent previews never update.
- **Test matrix:** iPhone iMessage, iPhone → Android SMS, Pixel RCS, Samsung Messages, WhatsApp.

## 6b. Reminders and add-to-calendar

- **Calendar endpoint:** `GET /i/[slug]/cal` detects the device: iOS/macOS → `text/calendar` `.ics` download ("Add to Calendar" sheet); Android/other → redirect to a prefilled Google Calendar URL; `?format=ics` forces the file. SMS cannot carry `.ics` reliably, so texts always link to this URL.
- **Event content:** title "{Name}'s {Theme} Party 🎉", start/end, full address in LOCATION (map works), DESCRIPTION with the contact line ("Any questions? Ask Allie · 631-998-9325" by default) and the invite link, stable `UID` per evite, `SEQUENCE` incremented on change, `VALARM`s at −1 day and −2 hours.
- **Reminder jobs:** schedule week-before (T−7d, ~10 AM) and day-before (T−1d, ~4 PM ET) sends per Yes RSVP with a reminder contact. Skip if the RSVP changed to No, the party is cancelled, or the contact opted out. Idempotent (record sends per RSVP per type). Use the existing scheduler/cron pattern in the repo (agent: confirm what exists).
- **Channels:** email via Resend in the **MVP** (with `.ics` attached). SMS via Twilio in **P2**, after 10DLC approval; until then, phone-only guests rely on the calendar alerts.
- **Time/date changes:** send a "Party details changed" message with a fresh calendar link; email recipients also get an updated `.ics` (same UID, higher SEQUENCE). Already-saved phone events do not auto-update.
- **Limit:** only guests who responded can be reminded. The parent's "Re-share with people who haven't answered" button covers non-responders.

## 7. Templates

Each template = background image + optional icon strip + `templates/{theme}.layout.json` (text slots with position, font, size, color, glow, alignment, max width with auto-shrink).

- **Glow is done** and is the reference template: see `templates/glow.layout.json`, `assets/glow/`, `mocks/invite_mia.png`.
- "GLOW" and "PARTY" are rendered as text, so one background can serve multiple themes with color/word swaps.
- Long names must auto-shrink to fit the slot's max width.
- Glow is fully layered: plain background + code-drawn neon bar and brackets + squiggle art placed by the layout (squiggle no longer overlaps the "W"). `legacy-background-with-bar.png` is kept for reference only.
- Remaining themes (backgrounds + icons pending from Adam): Slime, K-Pop Demon Hunter, Swiftie, Barbie, Spa, Sleep Under, Trucker Hat, Toddler, Sweets & Treats, First Birthday, Communion, plus a generic and a mobile-party variant. Until then, fall back to `background-plain.png` + theme word.
- Source SVGs from Canva are huge (raster wrapped in SVG, 0.4–3.8 MB). Ship the optimized PNG/WebP versions (20–130 KB).

## 8. Suggested data model (agent: validate against the live schema first)

| Table | Key columns |
|---|---|
| `evite_templates` | id, theme_slug, name, background_url, icon_strip_url, layout (jsonb), location_types[], is_active, sort_order |
| `evites` | id, lead_id/quote_id (nullable), booking_id (nullable, FK), slug (unique), template_id, status (preview, live, archived), honoree_name, honoree_age, theme_word, event_date, start/end time, location_type (studio, mobile), address, rsvp_deadline, host_contact_name (default 'Allie'), host_contact_phone (default '631-998-9325'), show_host_contact (default true), host_note, gift_note, guest_cap, og_image_url, invite_image_url, render_version, host_token_hash, created/updated_at |
| `evite_rsvps` | id, evite_id, status (yes, no), parent_name, phone_e164, email, children (jsonb: first_name, allergy_note), adult_count, note_to_honoree, reminder_contact, reminder_channel (email, sms), reminder_opt_out_at, birthday_month, club_opt_in_at, opt_in_text_version, opted_out_at, consent_ip, edit_token_hash, created/updated_at |

- `evite_reminders_sent`: rsvp_id, type (week_before, day_before, details_changed, parent_final_headcount), channel, sent_at, provider_id (idempotency + audit).
- On opt-in: upsert `contacts` (source `evite`, source_evite_id).
- Reporting: match new bookings to past RSVPs by phone/email ("bookings from party guests"). **No credits** (D2).
- Allergy notes: delete after the event + a short retention window.
- Security: Supabase RLS, no raw DB ids in public URLs, rate-limit RSVP by IP + phone, hashed tokens. NY SHIELD Act applies to the guest-parent data.

## 9. Integration points to verify in the codebase

- Lead capture: `leads` table, contact form, `/kids-party-menu` quote builder (`quotes` table) → create preview evite (D1).
- Stripe `checkout.session.completed` webhook (booking insert) → link evite to booking, flip `status` to `live`, fill date/time/location (idempotent on booking_id).
- Resend: "invite ready" (parent), "new RSVP" (parent), "RSVP confirmed" (guest, if email).
- Twilio: P2 only, blocked on A2P 10DLC approval.
- Admin dashboard: booking detail RSVP tab.
- Kids-party lifecycle spec (6 open questions incl. magic-link expiry) → reuse its customer-portal auth.

## 10. Phasing

1. **MVP (~2 weeks):** Glow template + plain fallback; preview at lead; unlock at deposit; Text My Invitation; guest page + OG preview; 3-screen RSVP; Birthday Club checkbox; parent live list + email alerts; add-to-calendar endpoint with built-in alerts; email reminders (week before, day before) + parent final-headcount email; admin RSVP/allergy view; analytics events (invite_viewed, share_clicked, rsvp_started, rsvp_completed, club_opted_in, birthday_month_saved, booking_completed, guest_booking).
2. **Phase 2:** remaining theme templates; capacity meter + tier upgrade prompt; SMS reminders/updates (post-10DLC, same jobs as email); light theme animation; post-party photo album page; goody-bag QR card; tablet check-in.
3. **Phase 3:** AI monthly ideas email from Instagram (needs IG Business account + Meta Graph API token; send via Brevo); room-rental adult templates.

**Out entirely:** guest accounts, native app, guest-to-guest messaging, visible guest lists, contact syncing, Host Hampton texting guest lists, review requests to guests, discounts/referral credits, waivers.

## 11. Acceptance criteria (MVP)

- A new lead with a theme produces a preview invite page within seconds; RSVP is disabled until deposit.
- Deposit webhook makes the invite live with correct date/time/location; repeated webhooks do not duplicate.
- Pasting `/i/{slug}` into iMessage and Android Messages shows the invite card with child name, date and contact line (default Allie · 631-998-9325); image < 300 KB.
- A guest completes a Yes RSVP in ≤ 3 screens on a 375 px phone; the parent's list updates without reload (or on refresh at minimum).
- Siblings count toward the cap; the birthday child doesn't.
- "Add to calendar" on iPhone opens the Calendar add sheet with the right time, address and two alerts; on Android it opens a prefilled Google Calendar event.
- A Yes RSVP with an email gets the week-before and day-before emails exactly once each (with `.ics`); a No RSVP or opted-out contact gets nothing; the parent gets the final headcount after the day-before run.
- Opt-in stores timestamp + wording version; unchecked by default; appears only after RSVP confirmation.
- No other guest's data is ever exposed on the public page or API.

## 12. Open items (not blocking the spec)

- Backgrounds/icon strips for remaining themes (Adam).
- Final marketing name for the feature (Adam).
- D3 email-only vs email+text checkbox (Adam).
- 10DLC approval (blocks P2 SMS only).
- Instagram API access (blocks P3 only).
- Short privacy-policy addition covering invite RSVP data.

## 13. Files in this package

| Path | What |
|---|---|
| `HANDOFF.md` | This brief (source of truth) |
| `AGENT_PROMPT.md` | Prompt to give the local agent |
| `templates/glow.layout.json` | Glow text-slot layout (CSS px on a 1085×1530 canvas; background is 2170×3059 = 2×) |
| `assets/glow/background-plain.png` | Glow background (no text, no bar); bar/brackets drawn in code |
| `assets/glow/squiggle.png/.webp` | Neon squiggle accent, placed twice by the layout |
| `assets/glow/legacy-background-with-bar.png` | Earlier background with baked-in bar/brackets (reference only) |

| `assets/glow/icon-strip.png/.webp` | 7-icon neon strip (gift, shooting star, cake, camera, star, music, cupcake) |
| `assets/glow/icons/*` | 5 single icons for RSVP/confirmation screens |
| `assets/glow/source-svg/*` | Original Canva SVG exports (large; reference only) |
| `prototype/` | Working Node + Playwright renderer that produced the mocks (`npm i && npm run render`) |
| `mocks/invite_mia.png`, `mocks/og_card_mia.jpg` | Target output: full invite and link-preview card |
| `docs/reviews/*.txt` | ChatGPT and Grok design reviews (input only; superseded by section 2) |
