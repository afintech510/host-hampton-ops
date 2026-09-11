---
name: Party Quote & Invoice Builder
description: Create branded HTML quotes and invoices for Host Hampton parties — Studio Rentals, Mobile (at-home) Parties, and party add-ons/decor. Use whenever asked to "create a quote", "make an invoice", "send a quote", or "quote out" a Studio Rental or Mobile Party booking. Produces a self-contained HTML file using the locked Host Hampton header/footer template, with Stripe + Venmo payment blocks.
---

# Party Quote & Invoice Builder

Generates one-off HTML quote/invoice documents for Host Hampton, following the
locked template established for Studio Rental and Mobile Party bookings. These
are the same kind of documents as the existing files in `invoices/*.html` —
standalone, mailable/printable HTML, not a page in the live website.

## When to use this skill

Use it when asked to create, update, or resend a **quote or invoice** for:
- A **Studio Rental** booking (private studio space rental)
- A **Mobile Party** booking (Host Hampton comes to the client's location)
- Add-ons/decor pricing for either of the above

Not for the live website's own booking flow (`/studio-rental`, `/party-quote`,
`/party-builder`) or `booking_line_items` DB rows — this skill is for one-off
documents sent directly to a specific client, matching the existing pattern in
`invoices/`.

## The locked template

**Always start from `invoices/_template.html`.** Copy it to a new file, then
fill in the placeholders. Do not build a quote from scratch or freehand the
CSS — the header, footer, and payment section are locked and must be
byte-for-byte identical across every quote so the brand is consistent.

### What's locked (do not change structure, copy, or styling)

1. **Header** — logo on the left, invoice title/number/date on the right,
   and the full-width services bar underneath linking to every Host Hampton
   service page with its emoji. This exact list, in this exact order:
   - 🎉 Children's Theme Parties → `/kids-party-menu`
   - 🎨 Mobile Craft Parties → `/mobile-party`
   - 🏠 Party Studio Rental → `/studio-rental`
   - 💎 Permanent Jewelry → `/permanent-jewelry`
   - 🧢 Trucker Hat Bar → `/trucker-hat-bar`
   - ✨ Custom Activations → `/custom-accessories`
   - 🎗️ Fundraisers → `/fundraiser`
   (all links prefixed `https://www.hosthampton.com`)
2. **Payment section** (`.pay-section`) — Stripe "Pay $X Deposit" button
   styled in Stripe purple (`#635BFF`), plus a Venmo QR fallback below it
   using the shared `invoices/venmo-qr.png` image and the `@hosthampton`
   handle. Only the deposit amount, Stripe link, and Venmo note text vary.
3. **Footer** — address (links to Google Maps directions), phone (links to
   `sms:+16319989325`), email (`mailto:info@hosthampton.com`), and
   `hosthampton.com`, in that order, separated by `|`.

### What varies per quote

- Doc title (`Studio Rental Quotation`, `Mobile Party Quotation`, `... Invoice`
  once a deposit is paid and it becomes a confirmed booking record)
- Invoice number (see numbering below)
- Client block (name, email, phone)
- Event details block (type, subtitle, date/time, guest count)
- Line items and totals
- "What's Included" block — **Studio Rental only**, omit for Mobile Party
- Good-to-know text and policy bullets
- Services & Add-Ons / Decor option grids
- Deposit amount, Stripe link, Venmo note

## Invoice numbering

Grep existing quotes for the running sequence and increment:

```
grep -o "Invoice #.*<strong>[^<]*" invoices/*.html
```

Format is `444124-0001NN`. If a quote has a companion page or gets revised,
bump the suffix by one per document (mirrors how the Studio Rental deposit vs.
add-ons pages were originally numbered `...106` / `...107` before they were
merged onto a single page).

## Studio Rental specifics

- **Base rate**: pull current pricing from `/studio-rental` — do not assume
  the $575/3-hr rate is still current without checking, since pricing changes.
- **Deposit doubles as security deposit, but must read as visually separate
  from the Total/Balance Due.** The $250 deposit is NOT subtracted from the
  total — Balance Due = full rental Total, always. Earlier versions put the
  deposit as a row inside `.totals-section`, which read as if it were a
  partial payment toward the Total; that was confusing. Use the
  `.deposit-callout` block instead (dashed pink border, placed right after
  `.totals-section`, before any optional/not-included line items) labeled
  `Security Deposit — Required to Book` with a note stating it's separate
  from the Total, due now to reserve the date, and fully refundable after the
  event assuming no damage. Do not add a second, separate
  "Security Deposit (Refundable)" line elsewhere — one deposit payment covers
  both reservation and security.
- **Setup/cleanup time policy** — always include the two policy bullets
  in the goodtoknow block verbatim (setup/cleanup must fit inside the booked
  window; room must be left sweep-clean and garbage taken unless Garbage
  Service or Full Clean-up is purchased).
- **What's Included list** — Tables, Chairs, Dessert cart, WiFi, Bluetooth
  speakers, plus the note about retail items being removed and furniture
  consolidated. Keep this block; it answers a question every client asks.
- **Add-ons/decor pricing** — source current prices from the live
  `/party-room-rental` page (Services & Add-Ons + Decor sections) before
  quoting; don't reuse stale numbers from a previous quote file.

## Mobile Party specifics

- Party comes to the client's location — event details block should show the
  client's venue address, not Host Hampton's.
- Skip the "What's Included" block (inclusions belong in the featured line
  item's description instead, as in `invoices/dune-deck-disco-party-2026-09-05.html`).
- Skip the Studio Rental setup/cleanup + sweep-clean policy bullets — they
  don't apply off-site. Keep the goodtoknow block but tailor its text (e.g.
  additional-guest overage pricing, per-child pricing tiers).
- For package/tier-based quotes (client choosing between options), use the
  `.tier` / `.tiers` pattern from `invoices/dune-deck-disco-party-options-2026-09-05.html`
  instead of a flat `.line-items` list — check that file for the tier card
  markup if the quote needs pricing tiers rather than a single line item.
- Pull add-on pricing from `/party-add-ons`, `/party-menu`, or
  `/party-packages` depending on what's being quoted.
- **Always append a "Full Mobile Party Menu" section after the payment
  section** (below `.pay-section`, still inside `.body`, before the closing
  `</div>`) listing stations as plain `.menu-chip` cards (emoji + name, no
  price — see markup in `invoices/kristen-mobile-party-2026-10-24.html` for
  the `.menu-grid`/`.menu-chip` CSS and structure). No "Ask for Pricing" or
  any price text on the chips; pricing for real add-ons still lives in the
  Services & Add-Ons line items, not this menu.
  - **This is a curated master list, not a mirror of `/mobile-party`'s
    `menuItems` array** — it has been hand-edited to reflect what's actually
    been run as mobile stations (some site items were cut, some past-invoice
    stations were added that aren't on the site). Current master list:
    🧖 Mobile Spa Party, ✨ Hair Tinsel, 💫 Glitter Freckles, 👜 Canvas Bag Bar,
    💅 Manicures, 🦋 Glitter Tattoos, 🟢 Slime, 📿 Bracelet Making,
    🐩 Drip Paint Balloon Dogs, 💋 Lip-Gloss Charms, 🧢 Trucker Hat Bar,
    🏖️ Sand Art, 🎨 Canvas Painting, 📸 Photobooth, 🐶 Adopt a Puppy,
    🎤 KPop Backdrop, 🕶️ Sunglass Craft, 🎀 Decoden Crafts, 🐚 Seashell
    Decorating, 🌸 Perfume Making, 💇 Hair Brush Decorating, 💄 Glam Makeup,
    👛 Jelly Tote Decorating, 🪢 Beaded Braids, 🎙️ Decorate-Your-Own Microphone,
    ⚔️ Pirate Sword Decorating. (Construction Hat Craft and Life Size Barbie
    Box were deliberately removed from THIS invoice menu — don't re-add them
    without being asked. Note they DO still appear on the website's
    `/mobile-party` menu, which is intentionally kept in sync with this list
    except for those two.)
  - Exclude any station(s) already billed as this booking's line item(s) so
    the menu reads as "more you could add," not a duplicate of what they
    already bought.
  - Before quoting, grep `invoices/*.html` for `line-item-name\|option-name`
    to catch newly-run stations (e.g. themed one-offs) not yet folded into
    this master list, and ask the user whether to add them permanently.
  - End the section with a line linking to the live menu: "Don't see your
    idea? Ask us — we love custom requests! See the full menu anytime at
    [hosthampton.com/mobile-party](https://www.hosthampton.com/mobile-party)."

## Payment section rules

- **Generate the Stripe link yourself via the pay-link API — don't wait for
  the user to paste one, and don't invent one.** The site's
  `POST /api/admin/pay-link` endpoint (`services/website/src/app/api/admin/pay-link/route.ts`)
  is the canonical way to create it, same as the admin panel's "Send Pay
  Link" tool (`PayLinkPanel.tsx`). Always pass `linkType: 'payment_link'` —
  this is a real Stripe Payment Link, which doesn't expire by default
  (unlike `linkType: 'checkout_session'` / the default, which expires in
  24h and is wrong for anything mailed to a client who may not pay same-day).
  Call with `channel: 'link_only'` so it just returns `payUrl` without also
  emailing/texting the client (the invoice itself is how this gets sent).
  - Auth: `Authorization: Bearer {ADMIN_PASSWORD}` against
    `https://www.hosthampton.com/api/admin/pay-link`.
  - **PREFERRED / no-admin-password path — generate the link directly with
    the Stripe API using `STRIPE_KEY` from `.env.local`.** This is the
    reliable method and needs no admin password. `STRIPE_KEY` is a live
    restricted key (`rk_live_…`) that can create prices and payment links.
    Stripe Payment Links require an existing Price (not inline `price_data`),
    so it's two calls. The resulting `buy.stripe.com/...` link never expires —
    exactly what's wanted for a mailed invoice. Do NOT ask the user for the
    admin password when this works:

    ```bash
    cd services/website 2>/dev/null || cd .   # repo root also has .env.local
    SK=$(grep -i "^STRIPE_KEY=" .env.local | cut -d= -f2)
    # 1) create a one-time Price (amount in cents = fee-inclusive $ * 100)
    PRICE_ID=$(curl -s https://api.stripe.com/v1/prices -u "$SK:" \
      -d "unit_amount=25750" -d "currency=usd" \
      -d "product_data[name]=Host Hampton — {Client} {Party} Deposit ({Date})" \
      | grep -o '"id": *"[^"]*"' | head -1 | cut -d'"' -f4)
    # 2) create the Payment Link from that Price
    curl -s https://api.stripe.com/v1/payment_links -u "$SK:" \
      -d "line_items[0][price]=$PRICE_ID" -d "line_items[0][quantity]=1" \
      | grep -o '"url": *"[^"]*"'
    ```
    `STRIPE_KEY` lives at `.env.local` (repo root). It is LIVE — every link
    charges real money; double-check the cents amount before creating.
  - Only if neither `STRIPE_KEY` nor `ADMIN_PASSWORD` is available: **do not
    fall back to a manually-provided or invented link** — tell the user you
    need them to generate it via the live admin panel's "Send Pay Link" tool
    with the "Never" expiry option and the fee-inclusive amount (see below),
    then use what they hand back.
- **Always add a 3% card-processing fee to the amount actually charged via
  Stripe, and disclose it on the invoice.** This mirrors the existing
  pattern in `invoices/dina-mobile-party-2026-08-08.html` (card total shown
  as "$334.75 (includes card processing fee)" on a $325 balance).
  - Card amount = `round(balance_due * 1.03, 2)`. Send this inflated amount
    (not the raw balance) as `amountDollars` to the pay-link API.
  - The Venmo amount stays the **true balance due, no fee** — Venmo is the
    no-fee option and should read as cheaper on the page.
  - Button label: `Pay $X.XX Balance` using the fee-inclusive amount.
  - `pay-link-fallback` line: `Secure card payment via Stripe (includes 3%
    card fee)`.
  - `pay-intro` copy must state the fee exists and that Venmo avoids it,
    e.g.: "The remaining balance is **$1,401.00** ($1,443.03 if paying by
    card — includes a 3% processing fee). Pay by card below, or use Venmo
    for no fee."
- Venmo block always points to `https://venmo.com/hosthampton?txn=pay&amount={amount}&note={urlencoded note}`
  using the shared `invoices/venmo-qr.png` — do not generate a new QR image
  per quote; that image is the static Host Hampton Venmo profile QR, not a
  payment-specific code.
- Venmo note convention: `{Client First Name} — {Party Type} {Date}` (e.g.
  `Sophia — Studio Rental 11/14`), URL-encoded in the `href`, and readable
  (em dash, not `%20-%20`) in the visible note text.

## File & asset conventions

- Save to `invoices/{client-first-name}-{party-type}-{YYYY-MM-DD}.html`
  (e.g. `invoices/sophia-studio-rental-2026-11-14.html`).
- Reference `host-hampton-logo.png` and `venmo-qr.png` with relative paths —
  both already live in `invoices/`; don't copy or regenerate them.
- Do not create a separate "options" page for add-ons/decor — fold them into
  the same document, below the payment section (this was the previous
  pattern; it was consolidated onto one page per client feedback).
- These files are **not committed** to git — this matches the existing
  `invoices/*.html` files, which are working documents, not app code.

## After building a quote

1. Open it with `browser_open_local_preview` and screenshot top-to-bottom to
   sanity-check rendering (fonts, totals math, broken placeholder tokens).
2. Double-check the totals arithmetic by hand — Total, Deposit, Balance Due
   must reconcile given the deposit rule for that party type.
3. If asked to email or render to PDF, follow the pattern in
   `services/website/scripts/send-alexandra-quote.mjs` (headless
   Chrome `--print-to-pdf`, then Resend for delivery) rather than building a
   new send pipeline.
