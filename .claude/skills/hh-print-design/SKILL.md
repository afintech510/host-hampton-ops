---
name: hh-print-design
description: Make printed pieces in the Host Hampton look — price labels, price tags, signs (like the fridge sign), table tents, shelf cards, Wi-Fi cards, menus, flyers for the studio. Use whenever asked for anything Host Hampton will print or put up in the studio "in our style", "like the website", or "like the fridge sign". Not for quotes/invoices (use party-quote-invoice).
---

# Host Hampton print design

The design system lives in `design-profiles/host-hampton/`. **Read its
`README.md` first** — it holds the six look rules and the facts that go on paper.

## What to do

1. **If an existing template fits, use it rather than writing a new file.**
   - One message on a page → `templates/sign.html` (presets: the fridge sign, blank).
   - Price labels → **`labels/make_labels.py`**: write the items into
     `labels/labels.txt`, run it, hand over `labels/out/labels-PRINT.pdf` (print at
     Actual size). It draws onto the label maker's own template PDF (default
     `labels/OL800.pdf`, the OnlineLabels sheets in the studio). The HTML
     `templates/price-labels.html` drifted when printed from the browser — only
     use it for a quick on-screen preview.
   Tell the user what to type into it; it saves in their browser.
2. **A new kind of piece** → copy the closest template into
   `design-profiles/host-hampton/templates/`, keep
   `<link rel="stylesheet" href="../brand.css">`, and build only from the `.hh-*`
   classes. Never declare a colour or font in a template — if something is
   missing, add it to `brand.css` so every piece gets it.
3. **Render it and look at it before saying it is done.** Headless Chrome:
   `chrome --headless=new --virtual-time-budget=4000 --no-pdf-header-footer --print-to-pdf=<out.pdf> file:///<path>`
   then Read the PDF. Check the text fits, nothing wraps badly, and the page
   count is what you expect.

## Rules that are not negotiable

- **Never invent a price.** No price from the user → `$TBD` (`.hh-tbd`), and say
  which ones are missing.
- **Phone on customer-facing paper is 631-998-9325.** Venmo/Zelle is
  631-599-2469 and appears only next to "Venmo"/"Zelle".
- **Address is `295 Montauk Hwy, Speonk, NY 11972`** — no suite, never Eastport.
- **Gold (`#C7A36B`) is never text** except the tracked HOST HAMPTON mark.
- Customer-facing copy signs as **Allie**, never Adam.
- These files are in a **public** repo: no customer names, phone numbers or
  booking details in a template or its presets.
