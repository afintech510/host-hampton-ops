# Fantasy Football Draft Nights — keyword, competitor and pricing research

*2026-10-16. Source for the figures in `services/website/src/lib/draftParty.ts` and the page at `/fantasy-football-draft-party`. Keyword volumes are estimates from Google autocomplete; no volume tool was available (Ahrefs / Similarweb need authorizing).*

## Summary

- **The local market is empty.** The only Long Island venue with a dedicated draft page is Tap Room (bar chain, nearest location Patchogue): $50/pp, 3-hr open bar, wings, a reserved *table*, no private room, no board, no FAQ, no schema. Nothing for Riverhead, the Hamptons, Westhampton or the Moriches.
- **Timing.** Drafts run from mid-July to the first NFL game, and most of them land in the last two weeks of August. This season is over, so the page is for **2027**: get it indexed over the winter, add a dated "2027 draft season" line in July, and push hard from July 15 to Sept 10.
- **Search demand is "near me" plus generic.** "fantasy football draft venues near me", "fantasy football draft party locations near me", "places to host fantasy football draft", "private room for fantasy football draft". Long Island modifiers barely register, so ranking comes from proximity signals: Google Business Profile, LocalBusiness schema, and town names in the copy. That is also why the page names Moriches, Eastport, Riverhead, Hampton Bays and Southampton.
- **What this buyer cares about:** privacy (being able to hear the picks), WiFi, power at every seat, a screen for the draft app, a physical board with stickers, 3–4 hours, an evening start, food, commissioner perks, and nobody having to clean.

## Competitor pricing

| Venue | Price | Notes |
|---|---|---|
| Tap Room (9 LI locations) | $50/pp | 3-hr open bar, wings, $25 card for the commissioner, reserved table |
| Maxwell's (Islip) | $35/pp | 2 hr, beer + wings (probably 2024) |
| Dave & Buster's | from $32.99/pp | revenue minimums |
| World of Beer | $175/league | food + 3 beer buckets |
| 5 Under Golf | $175 / $250 / $450, ≤12 | board included, A/V hookup |
| Two Roads Brewing (CT) | $310–500 for 12 | food + drink tickets |
| Launch Labs Golf (CA) | $250 / $450 flat | allows outside food and drink |
| Patrick's Rooftop (Buffalo) | $75/pp | 8–14 people, board and stickers |
| Peerspace meeting rooms, Smithtown | ~$100/hr avg | room only |

The FSGA reports that 84% of players have a draft party, at a **median spend of $653 per league** (about $47–80 per manager).

## Michelangelo of Speonk (same building, 295 Montauk Hwy)

- Phone (631) 288-7900. Open 11 AM–9 PM. Online orders close around 8:35 PM.
- Prices: large pie $20, Grandma pie $23, 12 garlic knots $7. "Party Night" combo $45 (pie, chicken parm hero, 12 knots, 12 wings), per a third-party menu, unverified.
- Catering tray prices are not published. **Call them and agree a draft-night package price.**
- Estimated food cost for 12 people: **$13–18/head** before tax.

## Pricing set

| | Price | Per manager (12 teams) | Est. cost | Notes |
|---|---|---|---|---|
| Draft Room (room only) | $299 flat, Mon–Thu, 4 hrs, ≤16 | ~$25 | staff time + cleaning | Fills weeknights that are empty today. Under the $475 standard weekday 3-hr rate. |
| Draft Night Package | $499 for 12, +$30/extra | ~$42 | food ~$200 + board kit ~$25 | Under Tap Room's $50, with a private room they can't offer |
| Deposit | $100 | | | vs $250 for parties |

## BYOB — do not advertise it

NY ABC Law §64-b: a for-profit place with a **capacity of 20 or more** may not let people drink, even alcohol they bring themselves, without an SLA license or permit. The studio seats 65. The page and `llms.txt` therefore say "alcohol requires a permit; ask when booking", which matches the existing marketing email ("BYO catering & alcohol (with permit)"). `draftParty.test.ts` fails if "BYOB" appears on the page, in `lib/draftParty.ts` or in `llms.txt`. Confirm the permit route with the SLA or an attorney before saying more.

## Off-site AEO moves (the page alone won't get us named)

1. Google Business Profile: add a "Fantasy football draft party" product/service, and post in July 2027 with photos of the room set up for a draft.
2. Patch and Long Island Advance: a short "new on the East End" item in July.
3. Facebook groups (Moriches/Eastport, Westhampton, Hampton Bays): a commissioner-facing post in late July.
4. Photograph a real draft night: a long table, laptops, a board on the wall. The page currently has no men/sports photo; the hero is a CSS draft board.
5. Monthly AI check (ChatGPT, Perplexity, Gemini): "Where can I host my fantasy football draft on Long Island?" and "private room for a fantasy draft near Westhampton".

## Keywords used on the page

fantasy football draft party venue · fantasy draft party room · private room for fantasy football draft · fantasy football draft venues near me · places to host fantasy football draft · fantasy football draft package · fantasy draft Long Island / Hamptons / Westhampton · draft board with stickers · how long is a fantasy football draft
