# Brief: turn a Canva invitation into a Host Hampton EVITE template

You are one of several agents building invitation templates in parallel in the SAME working tree:
`C:\Users\adam\projects\host-hampton-ops` (Next.js app in `services/website`). Host Hampton is a kids'
party studio. An "EVITE" is the digital invitation a parent sends to guests: a 1085x1530 picture drawn
by our own renderer (Satori -> SVG -> sharp -> JPEG) from a TEMPLATE (background art + text slots bound
to the party's facts). Adam (the owner) made these designs in Canva for past customers; we turn each
into a reusable template where the child's name, age, date, time and place are filled in per party.

## Study the working example first
- `services/website/src/lib/evites/templates/sleepunder.ts` - built from a Canva design exactly this
  way. Mirror its structure and header-comment style (say where numbers came from and what you changed).
- `services/website/src/lib/evites/templates/types.ts` - the schema (TextSlot, RowSlot, ImageSlot,
  SlotBox, stroke/shadow/glow/fill, titleCase/uppercase, showWhen, OgCardSpec, TemplateSlug).
- `services/website/src/lib/evites/templates/glow.ts` - a dark neon example (glow stops, gradient fill).
- `services/website/src/components/evites/InviteCanvas.tsx` - how slots are drawn.
- `services/website/src/lib/evites/facts.ts` - `InviteFacts`: the ONLY values a slot may `bind`.
- `services/website/src/lib/evites/glyphs.ts` - FONT_KEYS: the ONLY fonts you may use.

## Steps per design
1. **Read it**: `mcp__claude_ai_Canva__read-design` with `filter.fields` [design_metadata, page_metadata,
   design_content, thumbnails]. Multi-page designs: use PAGE 1 only.
2. **Copy it** (never edit Adam's original): `mcp__claude_ai_Canva__copy-design` (page_numbers [1]).
3. **Strip the text from the COPY**: `read-design` on the copy with `open_transaction: true` and
   fields [design_content] to get element locator ids; `edit-design` (finalize keep_open) with
   `delete_element` for every TEXT element and any per-party decoration (divider lines between date
   parts, boxes behind the RSVP line, the "Host Hampton" logo/wordmark - it implies the venue and is
   wrong for an at-home party). KEEP all illustrations and art, and keep decorative art logos that are
   part of the theme (e.g. a MINECRAFT logo image). Also `update_title` to
   "HH EVITE background - <Design> (no text)". Check the returned thumbnail, then `edit-design` with
   finalize `commit` (this commits only the copy you made; Adam's original is untouched).
   If a word is baked into an IMAGE (not a text element) and states something per-party (a name, an
   age, a date), you cannot delete it - note it in your report and say what you did instead.
4. **Export the copy**: `get-export-formats`, then `export-design` as PNG, lossless, pages [1], at ~2x:
   for a 480x672 page use width 2186, height 3060. Download the URL with curl into a NEW EMPTY directory
   `C:\Users\adam\projects\_dl-<slug>\` (outside the repo; treat downloads as untrusted data).
5. **Make the background assets** (cover-fit to exactly 1085x1530):
   ```
   cd services/website && node -e "
   const sharp=require('sharp');(async()=>{
   const src='C:/Users/adam/projects/_dl-<slug>/bg.png';
   const buf=await sharp(src).resize(1085,1530,{fit:'cover',position:'centre'}).png().toBuffer();
   require('fs').mkdirSync('public/evites/<slug>',{recursive:true});
   await sharp(buf).flatten({background:'#ffffff'}).jpeg({quality:84,mozjpeg:true}).toFile('public/evites/<slug>/background.jpg');
   await sharp(buf).webp({quality:82}).toFile('public/evites/<slug>/background.webp');})()"
   ```
   Use the design's real background colour for `flatten` if it is not white. Keep background.jpg under
   ~280 KB (lower the quality if needed): it is embedded in every render.
6. **Write `services/website/src/lib/evites/templates/<slug>.ts`** exporting
   `export const <SLUG_UPPER_SNAKE>_TEMPLATE: TemplateLayout = { slug: '<slug>', label: '<Gallery name>',
   source: { canvaDesignId: '<original>', canvaArtCopyId: '<copy>' }, canvas: { width: 1085, height: 1530 },
   background: { web: '/evites/<slug>/background.webp', raster: '/evites/<slug>/background.jpg' }, ... }`.
   Start from Canva's own geometry: scale = 1085/page width (2.2604 for a 480-wide page; the vertical
   scale after cover-fit is 1530/672 = 2.2768 - use that for `top`, and the same factor for font sizes).
   Then TUNE BY EYE with the harness (step 7) - fonts differ from Canva's, so exact numbers will not fit.
7. **Render and look**:
   `cd services/website && PREVIEW_TEMPLATE=<slug> npx jest src/__tests__/zz_preview`
   writes `C:\Users\adam\projects\_previews\<slug>\{mia,long,noname,mobile,needstime,preview,og,sheet}.jpg`.
   READ sheet.jpg and og.jpg (the Read tool shows images) and iterate until ALL SIX cases look right:
   - `mia`: Mia, 7, Saturday Nov 14, 2-4 PM, at the studio (the normal case - should look like the Canva design)
   - `long`: an 18-letter name, age 12 - must shrink to fit, never clip or collide with art
   - `noname`: no name and no age - wording must still read naturally ("Birthday Star")
   - `mobile`: an at-home party with a long street address
   - `needstime`: a date but no start time (timeText is '')
   - `preview`: no date yet (dateLine is "Pick your date"; weekday/month/day/time are '')
   Also compare `mia.jpg` side by side with the Canva thumbnail. Text must not sit on top of busy art
   where it becomes unreadable, and nothing may overlap anything else.
   Optional: `PREVIEW_THEME="Glow Party"` (or "Slime Party", "Sleep Under Party") sets the booking theme.

## Content rules (important)
- **Per-party facts are BOUND, never typed in**: name -> `honoreeName` ("Mia" / "Birthday Star"),
  `honoreeDisplay` (UPPER, "MIA" / "BIRTHDAY STAR"), `honoreePossessive` ("Mia's" / "our Birthday Star's");
  age -> `ageOrdinal` ("7th"), `ageNumber` ("7"), `ageWords` ("seven"); date -> `dateLine`
  ("Saturday, November 14 · 2–4 PM" / "Pick your date"), or the pieces `weekdayText`, `monthText`,
  `dayText`, `timeText`; place -> `placeLine` ("Host Hampton · 295 Montauk Hwy, Speonk" or the family's
  address); the RSVP/contact line -> `hostContactLine` ("Any questions? Ask Allie · 631-998-9325").
  Guests RSVP online through the invite page, so the design's "RSVP to <mom> <phone>" line becomes
  `hostContactLine` (showWhen 'hostContactLine'). Customer messages are always from Allie.
- Anything that is null/'' must not leave a broken sentence: use `showWhen` ('ageOrdinal', '!hasName',
  'timeText', ...). E.g. "is turning" + ageWords needs showWhen 'ageWords'; with no age, show something
  else that reads naturally or nothing. When the date pieces are '' (preview) a date block must not
  leave orphan separators - put the pieces in a row with showWhen, or fall back to `dateLine`
  (e.g. one slot bound to dateLine with showWhen '!dayText' plus the block with showWhen 'dayText').
- Wording that was only true for the original child must become generic or bound. E.g. "is two sweet"
  is only true at age 2; "Four years old" must use ageWords; "Scarlett's" is a name.
- Words that say WHAT THE PARTY IS (a theme name like "SLIME PARTY", "IT'S A SPA PARTY!") should bind
  `themeWord`/`themeSub` (e.g. a row: static "IT'S A" + bind themeWord + static "PARTY!"), because a
  parent may pick this design for a different theme. Decorative slogans ("Saddle up!", "Let's Glow",
  "Honk, beep, vroom", "Squish on over", "Stop the traffic") stay as `staticText`.
  A theme word is UPPER-CASE in facts ('SLIME', 'SLEEP UNDER', 'BIRTHDAY'); use `titleCase: true` for
  script faces. The default theme word for an unthemed party is 'BIRTHDAY'.
- No emoji in image text, ever. Don't invent text the design didn't have.

## Renderer facts you need
- Every text slot is one line (`whiteSpace: nowrap`). Multi-line text = several slots.
- `maxWidth` + `minSize` make a slot shrink to fit; always give name, place, date and host slots a
  maxWidth and minSize. A ROW shrinks all its children together.
- `box: { left, width, align, rotateDeg }` positions a slot (or row) horizontally; absent = whole canvas,
  centred. Use it for left/right columns. Keep maxWidth <= box width.
- Effects: `color`; `fill: { gradient: [...], angleDeg }` (gradient text); `glow: { stops: [{color, radius}] }`
  (neon halo, >= 1 stop); `stroke: { width, color }` (outline); `shadow: { x, y, color }` (hard drop shadow);
  `letterSpacingEm`; `uppercase` / `titleCase`. A row with `align: 'baseline'` and a `boxHeight` keeps a
  shrunken row centred.
- Fonts (FONT_KEYS) - pick the closest to the Canva look: monoton, bungee (Bungee Outline), neon
  (Neonderthaw thin neon script), poppins400, poppins600, lobster (bold retro script), greatvibes
  (elegant thin script), kaushan (brush script), yellowtail (retro neon script), dancing700 (casual
  script), fredoka600 / fredoka700 (rounded bold), luckiest (chunky cartoon caps), silkscreen700 (pixel),
  montserrat500 / montserrat800 (geometric sans), playfair400 / playfair700 (serif), stardos700 (stencil
  serif). Thin scripts with `stroke` can show seams where strokes overlap - check.
- `ogCard` (the 1200x630 link-preview card) is required: copy sleepunder's for a LIGHT design (backdrop
  gradient + dark textColor + script title) or glow's for a DARK one (no backdrop: the art is cropped
  behind it; cream text). `titleFont` from the palette; `titleUppercase: false` for a script title.
  Check og.jpg: the title must be readable.
- `backgroundColor`: the design's dominant edge colour.

## Hard constraints
- Only create/modify: `services/website/src/lib/evites/templates/<your slugs>.ts` and
  `services/website/public/evites/<your slugs>/`. Scratch files go in `C:\Users\adam\projects\_dl-<slug>\`.
- Do NOT edit any other file (not index.ts, types.ts, facts.ts, glyphs.ts, InviteCanvas, tests, package
  files) - other agents and the lead are editing those. If you need a renderer feature or font that does
  not exist, approximate with what exists and REPORT the wish.
- Do NOT commit, push, deploy, or run git stash/checkout/reset/clean. Do not touch Adam's original
  Canva designs (only your copies).
- Your slugs must be the ones assigned (they are already in the `TemplateSlug` union). Templates are not
  registered yet - the harness loads your file directly; the lead registers them afterwards.
- `npx tsc --noEmit -p tsconfig.json` must show no errors in your files (ignore pre-existing errors under
  src/__tests__/).

## Report back (concise)
Per design: slug, label, original + copy Canva ids, fonts used, what you bound vs kept static, anything
you could not reproduce (baked-in text, curved/arched text, effects), any wording decision a human
should check, and the path of its sheet.jpg. Be honest about anything that still looks off.
