# P11 — Pilot on production + link-preview test matrix

**Owner: the orchestrator** (not a builder agent). **Every numbered step marked 🛑 needs Adam's explicit OK first.**

Staging is production (the same container and DB), so the pilot runs behind the flags with throwaway data.

## Pre-flight
1. Adversarial code review of `feat/evites` (`/code-review high` or a review agent). Fix the findings on the branch.
2. Full `npx jest` and `next build` pass. Write the `SESSION_LOG.md` entry.

## Steps
1. 🛑 **Apply migration 068** via psql on the box (memory `supabase-migrations`) or the Supabase MCP `apply_migration`. Verify the tables, RLS, the bucket and `lead_source` with `information_schema` / `storage.buckets`.
2. 🛑 **Env:** add `EVITES_PAGES=pilot`, `EVITES_SENDS=pilot`, `EVITES_PILOT_REFS=<throwaway ref>`, `META_GRAPH_VERSION`, and optionally `META_CAPI_ACCESS_TOKEN` and `BREVO_BIRTHDAY_CLUB_LIST_ID` to `docker-compose.yml` and `/opt/hosthampton/.env`.
3. 🛑 **Deploy:** merge `feat/evites` → `main` (this auto-deploys). `gh run watch`. **Do not** also run `deploy.sh`. Verify `https://www.hosthampton.com/` returns 200 and an unknown `/i/x-x-abcd` returns 404.
4. **Box render check:** run the P01 runner in `node:20-alpine --network none` on the box, or confirm the first real render's `render_error` is null and its objects exist.
5. **Throwaway booking by direct SQL.** `status='lead'`, `party_type='in_studio_theme'`, `child_name='Testkid'`, a theme line item for Glow, date about 10 days out, `party_time '14:00'`. Contact email: a `+evite-test` address on a domain Adam owns, **confirmed absent from `contacts` first**. No `upsertContact`.
6. Admin card → `ensure`. Check the page `/i/<slug>` (preview ribbon, "Pick your date"), the OG image (< 300 KB, 1200×630) and the lead preview email.
7. 🛑 **Go live** with an admin-recorded $1 cash payment, `send_receipt:false`. **Never Stripe (LIVE).** Check:
   - the `invite_ready` email and magic link → host page
   - Share works
   - RSVP Yes with Adam's email as the reminder, and RSVP No
   - host list and admin card update; calendar on iPhone and Android
   - to check the reminders without waiting, temporarily move `party_date` so the week-before is due, then move it back
8. 🛑 **Crontab:** add `evite-sends` every 15 minutes to `/root/hh-cron.sh` / crontab, next to `send-reminders`.
9. 🛑 **Cloudflare:** a rate-limiting rule on `/i/*` and `/api/i/*`. Separately, ask whether Adam wants the origin lockdown (a fleet-wide nginx change).
10. **Cleanup:** delete the $1 payment row, then the booking (it cascades the evite, RSVPs and sends), **only after Adam confirms every link was opened**. Storage objects for the deleted evite can be removed by `image_key`.

## Link-preview test matrix (Adam, with the pilot link)

Send `https://www.hosthampton.com/i/<slug>` from a phone **in your contacts** (unknown senders may get "Tap to Load Preview"):

| # | From → To | Expect | ✅/❌ | Notes |
|---|---|---|---|---|
| 1 | iPhone → iPhone (iMessage) | Large card: invite image, "You're invited to Testkid's Glow Party!", date, "Questions? Ask Allie · 631-998-9325" | | |
| 2 | iPhone → Android (SMS/MMS) | Link with a preview on the Android side (rendering varies by app) | | |
| 3 | Pixel → Pixel (Google Messages, RCS) | Rich card with image and title | | |
| 4 | Samsung Messages → Samsung | Rich card or link preview | | |
| 5 | WhatsApp (any) | Card with image (WhatsApp caps images at 300 KB, so the size is checked here) | | |
| 6 | Re-send after a time change | **The old thread keeps the old card** (expected); a new send shows the new versioned image | | |
| 7 | Tap the card on each | Opens the invite page; RSVP works at phone width | | |
| 8 | Add to calendar on iPhone / Android | Calendar sheet / Google Calendar prefilled; 2 alerts on iPhone | | |

## Turning it on
🛑 Both flags to `on` only after the matrix passes **and** the privacy-policy paragraph is live. Existing booked parties ≥ 2 days out will receive `invite_ready` that day (the launch announcement). Confirm that with Adam.
