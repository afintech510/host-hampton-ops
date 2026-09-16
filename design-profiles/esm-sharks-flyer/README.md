# ESM Sharks — Fundraiser sales flyer

A design profile for the sheet the Eastport-Tuttle PTO hands out, prints, and
texts to parents. It is a **different brand from Host Hampton on purpose**: it
carries the school's navy and silver, because a parent is being asked to support
their school, not to notice the vendor.

## The artefact

| Path | What it is |
|---|---|
| `../../flyers/esm-sharks-fundraiser-flyer.html` | The built flyer — open it in a browser |
| `../../services/website/scripts/build-fundraiser-flyer.mjs` | What builds it |

Rebuild after changing prices, the URL, or the Venmo handle:

```bash
node services/website/scripts/build-fundraiser-flyer.mjs
```

The output is one self-contained HTML file — QR and product photos inlined — so
it survives being emailed to a PTO parent and opened on a phone with no signal.

**Two artboards in one file**, carrying the same offer:
- **8.5×11 letter** — print with *Background graphics ON*. Fits exactly one page.
- **1080×1350 card** — screenshot it to text. Hidden when printing.

## Tokens

| | | |
|---|---|---|
| `#0C2340` | `esmNavy` | Primary. Headers, prices, the QR itself |
| `#071628` | `esmInk` | Near-black navy for body text |
| `#A2AAAD` | `esmSilver` | Secondary — rules, eyebrows, dividers |
| `#E6E9EC` | `esmMist` | Silver tint for fills and the order band |

Type: **Oswald 500/700** for anything shouted, **Inter 400/600/700** for anything
read. Same pairing as the `/esm-sharks` storefront, so the flyer and the page a
parent lands on look like one thing.

## Rules that are specific to this flyer

1. **The QR is generated, never copied.** A QR code is unreadable to a human, so
   a wrong one is invisible — it looks perfect and silently sends every parent
   somewhere else. It is built from one `ORDER_URL` constant at the top of the
   script and nowhere else. Error correction is `H` so it survives a fold, a
   coffee ring and a bad phone camera in a school hallway.
2. **Prices are mirrored from `/esm-sharks`, by hand, in `PRODUCTS`.** They are
   not scraped: the page keeps prices in JSX `data-price` attributes, and a
   scraper that silently matched nothing would print a flyer with no prices on
   it. Two short lists a human can diff is the check.
3. **Never print a Venmo handle the code does not hold.** The script's
   `VENMO_HANDLE` is `null` today, so the flyer says "the order page shows you
   how" and lets the page — one place, changed once — name the account. See the
   warning below.
4. **Both fulfilment options appear, with the free one first.** "$7 to your door,
   100% donated to the PTO" is a reason to spend more, not a fee to bury; and a
   parent who did not know there was a free option feels charged for nothing.
5. **No deadline unless somebody gives you one.** An invented "order by Friday"
   on a printed flyer cannot be taken back.

---

## ⚠ Before this is printed in quantity

`lib/fundraiserTeams.ts` still points the Sharks' Venmo at **`@hostHampton`** —
Host Hampton's own account, a placeholder nobody has replaced. Orders paid by
Venmo today go to the wrong place. Set the PTO's real handle in
`venmoHandle` / `venmoUrl` / `venmoEmailHandle` **and** the storefront's payment
block, then set `VENMO_HANDLE` in the build script and rebuild.

---

## The prompt

For generating a flyer for **a different fundraiser** in this same shape.

> You are designing a **one-page fundraiser sales flyer** that a PTO or booster
> club will print, hand out at pickup, and text to other parents. Use the ESM
> Sharks flyer design profile for structure and hierarchy, but take the **colour
> palette from the school**, not from Host Hampton — the parent is supporting
> their school.
>
> **Fundraiser:** `<team / school / cause>`
> **Order page:** `<full https:// URL>`
> **Products and prices:** `<name — $price — variants, one per line>`
>
> Build **one self-contained HTML file** with two artboards: an 8.5×11 letter
> sheet that fits on exactly one page, and a 1080×1350 card for texting. The
> letter sheet prints; the card is hidden by `@media print`. Inline every image
> as a data URI. Google Fonts is the only external request allowed.
>
> **Structure, top to bottom:** logo and school name → what is being sold, as a
> photo grid with prices → a QR code beside 3 numbered steps → how the order
> reaches the family → who to ask.
>
> **Rules:**
> - Generate the QR from the order URL with a real QR library at error-correction
>   level H, at least 1.25 inches on the letter sheet. Never copy a QR image from
>   anywhere. State the URL in plain text underneath it as well — a QR is
>   unverifiable by eye, and the printed URL is how a human checks it.
> - Use only prices I gave you. If one is missing, write `$TBD` and list it at
>   the end. Never invent a price on a document that is being printed.
> - Do not print a Venmo handle, Cash App tag or account number unless I gave it
>   to you in this message. Say "the order page shows you how" instead.
> - No deadline unless I gave you one.
> - Say plainly what the money is for.
>
> Tell me afterwards which values you left as placeholders.

### Why the prompt is shaped like that

Every hard rule in it maps to a way this exact artefact fails *silently after it
is already on paper*: a QR nobody can proofread, a price a parent holds the PTO
to, a payment handle that quietly routes a hundred families' money to the wrong
account, a deadline that was never agreed. None of them look like errors on
screen — which is why they are stated as prohibitions rather than left to taste.
