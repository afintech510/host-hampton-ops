# Host Hampton — Party Menu design profile

A design system for **party menus**: the sheets a parent reads to choose a
theme, a package and add-ons. Built from what `hosthampton.com` and the locked
quote/invoice template already look like, so a menu, a quote and the website
read as one company.

## Files

| Path | What it is |
|---|---|
| `foundations/colors.html` | The palette, with the rules about which colour may do what |
| `foundations/type.html` | The two-typeface system and the scale |
| `components/menu-blocks.html` | Header, package card, add-on grid, price table, footer |
| `templates/party-menu.html` | A complete, printable menu using all of it |

Every preview file opens standalone in a browser and carries a
`<!-- @dsCard group="…" -->` marker on line 1, which is what the Claude Design
System pane builds its card index from.

## Pushing it to claude.ai/design

This could not be done from the session that generated it — `DesignSync` needs a
design-system authorization that only an interactive session can grant. To push:

1. In an interactive Claude Code session on this machine, run `/design-login`
   once. Headless and SDK runs afterwards reuse that authorization.
2. Then: `/design-sync design-profiles/host-hampton-party-menus`

Or open Claude Design, create a design-system project, and drag these files in.

---

## The prompt

Paste this into Claude when you want a new party menu. It is written to be
pasted **with the design profile selected** — the profile carries the look, the
prompt carries the job.

> You are designing a **party menu** for Host Hampton, a children's party and
> event company in Eastport, NY (Long Island). Use the Host Hampton design
> profile for all colour, type and component decisions — do not invent a palette.
>
> **The menu is for:** `<theme or service — e.g. "Slime Party", "Spa Party",
> "Mobile Craft Parties", "Studio Rental">`
>
> **Build it as a single self-contained HTML file** that prints cleanly to US
> Letter and is readable on a phone. Inline every asset. No build step, no CDN
> beyond Google Fonts.
>
> **It must contain, in this order:**
> 1. A header with the Host Hampton wordmark, the menu title, and one line
>    saying who the party is for and how long it runs.
> 2. **Two or three packages** as cards — a name, a per-guest or flat price, a
>    guest-count range, a duration, and 4–6 bullets of what is included. Mark
>    exactly one "Most Booked".
> 3. An **add-ons grid** — small tiles, each with a name and a price.
> 4. A **what's included / good to know** block: setup and cleanup happen inside
>    the booked window, what the host brings, what we bring.
> 5. A **clear next step** — book at hosthampton.com, text 631-998-9325.
>
> **Rules that are not negotiable:**
> - Prices must come from me or from the live site. If you do not have a real
>   price, write `$TBD` and list it at the end as something I have to fill in.
>   Never invent a number that a parent might be quoted.
> - Every price says what it covers — per guest, or flat, and the minimum.
> - Deposit language matches the quote template: the deposit reserves the date
>   and is **separate from** the total, never subtracted from it.
> - The public phone number is **631-998-9325**. Do not print any other number
>   on a customer-facing menu.
> - No stock photography placeholders that look like real photos. If you need an
>   image, leave a labelled empty frame.
>
> Ask me for the packages and prices before you start if I have not given them.

### Why the prompt is shaped like that

The two failure modes for a generated menu are both expensive and neither looks
like an error on screen: a **made-up price**, which a parent then holds you to,
and a **wrong phone number**, which routes a booking to a phone nobody answers
for business. Both are called out explicitly because a model asked for "a nice
party menu" will cheerfully fill either in to make the layout look finished.
`$TBD` is deliberately ugly for the same reason.
