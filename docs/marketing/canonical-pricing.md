# Host Hampton — Canonical Pricing (single source of truth)

**Owner ruling 2026-09-05:** *"Use pricing from this page"* — <https://www.hosthampton.com/party-room-rental>.
**The live page wins.** Where any doc, note, GBP draft or marketplace listing disagrees, it is wrong
and must be corrected to match this file. Transcribed verbatim from the live page on 2026-09-05.

This closes **P0-1** and the residual open question in `seo-action-plan-2026-09-04.md` §6c.

---

## 1. Room Rental — private events (3-hour and full-day blocks)

Space only. You may bring your own decor, catering and vendors — no restrictions on outside catering.

| Package | Days | Price | Duration |
|---|---|---|---|
| Weekday Rental | Mon–Fri | **$475** | 3 hours |
| Weekend Rental *(Most Booked)* | Sat–Sun | **$600** | 3 hours |
| Full Day Weekday | Mon–Fri | **$700** | 12 hours |
| Full Day Weekend | Sat–Sun | **$975** | 12 hours |

- **Additional hours:** **$100/hr** weekday · **$150/hr** weekend
- **Security deposit:** **$500**, refundable after post-event inspection (collected separately)
- **Reservation:** **25% non-refundable deposit** holds the date; balance due **7 days before** the event
- **Included:** tables & chairs for up to **60 guests**, basic lighting, WiFi, Bluetooth sound system,
  prep area, restroom access

## 2. Hourly Studio Rental — professional use (a separate product)

| Item | Price | Notes |
|---|---|---|
| Studio by the Hour | **$75/hour** | Minimum 1-hour booking; additional hours at the same rate |

For photography & content creation, team meetings & trainings, workshops, pop-up classes, cosmetics.

> **This is why the "two pricing systems" looked like a contradiction — it isn't one.**
> Room rental = private events, sold in blocks. Studio rental = professional use, sold hourly.
> The live FAQ states this explicitly. Both are correct and both stay.

## 3. Room Rental Menu — optional add-ons

| Service | Price |
|---|---|
| Room Setup & Decor (matching theme) | **$125** |
| Full Clean-up Service | **$125** |
| Garbage Service (trash removal) | **$35** |
| Party Helper (additional staffing) | **$25/hr** |

**Decor:**

| Item | Price |
|---|---|
| Double Arch Backdrop & Balloon Arches (double white arches, balloons & message) | **$250** |
| Balloon Tower w/ Number | **$195** |
| Balloon Garland 6 ft. | **$150** |
| Balloon Tower 6 ft. | **$125** |
| Barbie Box (photo prop) | **$100** |
| Linen Rentals | **$95** |

---

## 4. Superseded figures — do NOT use

These appear in older notes and drafts and contradict the live page. They are **retired**:

- ~~$125/hr weekday, 2-hr minimum~~ and ~~$200/hr weekend, 3-hr minimum~~ — recorded in a prior
  session's owner-facts as "marketplace-net" rates. Not published anywhere; do not quote.
- ~~"No flat-rate block"~~ — incorrect. Flat blocks are the published room-rental model.
- ~~"$100/hr photography"~~ from the drafted GBP services list — the real figure is **$75/hr**.

**Action:** the GBP services entry and any Peerspace / The Bash / Tagvenue listing must use
**$75/hr** for hourly studio use and the block rates above for events. This unblocks C-1 and C-4.

---

## 5. Kids party packages (studio) — for reference

From `/party-packages` and the glow party page: themed studio parties run **$750 (up to 8)** to
**$1,950 (up to 20)**; e.g. glow party $950 for up to 10. Reserve with a 25% deposit.

## 6. Mobile parties — PUBLISHED 2026-09-05 (B-1 closed)

Owner-confirmed tiers, now live on `/mobile-party`, `/mobile-craft-party`, all craft landing pages
and all 26 town pages. Source of truth: `services/website/src/lib/mobilePricing.ts`.

| Tier | Price | Duration | Kids included |
|---|---|---|---|
| **Entry** | **$500** | 60 min | up to **8** |
| **Signature** *(Most Booked)* | **$750** | 90 min | up to **12** |

- **Birthday child is always free**, on top of the included count
- **Additional children: $35 each**
- **Travel: free within 20 miles** of the Speonk studio; a modest mileage charge beyond it
  ($5/mile one-way on billable miles only — `app/api/party-builder/mileage/route.ts`)
- **No mandatory gratuity** — what we quote is what the customer pays

Both tiers work out to **$62.50/child** — the Signature tier buys more time and more stations, not
a higher per-head rate. Keep that true if the numbers move.

> **Travel-fee history worth remembering.** The quote builder used to charge $5/mile **from mile
> zero**, invisibly bundled into the package price — roughly +$150 on an East Hampton quote and
> +$425 on Manhattan — while the site promised "within 20 miles included." The free radius now
> exists in code, so the promise and the quote finally agree. Do not publish "no travel fee
> anywhere": it is not true past 20 miles.
