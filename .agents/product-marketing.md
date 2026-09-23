# Host Hampton — product marketing context

Read by the `ads` and `ad-creative` skills before they ask questions. Every figure
here was verified against the live site or the account console on 2026-09-23 — do
not invent prices, themes, URLs or claims that are not in this file.

**Both installed ad skills are written for B2B SaaS.** Ignore their LTV:CAC, payback
period, ABM, LinkedIn and lead-scoring material. This is a local consumer business
with one location, a ~$800 average order, and a purchase cycle measured in weeks.

---

## The business

Host Hampton LLC — a private kids' birthday party and celebration studio.
**295 Montauk Highway, Suite 7, Speonk, NY 11972** (Long Island / the Hamptons).
Phone **(631) 998-9325**. Rating **5.0 from 25 reviews**.

Two delivery models: **in-studio** parties at Speonk, and **mobile** parties hosted
at the customer's home. Mobile has no travel fee and has run from Manhattan to
Montauk, but the studio is the anchor.

**Themed birthday parties are the biggest revenue stream and the funnel to feed.**
This is the priority for paid media, per the owner.

## What is actually sold

**Price: from $800.** Package tiers run **$800 / $850 / $950**. A **$250 reservation
deposit** holds the date and **comes off the total** (it is not an extra fee — never
imply it is). A separate refundable $250 security hold exists on some bookings.

Never state a price other than "from $800" unless quoting a tier exactly. Theme page
prices are client-rendered and not in the served HTML, so do not scrape them.

## Themes — and which have landing pages

Send traffic to a real page. Everything below returns HTTP 200; anything not listed
does not exist.

**Themes with their own landing page** (best ad destinations):

| Theme | URL |
|---|---|
| Spa | `/spa-party` |
| Slime | `/slime-party` |
| Glow | `/glow-party` |
| Arts & Crafts | `/arts-and-crafts-party` |
| Trucker Hat Bar | `/trucker-hat-bar` |
| Squishy (make-your-own) | `/squishy-party` |
| Paint | `/paint-party` |
| Mermaid | `/mermaid-party` |
| Toddler | `/toddler-party` |

**Themes offered but with NO dedicated page** — advertise via `/party-packages`:
Barbie, Swiftie, K-Pop Demon Hunter, Sleep Under, Unicorn, Sweets & Treats.

**Three traps, all verified:**
- **"Patch" is not a party.** Iron-on patches are a feature *of* the Trucker Hat Bar.
  Send patch angles to `/trucker-hat-bar`.
- **"Sleep Under" has no page** (`/sleepover-party` and `/sleep-under-party` both
  404). It is a real offering and appears on `/party-packages` — link there.
- **"Girls party" has no page and is not a theme name.** Do not use it as a
  destination. Use a specific theme (Spa, Barbie, Swiftie) instead.

Hub pages: `/party-packages` (theme gallery), `/party-menu`, `/kids-party-menu`,
`/book` (booking flow).

## Audience

Parents — overwhelmingly mothers — of children roughly **4–13**, planning a birthday
**2–8 weeks out**. Local: Speonk, Westhampton, Hampton Bays, Quogue, Remsenburg,
Eastport, Center Moriches, Riverhead. Affluent-adjacent but value-conscious; many are
comparing against a bounce-house place or hosting at home.

What they actually want: **the party handled.** No setup, no cleanup, no hosting it
in their own living room. Hands-on hosts run the activity; the child gets something
made to take home. The competing emotion is "I don't want to spend my kid's birthday
managing it."

Awareness stage is usually **solution-aware** — they know they want a party venue,
they are choosing between options. Lead with the specific theme and the experience,
not with education about what a party venue is.

## Voice and constraints

Warm, concrete, a little playful. Never corporate. Speak to the parent, about the
child. Specifics over adjectives — "make your own squishy to take home" beats
"unforgettable magical memories."

**Hard rules:**
- It is a **children's business**. Never imply targeting children directly; ads speak
  to parents. Meta targeting must be adults.
- Do not use images of identifiable children without owner-confirmed permission.
  Creative is **supplied by the owner** — do not scrape site photos into ads.
- Do not promise availability, specific dates, or anything about staffing.
- Do not invent reviews or testimonials. The only sanctioned social proof is
  **5.0 stars, 25 reviews**.
- Never present the $250 deposit as an added cost.

## Measurement — what will and will not be visible

- **Meta Pixel `1543468516699272`** live since 2026-09-22. **Advanced Matching is
  OFF by decision** — no hashed email/phone. Do not propose CAPI or advanced matching
  without the owner's say-so.
- **GA4 `G-BX1DJ77T15`** and **Google Ads `AW-16667795146`** (customer
  `669-047-9883`) both live.
- Events: `generate_lead` fires on an unpaid booking request, `purchase` on real
  payment. Before 2026-09-22 both reported a fabricated $99 — **all Google/GA4
  conversion history prior to that date is junk.**
- **The phone half of inquiries is unattributed.** A real share of bookings happen by
  phone after seeing an ad and will never be credited. Any platform ROAS
  **understates** true performance — do not kill a campaign on platform ROAS alone.

## The honest state of the account

- **Google Ads is already spending ~$300/month** and what it buys has never been
  audited. Do not propose "starting" Google — propose auditing it first.
- **Remarketing pools are tiny:** 320 Search / **180 Display**. Search/RLSA needs
  1,000, so only Display is even eligible. Meta's pixel audience started from zero on
  2026-09-22 and needs ~1,000 before it serves.
- **Therefore: retargeting is not the lever yet — prospecting is.** Retargeting
  multiplies traffic; there is very little to multiply. Organic is thin too (14
  indexed pages, 71 total clicks).
- Realistic budget is **$5–10/day**. At that spend there will be single-digit monthly
  conversions. **Do not apply the skills' kill rules, fatigue bands or scaling
  quadrants** — they assume statistical volume this account will not have for months.
  Judge on a quarter, not a week.
- **Frequency capping matters more than usual.** A small local audience plus daily
  budget means the same families see the same ad repeatedly. In a town this size that
  is a reputational cost that never shows up in the dashboard. Cap ~2/day.

## What a good ad looks like here

Name the theme. Show the child making the thing. Say where it is and that the
cleanup is not theirs. Price transparency ("parties from $800") filters tire-kickers
at this budget, which is a feature.

The strongest seasonal hook right now: the **3rd Annual Host Hampton Christmas
Market, Sat Dec 5 2026, 10am–1pm, free admission, free pictures with Santa** at
`/christmas-market` — a free local event that builds the retargeting pool the party
ads will later need.
