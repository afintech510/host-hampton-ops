# Host Hampton — print design system

One look for everything Host Hampton prints: signs, price labels, table
cards, menus. It is the website's look (`hosthampton.com`) carried onto paper,
and it is the look of the fridge sign (2026-09-18), which is the reference
piece.

## How it works

```
design-profiles/host-hampton/
├── brand.css                 ← the system: colours, fonts, components. Edit here, everything follows.
└── templates/
    ├── sign.html             ← any one-message sign (the fridge sign is a preset)
    ├── price-labels.html     ← type a list, pick a label sheet, print
    └── gift-card.html        ← 6×4 gift card; ?code=HH-XXXX-XXXX&amount=100 (code must exist in gift_cards)
```

Every template links `../brand.css`. A template only lays things out; it
never declares a colour or a font of its own. That is the whole trick: one
file holds the brand, and a new piece is a layout that uses it.

**To use a template:** double-click it to open in Chrome or Edge. Everything is
editable on the page and your edits are remembered in that browser. Print with
**Ctrl + P → Margins: None → Scale: 100%**. Never "Fit to page" — it shrinks the
sheet and labels stop lining up.

## The look, in six rules

1. **Ivory paper, navy ink.** `#F7F2E8` and `#2F343B`. All text is navy.
2. **Gold is an accent, not ink.** `#C7A36B` is for the short rules, the frame
   details, badges — and the tracked **HOST HAMPTON** mark, which is the one
   place gold is ever letters. A price, a name or an instruction in gold is
   unreadable in daylight (2.1:1 on ivory).
3. **Playfair Display for the voice, Montserrat for the information.** Titles
   and prices are Playfair 700. Anything someone reads as a sentence is
   Montserrat 500.
4. **The fridge-sign shape:** inset rounded navy frame → gold mark → short gold
   rule → title → one or two lines of instruction → rule → sign-off. Centred.
   Lots of empty ivory.
5. **No sixth colour.** A themed party is still Host Hampton; the theme lives in
   the words and photos. (The one exception is a fundraiser printed in the
   school's colours — see `esm-sharks-flyer`.)
6. **A price says what it covers.** "each", "per guest", "3 for $20". A bare
   number is the one that turns into an argument.

The colours come from `services/website/tailwind.config.js`. Read the hex, not
the Tailwind name — `hampton-pink` is gold and `hampton-navy` is grey.

## Facts that go on paper

| | |
|---|---|
| Phone (public) | **631-998-9325** — the only number on anything a customer sees |
| Venmo / Zelle | 631-599-2469 — payment only; the public line finds nothing in Venmo |
| Address | **295 Montauk Hwy, Speonk, NY 11972** — no suite, no Eastport (`lib/studioLocation.ts`) |
| Web | hosthampton.com |
| Email | hosthampton295@gmail.com |
| Instagram | @hosthampton |
| Signs off as | Allie, never Adam |

**Never invent a price.** A template with no price prints `$TBD`, highlighted
yellow, and the label tool counts them for you. A plausible made-up number looks
exactly like a real one until a customer holds you to it.

## Making a new piece

Table tent, Wi-Fi card, "please wait to be seated", a shelf talker — copy the
closest template, keep the `<link rel="stylesheet" href="../brand.css">`, and
build from these classes:

| Class | What it is |
|---|---|
| `.hh-mark` | Tracked gold HOST HAMPTON |
| `.hh-rule` | The short gold bar |
| `.hh-frame` | Inset rounded navy border |
| `.hh-title` | Playfair headline |
| `.hh-body` / `.hh-fine` | Montserrat instruction / small print |
| `.hh-price` + `.hh-unit` | Price and what it covers |
| `.hh-badge` | Navy-on-gold pill ("Most Booked") |
| `.hh-tbd` | A price nobody has supplied yet |
| `.hh-desk` / `.hh-panel` / `.hh-sheet` | Grey desk, control panel and paper on screen; the panel never prints |

Everything is sized in `em`, so set one `font-size` on the piece and the whole
design scales — that is how the 1-inch label and the letter sign share classes.

Or just ask Claude: *"make a Host Hampton sign that says …"* — the
`hh-print-design` skill points it here.

## Price labels on OnlineLabels OL800 (the box in the studio)

Use `labels/`, not the HTML page — a browser print adds its own margins and
scaling and the labels drift. This draws straight onto OnlineLabels' own
template PDF (`labels/OL800.pdf`) and reads every label position out of it.

1. Edit `labels/labels.txt` — one line per item: `Name | Price | small print | how many`.
2. `python labels/make_labels.py` (add `--skip 4` for a sheet with 4 already used).
3. Open `labels/out/labels-CHECK.pdf` to see it on the outlines.
4. Print `labels/out/labels-PRINT.pdf` with **Actual size** (or Scale 100%) —
   never "Fit". Test on plain paper first, hold it to the light against a sheet.
5. Still off by a hair in the same direction everywhere? That is the printer's
   own feed. `--nudge-x 0.03` moves right, `--nudge-y 0.03` moves down (inches).

Any other OnlineLabels or Avery sheet: download its PDF template and pass
`--template that.pdf`.

## Label sheets (HTML)

`price-labels.html` knows Avery **5160** (1 × 2⅝, 30/sheet), **5163** (2 × 4,
10), **5164** (3⅓ × 4, 6), **8371** business-card stock (2 × 3½, 10), and plain
cardstock with cut guides. Before a full run on a new box of labels, tick
**Alignment test**, print on plain paper and hold it against a label sheet to the
light. **Skip first N** reuses a half-used sheet.

To add a stock, add one line to `STOCKS` in that file: label width and height,
columns, rows, the top and left margin to the first label, and the pitch
(label + gap). Avery publishes all of these on each product's template page.

## Related

- `../host-hampton-party-menus/` — the earlier party-menu profile (same palette;
  it predates `brand.css` and still declares its own colours).
- `.claude/skills/party-quote-invoice` — quotes and invoices, which have their
  own locked template in `invoices/_template.html`.
